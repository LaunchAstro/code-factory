// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import {
  commandNames,
  depsFindings,
  imported,
  installedBins,
  isConfig,
  lockImporters,
  lockfileFindings,
  packageOf,
  workspaceOf,
} from '../../scripts/deps-check.mjs';
import { excluded } from '../../scripts/tree-files.mjs';

const root = resolve(import.meta.dirname, 'fixtures/deps');
const relative = (name) => `tests/ci/fixtures/deps/${name}`;
const text = (name) => readFileSync(resolve(root, name), 'utf8');

// One fixture directory is one workspace: its manifest and its one source.
const tree = (name) => ({
  workspaces: [
    {
      path: relative(`${name}/package.json`),
      dir: relative(name),
      manifest: JSON.parse(text(`${name}/package.json`)),
    },
  ],
  sources: [{ path: relative(`${name}/index.mjs`), text: text(`${name}/index.mjs`) }],
});

test('a declared package nothing uses is refused, naming the manifest', () => {
  const found = depsFindings(tree('unused'));
  assert.equal(found.length, 1);
  assert.match(
    found[0],
    /^tests\/ci\/fixtures\/deps\/unused\/package\.json: left-pad is declared/u,
  );
});

test('an import the workspace does not declare is refused, naming the file', () => {
  const found = depsFindings(tree('undeclared'));
  assert.equal(found.length, 1);
  assert.match(found[0], /undeclared\/index\.mjs: imports left-pad/u);
});

test('a clean workspace passes', () => {
  assert.deepEqual(depsFindings(tree('clean')), []);
});

test('the allow-list clears a package nothing uses, and nothing else', () => {
  assert.deepEqual(depsFindings({ ...tree('unused'), allow: { 'left-pad': 'tooling' } }), []);
  assert.equal(depsFindings({ ...tree('undeclared'), allow: { 'left-pad': 'tooling' } }).length, 1);
});

test('a bin run by a package script counts as use', () => {
  const workspaces = [
    {
      path: 'package.json',
      dir: '',
      manifest: {
        scripts: { typecheck: 'tsc --noEmit' },
        devDependencies: { typescript: '7.0.2' },
      },
    },
  ];
  assert.deepEqual(depsFindings({ workspaces, sources: [], bins: { typescript: ['tsc'] } }), []);
  assert.equal(depsFindings({ workspaces, sources: [] }).length, 1);
});

test('a config file naming a package counts as use, on a key that resolves one, never as a key below it', () => {
  const workspaces = [
    { path: 'package.json', dir: '', manifest: { devDependencies: { 'x-config': '1.0.0' } } },
  ];
  const configs = [{ path: 'commitlint.config.js', text: "extends: ['x-config']," }];
  assert.deepEqual(depsFindings({ workspaces, sources: [], configs }), []);
  // A literal value may start on the line after its key.
  for (const value of ["['x-config']", "'x-config'"]) {
    const next = [{ path: 'tool.config.mjs', text: `export default { plugins:\n  ${value} };\n` }];
    assert.deepEqual(depsFindings({ workspaces, sources: [], configs: next }), [], value);
  }
  const mention = [{ path: 'commitlint.config.js', text: '// x-config was here once' }];
  assert.equal(depsFindings({ workspaces, sources: [], configs: mention }).length, 1);
  // An inline plugin imports nothing: its alias is a key, whatever its
  // spelling, and no string inside its object is a name.
  for (const plugin of [
    "{ 'x-config': { rules: {} } }",
    "{ ['x-config']: { rules: {} } }",
    '{ [`x-config`]: { rules: {} } }',
    "{ local: { meta: { name: 'x-config' }, rules: {} } }",
    "{ local: { rules: { x: 'x-config' } } }",
  ]) {
    const alias = [
      { path: 'eslint.config.js', text: `export default [{ plugins: ${plugin} }];\n` },
    ];
    assert.equal(depsFindings({ workspaces, sources: [], configs: alias }).length, 1, plugin);
  }
  // A string the value only may be is refused for that, and is never a key.
  const ternary = [
    { path: 'eslint.config.js', text: "export default { plugins: c ? 'x-config' : 'y' };\n" },
  ];
  assert.throws(
    () => depsFindings({ workspaces, sources: [], configs: ternary }),
    /^Error: eslint\.config\.js:1: a resolving value that is not a string or an array of them/u,
  );
  // A value runs on past a line break to its comma or closing bracket.
  for (const value of [
    "'x-config'\n  + 'x' }",
    "['x-config']\n  .map(String).slice(1) }",
    "'x-config'\n  ? {} : {} }",
    "process.env.CI\n    ? 'x-config'\n    : 'y',\n}",
  ]) {
    const runOn = [{ path: 'eslint.config.js', text: `export default [{ plugins: ${value}];\n` }];
    assert.throws(
      () => depsFindings({ workspaces, sources: [], configs: runOn }),
      /: a resolving value that is not a string or an array of them/u,
      value,
    );
  }
});

test('an unused package appended to .gitignore is still refused', () => {
  assert.equal(isConfig('.gitignore'), false);
  assert.equal(isConfig('.prettierignore'), false);
  assert.equal(isConfig('.npmrc'), false);
  assert.equal(isConfig('commitlint.config.js'), true);
  const configs = [{ path: '.gitignore', text: 'node_modules\nleft-pad\n' }];
  const found = depsFindings({ ...tree('unused'), configs });
  assert.equal(found.length, 1);
  assert.match(found[0], /left-pad is declared/u);
});

test('every shape of import is read, and prose and comments are not', () => {
  // The fixture holds a static import, a bare one, a require, a builtin, a
  // relative path, a commented-out import and a sentence naming a package.
  assert.deepEqual([...imported(text('forms/index.mjs'), relative('forms/index.mjs'))].toSorted(), [
    'lazy-dep',
    'left-pad',
    'side-effect-only',
  ]);
});

test('a file belongs to the nearest manifest above it, not the root', () => {
  assert.equal(workspaceOf('apps/web/src/main.mjs', ['', 'apps/web']), 'apps/web');
  assert.equal(workspaceOf('scripts/check.mjs', ['', 'apps/web']), '');
});

test('a repository with no package.json is refused, not passed', (t) => {
  const result = repository(t, { 'package.json': null });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /^deps: no package\.json anywhere in the repository; /mu);
});

test('a package one workspace uses is not thereby used by another', () => {
  const declares = { dependencies: { 'left-pad': '1.0.0' } };
  const workspaces = [
    { path: 'package.json', dir: '', manifest: declares },
    { path: 'apps/web/package.json', dir: 'apps/web', manifest: declares },
  ];
  const sources = [{ path: 'apps/web/index.mjs', text: "import 'left-pad';\n" }];
  assert.deepEqual(depsFindings({ workspaces, sources }), [
    'package.json: left-pad is declared and nothing imports it, runs its bin or names it in a config',
  ]);
});

test('an import whose from clause is on another line is read', () => {
  assert.deepEqual([...imported("import pad\n  from 'left-pad';\nvoid pad;\n")], ['left-pad']);
  const spread = "import {\n  a,\n} from 'pkg-a';\nexport {\n  b,\n} from 'pkg-b';\n";
  assert.deepEqual([...imported(spread)].toSorted(), ['pkg-a', 'pkg-b']);
});

