// SPDX-License-Identifier: AGPL-3.0-only
// Every Action pinned to a commit, and every pin written down.
//
// Finding 20 of the sweep of 6 September had two halves. The download half is
// fixed in the workflow itself: the gitleaks archive is verified against a
// published digest before anything is extracted. This is the other half.
//
// A full commit hash is sound syntax. It is not verification: a hash proves
// only that the bytes have not changed since somebody wrote the hash down,
// and says nothing about whether the right thing was written down. So the
// repository keeps a record of where each pin came from and how it was
// checked, and this script fails when a workflow and that record disagree.
//
// Two rules:
//   1. Every `uses:` in .github/workflows is pinned: an action to a 40
//      character commit hash, a docker image to a sha256 digest. A tag can be
//      moved; a hash cannot.
//   2. Every pin has a row in docs/supply-chain-pins.md naming that action,
//      that pin and how it was checked. A pin nobody recorded is a pin nobody
//      verified, and a hash recorded for another action proves nothing here.
//
// It reads YAML without a parser, because it runs in the contamination gate
// before anything is installed. scripts/yaml-subset.mjs is that reader, and
// the dependency check reads workflows through it too, so the two cannot
// disagree about a key. It reads one narrow shape exactly and refuses the
// rest with exit 2, naming the file and line, rather than guessing. Every
// `uses` key outside a block scalar is a reference, and its value is one
// scalar on the key's line; a block scalar (`uses: |-`) is refused, however
// many lines it has. A workflow with no top-level key, and a workflow
// set with no reference at all, are refused too: a check that found nothing
// to check has not passed.
//
// A finding names the file and line, never the reference: a reference can
// carry a credential (`docker://user:token@host`), and output is not where
// one belongs. A file name can carry one too, so a workflow is named by the
// first eight hex digits of the sha256 of its path (`.github/workflows/x.yml`),
// refusals included, and a file it cannot read (a broken symlink) is refused
// under that fingerprint.
//
// The record is read by its header: each table's Action, Commit and Verified
// columns are found by name, a row with more or fewer cells than its header
// is refused, and so is a header with no rule under it. A Verified cell that
// shows no letter or digit once `*`, `_`, `~` and backticks are gone verifies
// nothing and is named. Only a row the page shows counts, so the record is
// read in a closed grammar rather than by copying GitHub's rendering. Before
// any row is read, the whole record is refused if it holds a control
// character (a CR, a tab or a C1 control), an invisible character, a
// space that is not a plain one, a `<`, a `\`, an `&`, a `[` or a `]` (link
// and image syntax), or a line that starts a code fence after any list or
// quote markers, or if it opens with front matter.
// A table starts at the top or after a blank line; GitHub shows one straight
// after a quote, list or paragraph line as that line's text, so it is refused.
// A row indented four spaces is code, not read. A table ends at a blank line:
// any other line straight after a row is refused, since GitHub would keep it
// in the table. In a row, a backtick may only be a code span filling its cell.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { exitWith } from './main-module.mjs';
import { YamlRefusal, readWorkflow, valuesOf } from './yaml-subset.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const workflowDir = join(repoRoot, '.github', 'workflows');
const recordPath = join(repoRoot, 'docs', 'supply-chain-pins.md');

// An action reference holds no `:`, so a docker image cannot pass with a commit hash.
const PINNED = /^(?:docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}|[^@\s:]+@[0-9a-f]{40})$/u;

/** A refusal to read: exit 2, never a finding. */
class Unreadable extends Error {}

/** A workflow by its path's fingerprint, never its name, which can carry a credential. */
const shown = (file) =>
  `workflow ${createHash('sha256').update(`.github/workflows/${file}`).digest('hex').slice(0, 8)}`;

/** Every `uses` reference in one workflow as { ref, where }. Throws Unreadable outside the shape. */
function references(file) {
  let text;
  try {
    text = readFileSync(join(workflowDir, file), 'utf8');
  } catch {
    throw new Unreadable(`${shown(file)}: this check cannot read this file.`);
  }
  const lines = text.split(/\r?\n/u);
  try {
    return [...valuesOf(readWorkflow(text), (key) => key === 'uses')].map(({ value, line }) => {
      // The reader accepted the key's line, so it reads `[- ]uses: <value>`.
      if (typeof value !== 'string' || /^[ -]*uses: +\|/u.test(lines[line - 1]))
        throw new YamlRefusal(
          line,
          "this check cannot read this uses value. Write it on the key's line.",
        );
      return { ref: value, where: `${shown(file)}:${line}` };
    });
  } catch (error) {
    if (error instanceof YamlRefusal) throw new Unreadable(error.at(shown(file)));
    throw error;
  }
}

