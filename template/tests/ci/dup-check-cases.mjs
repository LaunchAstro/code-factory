// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { dupFindings, normalise, windows } from '../../scripts/dup-check.mjs';

const fixtures = resolve(import.meta.dirname, 'fixtures/dup');
const cli = resolve(import.meta.dirname, '../../scripts/dup-check.mjs');
const fixture = (name) => ({
  path: `tests/ci/fixtures/dup/${name}`,
  text: readFileSync(resolve(fixtures, name), 'utf8'),
});

// Runs the real CLI over a temporary git repository holding `files` and an empty baseline.
const runCli = (t, files) => gitTree(t, { 'scripts/dup-baseline.json': EMPTY, ...files });

test('a planted twelve-line duplicate is refused, naming both locations', () => {
  const found = dupFindings({
    files: [fixture('original.mjs'), fixture('copy.mjs')],
    paths: [],
  });
  assert.equal(found.length, 1);
  assert.match(found[0], /fixtures\/dup\/copy\.mjs:6/u);
  assert.match(found[0], /fixtures\/dup\/original\.mjs:5/u);
});

test('reindenting the copy and recommenting it does not hide it', () => {
  const copy = fixture('copy.mjs');
  assert.notEqual(copy.text, fixture('original.mjs').text);
  assert.equal(dupFindings({ files: [fixture('original.mjs'), copy], paths: [] }).length, 1);
});

test('the same window twice in one file is refused', () => {
  const block = fixture('original.mjs');
  const twice = { path: 'twice.mjs', text: `${block.text}\n${block.text}` };
  assert.equal(dupFindings({ files: [twice], paths: [] }).length, 1);
});

test('a baselined window is not a new hit', () => {
  const files = [fixture('original.mjs'), fixture('copy.mjs')];
  const shared = [...windows(files)].find(([, locations]) => locations.length > 1);
  assert.ok(shared, 'the fixtures share a window');
  const [key, locations] = shared;
  const found = dupFindings({
    files,
    paths: [],
    baseline: { windows: { [key]: locations }, stems: [] },
  });
  assert.deepEqual(found, []);
});

test('a baselined window exempts the copies it records, not a third one', () => {
  const files = [fixture('original.mjs'), fixture('copy.mjs')];
  const [key, locations] = [...windows(files)].find(([, where]) => where.length > 1);
  const third = { path: 'scripts/third.mjs', text: fixture('original.mjs').text };
  const found = dupFindings({
    files: [...files, third],
    paths: [],
    baseline: { windows: { [key]: locations }, stems: [] },
  });
  assert.equal(found.length, 1);
  assert.match(found[0], /scripts\/third\.mjs/u);
});

test('a baselined stem exempts the pair it records, not a third extension', () => {
  const pair = ['scripts/receipt.mjs', 'scripts/receipt.sh'];
  const baseline = { windows: {}, stems: [pair] };
  assert.deepEqual(dupFindings({ files: [], paths: pair, baseline }), []);
  const found = dupFindings({ files: [], paths: [...pair, 'scripts/receipt.py'], baseline });
  assert.equal(found.length, 1);
  assert.match(found[0], /scripts\/receipt\.py/u);
});

test('a baselined pair does not exempt a new extension that replaces one of its files', () => {
  const baseline = { windows: {}, stems: [['scripts/receipt.sh', 'scripts/receipt.mjs']] };
  assert.deepEqual(
    dupFindings({ files: [], paths: ['scripts/receipt.mjs', 'scripts/receipt.sh'], baseline }),
    [],
  );
  const paths = ['scripts/receipt.mjs', 'scripts/receipt.py'];
  const found = dupFindings({ files: [], paths, baseline });
  assert.equal(found.length, 1);
  assert.match(found[0], /scripts\/receipt\.py/u);
});

/** The normalised code of `text` read as JavaScript, one entry per kept line. */
const codes = (text) => normalise(text, 'x.mjs').map((line) => line.code);

