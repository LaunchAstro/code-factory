#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// The runner's command line. Each subcommand is one decision, and its exit
// code is the decision: a caller that ignores the code is the caller the
// ceilings exist to stop, so nothing here is advisory.
//
// The stages that launch models sit on top of this and are the second pull
// request. Everything below is the part that refuses.

import { existsSync } from 'node:fs';
import { isMainModule, refuse } from '../main-module.mjs';
import { EXIT, beginRun, countOnPullRequest, launched, mayLaunch, spend } from './ceilings.mjs';
import { KINDS, loadConfig } from './config.mjs';
import { classify } from './gh.mjs';
import { Refusal, assertPlain, withLock } from './lock.mjs';
import {
  COMMENT_POSTED,
  HELD,
  PR_NUMBER,
  RELEASED,
  appendRow,
  checkAgreement,
  heldInStatus,
  heldOnGitHub,
  hold,
  readRows,
  release,
  startTable,
} from './status.mjs';

const USAGE = `usage: runner.mjs <command> [options]

  count   --pr N                        what this pull request has already drawn
  may     --pr N --kind opus|sol|copilot may it draw one more (exit 3 at the ceiling or
                                        when the table or the held label says held)
  begin                                 start a run: the budget goes back to the ceilings
                                        (refused while the status table is missing)
  begin --new-history --reason R        a machine's first run: start the status table
                                        with R as its first row (refused once a run has
                                        begun here, and over any table)
  spend   --kind opus|sol|copilot        take one from the run budget (exit 4 when out,
                                        refused before begin)
  row     --pr N --stage S --event E     append one row to the status table
  hold    --pr N --reason R [--reviews ID,ID]
                                        label, comment and row, together
  blocker --pr N --line L                hold when the line means stop (exit 7 when it
                                        means the run is wrong)
  release --pr N --reason R              take the label off, then write the row
  status  --check                        the table and the label must agree

  --config PATH overrides scripts/runner/runner.json, as does RUNNER_CONFIG.

  The status table and the budget are refused when either is a symlink, sits
  under one below the config's root, or has a second hard link. A table is
  the repository's its first row names, and refused under any other.`;

function options(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) parsed[arg.slice(2)] = true;
      else {
        parsed[arg.slice(2)] = next;
        i += 1;
      }
    } else parsed._.push(arg);
  }
  return parsed;
}

function say(code, message) {
  if (code === EXIT.ok) console.log(`runner: ${message}`);
  else console.error(`runner: ${message}`);
  return code;
}

/**
 * A pull request number, or nothing. Round two found `--pr` omitted reaching
 * GitHub as the string `undefined`, coming back 404, and holding a pull
 * request called `undefined` with a permanent row in the status file. One
 * spelling only: holds and launch rows are keyed by it, so `012` was a fresh
 * count for #12 (security review, 065a3a3).
 */
function pullRequest(value) {
  const typed = String(value ?? '');
  return PR_NUMBER.test(typed) && Number.isSafeInteger(Number(typed)) ? typed : null;
}

/** A value the caller has to give, or nothing: a bare flag is not a value. */
function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * A failed read is not an unknown count. A 4xx that means the request is
 * wrong holds this pull request; a 401, 403, 429 or 5xx means the token, the
 * rate limit or GitHub, and holding on that would label every pull request in
 * the run for one cause, so the run stops instead.
 */
function counted(config, pr, stage) {
  const read = countOnPullRequest(config, pr);
  if (read.error === undefined) return read;
  if (read.runFailed)
    return { exit: say(EXIT.runFailed, `the run stops, nothing held: ${read.error}`) };
  if (read.blocked) {
    reportHold(hold(config, { pr, stage, reason: `BLOCKER: ${read.error}` }));
    return { exit: say(EXIT.perPullRequestCeiling, `#${pr} held on a blocker: ${read.error}`) };
  }
  throw new Error(read.error);
}

/** The counts and review ids for a hold, best effort: a hold is not worth failing over them. */
function bestEffortCounts(config, pr) {
  const read = countOnPullRequest(config, pr);
  return read.error === undefined ? read : { counts: undefined, reviewIds: [] };
}

// The events the counts and the hold are read from. A caller who could type
// one could release a held pull request without touching its label.
const RESERVED = [HELD, RELEASED, COMMENT_POSTED, ...KINDS.map((kind) => launched(kind))];

/** Whatever the hold could not record on GitHub, said out loud. */
function reportHold(result) {
  for (const problem of result.problems ?? []) console.error(`runner: ${problem}`);
  return result;
}

