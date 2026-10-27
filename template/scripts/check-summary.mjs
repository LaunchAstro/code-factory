// SPDX-License-Identifier: AGPL-3.0-only
// What the last local run of `pnpm check` was, and whether it is a green record.
//
// `pnpm check` takes its exit from this record: a run is green only when
// every step ran and passed on one committed tree that nothing changed while
// the steps ran. The record is left on disk beside the tree it describes.
//
// The file is `*.local`, which .gitignore already covers, because it describes
// one machine's run and belongs to nobody else.

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { localGitEnv } from './main-module.mjs';

const SUMMARY_FILE = '.check-summary.local';

const repoRoot = (root) => root ?? resolve(import.meta.dirname, '..');

const summaryPath = (root) => resolve(repoRoot(root), SUMMARY_FILE);

// Whether the bytes that were checked are the bytes that are committed. Sol's
// review of 5373a69 found the record naming a commit it had not tested: run the
// checks with an uncommitted fix in the tree, discard the fix, and HEAD has not
// moved, so a green record stood for bytes nobody ran. Its review of CF-10-FIX1
// found a Git that could not answer read as uncommitted work, so `observed`
// says whether Git named a commit and reported the tree; the runner refuses a
// run it could not observe. Its review of CF-10-FIX2 found an edit made and
// restored between steps unseen when uncommitted work kept `clean` false
// throughout, so `tree` digests every byte beyond the head: the status, the
// diff of tracked files against it, and each untracked file's contents. Its
// review of CF-10-FIX3 found an untracked nested repository, which Git lists
// as one directory, read as empty, so `unread` names the first untracked path
// that is not a file or link it could read, and the tree is then unobserved.
// Its review of CF-10-FIX4 found a repository config hiding untracked files
// from status, and an assume-unchanged or skip-worktree entry hiding an edit
// from status and diff alike, so status always lists untracked files, and a
// marked entry leaves the tree unclean. The security review of 75146a0 found
// uncommitted ignore rules hiding the same, so only a committed .gitignore
// hides a file; its review of 264a68b found a .GITIGNORE read as one on a Mac,
// so a rule file in any case counts, and a committed nested repository's own
// rules and index hiding its bytes, so `nested` names one and it is unobserved.
// Sol's review of PR 88 found a rule file inside an ignored folder hidden when
// the folder was listed as one entry, so each rule file is listed, and an edit
// to a marked entry made and restored between steps unseen, so the bytes of
// each marked entry are digested. The security review of b51657a found a run
// below the top seeing only its own folder's flags and rule files, so every
// question is asked at the top, of the whole repository; and a folder Git
// could not open left out with only a warning, so any warning is unobserved.
// Sol's second review of PR 88 found each rule file inside an ignored folder
// listed but not digested, so one edited and restored between steps went
// unseen: its name and bytes are digested now, and one unread is unobserved.
// It found Git handed the whole environment, a token meant for gh included,
// so Git gets only what it needs to find itself and its configuration.
/**
 * What the tree is now: its head commit, whether it is clean, a digest of its
 * bytes beyond the head, whether Git said so, any untracked path unread, any
 * nested repository, Git's first warning, and the first uncommitted rule file.
 */