test('require in a string or a trailing comment is not an import, and real code is', () => {
  assert.deepEqual([...imported(`export const message = "require('left-pad')";\n`)], []);
  assert.deepEqual([...imported("const x = 1; // require('left-pad')\n")], []);
  assert.deepEqual([...imported("const a = 'x', b = require('left-pad');\n")], ['left-pad']);
  // A backslash before CR LF continues the string onto the next line.
  assert.deepEqual([...imported("const s = 'a\\\r\nb'; require('left-pad');\n")], ['left-pad']);
});

test('a template literal is prose, its interpolation is code, across lines', () => {
  assert.deepEqual([...imported("export const m = `Example:\nrequire('left-pad')\n`;\n")], []);
  assert.deepEqual([...imported("const m = `${import('left-pad')}`;\n")], ['left-pad']);
  assert.deepEqual([...imported("const m = `a ${`b ${require('x')}`} c`;\n")], ['x']);
  assert.deepEqual([...imported('const pad = require(`left-pad`);\n')], ['left-pad']);
});

test('a block comment closed on its line ends there', () => {
  assert.deepEqual([...imported("const v = 1; /* c */ import('left-pad');\n")], ['left-pad']);
  assert.deepEqual([...imported("/* a\nrequire('x')\n*/ import('left-pad');\n")], ['left-pad']);
});

test('a regular expression holding quotes or slashes does not derail the reader', () => {
  const code =
    "#!/usr/bin/env node\nconst q = /['\"`]|\\/\\//u;\nconst half = 4 / 2;\nimport('left-pad');\n";
  assert.deepEqual([...imported(code)], ['left-pad']);
});

test('JSX text is prose and a JSX expression is code', () => {
  const view =
    "export const V = () => <p title=\"require('a')\">Don't require('b') {require('c')}<br /></p>;\n";
  assert.deepEqual([...imported(view, 'view.jsx')], ['c']);
});

test('code this reader cannot read exactly is refused, naming the file', () => {
  for (const code of [
    "const s = 'unterminated\nimport('left-pad');\n",
    // A raw CR ends a string, and any line terminator ends a regular expression.
    "const s = 'one\rtwo';\n",
    'const r = /one\rtwo/;\n',
    'const r = /one\\\u2028two/;\n',
    "const t = `never closed ${require('x')}\n",
    "const pad = require('left\\x2dpad');\n",
    "const pad = requ\\u0069re('left-pad');\n",
    '/* never closed\n',
    // The outer brackets close exactly at the end of the file, as they do in
    // a file Node will run.
    ...['(', '{', '[', '})'].map((suffix) => `import 'left-pad';\nconst value = ${suffix}\n`),
  ])
    assert.throws(() => imported(code, 'src/a.mjs'), /^Error: src\/a\.mjs:\d+: /u, code);
});

test('a static import or re-export after another statement is read where it stands', () => {
  for (const [code, name] of [
    ["const value = 1; import pad from 'left-pad'; void pad;\n", 'left-pad'],
    ["const value = 1; import 'side-effect';\n", 'side-effect'],
    ["const value = 1; export { v } from 'pkg-v';\n", 'pkg-v'],
    ["function f() {} export * as all from 'pkg-all';\n", 'pkg-all'],
    ["const a = 1;import from from 'pkg-from';\n", 'pkg-from'],
  ])
    assert.deepEqual([...imported(code)], [name], code);
});

test('a dynamic import or require reads its first argument, whatever follows it', () => {
  assert.deepEqual([...imported("await import('left-pad', {});\n")], ['left-pad']);
  assert.deepEqual([...imported("await import('x', { with: { type: 'json' } });\n")], ['x']);
  assert.deepEqual([...imported("const y = require('y',);\n")], ['y']);
  assert.deepEqual([...imported('const u = import.meta.url;\n')], []);
  // A value worked out at run time names nothing; a name put together from strings refuses.
  assert.deepEqual([...imported('await import(pathToFileURL(path).href);\n')], []);
});

test('an import or require token the reader cannot consume is refused, naming the line', () => {
  for (const code of [
    "const left = 1;\nawait import('left' + '-pad');\n",
    'const left = 1;\nawait import(`left-${pad}`);\n',
    'const left = 1;\nconst load = require;\n',
    "const left = 1;\nimport pad = require('left-pad');\n",
    "const left = 1;\nconst where = require.resolve('left-pad');\n",
    "const left = 1;\nexport default { import: 'left-pad' };\n",
  ])
    assert.throws(() => imported(code, 'src/a.mjs'), /^Error: src\/a\.mjs:2: /u, code);
});

test('a slash after a control head is a regular expression, after a call it divides', () => {
  for (const code of [
    "if (true) /require('left-pad')/.test('example');\n",
    "while (false) /import('left-pad')/.exec('x');\n",
    "for (;;) /require('left-pad')/u.test('x');\n",
    "if (f(a)) /require('left-pad')/.test('x');\n",
    "export default /require('left-pad')/u;\n",
    "if          (true) /require('left-pad')/.test('x');\n",
    "for   await   (const x of y) /require('left-pad')/.test(x);\n",
    "const éimport = (x) => x; éimport('left-pad');\n",
  ])
    assert.deepEqual([...imported(code)], [], code);
  for (const code of [
    "const h = f(a) / 2 / 1; import('left-pad');\n",
    "const h = a . if (x) / 2 / 1; import('left-pad');\n",
    "const h = x.return / 2 / 1; import('left-pad');\n",
  ])
    assert.deepEqual([...imported(code)], ['left-pad'], code);
});

test('a slash either reading could explain is refused, not guessed', () => {
  for (const code of [
    "const o = {} / 2; import('left-pad'); /\n",
    "let i = 0; i++ / 2; import('left-pad'); /\n",
    "for (const x of /require('left-pad')/g) void x;\n",
  ])
    assert.throws(() => imported(code, 'src/a.mjs'), /^Error: src\/a\.mjs:1: /u, code);
});

test('require prose in a shell, Python or YAML source is not use', () => {
  const workspaces = [
    { path: 'package.json', dir: '', manifest: { dependencies: { 'left-pad': '1.0.0' } } },
  ];
  for (const [path, body] of [
    ['scripts/message.sh', `echo "require('left-pad')"\n`],
    ['scripts/message.sh', `node -e "import('left-pad')"\n`],
    ['scripts/message.py', `print("import('left-pad')")\n`],
    ['config/a.yml', `run: node -e "require('left-pad')"\n`],
  ]) {
    assert.deepEqual([...imported(body, path)], [], path);
    assert.equal(depsFindings({ workspaces, sources: [{ path, text: body }] }).length, 1, path);
  }
});

