// SPDX-License-Identifier: AGPL-3.0-only
// The check runner run for real in a throwaway repository: what Git is given,
// folders, nested repositories, the run record and the build.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { git, repository } from './check-runner-fixture.mjs';

// Sol's review of PR 88, round 2, finding 3: the Git children that observe
// the tree inherited the whole environment, so a GitHub credential meant for
// gh reached Git, which needs none to read a local tree.
test('observing the tree gives Git no credential', (t) => {
  const { temporary, runner } = repository(t);
  const bin = join(temporary, 'watching-bin');
  mkdirSync(bin);
  const seen = join(temporary, 'credential-seen');
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(
    join(bin, 'git'),
    '#!/bin/sh\n' +
      `if [ -n "\${GH_TOKEN:-}\${GITHUB_TOKEN:-}\${NPM_TOKEN:-}" ]; then : > '${seen}'; fi\n` +
      `exec '${realGit}' "$@"\n`,
    { mode: 0o755 },
  );
  const run = runner({
    PATH: `${bin}:${process.env.PATH}`,
    GH_TOKEN: 'synthetic-credential-marker',
    GITHUB_TOKEN: 'synthetic-credential-marker',
    NPM_TOKEN: 'synthetic-credential-marker',
  });
  assert.equal(run.status, 0, 'the run observed the tree with the real Git');
  assert.equal(existsSync(seen), false, 'a Git child inherited a credential');
});

// Security review of G4 at b51657a, finding 1: run from a folder below the
// top, as `template/` is here, Git listed only that folder's flags and rule
// files, so a marked rule file or an untracked one above it hid a fix.
test('run below the top, an ignore source outside the folder never hides a fix', (t) => {
  const fix = 'export const fix = true;\n';
  for (const [label, folder, hide] of [
    ...['--assume-unchanged', '--skip-worktree'].map((flag) => [
      `a top .gitignore marked ${flag}`,
      'template',
      (top) => {
        assert.equal(git(top, 'update-index', flag, '.gitignore').status, 0);
        writeFileSync(join(top, '.gitignore'), '*.local\nfix.mjs\n');
        writeFileSync(join(top, 'template/fix.mjs'), fix);
      },
    ]),
    [
      'an untracked .gitignore in a parent folder',
      'pk/app',
      (top) => {
        writeFileSync(join(top, 'pk/.gitignore'), '.gitignore\napp/fix.mjs\n');
        writeFileSync(join(top, 'pk/app/fix.mjs'), fix);
      },
    ],
  ]) {
    const { top, runner } = repository(t, folder);
    hide(top);
    const status = git(top, '-c', 'status.showUntrackedFiles=all', 'status', '--porcelain');
    assert.equal(status.stdout, '', `${label} hides the fix`);
    const run = runner();
    assert.equal(run.summary.green, false, `${label}: a hidden fix cannot pass as the head`);
    assert.doesNotMatch(run.stdout, /check: green/u);
  }
});

// Security review of G4 at b51657a, finding 3: Git leaves a folder it cannot
// list out of status and the listings, saying so only on stderr, so a fix a
// step can still read by name was recorded green.
test(
  'an untracked folder Git cannot list refuses the run, naming it',
  { skip: process.getuid?.() === 0 && 'root lists a folder whatever its mode' },
  (t) => {
    const { root, runner } = repository(t);
    const hidden = join(root, 'hidden');
    mkdirSync(hidden);
    writeFileSync(join(hidden, 'fix.cjs'), 'exports.fix = true;\n');
    chmodSync(hidden, 0o311);
    try {
      assert.equal(git(root, 'status', '--porcelain').stdout, '', 'the folder is left out');
      const run = runner();
      assert.equal(run.status, 1, 'a folder Git cannot list cannot stand in for its bytes');
      assert.match(run.stderr, /hidden/u);
      assert.doesNotMatch(run.stdout, /\(pnpm run |check: green|not a green record/u);
    } finally {
      chmodSync(hidden, 0o755);
    }
  },
);

// Security review of G4 at b51657a, finding 2: pytest, ruff, mypy and a
// Python 3.13 venv write a .gitignore into their own folder. The run stays
// short of green, but it said to commit, which changes nothing.
test('a tool cache rule file keeps the run from green and says to move it, not commit', (t) => {
  const { root, runner } = repository(t);
  writeFileSync(join(root, '.gitignore'), '*.local\n.pytest_cache/\n');
  assert.equal(git(root, 'commit', '-qam', 'ignore the cache').status, 0);
  mkdirSync(join(root, '.pytest_cache'));
  writeFileSync(join(root, '.pytest_cache/.gitignore'), '# Created by pytest.\n*\n');
  assert.equal(git(root, 'status', '--porcelain').stdout, '', 'nothing to commit');
  const run = runner();
  assert.equal(run.summary.green, false);
  assert.match(run.stdout, /\.pytest_cache\/\.gitignore/u, 'the rule file is named');
  assert.match(run.stdout, /outside the repository/u);
  assert.doesNotMatch(run.stdout, /commit, then run it again|check: green/u);
});

// A committed nested repository, as a gitlink.
function gitlink(root) {
  const nested = join(root, 'nested');
  mkdirSync(nested);
  writeFileSync(join(nested, 'product.json'), '{"name":"Nested"}\n');
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    ['commit', '-qm', 'nested'],
  ])
    assert.equal(git(nested, ...args).status, 0);
  for (const args of [
    ['add', 'nested'],
    ['commit', '-qm', 'gitlink'],
  ])
    assert.equal(git(root, ...args).status, 0);
  return nested;
}

