// SPDX-License-Identifier: AGPL-3.0-only
// Keep the check runner and package scripts in lockstep. A named check step
// that has no package script fails only when the runner reaches it, which is
// late and gives a much less useful error than naming the stale reference.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STEPS } from './check.mjs';
import { isMainModule } from './main-module.mjs';

// The runner's own STEPS, imported, so the steps are read by JavaScript and
// not by a pattern: a pattern for single quotes missed `["missing", "x"]`.
// `Array.from` visits a hole where `map` skips it, so `[,]` is one step with
// no name rather than one step that resolves: Sol's CF-09 second round. Only a
// real array is read, because the runner iterates STEPS and an array-like
// object throws there: Sol's CF-09 third round. A step resolves only to a
// non-empty string command, pnpm's own rule: `{ required: null }` is a missing
// script to pnpm, so it is one here (Sol's CF-09-FIX8).
export function checkStepReferences(packageScripts, steps) {
  const table =
    packageScripts !== null && typeof packageScripts === 'object' && !Array.isArray(packageScripts)
      ? packageScripts
      : {};
  const names = Array.isArray(steps)
    ? Array.from(steps, (step) => (Array.isArray(step) ? step[0] : undefined))
    : [];
  const missing = names.filter(
    (name) =>
      typeof name !== 'string' ||
      !Object.hasOwn(table, name) ||
      typeof table[name] !== 'string' ||
      table[name] === '',
  );
  return { steps: names, missing };
}

if (isMainModule(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..');
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const result = checkStepReferences(packageJson.scripts ?? {}, STEPS);

  console.log(`check-step-refs: ${result.steps.length} named step(s)`);
  for (const step of result.missing) console.error(`check-step-refs: missing script ${step}`);
  // A runner with no steps is no input, not a runner whose steps all resolve.
  if (result.steps.length === 0) {
    console.error('check-step-refs: the runner names no step, or STEPS is not an array.');
  }
  if (result.missing.length > 0 || result.steps.length === 0) process.exitCode = 1;
  else console.log('check-step-refs: every named step resolves to a package script.');
}