test('a resolving key counts only in key position, never inside a string', () => {
  const workspaces = [
    { path: 'package.json', dir: '', manifest: { devDependencies: { 'left-pad': '1.0.0' } } },
  ];
  const count = (path, body) =>
    depsFindings({ workspaces, sources: [], configs: [{ path, text: body }] }).length;
  for (const [path, body] of [
    ['tool.config.js', 'export const example = "extends left-pad";\n'],
    ['tool.config.js', 'export const example = "extends: left-pad";\n'],
    ['tool.config.js', 'export const m = `\nplugins: left-pad\n`;\n'],
    ['.toolrc.json', '{ "name": "extends: left-pad" }\n'],
    ['.toolrc.yml', 'name: "a # b, extends: left-pad"\n'],
    ['.toolrc.yml', "name: 'plugins: left-pad'\n"],
    ['tool.config.js', "export default { plugins: ['other'], name: 'left-pad' };\n"],
  ])
    assert.equal(count(path, body), 1, body);
  for (const [path, body] of [
    ['.toolrc.json', '{ "extends": "left-pad" }\n'],
    ['tool.config.js', "export default {\n  plugins: [\n    'left-pad',\n  ],\n};\n"],
    ['.toolrc.yml', 'extends: left-pad\n'],
    ['.toolrc.yml', '- plugins: [left-pad, other]\n'],
  ])
    assert.equal(count(path, body), 0, body);
});

test('an inline block comment does not hide the import after it', () => {
  assert.deepEqual([...imported("/* note */ import 'left-pad';\n")], ['left-pad']);
  assert.deepEqual([...imported("/* one\n two */ import 'left-pad';\n")], ['left-pad']);
});

test('a resolving key in a comment is not use', () => {
  const workspaces = [
    { path: 'package.json', dir: '', manifest: { devDependencies: { 'x-config': '1.0.0' } } },
  ];
  for (const [path, config] of [
    ['tool.config.js', '// extends: x-config\nexport default {};\n'],
    ['tool.config.js', "/* plugins: ['x-config'] */\nexport default {};\n"],
    ['tool.config.js', "export default { parser: 'other' }; // extends: x-config\n"],
    ['.toolrc.yml', '# extends: x-config\nparser: other\n'],
  ])
    assert.equal(
      depsFindings({ workspaces, sources: [], configs: [{ path, text: config }] }).length,
      1,
      config,
    );
});

test('a bare Node builtin names no package', () => {
  for (const specifier of ['fs', 'fs/promises', 'node:fs', 'child_process'])
    assert.equal(packageOf(specifier), undefined, specifier);
  assert.equal(packageOf('left-pad'), 'left-pad');
});

test('an allow entry without a reason clears nothing, and is itself refused', () => {
  for (const reason of [null, '', '  ', 3]) {
    const found = depsFindings({ ...tree('unused'), allow: { 'left-pad': reason } });
    assert.ok(
      found.some((finding) => /left-pad is declared/u.test(finding)),
      String(reason),
    );
    assert.ok(
      found.includes('scripts/deps-allow.json: left-pad has no reason, so it allows nothing'),
      String(reason),
    );
  }
});

// --- use is a command position, not any word on the line -------------------

/** One workflow whose steps are `lines`, as the configs a dependency check reads. */
const workflowConfig = (...lines) => [
  { path: '.github/workflows/ci.yml', text: ['jobs:', '  a:', '    steps:', ...lines].join('\n') },
];

test('a name is used when a command runs it, and not when a key carries it', () => {
  const workspaces = [
    { path: 'package.json', dir: '', manifest: { devDependencies: { gitleaks: '1.0.0' } } },
  ];
  for (const line of ['      cache: gitleaks', '      uses: actions/gitleaks@v5'])
    assert.equal(
      depsFindings({ workspaces, sources: [], configs: workflowConfig(line) }).length,
      1,
    );
  const run = workflowConfig('      - run: gitleaks detect --source .');
  assert.deepEqual(depsFindings({ workspaces, sources: [], configs: run }), []);
  assert.deepEqual([...commandNames('        prettier --check .')], ['prettier']);
  assert.deepEqual([...commandNames('npx --no -- commitlint --edit "$1"')], ['commitlint']);
  assert.deepEqual([...commandNames('pnpm exec tsc -p tsconfig.json')], ['tsc']);
  assert.deepEqual([...commandNames('pnpm dlx gitleaks detect')], ['gitleaks']);
  assert.deepEqual([...commandNames('pnpm run lint')], []);
  assert.deepEqual([...commandNames('FOO=1 oxlint')], ['oxlint']);
  assert.deepEqual([...commandNames('./node_modules/.bin/vitest run')], ['vitest']);
  // An option that may take a value leaves the command unknown, so nothing counts.
  for (const script of [
    'npx --offline --cache left-pad node -e x',
    'pnpm --dir left-pad exec x',
    'pnpm dlx --package left-pad x',
  ])
    assert.deepEqual([...commandNames(script)], [], script);
});

test('a separator inside quotes does not start a command', () => {
  assert.deepEqual([...commandNames('echo "example; left-pad"')], ['echo']);
  assert.deepEqual(
    [...commandNames("echo 'a && left-pad' && prettier --check .")],
    ['echo', 'prettier'],
  );
});

test('a shell comment runs nothing, wherever a word starts it', () => {
  assert.deepEqual([...commandNames('echo ok # example; left-pad')], ['echo']);
  assert.deepEqual([...commandNames('# left-pad\nprettier --check .')], ['prettier']);
  assert.deepEqual([...commandNames('echo a#b; left-pad')], ['echo', 'left-pad']);
});

test('a command substitution runs its first word, in quotes or not', () => {
  assert.deepEqual([...commandNames('echo "$(proof-tool)"')].toSorted(), ['echo', 'proof-tool']);
  assert.deepEqual([...commandNames('echo $(date -u) left-pad')].toSorted(), ['date', 'echo']);
  assert.deepEqual([...commandNames('X="${A:-"a b"}" tsc')], ['tsc']);
});

test('the compound shapes the hooks use are read, their reserved words as grammar', () => {
  for (const [script, names] of [
    ['if true; then proof-tool; fi', ['true', 'proof-tool']],
    ['if ! a; then b; elif c; then d; else e; fi', ['a', 'b', 'c', 'd', 'e']],
    ['while read -r a; do proof-tool; done < list', ['read', 'proof-tool']],
    ['until a; do b; done', ['a', 'b']],
    ['for x in left-pad other; do echo "$x"; done', ['echo']],
    ['case "$x" in\n  a|left-pad) proof-tool ;;\n  (*) echo ;;\nesac', ['proof-tool', 'echo']],
    ['case "$x" in *) proof-tool\nesac', ['proof-tool']],
    ['f() { proof-tool "$@"; }\nf', ['proof-tool', 'f']],
    ['{ proof-tool; }', ['proof-tool']],
    ['>/dev/null proof-tool 2>&1', ['proof-tool']],
    ['echo x > left-pad', ['echo']],
    ['echo "done" if', ['echo']],
  ])
    assert.deepEqual([...commandNames(script)], names, script);
});

const hook = (name) => readFileSync(resolve(import.meta.dirname, '../../.husky', name), 'utf8');

test('the repository hooks read, and commit-msg runs commitlint', () => {
  for (const name of ['commit-msg', 'pre-commit', 'pre-push']) commandNames(hook(name));
  assert.ok(commandNames(hook('commit-msg')).has('commitlint'));
});

