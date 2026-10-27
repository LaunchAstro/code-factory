// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { git } from './check-runner-fixture.mjs';

const template = resolve(import.meta.dirname, '../..');

// Importing check.mjs must run nothing, and this file cannot learn that by
// importing it: a check.mjs that runs its checks on import ends them in
// process.exit, before a single test here exists, and a file that exits 0
// with no tests looks like a pass (Sol, CF-03). So a child imports it first,
// with no pnpm handed down, and says so only if the import came back. This
// file imports it only after that.
const IDLE = 'imported, nothing ran';
const probeEnv = { ...process.env };
delete probeEnv['npm_execpath'];
const probe = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `await import(${JSON.stringify(new URL('../../scripts/check.mjs', import.meta.url).href)}); process.stdout.write(${JSON.stringify(IDLE)});`,
  ],
  { env: probeEnv, encoding: 'utf8', timeout: 120_000 },
);
const importIsIdle = probe.status === 0 && probe.stdout.endsWith(IDLE);
const { formatDuration } = importIsIdle
  ? await import('../../scripts/check.mjs')
  : { formatDuration: () => 'check.mjs was not imported' };

// The boundaries are the whole interesting part: the two places the unit
// changes, and the rounding on either side of each of them.
const cases = [
  [0, '0ms'],
  [1, '1ms'],
  [999, '999ms'],
  [1000, '1s'],
  [1499, '1s'],
  [1500, '2s'],
  [59_400, '59s'],
  [59_600, '1m 0s'],
  [60_000, '1m 0s'],
  [89_000, '1m 29s'],
  [125_000, '2m 5s'],
  [3_600_000, '60m 0s'],
];

for (const [ms, expected] of cases) {
  test(`${ms}ms reads as ${expected}`, () => {
    assert.equal(formatDuration(ms), expected);
  });
}

test('importing the runner does not run the checks', () => {
  assert.ok(
    importIsIdle,
    `importing scripts/check.mjs did not come back idle: exit ${probe.status}, ${probe.stdout.slice(-200)}`,
  );
});

// Sol's review CF-03, finding 16. The case above stayed green with check.mjs
// running every step on import, because the run ended in process.exit(0)
// before a single test was registered. So this file is run against a copy of
// the scripts whose guard is gone, with a pnpm that passes every step, and it
// has to go red. The copy runs without this case, or it would copy itself.
test(
  'the import-safety case goes red when check.mjs runs its checks on import',
  { skip: process.env['CHECK_CASES_MUTANT'] === '1' },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-cases-mutant-'));
    try {
      cpSync(join(template, 'scripts'), join(dir, 'scripts'), { recursive: true });
      mkdirSync(join(dir, 'tests/ci'), { recursive: true });
      const copy = join(dir, 'tests/ci/check-runner-cases.mjs');
      cpSync(import.meta.filename, copy);
      cpSync(
        join(import.meta.dirname, 'check-runner-fixture.mjs'),
        join(dir, 'tests/ci/check-runner-fixture.mjs'),
      );
      const check = join(dir, 'scripts/check.mjs');
      const guard = 'if (isMainModule(import.meta.url)) {';
      const source = readFileSync(check, 'utf8');
      assert.ok(source.includes(guard), 'the guard this case removes is no longer in check.mjs');
      writeFileSync(check, source.replace(guard, 'if (true) {'));
      mkdirSync(join(dir, 'bin'));
      writeFileSync(join(dir, 'bin/pnpm'), '#!/bin/sh\n: > "$MUTANT_MARKER"\n', { mode: 0o755 });
      // The runner runs no step on a tree Git cannot observe, so the copy is a
      // clean commit, and its marker is ignored so the run on import is green.
      writeFileSync(join(dir, '.gitignore'), 'checks-ran\n');
      for (const args of [
        ['init', '-q'],
        ['add', '.'],
        ['commit', '-qm', 'mutant'],
      ]) {
        assert.equal(git(dir, ...args).status, 0);
      }
      const marker = join(dir, 'checks-ran');
      const env = {
        ...process.env,
        PATH: `${join(dir, 'bin')}:${process.env['PATH'] ?? ''}`,
        CHECK_CASES_MUTANT: '1',
        MUTANT_MARKER: marker,
      };
      delete env['npm_execpath'];
      const run = spawnSync(process.execPath, [copy], { env, encoding: 'utf8', timeout: 120_000 });
      assert.ok(existsSync(marker), 'the copy never ran its checks, so this case proved nothing');
      assert.notEqual(
        run.status,
        0,
        'the cases stayed green while check.mjs ran its checks on import',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
