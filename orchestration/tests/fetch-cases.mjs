// node --test orchestration/tests/fetch-cases.mjs
// Each case copies orchestration/skills/fetch.mjs into a throwaway skills
// directory with its own SOURCES.json, and answers its `gh api` calls from a
// stub on PATH. No case reaches the network or a real account.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { closedPipe, fullPipe } from './stderr-pipe-fixture.mjs';

const fetcher = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'fetch.mjs');
const BODY = '# pinned skill\n';
const SKILL = {
  name: 'orchestrator',
  repository: 'fixture/repo',
  path: 'skill',
  commit: 'a'.repeat(40),
  sha256: createHash('sha256').update(BODY).digest('hex'),
};

function write(path, body, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, mode === undefined ? undefined : { mode });
}

// The stub answers the directory listing of `skill` with `entries`, the
// repository root's listing with `skill` as a directory whose git tree is
// TREE, that tree with each entry's mode (`modes`, else 100644), a file named
// in `raw` with that response as it stands, and every other file read with
// `body`. It logs each API path it is asked for to gh.log.
const TREE = 'c'.repeat(40);
function stubGh(bin, { body = BODY, entries = [{ type: 'file', name: 'SKILL.md', path: 'skill/SKILL.md' }], raw = {}, modes = {} } = {}) {
  const content = JSON.stringify({ content: Buffer.from(body).toString('base64') });
  const root = JSON.stringify([{ type: 'dir', name: 'skill', path: 'skill', sha: TREE }]);
  const tree = JSON.stringify({ sha: TREE, truncated: false, tree: entries.map((e) => ({ path: e.name, mode: modes[e.name] ?? '100644', type: 'blob' })) });
  const log = join(bin, '..', 'gh.log');
  const files = Object.entries(raw).map(([name, response]) => `*'contents/skill/${name}?ref='*) printf '%s\\n' '${response}';; `).join('');
  write(
    join(bin, 'gh'),
    `#!/bin/sh\nprintf '%s\\n' "$2" >> '${log}'\ncase "$2" in *'contents/skill?ref='*) printf '%s\\n' '${JSON.stringify(entries)}';; *'contents/?ref='*) printf '%s\\n' '${root}';; *'git/trees/${TREE}') printf '%s\\n' '${tree}';; ${files}*) printf '%s\\n' '${content}';; esac\n`,
    0o755,
  );
}

function fixture(t, skills = [SKILL]) {
  const root = mkdtempSync(join(tmpdir(), 'fetch-case-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const here = join(root, 'skills');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  write(join(here, 'fetch.mjs'), readFileSync(fetcher));
  write(join(here, 'SOURCES.json'), JSON.stringify({ skills, prerequisites: [] }));
  stubGh(bin);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const run = (...args) =>
    spawnSync(process.execPath, [join(here, 'fetch.mjs'), ...args], { cwd: root, env, encoding: 'utf8' });
  const asked = () => (existsSync(join(root, 'gh.log')) ? readFileSync(join(root, 'gh.log'), 'utf8').split('\n').filter(Boolean) : []);
  return { root, here, bin, env, installed: join(here, SKILL.name, 'SKILL.md'), run, asked };
}

test('fetch installs a pinned skill, and --check then passes', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  assert.equal(readFileSync(f.installed, 'utf8'), BODY);
  const check = f.run('--check');
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /skills:pinned clean/);
});

test('a skill name that is not one path segment is refused before anything is removed', (t) => {
  const f = fixture(t, [{ ...SKILL, name: '../victim' }]);
  const sentinel = join(f.root, 'victim', 'keep.txt');
  write(sentinel, 'an unrelated file\n');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /\.\.\/victim/);
  assert.equal(readFileSync(sentinel, 'utf8'), 'an unrelated file\n');
});

test('a fetched entry whose name leaves its directory is refused', (t) => {
  const f = fixture(t);
  stubGh(f.bin, { entries: [{ type: 'file', name: '../../escaped.md', path: 'skill/x' }] });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(f.root, 'escaped.md')), false);
});

test('--check refuses a skill that is not installed', (t) => {
  const f = fixture(t);
  const result = f.run('--check');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FAIL {5}orchestrator .*not installed/);
});