test('a reserved word or shape outside the short grammar is refused', () => {
  for (const script of [
    '"if" true; then left-pad; fi',
    'time left-pad',
    'function f { left-pad; }',
    'select x in a; do left-pad; done',
    '[[ -n x ]] && left-pad',
    'coproc left-pad',
    '( left-pad )',
    'left-pad &',
    'left-pad &> log',
    'fi left-pad',
    'esac',
    'case x in a) left-pad ;;',
    'echo "$(case x in a) left-pad ;; esac)"',
    'for x in a && left-pad; do echo; done',
    'echo >',
    'in left-pad',
    'then left-pad',
    'if\u00A0true; then left-pad; fi',
    'if a; then b; else c; elif d; then left-pad; fi',
    'while a; do b; done; done',
    '{ left-pad; }}',
    // A for name is a plain unquoted name; dash rejects these, bash only when run.
    'for 1 in x; do left-pad; done',
    'for x-y in x; do left-pad; done',
    'for "x" in y; do left-pad; done',
    '1() { left-pad; }',
    'f() left-pad',
  ])
    assert.throws(() => commandNames(script), /cannot read/u, script);
});

test('only a space or a tab separates shell words, as in a real shell', () => {
  for (const space of ['\u00A0', '\u2003', '\r'])
    assert.deepEqual([...commandNames(`left-pad${space}x`)], [`left-pad${space}x`]);
});

test('a space that is not a plain one is refused in a settings file or a workflow', () => {
  const workspaces = [
    { path: 'package.json', dir: '', manifest: { devDependencies: { 'left-pad': '1.0.0' } } },
  ];
  for (const [path, body] of [
    ['.toolrc.yml', 'name: x\nextends:\u00A0left-pad\n'],
    ['.github/workflows/ci.yml', 'jobs:\n\u00A0\u00A0- run: left-pad\n'],
  ])
    assert.throws(
      () => depsFindings({ workspaces, sources: [], configs: [{ path, text: body }] }),
      new RegExp(`^Error: ${path.replaceAll('.', '\\.')}:.*2`, 'u'),
      body,
    );
});

test('shell this reader cannot read exactly is refused', () => {
  for (const script of [
    'echo `left-pad`',
    'echo "`left-pad`"',
    'echo "$( (left-pad) )"',
    "echo 'unterminated",
    'cat <<EOF\nleft-pad\nEOF',
    'echo $((1 + 2))',
  ])
    assert.throws(() => commandNames(script), /cannot read/u, script);
});

test('a workflow run block is one shell script, read whole', () => {
  const workspaces = [
    { path: 'package.json', dir: '', manifest: { devDependencies: { prettier: '3.9.6' } } },
  ];
  const run = (lines) => workflowConfig(...lines);
  const quoted = [
    '      - run: |',
    "          node -e 'x;",
    "            prettier'",
    '          echo',
  ];
  assert.equal(depsFindings({ workspaces, sources: [], configs: run(quoted) }).length, 1);
  const real = ['      - run: |', '          echo start', '          prettier --check .'];
  assert.deepEqual(depsFindings({ workspaces, sources: [], configs: run(real) }), []);
  // Only defaults.run is a mapping of settings; a step's run is shell or refused.
  for (const lines of [
    ['      - run: echo `x`'],
    ['      - run: {}'],
    ['      - run:', '          command: echo ok'],
  ])
    assert.throws(
      () => depsFindings({ workspaces, sources: [], configs: run(lines) }),
      /^Error: \.github\/workflows\/ci\.yml:/u,
      lines.join('\n'),
    );
  const settings = ['defaults:', '  run:', '    shell: bash', 'jobs:', '  a:', '    defaults:'];
  const runs = [
    ...settings,
    '      run:',
    '        shell: bash',
    '    steps:',
    '      - run: prettier',
  ];
  const configs = [{ path: '.github/workflows/ci.yml', text: runs.join('\n') }];
  assert.deepEqual(depsFindings({ workspaces, sources: [], configs }), []);
});

test('a declared package named after a workflow key is still refused', () => {
  const workspaces = [
    {
      path: 'package.json',
      dir: '',
      manifest: { scripts: { test: 'vitest run' }, devDependencies: { cache: '3.0.0' } },
    },
  ];
  const configs = workflowConfig(
    '      - uses: actions/setup-node@v5',
    '        with:',
    '          cache: pnpm',
  );
  const found = depsFindings({ workspaces, sources: [], configs });
  assert.equal(found.length, 1);
  assert.match(found[0], /cache is declared and nothing imports it/u);
});

test('a bin a workflow actually runs counts as use', () => {
  const workspaces = [
    { path: 'package.json', dir: '', manifest: { devDependencies: { prettier: '3.9.6' } } },
  ];
  const configs = workflowConfig('      - run: prettier --check .');
  assert.deepEqual(depsFindings({ workspaces, sources: [], configs }), []);
});

// --- the lockfile is read, and answers for itself --------------------------

const LOCK = [
  "lockfileVersion: '9.0'",
  '',
  'importers:',
  '',
  '  .:',
  '    configDependencies: {}',
  '    devDependencies:',
  "      '@scope/thing':",
  '        specifier: 1.0.0',
  '        version: 1.0.0',
  '      prettier:',
  '        specifier: 3.9.6',
  '        version: 3.9.6',
  '',
  'packages:',
  '',
  '  prettier@3.9.6:',
  '    resolution: {integrity: sha512-deadbeef}',
  '',
].join('\n');

const lockWorkspaces = (declared) => [
  { path: 'package.json', dir: '', manifest: { devDependencies: declared } },
];
const DECLARED = { '@scope/thing': '1.0.0', prettier: '3.9.6' };

test('the lockfile importers are read, quoted names and all', () => {
  const importers = lockImporters(LOCK);
  assert.deepEqual([...importers.keys()], ['.']);
  assert.deepEqual(
    [...importers.get('.').get('devDependencies').entries()],
    [
      ['@scope/thing', '1.0.0'],
      ['prettier', '3.9.6'],
    ],
  );
});

test('a lockfile that records what the manifests declare passes', () => {
  assert.deepEqual(lockfileFindings(LOCK, lockWorkspaces(DECLARED)), []);
});

test('no lockfile at all is refused', () => {
  assert.deepEqual(lockfileFindings(undefined, lockWorkspaces(DECLARED)), [
    'pnpm-lock.yaml is not in the repository',
  ]);
});

test('a specifier the lockfile no longer matches is refused, naming the package', () => {
  const found = lockfileFindings(LOCK, lockWorkspaces({ ...DECLARED, prettier: '3.9.5' }));
  assert.deepEqual(found, [
    'pnpm-lock.yaml records another specifier for prettier in . than package.json declares',
  ]);
});

test('a package declared but not locked, and one locked but not declared, are both refused', () => {
  const added = lockfileFindings(LOCK, lockWorkspaces({ ...DECLARED, oxlint: '1.81.0' }));
  assert.deepEqual(added, ['pnpm-lock.yaml records no devDependencies oxlint for .']);
  const removed = lockfileFindings(LOCK, lockWorkspaces({ prettier: '3.9.6' }));
  assert.equal(removed.length, 1);
  assert.match(
    removed[0],
    /records devDependencies @scope\/thing for \., which package\.json does not declare/u,
  );
});

