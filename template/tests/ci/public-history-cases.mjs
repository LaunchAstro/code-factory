// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the outgoing-history policy: removed content, commit messages and author metadata stay
// rejected behind a clean tip.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { exportCandidate } from '../../scripts/candidate-snapshot.mjs';

const source = resolve(import.meta.dirname, '../..');
const guard = join(source, 'scripts/public-content-check.mjs');
const prohibited = ['synthetic', 'public', 'client'].join('');
const zero = '0'.repeat(40);

function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-public-history-'));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  const commit = (message = 'chore: disposable fixture') => {
    git('add', '-A');
    git('commit', '--allow-empty', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  writeFileSync(join(repo, 'README.md'), 'A neutral public foundation.\n');
  const root = commit();
  const scan = (...args) =>
    spawnSync(process.execPath, [guard, '--repo', repo, ...args], { encoding: 'utf8' });
  try {
    run({ dir, repo, git, commit, root, scan });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a clean selected history passes and a single ref includes its root', () =>
  fixture(({ root, scan }) => {
    const result = scan('--range', root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 commit/u);
  }));

test('removed prohibited contents remain rejected by history when the staged tree is clean', () =>
  fixture(({ repo, root, commit, scan }) => {
    writeFileSync(join(repo, 'temporary.md'), prohibited);
    commit();
    rmSync(join(repo, 'temporary.md'));
    const head = commit();
    assert.equal(scan().status, 0, 'the clean staged tree alone cannot cover deleted history');
    const result = scan('--range', `${root}..${head}`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /<withheld-path [0-9a-f]{8}\/\d+> \[excluded-token\]/u);
    assert.ok(!result.stderr.includes('temporary.md'));
    assert.ok(!result.stderr.includes(prohibited));
  }));

test('removed prohibited paths remain rejected without disclosing their names', () =>
  fixture(({ repo, root, commit, scan }) => {
    const path = join(repo, `${prohibited}.md`);
    writeFileSync(path, 'ordinary contents');
    commit();
    rmSync(path);
    const head = commit();
    const result = scan('--range', `${root}..${head}`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /<withheld-path [0-9a-f]{8}\/\d+> \[excluded-token\]/u);
    assert.ok(!result.stderr.includes(prohibited));
  }));

test('commit message policy findings survive behind a clean tip', () =>
  fixture(({ root, commit, scan }) => {
    commit(`chore: ${prohibited}`);
    const head = commit();
    const result = scan('--range', `${root}..${head}`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /commit-[a-f0-9]+-metadata \[excluded-token\]/u);
    assert.ok(!result.stderr.includes(prohibited));
  }));

test('author metadata and the first root are scanned', () =>
  fixture(({ git, scan }) => {
    git('-c', `user.name=${prohibited}`, 'commit', '--amend', '--reset-author', '--no-edit', '-q');
    const result = scan('--range', git('rev-parse', 'HEAD'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /metadata \[excluded-token\]/u);
    assert.ok(!result.stderr.includes(prohibited));
  }));

test('the explicit range excludes unrelated branches and refuses an empty range', () =>
  fixture(({ git, root, commit, scan }) => {
    git('checkout', '-qb', 'unrelated');
    commit(`chore: ${prohibited}`);
    git('checkout', '-q', 'main');
    const head = commit();
    assert.equal(scan('--range', `${root}..${head}`).status, 0);
    // Sol CF-07: zero commits is no history evidence.
    const empty = scan('--range', `${head}..${head}`);
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /nothing to check/u);
    assert.equal(
      scan('--outgoing').status,
      1,
      'manual outgoing mode includes all unpublished branches',
    );
  }));

test('unknown ranges fail without printing private input', () =>
  fixture(({ scan }) => {
    const result = scan('--range', prohibited);
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes(prohibited));
  }));

test('real pre-push history guard refuses removed content and permits a clean selected ref', () =>
  fixture(({ dir, repo, root, commit }) => {
    const gate = join(dir, 'gate-stub');
    writeFileSync(gate, '#!/bin/sh\nexit 0\n');
    chmodSync(gate, 0o755);
    const run = (input) =>
      spawnSync('sh', ['-e', join(source, '.husky/pre-push')], {
        cwd: repo,
        input,
        encoding: 'utf8',
        env: {
          ...process.env,
          HUB_GATE_CMD: gate,
          HUB_PUBLIC_CONTENT_CMD: `${process.execPath} ${guard}`,
        },
      });
    assert.equal(run(`refs/heads/main ${root} refs/heads/main ${zero}\n`).status, 0);
    writeFileSync(join(repo, 'temporary.md'), prohibited);
    commit();
    rmSync(join(repo, 'temporary.md'));
    const head = commit();
    const denied = run(`refs/heads/main ${head} refs/heads/main ${root}\n`);
    assert.equal(denied.status, 1);
    assert.match(denied.stderr + denied.stdout, /excluded-token/u);
    assert.equal(
      run(`refs/heads/main ${root} refs/heads/main ${zero}\n`).status,
      0,
      'a contaminated unrelated tip must not block the selected clean ref',
    );
    assert.equal(
      run(`refs/heads/main ${zero} refs/heads/main ${head}\n`).status,
      0,
      'deletions do not scan unrelated history',
    );
  }));

