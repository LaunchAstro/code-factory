// SPDX-License-Identifier: AGPL-3.0-only
// The one place the runner talks to GitHub, and the one place a line means
// stop.
//
// Two separate questions live here, and round two of the review of record
// found them conflated.
//
// Is the request wrong? A 400, 404, 409, 410 or 422 says the client asked for
// something that does not exist or cannot be done, and asking again will not
// make it right. On 17 September a lane read a 422, wrote BLOCKER in its own
// log, and built the same thing twice anyway. That pull request is held.
//
// Is the run wrong? A 401, 403, 408, 429 or any 5xx says the token expired,
// the rate limit is spent or GitHub is unwell. Holding on those would label
// every pull request in the run and call the owner in twenty times over one
// expired token. The run stops instead, and nothing is held.

import { spawnSync } from 'node:child_process';

// Only a status code written as one: `HTTP 422`, `HTTP/2 403`, `status: 429`.
// The old predicate matched the `http` inside every URL and any number in the
// four hundreds, so `... /pull/33, 437 lines changed` held a healthy pull
// request.
const HTTP_STATUS = /\bHTTP(?:\/\d(?:\.\d)?)?\s+(\d{3})\b/iu;
const NAMED_STATUS = /\bstatus(?:\s+code)?\s*[:=]\s*(\d{3})\b/iu;

// The request is wrong. This pull request is held.
const REQUEST_WRONG = new Set([400, 404, 409, 410, 422]);
// The run is wrong. Every pull request would be held for one cause, so none is.
const RUN_WRONG = new Set([401, 403, 408, 429]);

/** The status code a line states, or 0 when it states none. `classify` is its only caller. */
function statusIn(line) {
  const found =
    typeof line === 'string' ? (HTTP_STATUS.exec(line) ?? NAMED_STATUS.exec(line)) : null;
  return found ? Number(found[1]) : 0;
}

/**
 * What this line means for the run. `blocker` holds this pull request,
 * `run` stops everything, `none` is an ordinary line.
 */
export function classify(line) {
  if (typeof line !== 'string' || line === '') return 'none';
  if (line.includes('BLOCKER')) return 'blocker';
  const status = statusIn(line);
  if (status === 0) return 'none';
  if (REQUEST_WRONG.has(status)) return 'blocker';
  if (RUN_WRONG.has(status) || status >= 500) return 'run';
  return 'none';
}

/** Run `gh` and hand back what it said. Never throws; the caller decides. */
export function gh(args) {
  const run = spawnSync('gh', args, { encoding: 'utf8' });
  const stderr = run.stderr ?? '';
  const meaning = classify(stderr);
  return {
    ok: run.status === 0,
    status: run.status,
    stdout: run.stdout ?? '',
    stderr,
    blocked: meaning === 'blocker',
    runFailed: meaning === 'run',
  };
}

/**
 * A list from the API, every page of it, each item the shape `isItem` reads.
 *
 * `gh api --paginate` writes one JSON array per page, so two pages is
 * `[...][...]` and `JSON.parse` throws on it. `--slurp` wraps the pages in one
 * array, which then has to be flattened. This repository already found that
 * bug once and fixed it at `scripts/review-of-record.mjs:147`, in a control
 * that broke exactly when there had been the most review; the first version of
 * this file reintroduced it on all three of its calls.
 *
 * Anything but an array of pages is refused, and so is any item `isItem`
 * rejects. Checking only the outer array let a review with no body count as
 * no review and an open pull request with no number read as closed (Sol,
 * CF-03): a list the runner cannot read is not an empty one.
 */
export function ghList(args, isItem) {
  const result = gh([...args, '--paginate', '--slurp']);
  if (!result.ok) return { ...result, json: undefined };
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ...result, ok: false, json: undefined, stderr: 'gh: unreadable JSON' };
  }
  // No page at all is not an empty list, which is one empty page, `[[]]`: gh
  // read nothing, so the run stops (Sol, CF-03-FIX2).
  if (Array.isArray(parsed) && parsed.length === 0)
    return { ...result, ok: false, json: undefined, runFailed: true, stderr: 'gh: no page at all' };
  if (!Array.isArray(parsed) || !parsed.every((page) => Array.isArray(page)))
    return { ...result, ok: false, json: undefined, stderr: 'gh: not a list of pages' };
  const json = parsed.flat();
  if (!json.every((item) => isItem(item)))
    return {
      ...result,
      ok: false,
      json: undefined,
      stderr: 'gh: an item in the list has the wrong shape',
    };
  return { ...result, json };
}

/** A plain object, which every item GitHub lists is. */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A number GitHub gives a pull request: whole, from 1. Zero and below are not closed, they are wrong. */
export const isPullNumber = (value) => Number.isSafeInteger(value) && value > 0;

/**
 * An API path under the configured repository. Each part of the name is
 * encoded, so text from the config is a name in the path and never more path
 * or a query of its own (Sol, CF-03-FIX1).
 */
export const repoPath = (config, rest) =>
  `repos/${config.repository
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}/${rest}`;
