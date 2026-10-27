// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the documentation link checker: which links it reads, and what it resolves them against.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { linkTargets, resolves, targetPath } from '../../scripts/doc-links-check.mjs';

const repo = resolve(import.meta.dirname, '../..');
const checker = join(repo, 'scripts/doc-links-check.mjs');

test('a relative inline link is found, with the line it sits on', () => {
  const markdown = '# Title\n\nSee [the checkpoint](docs/agents/review-checkpoint.md) for this.\n';
  assert.deepEqual(linkTargets(markdown), [
    { target: 'docs/agents/review-checkpoint.md', line: 3 },
  ]);
});

test('external, mail and same-document links are somebody else’s problem', () => {
  const markdown = [
    '[site](https://example.invalid/page)',
    '[mail](mailto:nobody@example.invalid)',
    '[protocol relative](//example.invalid/page)',
    '[same document](#keep-changes-reviewable)',
  ].join('\n');
  assert.deepEqual(linkTargets(markdown), []);
});

test('a link inside a fenced block is an example, not a link', () => {
  const markdown = ['```', '[example](does/not/exist.md)', '```', '[real](README.md)'].join('\n');
  assert.deepEqual(linkTargets(markdown), [{ target: 'README.md', line: 4 }]);
});

test('an anchor is stripped and the rest resolves against the linking file', () => {
  assert.equal(targetPath('docs/plan/ruleset.md', '../TRAPS.md#gate'), 'docs/TRAPS.md');
  assert.equal(targetPath('CONTRIBUTING.md', 'AGENTS.md'), 'AGENTS.md');
  assert.equal(targetPath('CONTRIBUTING.md', '#only-an-anchor'), '');
});

test('resolves() answers for the tracked file, not for the anchor', () => {
  const tracked = new Set(['README.md', 'docs/present.md']);
  assert.equal(resolves(tracked, 'README.md', 'docs/present.md'), true);
  assert.equal(resolves(tracked, 'README.md', 'docs/present.md#a-heading'), true);
  assert.equal(resolves(tracked, 'docs/present.md', '../README.md'), true);
  assert.equal(resolves(tracked, 'README.md', 'docs/absent.md'), false);
  assert.equal(resolves(tracked, 'README.md', 'docs'), false);
});

test('this repository’s own documentation passes', () => {
  const run = spawnSync(process.execPath, [checker, repo], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /doc-links: every relative link resolves\./u);
});

