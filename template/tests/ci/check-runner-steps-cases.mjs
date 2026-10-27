// SPDX-License-Identifier: AGPL-3.0-only
// The check runner run for real in a throwaway repository: failed steps, edits
// and commits between steps, and a Git that cannot answer.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { git, repository } from './check-runner-fixture.mjs';

test('a run whose every step passes on a clean commit exits 0 and records green', (t) => {
  const { runner } = repository(t);
  const run = runner();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.summary.green, true);
  assert.match(run.stdout, /check: green\./u);
});

test('a failed step stops the run, exits 1 and records no green', (t) => {
  const { runner } = repository(t);
  const run = runner({ FAIL_AT: 'typecheck' });
  assert.equal(run.status, 1, 'a failed step must fail the run');
  assert.equal(run.summary.green, false);
  assert.equal(run.summary.steps, 3, 'nothing after the failed step runs');
  assert.doesNotMatch(run.stdout, /check: green/u);
  assert.match(run.stderr, /check: failed at typecheck/u);
});

// Sol's review of CF-10-FIX4: the case above fails with exit 1 on a clean
// start, so a runner taking any status but 1 as a pass stayed green on it.
test('a step that cannot run (exit 126) on a dirty start fails the run', (t) => {
  const { root, runner } = repository(t);
  writeFileSync(join(root, 'uncommitted.txt'), 'work in progress\n');
  const run = runner({ FAIL_AT: 'typecheck', FAIL_STATUS: '126' });
  assert.equal(run.status, 1, 'a step that could not run must fail the run');
  assert.deepEqual([run.summary.steps, run.summary.passed], [3, 2], 'it is no pass');
  assert.match(run.stderr, /check: failed at typecheck/u);
  assert.doesNotMatch(run.stdout, /check: green|not a green record/u);
});

test('an edit made and restored between steps refuses the run', (t) => {
  const { runner } = repository(t);
  const run = runner({ EDIT_AT: 'lint', RESTORE_AT: 'test' });
  assert.equal(run.summary.green, false, 'the runner saw the change');
  assert.equal(run.status, 1, 'a run the record refuses cannot exit 0');
  assert.doesNotMatch(run.stdout, /check: green/u);
});

// Sol's review of CF-10-FIX2: on a tree that was already dirty, only the clean
// flag was compared, and it stays false through any edit. Each start below is
// uncommitted work; the edit is made at one step and undone at a later one.
for (const [label, start, env] of [
  ['an unrelated untracked file', 'uncommitted.txt', { RESTORE_AT: 'test' }],
  ['the edited file already modified', 'product.json', { PUT_BACK_AT: 'test' }],
  ['the edited file untracked', 'notes.txt', { PUT_BACK_AT: 'test', EDIT_FILE: 'notes.txt' }],
]) {
  test(`an edit made and restored between steps refuses a run that starts dirty: ${label}`, (t) => {
    const { root, runner } = repository(t);
    writeFileSync(join(root, start), 'work in progress\n');
    const run = runner({ EDIT_AT: 'lint', ...env });
    assert.equal(
      readFileSync(join(root, start), 'utf8'),
      'work in progress\n',
      'the start is back',
    );
    assert.equal(run.status, 1, 'a tree that changed under the run cannot exit 0');
    assert.doesNotMatch(run.stdout, /not a green record|check: green/u);
    assert.match(run.stderr, /The tree changed while the steps ran/u);
  });
}

// Sol's review of CF-10-FIX1: the cases above stayed green with the sampled
// head comparison removed, because none moved the head and put it back.
test('a commit made and undone between steps refuses the run', (t) => {
  const { root, runner } = repository(t);
  const head = git(root, 'rev-parse', 'HEAD').stdout;
  const run = runner({ COMMIT_AT: 'lint', UNCOMMIT_AT: 'test' });
  assert.equal(git(root, 'rev-parse', 'HEAD').stdout, head, 'the head is back where it started');
  assert.equal(run.summary.green, false, 'the runner saw the commit');
  assert.equal(run.status, 1, 'a head that moved under the run cannot exit 0');
  assert.doesNotMatch(run.stdout, /check: green/u);
});