test('--check refuses an installed skill that differs from its pin', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  write(f.installed, '# altered installed instructions\n');
  const result = f.run('--check');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FAIL {5}orchestrator .*SKILL\.md/);
});

test('a hash mismatch leaves the installed skill as it was', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  stubGh(f.bin, { body: '# rejected instructions\n' });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(f.installed, 'utf8'), BODY);
});

test('a manifest that pins no skills is refused', (t) => {
  const f = fixture(t, []);
  const result = f.run('--check');
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /pinned clean/);
});

// Sol's review of 11bb360: two pins with one name would install over each other.
test('a skill pinned twice is refused before anything is fetched', (t) => {
  const f = fixture(t, [SKILL, SKILL]);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pinned twice/);
  assert.deepEqual(f.asked(), []);
});

// Each pin field read on its own, so removing any one shape check breaks a case.
const MALFORMED = {
  repository: 'fixture/repo/contents/other',
  commit: 'main',
  sha256: 'abc',
  path: 'skill/../other',
};
for (const [key, value] of Object.entries(MALFORMED)) {
  test(`a malformed ${key} pin is refused before anything is fetched`, (t) => {
    const f = fixture(t, [{ ...SKILL, [key]: value }]);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`${key} is malformed`));
    assert.deepEqual(f.asked(), []);
  });
}

test('a skill path cannot carry a query that replaces the pinned commit', (t) => {
  const f = fixture(t, [{ ...SKILL, path: `skill?ref=${'b'.repeat(40)}#` }]);
  f.run();
  assert.ok(f.asked().length > 0);
  for (const path of f.asked()) {
    const url = new URL(path, 'https://api.github.test/');
    assert.equal(url.searchParams.get('ref'), SKILL.commit, `${path} asks for another commit`);
    assert.equal(url.hash, '', `${path} carries a fragment`);
  }
  assert.equal(existsSync(f.installed), false);
});

// The installed copy is compared file by file, not by SKILL.md alone: a helper
// file the skill runs is as much its instructions.
const HELPER = [
  { type: 'file', name: 'SKILL.md', path: 'skill/SKILL.md' },
  { type: 'file', name: 'helper.sh', path: 'skill/helper.sh' },
];
const DRIFT = {
  'differs from its pin': [(dir) => write(join(dir, 'helper.sh'), 'echo altered\n'), /helper\.sh differs from the pin/],
  'is missing': [(dir) => rmSync(join(dir, 'helper.sh')), /helper\.sh missing/],
  'the pin does not carry': [(dir) => write(join(dir, 'extra.sh'), 'echo extra\n'), /extra\.sh not in the pin/],
  'has lost its executable bit': [(dir) => chmodSync(join(dir, 'helper.sh'), 0o644), /helper\.sh mode differs from the pin/],
  'is an unpinned symlink': [
    (dir) => {
      write(join(dir, '..', '..', 'outside.sh'), 'echo outside\n');
      symlinkSync(join(dir, '..', '..', 'outside.sh'), join(dir, 'extra.sh'));
    },
    /extra\.sh not in the pin/,
  ],
};
for (const [drift, [change, named]] of Object.entries(DRIFT)) {
  test(`--check refuses an installed helper file that ${drift}`, (t) => {
    const f = fixture(t);
    stubGh(f.bin, { entries: HELPER, modes: { 'helper.sh': '100755' } });
    assert.equal(f.run().status, 0);
    assert.equal(f.run('--check').status, 0);
    change(join(f.here, SKILL.name));
    const result = f.run('--check');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, named);
  });
}

test('--check compares the skills installed where --installed names, not beside this copy', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const checked = join(f.root, 'checked');
  write(join(checked, 'fetch.mjs'), readFileSync(fetcher));
  write(join(checked, 'SOURCES.json'), readFileSync(join(f.here, 'SOURCES.json')));
  const result = spawnSync(process.execPath, [join(checked, 'fetch.mjs'), '--check', '--installed', f.here], { cwd: f.root, env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /skills:pinned clean/);
  write(f.installed, '# altered installed instructions\n');
  const altered = spawnSync(process.execPath, [join(checked, 'fetch.mjs'), '--check', '--installed', f.here], { cwd: f.root, env: f.env, encoding: 'utf8' });
  assert.notEqual(altered.status, 0);
  assert.match(altered.stdout, /FAIL {5}orchestrator .*SKILL\.md differs/);
});