// One handler per decision, so adding a stage cannot quietly widen the one
// function that decides everything.
const COMMANDS = {
  count(config, opts) {
    const { pr, stage } = opts;
    const read = counted(config, pr, stage);
    if (read.exit !== undefined) return read.exit;
    const { opus, sol, copilot } = read.counts;
    return say(EXIT.ok, `#${pr}: opus ${opus}, sol ${sol}, copilot ${copilot}`);
  },

  may(config, opts) {
    const { pr, stage } = opts;
    // A mistyped or missing kind is the caller's error, not the pull
    // request's. Holding on it would take a live pull request out of the run
    // over a flag, and a hold is not taken back.
    if (!KINDS.includes(opts['kind'])) return say(EXIT.usage, `unknown kind ${opts['kind']}`);
    // A held pull request draws no further session of any kind, and the
    // refusal reads nothing from GitHub and writes nothing.
    if (heldInStatus(config).has(pr))
      return say(EXIT.perPullRequestCeiling, `#${pr} is held; nothing further runs against it`);
    // The label is the other half: an owner's hand, or a hold this table never
    // saw. A list that cannot be read is the run's problem, not this pull request's.
    const labelled = heldOnGitHub(config);
    if (labelled.error !== undefined)
      return say(EXIT.runFailed, `the run stops, nothing held: ${labelled.error}`);
    if (labelled.held.has(pr))
      return say(
        EXIT.perPullRequestCeiling,
        `#${pr} carries the ${config.heldLabel} label; nothing further runs against it`,
      );
    const read = counted(config, pr, stage);
    if (read.exit !== undefined) return read.exit;
    const { counts, reviewIds } = read;
    const verdict = mayLaunch(config, opts['kind'], counts);
    if (!verdict.allowed) {
      reportHold(hold(config, { pr, stage, reason: verdict.reason, reviewIds, counts }));
      return say(verdict.exit, `#${pr} held: ${verdict.reason}`);
    }
    // Recorded before the session starts, for every kind, because the row is
    // the only count that sees a session which produced nothing.
    appendRow(config, {
      pr,
      stage,
      event: `${launched(opts['kind'])} (${verdict.reason})`,
      counts,
    });
    return say(EXIT.ok, `#${pr}: ${verdict.reason}`);
  },

  // A refill over a missing table is a run that forgot its launches, so plain
  // `begin` needs the table, as every command does, and a new one is a
  // person's decision with a reason, on a machine where no run has begun
  // (security review, 828d63a).
  begin(config, opts) {
    let started = '';
    if (opts['new-history'] !== undefined) {
      const reason = text(opts['reason']);
      if (reason === null)
        return say(EXIT.usage, 'begin --new-history needs --reason <why there is no history>');
      if (existsSync(config.budgetPath))
        return say(
          EXIT.failed,
          `a run has begun on this machine (${config.budgetPath} exists), so its history is not started again; restore the status table at ${config.statusPath}`,
        );
      if (!startTable(config, reason))
        return say(
          EXIT.failed,
          `a status table exists at ${config.statusPath}; a new history never replaces one`,
        );
      started = `; status table started at ${config.statusPath}: ${reason}`;
    }
    const budget = beginRun(config);
    return say(
      EXIT.ok,
      `run begun: opus ${budget.opus}, sol ${budget.sol}, copilot ${budget.copilot}${started}`,
    );
  },

  spend(config, opts) {
    const result = spend(config, opts['kind']);
    return say(result.exit, result.reason);
  },

  row(config, opts) {
    const { pr, stage } = opts;
    // The counts column is read off the pull request, not typed by the
    // caller: a row whose tally is whatever the caller remembered is the
    // status table nobody can trust.
    const event = text(opts['event']);
    if (event === null) return say(EXIT.usage, 'row needs --event <what happened>');
    if (RESERVED.some((prefix) => event.trim().startsWith(prefix)))
      return say(
        EXIT.usage,
        `row cannot write a ${event.trim().split(/[ :(]/u)[0]} event; the runner writes those`,
      );
    const read = counted(config, pr, stage);
    if (read.exit !== undefined) return read.exit;
    appendRow(config, { pr, stage, event, link: opts['link'], counts: read.counts });
    return say(EXIT.ok, `#${pr}: ${event}`);
  },

  hold(config, opts) {
    const { pr, stage } = opts;
    const reason = text(opts['reason']);
    if (reason === null) return say(EXIT.usage, 'hold needs --reason <why>');
    const { counts, reviewIds } = bestEffortCounts(config, pr);
    const reviews = typeof opts['reviews'] === 'string' ? opts['reviews'].split(',') : reviewIds;
    const result = reportHold(hold(config, { pr, stage, reason, reviewIds: reviews, counts }));
    // A retry GitHub still refused has not recorded the hold, and the exit
    // says so (Sol, CF-03-FIX1).
    if (result.already && !result.ok)
      return say(EXIT.failed, `#${pr} is held, and GitHub has still not recorded it`);
    if (result.already)
      return say(EXIT.ok, `#${pr} is already held; nothing further runs against it`);
    return say(EXIT.perPullRequestCeiling, `#${pr} held: ${reason}`);
  },

  blocker(config, opts) {
    const { pr, stage } = opts;
    // No line is no evidence, and no evidence is not an all-clear.
    const line = text(opts['line']);
    if (line === null) return say(EXIT.usage, 'blocker needs --line <the line>');
    const meaning = classify(line);
    if (meaning === 'run') return say(EXIT.runFailed, `the run stops, nothing held: ${line}`);
    if (meaning !== 'blocker') return say(EXIT.ok, `#${pr}: nothing in that line stops the run`);
    // Not `BLOCKER: BLOCKER: ...`: the line usually says it already, and the
    // reason is what the owner reads in the hold comment.
    const reason = line.includes('BLOCKER') ? line : `BLOCKER: ${line}`;
    const { counts, reviewIds } = bestEffortCounts(config, pr);
    reportHold(hold(config, { pr, stage, reason, reviewIds, counts }));
    return say(EXIT.perPullRequestCeiling, `#${pr} held on a blocker: ${line}`);
  },

  release(config, opts) {
    const { pr, stage } = opts;
    const reason = text(opts['reason']);
    if (reason === null) return say(EXIT.usage, 'release needs --reason <the decision>');
    const { counts } = bestEffortCounts(config, pr);
    const result = reportHold(release(config, { pr, stage, reason, counts }));
    if (!result.held) return say(EXIT.ok, `#${pr} is not held; nothing to release`);
    if (!result.released) return say(EXIT.failed, `#${pr} is still held`);
    return say(EXIT.ok, `#${pr} released: ${reason}`);
  },

  status(config, opts) {
    if (!opts['check']) return say(EXIT.usage, 'status takes --check');
    const agreement = checkAgreement(config);
    if (agreement.ok)
      return say(
        EXIT.ok,
        `the status table and the ${config.heldLabel} label agree, ${agreement.counted} held`,
      );
    for (const problem of agreement.problems) console.error(`runner: ${problem}`);
    return EXIT.disagreement;
  },
};