test('a dangling link fails the run and is named with its line', () => {
  const root = mkdtempSync(join(tmpdir(), 'doc-links-broken-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    git('init', '-q');
    writeFileSync(join(root, 'README.md'), '# Title\n\nSee [gone](docs/gone.md).\n');
    git('add', 'README.md');
    const run = spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /README\.md:3: docs\/gone\.md does not resolve/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A scratch repository inside its own scratch parent, so `../` from it is still ours to delete. */
function scratchRepository(t) {
  const parent = mkdtempSync(join(tmpdir(), 'doc-links-scratch-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repo');
  mkdirSync(root);
  execFileSync('git', ['-C', root, 'init', '-q']);
  return root;
}

const tracked = (root, path, text) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
  execFileSync('git', ['-C', root, 'add', path]);
};

const check = (root) => spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });

// Sol's CF-11 review, doc-links-check.mjs:68: the header promises a tracked
// file, and the check asked the filesystem.
test('a link to an untracked file, a directory or a file outside the repository is refused', (t) => {
  const outcomes = ['untracked', 'directory', 'outside'].map((kind) => {
    const root = scratchRepository(t);
    const target = { untracked: 'local-only.md', directory: 'docs', outside: '../outside.md' }[
      kind
    ];
    if (kind === 'directory') tracked(root, 'docs/kept.md', '# kept\n');
    else writeFileSync(join(root, target), '# present on disk\n');
    tracked(root, 'README.md', `[target](${target})\n`);
    const ran = check(root);
    return { kind, status: ran.status, named: ran.stderr.includes(`README.md:1: ${target}`) };
  });
  assert.deepEqual(
    outcomes,
    ['untracked', 'directory', 'outside'].map((kind) => ({ kind, status: 1, named: true })),
  );
});

// Sol's CF-11 review, doc-links-check.mjs:86: nothing read is not a pass.
test('an empty tracked document set is refused rather than certified', (t) => {
  const root = scratchRepository(t);
  tracked(root, 'notes.txt', 'not Markdown\n');
  const ran = check(root);
  assert.equal(ran.status, 2, ran.stdout);
  assert.match(ran.stderr, /doc-links: no tracked Markdown/u);
  assert.doesNotMatch(ran.stdout, /every relative link resolves/u);
});

// Sol's CF-11 review, doc-links-check.mjs:42: either marker toggled the fence.
const shown = (markdown) => linkTargets(markdown).map(({ target, line }) => `${line}:${target}`);

test('a fence closes only on its own marker, at least as long, with nothing after it', (t) => {
  assert.deepEqual(shown('```\n~~~\n```\n[shown](a.md)\n'), ['4:a.md']);
  assert.deepEqual(shown('~~~\n```\n~~~\n[shown](a.md)\n'), ['4:a.md']);
  assert.deepEqual(shown('````\n```\n[hidden](h.md)\n````\n[shown](a.md)\n'), ['5:a.md']);
  assert.deepEqual(shown('```\n``` js\n[hidden](h.md)\n```\n[shown](a.md)\n'), ['5:a.md']);
  assert.deepEqual(shown('``` a`b\n[shown](a.md)\n'), ['2:a.md']);
  assert.deepEqual(shown('    ```\n[shown](a.md)\n'), ['2:a.md']);
  assert.deepEqual(shown('~~~\r~~~\r[shown](a.md)\r'), ['3:a.md']);
  assert.deepEqual(shown('```\n[hidden](h.md)\n'), []);
  const root = scratchRepository(t);
  tracked(root, 'README.md', '```\n~~~\n```\n[visible](missing.md)\n');
  const ran = check(root);
  assert.equal(ran.status, 1, ran.stdout);
  assert.match(ran.stderr, /README\.md:4: missing\.md does not resolve/u);
});

// Sol's CF-11-FIX1 review, doc-links-check.mjs:93: being in the index is not
// being a file. A tracked target deleted, a directory in its place, or a
// tracked symlink leading out of the repository each passed.
test('a tracked target that is deleted, now a directory, or a symlink leading outside is refused', (t) => {
  const outcomes = ['deleted', 'directory', 'symlink outside'].map((kind) => {
    const root = scratchRepository(t);
    if (kind === 'symlink outside') {
      writeFileSync(join(root, '../outside.txt'), 'outside\n');
      symlinkSync('../outside.txt', join(root, 'target.txt'));
      execFileSync('git', ['-C', root, 'add', 'target.txt']);
    } else tracked(root, 'target.txt', 'target\n');
    tracked(root, 'README.md', '[target](target.txt)\n');
    if (kind !== 'symlink outside') rmSync(join(root, 'target.txt'));
    if (kind === 'directory') mkdirSync(join(root, 'target.txt'));
    const ran = check(root);
    return { kind, status: ran.status, named: ran.stderr.includes('README.md:1: target.txt') };
  });
  assert.deepEqual(
    outcomes,
    ['deleted', 'directory', 'symlink outside'].map((kind) => ({ kind, status: 1, named: true })),
  );
  const inside = scratchRepository(t);
  tracked(inside, 'docs/real.md', '# real\n');
  symlinkSync('docs/real.md', join(inside, 'alias.md'));
  execFileSync('git', ['-C', inside, 'add', 'alias.md']);
  tracked(inside, 'README.md', '[alias](alias.md)\n');
  assert.equal(
    check(inside).status,
    0,
    'a tracked symlink to a tracked file inside still resolves',
  );
});

// Sol's CF-11-FIX1 review, doc-links-check.mjs:125: the count and the links
// came from separate reads of the index, so an index emptied between them
// certified "1 document(s) checked" with nothing read.
test('the documents counted are the documents read, from one read of the index', (t) => {
  const root = scratchRepository(t);
  tracked(root, 'README.md', '[broken](missing.md)\n');
  const realGit = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
  const bin = join(root, '..', 'bin');
  mkdirSync(bin);
  const done = join(root, '..', 'emptied');
  writeFileSync(
    join(bin, 'git'),
    `#!/bin/sh\n'${realGit}/git' "$@"\nstatus=$?\nif [ ! -f '${done}' ]; then\n` +
      `  '${realGit}/git' -C '${root}' update-index --force-remove README.md\n  : > '${done}'\nfi\n` +
      'exit "$status"\n',
    { mode: 0o755 },
  );
  const ran = spawnSync(process.execPath, [checker, root], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }), '');
  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stderr, /README\.md:1: missing\.md does not resolve/u);
});

