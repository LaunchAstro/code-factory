// SPDX-License-Identifier: AGPL-3.0-only
// Every reference a vendored skill makes must resolve.
//
// Finding 10 of the sweep of 6 September. The vendored skills point at files
// that are not here: two of them link to a reference inside `poteto-mode`,
// which is deliberately excluded, and `blast-radius` calls skills that were
// excluded with it. An agent that follows one of those links finds nothing
// and improvises, which is the failure mode the curated set exists to avoid.
//
// Two rules:
//   1. A relative markdown link from a skill resolves to a file that exists,
//      not a directory.
//   2. No skill points at one this repository deliberately excluded. The
//      exclusions are listed in .claude/skills/_shared/excluded-skills.txt.
//
// Fenced code blocks are stripped first, by the documentation link check's
// CommonMark reader, so tilde fences and an unclosed fence count too: an
// illustration of a file layout is not a reference, and treating it as one
// produces noise that teaches people to ignore this check.
//
// Skills are third-party text, and since the owner decision of 21 September
// 2026 the vendored copies are upstream text (two link edits aside, listed in
// .claude/skills/README.md), so they are exempt from both rules. What is checked is what this repository wrote: _shared/ and
// this directory's README. When none of that is there, exit 2: a run that read
// nothing cannot say every reference resolves.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { unfencedLines } from './doc-links-check.mjs';
import { exitWith } from './main-module.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const skillsRoot = join(repoRoot, '.claude', 'skills');

const MD_LINK = /\[[^\]]*\]\(([^)\s]+)\)/gu;

const excludedFile = join(skillsRootName(), '_shared', 'excluded-skills.txt');

function skillsRootName() {
  return join(repoRoot, '.claude', 'skills');
}

const loadExcluded = () => {
  if (!existsSync(excludedFile)) {
    exitWith(2, `skill-refs: the exclusion list is missing at ${excludedFile}`);
  }
  const names = readFileSync(excludedFile, 'utf8')
    .split('\n')
    .map((l) => l.split('#')[0]?.trim() ?? '')
    .filter(Boolean);
  if (names.length === 0) {
    exitWith(2, 'skill-refs: the exclusion list is empty; this check would pass vacuously.');
  }
  return names;
};

const failures = [];

// A link to a directory, or through a file as if it were one, is not a file.
const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
};

if (!existsSync(skillsRoot)) {
  exitWith(2, `skill-refs: no skills at ${skillsRoot}`);
}

const vendored = new Set(
  readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name),
);

const excluded = loadExcluded();
// Exempt: .claude/skills/** is upstream, edited nowhere, per the owner decision of 21 September 2026.
const files = walk(skillsRoot).filter(
  (file) => !vendored.has(relative(repoRoot, file).split('/')[2] ?? ''),
);
if (files.length === 0) {
  exitWith(2, 'skill-refs: no Markdown file this repository wrote under .claude/skills.');
}
console.log(
  `skill-refs: ${files.length} owned file(s), ${vendored.size} vendored skill(s), ` +
    `${excluded.length} excluded name(s)`,
);

for (const file of files) {
  const rel = relative(repoRoot, file);
  // Strip fenced blocks: an example layout is not a reference.
  const text = unfencedLines(readFileSync(file, 'utf8')).join('\n');

  for (const match of text.matchAll(MD_LINK)) {
    const href = match[1];
    if (href === undefined) continue;
    if (/^[a-z]+:/iu.test(href) || href.startsWith('#') || href.startsWith('mailto:')) continue;
    const target = resolve(dirname(file), href.split('#')[0] ?? href);
    if (!isFile(target))
      failures.push(
        `${rel}: link to ${href} does not resolve to a file.\n` +
          `        An agent following it finds nothing and improvises.`,
      );
  }

  // Files whose job is to explain the exclusions are not pointing at them.
  const EXPLAINS_EXCLUSIONS = new Set([
    '.claude/skills/README.md',
    '.claude/skills/_shared/codex-tools.md',
  ]);
  if (EXPLAINS_EXCLUSIONS.has(rel)) continue;

  for (const name of excluded) {
    const asCommand = new RegExp(`(^|[\\s(\`"'])/${name}\\b`, 'mu');
    const asPath = new RegExp(`[\\s(\`"'(]${name}/`, 'mu');
    // In backticks, which is how these files name a skill when they are not
    // using a leading slash: "run it as an `arena`".
    const inBackticks = new RegExp(`\`${name}\``, 'mu');
    if (asCommand.test(text) || asPath.test(text) || inBackticks.test(text)) {
      failures.push(
        `${rel}: points at ${name}, which this repository deliberately did not\n` +
          `        vendor. An agent following it finds nothing and improvises.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`\nskill-refs: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(
    'skill-refs: fix by pointing at something that exists. The vendored skill\n' +
      'skill-refs: directories are exempt, so a failure here is in a file this\n' +
      'skill-refs: repository wrote and is fixed there.',
  );
  process.exitCode = 1;
} else {
  console.log('skill-refs: every reference resolves.');
}