export function observeRun(root) {
  let warning = null;
  const env = localGitEnv();
  const ask = (args, cwd) => {
    const answer = spawnSync('git', args, { cwd, encoding: 'utf8', env });
    if (answer.status !== 0) return null;
    if (answer.stderr.trim() === '') return answer.stdout;
    warning ??= answer.stderr.trim().split('\n')[0];
    return null;
  };
  const top = ask(['rev-parse', '--show-toplevel'], repoRoot(root))?.trim() || null;
  const inRepo = (args) => (top === null ? null : ask(args, top));
  const head = inRepo(['rev-parse', '--verify', 'HEAD'])?.trim() ?? '';
  const status = inRepo(['-c', 'status.showUntrackedFiles=all', 'status', '--porcelain']);
  const entries = inRepo(['ls-files', '-v', '-s', '-z']);
  const marked = entries?.split('\0').filter((entry) => /^(?:[a-z]|S) /u.test(entry)) ?? [];
  const nested = nestedRepository(entries, top);
  const diff = inRepo(['diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD']);
  const ignoring = ['ls-files', '-z', '--others', '--exclude-per-directory=.gitignore'];
  const others = inRepo(ignoring);
  // Untracked .gitignore files in any case, ignored folders included.
  const rules = inRepo([...ignoring, '-i', ':(glob,icase)**/.gitignore']);
  const tree = createHash('sha256').update(`${status}\0${diff}`);
  for (const entry of marked) {
    const path = entry.slice(entry.indexOf('\t') + 1);
    const bytes = contents(resolve(top, path));
    tree.update(`\0${path}\0${bytes === null ? 'unread' : 'read'}\0`).update(bytes ?? '');
  }
  let unread = null;
  for (const path of [others, rules].flatMap((list) => list?.split('\0').filter(Boolean) ?? [])) {
    const bytes = contents(resolve(top, path));
    if (bytes === null) {
      unread = path;
      break;
    }
    tree.update(`\0${path}\0`).update(bytes);
  }
  const observed =
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(head) &&
    status !== null &&
    diff !== null &&
    others !== null &&
    entries !== null &&
    rules !== null &&
    unread === null &&
    nested === null &&
    warning === null;
  return {
    head,
    clean: observed && status.trim() === '' && others === '' && rules === '' && marked.length === 0,
    tree: tree.digest('hex'),
    observed,
    unread,
    nested,
    warning,
    rule: rules?.split('\0')[0] || null,
  };
}

// The first gitlink, or tracked folder holding a .git of its own: a nested
// repository, whose own exclude file, ignore rules and index hide its bytes.
function nestedRepository(entries, top) {
  const folders = new Set();
  for (const entry of entries?.split('\0').filter(Boolean) ?? []) {
    const path = entry.slice(entry.indexOf('\t') + 1);
    if (entry.split(' ')[1] === '160000') return path;
    for (let at = path.lastIndexOf('/'); at > 0; at = path.lastIndexOf('/', at - 1))
      folders.add(path.slice(0, at));
  }
  const dotGit = (folder) => resolve(top, folder, '.git');
  return [...folders].find((f) => lstatSync(dotGit(f), { throwIfNoEntry: false })) ?? null;
}

// A link's target rather than what it points at. Null for a directory, a
// file that cannot be read, or one that went between listing and reading.
function contents(path) {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return readlinkSync(path);
    if (stat.isFile()) return readFileSync(path);
  } catch {
    // Unread, below.
  }
  return null;
}

/**
 * Record a finished run. `steps` is what ran, `expected` is what the runner
 * would have run had nothing failed, so a run that stopped early cannot read
 * as a complete one.
 */
export function recordRun({ results, expected, root, started }) {
  const ended = observeRun(root);
  // A commit or an edit made and undone during the run leaves a clean head at
  // the end and bytes nobody checked in the middle. Sol's review of 51c60cd
  // found the runner sampling only the end, so the run is bound to both, and
  // its review of 6f05686 found that two snapshots cannot see an edit that was
  // restored between them, so the runner samples after every step and passes
  // a `started` that already says so. What is left invisible is a change made
  // and undone inside one step, which this does not claim to catch.
  const steady =
    ended.observed &&
    (started === undefined ||
      (started.observed && started.head === ended.head && started.clean && ended.clean));
  const summary = {
    head: ended.head,
    clean: ended.clean && steady,
    steps: results.length,
    passed: results.filter((r) => r.ok).length,
    green: results.length === expected && results.every((r) => r.ok) && steady,
    at: new Date().toISOString(),
  };
  // Sol's review of CF-10-FIX4 found the write following a symlink at the
  // summary path onto a checked input, so the record is a new file of its own,
  // renamed over the path, which replaces whatever sat there.
  const temporary = `${summaryPath(root)}.${process.pid}.${randomBytes(6).toString('hex')}.local`;
  try {
    writeFileSync(temporary, `${JSON.stringify(summary)}\n`, { flag: 'wx' });
    renameSync(temporary, summaryPath(root));
  } catch {
    // A read-only checkout still runs its checks and gets its verdict; it just
    // leaves no record behind.
    rmSync(temporary, { force: true });
  }
  return summary;
}
