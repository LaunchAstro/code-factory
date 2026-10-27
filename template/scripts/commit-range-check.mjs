// SPDX-License-Identifier: AGPL-3.0-only
// Check every selected commit, including the root when explicitly requested.
// Local commitlint and this range check share provenance parsing and validation.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { keepOnlyLocalGitEnv } from './local-git-env.mjs';
import { exitWith, refuse } from './main-module.mjs';
import { isPlatformMergeCommit, messageProvenanceErrors } from './provenance.mjs';

if (!process.env['BASE_SHA'] || !process.env['HEAD_SHA']) {
  exitWith(2, 'commit-range: BASE_SHA and HEAD_SHA must both be set.');
}

// Every input this gate takes from the environment is read here, and then the
// environment is cut to what Git needs, so no credential reaches a Git child,
// commitlint or the Git that provenance.mjs runs: Sol's CF-09 fourth round.
const requested = { BASE_SHA: process.env['BASE_SHA'], HEAD_SHA: process.env['HEAD_SHA'] };
const includeRoot = process.env['HUB_RANGE_INCLUDE_ROOT'] === '1';
const inCi = Boolean(process.env['CI']);
keepOnlyLocalGitEnv();

// Each names one commit, resolved by git, or the run refuses. An unresolved
// base used to fall into the no-common-ancestor branch below and check a
// selection nobody asked for, and `X..X` as HEAD_SHA reached rev-list as a
// range that selected nothing: Sol's CF-09 review.
const commit = (name) => {
  const value = requested[name];
  const resolved = spawnSync(
    'git',
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${value}^{commit}`],
    { encoding: 'utf8' },
  );
  if (resolved.status !== 0) {
    exitWith(2, `commit-range: ${name} does not name one commit: ${value}`);
  }
  return resolved.stdout.trim();
};
const base = commit('BASE_SHA');
const head = commit('HEAD_SHA');

const git = (args) => execFileSync('git', args, { encoding: 'utf8' });

// Exit 1 and nothing said is the one answer meaning no common ancestor, and
// then everything reachable from head is checked. Any other failure is git not
// answering, which selects nothing: Sol's CF-09 second round. What Git said is
// not repeated: its stderr can quote a remote URL or a configuration value.
const found = spawnSync('git', ['merge-base', base, head], { encoding: 'utf8' });
if (found.status !== 0 && (found.status !== 1 || found.stderr !== '')) {
  refuse('commit-range', 'git merge-base', 'failed, so no range was selected');
}
const range = found.status === 0 ? `${found.stdout.trim()}..${head}` : head;

// `rev-list a..b` excludes `a` itself. On a first push, where the base is the
// repository's own root commit, that means the root is never checked. Round
// four found it. HUB_RANGE_INCLUDE_ROOT=1 pulls it back in, which is what the
// publication receipt and the first-push case want.
const revListArgs = includeRoot && range.includes('..') ? [range.split('..')[1] ?? head] : [range];

const shas = git(['rev-list', ...revListArgs])
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

// Nothing selected is nothing checked, and that is not a pass.
if (shas.length === 0) {
  exitWith(2, `commit-range: ${range} selects no commit, so nothing was checked.`);
}

// In whole-history mode the range reads `X..X`, which selects nothing, while
// what was checked is everything reachable from X. Sol's third review of #15:
// a line that names an empty range over 53 checked commits is a false report.
const selection =
  includeRoot && range.includes('..')
    ? `the whole history of ${(range.split('..')[1] ?? head).slice(0, 9)}`
    : range;
console.log(`commit-range: ${shas.length} commit(s) in ${selection}`);

const failures = [];

const repoRoot = resolve(import.meta.dirname, '..');
const commitlintBin = join(repoRoot, 'node_modules', '.bin', 'commitlint');
const commitlintConfig = join(repoRoot, 'commitlint.config.js');
const commitlintAvailable = existsSync(commitlintBin) && existsSync(commitlintConfig);
if (!commitlintAvailable && inCi) {
  exitWith(2, 'commit-range: commitlint is required in CI; install the locked dependencies.');
}
if (!commitlintAvailable) {
  console.log(
    'commit-range: commitlint unavailable; only the basic subject rule and provenance ran.',
  );
}

// The built-in rule, which also runs as a second opinion when commitlint is unavailable. Kept deliberately simple: it is a floor, not a replacement.
const TYPES = ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'test'];
const SUBJECT = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9 ,._-]+\\))?!?: .+`, 'u');

// --- both rules, per commit -------------------------------------------------

// NUL frames the fields because a commit object cannot contain one. A unit
// separator can: Git keeps one inside an author name, and a crafted name then
// shifts the parsed fields so that an ordinary identity reads as web-flow.
// Sol's review of 979094 found it, and a case holds it.
// `%x00` in the format, because an argument cannot itself carry a NUL byte.
const FIELD_FORMAT = '%x00';
const FIELD = '\u0000';
const exempt = [];
const notOnBase = [];

// The identity is a claim; this is not. A commit already on the base's history
// got there under the base's own rules, which is what makes the exemption safe
// to grant. `git merge-base --is-ancestor` exits 0 when it is, 1 when it is
// not, and nonzero-but-not-1 when it cannot tell, which is also not a yes.
const onBaseHistory = (sha) => {
  try {
    git(['merge-base', '--is-ancestor', sha, base]);
    return true;
  } catch {
    return false;
  }
};

for (const sha of shas) {
  const short = sha.slice(0, 9);
  const [parents, authorName, authorEmail, committerName, committerEmail] = git([
    'show',
    '-s',
    `--format=%P${FIELD_FORMAT}%an${FIELD_FORMAT}%ae${FIELD_FORMAT}%cn${FIELD_FORMAT}%ce`,
    sha,
  ])
    .trim()
    .split(FIELD);

  // The ruleset requires merge commits; GitHub writes them with no trailers and
  // no conventional type. The commit GitHub wrote itself is exempt, and only it.
  const identity = {
    parents: (parents ?? '').split(' ').filter(Boolean),
    author: { name: authorName, email: authorEmail },
    committer: { name: committerName, email: committerEmail },
  };
  // The shape first, because the ancestry query starts a process and only a
  // commit of this shape can ever be exempt.
  if (isPlatformMergeCommit({ ...identity, onBaseHistory: true })) {
    if (onBaseHistory(sha)) {
      exempt.push(short);
      continue;
    }
    // Refused on the base-history condition alone, which is worth saying out
    // loud: a reader needs to know it was the base and not the message.
    notOnBase.push(short);
  }

  const subject = git(['show', '-s', '--format=%s', sha]).trim();
  if (!commitlintAvailable && !SUBJECT.test(subject)) {
    failures.push(
      `${short} subject is not a conventional commit: ${JSON.stringify(subject)}\n` +
        `         expected one of ${TYPES.join(', ')} followed by ": " and a summary`,
    );
  }

  const message = git(['show', '-s', '--format=%B', sha]);
  if (commitlintAvailable) {
    try {
      execFileSync(commitlintBin, ['--config', commitlintConfig], {
        input: message,
        encoding: 'utf8',
        cwd: repoRoot,
        stdio: 'pipe',
      });
    } catch {
      failures.push(`${short} commitlint rejected the message.`);
    }
  }
  for (const error of messageProvenanceErrors(message)) {
    failures.push(`${short} ${error}`);
  }
}

if (exempt.length > 0) {
  console.log(
    `commit-range: ${exempt.length} merge commit(s) carry the web-flow identity and are already\n` +
      `commit-range: on the history of BASE_SHA, so the message rules do not apply to them: ${exempt.join(', ')}`,
  );
}

if (notOnBase.length > 0) {
  console.error(
    `\ncommit-range: ${notOnBase.length} commit(s) carry the web-flow identity on a merge but are\n` +
      `commit-range: not on the history of BASE_SHA (${base.slice(0, 9)}), so they are checked like any\n` +
      `commit-range: other commit: ${notOnBase.join(', ')}\n` +
      'commit-range: A whole-history run passes the protected tip as BASE_SHA; against any other\n' +
      'commit-range: base a commit of that history simply is not on it. This says which base was\n' +
      'commit-range: used, not who wrote the commit, which nothing here can establish.',
  );
}

if (failures.length > 0) {
  console.error(`\ncommit-range: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(
    'commit-range: rewrite the messages on your branch rather than adding a\n' +
      'commit-range: commit to explain them. `git rebase -i` and `git commit --amend`\n' +
      'commit-range: are the tools; the trailers live in .gitmessage.',
  );
  process.exitCode = 1;
} else {
  console.log(
    exempt.length > 0
      ? `commit-range: ${shas.length - exempt.length} commit(s) carry a valid subject and their ` +
          `provenance; ${exempt.length} exempt.`
      : 'commit-range: every commit carries a valid subject and its provenance.',
  );
}
