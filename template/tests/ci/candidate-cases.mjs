// SPDX-License-Identifier: AGPL-3.0-only
// Cases for candidate export and verification: exact paths, modes, bytes and links, and every
// divergence the export refuses.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import {
  candidateFiles,
  checkCandidate,
  exportCandidate,
  indexFiles,
} from '../../scripts/candidate-snapshot.mjs';
import { scanPublicFiles } from '../../scripts/public-content-check.mjs';

const source = resolve(import.meta.dirname, '../..');

function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-candidate-'));
  const repo = join(dir, 'source');
  const candidate = join(dir, 'candidate');
  const manifest = join(dir, 'manifest.json');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  git('init', '-q');
  writeFileSync(join(repo, '.gitignore'), 'node_modules\nignored.txt\n');
  writeFileSync(join(repo, 'README.md'), 'A reusable organisational project.\n');
  git('add', '.');
  try {
    run({ dir, repo, candidate, manifest, git });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('export and verify exact staged paths, modes, bytes and internal skill link', () =>
  fixture(({ dir, repo, candidate, manifest, git }) => {
    mkdirSync(join(repo, '.claude/skills'), { recursive: true });
    mkdirSync(join(repo, '.codex'));
    writeFileSync(join(repo, '.claude/skills/SKILL.md'), 'A portable skill.\n');
    symlinkSync('../.claude/skills', join(repo, '.codex/skills'));
    writeFileSync(join(repo, 'run.sh'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(repo, 'run.sh'), 0o755);
    symlinkSync(dir, join(repo, 'node_modules'));
    git('add', '.');
    const result = exportCandidate(repo, candidate, manifest);
    assert.equal(result.kind, 'local-candidate-files');
    assert.equal(result.files.length, 5);
    assert.equal(result.files.find(({ path }) => path === 'run.sh').mode, '100755');
    assert.equal(result.files.find(({ path }) => path === '.codex/skills').mode, '120000');
    assert.equal(existsSync(join(candidate, '.git')), false);
    assert.equal(existsSync(join(candidate, 'node_modules')), false);
    checkCandidate(candidate, manifest);
    const second = exportCandidate(repo, join(dir, 'second'), join(dir, 'second.json'));
    assert.deepEqual(result, second, 'manifest identity is deterministic');
  }));

for (const [label, mutate] of [
  ['changed bytes', (path) => writeFileSync(join(path, 'README.md'), 'changed')],
  ['extra untracked file', (path) => writeFileSync(join(path, 'extra.txt'), 'extra')],
  ['extra ignored file', (path) => writeFileSync(join(path, 'ignored.txt'), 'extra')],
  ['changed mode', (path) => chmodSync(join(path, 'README.md'), 0o755)],
  ['Git history directory', (path) => mkdirSync(join(path, '.git'))],
]) {
  test(`verification rejects ${label}`, () =>
    fixture(({ repo, candidate, manifest }) => {
      exportCandidate(repo, candidate, manifest);
      mutate(candidate);
      assert.throws(() => checkCandidate(candidate, manifest));
    }));
}

test('export refuses index and worktree divergence', () =>
  fixture(({ repo, candidate, manifest }) => {
    writeFileSync(join(repo, 'README.md'), 'unstaged change');
    assert.throws(() => exportCandidate(repo, candidate, manifest), /index and worktree differ/u);
    assert.equal(existsSync(candidate), false);
  }));

test('export refuses an untracked input file', () =>
  fixture(({ repo, candidate, manifest }) => {
    writeFileSync(join(repo, 'untracked.txt'), 'untracked');
    assert.throws(() => exportCandidate(repo, candidate, manifest), /untracked/u);
  }));

test('export refuses force-staged ignored files', () =>
  fixture(({ repo, candidate, manifest, git }) => {
    writeFileSync(join(repo, 'ignored.txt'), 'ignored');
    git('add', '-f', 'ignored.txt');
    assert.throws(() => exportCandidate(repo, candidate, manifest), /ignored/u);
  }));

for (const target of ['../escape', '/tmp', 'missing']) {
  test('export refuses an escaping, absolute or dangling link', () =>
    fixture(({ repo, candidate, manifest, git }) => {
      symlinkSync(target, join(repo, 'link'));
      git('add', 'link');
      assert.throws(() => exportCandidate(repo, candidate, manifest));
    }));
}

test('export refuses symlink ancestors in the worktree', () =>
  fixture(({ dir, repo, candidate, manifest, git }) => {
    mkdirSync(join(repo, 'sub'));
    writeFileSync(join(repo, 'sub/file'), 'same');
    git('add', '.');
    mkdirSync(join(dir, 'outside'));
    writeFileSync(join(dir, 'outside/file'), 'same');
    rmSync(join(repo, 'sub'), { recursive: true });
    symlinkSync(join(dir, 'outside'), join(repo, 'sub'));
    assert.throws(() => exportCandidate(repo, candidate, manifest), /untracked|symlink ancestor/u);
  }));

test('manifest and export destinations must be external and new', () =>
  fixture(({ dir, repo, candidate, manifest }) => {
    assert.throws(() => exportCandidate(repo, join(repo, 'candidate'), manifest), /outside/u);
    assert.throws(() => exportCandidate(repo, candidate, join(repo, 'manifest.json')), /outside/u);
    mkdirSync(candidate);
    assert.throws(() => exportCandidate(repo, candidate, manifest), /new file/u);
    symlinkSync(repo, join(dir, 'alias'));
    assert.throws(
      () => exportCandidate(repo, join(dir, 'other'), join(dir, 'alias/manifest.json')),
      /outside/u,
    );
  }));

test('manifest tampering fails verification', () =>
  fixture(({ repo, candidate, manifest }) => {
    exportCandidate(repo, candidate, manifest);
    const doc = JSON.parse(readFileSync(manifest, 'utf8'));
    doc.treeSha256 = '0'.repeat(64);
    writeFileSync(manifest, JSON.stringify(doc));
    assert.throws(() => checkCandidate(candidate, manifest), /differs/u);
  }));

const prohibited = [
  ['private-pitch-url', ['https:/', '/pitch', '.example.invalid/private'].join('')],
  ['commercial-proposal', [['spon', 'sor'].join(''), 'proposal'].join(' ')],
  ['commercial-proposal', ['funding', 'round'].join(' ')],
  ['personal-path', ['/', 'Users', '/fixture-person/private'].join('')],
  ['excluded-token', ['synthetic', 'public', 'client'].join('')],
];
for (const [rule, value] of prohibited) {
  test(`public content rejects ${rule} without printing the matched value`, () => {
    const findings = scanPublicFiles([{ path: 'fixture.md', bytes: Buffer.from(value) }]);
    assert.ok(findings.some((finding) => finding.rule === rule));
    assert.ok(!JSON.stringify(findings).includes(value));
  });
}

test('a prohibited filename is withheld from findings', () => {
  const filename = ['synthetic', 'public', 'client.md'].join('');
  const findings = scanPublicFiles([{ path: filename, bytes: Buffer.from('ordinary text') }]);
  assert.deepEqual(
    findings.map(({ rule }) => rule),
    ['excluded-token'],
  );
  assert.match(findings[0].file, /^<withheld-path [0-9a-f]{8}\/\d+>$/u);
});

test('public guard accepts neutral source and licence text and rejects binary input', () => {
  assert.deepEqual(
    scanPublicFiles([
      {
        path: 'README.md',
        bytes: Buffer.from(
          'Tasks, approvals and documentation. Copyright and licence terms remain intact.',
        ),
      },
    ]),
    [],
  );
  assert.equal(
    scanPublicFiles([{ path: 'image.dat', bytes: Buffer.from([0xff]) }])[0].rule,
    'non-text-foundation-file',
  );
});

test('public guard reads staged content through its CLI', () =>
  fixture(({ repo, git }) => {
    writeFileSync(join(repo, 'README.md'), prohibited[0][1]);
    git('add', '.');
    assert.equal(scanPublicFiles(indexFiles(repo)).length, 1);
    const result = spawnSync(
      process.execPath,
      [join(source, 'scripts/public-content-check.mjs'), '--repo', repo],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /<withheld-path [0-9a-f]{8}\/\d+> \[private-pitch-url\]/u);
    assert.ok(!result.stderr.includes('README.md'));
    assert.ok(!result.stderr.includes(prohibited[0][1]));
  }));

test('receipt requires external output and rejects inherited fixture history', () =>
  fixture(({ dir, repo, git }) => {
    mkdirSync(join(repo, 'scripts'));
    // candidate-snapshot.mjs reads its main-module guard from main-module.mjs,
    // so the copy the fixture runs needs that file too: issue 19.
    for (const file of ['publication-receipt.mjs', 'candidate-snapshot.mjs', 'main-module.mjs']) {
      writeFileSync(join(repo, 'scripts', file), readFileSync(join(source, 'scripts', file)));
    }
    git('add', '.');
    const commit = () =>
      git(
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '-qm',
        'chore: disposable receipt fixture',
      );
    commit();
    writeFileSync(join(repo, 'README.md'), 'Second disposable fixture revision.');
    git('add', '.');
    commit();
    const run = (args) =>
      spawnSync(process.execPath, [join(repo, 'scripts/publication-receipt.mjs'), ...args], {
        cwd: repo,
        encoding: 'utf8',
      });
    assert.equal(run([]).status, 2);
    assert.equal(
      run(['--first-root', '--ref', 'HEAD', '--output', join(repo, 'forbidden-receipt.md')]).status,
      2,
    );
    assert.equal(existsSync(join(repo, 'forbidden-receipt.md')), false);
    const output = join(dir, 'receipt.md');
    assert.equal(run(['--first-root', '--ref', 'HEAD', '--output', output]).status, 1);
    const receipt = readFileSync(output, 'utf8');
    assert.match(receipt, /Reachable commits: 2/u);
    assert.match(receipt, /NOT RUN/u);
    assert.match(receipt, /not verified by this command/u);
    assert.doesNotMatch(receipt, /No workflow has ever run|No message has reached/u);
    assert.equal(git('status', '--porcelain').toString(), '', 'receipt does not dirty its subject');
  }));

test('only the exact inherited synthetic shape fixture has a path-shape exception', () => {
  const path = 'tests/gate/shape-canary.txt';
  const bytes = readFileSync(join(source, path));
  assert.deepEqual(scanPublicFiles([{ path, bytes }]), []);
  assert.ok(
    scanPublicFiles([{ path, bytes: Buffer.concat([bytes, Buffer.from('\nchanged')]) }]).some(
      ({ rule }) => rule === 'personal-path',
    ),
  );
  assert.ok(
    scanPublicFiles([{ path: 'copied-fixture.txt', bytes }]).some(
      ({ rule }) => rule === 'personal-path',
    ),
  );
});

test('approved shape bytes at the Code Factory root have no personal-path finding', () => {
  const bytes = readFileSync(join(source, 'tests/gate/shape-canary.txt'));
  assert.deepEqual(scanPublicFiles([{ path: 'template/tests/gate/shape-canary.txt', bytes }]), []);
});

test('one changed byte in the root shape fixture is still refused', () => {
  const bytes = readFileSync(join(source, 'tests/gate/shape-canary.txt'));
  bytes[0] ^= 1;
  assert.ok(
    scanPublicFiles([{ path: 'template/tests/gate/shape-canary.txt', bytes }]).some(
      ({ rule }) => rule === 'personal-path',
    ),
  );
});

test('approved shape bytes at other paths are still refused', () => {
  const bytes = readFileSync(join(source, 'tests/gate/shape-canary.txt'));
  for (const path of [
    'copied-fixture.txt',
    'nested/template/tests/gate/shape-canary.txt',
    'template/tests/gate/shape-canary.txt.copy',
  ]) {
    assert.ok(scanPublicFiles([{ path, bytes }]).some(({ rule }) => rule === 'personal-path'));
  }
});

test('an approved root shape fixture still refuses an excluded token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-public-shapes-'));
  try {
    mkdirSync(join(dir, 'gate'));
    for (const file of ['public-content-check.mjs', 'candidate-snapshot.mjs', 'main-module.mjs']) {
      writeFileSync(join(dir, file), readFileSync(join(source, 'scripts', file)));
    }
    // Approve synthetic bytes only in this isolated test manifest. The real
    // fixture and its approval registry remain untouched.
    const bytes = Buffer.concat([
      readFileSync(join(source, 'tests/gate/shape-canary.txt')),
      Buffer.from(['synthetic', 'public', 'client'].join('')),
    ]);
    writeFileSync(
      join(dir, 'gate/approved-exemptions.sha256'),
      `${createHash('sha256').update(bytes).digest('hex')}  tests/gate/shape-canary.txt\n`,
    );
    const checkPath = join(dir, 'public-content-check.mjs');
    const { scanPublicFiles: scan } = await import(checkPath);
    assert.deepEqual(
      scan([{ path: 'template/tests/gate/shape-canary.txt', bytes }]).map(({ rule }) => rule),
      ['excluded-token'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI validation errors do not expose malformed manifest contents or private paths', () =>
  fixture(({ dir, repo, candidate, manifest }) => {
    exportCandidate(repo, candidate, manifest);
    const withheld = 'SYNTHETIC_WITHHELD_VALUE';
    writeFileSync(manifest, withheld);
    for (const script of ['candidate-snapshot.mjs', 'public-content-check.mjs']) {
      const args = script.startsWith('candidate') ? ['check'] : [];
      const result = spawnSync(
        process.execPath,
        [
          join(source, 'scripts', script),
          ...args,
          '--candidate',
          candidate,
          '--manifest',
          manifest,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
      assert.ok(!result.stderr.includes(withheld));
      assert.ok(!result.stderr.includes(dir));
    }
    const result = spawnSync(
      process.execPath,
      [join(source, 'scripts/public-content-check.mjs'), '--repo', candidate],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes(dir));
  }));

test('receipt refuses an annotated tag or a missing ref with one fixed line, before scans or a receipt', () =>
  fixture(({ dir, repo, git }) => {
    mkdirSync(join(repo, 'scripts'));
    // candidate-snapshot.mjs reads its main-module guard from main-module.mjs,
    // so the copy the fixture runs needs that file too: issue 19.
    for (const file of ['publication-receipt.mjs', 'candidate-snapshot.mjs', 'main-module.mjs']) {
      writeFileSync(join(repo, 'scripts', file), readFileSync(join(source, 'scripts', file)));
    }
    git('add', '.');
    git(
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'chore: disposable tag receipt fixture',
    );
    git(
      '-c',
      'tag.gpgsign=false',
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'tag',
      '-am',
      'Synthetic annotated metadata',
      'annotated',
    );
    const output = join(dir, 'tag-receipt.md');
    const result = spawnSync(
      process.execPath,
      [
        join(repo, 'scripts/publication-receipt.mjs'),
        '--first-root',
        '--ref',
        'annotated',
        '--output',
        output,
      ],
      { cwd: repo, encoding: 'utf8' },
    );
    assert.equal(result.status, 2);
    assert.equal(
      result.stderr,
      'publication-receipt: first root: receipt requires a commit object; annotated tag publication is not supported\n',
    );
    assert.equal(existsSync(output), false);
    // CF-08-F3: a caught failure prints one fixed line, never what the error or the
    // repository said.
    const marker = 'synthetic-unknown-ref-marker';
    const missing = spawnSync(
      process.execPath,
      [
        join(repo, 'scripts/publication-receipt.mjs'),
        '--first-root',
        '--ref',
        marker,
        '--output',
        output,
      ],
      { cwd: repo, encoding: 'utf8' },
    );
    assert.equal(missing.status, 2);
    assert.equal(
      missing.stderr,
      'publication-receipt: first root: a file or Git operation failed\n',
    );
    assert.ok(!missing.stderr.includes(marker));
    assert.equal(existsSync(output), false);
  }));

// Sol CF-05, 3 October.
test('an empty candidate with an empty manifest is refused by both checks', () =>
  fixture(({ candidate, manifest }) => {
    mkdirSync(candidate);
    writeFileSync(
      manifest,
      JSON.stringify({
        schema: 1,
        kind: 'local-candidate-files',
        evidence:
          'File paths, modes and bytes only. No commit, signature, hosted check or publication approval is certified.',
        treeSha256: createHash('sha256').update('[]\n').digest('hex'),
        files: [],
      }),
    );
    assert.throws(() => checkCandidate(candidate, manifest), /no files/u);
    const publicCheck = spawnSync(
      process.execPath,
      [
        join(source, 'scripts/public-content-check.mjs'),
        '--candidate',
        candidate,
        '--manifest',
        manifest,
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(publicCheck.status, 0);
  }));

// Swap `file` at the moment it is opened for reading, the latest moment a racer
// can act, then run `check`. `swap` does the swapping and may return a function
// that undoes it once the open has happened. The open is readFileSync's or
// openSync's, whichever the code under test uses.
function swappedOnRead(file, swap, check) {
  const originals = { readFileSync: fs.readFileSync, openSync: fs.openSync };
  let swapped = false;
  for (const name of Object.keys(originals)) {
    fs[name] = function (path, ...args) {
      if (path !== file || swapped) return originals[name].call(this, path, ...args);
      swapped = true;
      const undo = swap();
      try {
        return originals[name].call(this, path, ...args);
      } finally {
        undo?.();
      }
    };
  }
  syncBuiltinESMExports();
  try {
    check();
  } finally {
    Object.assign(fs, originals);
    syncBuiltinESMExports();
  }
  return swapped;
}

test('a file swapped for an outside link after it was examined is refused', () =>
  fixture(({ dir, candidate }) => {
    mkdirSync(candidate);
    const file = join(fs.realpathSync(candidate), 'seed.txt');
    writeFileSync(file, 'ordinary internal bytes');
    const foreign = join(dir, 'foreign.txt');
    writeFileSync(foreign, 'SYNTHETIC_FOREIGN_BYTES');
    assert.equal(
      swappedOnRead(
        file,
        () => {
          fs.unlinkSync(file);
          fs.symlinkSync(foreign, file);
        },
        () => assert.throws(() => candidateFiles(candidate)),
      ),
      true,
    );
  }));

// Sol CF-05-FIX1: another regular file opened in its place, and the original put
// back before anything looks at the path again.
test('a file replaced while it is opened and restored after is refused', () =>
  fixture(({ dir, candidate }) => {
    mkdirSync(candidate);
    const file = join(fs.realpathSync(candidate), 'seed.txt');
    writeFileSync(file, 'ordinary internal bytes');
    const held = join(dir, 'held.txt');
    const foreign = join(dir, 'foreign.txt');
    writeFileSync(foreign, 'SYNTHETIC_FOREIGN_BYTES');
    assert.equal(
      swappedOnRead(
        file,
        () => {
          fs.renameSync(file, held);
          fs.copyFileSync(foreign, file);
          return () => {
            fs.unlinkSync(file);
            fs.renameSync(held, file);
          };
        },
        () => assert.throws(() => candidateFiles(candidate)),
      ),
      true,
    );
  }));

// Sol CF-05-FIX2: a directory swapped for a link to an outside one while it is
// listed, left there or put back once its file is opened. O_NOFOLLOW guards the
// last name in a path, not the directories above it.
for (const putBack of [false, true]) {
  const shape = putBack ? ', and put back after the read,' : '';
  test(`a directory swapped for an outside link while it is listed${shape} is refused`, () =>
    fixture(({ dir, candidate }) => {
      mkdirSync(join(candidate, 'sub'), { recursive: true });
      const child = join(fs.realpathSync(candidate), 'sub');
      const [held, foreign] = [join(dir, 'held'), join(dir, 'foreign')];
      writeFileSync(join(child, 'seed.txt'), 'ordinary internal bytes');
      mkdirSync(foreign);
      writeFileSync(join(foreign, 'seed.txt'), 'SYNTHETIC_FOREIGN_BYTES');
      const originals = { readdirSync: fs.readdirSync, openSync: fs.openSync };
      let swapped = false;
      // The listing of `sub`, whichever name the walk lists it by.
      fs.readdirSync = function (path, ...args) {
        if (process.cwd() === child && !swapped) {
          swapped = true;
          fs.renameSync(child, held);
          fs.symlinkSync(foreign, child);
        }
        return originals.readdirSync.call(this, path, ...args);
      };
      fs.openSync = function (path, ...args) {
        try {
          return originals.openSync.call(this, path, ...args);
        } finally {
          if (putBack && swapped && path === join(child, 'seed.txt')) {
            fs.unlinkSync(child);
            fs.renameSync(held, child);
          }
        }
      };
      syncBuiltinESMExports();
      try {
        assert.throws(() => candidateFiles(candidate), /changed while it was read/u);
      } finally {
        Object.assign(fs, originals);
        syncBuiltinESMExports();
      }
      assert.equal(swapped, true);
    }));
}

// Sol CF-05-FIX3: the directory swapped only while it is listed and put back
// before anything in it is read. The files the walk returns are the directory's.
test('a directory swapped while it is listed and put back before its files are read loses no file', () =>
  fixture(({ dir, candidate }) => {
    mkdirSync(join(candidate, 'sub'), { recursive: true });
    const child = join(fs.realpathSync(candidate), 'sub');
    const [held, foreign] = [join(dir, 'held'), join(dir, 'foreign')];
    writeFileSync(join(child, 'seed.txt'), 'ordinary internal bytes');
    writeFileSync(join(child, 'private.txt'), 'SYNTHETIC_PRIVATE_BYTES');
    mkdirSync(foreign);
    writeFileSync(join(foreign, 'seed.txt'), 'outside listing only');
    const original = fs.readdirSync;
    let swapped = false;
    fs.readdirSync = function (path, ...args) {
      if (process.cwd() !== child || swapped) return original.call(this, path, ...args);
      swapped = true;
      fs.renameSync(child, held);
      fs.symlinkSync(foreign, child);
      try {
        return original.call(this, path, ...args);
      } finally {
        fs.unlinkSync(child);
        fs.renameSync(held, child);
      }
    };
    syncBuiltinESMExports();
    try {
      assert.deepEqual(
        candidateFiles(candidate).map(({ path }) => path),
        ['sub/private.txt', 'sub/seed.txt'],
      );
    } finally {
      fs.readdirSync = original;
      syncBuiltinESMExports();
    }
    assert.equal(swapped, true);
  }));

// Sol CF-07, 3 October. The receipt runs its real logic over stub checks, so each case
// decides every child's outcome and sees what each child was given.
const CREDENTIALS = ['GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN'];
const RECEIPT_CHECKS = {
  'sweep-self-test': 'Contamination scanner self-test',
  'sweep-range': 'Contamination scan of all proposed history',
  'commit-range': 'Root commit subject and provenance declarations',
  'public-content':
    'Public foundation content policy on every proposed commit, metadata and blob/path',
  gitleaks: 'Secret scan of the proposed history',
};

function receiptFixture({ signed = true } = {}, run) {
  fixture(({ dir, repo, git }) => {
    const control = join(dir, 'control');
    mkdirSync(join(control, 'bin'), { recursive: true });
    mkdirSync(join(repo, 'scripts/gate'), { recursive: true });
    for (const file of ['publication-receipt.mjs', 'candidate-snapshot.mjs', 'main-module.mjs']) {
      writeFileSync(join(repo, 'scripts', file), readFileSync(join(source, 'scripts', file)));
    }
    const at = JSON.stringify(control);
    // A check fails with the exit code written in its fail file.
    const nodeStub = (name) =>
      `import { existsSync, readFileSync, writeFileSync } from 'node:fs';\nconst c = ${at};\n` +
      `writeFileSync(c + '/ran-${name}', '');\n` +
      `if (${CREDENTIALS.map((v) => `process.env.${v}`).join(' || ')}) writeFileSync(c + '/seen-${name}', '');\n` +
      `process.exit(existsSync(c + '/fail-${name}') ? Number(readFileSync(c + '/fail-${name}', 'utf8')) : 0);\n`;
    writeFileSync(join(repo, 'scripts/commit-range-check.mjs'), nodeStub('commit-range'));
    writeFileSync(join(repo, 'scripts/public-content-check.mjs'), nodeStub('public-content'));
    writeFileSync(
      join(repo, 'scripts/gate/sweep.py'),
      `import hashlib, os, sys\nc = ${at}\nname = 'sweep-self-test' if '--self-test' in sys.argv else 'sweep-range'\n` +
        `open(os.path.join(c, 'ran-' + name), 'w').close()\n` +
        `if any(os.environ.get(v) for v in ${JSON.stringify(CREDENTIALS)}): open(os.path.join(c, 'seen-' + name), 'w').close()\n` +
        `f = os.path.join(c, 'fail-' + name)\nsys.exit(int(open(f).read()) if os.path.exists(f) else 0)\n`,
    );
    const gitleaks = join(control, 'bin/gitleaks');
    writeFileSync(
      gitleaks,
      `#!/bin/sh\nc=${at}\n: > "$c/ran-gitleaks"\n[ -n "${CREDENTIALS.map((v) => `\${${v}:-}`).join('')}" ] && : > "$c/seen-gitleaks"\n` +
        `[ -f "$c/after.sh" ] && sh "$c/after.sh"\n[ -f "$c/fail-gitleaks" ] && exit "$(cat "$c/fail-gitleaks")"\nexit 0\n`,
    );
    chmodSync(gitleaks, 0o755);
    const key = join(dir, 'signing-key');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { stdio: 'pipe' });
    writeFileSync(join(dir, 'signers'), `fixture@example.invalid ${readFileSync(`${key}.pub`)}`);
    for (const [name, value] of [
      ['user.name', 'Fixture'],
      ['user.email', 'fixture@example.invalid'],
      ['core.hooksPath', '/dev/null'],
      ['gpg.format', 'ssh'],
      ['user.signingkey', key],
      ['gpg.ssh.allowedSignersFile', join(dir, 'signers')],
      ['commit.gpgsign', String(signed)],
    ])
      git('config', name, value);
    git('add', '.');
    git('commit', '-qm', 'chore: disposable receipt fixture');
    const sha = git('rev-parse', 'HEAD').toString().trim();
    const receipt = (output, { ref = sha, env = {}, cwd = repo } = {}) => {
      const result = spawnSync(
        process.execPath,
        [
          join(cwd, 'scripts/publication-receipt.mjs'),
          '--first-root',
          '--ref',
          ref,
          '--output',
          output,
        ],
        {
          cwd,
          encoding: 'utf8',
          env: { ...process.env, PATH: `${join(control, 'bin')}:${process.env.PATH}`, ...env },
        },
      );
      return {
        status: result.status,
        stderr: result.stderr,
        text: existsSync(output) ? readFileSync(output, 'utf8') : '',
      };
    };
    run({ dir, repo, git, control, sha, receipt });
  });
}

// Sol CF-07-FIX4 finding 6: a check that finds something exits 1, and one that cannot run at
// all exits otherwise (127, command not found). Neither is a pass.
test('receipt passes a signed root only when every check passes, and fails each one that does not', () => {
  receiptFixture({}, ({ dir, control, receipt }) => {
    const passed = receipt(join(dir, 'pass.md'));
    assert.equal(passed.status, 0, passed.text);
    assert.match(passed.text, /Local result: PASS/u);
    for (const [name, label] of Object.entries(RECEIPT_CHECKS)) {
      for (const code of ['1', '127']) {
        writeFileSync(join(control, `fail-${name}`), code);
        const failed = receipt(join(dir, `fail-${name}-${code}.md`));
        rmSync(join(control, `fail-${name}`));
        assert.equal(failed.status, 1, `${name} exit ${code}`);
        assert.ok(failed.text.includes(`- FAIL: ${label}.`), `${name} exit ${code}`);
      }
    }
  });
  receiptFixture({ signed: false }, ({ dir, receipt }) => {
    const unsigned = receipt(join(dir, 'unsigned.md'));
    assert.equal(unsigned.status, 1);
    assert.match(unsigned.text, /- FAIL: Commit signature verifies locally/u);
  });
});

test('receipt counts history past replace refs and refuses a shallow clone', () =>
  receiptFixture({}, ({ dir, repo, git, sha, receipt }) => {
    git('commit', '--allow-empty', '-qm', 'chore: second disposable revision');
    const head = git('rev-parse', 'HEAD').toString().trim();
    git('replace', head, sha);
    const replaced = receipt(join(dir, 'replaced.md'), { ref: head });
    assert.equal(replaced.status, 1);
    assert.match(replaced.text, /Reachable commits: 2\./u);
    assert.match(replaced.text, /- FAIL: Proposed history is exactly one new root commit/u);
    const shallow = join(dir, 'shallow');
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${repo}`, shallow], {
      stdio: 'pipe',
    });
    const cut = receipt(join(dir, 'shallow.md'), { ref: 'HEAD', cwd: shallow });
    assert.equal(cut.status, 1);
    assert.match(cut.text, /- FAIL: Proposed history is exactly one new root commit/u);
  }));

test('receipt rechecks the checkout after its checks have run', () =>
  receiptFixture({}, ({ dir, repo, control, receipt }) => {
    writeFileSync(
      join(control, 'after.sh'),
      `printf 'late write\\n' >> ${JSON.stringify(join(repo, 'README.md'))}\n`,
    );
    const raced = receipt(join(dir, 'raced.md'));
    assert.equal(raced.status, 1, raced.text);
    assert.match(
      raced.text,
      /- FAIL: Checkout is still clean and at the proposed commit after the checks/u,
    );
  }));

test('receipt writes only where it was told, even when the output folder is swapped mid-run', () =>
  receiptFixture({}, ({ dir, repo, control, receipt }) => {
    const out = join(dir, 'out');
    mkdirSync(out);
    writeFileSync(
      join(control, 'after.sh'),
      `mv '${out}' '${out}.old' && ln -s '${repo}' '${out}'\n`,
    );
    receipt(join(out, 'receipt.md'));
    assert.equal(existsSync(join(repo, 'receipt.md')), false, 'never inside the subject');
    assert.match(readFileSync(join(`${out}.old`, 'receipt.md'), 'utf8'), /Local result: PASS/u);
  }));

test('receipt checks never receive a GitHub or registry credential', () =>
  receiptFixture({}, ({ dir, control, receipt }) => {
    // Sol CF-07 round four: the receipt's own Git queries are watched too.
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    writeFileSync(
      join(control, 'bin/git'),
      `#!/bin/sh\n: > '${control}/ran-git'\n[ -n "${CREDENTIALS.map((v) => `\${${v}:-}`).join('')}" ] && : > '${control}/seen-git'\nexec '${realGit}' "$@"\n`,
    );
    chmodSync(join(control, 'bin/git'), 0o755);
    const env = Object.fromEntries(CREDENTIALS.map((name) => [name, 'synthetic-unused']));
    assert.equal(receipt(join(dir, 'credential.md'), { env }).status, 0);
    for (const name of [...Object.keys(RECEIPT_CHECKS), 'git']) {
      assert.ok(existsSync(join(control, `ran-${name}`)), name);
      assert.equal(existsSync(join(control, `seen-${name}`)), false, name);
    }
  }));

// A preload that runs `action` once, just before the receipt's own fs[method] call whose
// argument at `index` contains `match`; with `afterPass`, only once a PASS receipt is written.
// It changes filesystem timing, never the receipt's logic.
function preload(dir, method, index, match, action, { afterPass = false } = {}) {
  const file = join(dir, `${method}-hook.mjs`);
  writeFileSync(
    file,
    `import fs from 'node:fs';\nimport { syncBuiltinESMExports } from 'node:module';\n` +
      `const real = fs.${method};\nlet done = false;\nlet written = ${!afterPass};\n` +
      (afterPass
        ? `const write = fs.writeFileSync;\nfs.writeFileSync = function (...args) {\n` +
          `  if (String(args[1]).includes('Local result: PASS')) written = true;\n` +
          `  return write.apply(this, args);\n};\n`
        : '') +
      `fs.${method} = function (...args) {\n` +
      `  if (written && !done && String(args[${index}]).includes(${JSON.stringify(match)})) {\n` +
      `    done = true;\n    ${action}\n  }\n  return real.apply(this, args);\n};\n` +
      `syncBuiltinESMExports();\n`,
  );
  return { NODE_OPTIONS: `--import=${file}` };
}

test('receipt output stays outside its subject when the folder is swapped at the open itself', () =>
  receiptFixture({}, ({ dir, repo, receipt }) => {
    const out = join(dir, 'out');
    mkdirSync(out);
    const env = preload(
      dir,
      'openSync',
      0,
      'receipt.md',
      `fs.renameSync(${JSON.stringify(out)}, ${JSON.stringify(`${out}.old`)});\n` +
        `fs.symlinkSync(${JSON.stringify(repo)}, ${JSON.stringify(out)});`,
    );
    receipt(join(out, 'receipt.md'), { env });
    assert.ok(existsSync(`${out}.old`), 'the swap happened');
    assert.equal(existsSync(join(repo, 'receipt.md')), false, 'never inside the subject');
  }));

// Sol CF-07 round three: two races only a check after the act can close.
test('receipt refuses an output folder moved into its subject at the open', () =>
  receiptFixture({}, ({ dir, repo, receipt }) => {
    const out = join(dir, 'out');
    const moved = join(repo, '.git', 'moved-output');
    mkdirSync(out);
    const env = preload(
      dir,
      'openSync',
      0,
      'receipt.md',
      `fs.renameSync(${JSON.stringify(out)}, ${JSON.stringify(moved)});`,
    );
    const result = receipt(join(out, 'receipt.md'), { env });
    assert.ok(existsSync(moved), 'the folder was moved at the open');
    assert.equal(existsSync(join(moved, 'receipt.md')), false, 'never left inside the subject');
    assert.notEqual(result.status, 0, 'a receipt opened inside its subject is refused');
  }));

// Sol CF-07 round four: a preload that runs `action` once, just before the receipt's first Git
// status query after it wrote a PASS. It changes timing only; the query itself still runs.
function atFinalStatus(dir, action) {
  const file = join(dir, 'final-status-hook.mjs');
  writeFileSync(
    file,
    `import fs from 'node:fs';\nimport child from 'node:child_process';\n` +
      `import { syncBuiltinESMExports } from 'node:module';\n` +
      `const write = fs.writeFileSync;\nconst exec = child.execFileSync;\nlet written = false;\nlet done = false;\n` +
      `fs.writeFileSync = function (...args) {\n` +
      `  if (String(args[1]).includes('Local result: PASS')) written = true;\n` +
      `  return write.apply(this, args);\n};\n` +
      `child.execFileSync = function (command, args, ...rest) {\n` +
      `  if (written && !done && command === 'git' && args[0] === 'status') {\n` +
      `    done = true;\n    ${action}\n  }\n  return exec.call(this, command, args, ...rest);\n};\n` +
      `syncBuiltinESMExports();\n`,
  );
  return { NODE_OPTIONS: `--import=${file}` };
}

test('receipt refuses another clean head checked out during its final status query', () =>
  receiptFixture({}, ({ dir, repo, git, sha, receipt }) => {
    git('commit', '--allow-empty', '-qm', 'chore: second disposable revision');
    const other = git('rev-parse', 'HEAD').toString().trim();
    git('checkout', '-q', '--detach', sha);
    const env = atFinalStatus(
      dir,
      `exec('git', ['-C', ${JSON.stringify(repo)}, 'checkout', '-q', '--detach', ${JSON.stringify(other)}], { stdio: 'pipe' });`,
    );
    const raced = receipt(join(dir, 'raced.md'), { env });
    assert.equal(git('rev-parse', 'HEAD').toString().trim(), other, 'the head moved');
    assert.equal(git('status', '--porcelain').toString(), '', 'the other checkout is clean');
    assert.notEqual(raced.status, 0, 'a different clean head is not certified');
    assert.doesNotMatch(raced.text, /Local result: PASS/u);
  }));

test('receipt refuses an output folder moved into its subject during its final status query', () =>
  receiptFixture({}, ({ dir, repo, receipt }) => {
    const out = join(dir, 'out');
    const moved = join(repo, '.git', 'late-output');
    mkdirSync(out);
    const env = atFinalStatus(
      dir,
      `fs.renameSync(${JSON.stringify(out)}, ${JSON.stringify(moved)});`,
    );
    const result = receipt(join(out, 'receipt.md'), { env });
    assert.ok(existsSync(moved), 'the folder was moved during the final query');
    assert.equal(existsSync(join(moved, 'receipt.md')), false, 'never left inside the subject');
    assert.notEqual(result.status, 0, 'containment lost before the last check is refused');
  }));

test('receipt counts history past a graft file and refuses one that hides nothing', () =>
  receiptFixture({}, ({ dir, repo, git, sha, receipt }) => {
    const grafts = join(repo, '.git/info/grafts');
    writeFileSync(grafts, `${sha}\n`);
    const harmless = receipt(join(dir, 'harmless.md'));
    assert.equal(harmless.status, 1, 'a graft file is refused even when it hides nothing');
    assert.match(harmless.text, /- FAIL: Proposed history is exactly one new root commit/u);
    git('commit', '--allow-empty', '-qm', 'chore: second disposable revision');
    const head = git('rev-parse', 'HEAD').toString().trim();
    writeFileSync(grafts, `${head}\n`);
    const grafted = receipt(join(dir, 'grafted.md'), { ref: head });
    assert.equal(grafted.status, 1);
    assert.match(grafted.text, /Reachable commits: 2\./u, 'the graft hides no parent');
    assert.match(grafted.text, /- FAIL: Proposed history is exactly one new root commit/u);
  }));

test('receipt refuses a checkout dirtied between its last check and its write', () =>
  receiptFixture({}, ({ dir, repo, receipt }) => {
    const readme = join(repo, 'README.md');
    const env = preload(
      dir,
      'writeFileSync',
      1,
      'Local result: PASS',
      `fs.appendFileSync(${JSON.stringify(readme)}, 'late write\\n');`,
    );
    const raced = receipt(join(dir, 'raced.md'), { env });
    assert.match(readFileSync(readme, 'utf8'), /late write/u, 'the checkout was dirtied');
    assert.notEqual(raced.status, 0, 'a checkout dirtied before the write is refused');
    assert.doesNotMatch(raced.text, /Local result: PASS/u);
  }));

// Sol CF-07-FIX4 finding 3: the folder is moved into the subject, and a link left where it was,
// inside the final containment check, after the receipt's path was looked up but before the
// receipt was found at it. The lookup that decides must come after every other read.
test('receipt refuses an output folder moved into its subject inside its final containment check', () =>
  receiptFixture({}, ({ dir, repo, receipt }) => {
    const out = join(dir, 'out');
    const moved = join(repo, '.git', 'during-containment');
    mkdirSync(out);
    const env = preload(
      dir,
      'lstatSync',
      0,
      '/receipt.md',
      `fs.renameSync(${JSON.stringify(out)}, ${JSON.stringify(moved)});\n` +
        `fs.symlinkSync(${JSON.stringify(moved)}, ${JSON.stringify(out)});`,
      { afterPass: true },
    );
    const result = receipt(join(out, 'receipt.md'), { env });
    assert.ok(existsSync(moved), 'the folder was moved during the final containment check');
    assert.equal(existsSync(join(moved, 'receipt.md')), false, 'never left inside the subject');
    assert.notEqual(result.status, 0, 'containment lost inside the last check is refused');
  }));

// Sol CF-07-FIX4 finding 4: an index flag tells Git not to look at a file's working bytes, so
// every status query reports a clean checkout while the bytes differ from the commit.
test('receipt refuses a dirty checkout hidden by an index flag', () =>
  receiptFixture({}, ({ dir, repo, git, receipt }) => {
    for (const flag of ['--assume-unchanged', '--skip-worktree']) {
      git('update-index', flag, 'README.md');
      writeFileSync(join(repo, 'README.md'), `Uncommitted under ${flag}.\n`);
      assert.equal(git('status', '--porcelain').toString(), '', `status omits the ${flag} edit`);
      const hidden = receipt(join(dir, `hidden${flag}.md`));
      git('update-index', flag.replace('--', '--no-'), 'README.md');
      git('checkout', '--', 'README.md');
      assert.equal(hidden.status, 1, flag);
      assert.match(
        hidden.text,
        /- FAIL: Checkout has no uncommitted or nonignored untracked files/u,
        flag,
      );
    }
  }));

// Security review of 15ad8c8, finding 1: local settings decide what Git compares. With
// core.checkStat=minimal and core.trustctime=false a same-size edit with its time put back is
// not looked at, and a clean filter hands Git the committed bytes in place of the working ones.
// The checks the receipt runs are read from those working bytes.
test('receipt refuses a scanner edited where local Git settings hide the edit', () =>
  receiptFixture({}, ({ dir, repo, git, control, receipt }) => {
    writeFileSync(join(control, 'fail-sweep-range'), '1');
    const sweep = join(repo, 'scripts/gate/sweep.py');
    const committed = readFileSync(sweep);
    writeFileSync(join(dir, 'committed.py'), committed);
    const neutered = Buffer.from('import sys\nsys.exit(0)\n'.padEnd(committed.length, '#'));
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(sweep, old, old);
    git('update-index', '--refresh');
    git('config', 'core.checkStat', 'minimal');
    git('config', 'core.trustctime', 'false');
    for (const hider of ['stat', 'filter']) {
      if (hider === 'filter') {
        writeFileSync(join(repo, '.git/info/attributes'), 'scripts/gate/sweep.py filter=hide\n');
        git('config', 'filter.hide.clean', `cat '${join(dir, 'committed.py')}'`);
      }
      writeFileSync(sweep, neutered);
      fs.utimesSync(sweep, old, old);
      assert.equal(git('status', '--porcelain').toString(), '', `status omits the ${hider} edit`);
      const hidden = receipt(join(dir, `hidden-${hider}.md`));
      assert.equal(hidden.status, 1, hider);
      assert.match(
        hidden.text,
        /- FAIL: Checkout has no uncommitted or nonignored untracked files/u,
        hider,
      );
    }
  }));

// Security review of 15ad8c8, finding 2: Python puts the script's own folder first on its
// module path, so an ignored file beside the scanner stands in for a module the scanner imports.
test('receipt runs the scanner without a module planted beside it', () =>
  receiptFixture({}, ({ dir, repo, control, receipt }) => {
    writeFileSync(join(control, 'fail-sweep-range'), '1');
    writeFileSync(join(repo, 'scripts/gate/hashlib.py'), 'import sys\nsys.exit(0)\n');
    writeFileSync(join(repo, '.git/info/exclude'), 'scripts/gate/hashlib.py\n__pycache__/\n');
    const planted = receipt(join(dir, 'planted.md'));
    assert.equal(planted.status, 1, planted.text);
    assert.ok(planted.text.includes(`- FAIL: ${RECEIPT_CHECKS['sweep-range']}.`), planted.text);
  }));

// Sol PRV-cf-85-R1, criterion 4. An edit made during the final query, after the byte sweep,
// under an index flag. The flag hides it from any status that reads the index.
test('receipt refuses a checkout edit made during its final query under an index flag', () =>
  receiptFixture({}, ({ dir, repo, git, receipt }) => {
    git('update-index', '--assume-unchanged', 'README.md');
    const env = atFinalStatus(
      dir,
      `fs.appendFileSync(${JSON.stringify(join(repo, 'README.md'))}, 'Late uncommitted edit.\\n');`,
    );
    const result = receipt(join(dir, 'receipt.md'), { env });
    assert.match(readFileSync(join(repo, 'README.md'), 'utf8'), /Late uncommitted edit/u);
    assert.equal(git('status', '--porcelain').toString(), '', 'the flag conceals the edit');
    assert.notEqual(result.status, 0, 'a PASS receipt was left over a dirty checkout');
    assert.doesNotMatch(result.text, /Local result: PASS/u);
  }));

// Sol PRV-cf-85-R1, criterion 4. The scanner is swapped only while it runs and put back
// before the later checks. The receipt has to run the bytes it checked.
test('receipt runs the scanner bytes it checked, not ones swapped in while it runs', () =>
  receiptFixture({}, ({ dir, repo, control, receipt }) => {
    writeFileSync(join(control, 'fail-sweep-range'), '1');
    assert.equal(receipt(join(dir, 'baseline.md')).status, 1, 'the committed scanner refuses');
    const hook = join(dir, 'scanner-swap.mjs');
    const sweep = join(repo, 'scripts/gate/sweep.py');
    writeFileSync(
      hook,
      `import fs from 'node:fs';\nimport child from 'node:child_process';\n` +
        `import { syncBuiltinESMExports } from 'node:module';\nconst run = child.spawnSync;\n` +
        `child.spawnSync = function (command, args, ...rest) {\n` +
        `  if (command === 'python3' && args.includes('--range')) {\n` +
        `    const path = ${JSON.stringify(sweep)};\n    const original = fs.readFileSync(path);\n` +
        `    fs.writeFileSync(path, 'import sys\\nsys.exit(0)\\n');\n` +
        `    try { return run.call(this, command, args, ...rest); } finally { fs.writeFileSync(path, original); }\n` +
        `  }\n  return run.call(this, command, args, ...rest);\n};\nsyncBuiltinESMExports();\n`,
    );
    const swapped = receipt(join(dir, 'swapped.md'), { env: { NODE_OPTIONS: `--import=${hook}` } });
    assert.notEqual(swapped.status, 0, 'a scanner swapped in only while it ran was certified');
    assert.doesNotMatch(swapped.text, /Local result: PASS/u);
  }));

// Security review of 8c2311c, finding 1 (Sol PRV-cf-85 R1 :175, the same class): the checks run
// from a private copy, and a swap made there, by a hook in the receipt or by a separate process
// polling for the copy, is a scanner that was never checked. Neither swap is put back.
test('receipt refuses a scanner swapped in the private copy its checks run from', () =>
  receiptFixture({}, ({ dir, control, receipt }) => {
    writeFileSync(join(control, 'fail-sweep-range'), '1');
    const marker = join(control, 'neutered');
    const neutered = join(dir, 'neutered.py');
    writeFileSync(
      neutered,
      `import sys\nopen(${JSON.stringify(marker)}, 'w').close()\nsys.exit(0)\n`,
    );
    const hook = join(dir, 'copy-swap.mjs');
    writeFileSync(
      hook,
      `import fs from 'node:fs';\nimport path from 'node:path';\nimport child from 'node:child_process';\n` +
        `import { syncBuiltinESMExports } from 'node:module';\nconst run = child.spawnSync;\n` +
        `child.spawnSync = function (command, args, opts, ...rest) {\n` +
        `  if (command === 'python3' && args.includes('--range')) {\n` +
        `    const copy = path.join(opts.cwd, 'scripts/gate/sweep.py');\n` +
        `    fs.rmSync(copy);\n    fs.copyFileSync(${JSON.stringify(neutered)}, copy);\n  }\n` +
        `  return run.call(this, command, args, opts, ...rest);\n};\nsyncBuiltinESMExports();\n`,
    );
    const hooked = receipt(join(dir, 'hooked.md'), { env: { NODE_OPTIONS: `--import=${hook}` } });
    assert.ok(existsSync(marker), 'the hook swapped the copy before the scan');
    assert.notEqual(hooked.status, 0, 'a scanner swapped in the copy was certified');
    assert.doesNotMatch(hooked.text, /Local result: PASS/u);
    rmSync(marker);
    const temp = join(dir, 'tmp');
    mkdirSync(temp);
    const writer = spawn(
      '/bin/sh',
      [
        '-c',
        'while :; do for f in "$1"/receipt-tree-*/scripts/gate/sweep.py; do\n' +
          '  if [ -f "$f" ]; then cp "$2" "$f.new" && mv -f "$f.new" "$f"; exit 0; fi\ndone; done',
        'writer',
        temp,
        neutered,
      ],
      { stdio: 'ignore' },
    );
    const raced = receipt(join(dir, 'raced.md'), { env: { TMPDIR: temp } });
    writer.kill('SIGKILL');
    assert.ok(existsSync(marker), 'the writer swapped the copy before the scan');
    assert.notEqual(
      raced.status,
      0,
      'a scanner swapped in the copy by another process was certified',
    );
    assert.doesNotMatch(raced.text, /Local result: PASS/u);
  }));

// Security review of 8c2311c, finding 4: Git writes a file marked eol=crlf with CRLF line endings
// on checkout, so its working bytes differ from the commit while status is clean. The refusal
// gives that reason, not an uncommitted edit that was never made.
test('receipt refuses line-ending conversion for that reason, not as an uncommitted edit', () =>
  receiptFixture({}, ({ dir, repo, git, receipt }) => {
    writeFileSync(join(repo, '.gitattributes'), 'notes.txt text eol=crlf\n');
    writeFileSync(join(repo, 'notes.txt'), 'One line.\nAnother line.\n');
    git('add', '.');
    git('commit', '--amend', '-qm', 'chore: disposable receipt fixture');
    rmSync(join(repo, 'notes.txt'));
    git('checkout', '--', 'notes.txt');
    assert.match(readFileSync(join(repo, 'notes.txt'), 'utf8'), /\r\n/u, 'checked out as CRLF');
    assert.equal(git('status', '--porcelain').toString(), '', 'Git reports a clean checkout');
    const converted = receipt(join(dir, 'converted.md'), { ref: 'HEAD' });
    assert.notEqual(converted.status, 0);
    assert.doesNotMatch(converted.text, /Local result: PASS/u);
    assert.doesNotMatch(converted.text, /uncommitted/u, 'no edit was made');
    assert.match(converted.stderr, /line-ending conversion/u);
  }));
