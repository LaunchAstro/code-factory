// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { parseRecord, presetFindings } from '../../scripts/preset-boundary-check.mjs';

const repo = resolve(import.meta.dirname, '../..');
const checker = join(repo, 'scripts/preset-boundary-check.mjs');

const entry = (path, text = '{}\n') => ({ path, symlink: false, text });
// A finding names its file by fingerprint: the first eight hex digits of the path's sha256, and
// its length. A tracked name can hold a credential or a line that CI reads as a command.
const shown = (path) =>
  `<withheld-path ${createHash('sha256').update(path).digest('hex').slice(0, 8)}/${path.length}>`;

/** A throwaway repository. `tracked` are added to the index; `loose` are not. */
function repository(tracked, loose = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'preset-boundary-'));
  execFileSync('git', ['init', '-q', dir]);
  for (const [path, text] of Object.entries(tracked)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  execFileSync('git', ['-C', dir, 'add', '-A']);
  for (const [path, text] of Object.entries(loose)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const run = (dir) => spawnSync(process.execPath, [checker, dir], { encoding: 'utf8' });

test('data is inside the boundary and executable code of any kind is outside', () => {
  assert.deepEqual(
    presetFindings([
      entry('presets/.gitkeep', ''),
      entry('presets/README.md', '# presets\n'),
      entry('presets/crm.json'),
    ]),
    [],
  );
  for (const path of [
    'presets/run.sh',
    'presets/crm.mjs',
    'presets/seed.py',
    'presets/crm/index.ts',
  ]) {
    const found = presetFindings([entry(path, 'echo\n')]);
    assert.equal(found.length, 1, path);
    assert.ok(found[0].startsWith(shown(path)), path);
  }
  // A file with no extension at all is not data either, and is named.
  const bare = presetFindings([entry('presets/Makefile', 'all:\n')]);
  assert.equal(bare.length, 1);
  assert.ok(bare[0].startsWith(shown('presets/Makefile')));
});

test('a .json that does not parse, or is not an object at the top, is refused', () => {
  for (const text of ['{', '[1, 2]', '"a string"', '42', 'null']) {
    const found = presetFindings([entry('presets/crm.json', text)]);
    assert.equal(found.length, 1, text);
    assert.ok(found[0].startsWith(shown('presets/crm.json')), text);
  }
  assert.deepEqual(presetFindings([entry('presets/crm.json', '{ "name": "crm" }')]), []);
});

test('a symbolic link is refused once, for being a link and not for its name', () => {
  const found = presetFindings([{ path: 'presets/link.json', symlink: true, text: null }]);
  assert.equal(found.length, 1);
  assert.ok(found[0].startsWith(shown('presets/link.json')));
  assert.match(found[0], /link/u);
});

test('the command reads what git tracks, and not what the working tree holds', () => {
  const loose = run(repository({ 'presets/.gitkeep': '' }, { 'presets/run.sh': 'echo\n' }));
  assert.equal(loose.status, 0, loose.stderr);
  assert.match(loose.stdout, /0 preset file\(s\)/u);

  const added = run(repository({ 'presets/.gitkeep': '', 'presets/run.sh': 'echo\n' }));
  assert.equal(added.status, 1, added.stdout);
  assert.ok(added.stderr.includes(shown('presets/run.sh')), added.stderr);
  assert.match(added.stdout, /1 preset file\(s\)/u);
});

test('the command reads a tracked link by the mode git recorded, not by the disk', () => {
  const dir = repository({ 'presets/.gitkeep': '', 'presets/real.json': '{}\n' });
  symlinkSync('real.json', join(dir, 'presets/link.json'));
  execFileSync('git', ['-C', dir, 'add', '-A']);
  const linked = run(dir);
  assert.equal(linked.status, 1, linked.stdout);
  assert.ok(linked.stderr.includes(shown('presets/link.json')), linked.stderr);
  // The file it points at is data, and is not a finding of its own.
  assert.equal(linked.stderr.includes(shown('presets/real.json')), false, linked.stderr);
});

test('only the first tab in a git record separates the mode from the path', () => {
  assert.deepEqual(parseRecord('100644 abc 0\tpresets/safe.md'), {
    path: 'presets/safe.md',
    symlink: false,
    object: 'abc',
    stage: '0',
  });
  // The tab in the name belongs to the name, not to the record.
  assert.deepEqual(parseRecord('100644 abc 0\tpresets/safe.md\trun.sh'), {
    path: 'presets/safe.md\trun.sh',
    symlink: false,
    object: 'abc',
    stage: '0',
  });
  assert.deepEqual(parseRecord('120000 abc 0\tpresets/link.json'), {
    path: 'presets/link.json',
    symlink: true,
    object: 'abc',
    stage: '0',
  });
  assert.throws(() => parseRecord('100644 abc 0 presets/safe.md'), /no path/u);
});

test('a tracked name holding a tab is read whole, and its real extension refused', () => {
  const shell = run(repository({ 'presets/.gitkeep': '', 'presets/safe.md\trun.sh': 'echo\n' }));
  assert.equal(shell.status, 1, shell.stdout);
  assert.ok(shell.stderr.includes(shown('presets/safe.md\trun.sh')), shell.stderr);
  assert.match(shell.stdout, /1 preset file\(s\)/u);

  // And the shortened name is never the one read off disk either.
  const loose = run(
    repository({ 'presets/safe.md\trun.sh': 'echo\n' }, { 'presets/safe.md': '# safe\n' }),
  );
  assert.equal(loose.status, 1, loose.stdout);
  assert.ok(loose.stderr.includes(shown('presets/safe.md\trun.sh')), loose.stderr);
});

// Sol CF-07, 3 October: what git cannot list is refused, and the index is what is judged.
test('a repository git cannot read is refused, never an empty pass', () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'preset-boundary-')), 'missing');
  const result = run(missing);
  assert.equal(result.status, 2, result.stdout);
  assert.doesNotMatch(result.stdout, /every preset is data/u);
});