test('an inline block comment is dropped and the code after it is kept', () => {
  assert.deepEqual(codes("/* a */ import 'x';\n"), ["import 'x';"]);
  assert.deepEqual(codes('const a = /* b */ 1 /* c */ + 2;\n'), ['const a = 1 + 2;']);
  assert.deepEqual(codes('/* opens\n still a comment\n closes */ run();\nnext();\n'), [
    'run();',
    'next();',
  ]);
  assert.deepEqual(
    normalise('one();\n/* two\n */ three();\n', 'x.mjs').map((line) => line.line),
    [1, 3],
  );
});

test('comment markers inside a string are not comments', () => {
  assert.deepEqual(codes("const glob = 'src/**/*.ts';\nrun(glob);\n"), [
    "const glob = 'src/**/*.ts';",
    'run(glob);',
  ]);
  assert.deepEqual(codes('const a = "/*";\nrun(a); // */\n'), ['const a = "/*";', 'run(a); // */']);
});

test('comment markers inside a regular expression are not comments', () => {
  for (const regex of ['/[/*]/u', '/^\\/*/u', 'return /[*/]|[/*]/g']) {
    assert.deepEqual(codes(`${regex};\nrun();\n`), [`${regex};`, 'run();'], regex);
  }
});

test('a quote inside a regular expression does not hide a comment marker in a later string', () => {
  assert.deepEqual(codes("const q = /'/u; const g = '/*';\nrun();\n"), [
    "const q = /'/u; const g = '/*';",
    'run();',
  ]);
});

test('a division before a comment marker keeps the code, never drops it', () => {
  assert.deepEqual(codes('const half = total / 2; const r = /[/*]/u;\nrun();\n'), [
    'const half = total / 2; const r = /[/*]/u;',
    'run();',
  ]);
});

test('where only a parser could tell a regex from a division, the line is kept, not dropped', () => {
  for (const line of [
    '(a + b) / 2; const r = /[/*]/u;',
    'if (ok) /[/*]/u.test(s);',
    'i++ / 2; const r = /[/*]/u;',
  ])
    assert.deepEqual(codes(`${line}\nrun();\n`), [line, 'run();'], line);
  assert.deepEqual(codes('}\n/[/*]/u.test(s);\nrun();\n'), ['}', '/[/*]/u.test(s);', 'run();']);
});

test('a backtick inside a regular expression does not open a template', () => {
  assert.deepEqual(codes('const tick = /`/u;\nconst s = `a /* b`;\nrun();\n'), [
    'const tick = /`/u;',
    'const s = `a /* b`;',
    'run();',
  ]);
});

test('an interpolation inside a template is code, so its block comments are dropped', () => {
  for (const [source, code] of [
    ['const s = `${/* c */ x}`;', 'const s = `${ x}`;'],
    ['const s = `a ${ { b: 1 }[/* c */ "b"] } d`;', 'const s = `a ${ { b: 1 }[ "b"] } d`;'],
    ["const s = `${'}' /* c */ + x}`;", "const s = `${'}' + x}`;"],
    ['const s = `a ${`b ${/* c */ y} /* text */`} z`;', 'const s = `a ${`b ${ y} /* text */`} z`;'],
    ['const s = `a /* text ${x} */ b`;', 'const s = `a /* text ${x} */ b`;'],
  ])
    assert.deepEqual(codes(`${source}\nrun();\n`), [code, 'run();'], source);
});

test('a block comment after a division is still dropped', () => {
  assert.deepEqual(codes('const half = total / 2; /* note */ run();\n'), [
    'const half = total / 2; run();',
  ]);
});

// The CLI, run on a throwaway Git tree, because a gate is its exit code: the
// cases above prove the rules, these prove the command refuses with them.
const BLOCK = `${Array.from({ length: 12 }, (_, i) => `export const value${i} = ${i};`).join('\n')}\n`;

// Planted in the inputs the cases malform. The CLI may name a file, never quote one.
const MARKER = ['CF08', 'PLANTED', 'MARKER'].join('_');

/**
 * The CLI's result on a throwaway Git tree holding `files`. Every case runs it
 * here, so every case also proves the output: no line quotes an input, and no
 * line is anything but the gate's own `dup: ` report.
 */