/** The record's rows as { action, pin, verified, line }, each table read by its header. */
function recordRows(text) {
  const lines = text.split('\n');
  const fail = (index, why) => {
    throw new Unreadable(`docs/supply-chain-pins.md:${index + 1}: ${why}`);
  };
  for (const [index, line] of lines.entries()) {
    if (/(?! )[\p{Cc}\p{Cf}\p{Z}\p{Default_Ignorable_Code_Point}]/u.test(line))
      fail(index, 'holds a control character, a tab, an invisible character or an unusual space.');
    if (line.includes('<')) fail(index, 'holds HTML or a <, which this check cannot read.');
    if (/[\\&]/u.test(line))
      fail(index, 'holds a backslash or an &, which this check cannot read.');
    if (/[[\]]/u.test(line)) fail(index, 'holds a [ or a ], which this check cannot read.');
    if (/^[ >*+\-\d.)]*(?:`{3}|~{3})/u.test(line)) fail(index, 'has a code fence.');
  }
  if (/^---\s*$/u.test(lines[0]))
    fail(0, 'starts with front matter, which GitHub does not show as a table.');
  const rows = [];
  let header;
  const unruled = () => {
    if (header?.ruled === false) fail(header.index, 'is a table header with no rule under it.');
  };
  for (const [index, line] of lines.entries()) {
    if (!/^ {0,3}\|/u.test(line)) {
      unruled();
      if (header !== undefined && line.trim() !== '')
        fail(index, 'follows a table row but is not a row; end a table with a blank line.');
      header = undefined;
      continue;
    }
    if (!line.trim().endsWith('|')) fail(index, 'a table row must end with |.');
    const cells = line
      .trim()
      .slice(1, -1)
      .split('|')
      .map((cell) => {
        const value = cell.trim();
        if (value.includes('`') && !/^`[^`]+`$/u.test(value))
          fail(index, 'has a backtick that is not one code span filling its cell.');
        return value.replaceAll('`', '').trim();
      });
    if (header === undefined) {
      if (index > 0 && lines[index - 1].trim() !== '')
        fail(index, 'starts a table straight after a line that is not blank.');
      if (new Set(cells).size !== cells.length) fail(index, 'names a column twice.');
      header = { cells, ruled: false, index };
    } else if (cells.length !== header.cells.length)
      fail(index, `has ${cells.length} cells under a header of ${header.cells.length}.`);
    else if (!header.ruled) {
      if (!cells.every((cell) => /^:?-+:?$/u.test(cell))) unruled();
      header.ruled = true;
    } else {
      const cell = (name) => cells[header.cells.indexOf(name)];
      rows.push({
        action: cell('Action'),
        pin: cell('Commit'),
        verified: cell('Verified'),
        line: index + 1,
      });
    }
  }
  unruled();
  return rows;
}

/** Whether a Verified cell shows a letter or a digit once its emphasis marks are gone. */
const shows = (verified) => /[\p{L}\p{N}]/u.test(verified.replaceAll(/[*_~]/gu, ''));

const NAMING = '(a workflow is named by the first eight hex digits of the sha256 of its path)';

/** Print each unreadable input and stop with exit 2. */
function refuse(messages) {
  exitWith(
    2,
    `\npins: ${messages.length} input(s) this check cannot read ${NAMING}\n`,
    ...messages.map((message) => `  ${message}\n`),
  );
}

const failures = [];
const pins = new Map();

if (!existsSync(workflowDir)) {
  exitWith(2, `pins: no workflow directory at ${workflowDir}`);
}

const workflows = readdirSync(workflowDir).filter((f) => /\.ya?ml$/u.test(f));
if (workflows.length === 0) {
  exitWith(2, 'pins: no workflows found; this check would pass vacuously.');
}

const unreadable = [];
const found = workflows.flatMap((file) => {
  try {
    return references(file);
  } catch (error) {
    if (!(error instanceof Unreadable)) throw error;
    unreadable.push(error.message);
    return [];
  }
});
if (unreadable.length > 0) refuse(unreadable);
if (found.length === 0) {
  exitWith(2, 'pins: no action reference in any workflow; this check would pass vacuously.');
}

for (const { ref, where } of found) {
  if (ref.startsWith('./')) continue;
  if (!PINNED.test(ref)) {
    failures.push(
      `${where}: this reference is not pinned to a 40 character commit hash, or a docker image\n` +
        '        to a sha256 digest. A tag can be moved by whoever owns it. A hash cannot.',
    );
    continue;
  }
  pins.set(ref, where);
}

console.log(`pins: ${pins.size} pinned action reference(s) across ${workflows.length} workflow(s)`);

if (!existsSync(recordPath)) {
  failures.push(
    'docs/supply-chain-pins.md does not exist.\n' +
      '        Every pin needs a record of where it came from and how it was\n' +
      '        checked. A pin nobody recorded is a pin nobody verified.',
  );
} else {
  let rows = [];
  try {
    rows = recordRows(readFileSync(recordPath, 'utf8'));
  } catch (error) {
    if (!(error instanceof Unreadable)) throw error;
    refuse([error.message]);
  }
  for (const { verified, line } of rows)
    if (verified !== undefined && !shows(verified))
      failures.push(
        `docs/supply-chain-pins.md:${line}: has an empty Verified cell, so this row verifies nothing.`,
      );
  const recorded = new Set(
    rows
      .filter(({ pin, verified }) => ![pin, undefined].includes(verified) && shows(verified))
      .map(({ action, pin }) => JSON.stringify([action, pin])),
  );
  for (const [ref, where] of pins) {
    const at = ref.lastIndexOf('@');
    if (!recorded.has(JSON.stringify([ref.slice(0, at), ref.slice(at + 1)]))) {
      failures.push(
        `${where}: this pin is not in docs/supply-chain-pins.md.\n` +
          '        Record a row naming the action, its tag, this pin and how it was checked.',
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`\npins: ${failures.length} problem(s) ${NAMING}\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  process.exitCode = 1;
} else {
  console.log('pins: every action is pinned to a hash, and every pin is recorded.');
}
