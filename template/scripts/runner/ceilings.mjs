// SPDX-License-Identifier: AGPL-3.0-only
// The counting, and the refusal.
//
// A review binds to a head; a fix is a push; a push makes a new head with no
// review. So "review the head" never terminates, and on 17 September it did
// not: nine rounds on #16, eleven on #17, 57 of the night's 132 Codex
// sessions spent after the second round.
//
// The count comes off what GitHub and the status table already hold, not off
// a variable in a run, so a third session cannot be bought by starting
// over.

import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { readJson } from '../main-module.mjs';
import { KINDS } from './config.mjs';
import { ghList, isRecord, repoPath } from './gh.mjs';
import { Refusal, readLocked } from './lock.mjs';
import { readRows } from './status.mjs';

/**
 * The event the runner writes before it launches, for every kind.
 *
 * Counting the artefact alone is not counting the session. A Codex session
 * that runs out of context or crashes posts no review, so the count stays
 * where it was and the next launch is allowed, and the next: four sessions on
 * one pull request with the ceiling never reached. That is the 17 September
 * shape. The row is written before the launch, so a session that produces
 * nothing still costs what it cost.
 */
export const launched = (kind) => `${kind} launched`;

/** A review of record declares its reviewer on a line of its own. */
export function isReviewOfRecord(review, reviewer) {
  return String(review?.body ?? '')
    .split('\n')
    .some((line) => line.trim() === `Reviewer: ${reviewer}`);
}

export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  // The expected stop: this pull request has had its two, and asks for a
  // third. It is held, and the run carries on with the others.
  perPullRequestCeiling: 3,
  // The run's budget is out. Nothing else starts, on any pull request.
  runCeiling: 4,
  // A third already exists. The refusal below did not happen, or something
  // went round it. That is a defect in this code, not a busy day.
  defect: 5,
  // The status table and the `held` label disagree.
  disagreement: 6,
  // The token, the rate limit or GitHub itself. Every pull request would be
  // held for one cause, so none is: the run stops and a person looks.
  runFailed: 7,
};

// A review has an id, a body and a user who may be gone. Anything else is not
// a review that counts zero, it is a list the runner cannot read (Sol, CF-03).
const isReview = (review) =>
  isRecord(review) &&
  Number.isSafeInteger(review.id) &&
  typeof review.body === 'string' &&
  (review.user === null || (isRecord(review.user) && typeof review.user.login === 'string'));

/**
 * Reviews of record and Copilot reviews actually on the pull request, with
 * the ids of the reviews counted, which a hold names.
 */
export function countOnPullRequest(config, pr) {
  const reviews = ghList(['api', repoPath(config, `pulls/${pr}/reviews`)], isReview);
  if (!reviews.ok)
    return {
      error: reviews.stderr.trim() || 'gh: could not read the reviews',
      blocked: reviews.blocked,
      runFailed: reviews.runFailed,
    };
  const list = reviews.json ?? [];
  // The review's own `Reviewer:` line, not the string appearing anywhere in
  // it. A review of this pull request that quoted the shape in one of its
  // findings was counted as a review of record by the reviewer it named,
  // which is a ceiling firing on a reviewer who never ran.
  const sol = list.filter((review) => isReviewOfRecord(review, config.reviewOfRecord.reviewer));
  const copilot = list.filter((review) => review.user?.login === config.copilotLogin);
  const posted = { sol: sol.length, copilot: copilot.length, opus: 0 };
  // What the runner wrote down before it launched, which is the only count
  // that sees a session that produced nothing.
  const rows = readRows(config).filter((row) => row.pr === String(pr));
  const counts = {};
  for (const kind of KINDS)
    counts[kind] = Math.max(
      rows.filter((row) => row.event.startsWith(launched(kind))).length,
      posted[kind],
    );
  return { counts, reviewIds: [...sol, ...copilot].map((review) => String(review.id)) };
}

/**
 * May this pull request draw one more of `kind`? Called before the launch,
 * never after: a launcher that will not launch has no choice to make, and the
 * model never gets to argue that one more is fine.
 */
export function mayLaunch(config, kind, counts) {
  if (!KINDS.includes(kind))
    return { allowed: false, exit: EXIT.usage, reason: `unknown kind ${kind}` };
  const ceiling = config.perPullRequest[kind];
  const used = counts[kind] ?? 0;
  if (used > ceiling)
    return {
      allowed: false,
      exit: EXIT.defect,
      reason: `${used} ${kind} already on this pull request against a ceiling of ${ceiling}: a third exists, which this runner should have refused`,
    };
  if (used >= ceiling)
    return {
      allowed: false,
      exit: EXIT.perPullRequestCeiling,
      reason: `${kind} ceiling reached: ${used} of ${ceiling} for this pull request`,
    };
  return { allowed: true, exit: EXIT.ok, reason: `${kind} ${used + 1} of ${ceiling}` };
}