const gitTree = (t, files) => {
  const root = mkdtempSync(resolve(tmpdir(), 'dup-cases-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q', root]);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), text);
  }
  const result = spawnSync(process.execPath, [cli, root], { encoding: 'utf8' });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(output.includes(MARKER), false, 'the CLI quoted an input');
  assert.ok(
    output.split('\n').every((line) => line === '' || line.startsWith('dup: ')),
    'the CLI printed a line that is not its own report',
  );
  return result;
};
const EMPTY = JSON.stringify({ windows: {}, stems: [] });

test('the CLI exits 1 on a planted duplicate and 0 on a clean tree', (t) => {
  const planted = gitTree(t, {
    'scripts/dup-baseline.json': EMPTY,
    'first.mjs': BLOCK,
    'second.mjs': BLOCK,
  });
  assert.equal(planted.status, 1, planted.stderr);
  assert.match(planted.stderr, /first\.mjs:1 repeats at second\.mjs:1/u);
  const clean = gitTree(t, { 'scripts/dup-baseline.json': EMPTY, 'first.mjs': BLOCK });
  assert.equal(clean.status, 0, clean.stderr);
});

test('the CLI exits 1 on a third copy of a baselined block', (t) => {
  const files = ['a.mjs', 'b.mjs'].map((path) => ({ path, text: BLOCK }));
  const [key, locations] = [...windows(files)][0];
  const baseline = JSON.stringify({ windows: { [key]: locations }, stems: [] });
  const tree = { 'scripts/dup-baseline.json': baseline, 'a.mjs': BLOCK, 'b.mjs': BLOCK };
  assert.equal(gitTree(t, tree).status, 0);
  assert.equal(gitTree(t, { ...tree, 'c.mjs': BLOCK }).status, 1);
});

test('the CLI refuses a baseline that is not the recorded shape', (t) => {
  for (const [index, baseline] of [
    {},
    [],
    true,
    7,
    { windows: [MARKER], stems: [] },
    { windows: {}, stems: MARKER },
    { windows: { abc: MARKER }, stems: [] },
    { windows: {}, stems: [1] },
    { windows: {}, stems: [MARKER] },
    { windows: {}, stems: [[MARKER]] },
    { windows: {}, stems: [], [MARKER]: true },
  ].entries()) {
    const result = gitTree(t, {
      'scripts/dup-baseline.json': JSON.stringify(baseline),
      'one.mjs': 'export const one = 1;\n',
    });
    assert.equal(result.status, 2, `shape ${index}`);
    assert.match(result.stderr, /scripts\/dup-baseline\.json/u, `shape ${index}`);
  }
});

test('the CLI refuses a baseline that is not JSON, or repeats a key at any depth', (t) => {
  const one = { 'one.mjs': `export const one = '${MARKER}';\n` };
  assert.equal(gitTree(t, { ...one, 'scripts/dup-baseline.json': EMPTY }).status, 0, 'control');
  const baselines = {
    'a bare token': MARKER,
    'a string value': `["${MARKER}",]`,
    'a key': `{"${MARKER}":}`,
    'single quotes': `{'windows':{},'stems':[],'note':'${MARKER}'}`,
    'a comment': `{"windows":{},"stems":[]} // ${MARKER}`,
    'a repeated top-level key': '{"windows":[],"windows":{},"stems":[]}',
    'a repeated nested key': `{"windows":{"abc":["a.mjs:1"],"abc":["${MARKER}:1"]},"stems":[]}`,
    'a key repeated by an escape': '{"windows":{},"stems":[],"\\u0073tems":[]}',
  };
  for (const [shape, baseline] of Object.entries(baselines)) {
    const result = gitTree(t, { ...one, 'scripts/dup-baseline.json': baseline });
    assert.equal(result.status, 2, shape);
    assert.match(result.stderr, /scripts\/dup-baseline\.json/u, shape);
  }
});

