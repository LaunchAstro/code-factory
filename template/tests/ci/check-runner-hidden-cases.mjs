// SPDX-License-Identifier: AGPL-3.0-only
// The check runner run for real in a throwaway repository: changes that Git's
// status hides, by index flags and by ignore rules.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { git, repository } from './check-runner-fixture.mjs';

// Sol's review of CF-10-FIX4: an index flag hides a tracked file's edit from
// status and diff alike, so a fix held only in the working tree was recorded
// as the head's. A marked entry keeps the record from green.
test('a tracked file marked assume-unchanged or skip-worktree is never recorded green', (t) => {
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    const { root, runner } = repository(t);
    assert.equal(git(root, 'update-index', flag, 'product.json').status, 0);
    writeFileSync(join(root, 'product.json'), '{"name":"Hidden fix"}\n');
    assert.equal(git(root, 'status', '--porcelain').stdout, '', `${flag} hides the edit`);
    const run = runner();
    assert.equal(run.summary.green, false, `${flag}: a hidden edit cannot pass as the head`);
    assert.doesNotMatch(run.stdout, /check: green/u);
    assert.match(run.stdout, /not a green record/u);
  }
});

// Sol's review of PR 88, round 1, finding 4: a marked entry's edit is hidden
// from status and diff, so the digest did not see one made at a step and
// restored at a later one, and the runner exited 0 on two trees.
test('an edit hidden by assume-unchanged or skip-worktree between steps refuses the run', (t) => {
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    const { root, runner } = repository(t);
    assert.equal(git(root, 'update-index', flag, 'product.json').status, 0);
    const run = runner({ EDIT_AT: 'lint', PUT_BACK_AT: 'test' });
    assert.equal(readFileSync(join(root, 'product.json'), 'utf8'), '{"name":"Fixture"}\n');
    assert.equal(run.status, 1, `${flag}: the tree changed between steps but the run exited 0`);
    assert.match(run.stderr, /The tree changed while the steps ran/u);
  }
});

// Security review of G4 at 75146a0, finding 2: an ignore rule no commit
// carries hid an untracked fix from status and the digest alike, so the record
// called its bytes the head's. Only a committed .gitignore may hide a file.
test('an untracked file hidden only by an uncommitted ignore rule is never recorded green', (t) => {
  const fix = 'export const fix = true;\n';
  for (const [label, hide] of [
    [
      '.git/info/exclude',
      (root) => {
        writeFileSync(join(root, 'fix.mjs'), fix);
        writeFileSync(join(root, '.git/info/exclude'), 'fix.mjs\n');
      },
    ],
    [
      'core.excludesFile',
      (root) => {
        writeFileSync(join(root, 'fix.mjs'), fix);
        writeFileSync(join(root, '.git/everything'), '*\n');
        assert.equal(git(root, 'config', 'core.excludesFile', '.git/everything').status, 0);
      },
    ],
    [
      'an untracked .gitignore',
      (root) => {
        mkdirSync(join(root, 'lib'));
        writeFileSync(join(root, 'lib/fix.mjs'), fix);
        writeFileSync(join(root, 'lib/.gitignore'), '*\n');
      },
    ],
  ]) {
    const { root, runner } = repository(t);
    hide(root);
    assert.equal(git(root, 'status', '--porcelain').stdout, '', `${label} hides the file`);
    const run = runner();
    assert.equal(run.summary.green, false, `${label}: a hidden file cannot pass as the head`);
    assert.doesNotMatch(run.stdout, /check: green/u);
  }
});

// Security review of G4 at 264a68b, finding 1: a default Mac filesystem
// opens lib/.GITIGNORE when Git reads lib/.gitignore, so an untracked rule
// file in another case hid itself and a fix from status and the digest. Where
// the filesystem tells case apart, a committed rule hides the same two files.
test('an untracked .gitignore in another case is never recorded green', (t) => {
  const { root, runner } = repository(t);
  mkdirSync(join(root, 'lib'));
  writeFileSync(join(root, 'lib/fix.mjs'), 'export const fix = true;\n');
  writeFileSync(join(root, 'lib/.GITIGNORE'), '*\n');
  if (!existsSync(join(root, '.GITIGNORE'))) {
    writeFileSync(join(root, '.gitignore'), '*.local\nlib/*\n');
    assert.equal(git(root, 'commit', '-qam', 'ignore lib').status, 0);
  }
  assert.equal(git(root, 'status', '--porcelain').stdout, '', 'the rule file is hidden');
  const run = runner();
  assert.equal(run.summary.green, false, 'a rule file no commit carries cannot pass as the head');
  assert.doesNotMatch(run.stdout, /check: green/u);
});

// Sol's review of PR 88, round 1, finding 1: listed with --directory, an
// ignored folder came back as lib/ and was accepted, so an untracked rule
// file inside it, which hides itself, was recorded green.
test('an untracked .gitignore inside an ignored folder is never recorded green', (t) => {
  const { root, runner } = repository(t);
  writeFileSync(join(root, '.gitignore'), '*.local\nlib/\n');
  assert.equal(git(root, 'commit', '-qam', 'ignore lib').status, 0);
  mkdirSync(join(root, 'lib'));
  writeFileSync(join(root, 'lib/.gitignore'), '*\n');
  assert.equal(git(root, 'status', '--porcelain').stdout, '', 'the folder rule hides the file');
  const run = runner();
  assert.equal(run.summary.green, false, 'a rule file no commit carries cannot pass as the head');
  assert.doesNotMatch(run.stdout, /check: green/u);
});

// Sol's review of PR 88, round 2, finding 1: the rule file above was listed
// but its bytes were not digested, so an edit to it made at one step and
// restored at a later one left the run exiting 0 on two trees.
test('an untracked rule file inside an ignored folder edited and restored between steps refuses the run', (t) => {
  const { root, runner } = repository(t);
  writeFileSync(join(root, '.gitignore'), '*.local\nlib/\n');
  assert.equal(git(root, 'commit', '-qam', 'ignore lib').status, 0);
  mkdirSync(join(root, 'lib'));
  writeFileSync(join(root, 'lib/.gitignore'), '*\n');
  const run = runner({ EDIT_AT: 'lint', PUT_BACK_AT: 'test', EDIT_FILE: 'lib/.gitignore' });
  assert.equal(readFileSync(join(root, 'lib/.gitignore'), 'utf8'), '*\n', 'the rule is back');
  assert.equal(run.status, 1, 'the rule changed between steps but the run exited 0');
  assert.match(run.stderr, /The tree changed while the steps ran/u);
});
