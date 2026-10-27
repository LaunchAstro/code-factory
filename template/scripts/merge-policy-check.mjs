// SPDX-License-Identifier: AGPL-3.0-only
// One rule, checked: nothing merges itself.
//
// Finding 8 of the sweep of 6 September. CONTRIBUTING.md allows no automatic
// merges and makes a merge its decide step, while renovate.json enabled
// automatic merging of development dependency patches. A build tool can change
// shipped output, so "only a dev dependency" is not a reason to skip the
// decide step.
//
// Documentation that contradicts configuration is worse than either alone: a
// reader believes the documentation and the machine obeys the configuration.
// So the rule is a check.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { exitWith, refuse } from './main-module.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const failures = [];

const renovatePath = join(repoRoot, 'renovate.json');
let renovate;
try {
  renovate = JSON.parse(readFileSync(renovatePath, 'utf8'));
} catch {
  // A parse error quotes the text around where it stopped, whatever that holds.
  refuse('merge-policy', 'renovate.json', 'cannot be read, or is not JSON');
}

// A document that is not an object holds no policy to check. Sol's review of
// 69afe53 found `null` skipped and reported as checked.
if (renovate === null || typeof renovate !== 'object' || Array.isArray(renovate)) {
  exitWith(1, 'merge-policy: renovate.json is not an object, so it holds no policy to check.');
}

// A preset sets whatever its own definition sets, and this check cannot read
// it. Sol's review of 69afe53 found `:automergeAll` passing because only
// literal keys were inspected. So a preset is accepted only once somebody has
// read its definition and found no automerge in it, and it is named here.
// Adding one is a change to this list, with the reason beside it.
const CHECKED_PRESETS = new Set([
  'config:recommended', // dependency dashboard, groups, replacements: no automerge
  ':semanticCommits', // commit message style only
]);

const walk = (node, path) => {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child, i) => walk(child, `${path}[${i}]`));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    const here = path === '' ? key : `${path}.${key}`;
    if (key === 'extends') {
      if (!Array.isArray(value) || value.some((preset) => typeof preset !== 'string')) {
        failures.push(`renovate.json: ${here} is not a list of preset names.`);
      } else {
        for (const preset of value.filter((name) => !CHECKED_PRESETS.has(name))) {
          failures.push(
            `renovate.json: ${here} names ${preset}, which this check has not read.\n` +
              '        A preset can turn automerge on (`:automergeAll` does). Read its\n' +
              '        definition, and add it to CHECKED_PRESETS only if nothing in it merges.',
          );
        }
      }
      continue;
    }
    if ((key === 'automerge' || key === 'platformAutomerge') && value === true) {
      failures.push(
        `renovate.json: ${here} is true.\n` +
          '        CONTRIBUTING.md says checks never merge anything by themselves\n' +
          '        and AGENTS.md says merge is a human decision. Either turn this\n' +
          '        off, or change both documents and say why in an ADR.',
      );
    }
    walk(value, here);
  }
};

walk(renovate, '');

console.log('merge-policy: checked renovate.json and its presets for automatic merging');

if (failures.length > 0) {
  console.error(`\nmerge-policy: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  process.exitCode = 1;
} else {
  console.log('merge-policy: nothing merges itself.');
}
