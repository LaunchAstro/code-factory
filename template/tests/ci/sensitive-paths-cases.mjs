// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { sensitiveFiles } from '../../scripts/sensitive-paths.mjs';

// The list is the whole definition of "needs a security review", and it is
// now read by two callers, so the cases live beside the list rather than
// inside either caller's suite.

test('every surface ADR 0046 names is matched', () => {
  const onTheSurface = [
    'packages/core-custody/src/store.ts',
    'packages/core-connectors/src/http.ts',
    'packages/core-runtime/src/loop.ts',
    'apps/worker/src/main.ts',
    'scripts/gate/sweep.py',
    '.husky/pre-commit',
    '.github/workflows/ci.yml',
    'packages/core-app/src/auth-session.ts',
    'packages/core-app/src/tenancy.ts',
    'db/migrations/audit-chain.sql',
    // Sol's review of 69afe53: the keyword used to have to start the file
    // name, so the ordinary numbered form of the same migration slipped past.
    'db/migrations/0003-audit-chain.sql',
    'packages/core-app/src/oauth-callback.ts',
    // The security review of 65dbe59: case and the other module extensions.
    'src/AuditLog.ts',
    'packages/x/OAuthClient.tsx',
    'lib/TenancyGuard.ts',
    'scripts/auth.cjs',
    'src/egress.mts',
    'src/custody.cts',
  ];
  assert.deepEqual(sensitiveFiles(onTheSurface), onTheSurface);
});

test('ordinary files are not on the surface', () => {
  const ordinary = [
    'README.md',
    'docs/adr/0046-merge-mode-machine-proven-merges.md',
    'scripts/check.mjs',
    'scripts/pr-size.mjs',
    'tests/ci/pr-size-cases.sh',
    'packages/core-app/src/authors.md',
    'presets/example.json',
  ];
  assert.deepEqual(sensitiveFiles(ordinary), []);
});

test('the filter keeps only the sensitive ones, in the order given', () => {
  assert.deepEqual(
    sensitiveFiles(['README.md', '.husky/pre-push', 'scripts/check.mjs', 'scripts/gate/sweep.py']),
    ['.husky/pre-push', 'scripts/gate/sweep.py'],
  );
});

// The report is what a reviewer reads before deciding whether the security
// line on the body is honest, so it is run against a real two-branch
// repository rather than trusted to hand the list the right file names.
test('the report names a sensitive file the branch actually touches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sensitive-surface-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    const commit = (path, contents, subject) => {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), contents);
      git('add', path);
      git('commit', '-qm', subject);
    };
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Surface Test');
    git('config', 'user.email', 'surface-test@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    commit('seed.txt', 'seed\n', 'chore: seed');
    const base = git('rev-parse', 'HEAD').trim();
    git('checkout', '-q', '-b', 'ticket/hook');
    commit('.husky/pre-commit', '#!/bin/sh\n', 'feat: a hook');
    const head = git('rev-parse', 'HEAD').trim();
    const run = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, '../../scripts/sensitive-surface.mjs')],
      {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, BASE_SHA: base, HEAD_SHA: head, GITHUB_STEP_SUMMARY: '' },
      },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /1 of 1 changed file\(s\) are on the surface/u);
    assert.match(run.stdout, /- `\.husky\/pre-commit`/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A repository with one commit on `main` and a branch whose changes `change`
// makes; returns the report sensitive-surface.mjs prints for that branch.
const reportFor = (seed, change) => {
  const dir = mkdtempSync(join(tmpdir(), 'sensitive-surface-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Surface Test');
    git('config', 'user.email', 'surface-test@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    for (const [path, contents] of Object.entries(seed)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), contents);
    }
    git('add', '.');
    git('commit', '-qm', 'chore: seed');
    const base = git('rev-parse', 'HEAD').trim();
    change(dir, git);
    git('add', '-A');
    git('commit', '-qm', 'feat: change');
    const run = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, '../../scripts/sensitive-surface.mjs')],
      {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          BASE_SHA: base,
          HEAD_SHA: git('rev-parse', 'HEAD').trim(),
          GITHUB_STEP_SUMMARY: '',
        },
      },
    );
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Sol's review of 69afe53. Git quotes a path holding a byte outside ASCII,
// and the quoted form, `"scripts/gate/caf\303\251.py"`, matched no pattern.
test('a path Git would quote is still on the surface', () => {
  const out = reportFor({ 'seed.txt': 'seed\n' }, (dir) => {
    mkdirSync(join(dir, 'scripts/gate'), { recursive: true });
    writeFileSync(join(dir, 'scripts/gate/café.py'), 'print(1)\n');
  });
  assert.match(out, /1 of 1 changed file\(s\) are on the surface/u);
  assert.match(out, /- `scripts\/gate\/café\.py`/u);
});

// Sol's review of 69afe53. With rename detection only the destination was
// listed, so moving an enforcing hook out of `.husky/` read as no sensitive
// change at all, although the hook stopped running.
test('moving a file off the surface names the file it moved from', () => {
  const out = reportFor({ '.husky/pre-commit': '#!/bin/sh\necho guard\n' }, (dir, git) => {
    mkdirSync(join(dir, 'docs'));
    git('mv', '.husky/pre-commit', 'docs/old-hook');
  });
  assert.match(out, /reviewer of record is asked/u);
  assert.match(out, /- `\.husky\/pre-commit`/u);
});
