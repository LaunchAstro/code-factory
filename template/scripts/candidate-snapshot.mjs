// SPDX-License-Identifier: AGPL-3.0-only
// Exports a repository's staged tree to a candidate directory, and verifies a candidate against
// the manifest of paths, modes and hashes it was exported with.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isMainModule, refuse } from './main-module.mjs';

// Thrown with fixed text this file wrote, which is the only error text the
// command prints: any other error's message can quote a private path or input.
class Refusal extends Error {}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sort = (entries) =>
  entries.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`);

// Local Git and the publication checks get only what they need: no GitHub or
// registry credential, and Git never reads replacement refs, which can make a
// long history look like one root or stand other bytes in for a blob.
export const localEnv = Object.fromEntries(
  [
    'PATH',
    'HOME',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'XDG_CONFIG_HOME',
    'GNUPGHOME',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_SYSTEM',
    'GIT_CONFIG_NOSYSTEM',
    'SystemRoot',
  ]
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]),
);
localEnv.GIT_NO_REPLACE_OBJECTS = '1';
// Nor grafts: this path can never exist, so no graft file is read.
localEnv.GIT_GRAFT_FILE = '/dev/null/no-grafts';
// Nor the commit-graph file, a cache of parents Git trusts over the commits
// themselves: rewritten, it hides a parent. Set as command-line configuration,
// which the repository's own configuration cannot override.
localEnv.GIT_CONFIG_COUNT = '1';
localEnv.GIT_CONFIG_KEY_0 = 'core.commitGraph';
localEnv.GIT_CONFIG_VALUE_0 = 'false';

const git = (repo, args) =>
  execFileSync('git', ['-C', repo, ...args], {
    env: localEnv,
    maxBuffer: 64 * 1024 * 1024,
    stdio: 'pipe',
  });

function safePath(path) {
  if (
    typeof path !== 'string' ||
    !path ||
    isAbsolute(path) ||
    [...path].some(
      (char) => char === '\\' || char.codePointAt(0) < 32 || char.codePointAt(0) === 127,
    ) ||
    path.split('/').some((part) => ['', '.', '..', '.git'].includes(part))
  ) {
    throw new Refusal('invalid candidate path');
  }
}

export function externalOutput(path, roots) {
  const absolute = resolve(path);
  const canonical = join(
    realpathSync(dirname(absolute)),
    absolute.slice(dirname(absolute).length + 1),
  );
  if (roots.some((root) => inside(root, canonical)) || existsSync(canonical)) {
    throw new Refusal('output must be a new file outside the subject directories');
  }
  return canonical;
}

// A regular file's bytes, refusing one swapped after it was examined. O_NOFOLLOW
// refuses a link put in its place; the identity check, on the open file rather
// than the path, refuses another file even when the path is put back after the
// open (Sol CF-05-FIX1).
function regularBytes(full, examined) {
  const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.ino !== examined.ino || opened.dev !== examined.dev)
      throw new Refusal('candidate entry changed while it was read');
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

// `at` is where the entry is examined: its full path, or its name inside the
// directory the walk stands in. The bytes are read by full path and bound to it.
function entry(root, path, at = join(root, path)) {
  safePath(path);
  const full = join(root, path);
  const stat = lstatSync(at);
  if (!stat.isFile() && !stat.isSymbolicLink())
    throw new Refusal('candidate contains an unsupported entry');
  const mode = stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644';
  const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(at)) : regularBytes(full, stat);
  if (stat.isSymbolicLink()) {
    const target = bytes.toString('utf8');
    if (
      isAbsolute(target) ||
      !inside(root, resolve(dirname(full), target)) ||
      !inside(root, realpathSync(full))
    ) {
      throw new Refusal('candidate link must resolve within the candidate');
    }
  }
  return { path, mode, sha256: hash(bytes), bytes };
}

// Make `name` the working directory, and refuse unless it is the directory that
// was examined: a link put in its place is followed, and is another directory.
function enter(name, examined) {
  process.chdir(name);
  const here = lstatSync('.');
  if (!examined.isDirectory() || here.ino !== examined.ino || here.dev !== examined.dev)
    throw new Refusal('candidate entry changed while it was read');
}

/**
 * Every file in the candidate, with its mode and bytes.
 *
 * O_NOFOLLOW guards the last name in a path, not the directories above it, so a
 * directory swapped for a link after it was examined would lead every read under
 * it outside (Sol CF-05-FIX2). The walk stands in each directory as it reads it:
 * the working directory is the directory itself, not a path to it, so what it
 * lists and what a name is there is what the candidate holds, even when the path
 * is swapped and put back around the listing (Sol CF-05-FIX3), and each entry
 * read by its full path must be that. It changes the working directory, so not
 * from a worker thread.
 */
export function candidateFiles(candidate) {
  const root = realpathSync(candidate);
  const home = process.cwd();
  const entries = [];
  function walk(directory) {
    const here = lstatSync('.');
    for (const name of readdirSync('.')) {
      const full = join(directory, name);
      const path = relative(root, full).split(sep).join('/');
      safePath(path);
      const stat = lstatSync(name);
      if (stat.isDirectory()) {
        enter(name, stat);
        walk(full);
        enter('..', here);
      } else entries.push(entry(root, path, name));
    }
  }
  try {
    enter(root, lstatSync(root));
    walk(root);
  } finally {
    process.chdir(home);
  }
  // No files is no evidence, whatever a matching empty manifest says.
  if (entries.length === 0) throw new Refusal('candidate has no files');
  return sort(entries);
}

export function indexFiles(repository) {
  const repo = realpathSync(repository);
  if (realpathSync(git(repo, ['rev-parse', '--show-toplevel']).toString().trim()) !== repo) {
    throw new Refusal('repo must name the repository root');
  }
  if (git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).length > 0) {
    throw new Refusal(
      'unstaged untracked files exist; stage intended files or remove them from this work copy',
    );
  }
  const staged = git(repo, ['ls-files', '--stage', '-z'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const entries = staged.map((line) => {
    const split = line.indexOf('\t');
    const [mode, oid, stage] = line.slice(0, split).split(' ');
    const path = line.slice(split + 1);
    safePath(path);
    if (stage !== '0' || !['100644', '100755', '120000'].includes(mode)) {
      throw new Refusal('index contains a conflict or unsupported entry');
    }
    let parent = dirname(path);
    while (parent !== '.') {
      if (lstatSync(join(repo, parent)).isSymbolicLink())
        throw new Refusal('index path has a symlink ancestor');
      parent = dirname(parent);
    }
    const bytes = git(repo, ['cat-file', 'blob', oid]);
    const actual = entry(repo, path);
    if (actual.mode !== mode || !actual.bytes.equals(bytes)) {
      throw new Refusal('index and worktree differ; stage the exact intended files first');
    }
    return { path, mode, sha256: hash(bytes), bytes };
  });
  if (entries.length === 0) throw new Refusal('candidate index is empty');
  const ignored = spawnSync('git', ['-C', repo, 'check-ignore', '--no-index', '--stdin', '-z'], {
    env: localEnv,
    input: entries.map(({ path }) => path).join('\0') + '\0',
  });
  if (ignored.status !== 1)
    throw new Refusal('index contains ignored paths or ignore validation failed');
  return sort(entries);
}

function manifestFor(entries) {
  const files = entries.map(({ path, mode, sha256 }) => ({ path, mode, sha256 }));
  return {
    schema: 1,
    kind: 'local-candidate-files',
    evidence:
      'File paths, modes and bytes only. No commit, signature, hosted check or publication approval is certified.',
    treeSha256: hash(JSON.stringify(files) + '\n'),
    files,
  };
}

export function checkCandidate(candidate, manifestPath) {
  const root = realpathSync(candidate);
  if (inside(root, realpathSync(manifestPath)))
    throw new Refusal('manifest must be outside the candidate');
  const expected = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entries = candidateFiles(root);
  const actual = manifestFor(entries);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Refusal('candidate file set, mode, bytes or manifest identity differs');
  }
  return entries;
}

export function exportCandidate(repository, candidate, manifestPath) {
  const repo = realpathSync(repository);
  const target = externalOutput(candidate, [repo]);
  const out = externalOutput(manifestPath, [repo, target]);
  const entries = indexFiles(repo);
  mkdirSync(target);
  for (const { path, mode, bytes } of entries) {
    const full = join(target, path);
    mkdirSync(dirname(full), { recursive: true });
    if (mode === '120000') symlinkSync(bytes.toString('utf8'), full);
    else {
      writeFileSync(full, bytes, { flag: 'wx' });
      chmodSync(full, mode === '100755' ? 0o755 : 0o644);
    }
  }
  const exported = candidateFiles(target);
  const manifest = manifestFor(exported);
  if (manifest.treeSha256 !== manifestFor(entries).treeSha256)
    throw new Refusal('export differs from the staged input');
  writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  checkCandidate(target, out);
  return manifest;
}

export function options(args, names) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/u, '');
    const value = args[i + 1];
    if (
      !args[i]?.startsWith('--') ||
      !names.includes(key) ||
      result[key] ||
      !value ||
      value.startsWith('--')
    ) {
      throw new Refusal('invalid or duplicate command arguments');
    }
    result[key] = value;
  }
  return result;
}

if (isMainModule(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const opts = options(args, ['repo', 'candidate', 'manifest']);
    if (
      !opts.candidate ||
      !opts.manifest ||
      !['export', 'check'].includes(command) ||
      (command === 'export' ? !opts.repo : !!opts.repo)
    ) {
      throw new Refusal(
        'usage: candidate-snapshot.mjs export --repo DIR --candidate NEW_DIR --manifest EXTERNAL_JSON; or check --candidate DIR --manifest EXTERNAL_JSON',
      );
    }
    const manifest =
      command === 'export'
        ? exportCandidate(opts.repo, opts.candidate, opts.manifest)
        : manifestFor(checkCandidate(opts.candidate, opts.manifest));
    console.log(
      `candidate-snapshot: ${manifest.files.length} local files, sha256 ${manifest.treeSha256}`,
    );
  } catch (error) {
    const reason =
      error instanceof Refusal ? error.message : 'filesystem, Git or manifest validation failed';
    refuse('candidate-snapshot', 'refused', reason, 1);
  }
}
