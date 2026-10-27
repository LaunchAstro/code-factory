// SPDX-License-Identifier: AGPL-3.0-only
// Cases for release branch references: the dated form is accepted and every other shape rejected.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { validateReleaseRef } from '../../scripts/release-ref.mjs';

test('accepts the dated release branch reference', () => {
  assert.equal(validateReleaseRef('refs/heads/release/2026-09-17'), true);
});

for (const ref of [
  'release/2026-09-17',
  'refs/heads/releases/2026-09-17',
  'refs/heads/release/2026-02-30',
  'refs/heads/release/latest',
  'REFS/HEADS/RELEASE/2026-09-17',
  'Refs/Heads/Release/2026-09-17',
  'refs/heads/RELEASE/2026-09-17',
  'refs/HEADS/release/2026-09-17',
]) {
  test(`rejects ${ref}`, () => {
    assert.equal(validateReleaseRef(ref), false);
  });
}

// Sol's CF-11 review, release-ref-cases.mjs:5: the command itself, not only its function.
test('the command exits 1 on an invalid reference and 0 on the dated one', () => {
  const checker = resolve(import.meta.dirname, '../../scripts/release-ref.mjs');
  const run = (ref) => spawnSync(process.execPath, [checker, ref], { encoding: 'utf8' });
  const invalid = run('refs/heads/release/latest');
  assert.equal(invalid.status, 1, invalid.stdout);
  assert.match(invalid.stdout, /release-ref: invalid/u);
  const valid = run('refs/heads/release/2026-09-17');
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /release-ref: valid/u);
});
