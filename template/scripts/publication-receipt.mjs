// SPDX-License-Identifier: AGPL-3.0-only
// Records PASS or FAIL for each condition a proposed publication has to meet: one new root commit,
// a clean signed checkout, and a contamination scan of the whole history.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { externalOutput, localEnv as env, options } from './candidate-snapshot.mjs';
import { refuse } from './main-module.mjs';

const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
// The path the kernel holds for open file 3, read from the file itself rather
// than looked up by name. Isolated mode, so no module beside it is imported.
const WHERE = [
  'import fcntl, os, sys',
  'getpath = getattr(fcntl, "F_GETPATH", None)',
  'path = fcntl.fcntl(3, getpath, bytes(1024)).split(b"\\0")[0] if getpath else os.fsencode(os.readlink("/proc/self/fd/3"))',
  'sys.stdout.buffer.write(path)',
].join('\n');

// Whether the commit's file `entry` (an ls-tree line) has the same bytes and
// mode under `from`. With `into`, bytes that match are copied there,
// read-only, for the checks to run. With `lf`, CRLF line endings read as LF.
const unchanged = (entry, into, from, lf = false) => {
  const [, mode, oid, path] = /^(\d+) \w+ (\w+)\t(.*)$/su.exec(entry);
  const stat = lstatSync(join(from, path), { throwIfNoEntry: false });
  let bytes =
    mode === '120000' && stat?.isSymbolicLink()
      ? readlinkSync(join(from, path), 'buffer')
      : stat?.isFile() && mode === (stat.mode & 0o100 ? '100755' : '100644')
        ? readFileSync(join(from, path))
        : null;
  if (lf && bytes) bytes = Buffer.from(bytes.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
  const hash = createHash(oid.length === 64 ? 'sha256' : 'sha1');
  const exact = bytes && hash.update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === oid;
  if (exact && into) {
    mkdirSync(dirname(join(into, path)), { recursive: true });
    if (mode === '120000') symlinkSync(bytes, join(into, path));
    else writeFileSync(join(into, path), bytes, { flag: 'wx', mode: stat.mode & 0o555 });
  }
  return exact;
};

let receipt;
let tree;
// Every refusal is one fixed line, never an error's message or anything the
// repository holds (CF-08-F3). An opened receipt is left saying FAIL.
const stop = (reason) => {
  if (tree !== undefined) rmSync(tree, { recursive: true, force: true });
  if (receipt !== undefined) {
    ftruncateSync(receipt);
    writeSync(receipt, 'Local result: FAIL. The receipt stopped early.\n', 0);
  }
  refuse('publication-receipt', 'first root', reason);
};
const outside = 'output must be a new file, in an existing folder outside the subject directories';

try {
  const argumentsList = process.argv.slice(2);
  const firstRoot = argumentsList.shift() === '--first-root';
  let opts = {};
  try {
    opts = options(argumentsList, ['ref', 'output']);
  } catch {
    // Reported below, as a usage error.
  }
  if (!firstRoot || !opts.ref || !opts.output) {
    stop('usage: publication-receipt.mjs --first-root --ref REF --output EXTERNAL_MD');
  }
  const repo = realpathSync(resolve(import.meta.dirname, '..'));
  const git = (args, extra = {}) =>
    execFileSync('git', args, {
      cwd: repo,
      env: { ...env, ...extra },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  const sha = git(['rev-parse', '--verify', '--end-of-options', `${opts.ref}^{object}`]);
  if (git(['cat-file', '-t', sha]) !== 'commit') {
    stop('receipt requires a commit object; annotated tag publication is not supported');
  }
  // Opened now, from inside the folder checked, so swapping a folder above it
  // cannot redirect the open. The process stays in that folder, so the receipt
  // can be found again wherever the folder itself has been moved.
  let output;
  try {
    output = externalOutput(opts.output, [repo]);
  } catch {
    stop(outside);
  }
  const name = basename(output);
  process.chdir(dirname(output));
  if (process.cwd() !== dirname(output)) stop(outside);
  receipt = openSync(name, 'wx');
  // Checked after the act, since a move can land between any check and the
  // open: the path resolved afresh names the opened file, and no folder above
  // it is the subject. A receipt found inside its subject is removed.
  const subject = statSync(repo);
  const root = realpathSync.native(repo);
  const contained = () => {
    const path = realpathSync.native(name);
    if (!same(lstatSync(path), fstatSync(receipt))) {
      stop('the receipt was moved or replaced after it was opened');
    }
    let inside = false;
    for (let folder = dirname(path); folder !== dirname(folder); folder = dirname(folder)) {
      inside ||= same(statSync(folder), subject);
    }
    // Those reads name folders by path, so a folder moved into the subject
    // while they run, with a link left in its place, is read through it (Sol
    // CF-07-FIX4). The last read is the open receipt's own path, which no move
    // or link can stand in for, and nothing is read after it.
    const now = execFileSync('python3', ['-I', '-c', WHERE], {
      cwd: repo,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe', receipt],
    });
    if (inside || now.startsWith(`${root}${sep}`)) {
      if (same(lstatSync(now), fstatSync(receipt))) unlinkSync(now);
      stop(outside);
    }
  };
  contained();
  const commits = git(['rev-list', sha]).split('\n');
  // Git is told to ignore any graft file, so the subject's own is looked up
  // without that setting: a graft file present at all is refused.
  const grafts = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-path', 'info/grafts'],
    { cwd: repo, env: { ...env, GIT_GRAFT_FILE: undefined }, encoding: 'utf8' },
  ).trim();
  const results = [];
  const record = (label, pass) => results.push({ label, status: pass ? 'PASS' : 'FAIL' });
  record(
    'Proposed history is exactly one new root commit',
    commits.length === 1 &&
      git(['rev-parse', '--is-shallow-repository']) === 'false' &&
      !existsSync(grafts),
  );
  // Status reads working bytes only where local state lets it: an index flag
  // stops it looking (Sol CF-07-FIX4), core.checkStat and core.trustctime let
  // a same-size edit with its time put back pass, and a clean filter hands it
  // other bytes (security review of 15ad8c8). So status reads a fresh index of
  // the commit, and the checkout's own index is compared with the commit
  // without the working tree. Last, each file of the commit is hashed, as Git
  // hashes a blob, from its bytes and mode as they are (`unchanged`).
  const top = realpathSync(git(['rev-parse', '--show-toplevel']));
  const tracked = git(['ls-tree', '-r', '-z', '--full-tree', sha]).split('\0').slice(0, -1);
  const checkout = (into) => {
    const scratch = mkdtempSync(join(tmpdir(), 'receipt-index-'));
    const fresh = { GIT_INDEX_FILE: join(scratch, 'index') };
    git(['read-tree', sha], fresh);
    const flags = git(['ls-files', '-v', '-z', '--', ':/']).split('\0').slice(0, -1);
    const staged = git(['diff-index', '--cached', '--name-only', '-z', sha]);
    const lines = git(['status', '--porcelain=v2', '--branch', '--untracked-files=all'], fresh);
    rmSync(scratch, { recursive: true });
    const changed = tracked.filter((entry) => !unchanged(entry, into, top));
    const quiet = staged === '' && lines.split('\n').every((line) => line.startsWith('# '));
    return {
      atHead: lines.split('\n').includes(`# branch.oid ${sha}`),
      clean: changed.length === 0 && quiet,
      // Bytes Git reports unchanged that differ only by CRLF were converted on
      // checkout (security review of 8c2311c, finding 4).
      converted: changed.length > 0 && quiet && changed.every((e) => unchanged(e, null, top, true)),
      flagged: flags.some((entry) => !entry.startsWith('H ')),
    };
  };
  // The checks run from a private copy of the bytes the first check read,
  // never from the checkout, which can change while they run (Sol PRV-cf-85
  // R1). A link file points the copy at this repository's Git directory, and
  // the installed dependencies are linked in, not copied.
  tree = mkdtempSync(join(tmpdir(), 'receipt-tree-'));
  const before = checkout(tree);
  if (before.converted)
    stop('a file is checked out with CRLF line endings; line-ending conversion is not supported');
  record('Checkout HEAD equals the proposed commit', before.atHead);
  record('Checkout has no uncommitted or nonignored untracked files', before.clean);
  const initialPass = results.every(({ status }) => status === 'PASS');
  // Any process of this user can change the copy while the checks run from it
  // (security review of 8c2311c, finding 1), so it is hashed again after them
  // and once more before the write. It holds the commit's files and folders,
  // the link file and the dependency link, and nothing else.
  const here = join(tree, relative(top, repo));
  const gitFile = `gitdir: ${git(['rev-parse', '--absolute-git-dir'])}\n`;
  const modules = existsSync(join(repo, 'node_modules')) && join(repo, 'node_modules');
  const files = new Set(['.git']);
  if (modules) files.add(relative(tree, join(here, 'node_modules')));
  const folders = new Set();
  for (let path of tracked.map((entry) => entry.slice(entry.indexOf('\t') + 1))) {
    files.add(path);
    while ((path = dirname(path)) !== '.') folders.add(path);
  }
  const holds = (folder, at = '') =>
    readdirSync(folder, { withFileTypes: true }).every((entry) => {
      const [path, kind] = [at + entry.name, entry.isDirectory() ? folders : files];
      return kind.has(path) && (kind === files || holds(join(folder, entry.name), `${path}/`));
    });
  const intact = () =>
    holds(tree) &&
    tracked.every((entry) => unchanged(entry, null, tree)) &&
    readFileSync(join(tree, '.git'), 'utf8') === gitFile &&
    (!modules || readlinkSync(join(here, 'node_modules')) === modules);
  if (initialPass) {
    writeFileSync(join(tree, '.git'), gitFile);
    if (modules) symlinkSync(modules, join(here, 'node_modules'));
    const run = (label, command, args, extra = {}) => {
      const result = spawnSync(command, args, {
        cwd: here,
        env: { ...env, ...extra },
        stdio: 'ignore',
      });
      record(label, result.status === 0);
    };
    run('Commit signature verifies locally using current trust configuration', 'git', [
      'verify-commit',
      sha,
    ]);
    // Isolated, so no module beside the scanner, ignored or not, stands in for
    // one it imports (security review of 15ad8c8).
    const sweep = ['-I', 'scripts/gate/sweep.py'];
    run('Contamination scanner self-test', 'python3', [...sweep, '--self-test']);
    run('Contamination scan of all proposed history', 'python3', [...sweep, '--range', sha]);
    run(
      'Root commit subject and provenance declarations',
      process.execPath,
      ['scripts/commit-range-check.mjs'],
      { BASE_SHA: sha, HEAD_SHA: sha, HUB_RANGE_INCLUDE_ROOT: '1', CI: 'true' },
    );
    run(
      'Public foundation content policy on every proposed commit, metadata and blob/path',
      process.execPath,
      ['scripts/public-content-check.mjs', '--repo', repo, '--range', sha],
    );
    run('Secret scan of the proposed history', 'gitleaks', [
      'git',
      '--no-banner',
      '--redact',
      '--config',
      '.gitleaks.toml',
      `--log-opts=${sha}`,
      '.',
    ]);
    record('The checks ran from a copy still holding the bytes checked', intact());
    const after = checkout();
    record(
      'Checkout is still clean and at the proposed commit after the checks',
      after.atHead && after.clean,
    );
  }
  const pass = results.every(({ status }) => status === 'PASS');
  const lines = [
    '# Local first-publication commit receipt',
    '',
    `Proposed commit: \`${sha}\`. Reachable commits: ${commits.length}.`,
    '',
    'This receipt records local checks of an explicit committed candidate. File-only preparation uses the separate candidate manifest. Inherited source history is not a first-root publication candidate.',
    '',
    ...results.map(({ label, status }) => `- ${status}: ${label}.`),
    ...(initialPass
      ? []
      : [
          '- NOT RUN: signature, content, provenance and secret checks. The candidate prerequisites failed.',
        ]),
    '',
    'Hosted workflows, required check names and app origins, Copilot review, branch enforcement, GitHub signature display and mailbox delivery were not verified by this command. It makes no claim about their current state.',
    '',
    'Model/tool trailers are declarations. This command cannot establish who typed a sign-off or verify the actual authoring model. Product behaviour and publication approval are outside its scope.',
    '',
    `Local result: ${pass ? 'PASS' : 'FAIL'}. Publication still requires the owner decision and separately recorded hosted evidence.`,
    '',
  ];
  if (pass && !intact()) stop('the copy the checks ran from changed; nothing is certified');
  rmSync(tree, { recursive: true, force: true });
  writeFileSync(receipt, lines.join('\n'));
  // The evidence is asked again after the write, containment last so nothing
  // is read after the last check: a change replaces the receipt with a refusal.
  // Before the write a flag fails only what it hides; after it, any is refused.
  const final = checkout();
  contained();
  if (pass && final.flagged) stop('an index flag is set; clear it and run the receipt again');
  if (pass && !(final.atHead && final.clean)) {
    stop('the checkout changed while the receipt was written; nothing is certified');
  }
  closeSync(receipt);
  console.log(`receipt: ${pass ? 'PASS' : 'FAIL'}, external local-evidence file written`);
  process.exitCode = pass ? 0 : 1;
} catch {
  stop('a file or Git operation failed');
}