test('a workspace with no importer, and an importer with no workspace, are both refused', () => {
  const missing = lockfileFindings(LOCK, [
    ...lockWorkspaces(DECLARED),
    { path: 'packages/ui/package.json', dir: 'packages/ui', manifest: {} },
  ]);
  assert.deepEqual(missing, [
    'pnpm-lock.yaml has no importer for packages/ui, which packages/ui/package.json declares',
  ]);
  const stray = lockfileFindings(LOCK, []);
  assert.deepEqual(stray, ['pnpm-lock.yaml has an importer for ., which has no package.json']);
});

test('a lockfile that is not well-formed YAML is refused, naming the line', () => {
  const found = lockfileFindings(`${LOCK}settings: [unterminated\n`, lockWorkspaces(DECLARED));
  assert.equal(found.length, 1);
  assert.match(found[0], /^pnpm-lock\.yaml line 19: /u);
});

test('a flow value pnpm would not write is refused, naming the line', () => {
  for (const tail of [
    'settings: [x}',
    'settings: {]',
    'settings: {x: 1, x: 2}',
    'settings: {a: {b: c}}',
    'settings: [a, [b]]',
    'settings: [a,]',
  ])
    assert.match(
      lockfileFindings(`${LOCK}${tail}\n`, lockWorkspaces(DECLARED))[0] ?? '',
      /^pnpm-lock\.yaml line 19: /u,
      tail,
    );
});

test('a tab anywhere in a lockfile line is refused', () => {
  for (const lock of [LOCK.replace('  .:', '\t\t.:'), `${LOCK}settings:\n\t\tfoo: bar\n`])
    assert.match(lockfileFindings(lock, lockWorkspaces(DECLARED))[0] ?? '', /tab/u);
});

test('a space that is not a plain one is refused wherever it is on a lockfile line', () => {
  for (const space of ['\u00A0', '\u2003', '\u3000', '\u200A', '\uFEFF', '\v'])
    for (const lock of [
      `lockfileVersion: '9.0'\nimporters:\n${space}${space}.: {}\n`,
      `lockfileVersion: '9.0'\nimporters:\n ${space}.: {}\n`,
      `lockfileVersion: '9.0'\nimporters:\n  .:${space}{}\n`,
    ])
      assert.match(
        lockfileFindings(lock, lockWorkspaces({}))[0] ?? '',
        /^pnpm-lock\.yaml line 3: /u,
      );
});

test('a lockfile refusal names the line and the rule, never the text', () => {
  const marker = ['LOCK', 'MARKER'].join('_');
  for (const tail of [
    `settings: [${marker}}`,
    `settings: {${marker}: 1, ${marker}: 2}`,
    `${marker}: "a\\b"`,
  ])
    for (const finding of lockfileFindings(`${LOCK}${tail}\n`, lockWorkspaces(DECLARED)))
      assert.equal(finding.includes(marker), false, 'a lockfile refusal echoed its text');
});

test('the lockfile this repository carries is read', () => {
  const own = readFileSync(resolve(import.meta.dirname, '../../pnpm-lock.yaml'), 'utf8');
  assert.ok(lockImporters(own).has('.'));
});

test('an importer recorded twice in one document is refused', () => {
  const twice = [
    "lockfileVersion: '9.0'",
    'importers:',
    '  .:',
    '    devDependencies:',
    '      prettier:',
    '        specifier: 3.9.5',
    '        version: 3.9.5',
    '  .:',
    '    devDependencies:',
    '      prettier:',
    '        specifier: 3.9.6',
    '        version: 3.9.6',
  ].join('\n');
  assert.deepEqual(lockfileFindings(twice, lockWorkspaces({ prettier: '3.9.6' })), [
    'pnpm-lock.yaml line 8: names a key its mapping already has, which YAML does not allow.',
  ]);
});

test('a lockfile of two documents is read as one, the way pnpm writes it', () => {
  const two = `---\nimporters:\n  .:\n    configDependencies: {}\n\n---\n${LOCK}`;
  assert.deepEqual(lockfileFindings(two, lockWorkspaces(DECLARED)), []);
});

// --- the CLI's exit code is the gate ----------------------------------------

const cli = resolve(import.meta.dirname, '../../scripts/deps-check.mjs');

/**
 * The CLI's result over a throwaway repository holding `files`, staged, with
 * `working` then written over them on disk and left unstaged.
 */
function repository(t, files, working = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), 'deps-cases-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const all = {
    'package.json': '{}',
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\nimporters:\n  .: {}\n",
    'scripts/deps-allow.json': '{"packages":{}}',
    ...files,
  };
  // A null body is a file the tree does not have.
  for (const [path, body] of Object.entries(all).filter(([, content]) => content !== null)) {
    mkdirSync(dirname(resolve(dir, path)), { recursive: true });
    writeFileSync(resolve(dir, path), body);
  }
  // The CLI reads the lockfile out of git's index, so the tree is staged.
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
  ])
    spawnSync('git', ['-C', dir, ...args]);
  for (const [path, body] of Object.entries(working)) writeFileSync(resolve(dir, path), body);
  return spawnSync(process.execPath, [cli, dir], { encoding: 'utf8', timeout: 20_000 });
}

test('the CLI exits non-zero on a finding and zero on a clean tree', (t) => {
  assert.equal(repository(t, {}).status, 0);
  const stray = repository(t, { 'index.mjs': "import pad from 'left-pad';\n" });
  assert.equal(stray.status, 1, stray.stdout);
  assert.match(stray.stderr, /index\.mjs: imports left-pad/u);
});

test('a .jsx file is source, and an import in it is read', (t) => {
  const result = repository(t, {
    'view.jsx': "import pad from 'left-pad';\nexport const View = () => <p>{pad('x', 3)}</p>;\n",
  });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /view\.jsx: imports left-pad/u);
});

test('the CLI refuses a staged lockfile with no importer for a workspace, however disk reads', (t) => {
  // pnpm repairs the working copy, so a repaired one on disk answers nothing.
  const result = repository(
    t,
    { 'pnpm-lock.yaml': "lockfileVersion: '9.0'\nimporters:\n  other: {}\n" },
    { 'pnpm-lock.yaml': "lockfileVersion: '9.0'\nimporters:\n  .: {}\n" },
  );
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /has no importer for \./u);
  assert.doesNotMatch(result.stderr, /imports|is declared/u);
});

test('the CLI exits 2 on a source it cannot read, naming the file', (t) => {
  const result = repository(t, { 'src/a.mjs': "const s = 'unterminated\n" });
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stderr, /src\/a\.mjs:1: /u);
});

test('the CLI exits 1 on a declared package nothing uses, and on nothing else', (t) => {
  const result = repository(t, {
    'package.json': '{"dependencies":{"left-pad":"1.0.0"}}',
    'pnpm-lock.yaml':
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      left-pad:\n        specifier: 1.0.0\n        version: 1.0.0\n",
  });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /left-pad is declared and nothing imports it/u);
  assert.doesNotMatch(result.stderr, /pnpm-lock|imports left-pad/u);
});