test('the staged bytes are judged, not the working tree beside them', () => {
  const staged = run(repository({ 'presets/a.json': '{' }, { 'presets/a.json': '{}' }));
  assert.equal(staged.status, 1, staged.stdout);
  assert.ok(staged.stderr.includes(`${shown('presets/a.json')}: not parseable as JSON`));
  const clean = run(repository({ 'presets/a.json': '{}' }, { 'presets/a.json': '{' }));
  assert.equal(clean.status, 0, clean.stderr);
});

test('a replacement ref cannot stand in for the staged bytes', () => {
  const dir = repository({ 'presets/a.json': '{' });
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  const staged = git('rev-parse', ':presets/a.json');
  const valid = execFileSync('git', ['-C', dir, 'hash-object', '-w', '--stdin'], {
    input: '{}',
    encoding: 'utf8',
  }).trim();
  git('replace', staged, valid);
  const result = run(dir);
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes(`${shown('presets/a.json')}: not parseable as JSON`));
});

test('an unresolved merge in presets is refused, not read as three files', () => {
  const dir = repository({ 'presets/a.json': '{}' });
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  const object = git('rev-parse', ':presets/a.json');
  git('update-index', '--force-remove', 'presets/a.json');
  execFileSync('git', ['-C', dir, 'update-index', '--index-info'], {
    input: [1, 2, 3].map((stage) => `100644 ${object} ${stage}\tpresets/a.json\n`).join(''),
  });
  const result = run(dir);
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes(`${shown('presets/a.json')}: an unresolved merge`));
});

test('the document names the check', () => {
  const text = readFileSync(join(repo, 'docs/licensing/preset-boundary.md'), 'utf8');
  assert.match(text, /scripts\/preset-boundary-check\.mjs/u);
  assert.doesNotMatch(text, /No preset exists, so no check does/u);
});

test('this repository passes, and says how many presets it read', () => {
  const here = run(repo);
  assert.equal(here.status, 0, here.stderr);
  assert.match(here.stdout, /0 preset file\(s\)/u);
  assert.match(here.stdout, /every preset is data/u);
});

// Sol CF-07 round three: listing the index and reading blobs need no GitHub or registry credential.
test('local Git never receives a GitHub or registry credential', () => {
  const dir = repository({ 'presets/a.json': '{}\n' });
  const bin = mkdtempSync(join(tmpdir(), 'preset-boundary-bin-'));
  try {
    const tokens = ['GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN'];
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/sh\n: > '${bin}/ran'\n[ -n "${tokens.map((name) => `\${${name}:-}`).join('')}" ] && : > '${bin}/seen'\nexec '${realGit}' "$@"\n`,
    );
    chmodSync(join(bin, 'git'), 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    for (const name of tokens) env[name] = 'synthetic-unused';
    const result = spawnSync(process.execPath, [checker, dir], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(bin, 'ran')), 'the real local Git ran');
    assert.equal(existsSync(join(bin, 'seen')), false, 'a credential reached local Git');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

// Sol's CF-07-FIX5: Git hands back a loose object's bytes without hashing them, so valid JSON
// stored under the staged blob's id would stand in for the malformed bytes the index names.
test('other bytes stored under the staged blob id are refused, not judged', () => {
  const dir = repository({ 'presets/a.json': '{' });
  try {
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
    const staged = git('rev-parse', ':presets/a.json');
    assert.equal(run(dir).status, 1, 'the staged bytes are malformed');
    const path = join(dir, '.git/objects', staged.slice(0, 2), staged.slice(2));
    chmodSync(path, 0o644);
    writeFileSync(path, deflateSync(Buffer.from('blob 2\0{}')));
    assert.equal(git('cat-file', 'blob', staged), '{}', 'Git serves the other bytes');
    assert.equal(git('rev-parse', ':presets/a.json'), staged, 'the index still names it');
    const result = run(dir);
    assert.equal(result.status, 2, 'a blob whose bytes do not match its id is no evidence');
    assert.match(result.stderr, /nothing was checked/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Security review of 15ad8c8, finding 5: a tracked name is the committer's text, and CI logs and
// annotations read what the check prints. No part of it is printed, the extension included.
test('a tracked preset name is never printed, only its fingerprint', () => {
  const names = [
    'presets/SYNTHETIC-MARKER-one.sh',
    'presets/a.SYNTHETIC-MARKER-two',
    'presets/x\n::error::SYNTHETIC-MARKER-three.json',
  ];
  const result = run(repository(Object.fromEntries(names.map((name) => [name, '{']))));
  assert.equal(result.status, 1, result.stdout);
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /SYNTHETIC-MARKER|::error::/u, 'a tracked name was printed');
  for (const name of names) assert.ok(output.includes(shown(name)), name);
});
