// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the product name CLI: the heading edits it reports, the metadata, arguments and links
// it refuses, and the files it never writes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const source = resolve(import.meta.dirname, '../..');
const targets = ['README.md', 'NOTICE'];

function fixture(t) {
  const temporary = mkdtempSync(join(tmpdir(), 'product-name-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'repository');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const script of ['product-name.mjs', 'main-module.mjs'])
    copyFileSync(join(source, 'scripts', script), join(root, 'scripts', script));
  for (const file of targets) copyFileSync(join(source, file), join(root, file));
  const name = readFileSync(join(root, 'NOTICE'), 'utf8').split(/\r?\n/u)[0];
  writeFileSync(join(root, 'product.json'), JSON.stringify({ name }));
  return {
    root,
    temporary,
    name,
    run: (...args) =>
      spawnSync(process.execPath, [join(root, 'scripts/product-name.mjs'), ...args], {
        cwd: temporary,
        encoding: 'utf8',
        timeout: 10_000,
      }),
  };
}

function contents(root) {
  return targets.map((file) => readFileSync(join(root, file)));
}

// Every byte of both targets, and every name in the repository folder.
function snapshot(root) {
  return { files: contents(root), entries: readdirSync(root).toSorted() };
}

test('the actual CLI reports each heading edit to make, and nothing else from the files', (t) => {
  const { root, name, run } = fixture(t);
  const marker = 'BODY-MARKER-NEVER-PRINTED';
  for (const file of targets) writeFileSync(join(root, file), `${marker}\n`, { flag: 'a' });
  const before = snapshot(root);
  writeFileSync(join(root, 'product.json'), JSON.stringify({ name: 'Alternate Product' }));

  for (const args of [[], ['--check']]) {
    const result = run(...args);
    assert.equal(result.status, 1, 'stale headings fail the check');
    assert.deepEqual(snapshot(root), before, 'the check writes nothing');
    assert.equal(`${result.stdout}${result.stderr}`.includes(marker), false, 'no body line');
    for (const [file, prefix] of [
      ['README.md', '# '],
      ['NOTICE', ''],
    ]) {
      assert.match(result.stderr, new RegExp(`  ${file}\\n    now:    ${prefix}${name}\\n`, 'u'));
      assert.match(
        result.stderr,
        new RegExp(`\\n    wanted: ${prefix}Alternate Product(\\n|$)`, 'u'),
      );
    }
  }

  // Making the two edits it names is all it takes.
  targets.forEach((file, index) => {
    const bytes = before.files[index];
    const heading = index === 0 ? '# Alternate Product' : 'Alternate Product';
    writeFileSync(
      join(root, file),
      Buffer.concat([Buffer.from(heading), bytes.subarray(bytes.indexOf(10))]),
    );
  });
  const fixed = run('--check');
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.match(fixed.stdout, /headings match/u);
});

// Sol's review of CF-10-FIX3: every case above stayed green with the success
// path changed to append to README.md, because no matching check looked at
// the files afterwards.
test('a matching check changes no target byte and no root entry', (t) => {
  const { root, run } = fixture(t);
  const before = snapshot(root);
  for (const args of [[], ['--check']]) {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /headings match/u);
    assert.deepEqual(snapshot(root), before, 'a matching check writes nothing');
  }
});

test('only the stale heading is reported when the other matches', (t) => {
  const { root, name, run } = fixture(t);
  writeFileSync(join(root, 'product.json'), JSON.stringify({ name: 'Alternate Product' }));
  const notice = readFileSync(join(root, 'NOTICE'));
  writeFileSync(
    join(root, 'NOTICE'),
    Buffer.concat([Buffer.from('Alternate Product'), notice.subarray(notice.indexOf(10))]),
  );
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`README\\.md\\n    now:    # ${name}`, 'u'));
  assert.doesNotMatch(result.stderr, /NOTICE/u);
});

// ORCH73 79CUT: the write mode is gone. Every way of writing the two files
// found by Sol's reviews could lose an edit made while it ran.
test('--write is refused as an unknown option with exit 2 and changes no file', (t) => {
  const { root, run } = fixture(t);
  for (const name of [undefined, 'Alternate Product']) {
    if (name) writeFileSync(join(root, 'product.json'), JSON.stringify({ name }));
    const before = snapshot(root);
    const result = run('--write');
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /usage: node scripts\/product-name\.mjs \[--check\]/u);
    assert.deepEqual(snapshot(root), before, '--write changes no file');
  }
});