// A file read whose response is not one base64 file installs nothing: the
// bytes would otherwise be whatever a lenient decoder makes of it.
const HELPER_SH = Buffer.from('echo helper!\n').toString('base64'); // padded, 13 bytes
const UNREADABLE = {
  'are not base64': '{"content":"!","encoding":"base64"}',
  'are base64 with no padding': `{"content":"${HELPER_SH.replace(/=+$/, '')}","encoding":"base64"}`,
  'are shorter than the size it states': `{"content":"${HELPER_SH}","encoding":"base64","size":100}`,
  'are not base64 encoded': '{"content":"","encoding":"none","size":12}',
};
for (const [what, response] of Object.entries(UNREADABLE)) {
  test(`a helper file whose contents ${what} is refused, naming the skill`, (t) => {
    const f = fixture(t);
    stubGh(f.bin, { entries: HELPER, raw: { 'helper.sh': response } });
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /orchestrator: .*helper\.sh/);
    assert.equal(existsSync(join(f.here, SKILL.name)), false);
  });
}

test('a helper file read with its base64 broken over lines installs as its bytes', (t) => {
  const f = fixture(t);
  const lines = Buffer.from('echo a helper long enough to wrap\n').toString('base64').replace(/(.{20})/g, '$1\\n');
  stubGh(f.bin, { entries: HELPER, raw: { 'helper.sh': `{"content":"${lines}","encoding":"base64"}` } });
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(f.here, SKILL.name, 'helper.sh'), 'utf8'), 'echo a helper long enough to wrap\n');
});

const USAGE = 'usage: node orchestration/skills/fetch.mjs [--check] [--installed <dir>]\n';

test('a usage refusal keeps exit 2 when stderr is a closed pipe', (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [join(f.here, 'fetch.mjs'), '--installed'], { cwd: f.root, env: f.env, encoding: 'utf8', stdio: ['ignore', 'pipe', closedPipe(t)] });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});

test('a malformed manifest keeps exit 1 when stderr is a closed pipe', (t) => {
  const f = fixture(t, []);
  const result = spawnSync(process.execPath, [join(f.here, 'fetch.mjs')], { cwd: f.root, env: f.env, encoding: 'utf8', stdio: ['ignore', 'pipe', closedPipe(t)] });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
});

test('a usage refusal arrives whole, with exit 2, once a full stderr pipe drains', async (t) => {
  const f = fixture(t);
  const result = await fullPipe(t, [join(f.here, 'fetch.mjs'), '--installed'], { cwd: f.root, env: f.env });
  assert.deepEqual(result, { status: 2, stderr: USAGE });
});

test('a malformed manifest refusal arrives whole, with exit 1, once a full stderr pipe drains', async (t) => {
  const f = fixture(t, []);
  const result = await fullPipe(t, [join(f.here, 'fetch.mjs')], { cwd: f.root, env: f.env });
  assert.deepEqual(result, { status: 1, stderr: 'refused: SOURCES.json is malformed, nothing fetched or removed:\n  SOURCES.json pins no skills\n' });
});

// Sol's review of 790f255: the pinned orchestrator runs ctx.sh, send.sh and
// packet.sh directly, and a contents read carries no file mode.
const executable = (path) => (statSync(path).mode & 0o100) !== 0;

test('a helper its git tree marks executable installs executable, and the rest do not', (t) => {
  const f = fixture(t);
  stubGh(f.bin, { entries: HELPER, modes: { 'helper.sh': '100755' } });
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(executable(join(f.here, SKILL.name, 'helper.sh')), true);
  assert.equal(executable(f.installed), false);
  assert.ok(f.asked().includes(`repos/${SKILL.repository}/git/trees/${TREE}`), 'the tree is read by the sha the pinned listing gave');
});

test('a file its git tree gives no regular file mode is refused, naming the skill', (t) => {
  const f = fixture(t);
  stubGh(f.bin, { entries: HELPER, modes: { 'helper.sh': '120000' } });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /orchestrator: .*helper\.sh/);
  assert.equal(existsSync(join(f.here, SKILL.name)), false);
});