test('the CLI reads a real JSON baseline: escapes, nested arrays and keys inside strings', (t) => {
  const baseline = String.raw`{"note":"caf\u00E9 \"windows\": {} [x]","windows":{"abc":["a.mjs:1","b.mjs:2"],"def":["a.mjs:1"]},"stems":[["scripts/r.mjs","scripts/r.sh"]]}`;
  const result = gitTree(t, {
    'scripts/dup-baseline.json': baseline,
    'one.mjs': 'export const one = 1;\n',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 baselined block\(s\), 1 baselined stem\(s\)/u);
});

test('the CLI refuses a copy that follows a regular expression holding a comment marker', (t) => {
  const tree = { 'scripts/dup-baseline.json': EMPTY, 'first.mjs': BLOCK };
  for (const marker of ['/[/*]/u', '/^\\/*/u'])
    assert.equal(
      gitTree(t, { ...tree, 'second.mjs': `const marker = ${marker};\n${BLOCK}` }).status,
      1,
      marker,
    );
});

test('the CLI refuses a copy inside a template interpolation that block comments disguise', (t) => {
  const lines = BLOCK.trimEnd().split('\n');
  const source = (comment) =>
    ['const s = `${(() => {', ...lines.map((line) => `${comment}${line}`), '})()}`;', ''].join(
      '\n',
    );
  const tree = { 'scripts/dup-baseline.json': EMPTY, 'first.mjs': source('') };
  assert.equal(gitTree(t, { ...tree, 'second.mjs': source('') }).status, 1, 'control');
  for (const comment of ['/* why */ ', '/* a `${x}` */ '])
    assert.equal(gitTree(t, { ...tree, 'second.mjs': source(comment) }).status, 1, comment);
});

test('the CLI refuses a tree with no code files to compare', (t) => {
  const result = gitTree(t, { 'scripts/dup-baseline.json': EMPTY, 'notes.md': '# Notes\n' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no code files/u);
});

test('a verbatim copy into another code extension is refused', () => {
  const original = fixture('original.mjs');
  for (const path of ['scripts/planted.js', 'scripts/planted.mts', 'scripts/planted.py']) {
    const found = dupFindings({ files: [original, { path, text: original.text }], paths: [] });
    assert.equal(found.length, 1, path);
    assert.ok(found[0].includes(path), path);
  }
});

test('a script beside its own data is one script, so the stem rule is quiet', () => {
  for (const data of ['runner.json', 'runner.md', 'runner.yml'])
    assert.deepEqual(
      dupFindings({ files: [], paths: ['scripts/runner/runner.mjs', `scripts/runner/${data}`] }),
      [],
    );
});

test('two files under scripts/ differing only by extension are refused', () => {
  const found = dupFindings({ files: [], paths: ['scripts/seat.mjs', 'scripts/seat.ts'] });
  assert.equal(found.length, 1);
  assert.match(found[0], /scripts\/seat\.mjs and scripts\/seat\.ts/u);
});

test('a name stem is the whole name, so foo.mjs and foo-check.mjs are two scripts', () => {
  assert.deepEqual(
    dupFindings({ files: [], paths: ['scripts/seat.mjs', 'scripts/seat-check.mjs'] }),
    [],
  );
});

test('the same stem in two directories is two files, and outside scripts/ it is not read', () => {
  assert.deepEqual(
    dupFindings({ files: [], paths: ['scripts/seat.mjs', 'scripts/runner/seat.mjs'] }),
    [],
  );
  assert.deepEqual(dupFindings({ files: [], paths: ['tests/seat.mjs', 'tests/seat.ts'] }), []);
});

test('a clean tree passes', () => {
  assert.deepEqual(
    dupFindings({
      files: [fixture('original.mjs'), fixture('unique.mjs')],
      paths: ['scripts/seat.mjs', 'scripts/room.mjs'],
    }),
    [],
  );
});

test('a .js and a .jsx under scripts with one stem are one name for two files', () => {
  assert.equal(
    dupFindings({ files: [], paths: ['scripts/guard.js', 'scripts/guard.jsx'] }).length,
    1,
  );
});

test('the CLI exits 1 on a .js and a .jsx under scripts with one stem', (t) => {
  const result = runCli(t, {
    'scripts/guard.js': 'export const js = 1;\n',
    'scripts/guard.jsx': 'export const jsx = 1;\n',
  });
  assert.equal(result.status, 1, result.stdout);
  assert.match(
    result.stderr,
    /scripts\/guard\.js and scripts\/guard\.jsx differ only by extension/u,
  );
});

test('the CLI exits 1 on a twelve-line block copied into a .jsx', (t) => {
  const { text } = fixture('original.mjs');
  const result = runCli(t, { 'src/original.mjs': text, 'components/copy.jsx': text });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /components\/copy\.jsx:5/u);
});

// The security review of 3e550d6: inside `${...}` a `/` after `)` was lexed as
// a regular expression running to the next `/` on the line, swallowing the `}`
// that closes the interpolation and two backticks. Quote state then inverted
// for the rest of the file, and a later template holding `/*` stripped the
// copied lines after it.
test('the CLI refuses a copy after a division inside an interpolation', (t) => {
  const copied = Array.from({ length: 14 }, (_, i) => `  copied${i}(alpha, beta, ${i});`);
  const source = ['export function source() {', ...copied, '}', ''].join('\n');
  const after = [
    'export function f(a) {',
    '  return `${ (a) / 2 }` + `x` + a / 3;',
    '}',
    'export const g = `/*`;',
    ...copied.map((line) => line.trim()),
    'export const h = `*/`;',
    '',
  ].join('\n');
  const result = runCli(t, { 'a.mjs': source, 'b.mjs': after });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /a\.mjs:2 repeats at b\.mjs:5/u);
});