test('a shallow checkout cannot claim complete history coverage', () =>
  fixture(({ dir, repo }) => {
    const shallow = join(dir, 'shallow');
    execFileSync('git', ['clone', '--depth', '1', '--quiet', `file://${repo}`, shallow], {
      stdio: 'pipe',
    });
    const result = spawnSync(process.execPath, [guard, '--repo', shallow, '--range', 'HEAD'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /complete Git checkout/u);
  }));

test('annotated tags fail closed instead of silently discarding tag metadata', () =>
  fixture(({ git, scan }) => {
    git('-c', 'tag.gpgsign=false', 'tag', '-am', prohibited, 'annotated');
    const result = scan('--range', 'annotated');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /annotated tag publication is not supported/u);
    assert.ok(!result.stderr.includes(prohibited));
  }));

test('excluded operational tokens fail staged, exported and removed-history checks', () =>
  fixture(({ dir, repo, git, commit, root, scan }) => {
    const token = ['synthetic', 'operation', 'canary'].join('');
    writeFileSync(join(repo, 'context.md'), token);
    git('add', '.');
    const staged = scan();
    assert.equal(staged.status, 1);
    assert.match(staged.stderr, /excluded-token/u);
    const candidate = join(dir, 'candidate');
    const manifest = join(dir, 'manifest.json');
    exportCandidate(repo, candidate, manifest);
    const exported = spawnSync(
      process.execPath,
      [guard, '--candidate', candidate, '--manifest', manifest],
      { encoding: 'utf8' },
    );
    assert.equal(exported.status, 1);
    assert.match(exported.stderr, /excluded-token/u);
    commit();
    rmSync(join(repo, 'context.md'));
    const head = commit();
    const history = scan('--range', `${root}..${head}`);
    assert.equal(history.status, 1);
    assert.match(history.stderr, /excluded-token/u);
    assert.ok(
      ![staged.stderr, exported.stderr, history.stderr].some((output) => output.includes(token)),
    );
  }));

// Sol CF-07 round three: every object is read locally, so Git gets no GitHub or registry credential.
test('local Git never receives a GitHub or registry credential', () =>
  fixture(({ dir, repo }) => {
    const tokens = ['GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN'];
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    mkdirSync(join(dir, 'bin'));
    writeFileSync(
      join(dir, 'bin/git'),
      `#!/bin/sh\n: > '${dir}/ran'\n[ -n "${tokens.map((name) => `\${${name}:-}`).join('')}" ] && : > '${dir}/seen'\nexec '${realGit}' "$@"\n`,
    );
    chmodSync(join(dir, 'bin/git'), 0o755);
    const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` };
    for (const name of tokens) env[name] = 'synthetic-unused';
    for (const selection of [['--range', 'HEAD'], []]) {
      const result = spawnSync(process.execPath, [guard, '--repo', repo, ...selection], { env });
      assert.equal(result.status, 0, String(result.stderr));
      assert.ok(existsSync(join(dir, 'ran')), 'the real local Git ran');
      assert.equal(existsSync(join(dir, 'seen')), false, `credential reached Git: ${selection}`);
    }
  }));

// Sol CF-07 round four: a graft file can cut a parent off without making the clone shallow.
test('a graft file cannot hide removed history and is refused even when it hides nothing', () =>
  fixture(({ repo, root, commit, scan }) => {
    writeFileSync(join(repo, 'temporary.md'), prohibited);
    commit();
    rmSync(join(repo, 'temporary.md'));
    const head = commit();
    const grafts = join(repo, '.git/info/grafts');
    writeFileSync(grafts, `${head}\n`);
    const hidden = scan('--range', head);
    assert.equal(hidden.status, 1, 'the grafted history is not passed');
    assert.ok(!hidden.stderr.includes(prohibited));
    writeFileSync(grafts, `${root}\n`);
    const harmless = scan('--range', root);
    assert.equal(harmless.status, 1, 'a graft file is refused even when it hides nothing');
    assert.match(harmless.stderr, /without grafts/u);
  }));

// Sol CF-07 round five: the commit-graph file is a cache of parents that Git trusts over the
// commits themselves. Rewritten so the tip has none, it hides the real parent from rev-list.
function forgeRootInGraph(repo, git, tip) {
  git('commit-graph', 'write', '--reachable');
  const path = join(repo, '.git/objects/info/commit-graph');
  const bytes = readFileSync(path);
  const chunk = (id) => {
    const at = Array.from({ length: bytes[6] }, (_, i) => 8 + i * 12).find(
      (offset) => bytes.toString('ascii', offset, offset + 4) === id,
    );
    return Number(bytes.readBigUInt64BE(at + 4));
  };
  const count = bytes.readUInt32BE(chunk('OIDF') + 255 * 4);
  const ids = chunk('OIDL');
  const row = Array.from({ length: count }, (_, i) => i).find(
    (i) => bytes.toString('hex', ids + i * 20, ids + (i + 1) * 20) === tip,
  );
  // Both parent slots of the tip's row become "no parent", then the checksum is made good.
  bytes.writeUInt32BE(0x70000000, chunk('CDAT') + row * 36 + 20);
  bytes.writeUInt32BE(0x70000000, chunk('CDAT') + row * 36 + 24);
  createHash('sha1')
    .update(bytes.subarray(0, -20))
    .digest()
    .copy(bytes, bytes.length - 20);
  chmodSync(path, 0o644);
  writeFileSync(path, bytes);
  assert.equal(git('rev-list', '--count', tip), '1', 'Git reads the forged graph');
}

test('a forged commit-graph cannot hide removed history from the guard', () =>
  fixture(({ repo, git, commit, scan }) => {
    writeFileSync(join(repo, 'temporary.md'), prohibited);
    commit();
    rmSync(join(repo, 'temporary.md'));
    const head = commit();
    forgeRootInGraph(repo, git, head);
    git('config', 'core.commitGraph', 'true');
    const result = scan('--range', head);
    assert.equal(result.status, 1, 'the history behind the forged graph is scanned');
    assert.match(result.stderr, /<withheld-path [0-9a-f]{8}\/\d+> \[excluded-token\]/u);
    assert.ok(!result.stderr.includes('temporary.md'));
    assert.ok(!result.stderr.includes(prohibited));
  }));

// Sol's CF-07-FIX5: Git hands back a loose object's bytes without hashing them, so other bytes
// stored under a commit, tree or blob id would stand in for the object the id names.
function overwrite(repo, oid, type, bytes) {
  const path = join(repo, '.git/objects', oid.slice(0, 2), oid.slice(2));
  chmodSync(path, 0o644);
  writeFileSync(
    path,
    deflateSync(Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`), bytes])),
  );
}