test('a refusal names the file and line, and never echoes what it refused', (t) => {
  const marker = ['PLANTED', 'CREDENTIAL', 'MARKER'].join('_');
  for (const [path, body] of [
    ['src/a.mjs', `import('https://registry.invalid/x?token=${marker}\\x2f');\n`],
    ['src/a.mjs', `const a = require; // ${marker}\n`],
    ['src/a.mjs', `import('${marker}' + '');\n`],
    ['package.json', JSON.stringify({ scripts: { leak: `echo ${marker} & ${marker}` } })],
  ]) {
    const result = repository(t, { [path]: body });
    assert.equal(result.status, 2, path);
    assert.match(result.stderr, path === 'package.json' ? /scripts\.leak/u : /src\/a\.mjs:1: /u);
    assert.equal(
      `${result.stdout}${result.stderr}`.includes(marker),
      false,
      'a marker reached the output',
    );
  }
});

// --- one exclusion list, and it matches whole directory names --------------

test('a skip is a whole directory name, never a substring of one', () => {
  for (const path of [
    'dist/x.mjs',
    'a/dist/x.mjs',
    'node_modules/a/b.js',
    'a/node_modules/b.js',
    'tests/ci/fixtures/planted.mjs',
    'tests/x/fixtures/y/planted.mjs',
    'pnpm-lock.yaml',
    '.claude/skills/wizard/template.sh',
    '.codex/tools.md',
  ])
    assert.equal(excluded(path), true, path);
  for (const path of [
    'redist/x.mjs',
    'predist/x.mjs',
    'a/redist/x.mjs',
    'scripts/dist.mjs',
    'fixtures/x.mjs',
    'tests/ci/deps-check-cases.mjs',
    'scripts/node_modules.mjs',
  ])
    assert.equal(excluded(path), false, path);
});

const scriptSource = (name) =>
  readFileSync(resolve(import.meta.dirname, '../../scripts', name), 'utf8');

test('both gates read the tree from the one module, and neither keeps its own list', () => {
  const source = scriptSource;
  for (const name of ['deps-check.mjs', 'dup-check.mjs']) {
    assert.match(source(name), /from '\.\/tree-files\.mjs'/u, name);
    assert.doesNotMatch(source(name), /^const excluded =/mu, name);
    assert.doesNotMatch(source(name), /ls-files/u, name);
  }
});

// --- Sol CF-06-FIX3 and CF-08-FIX3 -------------------------------------------

const UNUSED = {
  'package.json': '{"dependencies":{"left-pad":"1.0.0"}}',
  'pnpm-lock.yaml':
    "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      left-pad:\n        specifier: 1.0.0\n        version: 1.0.0\n",
};

test('every JavaScript line terminator ends a line comment; in JSON settings one readers disagree on refuses', (t) => {
  for (const end of ['\r', '\u2028', '\u2029']) {
    const result = repository(t, { 'index.mjs': `// example${end}import 'left-pad';\n` });
    assert.equal(result.status, 1, JSON.stringify(end));
    assert.match(result.stderr, /index\.mjs: imports left-pad/u);
  }
  const refused = (path, body) => {
    const result = repository(t, { ...UNUSED, [path]: body });
    assert.equal(result.status, 2, JSON.stringify(body));
    assert.ok(result.stderr.startsWith(`deps: ${path}: holds a line separator or a lone CR,`));
  };
  // Security re-bind of b671cae, finding 2: JSON5 (Babel) and TypeScript end
  // a line comment at U+2028 and U+2029, so the key after one is live there.
  for (const end of ['\u2028', '\u2029']) {
    refused('.babelrc.json', `{\n  "presets": ["left-pad"] // note${end}, "presets": []\n}\n`);
    refused(
      'tsconfig.json',
      `{\n  "extends": "left-pad" // n${end}, "extends": "./base.json"\n}\n`,
    );
  }
  // Finding 3: strip-json-comments (legacy eslintrc) reads a comment on past
  // a lone CR, so the key after one is commented out there. CRLF still reads.
  refused('.eslintrc.json', '{\n  "root": true // note\r, "plugins": ["left-pad"]\n}\n');
  const crlf = '{\r\n  "extends": "left-pad" // c\r\n}\r\n';
  const read = repository(t, { ...UNUSED, 'tsconfig.json': crlf });
  assert.equal(read.status, 0, read.stderr);
});

test('a regular expression after a division is prose, not an import', (t) => {
  const source = "const value = 12 / /require('left-pad')/.source.length; console.log(value);\n";
  const result = repository(t, { ...UNUSED, 'entry.mjs': source });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /left-pad is declared and nothing/u);
});

test('YAML block scalar prose in a settings file resolves nothing', (t) => {
  const result = repository(t, {
    ...UNUSED,
    '.toolrc.yml': 'description: |\n  extends: left-pad\n',
  });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /left-pad is declared and nothing/u);
});

test('a YAML block list under a resolving key is read', (t) => {
  const result = repository(t, { ...UNUSED, '.toolrc.yml': 'extends:\n  - left-pad\n' });
  assert.equal(result.status, 0, result.stderr);
});

test('a command list the shell would reject is refused', (t) => {
  for (const script of ['left-pad &&', 'if true; then; fi', 'for x left-pad; do echo; done']) {
    assert.notEqual(spawnSync('sh', ['-n', '-c', script]).status, 0, script);
    const result = repository(t, {
      'package.json': JSON.stringify({ scripts: { check: script } }),
    });
    assert.equal(result.status, 2, script);
    assert.match(result.stderr, /scripts\.check/u);
  }
});

test('a bin path printed as an argument does not run that package', (t) => {
  for (const script of ['echo node_modules/.bin/left-pad', "echo 'node_modules/.bin/left-pad'"]) {
    const manifest = { dependencies: { 'left-pad': '1.0.0' }, scripts: { message: script } };
    const result = repository(t, { ...UNUSED, 'package.json': JSON.stringify(manifest) });
    assert.equal(result.status, 1, script);
    assert.match(result.stderr, /left-pad is declared and nothing/u);
  }
});

test('a control character YAML forbids makes the lockfile no evidence', (t) => {
  for (const control of ['\u0000', '\u0001', '\u0007']) {
    const lock = `lockfileVersion: '9.0'\nimporters:\n  .: {}\nsettings: a${control}b\n`;
    const result = repository(t, { 'pnpm-lock.yaml': lock });
    assert.equal(result.status, 1, JSON.stringify(control));
    assert.match(result.stderr, /pnpm-lock\.yaml line 4: /u);
  }
});

test('a workflow key the pin check refuses is refused here too, through one reader', (t) => {
  const workflow = `name: proof\non: push\njobs:\n  proof:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${'a'.repeat(40)}\n      - "run": left-pad\n`;
  const result = repository(t, { ...UNUSED, '.github/workflows/proof.yml': workflow });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /proof\.yml:8: /u);
  for (const name of ['deps-check.mjs', 'pins-check.mjs'])
    assert.match(scriptSource(name), /from '\.\/yaml-subset\.mjs'/u, name);
});

test('a lockfile mismatch never echoes the declared specifier', (t) => {
  const marker = ['DEPS', 'CREDENTIAL', 'MARKER'].join('_');
  const manifest = {
    dependencies: { 'left-pad': `https://user:${marker}@registry.invalid/pkg.tgz` },
  };
  const result = repository(t, {
    ...UNUSED,
    'package.json': JSON.stringify(manifest),
    'index.mjs': "import 'left-pad';\n",
  });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /pnpm-lock\.yaml records .*left-pad/u);
  assert.equal(
    `${result.stdout}${result.stderr}`.includes(marker),
    false,
    'a marker reached the output',
  );
});