// The security review of 64400f0: the mirror of the case above. A real regular
// expression after `if (a)` inside `${...}`, read as a division, left its
// backtick to open a template the next real one closed, and that template's
// `/*` then stripped the copy. Only a parser can tell these two apart, so a
// line where the reading decides what is code refuses its file, by line.
test('the CLI refuses a file holding a / only a parser could read', (t) => {
  const copied = Array.from({ length: 14 }, (_, i) => `copied${i}(alpha, beta, ${i});`);
  const source = ['export function source() {', ...copied, '}', ''].join('\n');
  const after = [
    'export const t = `${(() => { if (a) /`/.test(b);',
    'return `/*`; })()}`;',
    ...copied,
    'export const h = `*/`;',
    '',
  ].join('\n');
  const result = runCli(t, { 'a.mjs': source, 'b.mjs': after });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /dup: b\.mjs:1 has a \/ only a parser could read/u);
});

// Sol's review of 03b8239 and the security review of it: the token before a
// `/` was read from the last 64 characters written, so 70 spaces, a line
// comment ending in a keyword, or a property named like one decided the `/`
// and the copy after it was dropped without a refusal. The first shape is
// Sol's proof as written; the other two are the security review's.
test('whitespace, a comment or a property name before a / cannot conceal duplicated code', () => {
  const copied = Array.from({ length: 14 }, (_, i) => `copied${i}(alpha, beta, ${i});`);
  const original = ['export function source() {', ...copied, '}', ''].join('\n');
  for (const opening of [
    ['export function f(a) {', '  return `${ (a)' + ' '.repeat(70) + '/ 2 }` + `x` + a / 3;', '}'],
    ['export const t = (a)', '// see return', '/ b + `/*`;'],
    ['export const t = o.return / b + `/*`;'],
  ]) {
    const copy = [...opening, 'export const g = `/*`;', ...copied, 'export const h = `*/`;', ''];
    const files = [
      { path: 'a.mjs', text: original },
      { path: 'b.mjs', text: copy.join('\n') },
    ];
    assert.ok(dupFindings({ files, paths: [] }).length > 0, opening.join('\n'));
  }
});

