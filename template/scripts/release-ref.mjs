// SPDX-License-Identifier: AGPL-3.0-only
// Release automation accepts only the dated branch shape protected by the
// repository ruleset. Validate it before a caller constructs a GitHub request.

import { exitWith, isMainModule } from './main-module.mjs';

const RELEASE_REF = /^refs\/heads\/release\/(?<date>\d{4}-\d{2}-\d{2})$/u;

export function validateReleaseRef(ref) {
  const match = RELEASE_REF.exec(ref);
  if (match?.groups === undefined) return false;
  const date = match.groups.date;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    exitWith(2, 'usage: release-ref.mjs refs/heads/release/YYYY-MM-DD');
  }
  const valid = validateReleaseRef(args[0]);
  console.log(`release-ref: ${valid ? 'valid' : 'invalid'}`);
  if (!valid) process.exitCode = 1;
}
