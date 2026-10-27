// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the pin check. The script reads the repository it sits in, so each
// case runs a copy of it in a throwaway repository and reads its exit code.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const template = resolve(import.meta.dirname, '../..');
const SHA = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;
const row = (action, pin, verified = 'Tag ref, commit 200') =>
  `| \`${action}\` | v1 | \`${pin}\` | ${verified} |\n`;
const RECORD = `| Action | Tag | Commit | Verified |\n| --- | --- | --- | --- |\n${row('actions/checkout', SHA)}`;
const steps = (...lines) =>
  `name: case\non: push\njobs:\n  case:\n    runs-on: ubuntu-latest\n    steps:\n${lines.map((line) => `      ${line}\n`).join('')}`;

/**
 * The pin check over `workflows` (name -> text, or null for a broken symlink),
 * with `record` as the pin record, or none.
 */
function pins(t, workflows, record = RECORD) {
  const root = mkdtempSync(resolve(tmpdir(), 'pins-cases-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {};
  for (const name of ['pins-check.mjs', 'main-module.mjs', 'yaml-subset.mjs'])
    files[`scripts/${name}`] = readFileSync(resolve(template, 'scripts', name), 'utf8');
  if (record !== null) files['docs/supply-chain-pins.md'] = record;
  for (const [name, text] of Object.entries(workflows)) files[`.github/workflows/${name}`] = text;
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    if (text === null) symlinkSync('missing-target', resolve(root, path));
    else writeFileSync(resolve(root, path), text);
  }
  return spawnSync(process.execPath, [resolve(root, 'scripts/pins-check.mjs')], {
    encoding: 'utf8',
  });
}

/** How the check names workflow `name`: the first eight hex digits of its path's sha256. */
const named = (name) =>
  createHash('sha256').update(`.github/workflows/${name}`).digest('hex').slice(0, 8);

const refused = (result, pattern) => {
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, pattern);
};

test('the checked-in workflows pass against the checked-in record', (t) => {
  const dir = resolve(template, '.github/workflows');
  const workflows = Object.fromEntries(
    readdirSync(dir).map((name) => [name, readFileSync(resolve(dir, name), 'utf8')]),
  );
  const record = readFileSync(resolve(template, 'docs/supply-chain-pins.md'), 'utf8');
  const result = pins(t, workflows, record);
  assert.equal(result.status, 0, result.stderr);
});

test('a quoted key or a flow-mapped step is refused as unreadable, exit 2', (t) => {
  for (const step of [
    '- "uses": actions/checkout@main',
    "- 'uses': actions/checkout@main",
    '- {uses: actions/checkout@main}',
    '- { name: x, "uses": actions/checkout@main }',
    '- {"u\\x73es":actions/checkout@main}',
  ]) {
    const result = pins(t, { 'a.yml': steps(`- uses: actions/checkout@${SHA}`, step) });
    refused(result, /workflow [0-9a-f]{8}:8: .*cannot read/u);
    assert.equal(result.status, 2, step);
  }
});

test('a workflow written as JSON is refused, escaped keys and all', (t) => {
  const list = [{ uses: `actions/checkout@${SHA}` }, { uses: 'attacker/action@main' }];
  const json = JSON.stringify({ on: 'push', jobs: { a: { 'runs-on': 'x', steps: list } } });
  refused(
    pins(t, { 'a.yml': json.replace('"uses":"attacker', '"u\\u0073es":"attacker') }),
    /cannot read/u,
  );
});

test('a broken or unsupported shape anywhere in a workflow is refused', (t) => {
  const pinned = `- uses: actions/checkout@${SHA}`;
  for (const tail of [
    'broken: [unterminated\n',
    'broken: [}\n',
    'broken: [a, [b]]\n',
    'broken: {a: b}\n',
    'broken: &anchor value\n',
    'broken: !tag value\n',
    '---\nname: second\n',
    'broken: "unterminated\n',
    'broken: a: b\n',
    '   indented: under nothing\n',
    `${Array.from({ length: 120 }, (_, depth) => `${' '.repeat(depth)}deep${depth}:`).join('\n')}\n`,
  ])
    refused(pins(t, { 'a.yml': steps(pinned) + tail }), /workflow [0-9a-f]{8}:\d+: /u);
  refused(pins(t, { 'a.yml': steps(pinned).replace('    runs-on', '\truns-on') }), /tab/u);
});