// The security review of 4094bb8, finding 1: a word after `.` was read as a
// property name, so the last dot of a spread made `typeof` or `void` a name,
// the regular expression after it a division, and its backtick a template
// that let a later `/*` strip the copy.
test('a keyword after a spread still opens a regular expression', () => {
  const copied = Array.from({ length: 14 }, (_, i) => `copied${i}(alpha, beta, ${i});`);
  const original = ['export function source() {', ...copied, '}', ''].join('\n');
  for (const keyword of ['typeof', 'void']) {
    const copy = [
      `export const t = [...${keyword} /\`/, \`/*\`];`,
      ...copied,
      'export const h = `*/`;',
    ];
    const files = [
      { path: 'a.mjs', text: original },
      { path: 'b.mjs', text: copy.join('\n') },
    ];
    assert.match(
      dupFindings({ files, paths: [] }).join('\n'),
      /a\.mjs:2 repeats at b\.mjs:2/u,
      keyword,
    );
  }
});

// Each opening below holds a `/` the token before it cannot decide, so its
// file is refused by the line of that `/`, whichever reading would hide the copy.
function refusedByLine(openings) {
  const copied = Array.from({ length: 14 }, (_, i) => `copied${i}(alpha, beta, ${i});`);
  const original = ['export function source() {', ...copied, '}', ''].join('\n');
  for (const [path, opening, at = opening.length] of openings) {
    const copy = [...opening, 'export const g = `/*`;', ...copied, 'export const h = `*/`;'];
    const files = [
      { path: 'a.mjs', text: original },
      { path, text: copy.join('\n') },
    ];
    const line = new RegExp(
      `${path.replace('.', '\\.')}:${at} has a / only a parser could read`,
      'u',
    );
    assert.match(dupFindings({ files, paths: [] }).join('\n'), line, opening.join('\n'));
  }
}

// The same review, finding 2: a TypeScript non-null `!`, and `of`, `await` or
// `yield` used as a name, end an expression as often as they precede one, so
// the token before the `/` cannot decide it. Read as a regular expression, the
// division hid the copy; the file is refused by line instead.
test('a / after a non-null ! or a contextual keyword refuses its file', () => {
  refusedByLine([
    ['b.ts', ['export const t = o.x! / b + `/*`;']],
    ['b.mjs', ['let of = 4;', 'export const t = of / b + `/*`;']],
    ['b.js', ['var await = 4;', 'var t = await / b + `/*`;']],
    ['b.js', ['var yield = 4;', 'var t = yield / b + `/*`;']],
  ]);
});

// Sol's review of f555b81, criterion 4, first finding: `>` was read as an
// operator, so the division after a TypeScript instantiation opened a regular
// expression. A `/` reads as one only after a token on an explicit list.
test('a / after a TypeScript instantiation refuses its file', () => {
  refusedByLine([['b.ts', ['export const t = f<number> / b + `/*`;']]]);
});

// The same review, second finding: `break` was read as a name, so the regular
// expression on the next line, where automatic semicolon insertion ends the
// `break`, divided. A line break before a `/` decides it only after a token
// that leaves the line open, and a keyword not on the list decides nothing.
test('a / on the line after break or continue refuses its file', () => {
  refusedByLine(
    ['break', 'continue'].map((word) => [
      'b.mjs',
      [`export function f() { while (true) { ${word}`, '/`/.test(b); } return `/*`; }'],
    ]),
  );
});

// The security review of 711c4d2, finding 1: after a `/` the token before it
// cannot decide, no `/*` opens on the rest of its line. One that opens a real
// comment running onto later lines had its body read as code, so a lone
// backtick there opened a false template and a `/*` in a later string dropped
// the copy, with the quote on a line the refusal never read.
test('a / the token before it cannot decide, after a ), refuses a comment that leaves its line', () => {
  refusedByLine([['b.mjs', ['export const t = (b) / 2; /*', ' * the ` mark', ' */'], 1]]);
});

test('a real regular expression after a } refuses a comment that leaves its line', () => {
  refusedByLine([['b.mjs', ['if (b) {}', '/x/.test(b); /*', ' * the ` mark', ' */'], 2]]);
});

