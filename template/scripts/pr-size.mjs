// SPDX-License-Identifier: AGPL-3.0-only
// The pull request size gate.
//
// Warn at 800 hand-written lines, block above 1,000: the figures in the method's
// "Pull request size". The file-count figures (warn at 30, block above 40) and
// the per-file cap of 400 are this template's own, set in CONTRIBUTING.md.
//
// Hand-written means product lines: lines a person added to a file outside
// `tests/`. The method sizes a pull request by its product code and lets the
// tests ride along, so test lines print and are not counted: the owner's
// ruling ORCH71-PRSIZE, after Sol's CF-09 second round refused 800 product
// lines for their 300 test lines. Two more things sit outside the count, and
// both are round two's evidence. The plan commit is under `tests/acceptance/` and it is
// written by the planning session, not by the builder whose pull request is
// being measured: five of six pull requests needed a waiver written by hand at
// open for carrying their own plan. And a deletion is not a thing a reviewer
// holds in their head the way an addition is; a cut that halves a file reads
// faster than the file did. Both figures print, because the one that is not
// gating is still worth seeing.
//
// Lines are not the only way a pull request gets past a reviewer. Forty files
// of five lines each is two hundred changed lines and forty context switches,
// and the second number is the one that decides whether anybody reads the
// last file. So there is a second ceiling on the file count: a warning from
// thirty changed files, and at most forty. The waivers lift it for the same
// reasons they lift the line total, because a rename across a package is
// exactly the mechanical change the label exists for.
//
// Two waivers, each a label, each needing a reason written on the pull
// request. Two anti-gaming rules come with them: a per-file cap, and the
// requirement that a split names the invariant test that only passes once
// every part has landed. The second one is a human check at merge; this
// script does the first.
//
// The rule is written for people in CONTRIBUTING.md. This file must agree
// with it.
//
// Inform-only is the owner's ruling of 26 October 2026 (#307): over a limit,
// the gate says which limit and passes. A merge gate changes in shadow first,
// so `shadow` is the default: the blocking result above still decides, and a
// `pr-size: SHADOW block=<0|1> inform=0 over=<limits|none>` line beside it says
// what inform-only would have done. `PR_SIZE_MODE=inform` switches inform-only
// on; the flip makes it the default once ten pull requests of SHADOW lines
// agree.

import { execFileSync, spawnSync } from 'node:child_process';
import { keepOnlyLocalGitEnv } from './local-git-env.mjs';
import { exitWith, isMainModule } from './main-module.mjs';
import { CEILING as BLOCK_AT } from './plan-check.mjs';

const WARN_AT = 800;
const PER_FILE_CAP = 400;
const FILE_WARN_AT = 30;
const FILE_CAP = 40;

// The plan commit's directory. Shape A puts `plan.md` and the plan's failing
// tests here, in the first commit on the branch, and nothing else may go in
// it.
const PLAN_DIR = /^tests\/acceptance\//u;
// The one test path the gate can name exactly. A test file elsewhere counts.
const TESTS = /^tests\//u;

const MODES = ['shadow', 'inform'];
const DEFAULT_MODE = 'shadow';

const MECHANICAL_LABEL = 'size-waiver-mechanical';
const COHERENCE_LABEL = 'size-waiver-coherence';

// Files a human did not hand-write. They still count towards the total,
// because a reviewer still has to look at the pull request, but they do not
// trip the per-file cap.
const GENERATED = [
  /(^|\/)pnpm-lock\.yaml$/u,
  /(^|\/)package-lock\.json$/u,
  /(^|\/)yarn\.lock$/u,
  /(^|\/)LICENSE$/u,
  /\.snap$/u,
  /(^|\/)dist\//u,
  /\.generated\.[a-z]+$/u,
];

/**
 * The gate's reading of one change: its figures, the warnings and failures
 * in the order the gate prints them, and `over`, one entry per failure naming
 * its limit, which is what inform-only reports. `numstat` is the output of
 * `git diff --numstat -z` over the range, `labels` the pull request's label
 * names. Reads nothing else and prints nothing, so a case can ask it
 * directly; the command below resolves the range and prints the report.
 */