test('invalid metadata and unknown arguments are refused', (t) => {
  const { root, run } = fixture(t);
  const original = contents(root);
  const invalid = [
    '{',
    'null',
    '[]',
    '"A name"',
    '{}',
    '{"name":42}',
    '{"name":"Valid Name","slug":"another-setting"}',
    ...[
      '',
      ' padded',
      'padded ',
      'two\nlines',
      'two\rlines',
      'two\twords',
      'two lines',
      'A\0name',
      '# Heading',
      '<b>Name</b>',
      '**Name**',
      '`Name`',
      '[Name](url)',
      'Name_italic',
      'Name &amp; Co',
    ].map((name) => JSON.stringify({ name })),
  ];
  for (const metadata of invalid) {
    writeFileSync(join(root, 'product.json'), metadata);
    const result = run('--check');
    assert.equal(result.status, 2, `metadata ${metadata}: ${result.stderr}`);
    assert.deepEqual(contents(root), original, 'invalid metadata preserves both files');
  }
  writeFileSync(join(root, 'product.json'), JSON.stringify({ name: 'Alternate Product' }));
  for (const args of [['--unknown'], ['--check', '--check'], ['--check', 'extra']]) {
    assert.equal(run(...args).status, 2);
    assert.deepEqual(contents(root), original, 'invalid arguments preserve both files');
  }
});

test('duplicate name members fail even when the last name matches the real headings', (t) => {
  const { root, name, run } = fixture(t);
  const current = JSON.stringify(name);
  const different = JSON.stringify(name + ' Alternate');
  for (const metadata of [
    `{"name":${different},"name":${current}}`,
    `{"name":${current},"name":${current}}`,
  ]) {
    writeFileSync(join(root, 'product.json'), metadata);
    const result = run('--check');
    assert.equal(result.status, 2, result.stderr);
  }

  const escaped = name
    .split('')
    .map((unit) => `\\u${unit.codePointAt(0).toString(16).padStart(4, '0')}`)
    .join('');
  writeFileSync(join(root, 'product.json'), ` \n {\n "name" \t: "${escaped}" \n }\n`);
  assert.equal(run('--check').status, 0, 'ordinary whitespace and Unicode escapes remain valid');
});

test('both targets are validated before any heading is reported', (t) => {
  const { root, run } = fixture(t);
  writeFileSync(join(root, 'product.json'), JSON.stringify({ name: 'Alternate Product' }));
  writeFileSync(join(root, 'NOTICE'), '\nInvalid first line\n');
  const invalid = run('--check');
  assert.equal(invalid.status, 2);
  assert.doesNotMatch(invalid.stderr, /README\.md/u, 'no partial report');
  rmSync(join(root, 'NOTICE'));
  assert.equal(run('--check').status, 2);
  mkdirSync(join(root, 'NOTICE'));
  assert.equal(run('--check').status, 2);
});

for (const target of targets) {
  test(`a symlink ${target} is refused without reading through it`, (t) => {
    const { root, temporary, run } = fixture(t);
    writeFileSync(join(root, 'product.json'), JSON.stringify({ name: 'Alternate Product' }));
    const outside = join(temporary, 'outside-file');
    copyFileSync(join(root, target), outside);
    rmSync(join(root, target));
    symlinkSync(outside, join(root, target));
    const original = contents(root);
    for (const args of [[], ['--check']]) {
      const result = run(...args);
      assert.equal(result.status, 2);
      assert.doesNotMatch(result.stderr, /now:/u, 'nothing is read out of the linked file');
    }
    assert.deepEqual(contents(root), original, 'the linked file and other target remain untouched');
  });
}

test('a heading ended by CRLF, with non-UTF-8 bytes after it, is read as its first line', (t) => {
  const { root, run } = fixture(t);
  targets.forEach((file, index) =>
    writeFileSync(
      join(root, file),
      Buffer.concat([
        Buffer.from(index === 0 ? '# Café Tools\r\n' : 'Café Tools\r\n'),
        Buffer.from([0xff, 0x00, 0xfe]),
      ]),
    ),
  );
  writeFileSync(join(root, 'product.json'), JSON.stringify({ name: 'Café Tools' }));
  assert.equal(run('--check').status, 0);
  writeFileSync(join(root, 'product.json'), JSON.stringify({ name: 'Café Works' }));
  const stale = run('--check');
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /now:    # Café Tools\n    wanted: # Café Works\n/u);
});