/** A run block whose shell text names `ref` after `uses:`. */
const prose = (ref) => ['- run: |', `    echo uses: ${ref}`, `    echo "example uses: ${ref}"`];

test('uses text inside a run block is shell prose, not a key', (t) => {
  refused(pins(t, { 'a.yml': steps(...prose(`actions/checkout@${SHA}`)) }), /no action reference/u);
  const result = pins(t, {
    'a.yml': steps(`- uses: actions/checkout@${SHA}`, ...prose('actions/checkout@main')),
  });
  assert.equal(result.status, 0, result.stderr);
});

test('a run block ending at the wrong indent is refused', (t) => {
  const text = steps(`- uses: actions/checkout@${SHA}`, '- run: |', '      echo a', '    echo b');
  refused(pins(t, { 'a.yml': text }), /workflow [0-9a-f]{8}:10: /u);
});

test('a quoted pinned reference is read without its quotes', (t) => {
  for (const step of [
    `- uses: 'actions/checkout@${SHA}'`,
    `- uses: "actions/checkout@${SHA}" # v1`,
  ]) {
    const result = pins(t, { 'a.yml': steps(step) });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('a uses key spelled so the check cannot read it is refused', (t) => {
  for (const step of [
    '- uses: *pinned',
    '- uses: >-',
    '- ? uses',
    '- "u\\x73es": actions/checkout@main',
  ])
    refused(pins(t, { 'a.yml': steps(step, '  - run: echo ok') }), /cannot read/u);
});

// Rows 2-3 of Sol's round 3 at 4d0ccba: either refusal turned to exit 0 left every case green.
test('nothing to check is refused, exit 2: no workflow directory, no workflow, no reference', (t) => {
  for (const [workflows, pattern] of [
    [{}, /pins: no workflow directory/u],
    [{ 'README.md': 'not a workflow\n' }, /pins: no workflows found/u],
    [{ 'a.yml': steps('- run: echo ok') }, /no action reference/u],
  ]) {
    const result = pins(t, workflows);
    assert.equal(result.status, 2, pattern.source);
    refused(result, pattern);
  }
});

test('a docker action passes only when pinned by digest and recorded', (t) => {
  refused(
    pins(t, { 'a.yml': steps('- uses: docker://alpine:latest') }),
    /workflow [0-9a-f]{8}:7: .*not pinned/u,
  );
  const pinned = { 'a.yml': steps(`- uses: docker://alpine@${DIGEST}`) };
  refused(pins(t, pinned), /workflow [0-9a-f]{8}:7: this pin is not in docs/u);
  assert.equal(pins(t, pinned, RECORD + row('docker://alpine', DIGEST)).status, 0);
  refused(
    pins(
      t,
      { 'a.yml': steps(`- uses: docker://alpine@${SHA}`) },
      RECORD + row('docker://alpine', SHA),
    ),
    /workflow [0-9a-f]{8}:7: this reference is not pinned/u,
  );
});

test('a pin is covered only by a record row naming that action and how it was checked', (t) => {
  refused(
    pins(t, { 'a.yml': steps(`- uses: attacker/unrecorded@${SHA}`) }),
    /workflow [0-9a-f]{8}:7: this pin is not in docs/u,
  );
  const unverified = `| Action | Tag | Commit | Verified |\n| --- | --- | --- | --- |\n${row('actions/checkout', SHA, '')}`;
  refused(
    pins(t, { 'a.yml': steps(`- uses: actions/checkout@${SHA}`) }, unverified),
    /workflow [0-9a-f]{8}:7: this pin is not in docs/u,
  );
});

test('the record is read by its header, and a malformed row refuses', (t) => {
  const workflow = { 'a.yml': steps(`- uses: actions/checkout@${SHA}`) };
  const header = '| Action | Tag | Commit | Verified |\n| --- | --- | --- | --- |\n';
  for (const record of [
    `${header}| actions/checkout | v1 | ${SHA} | | unrelated |\n`,
    `${header}| actions/checkout | ${SHA} | v1 | | invented |\n`,
    `${header}| actions/checkout | ${SHA} | v1 | checked |\n`,
    `| Action | Tag | Commit | Verified | Verified |\n| --- | --- | --- | --- | --- |\n| actions/checkout | v1 | ${SHA} | | checked |\n`,
  ])
    refused(pins(t, workflow, record), /supply-chain-pins/u);
  const reordered = `| Verified | Commit | Action |\n| --- | --- | --- |\n| checked | ${SHA} | actions/checkout |\n`;
  const result = pins(t, workflow, reordered);
  assert.equal(result.status, 0, result.stderr);
});

test('a key its mapping already has is refused, at every depth', (t) => {
  const pinned = `- uses: actions/checkout@${SHA}`;
  for (const text of [
    `${steps(pinned)}name: conflicting\n`,
    `${steps(pinned)}on: pull_request\n`,
    steps(pinned).replace('    runs-on:', '    runs-on: macos-latest\n    runs-on:'),
    steps(pinned, '  uses: attacker/action@main'),
    steps(pinned, '  with:', '    a: 1', '    a: 2'),
  ]) {
    const result = pins(t, { 'a.yml': text });
    refused(result, /workflow [0-9a-f]{8}:\d+: names a key its mapping already has/u);
    assert.equal(result.status, 2);
  }
  // One key in two mappings is two keys.
  const two = pins(t, { 'a.yml': steps(pinned, '  name: a', pinned, '  name: b') });
  assert.equal(two.status, 0, two.stderr);
});

test('a space that is not a plain one is refused wherever it is on a workflow line', (t) => {
  const pinned = `- uses: actions/checkout@${SHA}`;
  for (const space of [' ', ' ', '　', '﻿'])
    for (const text of [
      steps(pinned).replace('    runs-on', `  ${space}${space}runs-on`),
      steps(`-${' '}${space}uses: actions/checkout@${SHA}`),
      steps(pinned, `- run: echo${space}ok`),
    ]) {
      const result = pins(t, { 'a.yml': text });
      refused(result, /workflow [0-9a-f]{8}:\d+: .*tab/u);
      assert.equal(result.status, 2);
    }
});

test('a workflow with no top-level key refuses, even beside one that passes', (t) => {
  for (const empty of ['', '\n', '# only a comment\n', '---\n', '- just: a list\n'])
    refused(
      pins(t, { 'a.yml': steps(`- uses: actions/checkout@${SHA}`), 'b.yml': empty }),
      new RegExp(`workflow ${named('b.yml')}: has no top-level key`, 'u'),
    );
});

test('a mutable action refuses even when the record has a row for it', (t) => {
  for (const ref of ['main', 'v4', 'a'.repeat(39), SHA.toUpperCase()])
    refused(
      pins(
        t,
        { 'a.yml': steps(`- uses: actions/checkout@${ref}`) },
        RECORD + row('actions/checkout', ref),
      ),
      /workflow [0-9a-f]{8}:7: this reference is not pinned/u,
    );
});

test('a workflow mixing list items and keys at one level is refused', (t) => {
  const pinned = steps(`- uses: actions/checkout@${SHA}`);
  for (const tail of [
    '      bogus: yes\n',
    'broken:\n  child: one\n  - item\n',
    'broken:\n  - item\n  child: one\n',
    'broken:\n  child: one\n  - child: two\n',
  ]) {
    const result = pins(t, { 'a.yml': pinned + tail });
    refused(result, /workflow [0-9a-f]{8}:\d+: /u);
    assert.equal(result.status, 2, tail);
  }
});

test('a control character YAML forbids is refused, wherever it is', (t) => {
  for (const control of ['\u0000', '\u0001', '\u0007', '\u007F', '\u0085']) {
    const result = pins(t, {
      'a.yml': `${steps(`- uses: actions/checkout@${SHA}`)}extra: a${control}b\n`,
    });
    refused(result, /workflow [0-9a-f]{8}:8: /u);
    assert.equal(result.status, 2);
  }
});

test('a refused reference is named by its line, never echoed', (t) => {
  const marker = ['PINS', 'CREDENTIAL', 'MARKER'].join('_');
  for (const ref of [`docker://user:${marker}@registry.invalid:latest`, `user:${marker}@${SHA}`]) {
    const result = pins(t, { 'a.yml': steps(`- uses: actions/checkout@${SHA}`, `- uses: ${ref}`) });
    refused(result, /workflow [0-9a-f]{8}:8: /u);
    assert.equal(
      `${result.stdout}${result.stderr}`.includes(marker),
      false,
      'a marker reached the output',
    );
  }
});

test('a missing pin record is refused', (t) => {
  refused(
    pins(t, { 'a.yml': steps(`- uses: actions/checkout@${SHA}`) }, null),
    /supply-chain-pins\.md does not exist/u,
  );
});

test('a crafted long line is read in linear time', (t) => {
  const run = ' '.repeat(80_000);
  const tail = `a: x${run}y\nb: '${"''".repeat(40_000)}'${run}# c\nc: [x${run}y, z]\nd: x${':x'.repeat(40_000)}\n`;
  const started = performance.now();
  const result = pins(t, { 'a.yml': steps(`- uses: actions/checkout@${SHA}`) + tail });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(performance.now() - started < 1000, 'a crafted line took a second or more');
});

const indentless = (ref) =>
  `on: push\npermissions: {}\njobs:\n  case:\n    steps:\n    - uses: ${ref}\n    runs-on: x\n`;

test("a list at its key's indent and an empty flow mapping are read, and checked", (t) => {
  const result = pins(t, { 'a.yml': indentless(`actions/checkout@${SHA}`) });
  assert.equal(result.status, 0, result.stderr);
  refused(
    pins(t, { 'a.yml': indentless('actions/checkout@v4') }),
    /workflow [0-9a-f]{8}:6: .*not pinned/u,
  );
});

test('a record row the page would not show is not evidence', (t) => {
  const workflow = { 'a.yml': steps(`- uses: actions/checkout@${SHA}`) };
  const fence = '```\n';
  for (const record of [
    `<!--\n${RECORD}-->\n`,
    fence + RECORD + fence,
    `\n${RECORD}`.replaceAll('\n|', '\n    |'),
    `- ${fence}${RECORD.replaceAll(/^/gmu, '  ')}  ${fence}`,
    `- x\n\n  ${fence}  y\n${fence}${RECORD}${fence}`,
  ])
    refused(
      pins(t, workflow, record),
      /workflow [0-9a-f]{8}:7: this pin is not in docs|pins\.md:\d+: /u,
    );
});

test('a code fence anywhere in the record refuses it, whatever GitHub would make of it', (t) => {
  const workflow = { 'a.yml': steps(`- uses: actions/checkout@${SHA}`) };
  for (const record of [
    `\`\`\`x\`y\n\`\`\`\n${RECORD}\`\`\`\n`,
    `\`\`\`\n\`\`\`\u00A0\n${RECORD}\`\`\`\n`,
    `~~~\n~~~\u2003\n${RECORD}~~~\n`,
  ]) {
    const result = pins(t, workflow, record);
    refused(result, /pins\.md:1: has a code fence/u);
    assert.equal(result.status, 2, record);
  }
});

// Row 1 of Sol's round 3 at 4d0ccba: escaping kept a credential marker in a file name.
test('a workflow is named by a fingerprint, never its file name, refusals included', (t) => {
  const marker = ['PINS', 'CREDENTIAL', 'MARKER'].join('_');
  for (const name of [`${marker}.yml`, `x\n::error title=forged::${marker}.yml`]) {
    const mutable = pins(t, { [name]: steps('- uses: actions/checkout@v4') });
    const broken = pins(t, { 'a.yml': steps(`- uses: actions/checkout@${SHA}`), [name]: null });
    for (const result of [mutable, broken]) {
      const output = `${result.stdout}${result.stderr}`;
      assert.equal(output.includes(marker), false, 'a marker reached the output');
      assert.doesNotMatch(output, /^\s*::/mu);
    }
    const at = named(name);
    refused(mutable, new RegExp(`workflow ${at}:7: this reference is not pinned`, 'u'));
    refused(broken, new RegExp(`workflow ${at}: this check cannot read this file`, 'u'));
    assert.equal(broken.status, 2);
  }
});

test('HTML in a record cell is refused, as anywhere else in the record', (t) => {
  const header = '| Action | Tag | Commit | Verified |\n| --- | --- | --- | --- |\n';
  for (const verified of ['<span hidden>checked</span>', '\\`<span hidden>checked</span>\\`']) {
    const result = pins(
      t,
      { 'a.yml': steps(`- uses: actions/checkout@${SHA}`) },
      header + row('actions/checkout', SHA, verified),
    );
    refused(result, /pins\.md:3: holds HTML/u);
    assert.equal(result.status, 2, verified);
  }
});

test('HTML in the middle of a record line is refused, not only at its start', (t) => {
  for (const line of ['See below. <details>', '- [ ] <details>']) {
    const result = pins(
      t,
      { 'a.yml': steps(`- uses: actions/checkout@${SHA}`) },
      `${line}\n\n${RECORD}`,
    );
    refused(result, /pins\.md:1: holds HTML/u);
    assert.equal(result.status, 2, line);
  }
});

test('a uses value written as a block scalar is refused, whatever its length', (t) => {
  for (const indicator of ['|', '|-', '|+'])
    for (const content of [
      [],
      [`    actions/checkout@${SHA}`],
      [`    actions/checkout@${SHA}`, '    x'],
    ]) {
      const result = pins(t, { 'a.yml': steps(`- uses: ${indicator}`, ...content) });
      refused(result, /workflow [0-9a-f]{8}:7: this check cannot read this uses value/u);
      assert.equal(result.status, 2, `${indicator} ${content.length}`);
    }
});

// Findings 1-4 of the security re-bind at 72ec255: each shape exits 0 there.
const checkout = { 'a.yml': steps(`- uses: actions/checkout@${SHA}`) };

test('a bare CR in the record refuses it, since GitHub ends a line there', (t) => {
  const result = pins(t, checkout, `intro\r\`\`\`\n${RECORD}`);
  refused(result, /pins\.md:1: holds a control character/u);
  assert.equal(result.status, 2);
});

test('a tab in the record refuses it, since a tab can indent a fence into a list item', (t) => {
  const result = pins(t, checkout, `- item\n\t\`\`\`\n${RECORD.replaceAll(/^/gmu, '  ')}`);
  refused(result, /pins\.md:2: holds a control character/u);
  assert.equal(result.status, 2);
});

test('a backtick that could pair outside its own cell refuses the record', (t) => {
  for (const [record, pattern] of [
    [`| \`x | \`<details>\` |\n\n${RECORD}`, /pins\.md:1: holds HTML/u],
    [`foo \`\n| \`<details>\` |\n\n${RECORD}`, /pins\.md:2: holds HTML/u],
    [RECORD.replace('commit 200 |', 'commit 200` |'), /pins\.md:3: has a backtick/u],
  ]) {
    const result = pins(t, checkout, record);
    refused(result, pattern);
    assert.equal(result.status, 2, record);
  }
});

test('a long fence-like run in the record is read in linear time', (t) => {
  const started = performance.now();
  const result = pins(t, checkout, `${RECORD}${'~'.repeat(100_000)}\u2028\n`);
  assert.ok(performance.now() - started < 1000, 'a crafted record line took a second or more');
  assert.equal(result.status, 2, result.stderr);
});

// Findings 1-3 of the security re-bind at 5bea38b: each shape exits 0 there.
const HEADER = '| Action | Tag | Commit | Verified |\n| --- | --- | --- | --- |\n';

test('a backslash or an & in the record refuses it, since GitHub reads both as escapes', (t) => {
  for (const record of [
    `${HEADER}| actions/checkout | v1\\| ${SHA} | SEC83E checked |\n`,
    HEADER + row('actions/checkout', SHA, '&nbsp;'),
    HEADER + row('actions/checkout', SHA, '\\'),
  ]) {
    const result = pins(t, checkout, record);
    refused(result, /pins\.md:3: holds a backslash or an &/u);
    assert.equal(result.status, 2, record);
  }
});

test('an invisible character or a space that is not a plain one refuses the record', (t) => {
  for (const char of ['​', '﻿', '⁠', ' ', '　']) {
    const result = pins(t, checkout, HEADER + row('actions/checkout', SHA, `${char}`));
    refused(result, /pins\.md:3: holds a control character/u);
    assert.equal(result.status, 2, char.codePointAt(0).toString(16));
  }
});

test('a line that GitHub keeps in the table above it refuses the record', (t) => {
  const record = `${HEADER}| x | x | x | x |\nx\n| Verified | Action | Commit |\n| --- | --- | --- |\n| SEC83E | actions/checkout | ${SHA} |\n`;
  const result = pins(t, checkout, record);
  refused(result, /pins\.md:4: follows a table row/u);
  assert.equal(result.status, 2);
});

test('a Verified cell that is empty once trimmed is refused with its reason', (t) => {
  for (const verified of ['', '` `']) {
    const result = pins(t, checkout, HEADER + row('actions/checkout', SHA, verified));
    refused(result, /pins\.md:3: has an empty Verified cell/u);
  }
});

// Findings 1-3 of Sol's round 2 at 3129f70: each shape exits 0 there.
test('a Verified cell must show text: link syntax refuses the record, emphasis alone is empty', (t) => {
  for (const record of [
    HEADER + row('actions/checkout', SHA, '[]()'),
    HEADER + row('actions/checkout', SHA, '![checked](x)'),
    HEADER + row('actions/checkout', SHA, 'checked]'),
    `See [the docs](x).\n\n${RECORD}`,
  ]) {
    const result = pins(t, checkout, record);
    refused(result, /pins\.md:\d+: holds a \[ or a \]/u);
    assert.equal(result.status, 2, record);
  }
  for (const verified of ['**', '__', '~~', '`**`', '*_~*'])
    refused(
      pins(t, checkout, HEADER + row('actions/checkout', SHA, verified)),
      /pins\.md:3: has an empty Verified cell/u,
    );
});

test('a table header without its rule refuses the record, wherever the table ends', (t) => {
  const unruled = '| Action | Tag | Commit | Verified |';
  for (const tail of [`${unruled}\n`, `${unruled}\n\n`, unruled, `${unruled}\nx\n`]) {
    const result = pins(t, checkout, `${RECORD}\n${tail}`);
    refused(result, /pins\.md:5: is a table header with no rule under it/u);
    assert.equal(result.status, 2, tail);
  }
});

/** `maps` nested mappings, then `leaf` at the indent under the last, after a pinned step. */
const deep = (maps, leaf) =>
  `${steps(`- uses: actions/checkout@${SHA}`)}${Array.from({ length: maps }, (_, depth) => `${' '.repeat(depth)}deep${depth}:\n`).join('')}${leaf
    .split('\n')
    .map((line) => `${' '.repeat(maps)}${line}\n`)
    .join('')}`;

test('every container counts toward the 100 level limit, item mappings and flow values included', (t) => {
  for (const leaf of ['- k: v', '- k: v\n  j: w\n- x', 'k: [a]', 'k: {}', '- [a]']) {
    const within = pins(t, { 'a.yml': deep(98, leaf) });
    assert.equal(within.status, 0, `${leaf}: ${within.stderr}`);
    const result = pins(t, { 'a.yml': deep(99, leaf) });
    refused(result, /workflow [0-9a-f]{8}:\d+: nests deeper than 100 levels/u);
    assert.equal(result.status, 2, leaf);
  }
});

// Findings 1-2 of the security re-bind at ed18210: each shape exits 0 there.
test('a default-ignorable filler letter refuses the record, since the page shows nothing', (t) => {
  for (const char of ['ㅤ', 'ﾠ', 'ᅟ', 'ᅠ']) {
    const result = pins(t, checkout, HEADER + row('actions/checkout', SHA, char));
    refused(result, /pins\.md:3: holds a control character/u);
    assert.equal(result.status, 2, char.codePointAt(0).toString(16));
  }
});

test('a table GitHub shows as text, after a line or in front matter, refuses the record', (t) => {
  const inner = RECORD.replaceAll(/^/gmu, '  ');
  for (const [record, pattern] of [
    [`> note\n${RECORD}`, /pins\.md:2: starts a table straight after a line/u],
    [`- note\n${RECORD}`, /pins\.md:2: starts a table straight after a line/u],
    [`---\nx: |\n${inner}\n---\n`, /pins\.md:1: starts with front matter/u],
    [`---\nx: |\n\n${inner}\n---\n`, /pins\.md:1: starts with front matter/u],
  ]) {
    const result = pins(t, checkout, record);
    refused(result, pattern);
    assert.equal(result.status, 2, record);
  }
});