// Without a closing `/` on the line nothing asked whether a quote followed, so
// a quote inside the comment refuses too when the comment closes on its line.
test('a / whose regular expression reading never closes refuses a comment after it', () => {
  refusedByLine([
    ['b.mjs', ['export const t = f(a) / b[/*', ' ` */ 0];'], 1],
    ['b.mjs', ['export const t = f(a) / b[/* ` */ 0];']],
  ]);
});

test('a / after a TypeScript instantiation refuses a comment that leaves its line', () => {
  refusedByLine([['b.ts', ['export const t = f<number> / b; /*', ' ` */'], 1]]);
});

// 711c4d2 made `this`, `null`, `true` and `false` undecided, which they are
// not on their own line: a `/` after one divides. A name, or one of those,
// before a line break may end a TypeScript type (`let x: Foo` then `/re/`), so
// there the file is refused instead.
test('a / after this, null or a line-broken name cannot conceal a copy', () => {
  const copied = Array.from({ length: 14 }, (_, i) => `copied${i}(alpha, beta, ${i});`);
  const original = ['export function source() {', ...copied, '}', ''].join('\n');
  for (const word of ['this', 'null', 'true', 'false']) {
    const opening = `export class C { m() { return ${word} / 2; /*\n \` */ } }`;
    const copy = [opening, 'export const g = `/*`;', ...copied, 'export const h = `*/`;'];
    const files = [
      { path: 'a.mjs', text: original },
      { path: 'b.mjs', text: copy.join('\n') },
    ];
    assert.match(
      dupFindings({ files, paths: [] }).join('\n'),
      /a\.mjs:2 repeats at b\.mjs:4/u,
      word,
    );
  }
  refusedByLine([['b.mjs', ['export const a = 4, t = a', '/ 2; /*', ' ` */'], 2]]);
});

// Sol's review of 04a1860, criterion 4: the writer read LF alone as a line
// break, so a TypeScript type ended by CR, U+2028 or U+2029, each a line break
// to JavaScript, made the `/` after it a division, and the copy under it went
// unseen. Inside a quoted string the last two are text, so there they hide
// nothing either.
test('a line break other than LF at a TypeScript ASI boundary cannot conceal a copy', (t) => {
  const copied = Array.from({ length: 14 }, (_, i) => `copied${i}(alpha, beta, ${i});`);
  const original = `${copied.join('\n')}\n`;
  for (const separator of ['\r', '\u{2028}', '\u{2029}']) {
    const opening = `let x: Foo${separator}/\`/.test(b); export const t = \`/*\`;`;
    const copy = [opening, 'export const g = `/*`;', ...copied, 'export const h = `*/`;', ''];
    const result = runCli(t, { 'a.ts': original, 'b.ts': copy.join('\n') });
    assert.equal(result.status, 1, JSON.stringify(separator));
    assert.match(result.stderr, /dup: b\.ts:2 has a \/ only a parser could read/u);
  }
  for (const separator of ['\u{2028}', '\u{2029}']) {
    const copy = [`export const s = 'a${separator}/*';`, ...copied, "export const e = '*/';", ''];
    const result = runCli(t, { 'a.ts': original, 'b.ts': copy.join('\n') });
    assert.match(result.stderr, /dup: a\.ts:1 repeats at b\.ts:\d+ /u, JSON.stringify(separator));
  }
});

// The same review: each `/` that opens no regular expression on its line
// scanned to the end of the line, and each `/*` back to its start, so one
// hostile 65,000-character line took seconds. The fourth line is four times
// as long, where copying what is already read for each `/` shows. A
// microsecond a character is ten times what a linear reading takes here.
test('a hostile line normalises in time linear in its length', () => {
  const lines = ['(/['.repeat(21_666), '`${(/['.repeat(15_600), '/**/'.repeat(16_250)];
  for (const body of [...lines, '(/['.repeat(86_664)]) {
    const started = performance.now();
    normalise(body, 'x.mjs');
    const took = performance.now() - started;
    assert.ok(took < body.length / 1000, `${body.length} characters took ${Math.round(took)} ms`);
  }
});
