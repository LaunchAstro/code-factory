// SPDX-License-Identifier: AGPL-3.0-only
// The status table, and the hold.
//
// The run is read in two places and they must agree: this file, and
// `is:pr label:held`. `status --check` proves it, because a status table
// nobody can trust is what an orchestrator reads instead of looking.
//
// Every event appends one row and nothing rewrites one: the trail is the only
// evidence that the runner obeyed its own ceilings.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gh, ghList, isPullNumber, isRecord, repoPath } from './gh.mjs';
import { Refusal, appendLocked, readLocked } from './lock.mjs';

const HEADER = `# Runner status

| ts | pr | stage | event | opus/sol/copilot | link |
| --- | --- | --- | --- | --- | --- |
`;

// The events the hold is read from. `row` refuses to write them, because a
// typed RELEASED would let a held pull request launch again.
export const HELD = 'HELD';
export const RELEASED = 'RELEASED';
// The first row of a table `begin --new-history` started: the person's reason
// there is no earlier history, and in its last cell the repository the table
// belongs to. It names no pull request and counts nothing.
const HISTORY_STARTED = 'HISTORY STARTED: ';
// A hold's comment is owed from its HELD row until this row says it is on the
// pull request, and until then `status --check` says it is missing.
export const COMMENT_POSTED = 'COMMENT POSTED';

/** A pull request's one spelling: no leading zero, so `012` is not a second #12. */
export const PR_NUMBER = /^[1-9]\d*$/u;

const cell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

const missing = (path) =>
  new Refusal(
    path,
    'is missing, and it is the launch history, so nothing is decided without it. Restore it from where it went: an empty table in its place resets every count and hold',
  );

/**
 * Start a table with no earlier history, its first row the reason and the
 * configured repository, and say whether it did. Only `begin --new-history` calls this, and only where no
 * run has begun: a missing table read as empty history reset every hold and
 * every Opus count (security reviews, 065a3a3 and 828d63a). The exclusive
 * create never empties a table that exists.
 */