// Sol's review of CF-10-FIX1: a Git that could not answer left an empty head
// and an unclean tree, which read as uncommitted work and exited 0. A broken
// git on PATH, or one that fails a single question, now refuses the run.
for (const [label, script] of [
  ['a git that cannot run', 'exit 126'],
  // Status runs after a -c option, so its name is found among the arguments.
  [
    'a git whose status fails',
    'case " $* " in *" status "*) exit 128 ;; esac\nexec "$REAL_GIT" "$@"',
  ],
  [
    'a git that cannot name the head',
    'case "$1" in rev-parse) exit 128 ;; esac\nexec "$REAL_GIT" "$@"',
  ],
]) {
  test(`${label} refuses the run instead of recording uncommitted work`, (t) => {
    const { temporary, runner } = repository(t);
    const bin = join(temporary, 'broken-bin');
    mkdirSync(bin);
    // Git runs with only the variables it needs, so the real one is named here.
    const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nREAL_GIT='${realGit}'\n${script}\n`, {
      mode: 0o755,
    });
    const run = runner({ PATH: `${bin}:${process.env.PATH}` });
    assert.equal(run.status, 1, 'an unobserved tree cannot exit 0');
    assert.match(run.stderr, /git could not observe the tree/u);
    assert.doesNotMatch(run.stdout, /check: green|not a green record/u);
    assert.notEqual(run.summary?.green, true, 'no green record either');
  });
}

// Sol's review of CF-10-FIX3: Git lists an untracked nested repository as one
// directory, its read failed into empty contents, and an edit restored inside
// it between steps left the digest unchanged. A path the digest cannot read
// now refuses the run before any step, by name.
test('an untracked nested repository refuses the run, naming it', (t) => {
  const { root, runner } = repository(t);
  const nested = join(root, 'packages/nested');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, 'package.json'), '{"name":"nested"}\n');
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    ['commit', '-qm', 'nested'],
  ]) {
    assert.equal(git(nested, ...args).status, 0);
  }
  const run = runner({
    EDIT_AT: 'lint',
    EDIT_FILE: 'packages/nested/package.json',
    PUT_BACK_AT: 'test',
  });
  assert.equal(run.status, 1, 'an unread directory cannot stand in for its bytes');
  assert.match(run.stderr, /packages\/nested\/ is untracked and cannot be read/u);
  assert.doesNotMatch(run.stdout, /\(pnpm run |check: green|not a green record/u, 'no step runs');
  assert.notEqual(run.summary?.green, true);
});

test(
  'an untracked file nobody can read refuses the run, naming it',
  { skip: process.getuid?.() === 0 && 'root reads a file whatever its mode' },
  (t) => {
    const { root, runner } = repository(t);
    writeFileSync(join(root, 'locked.txt'), 'work in progress\n', { mode: 0o000 });
    const run = runner();
    assert.equal(run.status, 1);
    assert.match(run.stderr, /locked\.txt is untracked and cannot be read/u);
    assert.doesNotMatch(run.stdout, /check: green|not a green record/u);
  },
);

// Sol's review of CF-10-FIX4: with status.showUntrackedFiles=no in the
// repository's config, status said nothing of an untracked file, so the record
// called its bytes the head's.
for (const [label, config] of [
  ['', []],
  [' while the repository config hides untracked files', ['status.showUntrackedFiles', 'no']],
]) {
  test(`a run on uncommitted changes never prints or records green${label}`, (t) => {
    const { root, runner } = repository(t);
    if (config.length > 0) assert.equal(git(root, 'config', ...config).status, 0);
    writeFileSync(join(root, 'uncommitted.txt'), 'work in progress\n');
    const run = runner();
    assert.equal(run.status, 0, 'every step passed on the working tree');
    assert.equal(run.summary.green, false);
    assert.doesNotMatch(run.stdout, /check: green/u);
    assert.match(run.stdout, /not a green record/u);
  });
}
