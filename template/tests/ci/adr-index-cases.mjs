// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the ADR index gate: every record has one row, and each row's number is its own file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { adrFindings } from '../../scripts/adr-index-check.mjs';

const row = (number, file) => `| [${number}](${file}) | Something |`;
const index = (...rows) =>
  ['# Architecture decisions', '', '| Decision | Responsibility |', '| --- | --- |', ...rows].join(
    '\n',
  );

test('a record with no row is refused, naming the file', () => {
  const found = adrFindings(
    ['0001-one.md', '0002-two.md', 'README.md'],
    index(row('0001', '0001-one.md')),
  );
  assert.equal(found.length, 1);
  assert.match(found[0], /^docs\/adr\/0002-two\.md: no row/u);
});

test('a row whose number is not its file is refused, naming the row line', () => {
  const found = adrFindings(
    ['0001-one.md', '0002-two.md'],
    index(row('0001', '0001-one.md'), row('0003', '0002-two.md')),
  );
  assert.equal(found.length, 1);
  assert.match(found[0], /^docs\/adr\/README\.md:6:/u);
});

test('two records on one number are refused, naming both', () => {
  const found = adrFindings(
    ['0007-one.md', '0007-two.md'],
    index(row('0007', '0007-one.md'), row('0007', '0007-two.md')),
  );
  assert.equal(found.length, 1);
  assert.match(found[0], /0007-one\.md/u);
  assert.match(found[0], /0007-two\.md/u);
});

test('a file that is not named NNNN-slug.md is not a record, and README.md is the index', () => {
  for (const bad of ['notes.md', '7-short.md', '0008-Upper-Case.md', '0009-nine.txt']) {
    const found = adrFindings(['0001-one.md', bad], index(row('0001', '0001-one.md')));
    assert.deepEqual(found, [`docs/adr/${bad}: not named NNNN-slug.md, so it is not a record`]);
  }
  assert.deepEqual(
    adrFindings(['0001-one.md', 'README.md'], index(row('0001', '0001-one.md'))),
    [],
  );
});

test('the header and the separator are not rows', () => {
  assert.deepEqual(adrFindings(['0001-one.md'], index()), [
    'docs/adr/0001-one.md: no row in docs/adr/README.md links it',
  ]);
});

// Sol's CF-11 review, adr-index-check.mjs:51: a row nobody can see indexed a record.
test('a row inside an HTML comment or a fenced block does not index a record', () => {
  const one = row('0001', '0001-one.md');
  for (const hidden of [
    `<!--\n${one}\n-->`,
    `<!-- x\n${one}`,
    `\`\`\`md\n${one}\n\`\`\``,
    `~~~\n${one}`,
  ]) {
    assert.deepEqual(adrFindings(['0001-one.md'], index(hidden)), [
      'docs/adr/0001-one.md: no row in docs/adr/README.md links it',
    ]);
  }
  const found = adrFindings(
    ['0001-one.md', '0002-two.md'],
    index('<!--', 'x', '-->', one, row('0003', '0002-two.md')),
  );
  assert.deepEqual(found, [
    'docs/adr/README.md:9: row [0003] links 0002-two.md, which is not record 0003',
  ]);
});

const checker = resolve(import.meta.dirname, '../../scripts/adr-index-check.mjs');

/** Runs the command on a scratch repository whose docs/adr holds `files`; null text is no file. */
function adrRun(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'adr-index-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs/adr'), { recursive: true });
  for (const [file, text] of Object.entries(files))
    if (text !== null) writeFileSync(join(root, 'docs/adr', file), text);
  return spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });
}

// Sol's CF-11 review, adr-index-check.mjs:88: no index and no records was a pass.
test('a missing index, or a directory with no records, is refused', (t) => {
  const statuses = [null, '', '# ADR index\n', index()].map(
    (readme) => adrRun(t, { 'README.md': readme }).status,
  );
  assert.deepEqual(statuses, [1, 1, 1, 1]);
  const unindexed = adrRun(t, { '0001-one.md': '# One\n' });
  assert.equal(unindexed.status, 1);
  assert.match(unindexed.stderr, /adr-index: docs\/adr\/README\.md: missing/u);
});

// Sol's CF-11 review, adr-index-cases.mjs:4: the command itself, not only its function.
test('the command exits 1 on an unindexed record and 0 once every record has its row', (t) => {
  const two = { '0001-one.md': '# One\n', '0002-two.md': '# Two\n' };
  const refused = adrRun(t, { ...two, 'README.md': `${index(row('0001', '0001-one.md'))}\n` });
  assert.equal(refused.status, 1, refused.stdout);
  assert.match(refused.stderr, /adr-index: docs\/adr\/0002-two\.md: no row/u);
  const rows = index(row('0001', '0001-one.md'), row('0002', '0002-two.md'));
  const passed = adrRun(t, { ...two, 'README.md': `${rows}\n` });
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /adr-index: every record is indexed\./u);
});

// Sol's CF-11-FIX1 review, adr-index-check.mjs:50: fences came out before
// comments, so a fence marker inside a closed comment hid every row after it.
test('a fence marker inside a closed comment opens no fence, and a comment marker inside a fence opens no comment', (t) => {
  const one = row('0001', '0001-one.md');
  for (const before of [
    ['<!--', '```', '-->'],
    ['<!-- ``` -->'],
    ['<!--', '~~~ js', 'still a comment -->'],
    ['```', '<!--', '```'],
    ['<!-- a --> ```'],
  ])
    assert.deepEqual(adrFindings(['0001-one.md'], index(...before, one)), [], before.join('\n'));
  assert.deepEqual(adrFindings(['0001-one.md'], index('```', 'x', '```', '<!--', one)), [
    'docs/adr/0001-one.md: no row in docs/adr/README.md links it',
  ]);
  const ran = adrRun(t, {
    '0001-one.md': '# One\n',
    'README.md': `${index('<!--', '```', '-->', one)}\n`,
  });
  assert.equal(ran.status, 0, ran.stderr);
});

// Sol's CF-11-FIX2 review, adr-index-check.mjs:71: a literal <!-- inside an
// inline code span was taken for a comment and hid the next row.
test('a comment opener inside an inline code span opens no comment', (t) => {
  const rows = ['| [0001](0001-one.md) | Explain `<!--` literally. |', row('0002', '0002-two.md')];
  assert.deepEqual(adrFindings(['0001-one.md', '0002-two.md'], index(...rows)), []);
  assert.deepEqual(adrFindings(['0001-one.md'], index('`<!--` <!--', row('0001', '0001-one.md'))), [
    'docs/adr/0001-one.md: no row in docs/adr/README.md links it',
  ]);
  const ran = adrRun(t, {
    '0001-one.md': '# One\n',
    '0002-two.md': '# Two\n',
    'README.md': `${index(...rows)}\n`,
  });
  assert.equal(ran.status, 0, ran.stderr);
});