export function startTable(config, reason) {
  mkdirSync(dirname(config.statusPath), { recursive: true });
  const first = `| ${new Date().toISOString()} | - | begin | ${cell(HISTORY_STARTED + reason)} | 0/0/0 | ${cell(config.repository)} |\n`;
  try {
    writeFileSync(config.statusPath, HEADER + first, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

/** One row per event, appended as it happens, never batched, under the table's lock. */
export function appendRow(
  config,
  { pr, stage, event, counts, link, ts = new Date().toISOString() },
) {
  const path = config.statusPath;
  if (!existsSync(path)) throw missing(path);
  const tally = `${counts?.opus ?? 0}/${counts?.sol ?? 0}/${counts?.copilot ?? 0}`;
  const row = `| ${ts} | ${cell(pr)} | ${cell(stage)} | ${cell(event)} | ${tally} | ${cell(link ?? '')} |\n`;
  appendLocked(path, row);
  return row;
}

/**
 * The rows, parsed back. The reader and the writer share one shape.
 *
 * The table is the launch history, so a missing table, or one this file did
 * not write, is refused rather than read as empty: an interrupted write that
 * left no recognisable row reset every count to zero (Sol, CF-03). The header is the
 * exact lines `appendRow` writes, found by position, because a stage is free
 * text and a stage called `ts` made every launch row look like the header.
 * Every table `startTable` writes opens with its HISTORY STARTED row, so a
 * table without one has lost rows from its start: cut back to its header, it
 * was read as no launches at all (Sol, CF-03-FIX1). That row names the one
 * repository the table is for, and a table naming another or none is refused
 * without a word of what it holds: two businesses sharing one table retried
 * one's private hold reason as a comment in the other's (Sol, CF-03-FIX2).
 * It is read under its lock, as the file that lock's check saw.
 */
export function readRows(config) {
  const path = config.statusPath;
  if (!existsSync(path)) throw missing(path);
  const text = readLocked(path);
  const damaged = (why) =>
    new Refusal(
      path,
      `is a damaged status table (${why}); nothing is counted from it until a person repairs it`,
    );
  if (!text.startsWith(HEADER)) throw damaged('it does not begin with the table header');
  const rows = [];
  let started = false;
  for (const [index, line] of text.slice(HEADER.length).split('\n').entries()) {
    if (line === '') continue;
    // Split on the pipes `cell` did not escape, then put the escaped ones
    // back: a reason carrying a pipe otherwise shifts every later column.
    const parts = line.split(/(?<!\\)\|/u);
    if (parts.length !== 8 || parts[0] !== '' || parts[7] !== '')
      throw damaged(`row ${index + 1} does not have six cells`);
    const [ts, pr, stage, event, counts, link] = parts
      .slice(1, 7)
      .map((part) => part.trim().replaceAll('\\|', '|'));
    if (index === 0 && pr === '-' && event?.startsWith(HISTORY_STARTED)) {
      if (link !== config.repository)
        throw new Refusal(
          path,
          `is not ${config.repository}'s status table: the last cell of its HISTORY STARTED row must name that repository`,
        );
      started = true;
      continue;
    }
    if (!PR_NUMBER.test(pr ?? '')) throw damaged(`row ${index + 1} names no pull request`);
    rows.push({ ts, pr, stage, event: event ?? '', counts, link });
  }
  if (!started)
    throw damaged('its first row is not the HISTORY STARTED row every table opens with');
  return rows;
}

/**
 * Pull requests this file says are held right now, each with what its hold
 * comment says (the reason, the review ids in the row's last cell, the time)
 * and whether that comment is still owed.
 *
 * The file is append-only, so a hold is undone by a later row and not by an
 * edit. Without that there is no way back: one label GitHub refused, or one
 * owner decision to carry on, and `status --check` is red for the rest of the
 * run about a pull request nobody is waiting on.
 */
export function holdsInStatus(config) {
  const holds = new Map();
  for (const { ts, pr, event, link } of readRows(config)) {
    if (event.startsWith(HELD))
      holds.set(pr, {
        since: ts,
        reason: event.slice(event.indexOf(': ') + 2),
        reviews: link,
        commentOwed: true,
      });
    else if (event.startsWith(COMMENT_POSTED) && holds.has(pr)) holds.get(pr).commentOwed = false;
    else if (event.startsWith(RELEASED)) holds.delete(pr);
  }
  return holds;
}

/** The pull requests this file says are held right now. */
export function heldInStatus(config) {
  return new Set(holdsInStatus(config).keys());
}

const isIssue = (issue) =>
  isRecord(issue) &&
  isPullNumber(issue.number) &&
  (issue.pull_request === undefined || isRecord(issue.pull_request));

/**
 * Open pull requests GitHub says are held. Issues are dropped, because the
 * label on an issue is not a held pull request, and closed ones are dropped,
 * because a pull request the owner has dealt with is no longer part of the run.
 * The label is one encoded value: `needs & owner` sent as typed asked for the
 * label `needs ` and found nothing held (Sol, CF-03-FIX1).
 */
export function heldOnGitHub(config) {
  const label = encodeURIComponent(config.heldLabel);
  const result = ghList(['api', repoPath(config, `issues?state=open&labels=${label}`)], isIssue);
  if (!result.ok) return { error: result.stderr.trim() || 'gh: could not list held pull requests' };
  const held = (result.json ?? []).filter((issue) => issue.pull_request !== undefined);
  return { held: new Set(held.map((issue) => String(issue.number))) };
}

const isPull = (pull) => isRecord(pull) && isPullNumber(pull.number);

/** The open pull requests, which is the set the two lists are compared over. */
export function openPullRequests(config) {
  const result = ghList(['api', repoPath(config, 'pulls?state=open')], isPull);
  if (!result.ok) return { error: result.stderr.trim() || 'gh: could not list open pull requests' };
  return { open: new Set((result.json ?? []).map((pull) => String(pull.number))) };
}

// Every write names the repository its reads name. Without `--repo`, `gh`
// writes to whatever checkout the caller stands in, which can belong to
// another business (Sol, CF-03).
const prWrite = (config, verb, pr, ...rest) =>
  gh(['pr', verb, String(pr), '--repo', config.repository, ...rest]);

// A hold's comment, made only from its HELD row, so the comment posted and
// the comment looked for later are the same text.
const holdBody = ({ reason, reviews, since }) =>
  `## Held for the owner\n\n${reason}\n\nReview ids: ${reviews}\nHeld at: ${since}\n`;

const isComment = (comment) => isRecord(comment) && typeof comment.body === 'string';

/** The account gh posts as, when gh can name it. */
function runnerAccount() {
  const me = gh(['api', 'user', '--jq', '.login']);
  const login = me.stdout.trim();
  return me.ok && /^[\w-]+(?:\[bot\])?$/u.test(login) ? login : undefined;
}

/**
 * Whether this hold's comment is already on the pull request. A comment
 * GitHub posted can still come back as a failure when the answer is lost, and
 * posting again on that was a second comment for one hold (Sol, CF-03-FIX1).
 * Only the whole comment counts, posted by the runner's own account: a comment
 * carrying no more than the `Held at` line discharged the hold with no reason
 * or review ids ever posted (Sol, CF-03-FIX2). When gh cannot name that
 * account, no comment is known to be the runner's, and another person's copy
 * of the text discharged the hold (Sol, CF-03-FIX3).
 */
function holdCommentFound(config, pr, held) {
  const account = runnerAccount();
  if (account === undefined)
    return { error: 'gh cannot name the account the runner posts as, so no comment is its' };
  const result = ghList(['api', repoPath(config, `issues/${pr}/comments`)], isComment);
  if (!result.ok) return { error: result.stderr.trim() || 'gh: could not read the comments' };
  const body = holdBody(held).trimEnd();
  const found = result.json.some(
    (comment) =>
      comment.body.replaceAll('\r\n', '\n').trimEnd() === body && comment.user?.login === account,
  );
  return { found };
}

/**
 * Hold a pull request: the label, the row and the comment. Already held is
 * not an error and not a second row, because a held pull request draws no
 * further action from any runner, including this one. What GitHub refused
 * the first time is tried again: the label always, and the comment while the
 * table says it is owed and the pull request does not already carry it.
 *
 * The HELD row is written before the comment is posted, with everything the
 * comment says. Posted first, a comment whose row was then refused left no
 * hold here, and the next hold posted a second one (Sol, CF-03-FIX2).
 */
export function hold(config, { pr, stage, reason, reviewIds = [], counts }) {
  const already = holdsInStatus(config).has(String(pr));
  const label = prWrite(config, 'edit', pr, '--add-label', config.heldLabel);
  const problems = [];
  // A refused label or comment is said, and written down rather than
  // swallowed: the hold still stands locally, and `status --check` reports
  // the disagreement, which is what it exists for.
  if (!label.ok)
    problems.push(
      `the ${config.heldLabel} label ${already ? 'is still' : 'was'} refused: ${label.stderr.trim()}`,
    );
  if (!already)
    appendRow(config, {
      pr,
      stage,
      event: `${HELD}${label.ok ? '' : ' (unrecorded on GitHub)'}: ${reason}`,
      counts,
      link: reviewIds.length > 0 ? reviewIds.join(', ') : 'none',
    });
  const held = holdsInStatus(config).get(String(pr));
  if (held.commentOwed) {
    // Read, then decide: an answer that was lost may have posted it already.
    const posted = already ? holdCommentFound(config, pr, held) : { found: false };
    const comment =
      posted.found === false ? prWrite(config, 'comment', pr, '--body', holdBody(held)) : undefined;
    if (posted.error !== undefined)
      problems.push(`whether the hold comment was posted cannot be read: ${posted.error}`);
    else if (comment?.ok === false)
      problems.push(
        `the hold comment ${already ? 'is still' : 'was'} refused: ${comment.stderr.trim()}`,
      );
    else appendRow(config, { pr, stage, event: `${COMMENT_POSTED}: ${held.reason}`, counts });
  }
  return { held: true, already, ok: problems.length === 0, problems };
}

/**
 * Let a held pull request back into the run, on a decision recorded outside
 * this file. The label comes off and one row says why, so the table still
 * reads as the whole history and `status --check` still agrees with GitHub.
 * A removal GitHub refused has not happened, so it writes no row: the hold
 * stays in the table and the next release tries the label again.
 */
export function release(config, { pr, stage, reason, counts, link }) {
  if (!heldInStatus(config).has(String(pr))) return { held: false, released: false, problems: [] };
  const label = prWrite(config, 'edit', pr, '--remove-label', config.heldLabel);
  if (!label.ok)
    return {
      held: true,
      released: false,
      problems: [`the ${config.heldLabel} label could not be removed: ${label.stderr.trim()}`],
    };
  appendRow(config, { pr, stage, event: `${RELEASED}: ${reason}`, counts, link });
  return { held: true, released: true, problems: [] };
}

/**
 * The two lists, compared. Exit non-zero on any disagreement, naming both
 * directions: a held pull request missing from the table is a runner that
 * stopped without saying so, and a row with no label is a hold nobody on
 * GitHub can see. A hold whose comment was never posted is a hold the owner
 * was never told the reason for, so it is a disagreement too.
 */
export function checkAgreement(config) {
  const fromGitHub = heldOnGitHub(config);
  if (fromGitHub.error) return { ok: false, problems: [fromGitHub.error] };
  const open = openPullRequests(config);
  if (open.error) return { ok: false, problems: [open.error] };
  const holds = holdsInStatus(config);
  const fromStatus = new Set([...holds.keys()].filter((pr) => open.open.has(pr)));
  const problems = [];
  for (const pr of fromStatus) {
    if (!fromGitHub.held.has(pr)) problems.push(`status says #${pr} is held; the label does not`);
    if (holds.get(pr).commentOwed)
      problems.push(`status says #${pr} is held; its hold comment was never posted`);
  }
  for (const pr of fromGitHub.held)
    if (!fromStatus.has(pr)) problems.push(`#${pr} carries the label; the status table does not`);
  return { ok: problems.length === 0, problems, counted: fromStatus.size };
}
