// SPDX-License-Identifier: AGPL-3.0-only
// Which files in this pull request made a security review necessary.
//
// Ticket 52 moved the security question from a line typed on the pull request
// body to the reviewer of record, which is handed the surface when there is
// one. Nothing refuses over it now, and nothing should: both builder-run
// security passes of round 1 were fail-open, which is what a rule over typed
// English buys.
//
// So this names the files, in the job summary and in the log, where the
// reviewer and anybody reading the run can see them before anything goes
// wrong. It reports; it never fails.
//
// It reads BASE_SHA and HEAD_SHA, the way pr-size.mjs does.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

import { exitWith } from './main-module.mjs';
import { sensitiveFiles } from './sensitive-paths.mjs';

const base = process.env['BASE_SHA'];
const head = process.env['HEAD_SHA'];

if (!base || !head) {
  exitWith(2, 'sensitive-surface: BASE_SHA and HEAD_SHA must both be set.');
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' });

// The merge base, not the base branch tip: everything that landed on main
// since this branch started belongs to somebody else's pull request.
const mergeBase = git(['merge-base', base, head]).trim();
// NUL-separated, so Git quotes nothing: Sol's review of 69afe53 found
// `scripts/gate/café.py` arriving in quotes and matching no pattern. Without
// rename detection, so a file moved off the surface is listed by the path it
// left: the same review found a hook moved out of `.husky/` reported as
// nothing sensitive.
const changed = git(['diff', '--name-only', '-z', '--no-renames', `${mergeBase}...${head}`])
  .split('\0')
  .filter(Boolean);

const sensitive = sensitiveFiles(changed);

const lines =
  sensitive.length === 0
    ? [
        '### Sensitive surface',
        '',
        'This pull request touches none of the paths ADR 0046 names, so no',
        'security question is put to the reviewer of record.',
      ]
    : [
        '### Sensitive surface',
        '',
        `${sensitive.length} of ${changed.length} changed file(s) are on the surface ADR 0046`,
        'names, so the reviewer of record is asked the security question about:',
        '',
        ...sensitive.map((f) => `- \`${f}\``),
      ];

const report = `${lines.join('\n')}\n`;
console.log(report);

const summary = process.env['GITHUB_STEP_SUMMARY'];
if (summary) appendFileSync(summary, report);