// Security review of G4 at 75146a0, finding 3: a local diff.ignoreSubmodules
// hid an edit inside a committed nested repository from status and diff alike.
test('an edit inside a committed nested repository is never recorded green', (t) => {
  const { root, runner } = repository(t);
  const nested = gitlink(root);
  writeFileSync(join(nested, 'product.json'), '{"name":"Hidden fix"}\n');
  assert.equal(git(root, 'config', 'diff.ignoreSubmodules', 'all').status, 0);
  assert.equal(git(root, 'status', '--porcelain').stdout, '', 'the config hides the edit');
  const run = runner();
  assert.equal(run.summary.green, false, 'a hidden edit cannot pass as the head');
  assert.doesNotMatch(run.stdout, /check: green/u);
});

// Security review of G4 at 264a68b, finding 2: the nested repository's own
// exclude file, its own untracked .gitignore and its own index flags still hid
// a fix inside it. A committed nested repository is refused, by name.
test('a committed nested repository refuses the run, naming it', (t) => {
  const fix = 'export const fix = true;\n';
  for (const [label, hide] of [
    [
      'its own .git/info/exclude',
      (nested) => {
        writeFileSync(join(nested, 'fix.mjs'), fix);
        writeFileSync(join(nested, '.git/info/exclude'), 'fix.mjs\n');
      },
    ],
    [
      'its own untracked .gitignore',
      (nested) => {
        writeFileSync(join(nested, 'fix.mjs'), fix);
        writeFileSync(join(nested, '.gitignore'), '*\n');
      },
    ],
    [
      'its own assume-unchanged entry',
      (nested) => {
        assert.equal(git(nested, 'update-index', '--assume-unchanged', 'product.json').status, 0);
        writeFileSync(join(nested, 'product.json'), '{"name":"Hidden fix"}\n');
      },
    ],
  ]) {
    const { root, runner } = repository(t);
    hide(gitlink(root));
    const status = git(root, '-c', 'status.showUntrackedFiles=all', 'status', '--porcelain');
    assert.equal(status.stdout, '', `${label} hides the fix`);
    const run = runner();
    assert.equal(run.status, 1, `${label}: a nested repository cannot stand in for its bytes`);
    assert.match(run.stderr, /nested is a nested repository/u);
    assert.doesNotMatch(run.stdout, /\(pnpm run |check: green|not a green record/u, 'no step runs');
  }
  // A repository started inside a tracked folder is one too.
  const { root, runner } = repository(t);
  assert.equal(git(join(root, 'scripts'), 'init', '-q').status, 0);
  const run = runner();
  assert.equal(run.status, 1, 'a tracked folder holding its own .git is refused');
  assert.match(run.stderr, /scripts is a nested repository/u);
});

// Sol's review of CF-10-FIX4: the record was written through whatever sat at
// its path, so an ignored symlink there truncated a checked input after the
// last observation. The record now replaces the link.
test('recording a run replaces a symlink at the summary path instead of writing through it', (t) => {
  const { root, runner } = repository(t);
  const checked = readFileSync(join(root, 'product.json'));
  symlinkSync('product.json', join(root, '.check-summary.local'));
  const run = runner();
  assert.deepEqual(
    readFileSync(join(root, 'product.json')),
    checked,
    'the checked input is untouched',
  );
  assert.equal(lstatSync(join(root, '.check-summary.local')).isSymbolicLink(), false);
  const records = readdirSync(root).filter((name) => name.startsWith('.check-summary'));
  assert.deepEqual(records, ['.check-summary.local'], 'no temporary file is left beside it');
  assert.equal(run.summary.green, true, 'the record is a file of its own');
  assert.equal(run.status, 0);
});

// The last step, `build`, has to see a package however the workspace reaches it.
function build(root) {
  return spawnSync(process.execPath, [join(root, 'scripts/build.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('build: placeholder directories with no package.json have nothing to build', (t) => {
  const { root } = repository(t);
  mkdirSync(join(root, 'packages/placeholder'), { recursive: true });
  writeFileSync(join(root, 'packages/placeholder/README.md'), 'Not yet a package.\n');
  assert.equal(build(root).status, 0);
});

test('build: a workspace package reached through a symlink is refused like a real one', (t) => {
  const { root, temporary } = repository(t);
  const real = join(root, 'packages/real');
  mkdirSync(real, { recursive: true });
  writeFileSync(join(real, 'package.json'), '{"name":"real","version":"1.0.0"}\n');
  assert.equal(build(root).status, 1, 'a real package needs a taught build');
  const linked = join(temporary, 'linked-package');
  cpSync(real, linked, { recursive: true });
  rmSync(real, { recursive: true });
  symlinkSync(linked, real, 'dir');
  const result = build(root);
  assert.equal(result.status, 1, 'the same package behind a symlink still needs a taught build');
  assert.match(result.stderr, /packages\/real/u);
});
