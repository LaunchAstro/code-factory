// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the check-step gate: every step named in check.mjs resolves to a package script.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { checkStepReferences } from '../../scripts/check-step-refs.mjs';
import { STEPS } from '../../scripts/check.mjs';

const scripts = resolve(import.meta.dirname, '../../scripts');

test('reports a named check step with no package script', () => {
  const steps = [
    ['typecheck', 'types'],
    ['missing', 'missing'],
  ];
  assert.deepEqual(checkStepReferences({ typecheck: 'tsc' }, steps), {
    steps: ['typecheck', 'missing'],
    missing: ['missing'],
  });
});

test('accepts check steps backed by package scripts', () => {
  const steps = [
    ['typecheck', 'types'],
    ['test', 'tests'],
  ];
  assert.deepEqual(checkStepReferences({ typecheck: 'tsc', test: 'vitest run' }, steps), {
    steps: ['typecheck', 'test'],
    missing: [],
  });
});

test('the aggregate runner runs the gate itself, not only its cases', () => {
  const { steps } = checkStepReferences({}, STEPS);
  assert.ok(steps.includes('check:steps:cases'), 'the cases are wired');
  assert.ok(steps.includes('check:steps'), 'the repository-facing gate is wired');
});

/** The command, run in a throwaway repository with this runner source. */
const command = (checkSource, packageScripts) => {
  const dir = mkdtempSync(join(tmpdir(), 'check-step-refs-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    for (const file of ['check-step-refs.mjs', 'main-module.mjs']) {
      copyFileSync(join(scripts, file), join(dir, 'scripts', file));
    }
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: packageScripts ?? { existing: 'x' } }),
    );
    writeFileSync(join(dir, 'scripts/check.mjs'), checkSource);
    return spawnSync(process.execPath, [join(dir, 'scripts/check-step-refs.mjs')], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Sol's CF-09 review. The runner is read as the module it is, so any quoting
// JavaScript allows is a step, and a runner with no steps is no input at all.
test('a double-quoted step still reports its missing script', () => {
  const run = command('export const STEPS = [["missing", "required gate"]];\n');
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /missing script missing/u);
});

test('an empty runner is refused by the command', () => {
  const run = command('export const STEPS = [];\n');
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.doesNotMatch(run.stdout, /every named step resolves/u);
});

// Sol's CF-09 second round: `map` and `filter` skip a hole, so `[,]` read as
// one named step with nothing missing.
test('a sparse runner names a step it cannot run', () => {
  const sparse = [];
  sparse[1] = ['existing', 'x'];
  assert.deepEqual(checkStepReferences({ existing: 'x' }, sparse).missing, [undefined]);
  const run = command('export const STEPS = [,];\n');
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.doesNotMatch(run.stdout, /every named step resolves/u);
});

// Sol's CF-09 third round: `Array.from` read an array-like object as one step,
// but the runner iterates STEPS and throws `STEPS is not iterable`. Only a real
// array is a runner.
test('a runner whose STEPS is not an array is refused', () => {
  const arrayLike = { 0: ['existing', 'x'], length: 1 };
  assert.deepEqual(checkStepReferences({ existing: 'x' }, arrayLike).steps, []);
  const run = command('export const STEPS = { 0: ["existing", "x"], length: 1 };\n');
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.doesNotMatch(run.stdout, /every named step resolves/u);
});

// Sol's CF-09-FIX8: an own property was enough, so `scripts: { required: null }`
// resolved although pnpm refuses it as a missing script. A named script is a
// non-empty string, and a scripts field that is not an object names none.
test('a named script that is not a non-empty string is missing', () => {
  const steps = [['required', 'required gate']];
  for (const value of [null, '', 0, true, ['x'], { run: 'x' }]) {
    assert.deepEqual(
      checkStepReferences({ required: value }, steps).missing,
      ['required'],
      JSON.stringify(value),
    );
  }
  for (const table of [null, 'required', ['x'], 1]) {
    assert.deepEqual(
      checkStepReferences(table, steps).missing,
      ['required'],
      JSON.stringify(table),
    );
  }
});

test('a null package script is refused by the command', () => {
  const source = 'export const STEPS = [["required", "required gate"]];\n';
  const control = command(source, { required: 'node -e 0' });
  assert.equal(control.status, 0, control.stdout + control.stderr);
  for (const table of [{ required: null }, { required: '' }, ['node -e 0']]) {
    const run = command(source, table);
    assert.equal(run.status, 1, JSON.stringify(table) + run.stdout + run.stderr);
    assert.match(run.stderr, /missing script required/u);
    assert.doesNotMatch(run.stdout, /every named step resolves/u);
  }
});
