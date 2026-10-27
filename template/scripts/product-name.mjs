// SPDX-License-Identifier: AGPL-3.0-only
// Checks that the first heading of README.md and NOTICE is the name in product.json, and prints
// the heading edit to make where it is not.
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { refuse } from './main-module.mjs';

const root = resolve(import.meta.dirname, '..');
const targets = [
  { file: 'README.md', prefix: '# ' },
  { file: 'NOTICE', prefix: '' },
];

function plainName(name) {
  return (
    typeof name === 'string' &&
    name === name.trim() &&
    /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'’-]*$/u.test(name)
  );
}

// The first line of a target and the line it should be. Only that line is read
// out of the file, and only once it is known to be a plain heading.
function readTarget({ file, prefix }, name) {
  const path = resolve(root, file);
  if (!lstatSync(path).isFile()) refuse('product-name', file, 'must be a regular file, not a link');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) refuse('product-name', file, 'must be a regular file');
    const bytes = readFileSync(fd);
    const newline = bytes.indexOf(10);
    const end = newline < 0 ? bytes.length : newline - (bytes[newline - 1] === 13 ? 1 : 0);
    const heading = bytes.subarray(0, end).toString('utf8');
    if (!heading.startsWith(prefix) || !plainName(heading.slice(prefix.length))) {
      refuse('product-name', file, 'needs a plain product name on its first line');
    }
    return { file, heading, wanted: prefix + name };
  } finally {
    closeSync(fd);
  }
}

// Check only, by the orchestrator's ruling of 3 October (ORCH73 79CUT): every
// way of writing the two files found by Sol's reviews of CF-10 could lose an
// edit made while it ran, and the edit is one line a person makes by hand.
function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    refuse('product-name', 'usage', 'node scripts/product-name.mjs [--check]');
  }
  const source = readFileSync(resolve(root, 'product.json'), 'utf8');
  if (!/^\s*\{\s*"name"\s*:\s*"(?:[^"\\]|\\.)*"\s*\}\s*$/u.test(source)) {
    refuse('product-name', 'product.json', 'must contain exactly one literal "name" string member');
  }
  const metadata = JSON.parse(source);
  if (!plainName(metadata.name)) {
    refuse('product-name', 'product.json', 'must contain only a trimmed, single-line plain name');
  }

  const differ = targets
    .map((target) => readTarget(target, metadata.name))
    .filter(({ heading, wanted }) => heading !== wanted);
  if (differ.length === 0) {
    console.log('product-name: headings match');
    return;
  }
  console.error('product-name: headings differ from product.json. Edit the first line of:');
  for (const { file, heading, wanted } of differ) {
    console.error(`  ${file}\n    now:    ${heading}\n    wanted: ${wanted}`);
  }
  process.exitCode = 1;
}

try {
  main();
} catch {
  // What is left is a read that failed, and its message names the absolute path.
  refuse('product-name', 'product.json, README.md or NOTICE', 'could not be read');
}