// The budget as written, or null when it is not a JSON object. The caller
// holds the budget's lock, and the bytes are those of the file it checked. A
// key given twice is refused, not read as its last: a budget naming BusinessA
// and then BusinessB was BusinessB's to spend (Sol, PR 88).
function parsedBudget(path) {
  const text = readLocked(path);
  try {
    if (!isRecord(JSON.parse(text))) return null;
  } catch {
    // Not JSON is no budget, as a list or a number is.
    return null;
  }
  try {
    return readJson(text);
  } catch {
    throw new Refusal(path, 'gives a key twice, so it is not used');
  }
}

// A budget names the one repository it is for, as the status table does, and
// another repository's is refused without a word of what it holds: a config
// for BusinessB spent BusinessA's allowance, and its begin refilled it (Sol,
// CF-03-FIX3).
const notOurs = (config) =>
  new Refusal(config.budgetPath, `is not ${config.repository}'s run budget, so it is not used`);

/**
 * What is left of the run, read back. The file is evidence of what was
 * spent, so anything this file did not write is refused rather than refilled
 * from the config: a missing, unreadable or mistyped budget, or one above its
 * own ceiling, gave a run its whole allowance back (Sol, CF-03). `begin` is
 * the one way to start again, and it is a person's call. A refusal never
 * quotes the file.
 */
function readBudget(config) {
  const path = config.budgetPath;
  const refused = (why) => new Refusal(path, `${why}; run begin to start a run`);
  if (!existsSync(path)) throw refused('does not exist, so no run has begun');
  const parsed = parsedBudget(path);
  if (parsed === null) throw refused('is not a JSON object');
  if (parsed.repository === undefined) throw refused('names no repository');
  if (parsed.repository !== config.repository) throw notOurs(config);
  for (const kind of KINDS) {
    const left = parsed[kind];
    if (!Number.isSafeInteger(left) || left < 0 || left > config.perRun[kind])
      throw refused(
        `gives ${kind} something other than a whole number from 0 to ${config.perRun[kind]}`,
      );
  }
  return Object.fromEntries(KINDS.map((kind) => [kind, parsed[kind]]));
}

// Written whole or not at all: a torn write would leave a budget only
// `begin` can mend, and `begin` refills it. The next budget is a file this
// write creates, so one already at that name is refused, not written through:
// a symlink planted there sent the budget into another business's file, and
// the rename then put that file in the budget's place (Sol, CF-03-FIX2). One
// left by a runner stopped before the rename is named, with what to do.
function writeBudget(config, budget) {
  const next = `${config.budgetPath}.next`;
  const bound = { repository: config.repository, ...budget };
  try {
    writeFileSync(next, `${JSON.stringify(bound, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    throw new Refusal(next, 'is left by an interrupted write; with no runner running, remove it');
  }
  renameSync(next, config.budgetPath);
}

/**
 * Start a run: the budget goes back to the ceilings in the config. Without
 * this the file is a lifetime total and a second run stops on its first
 * request, which reads as a ceiling working and is a runner that never
 * starts. A budget naming another repository is never refilled; one naming
 * none, or damaged, is this person's to start again. The caller holds the
 * budget's lock, as `runner.mjs` does.
 */
export function beginRun(config) {
  const owner = existsSync(config.budgetPath)
    ? parsedBudget(config.budgetPath)?.repository
    : undefined;
  if (owner !== undefined && owner !== config.repository) throw notOurs(config);
  writeBudget(config, { ...config.perRun });
  return { ...config.perRun };
}

/**
 * Take one from the run's budget, before the launch. Decrementing after would
 * mean the session that broke the ceiling is the one that already ran, which
 * is the shape of every number the night of 17 September overran. The read
 * and the write are one decision, so the caller holds the budget's lock, as
 * `runner.mjs` does; two spends that both read the last slot both took it.
 */
export function spend(config, kind) {
  if (!KINDS.includes(kind))
    return { spent: false, exit: EXIT.usage, reason: `unknown kind ${kind}` };
  const budget = readBudget(config);
  if (budget[kind] <= 0)
    return {
      spent: false,
      exit: EXIT.runCeiling,
      remaining: budget,
      reason: `run ceiling reached: ${kind} is out of its ${config.perRun[kind]} for this run`,
    };
  budget[kind] -= 1;
  writeBudget(config, budget);
  return {
    spent: true,
    exit: EXIT.ok,
    remaining: budget,
    reason: `${kind}: ${budget[kind]} of ${config.perRun[kind]} left for this run`,
  };
}
