// SPDX-License-Identifier: AGPL-3.0-only
// Review evidence, bound to the revision being merged.
//
// ADR 0046: the owner merges only what the machine has already proven, and the
// required checks include a code-review evidence check. This is it, and it now
// has one rule.
//
// The cross-vendor review of record for this head says what it says. GitHub
// records a review posted from the author's own account as COMMENTED, so the
// state carries no verdict and the body does; `review-of-record.mjs` reads it,
// refuses anything that is not a review of that exact head, and takes the
// strictest verdict on it.
//
// What used to be here, and why it is not. Three further rules read English
// the builder typed: a pasted checkpoint block, a `Code review:` line citing
// the review, a security-review line, and a step count inside the block. Round
// 1 passed the typed line as a stale positive on all twelve pull requests.
// Round 2 read the verdict off the review instead and was then red on every
// head for three reasons, of which only this one was about the code: the block
// had not been refreshed and its count belonged to an earlier run. Eleven
// rounds on pull request 17 established that no rule over English is sound in
// both directions at once, and both builder-run security passes were
// fail-open. So the typed evidence goes, and what stays is what a machine
// wrote: this verdict, and the acceptance check that proves the tests came
// first. The security question is now asked of the reviewer when the diff
// touches the surface `scripts/sensitive-paths.mjs` lists.
//
// It reads HEAD_SHA and the reviews (REVIEWS_FILE, a path to the JSON the API
// returns, or REVIEWS, the JSON itself) so the same code runs in continuous
// integration and in its own tests. It reads nothing from the pull request
// body.

import { readFileSync } from 'node:fs';
import { exitWith } from './main-module.mjs';
import { FULL_SHA, reviewOfRecord } from './review-of-record.mjs';

const head = (process.env['HEAD_SHA'] ?? '').trim();

// A full commit, or a usage error. Sol's review of 69afe53 found `1`
// accepted, which is a prefix of every head that starts with it. One rule,
// the library's: its review of 8e3681d found two copies of it.
if (!FULL_SHA.test(head.toLowerCase())) {
  exitWith(2, 'review-evidence: HEAD_SHA must be set to a full 40-character commit SHA.');
}

// The reviews arrive as the API returns them. An absent source is a refusal,
// not a pass: a control nothing calls is the defect this rehearsal found
// twice, and a check that goes quiet when its input disappears is the same
// shape as a green tick over nothing.
const reviewsSource = () => {
  const file = process.env['REVIEWS_FILE'];
  if (file !== undefined && file !== '') return readFileSync(file, 'utf8');
  return process.env['REVIEWS'];
};

const fail = (problem) =>
  exitWith(
    1,
    `\nreview-evidence: 1 problem\n`,
    `  ${problem}\n`,
    'review-evidence: this check is what makes "nothing merges without green\n' +
      'review-evidence: checks" true rather than said. It is not a formality.',
  );

const raw = reviewsSource();
if (raw === undefined) {
  fail(
    'the reviews of this pull request could not be read, so the review of\n' +
      '        record could not be found. REVIEWS_FILE or REVIEWS must be set. A\n' +
      '        check that cannot see its evidence refuses; it does not pass.',
  );
}

const record = reviewOfRecord(raw, head);
if (record.problem !== undefined) fail(record.problem);

const review = record.review;
console.log(`review-evidence: the review of record is ${review.id}, verdict ${review.verdict}.`);
console.log(`review-evidence: posted by ${review.reviewer}.`);
console.log('review-evidence: the review covers this exact revision.');