// --- security review of 8590b7f: use is proved by a narrow grammar, or refused

test('an extensionless settings file is read by the YAML reader, block scalars and lists', (t) => {
  const prose = 'semi: false\noverrides: |\n  plugins: left-pad\n';
  const scalar = repository(t, { ...UNUSED, '.prettierrc': prose });
  assert.equal(scalar.status, 1, scalar.stdout);
  assert.match(scalar.stderr, /left-pad is declared and nothing/u);
  const list = repository(t, { ...UNUSED, '.prettierrc': 'plugins:\n  - left-pad\n' });
  assert.equal(list.status, 0, list.stderr);
});

test('a bin path inside a wrapper, or after any first word, runs nothing', (t) => {
  const manifest = {
    dependencies: { 'left-pad': '1.0.0' },
    scripts: { t: "sh -c 'echo ./node_modules/.bin/left-pad'" },
  };
  const result = repository(t, { ...UNUSED, 'package.json': JSON.stringify(manifest) });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /left-pad is declared and nothing/u);
  for (const script of [
    'node -e "1//node_modules/.bin/left-pad"',
    'bash -n node_modules/.bin/left-pad',
    'node node_modules/.bin/left-pad',
    'node_modules/.bin/x/left-pad',
  ])
    assert.equal(commandNames(script).has('left-pad'), false, script);
});

test('a ! that does not start a pipeline is refused, as the shell refuses it', () => {
  for (const script of ['true | ! left-pad', '! ! left-pad']) {
    assert.notEqual(spawnSync('sh', ['-n', '-c', script]).status, 0, script);
    assert.throws(() => commandNames(script), /cannot read/u, script);
  }
  assert.deepEqual([...commandNames('a || ! b')], ['a', 'b']);
});

test('a require read off an object, or made by createRequire, is refused', (t) => {
  for (const [path, source] of [
    ['b.cjs', "console.log(module.require('undeclared-pkg'));\n"],
    ['b.cjs', "console.log(process.mainModule.require('undeclared-pkg'));\n"],
    [
      'a.mjs',
      "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\nr('undeclared-pkg');\n",
    ],
  ]) {
    const result = repository(t, { [path]: source });
    assert.equal(result.status, 2, source);
    assert.match(result.stderr, new RegExp(`${path.replace('.', '\\.')}:1: `, 'u'));
  }
});

test('an HTML-like comment in JavaScript is refused, not read', (t) => {
  for (const source of [
    "x = 1 <!-- require('left-pad')\nconsole.log('ran')\n",
    "x = 1\n--> require('left-pad')\n",
  ]) {
    const result = repository(t, { ...UNUSED, 'a.cjs': source });
    assert.equal(result.status, 2, source);
    assert.match(result.stderr, /a\.cjs:\d+: /u);
  }
});

test('hostile input is read in linear time', (t) => {
  // Malformed JSON is refused, as fast.
  for (const [path, body, status] of [
    ['x.json', `{${'\n'.repeat(30_000)}x}`, 2],
    ['a.mjs', 'f();'.repeat(200_000), 0],
  ]) {
    const start = performance.now();
    const result = repository(t, { [path]: body });
    assert.equal(result.status, status, path);
    assert.ok(performance.now() - start < 3_000, path);
  }
  // Each regular expression is read to its own end, never on to the line's.
  const start = performance.now();
  assert.equal(imported('x=/a/;'.repeat(160_000), 'a.mjs').size, 0);
  assert.ok(performance.now() - start < 1_000, `${performance.now() - start} ms`);
});

test('a malformed manifest or allow-list is refused without echoing its text', (t) => {
  const marker = ['MANIFEST', 'CREDENTIAL', 'MARKER'].join('_');
  for (const [path, body] of [
    ['package.json', `{"devDependencies":{"left-pad":"git+https://u:${marker}@h.invalid/x.git",}}`],
    ['scripts/deps-allow.json', `{"packages":{"left-pad":"${marker}",}}`],
  ]) {
    const result = repository(t, { [path]: body });
    assert.equal(result.status, 2, path);
    assert.match(result.stderr, new RegExp(`^deps: ${path.replaceAll('.', '\\.')}: `, 'mu'));
    assert.equal(`${result.stdout}${result.stderr}`.includes(marker), false, path);
  }
  // A script that is not a string, or allowed packages that are not a
  // mapping, are refused: an array's items and indexes are no evidence.
  const zero =
    "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '0':\n        specifier: 1.0.0\n        version: 1.0.0\n";
  for (const [files, where] of [
    [
      {
        ...UNUSED,
        'package.json': '{"dependencies":{"left-pad":"1.0.0"},"scripts":{"check":["left-pad"]}}',
      },
      /^deps: package\.json scripts\.check: /mu,
    ],
    [
      {
        'package.json': '{"dependencies":{"0":"1.0.0"}}',
        'pnpm-lock.yaml': zero,
        'scripts/deps-allow.json': '{"packages":["tooling"]}',
      },
      /^deps: scripts\/deps-allow\.json: /mu,
    ],
    // A dependency block or specifier that is not a mapping of strings.
    ...[
      ['"ab"', '0 && 1', ['a', 'b']],
      ['["left-pad"]', '0', ['left-pad']],
      ['{"0":1}', '0', ['1']],
    ].map(([block, script, specifiers]) => [
      {
        'package.json': `{"dependencies":${block},"scripts":{"check":"${script}"}}`,
        'pnpm-lock.yaml': `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n${specifiers
          .map(
            (specifier, at) =>
              `      '${at}':\n        specifier: '${specifier}'\n        version: 1.0.0\n`,
          )
          .join('')}`,
      },
      /^deps: package\.json: dependencies /mu,
    ]),
    // An explicit null is not a mapping, and is never read as an empty one.
    ...['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].map(
      (field) => [{ 'package.json': `{"${field}":null}` }, /^deps: package\.json: /mu],
    ),
    [{ 'package.json': '{"scripts":null}' }, /^deps: package\.json scripts: /mu],
    [{ 'scripts/deps-allow.json': '{"packages":null}' }, /^deps: scripts\/deps-allow\.json: /mu],
  ]) {
    const result = repository(t, files);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, where);
  }
});

test('a lockfile name or importer is printed only when it is a package name', () => {
  const marker = ['LOCK', 'NAME', 'MARKER'].join('_');
  const lock = [
    "lockfileVersion: '9.0'",
    'importers:',
    '  .:',
    '    devDependencies:',
    `      'https://u:${marker}@h.invalid/x':`,
    '        specifier: 1.0.0',
    '        version: 1.0.0',
    `  '${marker}': {}`,
  ].join('\n');
  const found = lockfileFindings(lock, lockWorkspaces({}));
  assert.equal(found.length, 2);
  assert.equal(found.join('\n').includes(marker), false);
});

test('a dependency named after an Object member is read, not a crash', () => {
  const workspaces = [
    { path: 'package.json', dir: '', manifest: { dependencies: { constructor: '1' } } },
  ];
  assert.match(depsFindings({ workspaces, sources: [] }).join('\n'), /constructor is declared/u);
});

