// SPDX-License-Identifier: AGPL-3.0-only
// A preset is data, and this is the check docs/licensing/preset-boundary.md
// promises.
//
// The document says the rule is enforced in continuous integration when a
// preset exists. That is the wrong order: a rule that arrives after the first
// preset is a rule the first preset was written without, and the first preset
// is the one every later preset is copied from. So the check comes first and
// reports honestly on an empty directory.
//
// Three rules, over what git tracks under `presets/`:
//
//   1. The name is `.gitkeep`, or the extension is `.md` or `.json`.
//      Executable code of any kind is outside the boundary, and an extension
//      is the cheapest honest reading of what a file is.
//   2. A `.json` parses, and its top-level value is an object. A preset
//      describes a way of working; a bare array or a number does not.
//   3. Nothing is a symbolic link. A link is a path to somewhere else, and
//      the boundary is about a directory.
//
// Only tracked files count, read from the index, so the check judges what a
// pull request carries rather than what a working tree happens to hold. A
// repository git cannot list is refused (exit 2), never an empty pass.
//
// Usage:
//   node scripts/preset-boundary-check.mjs [repository-root]

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, extname, resolve } from 'node:path';
import { localEnv } from './candidate-snapshot.mjs';
import { exitWith, isMainModule } from './main-module.mjs';
import { readObject } from './public-content-check.mjs';

// Kept out of the preset count: it exists to keep an empty directory in git,
// and it is not a preset.
const KEEP = '.gitkeep';

const ALLOWED_EXTENSIONS = new Set(['.md', '.json']);

/** Git records a symbolic link with this mode in `ls-files -s`. */
const SYMLINK_MODE = '120000';

/**
 * Every finding over the preset entries, one line each, beginning with the
 * path's fingerprint, `<withheld-path xxxxxxxx/N>` as public-content prints:
 * a tracked name can hold a credential or a line CI reads as a command, so no
 * part of it is printed. `entries` are `{ path, symlink, text }`, where `text`
 * is null for a link, which has no contents this rule is about.
 */
export function presetFindings(entries) {
  const findings = [];
  for (const { path, symlink, text, stage = '0' } of entries) {
    const shown = `<withheld-path ${createHash('sha256').update(path).digest('hex').slice(0, 8)}/${path.length}>`;
    if (stage !== '0') {
      findings.push(`${shown}: an unresolved merge (stage ${stage}) is no single preset`);
      continue;
    }
    if (symlink) {
      findings.push(`${shown}: a symbolic link can point outside the preset boundary`);
      continue;
    }

    if (basename(path) === KEEP) continue;

    const extension = extname(path);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      findings.push(`${shown}: a preset is data, and only .md or .json is`);
      continue;
    }

    if (extension !== '.json') continue;

    let value;
    try {
      value = JSON.parse(text ?? '');
    } catch {
      findings.push(`${shown}: not parseable as JSON`);
      continue;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      findings.push(`${shown}: the top-level value is not an object`);
    }
  }
  return findings;
}

/**
 * One `git ls-files -s -z` record, which is `<mode> <object> <stage>`, then a
 * tab, then the path. Only the first tab separates. A tracked path may hold a
 * tab of its own, and splitting at every tab would shorten such a name into a
 * different one, which is how `presets/safe.md\trun.sh` would be read as the
 * `presets/safe.md` the rules allow and its `.sh` never refused.
 */
export function parseRecord(record) {
  const separator = record.indexOf('\t');
  if (separator === -1) {
    throw new Error(`preset-boundary: git listed a record with no path: ${record}`);
  }
  const [mode, object, stage] = record.slice(0, separator).split(' ');
  return { path: record.slice(separator + 1), symlink: mode === SYMLINK_MODE, object, stage };
}

/** What git tracks under `presets/`, with the mode git recorded for it. */
function trackedPresets(root) {
  // Local, so no credential, and replacement refs never stand in for the bytes
  // the index names. Nor do other bytes stored under their id: readObject
  // checks them against it.
  const git = (...args) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: localEnv });
  return git('ls-files', '-s', '-z', '--', 'presets/')
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const { path, symlink, object, stage } = parseRecord(record);
      const text = symlink ? null : readObject(root, 'blob', object).toString('utf8');
      return { path, symlink, stage, text };
    })
    .toSorted((a, b) => a.path.localeCompare(b.path));
}

if (isMainModule(import.meta.url)) {
  const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..'));
  let entries;
  try {
    entries = trackedPresets(root);
  } catch {
    exitWith(2, 'preset-boundary: git could not list or read the presets; nothing was checked.');
  }
  const findings = presetFindings(entries);

  const presets = entries.filter(({ path }) => basename(path) !== KEEP).length;
  console.log(`preset-boundary: ${presets} preset file(s)`);

  if (findings.length > 0) {
    for (const finding of findings) console.error(`preset-boundary: ${finding}`);
    console.error(
      '\npreset-boundary: a preset that can run code or reach past the published\n' +
        'preset-boundary: formats is a security surface and a support burden, and it\n' +
        'preset-boundary: is outside the boundary docs/licensing/preset-boundary.md draws.',
    );
    process.exitCode = 1;
  } else {
    console.log('preset-boundary: every preset is data.');
  }
}