function refusesForgedObject(result) {
  assert.equal(result.status, 1, 'an object whose bytes do not match its id is no evidence');
  assert.match(result.stderr, /do not match their object id/u);
  assert.ok(!result.stderr.includes(prohibited));
}

test('other bytes stored under a historical blob id are refused, not scanned', () =>
  fixture(({ repo, git, commit, scan }) => {
    writeFileSync(join(repo, 'temporary.md'), prohibited);
    commit();
    const oid = git('rev-parse', 'HEAD:temporary.md');
    rmSync(join(repo, 'temporary.md'));
    const head = commit();
    overwrite(repo, oid, 'blob', Buffer.from('Neutral replacement.\n'));
    assert.equal(git('cat-file', 'blob', oid), 'Neutral replacement.', 'Git serves the bytes');
    refusesForgedObject(scan('--range', head));
  }));

test('other bytes stored under a commit id are refused, not scanned', () =>
  fixture(({ repo, git, commit, root, scan }) => {
    const middle = commit(`chore: ${prohibited}`);
    const head = commit();
    const forged = git('cat-file', 'commit', middle).replace(prohibited, 'neutral');
    overwrite(repo, middle, 'commit', Buffer.from(`${forged}\n`));
    assert.equal(git('log', '-1', '--format=%s', middle), 'chore: neutral', 'Git serves it');
    refusesForgedObject(scan('--range', `${root}..${head}`));
  }));

test('other bytes stored under a subtree id are refused, not scanned', () =>
  fixture(({ repo, git, commit, root, scan }) => {
    mkdirSync(join(repo, 'notes'));
    writeFileSync(join(repo, 'notes/temporary.md'), prohibited);
    const added = commit();
    rmSync(join(repo, 'notes'), { recursive: true });
    const head = commit();
    // notes/ is given the root tree's entries, which name only a neutral README.md.
    const clean = execFileSync('git', ['-C', repo, 'cat-file', 'tree', `${root}^{tree}`]);
    overwrite(repo, git('rev-parse', `${added}:notes`), 'tree', clean);
    assert.doesNotMatch(git('ls-tree', '-r', added), /temporary/u, 'Git lists the forgery');
    refusesForgedObject(scan('--range', head));
  }));

// CF-08-F3: a caught failure prints one fixed line, never what the error said. The real check
// runs over a dependency whose failure message carries a marker.
test('a caught failure never prints its message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-public-content-refuse-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    for (const file of ['public-content-check.mjs', 'main-module.mjs']) {
      writeFileSync(join(dir, 'scripts', file), readFileSync(join(source, 'scripts', file)));
    }
    const marker = 'synthetic-caught-message-marker';
    writeFileSync(
      join(dir, 'scripts/candidate-snapshot.mjs'),
      `export const localEnv = {};\nexport const checkCandidate = () => [];\nexport const indexFiles = () => [];\n` +
        `export const options = () => { throw new Error(${JSON.stringify(marker)}); };\n`,
    );
    const result = spawnSync(
      process.execPath,
      [join(dir, 'scripts/public-content-check.mjs'), '--repo', dir],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes(marker), 'the caught message was printed');
    assert.equal(result.stderr.split('\n').filter(Boolean).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