test('a dependency name cannot point the bin lookup outside node_modules', (t) => {
  const dir = mkdtempSync(resolve(tmpdir(), 'deps-bins-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(resolve(dir, 'outside'));
  writeFileSync(resolve(dir, 'outside/package.json'), '{"bin":"outside"}');
  assert.deepEqual(installedBins(dir, ['../outside']), {});
});

test('a lockfile with no lockfileVersion, or an entry with no version, is not one pnpm writes', () => {
  const lock = "importers:\n  .:\n    devDependencies:\n      left-pad:\n        specifier: '1'\n";
  const found = lockfileFindings(lock, lockWorkspaces({ 'left-pad': '1' }));
  assert.equal(found.length, 1);
  assert.match(found[0], /lockfileVersion/u);
  const unresolved = lockfileFindings(
    `lockfileVersion: '9.0'\n${lock}`,
    lockWorkspaces({ 'left-pad': '1' }),
  );
  assert.deepEqual(unresolved, [
    'pnpm-lock.yaml: . devDependencies left-pad has no single specifier and version',
  ]);
  for (const version of ["''", "' '"]) {
    const blank = `lockfileVersion: '9.0'\n${lock}        version: ${version}\n`;
    assert.deepEqual(lockfileFindings(blank, lockWorkspaces({ 'left-pad': '1' })), unresolved);
  }
});

// --- security re-review of b4c866a ------------------------------------------

test('a for loop, a function, a case pattern, a case arm or a ! the shell rejects is refused', () => {
  for (const script of [
    'case x in a b) left-pad ;; esac',
    'case x in a|) left-pad ;; esac',
    'case x in ((a) left-pad ;; esac',
    'case x in a) left-pad && ;; esac',
    'case x in a) left-pad | ;; esac',
    'case x in a) left-pad || ;; esac',
    'case x in a) b;; c) d && ;; esac',
    'case x in a) ! ;; esac',
    '!\nleft-pad',
    'case x "in" a) left-pad ;; esac',
    'for x in a; left-pad; do :; done',
    '>x f() { left-pad; }',
  ]) {
    assert.notEqual(spawnSync('sh', ['-n', '-c', script]).status, 0, script);
    assert.throws(() => commandNames(script), /cannot read/u, script);
  }
  assert.deepEqual([...commandNames('case x in a) ;; b) c\n;; esac')], ['c']);
});

test('a long shell command is read in linear time', () => {
  const start = performance.now();
  assert.deepEqual([...commandNames(`left-pad ${'a '.repeat(100_000)}`)], ['left-pad']);
  assert.ok(performance.now() - start < 1_000, `${performance.now() - start} ms`);
});

test('a require or createRequire read through a string-keyed member is refused', (t) => {
  for (const [path, source] of [
    ['b.cjs', "console.log(module['require']('undeclared-pkg'));\n"],
    ['c.cjs', "module['requ\\u0069re']('undeclared-pkg');\n"],
    [
      'a.mjs',
      "import * as m from 'node:module'; console.log(m[\"createRequire\"](import.meta.url)('undeclared-pkg'));\n",
    ],
  ]) {
    const result = repository(t, { [path]: source });
    assert.equal(result.status, 2, source);
    assert.match(result.stderr, new RegExp(`${path.replace('.', '\\.')}:1: `, 'u'));
  }
});

test('a manifest key, script name or allow key is printed only when it is a name', (t) => {
  const marker = ['MANIFEST', 'KEY', 'MARKER'].join('_');
  const keys = repository(t, {
    'package.json': JSON.stringify({
      devDependencies: { [`https://u:${marker}@h.invalid/x`]: '1' },
    }),
    'scripts/deps-allow.json': JSON.stringify({
      packages: { [`https://u:${marker}@h.invalid/y`]: '' },
    }),
  });
  // The marker is looked for first, so no failure message below can carry it.
  assert.equal(
    `${keys.stdout}${keys.stderr}`.includes(marker),
    false,
    'a marker reached the output',
  );
  assert.equal(keys.status, 1, keys.stdout);
  for (const finding of [/is declared/u, /records no devDependencies/u, /has no reason/u])
    assert.match(keys.stderr, finding);
  for (const name of [`https://u:${marker}@h.invalid`, 'deps:check']) {
    const script = repository(t, {
      'package.json': JSON.stringify({ scripts: { [name]: 'echo `x`' } }),
    });
    const shown = name === 'deps:check' ? 'deps:check' : 'a name this check will not print';
    assert.equal(`${script.stdout}${script.stderr}`.includes(marker), false, shown);
    assert.equal(script.status, 2, shown);
    assert.match(script.stderr, new RegExp(`scripts\\.${shown}: `, 'u'));
  }
});

test('nesting deeper than the readers go is refused with a reason, never a crash', (t) => {
  for (const [path, body] of [
    ['a.mjs', `x = \`${'${`'.repeat(10_000)}`],
    ['a.jsx', `x = ${'<a>{'.repeat(10_000)}`],
    ['package.json', JSON.stringify({ scripts: { t: `echo ${'$('.repeat(10_000)}` } })],
  ]) {
    const result = repository(t, { [path]: body });
    assert.equal(result.status, 2, path);
    assert.match(result.stderr, /^deps: .*nest/mu, path);
  }
});

test('JSON settings are read as JSON, with comments only where TypeScript reads them, and --> in a module is read', (t) => {
  for (const path of ['tsconfig.json', 'tsconfig.build.json', 'jsconfig.json']) {
    const jsonc = repository(t, {
      ...UNUSED,
      [path]: '{\n  /* c */ "extends": "left-pad" // c\n}\n',
    });
    assert.equal(jsonc.status, 0, jsonc.stderr);
  }
  // Security re-bind of b671cae, finding 1: Prettier reads .prettierrc as
  // YAML, where `/*` is a scalar and ` #` starts a comment, so a comment in
  // any JSON settings but TypeScript's refuses, and any comment marker in an
  // extensionless rc file.
  for (const [path, body, why] of [
    ['.eslintrc.json', '{\n  /* c */ "plugins": ["left-pad"] // c\n}\n', 'holds a comment'],
    [
      '.prettierrc',
      '{"semi": false, /* # */ "plugins": ["left-pad"]\n}\n',
      'holds a comment marker',
    ],
    ['.prettierrc', 'plugins: [left-pad] # c\n', 'holds a comment marker'],
  ]) {
    const result = repository(t, { ...UNUSED, [path]: body });
    assert.equal(result.status, 2, body);
    assert.ok(result.stderr.startsWith(`deps: ${path}: ${why},`), result.stderr);
  }
  // Malformed, or a repeated key whose last value names nothing.
  for (const body of [
    '{"plugins":["left-pad"]',
    '{"plugins":["left-pad"],}',
    '{"plugins":["left-pad"],"plugins":[]}',
    '{"plugins":["left-pad"]} /* never closed',
  ]) {
    const result = repository(t, { ...UNUSED, '.eslintrc.json': body });
    assert.equal(result.status, 2, body);
    assert.match(result.stderr, /^deps: \.eslintrc\.json: /mu, body);
  }
  const module = repository(t, { 'a.mjs': 'let x = 3;\nwhile (x-->0) x;\n' });
  assert.equal(module.status, 0, module.stderr);
});
