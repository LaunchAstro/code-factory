// SPDX-License-Identifier: AGPL-3.0-only
// The local version selector and package engine floor describe one Node
// policy. Refuse drift before local and hosted checks run on different majors.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainModule, readJson, refuse } from './main-module.mjs';

export function checkNodePolicy(nvmrc, engine) {
  const selected = nvmrc.trim();
  const selectedMatch = /^(?<major>[1-9]\d*)$/u.exec(selected);
  // A regular expression coerces what it is given, so `[">=24"]` would match.
  const engineMatch = typeof engine === 'string' ? /^>=(?<major>[1-9]\d*)$/u.exec(engine) : null;
  const problems = [];
  if (selectedMatch?.groups === undefined)
    problems.push('.nvmrc must contain one positive major version');
  if (engineMatch?.groups === undefined)
    problems.push('engines.node must be an exact >= major floor');
  if (
    selectedMatch?.groups !== undefined &&
    engineMatch?.groups !== undefined &&
    selectedMatch.groups.major !== engineMatch.groups.major
  )
    problems.push('.nvmrc and engines.node must name the same major');
  return problems;
}

if (isMainModule(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..');
  const selected = readFileSync(resolve(root, '.nvmrc'), 'utf8');
  let packageJson;
  try {
    packageJson = readJson(readFileSync(resolve(root, 'package.json'), 'utf8'));
  } catch {
    refuse('node-policy', 'package.json', 'is missing, not a JSON object, or repeats a key');
  }
  const problems = checkNodePolicy(selected, packageJson.engines?.node ?? '');
  for (const problem of problems) console.error(`node-policy: ${problem}`);
  if (problems.length > 0) process.exitCode = 1;
  else console.log(`node-policy: Node ${selected.trim()} is selected and required.`);
}
