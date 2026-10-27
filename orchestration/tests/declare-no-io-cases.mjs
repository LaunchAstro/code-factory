// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const cli = process.env.DECLARE_CANDIDATE ?? new URL('../declare.mjs', import.meta.url).pathname;
const config = {
  schemaVersion: 1,
  projectId: 'fixture',
  aliases: [],
  repositories: ['example/product'],
  sections: [],
  sectionSource: null,
};
const input = {
  kind: 'boot',
  projectId: 'fixture',
  repository: 'example/product',
  laneId: 'lane-1',
  sessionId: 'session-1',
  machine: 'fixture-machine',
  workspaceId: 'wA',
  paneId: 'wA:p1',
  assignmentId: 'assignment-1',
  sectionId: null,
  mapRef: null,
  specRef: null,
  ticketRef: null,
  phase: 'build',
};
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cf-no-io-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project.json'),
    preload = join(root, 'deny-io.mjs');
  writeFileSync(project, JSON.stringify(config));
  writeFileSync(
    preload,
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync;
let trustedRead = false;
const originals = Object.fromEntries(Object.keys(fs).map((key) => [key, fs[key]]));
const allowed = new Set(JSON.parse(process.env.TEST_MODULES).flatMap((p) => [p, 'file://' + p]));
fs.readFileSync = (path, ...args) => {
  if (path !== 0 && path !== process.env.TEST_PROJECT && !allowed.has(String(path))) throw new Error('LEDGER_IO_ATTEMPT');
  trustedRead = true;
  try { return read(path, ...args); } finally { trustedRead = false; }
};
for (const name of ['openSync','writeFileSync','mkdirSync','readdirSync','lstatSync','rmSync','writeSync','fsyncSync','ftruncateSync','fstatSync'])
  fs[name] = (...args) => { if (trustedRead) return originals[name](...args); throw new Error('LEDGER_IO_ATTEMPT'); };
syncBuiltinESMExports();`,
  );
  return { root, project, preload };
}
function run(f, command, record = input, extras = []) {
  return spawnSync(
    process.execPath,
    [
      '--import',
      f.preload,
      cli,
      command,
      '--config',
      f.project,
      '--dir',
      join(f.root, 'ledger-must-not-open'),
      ...extras,
    ],
    {
      env: { ...process.env, TEST_PROJECT: f.project, TEST_MODULES: JSON.stringify([cli]) },
      input: JSON.stringify(record),
      encoding: 'utf8',
    },
  );
}
test('CLI emits validated records and PHASE compatibility with all ledger I/O trapped', (t) => {
  const f = fixture(t),
    before = Date.now();
  for (const record of [
    input,
    { ...input, kind: 'assignment', assignmentId: 'assignment-2', phase: 'spec' },
  ]) {
    const result = run(f, 'append', record);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(
      Object.fromEntries(Object.keys(record).map((key) => [key, output.record[key]])),
      record,
    );
    assert.equal(output.record.schemaVersion, 1);
    assert.ok(Date.parse(output.record.observedAt) >= before);
    assert.ok(Date.parse(output.record.observedAt) <= Date.now());
    assert.match(
      output.compatibility[0],
      /^\S+ lane-1 (BOOTED|TICKET) Section: none Ticket: none$/,
    );
    assert.equal(
      output.compatibility[1],
      `${output.record.observedAt} lane-1 PHASE Phase: ${record.phase}`,
    );
  }
});
test('removed read, replay and events entrypoints refuse without ledger or lifecycle I/O', (t) => {
  const f = fixture(t);
  for (const [command, extra] of [
    ['read', []],
    ['compatibility', []],
    ['append', ['--events', join(f.root, 'must-not-create.log')]],
  ]) {
    const result = run(f, command, input, extra);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /declaration refused: (unknown-command|usage)/);
  }
});
test('remaining strict record validation refuses invalid input without disclosure or file I/O', (t) => {
  const f = fixture(t);
  for (const change of [
    { repository: 'other/repo' },
    { projectId: 'wrong' },
    { sectionId: 'unknown' },
    { phase: 'done' },
    { ticketRef: '#3' },
    { specRef: 'other/repo#2' },
    { mapRef: 'example/product#0' },
    { ticketRef: 'example/product#9007199254740992' },
    { transcript: 'PRIVATE_FIXTURE_SENTINEL' },
    { observedAt: '2020-01-01T00:00:00.000Z' },
    { schemaVersion: 1 },
    { sessionId: '../escape' },
  ]) {
    const result = run(f, 'append', { ...input, ...change });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /PRIVATE_FIXTURE_SENTINEL/);
  }
});
test('public writer emits records without any ledger operation and history validation remains strict', async (t) => {
  const f = fixture(t),
    script = join(f.root, 'public.mjs');
  writeFileSync(
    script,
    `import assert from 'node:assert/strict';
const m = await import(${JSON.stringify(new URL('file://' + cli).href)});
const config = ${JSON.stringify(config)}, input = ${JSON.stringify(input)};
const result = await m.appendDeclaration('ledger-must-not-open', config, input);
assert.equal(result.record.kind, 'boot');
assert.equal(m.readLedger, undefined);
m.validateHistory([result.record], config);
const identity = Object.fromEntries(['projectId','repository','laneId','sessionId','machine','workspaceId','paneId','assignmentId'].map((k) => [k,result.record[k]]));
const evidence = {schemaVersion: 1, observedAt: result.record.observedAt, ...identity, prRef: 'example/product#1', head: 'a'.repeat(40)};
const review = {...evidence, kind: 'review', verdict: 'approved'};
assert.throws(() => m.validateHistory([result.record, review], config), /unobserved-pr-head/);
m.validateHistory([result.record, {...evidence, kind: 'pr-opened'}, review], config);
assert.throws(() => m.validateHistory([result.record, {...result.record, kind: 'assignment', assignmentId: 'assignment-2', machine: 'other'}], config), /identity-conflict/);
process.stdout.write('public writer no I/O passed\\n');`,
  );
  const result = spawnSync(process.execPath, ['--import', f.preload, script], {
    env: { ...process.env, TEST_PROJECT: f.project, TEST_MODULES: JSON.stringify([cli, script]) },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'public writer no I/O passed\n');
});

test('configuration validation still refuses numeric identity and invalid membership at the append entrypoint', (t) => {
  const f = fixture(t);
  for (const [change, code] of [
    [{ projectId: 123 }, 'invalid-project'],
    [{ repositories: [] }, 'missing-config-source'],
    [{ repositories: ['example/product', 'example/product'] }, 'invalid-config-membership'],
    [{ sections: ['Checks'] }, 'invalid-config-membership'],
    [{ sections: ['checks'], sectionSource: null }, 'missing-config-source'],
    [{ surprise: true }, 'invalid-fields'],
  ]) {
    writeFileSync(f.project, JSON.stringify({ ...config, ...change }));
    const result = run(f, 'append');
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `declaration refused: ${code}\n`);
  }
});