export function sizeReport({ numstat, labels }) {
  const files = [];
  let total = 0;
  let handWritten = 0;
  let tests = 0;

  // One record per file: `added\tdeleted\tpath`, or, for a rename or a copy,
  // `added\tdeleted\t` with the old and new paths as the next two fields. The
  // new path is the one to measure, because it is the path at the head.
  const fields = numstat.split('\0');
  for (let i = 0; i < fields.length; i += 1) {
    const record = fields[i];
    if (record === '') continue;
    // Two tabs end the counts; a tab after them belongs to the path.
    const [addedRaw, deletedRaw, ...named] = record.split('\t');
    let path = named.join('\t');
    if (path === '') {
      path = fields[i + 2] ?? '';
      i += 2;
    }
    // A binary file shows as "-\t-\t<path>".
    const added = addedRaw === '-' ? 0 : Number(addedRaw);
    const deleted = deletedRaw === '-' ? 0 : Number(deletedRaw);
    const changed = added + deleted;
    // Uncounted is not uncapped: a test file still meets the per-file cap.
    const written = PLAN_DIR.test(path) ? 0 : added;
    total += changed;
    if (TESTS.test(path)) tests += written;
    else handWritten += written;
    files.push({ path, changed, written, generated: GENERATED.some((r) => r.test(path)) });
  }

  const rest = total - handWritten - tests;

  const hasMechanical = labels.includes(MECHANICAL_LABEL);
  const hasCoherence = labels.includes(COHERENCE_LABEL);
  const waived = hasMechanical || hasCoherence;

  const warnings = [];
  const failures = [];
  const over = [];

  if (handWritten > BLOCK_AT) {
    if (waived) {
      const which = hasMechanical ? MECHANICAL_LABEL : COHERENCE_LABEL;
      warnings.push(
        `This pull request is ${handWritten} hand-written lines, over the ${BLOCK_AT} line ceiling, ` +
          `and is allowed through by ${which}. The reason must be written on the pull request.`,
      );
    } else {
      failures.push(
        `${handWritten} hand-written lines is over the ${BLOCK_AT} line ceiling. Split it, or apply ` +
          `${MECHANICAL_LABEL} or ${COHERENCE_LABEL} with a reason. If you split it, name the ` +
          `invariant test that only passes once every part has landed. See CONTRIBUTING.md.`,
      );
      over.push({
        limit: 'line-ceiling',
        says: `over the line ceiling: ${handWritten} hand-written lines of ${BLOCK_AT}`,
      });
    }
  } else if (handWritten >= WARN_AT) {
    warnings.push(
      `This pull request is ${handWritten} hand-written lines. The ceiling is ${BLOCK_AT}. ` +
        'Consider splitting it.',
    );
  }

  // The file-count ceiling. A waiver lifts it, the same way it lifts the line
  // total: the change that legitimately touches fifty files is the mechanical
  // one, and it says so on the pull request.
  if (files.length > FILE_CAP) {
    if (waived) {
      const which = hasMechanical ? MECHANICAL_LABEL : COHERENCE_LABEL;
      warnings.push(
        `This pull request touches ${files.length} files, over the ${FILE_CAP} file ceiling, ` +
          `and is allowed through by ${which}. The reason must be written on the pull request.`,
      );
    } else {
      failures.push(
        `${files.length} changed files is over the ${FILE_CAP} file ceiling. Split it, or apply ` +
          `${MECHANICAL_LABEL} or ${COHERENCE_LABEL} with a reason. Forty files of five lines ` +
          'each is forty context switches, and the last one is the one nobody reads. ' +
          'See CONTRIBUTING.md.',
      );
      over.push({
        limit: 'file-ceiling',
        says: `over the file ceiling: ${files.length} changed files of ${FILE_CAP}`,
      });
    }
  } else if (files.length >= FILE_WARN_AT) {
    warnings.push(
      `This pull request touches ${files.length} files. The ceiling is ${FILE_CAP}. ` +
        'Consider splitting it.',
    );
  }

  // The per-file cap. **No label lifts it.**
  //
  // Round four found the mechanical waiver lifting this as well as the total,
  // so one label let a single unreadable file through. The two limits exist for
  // different reasons: the total is about how much a reviewer can hold in one
  // sitting, and the per-file cap is about a file nobody can read at all. A
  // genuinely generated file is caught by its pattern below without anyone
  // applying a label, which is the honest route. If a file is generated and its
  // pattern is missing, add the pattern.
  for (const file of files) {
    if (file.written <= PER_FILE_CAP) continue;
    if (file.generated) {
      warnings.push(
        `${file.path} changes ${file.changed} lines, over the per-file cap of ${PER_FILE_CAP}, ` +
          'allowed because it matches a generated-file pattern.',
      );
      continue;
    }
    failures.push(
      `${file.path} changes ${file.written} hand-written lines, over the per-file cap of ` +
        `${PER_FILE_CAP}. Splitting the pull request without splitting this file does not help ` +
        'a reviewer, and no label lifts this cap. If the file is generated, add its pattern ' +
        'to GENERATED in this script rather than labelling around it.',
    );
    over.push({
      limit: 'per-file-cap',
      says: `over the per-file cap: ${file.path} adds ${file.written} hand-written lines of ${PER_FILE_CAP}`,
    });
  }

  return { files, total, handWritten, tests, rest, warnings, failures, over };
}

