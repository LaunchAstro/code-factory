// SPDX-License-Identifier: AGPL-3.0-only
// The ADR index and the records on disk say the same thing.
//
// docs/adr/README.md is a hand-kept table and docs/adr/ is a directory. They
// agree today because one person keeps both. AGENTS.md sends a reader to the
// index, so a record with no row is a decision that reader never finds, and a
// row whose number is not its file's sends them to the wrong decision.
// scripts/doc-links-check.mjs proves the links that exist resolve; it cannot
// see a row that is missing.
//
// Six refusals, all of them about the pair and not about a record's contents:
//
//   1. A record with no row. A row inside an HTML comment or a fenced block
//      is not one: a reader of the rendered index never sees it.
//   2. A row whose link text is not the number of the file it links.
//   3. Two records on one number.
//   4. A file under docs/adr/ that is not named NNNN-slug.md. README.md is
//      the index, not a record.
//   5. No index.
//   6. No records: a pair with nothing on one side agrees by saying nothing.
//
// Usage:
//   node scripts/adr-index-check.mjs [repository-root]

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainModule } from './main-module.mjs';
import { fenceAfter } from './markdown.mjs';

const INDEX = 'README.md';

// Four digits, a hyphen, a lowercase slug, .md. The slug is lowercase because
// every record on disk is, and a record that breaks the pattern is a record
// whose number cannot be read from its name.
const RECORD = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;

// A row is a table line whose first cell is a link whose text is a number.
// The header and the separator have no link and are not rows.
const ROW = /^\|\s*\[(\d{4})\]\(([^)\s]+)\)\s*\|/u;

// An inline code span on one line: a backtick run, then the next run of the
// same length. A `<!--` inside one is text, not a comment.
const CODE_SPAN = /(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)/gu;

/** The four-digit number a record file name carries, or undefined. */
const numberOf = (file) => RECORD.exec(file)?.[1];

/**
 * What a reader of the index sees, line for line, fenced blocks and HTML
 * comments blanked in one pass, so whichever opens first wins: a `<!--` inside
 * a fence opens nothing, and nor does a fence marker inside a comment. Sol's
 * CF-11-FIX1 review found fences taken out first, so a backtick line inside a
 * closed comment hid every row after it. A comment ends at the first `-->`
 * after its `<!--`, an unterminated one runs to the end, and line numbers
 * still hold. Sol's CF-11-FIX2 review found a `<!--` inside an inline code span
 * taken for a comment that hid the next row; one there opens nothing.
 */
function shownLines(markdown) {
  let fence = '';
  let comment = false;
  return String(markdown)
    .split(/\r\n|\r|\n/u)
    .map((line) => {
      if (!comment) {
        const inside = fence !== '';
        fence = fenceAfter(fence, line);
        if (inside || fence !== '') return '';
      }
      let shown = '';
      let at = 0;
      while (at !== -1) {
        if (comment) {
          const end = line.indexOf('-->', at);
          [comment, at] = end === -1 ? [true, -1] : [false, end + 3];
        } else {
          const masked = line.slice(at).replace(CODE_SPAN, (span) => ' '.repeat(span.length));
          const start = masked.indexOf('<!--');
          shown += line.slice(at, start === -1 ? undefined : at + start);
          [comment, at] = start === -1 ? [false, -1] : [true, at + start + 4];
        }
      }
      return shown;
    });
}

/**
 * Every disagreement between the records in `files` and the table in
 * `indexMarkdown`, one line each, each beginning with the path it is about.
 * `indexMarkdown` is undefined when there is no index.
 */
export function adrFindings(files, indexMarkdown) {
  const findings = [];
  const records = files.filter((file) => file !== INDEX);
  if (indexMarkdown === undefined)
    findings.push(`docs/adr/${INDEX}: missing, so no record is indexed`);
  if (records.length === 0)
    findings.push('docs/adr: no records, so there is nothing for the index to agree with');

  // Rows first: what the table links is what tells a record it is indexed,
  // whether or not the row's number is the right one.
  const linked = new Set();
  for (const [index, line] of shownLines(indexMarkdown ?? '').entries()) {
    const row = ROW.exec(line);
    if (!row) continue;
    const [, number, target] = row;
    linked.add(target);
    if (numberOf(target) !== number)
      findings.push(
        `docs/adr/${INDEX}:${index + 1}: row [${number}] links ${target}, which is not record ${number}`,
      );
  }

  const byNumber = new Map();
  for (const file of records) {
    const number = numberOf(file);
    if (number === undefined) {
      findings.push(`docs/adr/${file}: not named NNNN-slug.md, so it is not a record`);
      continue;
    }
    byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
    if (!linked.has(file)) findings.push(`docs/adr/${file}: no row in docs/adr/${INDEX} links it`);
  }

  for (const [number, sharing] of byNumber)
    if (sharing.length > 1)
      findings.push(
        `docs/adr/${sharing[0]}: number ${number} is used by ${sharing.length} records: ${sharing
          .map((file) => `docs/adr/${file}`)
          .join(', ')}`,
      );

  return findings;
}

if (isMainModule(import.meta.url)) {
  const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..'));
  const directory = resolve(root, 'docs/adr');
  const files = readdirSync(directory);
  const index = files.includes(INDEX) ? readFileSync(resolve(directory, INDEX), 'utf8') : undefined;
  const findings = adrFindings(files, index);

  console.log(`adr-index: ${files.filter((file) => file !== INDEX).length} record(s)`);
  for (const finding of findings) console.error(`adr-index: ${finding}`);
  if (findings.length > 0) process.exitCode = 1;
  else console.log('adr-index: every record is indexed.');
}