// Sol's CF-11-FIX2 review, doc-links-check.mjs:113: the tracked list was
// filtered before documents were chosen, so a tracked document deleted, now a
// directory, or a symlink leading outside dropped out and the rest passed.
test('a tracked document that is deleted, now a directory, or a symlink leading outside is refused', (t) => {
  const outcomes = ['deleted', 'directory', 'symlink outside'].map((kind) => {
    const root = scratchRepository(t);
    tracked(root, 'README.md', '# kept\n');
    tracked(root, 'gone.md', '[broken](missing.md)\n');
    rmSync(join(root, 'gone.md'));
    if (kind === 'directory') mkdirSync(join(root, 'gone.md'));
    if (kind === 'symlink outside') {
      writeFileSync(join(root, '../outside.md'), '# outside\n');
      symlinkSync('../outside.md', join(root, 'gone.md'));
    }
    const ran = check(root);
    return { kind, status: ran.status, named: ran.stderr.includes('gone.md: ') };
  });
  assert.deepEqual(
    outcomes,
    ['deleted', 'directory', 'symlink outside'].map((kind) => ({ kind, status: 1, named: true })),
  );
});

// Sol's CF-11-FIX2 review, doc-links-check.mjs:136: the document was read by
// path after its checks, so one swapped for a symlink leading outside in
// between was read and its outside bytes certified.
test('a document swapped for a symlink leading outside after its checks is refused', (t) => {
  const root = scratchRepository(t);
  tracked(root, 'README.md', '[broken](missing.md)\n');
  writeFileSync(join(root, '../outside.md'), '# outside, no links\n');
  const readme = realpathSync(join(root, 'README.md'));
  const swap = join(root, '../swap.mjs');
  writeFileSync(
    swap,
    "import fs from 'node:fs';\nimport { syncBuiltinESMExports } from 'node:module';\n" +
      'const stat = fs.statSync;\nlet done = false;\n' +
      'fs.statSync = (path, ...rest) => {\n  const result = stat(path, ...rest);\n' +
      `  if (!done && String(path) === ${JSON.stringify(readme)}) {\n    done = true;\n` +
      `    fs.unlinkSync(path);\n    fs.symlinkSync('../outside.md', path);\n  }\n` +
      '  return result;\n};\nsyncBuiltinESMExports();\n',
  );
  const ran = spawnSync(process.execPath, ['--import', swap, checker, root], { encoding: 'utf8' });
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '# outside, no links\n');
  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stderr, /README\.md: /u);
});

// Sol's CF-11-FIX2 review, doc-links-check.mjs:60: a fence marker inside a
// closed HTML comment opened a fence that hid every link after the comment.
test('a fence marker inside a closed comment opens no fence', (t) => {
  assert.deepEqual(shown('<!--\n```\n-->\n[shown](a.md)\n'), ['4:a.md']);
  assert.deepEqual(shown('<!-- ``` -->\n[shown](a.md)\n'), ['2:a.md']);
  assert.deepEqual(shown('<!--\n[comment](c.md)\n-->\n'), ['2:c.md']);
  assert.deepEqual(shown('```\n<!--\n```\n[shown](a.md)\n'), ['4:a.md']);
  const root = scratchRepository(t);
  tracked(root, 'README.md', '<!--\n```\n-->\n\n[visible](missing.md)\n');
  const ran = check(root);
  assert.equal(ran.status, 1, ran.stdout);
  assert.match(ran.stderr, /README\.md:5: missing\.md does not resolve/u);
});

// Sol's CF-11-FIX2 review, doc-links-cases.mjs:88: nothing ran the checker
// without Git, so a gate that certified when Git could not run stayed green.
test('a run where Git cannot start is refused', (t) => {
  const root = scratchRepository(t);
  tracked(root, 'README.md', '# clean\n');
  const empty = join(root, '../no-tools');
  mkdirSync(empty);
  const ran = spawnSync(process.execPath, [checker, root], {
    encoding: 'utf8',
    env: { ...process.env, PATH: empty },
  });
  assert.notEqual(ran.status, 0, ran.stdout + ran.stderr);
  assert.doesNotMatch(ran.stdout, /every relative link resolves/u);
});
