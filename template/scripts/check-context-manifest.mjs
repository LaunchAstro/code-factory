// SPDX-License-Identifier: AGPL-3.0-only
// Validate the small manifest used when required hosted check contexts are
// prepared for read-back. Duplicate names are ambiguous and must be refused.

import { readFileSync } from 'node:fs';
import { exitWith, isMainModule } from './main-module.mjs';

export function validateCheckContexts(contexts) {
  if (!Array.isArray(contexts) || contexts.length === 0)
    return ['requiredChecks must be a non-empty array'];
  const problems = [];
  const seen = new Set();
  for (const context of contexts) {
    if (typeof context !== 'string' || context.trim() !== context || context === '') {
      problems.push('every check context must be a non-empty, trimmed string');
      continue;
    }
    if (seen.has(context)) problems.push(`duplicate check context: ${context}`);
    seen.add(context);
  }
  return problems;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    exitWith(2, 'usage: check-context-manifest.mjs MANIFEST.json');
  }
  try {
    const document = JSON.parse(readFileSync(args[0], 'utf8'));
    const contexts = document.requiredChecks;
    const problems = validateCheckContexts(contexts);
    for (const problem of problems) console.error(`check-context-manifest: ${problem}`);
    if (problems.length > 0) process.exitCode = 1;
    else console.log(`check-context-manifest: ${contexts.length} context(s)`);
  } catch {
    console.error('check-context-manifest: unreadable or malformed manifest');
    process.exitCode = 1;
  }
}
