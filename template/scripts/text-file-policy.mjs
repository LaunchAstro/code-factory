// SPDX-License-Identifier: AGPL-3.0-only
// Owned text files stay portable: non-empty UTF-8 bytes, no byte order mark or
// NUL, and a final line ending for readable diffs. No tracked owned file at
// all is a refusal, exit 2: a run that read nothing certifies nothing.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exitWith, isMainModule } from './main-module.mjs';

const OWNED_PATHS = [
  'README.md',
  'NOTICE',
  'AGENTS.md',
  'AI_POLICY.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'GOVERNANCE.md',
  'SECURITY.md',
  'package.json',
  'renovate.json',
  'tsconfig.json',
  '.github',
  'docs',
  'scripts',
  'tests',
];

export function textFileFindings(entries) {
  const findings = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const { path, bytes } of entries) {
    if (bytes.length === 0) findings.push(`${path}: empty`);
    if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
      findings.push(`${path}: byte order mark`);
    if (bytes.includes(0)) findings.push(`${path}: NUL byte`);
    try {
      decoder.decode(bytes);
    } catch {
      findings.push(`${path}: invalid UTF-8`);
    }
    if (bytes.length > 0 && bytes.at(-1) !== 0x0a) findings.push(`${path}: no final newline`);
  }
  return findings;
}

if (isMainModule(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..');
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', ...OWNED_PATHS], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  if (files.length === 0) {
    exitWith(2, `text-file-policy: no tracked owned text file under ${root} to check.`);
  }
  const findings = textFileFindings(
    files.map((path) => ({ path, bytes: readFileSync(resolve(root, path)) })),
  );
  for (const finding of findings) console.error(`text-file-policy: ${finding}`);
  console.log(
    `text-file-policy: ${files.length} owned text file(s), ${findings.length} finding(s)`,
  );
  if (findings.length > 0) process.exitCode = 1;
}