export function main(argv) {
  const opts = options(argv);
  const command = opts._[0];
  if (command === undefined || opts['help']) {
    console.log(USAGE);
    return command === undefined ? EXIT.usage : EXIT.ok;
  }
  const handler = COMMANDS[command];
  if (handler === undefined) {
    console.error(USAGE);
    return say(EXIT.usage, `unknown command ${command}`);
  }
  const config = loadConfig(typeof opts['config'] === 'string' ? opts['config'] : undefined);
  opts.stage = typeof opts['stage'] === 'string' ? opts['stage'] : command;
  if (command !== 'begin' && command !== 'spend' && command !== 'status') {
    const pr = pullRequest(opts['pr']);
    if (pr === null) return say(EXIT.usage, `${command} needs --pr <number>`);
    opts.pr = pr;
  }
  // Checked before anything is fetched, locked or written: each file has one
  // name, so its lock is the only lock on it, and the table is readable and
  // this repository's (Sol, CF-03-FIX2). Only a new history has no table yet.
  for (const path of [config.statusPath, config.budgetPath]) assertPlain(config.root, path);
  if (command !== 'begin' || opts['new-history'] === undefined)
    withLock(config.root, config.statusPath, () => readRows(config));
  // Every command reads its file, and most then write it, so each holds that
  // file's lock from before the read to after the write. Two `may` calls that
  // both counted one launch both took the second (Sol, CF-03).
  const file = command === 'begin' || command === 'spend' ? config.budgetPath : config.statusPath;
  return withLock(config.root, file, () => handler(config, opts));
}

// The shared guard, not a rule of this file's own. Comparing names let a
// symlink called `review-gate.mjs` skip `main` (Sol, CF-03), and the copy that
// replaced it answered false where the shared guard throws, so an entry link
// removed after loading exited 0 with nothing decided (Sol, CF-03-FIX1).
if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    // A refusal this runner wrote names its file and why. Any other message
    // came from below it, a parser, the file system or gh, and can quote what
    // was read, so it is not printed (CF-08-F3).
    if (error instanceof Refusal) refuse('runner', error.file, error.reason, EXIT.failed);
    refuse(
      'runner',
      'runner.mjs',
      'stopped on an error whose message can quote what was read, so it is not printed',
      EXIT.failed,
    );
  }
}