const annotate = (level, message) => console.log(`::${level}::${message}`);

// Two refs on the command line, or the two variables the workflow sets, in
// that order. The hosted invocation passes no arguments and is unchanged; a
// builder runs `node scripts/pr-size.mjs --base origin/main --head HEAD` and
// gets the same arithmetic before the push. Round five is the reason: both fix
// lanes measured their own commit instead of the pull request, and one reached
// 429 hand-written lines against the 400-line ceiling of the time with nobody
// seeing it.
//
// A command line the script cannot read is a refusal, never a fallback, and
// issue 16 is the two ways it used not to be. `indexOf` took the first
// occurrence, so `--base main --base no-such-ref` measured from `main`,
// printed a figure and exited 0 without mentioning the second flag: the
// answer to a range nobody asked for, which is the failure this gate exists
// to stop. And a flag with no value returned the same empty string as a flag
// never passed, so `--head` last fell through to `HEAD_SHA` and the message
// named both flags rather than the one at fault. A reader that cannot say
// which flag it could not read sends the builder to the flag that is right.
const refuse = (message) => {
  exitWith(2, `pr-size: ${message}`);
};

// Resolved by git, never trusted as text, and `--end-of-options` so a value
// beginning with a dash is read as a revision rather than as an option. A ref
// that names nothing has to refuse here: an unresolved range would measure
// nothing and report zero hand-written lines, which is the answer that merges.
const commit = ({ value, named }) => {
  const resolved = spawnSync(
    'git',
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${value}^{commit}`],
    { encoding: 'utf8' },
  );
  if (resolved.status !== 0) {
    exitWith(2, `pr-size: ${named} does not name a commit in this repository: ${value}`);
  }
  return resolved.stdout.trim();
};

const git = (args) => execFileSync('git', args, { encoding: 'utf8' });

function main() {
  // Every position the flag occupies, skipping node and the script path. The
  // token after a flag is that flag's value and never an occurrence of its own,
  // because a revision is allowed to look like a flag: with a ref named
  // `--base`, `--base --base --head HEAD` passes the base once, and counting the
  // value as a repeat would refuse a command line the script can read. `--base`
  // as the value of `--base` is the same token twice and the reason one pass
  // over the argument list, rather than one pass per flag, is what decides this.
  const FLAGS = ['--base', '--head'];
  const scanned = (() => {
    const at = new Map(FLAGS.map((flag) => [flag, []]));
    for (let i = 2; i < process.argv.length; i += 1) {
      const token = process.argv[i];
      // A token nobody reads would be skipped, and a misspelled `--haed` then
      // left `HEAD_SHA` to choose the range.
      if (!at.has(token))
        refuse(`${JSON.stringify(token)} is not an option. Pass --base and --head only.`);
      at.get(token).push(i);
      i += 1;
    }
    return at;
  })();

  const positions = (flag) => scanned.get(flag) ?? [];

  const given = (name, variable) => {
    const flag = `--${name}`;
    const at = positions(flag);
    if (at.length > 1) {
      refuse(`${flag} is given ${at.length} times and only the first would be read. Pass it once.`);
    }
    if (at.length === 0) return { value: (process.env[variable] ?? '').trim(), named: variable };
    // The value is whatever follows, so that `--end-of-options` below can take a
    // revision beginning with a dash. Missing or empty is the malformed case: an
    // omitted flag has no position at all and is already answered above.
    const value = (process.argv[at[0] + 1] ?? '').trim();
    if (value === '') refuse(`${flag} was given no value. It takes a revision to measure.`);
    return { value, named: flag };
  };

  const from = given('base', 'BASE_SHA');
  const to = given('head', 'HEAD_SHA');
  // The JSON array the workflow writes with `toJSON`, because a label may hold a
  // comma: joined with commas, `ordinary,size-waiver-mechanical` was a waiver.
  const labels = (() => {
    if ((process.env.PR_LABELS ?? '').trim() === '') return [];
    try {
      const parsed = JSON.parse(process.env.PR_LABELS);
      if (Array.isArray(parsed) && parsed.every((l) => typeof l === 'string')) return parsed;
    } catch {}
    return refuse('PR_LABELS is not a JSON array of label names.');
  })();
  // Unset or empty is the default; anything else unknown refuses rather than
  // choosing a mode nobody named.
  const mode = (() => {
    const value = (process.env.PR_SIZE_MODE ?? '').trim();
    if (value === '') return DEFAULT_MODE;
    if (MODES.includes(value)) return value;
    return refuse(`PR_SIZE_MODE is ${JSON.stringify(value)}. It takes ${MODES.join(' or ')}.`);
  })();

  if (from.value === '' || to.value === '') {
    exitWith(2, 'pr-size: pass --base and --head, or set BASE_SHA and HEAD_SHA.');
  }

  // Every input is read by now, so the environment is cut to what Git needs and
  // no credential reaches a Git child: Sol's CF-09 fourth round.
  keepOnlyLocalGitEnv();

  const base = commit(from);
  const head = commit(to);

  // The merge base, not the base branch tip, or every commit that landed on
  // main since the branch started would be counted against the author.
  const mergeBase = git(['merge-base', base, head]).trim();
  // `-z`, because the third column of plain `--numstat` is not always a path.
  // The review of record on 58b1ba3 found two shapes that are not: a rename
  // prints the compacted `{src => tests/acceptance/50-x}/a.ts`, and a path with
  // a byte outside ASCII prints C-quoted, so both read as outside the plan
  // directory and were counted against the builder. Under `-z` git writes the
  // real bytes and gives a rename its own two fields, which is the only form
  // that has one meaning.
  const numstat = git(['diff', '--numstat', '-z', mergeBase, head]);

  const report = sizeReport({ numstat, labels });
  const { files, total, handWritten, tests, rest } = report;
  if (files.length === 0) refuse(`${base}..${head} changes no file: nothing measured is no pass.`);

  console.log(
    `pr-size: hand-written ${handWritten} of ${BLOCK_AT}; tests ${tests}, not counted; ` +
      `plan and deletions ${rest}.`,
  );
  console.log(`pr-size: ${total} changed lines across ${files.length} file(s).`);
  console.log(`pr-size: warn at ${WARN_AT}, block at ${BLOCK_AT}, per-file cap ${PER_FILE_CAP}.`);
  console.log(`pr-size: warn at ${FILE_WARN_AT} changed files, block above ${FILE_CAP}.`);
  if (labels.length > 0) console.log(`pr-size: labels: ${labels.join(', ')}`);

  for (const warning of report.warnings) annotate('warning', warning);
  const overNames = report.over.map((o) => o.limit).join(',') || 'none';
  if (mode === 'inform') {
    for (const o of report.over)
      annotate('warning', `pr-size: ${o.says}. Informs only; it blocks nothing.`);
    if (report.over.length === 0) console.log('pr-size: within the rule.');
    else console.log(`pr-size: inform-only, over ${overNames}; the check passes.`);
    return;
  }
  const blocks = report.failures.length > 0;
  if (blocks) {
    for (const failure of report.failures) annotate('error', failure);
    process.exitCode = 1;
  } else {
    console.log('pr-size: within the rule.');
  }
  // Inform-only exits 0 whatever is over, so its half of the line is fixed.
  console.log(`pr-size: SHADOW block=${blocks ? 1 : 0} inform=0 over=${overNames}`);
}

if (isMainModule(import.meta.url)) main();
