// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the required-check context manifest: distinct context names accepted, duplicates and
// malformed shapes refused.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { validateCheckContexts } from '../../scripts/check-context-manifest.mjs';

test('accepts distinct hosted check context names', () => {
  assert.deepEqual(validateCheckContexts(['local checks', 'pull request size']), []);
});

test('refuses a duplicate hosted check context', () => {
  assert.deepEqual(validateCheckContexts(['local checks', 'local checks']), [
    'duplicate check context: local checks',
  ]);
});

test('refuses empty, untrimmed and non-array inputs', () => {
  assert.deepEqual(validateCheckContexts([]), ['requiredChecks must be a non-empty array']);
  assert.deepEqual(validateCheckContexts([' local checks', '']), [
    'every check context must be a non-empty, trimmed string',
    'every check context must be a non-empty, trimmed string',
  ]);
  assert.deepEqual(validateCheckContexts('local checks'), [
    'requiredChecks must be a non-empty array',
  ]);
});

const cli = resolve(import.meta.dirname, '../../scripts/check-context-manifest.mjs');

const runCli = (document) => {
  const dir = mkdtempSync(join(tmpdir(), 'check-context-manifest-'));
  try {
    const manifest = join(dir, 'manifest.json');
    writeFileSync(manifest, typeof document === 'string' ? document : JSON.stringify(document));
    return spawnSync(process.execPath, [cli, manifest], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('the command refuses a manifest that names the same context twice', () => {
  const run = runCli({ requiredChecks: ['local checks', 'local checks', 'pull request size'] });
  assert.equal(run.status, 1, run.stdout);
  assert.match(run.stderr, /duplicate check context: local checks/u);
});

test('the command refuses a manifest whose requiredChecks is a string', () => {
  const run = runCli({ requiredChecks: 'abc' });
  assert.equal(run.status, 1, run.stdout);
  assert.match(run.stderr, /requiredChecks must be a non-empty array/u);
});

test('the command accepts a manifest of distinct contexts', () => {
  const run = runCli({ requiredChecks: ['local checks', 'pull request size'] });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /check-context-manifest: 2 context\(s\)/u);
});

// Sol's CF-09 review: nothing here tried a manifest the command cannot parse or
// read, so its refusal could become a pass with every case still green.
test('the command refuses a manifest that is not JSON', () => {
  const run = runCli('{"requiredChecks": ["local checks"');
  assert.equal(run.status, 1, run.stdout);
  assert.match(run.stderr, /unreadable or malformed manifest/u);
});

test('the command refuses a manifest it cannot read', () => {
  const absent = join(tmpdir(), 'check-context-manifest-absent', 'manifest.json');
  const run = spawnSync(process.execPath, [cli, absent], { encoding: 'utf8' });
  assert.equal(run.status, 1, run.stdout);
  assert.match(run.stderr, /unreadable or malformed manifest/u);
});
