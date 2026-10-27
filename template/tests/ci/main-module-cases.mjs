// SPDX-License-Identifier: AGPL-3.0-only
// The guard where the acceptance cases cannot reach: its own path lookup, and
// the invocations that hand node a program instead of a file.
//
// The acceptance cases run scripts through a symlink that stays put. The first
// two here take the link away after node has loaded through it, which is the
// only way to make `realpathSync` fail on the side the guard was invoked with.
// The defect answers false and exits 0 with nothing printed; the repair refuses.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const reader = resolve(import.meta.dirname, '../../scripts/main-module.mjs');

/** Run a probe through `entry.mjs`, a symlink to it, and read what comes back. */
const throughLink = (body) => {
  const directory = mkdtempSync(join(tmpdir(), 'main-module-lookup-'));
  try {
    const probe = join(directory, 'probe.mjs');
    writeFileSync(
      probe,
      [
        `import { rmSync } from 'node:fs';`,
        `import { isMainModule } from ${JSON.stringify(reader)};`,
        body,
        `try {`,
        `  console.log(\`answered \${isMainModule(import.meta.url)}\`);`,
        `} catch (error) {`,
        `  console.error(\`refused: \${error.message}\`);`,
        `  process.exit(2);`,
        `}`,
        '',
      ].join('\n'),
    );
    const entry = join(directory, 'entry.mjs');
    symlinkSync(probe, entry);
    const answer = spawnSync(process.execPath, [entry], { encoding: 'utf8' });
    return {
      status: answer.status ?? -1,
      output: `${answer.stdout ?? ''}${answer.stderr ?? ''}`,
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

test('an entry path that no longer resolves is refused, not answered false', () => {
  const answer = throughLink('rmSync(process.argv[1]);');
  assert.match(answer.output, /the main-module guard cannot resolve/);
  assert.doesNotMatch(answer.output, /^answered /m);
  assert.equal(answer.status, 2);
});

test('the same probe with the link in place still answers true', () => {
  const answer = throughLink('');
  assert.equal(answer.output, 'answered true\n');
  assert.equal(answer.status, 0);
});

// Every form under which node evaluates a program it was handed rather than
// running a file. There is no entry file in any of them, so `process.argv[1]`
// is the first user argument; the guard has to answer false without reading it
// as a path. Naming the flags one at a time is what missed `-pe`, where node
// takes `-p` and `-e` as a single token.
const url = JSON.stringify(pathToFileURL(reader).href);
const program = `void import(${url}).then(({ isMainModule }) => console.log(\`answered \${isMainModule(${url})}\`));`;

for (const flags of [
  ['-e', program],
  ['--eval', program],
  ['-p', program],
  ['--print', program],
  ['-pe', program],
  ['-'],
]) {
  test(`node ${flags[0]} has no entry file: the argument after it is not read as a path`, () => {
    const answer = spawnSync(process.execPath, [...flags, '["not","a","path"]'], {
      encoding: 'utf8',
      input: program,
    });
    assert.match(`${answer.stdout}${answer.stderr}`, /^answered false$/mu);
    assert.equal(answer.status, 0);
  });
}

// A single-dash flag that is not eval. `-expose-gc` is node's own spelling of
// `--expose-gc`, and finding an `e` inside it answered false, so the check ran
// as an import and exited 0 on an input it never read.
const check = resolve(import.meta.dirname, '../../scripts/job-timeout-check.mjs');

test('node -expose-gc leaves the guard firing: the missing directory is reported', () => {
  const flags = ['-expose-gc', check, '/definitely-missing-workflows'];
  const answer = spawnSync(process.execPath, flags, { encoding: 'utf8' });
  assert.match(`${answer.stdout}${answer.stderr}`, /no workflow directory at/u);
  assert.equal(answer.status, 2);
});

// `--eval=` carrying a program with a newline in it. Matching the flag and its
// value as one pattern rejected this, the guard fired inside the import, and
// the check ran on the argument the eval was handed.
test('a multiline --eval= program leaves the guard answering false', () => {
  const lines = `await import(${JSON.stringify(pathToFileURL(check).href)});\nconsole.log('import finished');`;
  const flags = ['--input-type=module', `--eval=${lines}`, check, '/definitely-missing-workflows'];
  const answer = spawnSync(process.execPath, flags, { encoding: 'utf8' });
  assert.match(`${answer.stdout}${answer.stderr}`, /^import finished$/mu);
  assert.equal(answer.status, 0);
});

// Sol's CF-08-FIX4 scope note: a command that printed a caught error's message
// printed what that message quotes, a path or an input, whatever it carries.
// Each row plants a credential marker where one script's failure reads it, in
// a copy run beside only the modules it imports; the refusal names no marker.
// Eight characters, because a JSON parse error quotes ten either side of where
// it stopped and a longer marker would leak only in part.
const MARKER = ['CF08', 'F3MK'].join('');
const scripts = resolve(import.meta.dirname, '../../scripts');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' });

/** A directory whose path carries the marker, holding `script` and what the five import. */
const copied = (t, script) => {
  const root = mkdtempSync(join(tmpdir(), `${MARKER}-`));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  for (const file of [script, 'main-module.mjs', 'local-git-env.mjs', 'provenance.mjs'])
    cpSync(join(scripts, file), join(root, 'scripts', file));
  return root;
};

const ROWS = {
  'merge-policy-check.mjs': (root) => {
    writeFileSync(join(root, 'renovate.json'), `{"extends": ${MARKER}}`);
    return {};
  },
  'product-name.mjs': (root) => {
    writeFileSync(join(root, 'product.json'), '{"name":"Example"}');
    return {};
  },
  'licences/check.mjs': (root) => ({ args: ['--report', join(root, 'missing.json')] }),
  'candidate-snapshot.mjs': (root) => ({
    args: ['check', '--candidate', join(root, 'missing'), '--manifest', join(root, 'm.json')],
  }),
  // Git failing with a credential on stderr, as a remote URL or a config value would.
  'commit-range-check.mjs': (root) => {
    const config = ['user.name=Case', 'user.email=case@example.invalid', 'commit.gpgsign=false'];
    const options = config.flatMap((pair) => ['-c', pair]);
    git('init', '-q', root);
    git('-C', root, ...options, 'commit', '-q', '--allow-empty', '-m', 'chore: root');
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    mkdirSync(join(root, 'bin'));
    writeFileSync(
      join(root, 'bin/git'),
      '#!/bin/sh\n[ "$1" = merge-base ] && [ "$2" != --is-ancestor ] && ' +
        `{ echo "fatal: ${MARKER}" >&2; exit 128; }\nexec '${real}' "$@"\n`,
      { mode: 0o755 },
    );
    const PATH = `${join(root, 'bin')}:${process.env['PATH']}`;
    return { cwd: root, env: { ...process.env, BASE_SHA: 'HEAD', HEAD_SHA: 'HEAD', PATH } };
  },
};

test('a caught failure is refused in fixed words, never printing the marker it read', (t) => {
  const passed = [];
  const printed = [];
  for (const [script, plant] of Object.entries(ROWS)) {
    const root = copied(t, script);
    const { args = [], cwd = root, env = process.env } = plant(root);
    const ran = spawnSync(process.execPath, [join(root, 'scripts', script), ...args], {
      cwd,
      env,
      encoding: 'utf8',
    });
    if (ran.status === 0) passed.push(script);
    if (`${ran.stdout}${ran.stderr}`.includes(MARKER)) printed.push(script);
  }
  assert.deepEqual({ passed, printed }, { passed: [], printed: [] });
});
