// SPDX-License-Identifier: AGPL-3.0-only
// Every number the runner obeys, read from one file.
//
// On 17 September the ceilings were prose in briefs, read by the lane that
// was also deciding whether one more round was fine, and they bounded
// nothing. Validation is strict on purpose: a config with a missing ceiling
// must not start a run, because an absent ceiling reads as no ceiling exactly
// when it matters.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { readJson } from '../main-module.mjs';
import { Refusal } from './lock.mjs';

const KINDS = ['opus', 'sol', 'copilot'];
const STAGES = ['plan', 'build', 'review', 'fix'];

// Safe integers only. Above 2^53 a whole number minus one can round back to
// itself, so a ceiling of 2^54 is spent without ever going down (Sol, CF-03).
function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// A ceiling of zero is a ceiling, and it is the one Copilot now carries: draw
// none. An absent ceiling is still no ceiling, which is the case this must
// keep refusing, so the test is on the number being there and whole rather
// than on it being above nothing.
function ceiling(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** The problems with a parsed config, as sentences. Empty means usable. */
export function validateConfig(config) {
  const problems = [];
  if (typeof config !== 'object' || config === null) return ['runner.json must be an object'];
  if (typeof config.repository !== 'string' || !config.repository.includes('/'))
    problems.push('repository must be owner/name');
  if (typeof config.reviewOfRecord?.reviewer !== 'string')
    problems.push('reviewOfRecord.reviewer must name the reviewer the review of record carries');
  if (typeof config.copilotLogin !== 'string') problems.push('copilotLogin must be a login');
  // A seat is a person's subscription, so no seat name is written down here:
  // the template takes one at run time and this file stays publishable.
  if (typeof config.launcher?.template !== 'string' || !config.launcher.template.includes('<seat>'))
    problems.push('launcher.template must be a launcher path carrying <seat>');
  if (typeof config.launcher?.model !== 'string')
    problems.push('launcher.model must be a model id');
  // A comma is two labels to GitHub, in the query and in `--add-label` alike.
  if (typeof config.heldLabel !== 'string' || config.heldLabel === '')
    problems.push('heldLabel must be the label a held pull request carries');
  else if (config.heldLabel.includes(','))
    problems.push('heldLabel must be one label, and GitHub reads a comma as two');
  for (const path of ['statusPath', 'budgetPath'])
    if (typeof config[path] !== 'string' || config[path] === '')
      problems.push(`${path} must be a path`);
  for (const stage of STAGES)
    if (!positiveInteger(config.minutes?.[stage]))
      problems.push(`minutes.${stage} must be a positive whole number of minutes`);
  for (const scope of ['perPullRequest', 'perRun'])
    for (const kind of KINDS)
      if (!ceiling(config[scope]?.[kind]))
        problems.push(`${scope}.${kind} must be a whole number of sessions, zero or more`);
  return problems;
}

/**
 * The main checkout, even when this is running inside a worktree.
 *
 * `--git-common-dir` is the main checkout's `.git` from anywhere in the
 * repository, where `--show-toplevel` is the worktree. The roadmap is a
 * sibling of the main checkout, and a relative path cannot be right from both
 * the checkout and a worktree two directories deeper: the first version of
 * this file resolved against `scripts/runner/` and pointed at
 * `scripts/<orchestration-root>`, which is how the real hold had to be run with
 * an overriding config.
 *
 * Git is handed `PATH` and `HOME` and nothing else. Only `gh` needs the
 * GitHub token, and an environment passed whole hands it to every process
 * this one starts.
 */
function checkoutRoot(fallback) {
  const env = {};
  for (const name of ['PATH', 'HOME']) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  const run = spawnSync('git', ['-C', fallback, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
    env,
  });
  if (run.status !== 0) return fallback;
  return dirname(resolve(fallback, run.stdout.trim()));
}

/**
 * Load and validate. A relative path in the file is resolved against the main
 * checkout, so a config copied into a stub repository points at that copy's
 * neighbours and not at the real roadmap, and the same config works from a
 * worktree. That checkout is the config's `root`, below which the status
 * table and the budget must be reached without a symlink. A refusal says
 * which problem, in this file's words, never the file's.
 */
export function loadConfig(file) {
  const path = resolve(file ?? process.env['RUNNER_CONFIG'] ?? 'scripts/runner/runner.json');
  // A key given twice is refused, not read as its last: a config naming
  // BusinessA and then BusinessB spent BusinessB's budget (Sol, PR 88). The
  // reader's own refusals are fixed text, so they are named.
  let parsed;
  try {
    parsed = readJson(readFileSync(path, 'utf8'));
  } catch (cause) {
    if (cause instanceof TypeError) throw new Refusal(path, `is not usable: ${cause.message}`);
    throw new Refusal(path, 'cannot be read as a JSON config');
  }
  const problems = validateConfig(parsed);
  if (problems.length > 0) throw new Refusal(path, `is not usable: ${problems.join('; ')}`);
  const root = checkoutRoot(dirname(path));
  const near = (value) => (isAbsolute(value) ? value : resolve(root, value));
  return {
    ...parsed,
    root,
    statusPath: near(parsed.statusPath),
    budgetPath: near(parsed.budgetPath),
  };
}

/** The launcher for a seat, named at run time and never checked in. */
export function launcherFor(config, seat) {
  if (typeof seat !== 'string' || seat === '') throw new Error('runner: a launch needs a seat');
  return config.launcher.template
    .replace('<seat>', seat)
    .replace('$HOME', process.env['HOME'] ?? '');
}

export { KINDS, STAGES };
