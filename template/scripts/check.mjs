// SPDX-License-Identifier: AGPL-3.0-only
// `pnpm check`: every blocking gate, in the order that fails cheapest first.
//
// It runs the scripts through the same pnpm that is running this file rather
// than through whatever `pnpm` resolves to on PATH, because under corepack
// there may be no pnpm on PATH at all. That is the whole reason this is a
// script and not a chain of `&&` in package.json.
//
// The order matters. The contamination gate's self-test comes before its
// sweep, because a blind gate that has stopped working looks exactly like a
// clean repository.

import { spawnSync } from 'node:child_process';
import { observeRun, recordRun } from './check-summary.mjs';
import { isMainModule, packageManager } from './main-module.mjs';

// Exported because `check:steps` and `check:steps:cases` read it: one list of
// blocking gates, in one place.
export const STEPS = [
  ['brand:check', 'product name headings'],
  ['brand:cases', 'the actual product name CLI'],
  ['typecheck', 'types'],
  ['lint', 'lint'],
  ['format:check', 'format'],
  ['check:cases', 'the check runner reports its own timings'],
  ['main:module:cases', 'the main-module guard refuses a path it cannot resolve'],
  ['gate:selftest', 'the gate proves itself'],
  ['gate:cases', 'the gate catches what it must'],
  ['gate:hooks', 'the hook handles every exit code'],
  ['commits:cases', 'commit messages and provenance'],
  ['provenance:cases', 'the actual commit message hook'],
  ['candidate:cases', 'candidate snapshots and public-content cases'],
  ['changed-files:cases', 'changed-file list normalisation'],
  ['check:contexts:cases', 'required-check context manifest validation'],
  ['check:contexts', 'the required check contexts are recorded'],
  ['check:steps:cases', 'the check-step reference gate'],
  ['check:steps', 'every check step resolves to a package script'],
  ['dup:check', 'the duplicate gate proves itself, then refuses copied code'],
  ['deps:check', 'the dependency gate proves itself, then refuses a stray package'],
  ['public:history:cases', 'public policy on outgoing history and metadata'],
  ['size:cases', 'the size gate and its waivers'],
  ['review:cases', 'review evidence binds to a revision'],
  ['acceptance:cases', 'the acceptance check refuses what it must'],
  ['acceptance:base:cases', "the plan's tests run under the runner's own configuration"],
  ['plan:check:cases', 'the plan check refuses what it must'],
  ['fence:closer:cases', 'a fenced example stays fenced; the cases catch a wider closer'],
  ['plan:check', 'the worked plan still states, tests and sizes itself'],
  ['runner:cases', 'the runner stops where it must'],
  ['surface:cases', 'the sensitive surface list is what ADR 0046 says'],
  ['release:ref:cases', 'release branch reference validation'],
  ['session:cases', 'the session check reads a scope correctly'],
  ['text:policy:cases', 'owned text-file policy rejection cases'],
  ['text:policy', 'owned text files stay portable'],
  ['presets:cases', 'the preset boundary check proves itself'],
  ['presets', 'every preset is data'],
  ['pins', 'actions pinned and recorded'],
  ['jobs:timeouts:cases', 'the job timeout check proves itself'],
  ['jobs:timeouts', 'every workflow job declares a timeout'],
  ['skills:refs', 'every skill reference resolves'],
  ['docs:links:cases', 'the documentation link checker proves itself'],
  ['docs:links', 'every documentation link resolves'],
  ['adr:index:cases', 'the ADR index checker proves itself'],
  ['adr:index', 'every architecture decision record is indexed'],
  ['inventory:fresh', 'the inventory matches the tree'],
  ['merge:policy', 'nothing merges itself'],
  ['node:policy:cases', 'Node policy rejection cases'],
  ['node:policy', 'one Node major across local and hosted checks'],
  ['gate', 'the gate sweeps'],
  ['licences:cases', 'the licence checker refuses what it must'],
  ['licences', 'licence compatibility'],
  ['spdx:cases', 'source licence header rejection cases'],
  ['spdx', 'source licence headers'],
  ['test', 'tests'],
  ['build', 'build'],
];

/**
 * A step's wall time, for a person reading a summary rather than a profile.
 * Whole seconds above a second: a step that took 1.5 seconds took about two
 * seconds, and the extra digit says nothing a reader can act on.
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const { command, prefix } = packageManager();

// The summary is what anybody actually reads, so the time each step took goes
// in it. `pnpm check` is the command this repository asks a person to run
// before every commit, and when it gets slow the only question worth asking
// is which step got slow. Timing it costs two calls to Date.now().
export function run() {
  // What the tree was before the first step, so a commit or an edit made and
  // undone during the run cannot leave a record of bytes nobody checked.
  const before = observeRun();
  const results = [];
  // Sampled after every step, not only at the end: Sol's review of 6f05686
  // found an edit and a restore leaving identical snapshots either side of a
  // whole run, and of 1c306f0 that a tree already unclean hid one behind the
  // clean flag, so every byte beyond the head is compared. A change made and
  // undone inside one step is still invisible, and check-summary.mjs says so.
  // A tree Git cannot observe, or with an untracked path it cannot read,
  // runs nothing.
  let changed = false;
  let last = before;

  for (const [script, label] of before.observed ? STEPS : []) {
    console.log(`\n=== ${label} (pnpm run ${script}) ===`);
    const started = Date.now();
    const step = spawnSync(command, [...prefix, 'run', script], { stdio: 'inherit' });
    results.push({ script, label, ok: step.status === 0, ms: Date.now() - started });
    const now = observeRun();
    last = now;
    const moved = now.head !== before.head || now.clean !== before.clean;
    if (moved || now.tree !== before.tree) changed = true;
    if (step.status !== 0 || !now.observed) break;
  }

  const total = results.reduce((sum, r) => sum + r.ms, 0);
  const width = Math.max(...results.map((r) => `${r.label} (${r.script})`.length));

  console.log('\n=== summary ===');
  for (const { script, label, ok, ms } of results) {
    const name = `${label} (${script})`;
    console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(width)}  ${formatDuration(ms)}`);
  }
  console.log(`      ${'total'.padEnd(width)}  ${formatDuration(total)}`);

  const summary = recordRun({
    results,
    expected: STEPS.length,
    started: changed ? { ...before, clean: false } : before,
  });
  return verdict({ results, summary, before, changed, last });
}

/**
 * The exit status, from the steps and the record. Sol's review of CF-10 found
 * the record refusing a run that the runner still called green. A tree that
 * changed under the run, a tree Git could not observe, or a clean start the
 * record will not call green, fails it. A run that starts on uncommitted work
 * passes its steps on that work, which is what a person runs before
 * committing, but it is never a green record.
 */
function verdict({ results, summary, before, changed, last }) {
  const refused = refusal({ results, summary, before, changed, last });
  if (refused !== null) {
    console.error(refused);
    return 1;
  }
  // A tool cache or virtual environment (pytest, ruff, mypy, a Python 3.13+
  // venv) writes a rule file into its own folder, and committing changes
  // nothing, so the record says what does.
  if (!summary.green) {
    console.log(
      before.rule
        ? `\ncheck: ${summary.steps} step(s) pass, but ${before.rule} is a rule file no commit ` +
            'carries, which can hide files. That is not a green record: remove it, or ' +
            'move the tool cache or virtual environment that wrote it outside the ' +
            'repository, then run it again.'
        : `\ncheck: ${summary.steps} step(s) pass on uncommitted changes. That is not ` +
            'a green record: commit, then run it again.',
    );
    return 0;
  }
  console.log(`\ncheck: green. ${summary.steps} step(s), all pass.`);
  return 0;
}

/**
 * Why the run fails, or null when it passes. The reasons are tried in order
 * and the first that holds is the message: on a tree Git observed, a failed
 * step, then a tree that changed under the steps; otherwise, what kept Git
 * from observing the tree.
 */
function refusal({ results, summary, before, changed, last }) {
  const { observed, unread, nested, warning } = last;
  const failed = results.find((r) => !r.ok);
  if (!failed && !changed && observed && !(before.clean && !summary.green)) return null;
  if (observed && failed)
    return (
      `\ncheck: failed at ${failed.script}. Nothing after it ran. ` +
      `${summary.passed} of ${STEPS.length} step(s) passed.`
    );
  if (observed)
    return (
      '\ncheck: refused. The tree changed while the steps ran (a commit, or an ' +
      'edit made and restored), so no single tree passed them all.'
    );
  if (unread)
    return (
      `\ncheck: refused. ${unread} is untracked and cannot be read (a nested ` +
      'repository, or a file nobody may read), so nothing can say which bytes ' +
      'the steps checked. Commit or remove it.'
    );
  if (nested)
    return (
      `\ncheck: refused. ${nested} is a nested repository, whose own exclude ` +
      'file, ignore rules and index can hide its bytes from this one. Make it ' +
      'a plain folder or remove it.'
    );
  if (warning)
    return (
      `\ncheck: refused. git warned "${warning}", so it left something out of ` +
      'the tree and nothing can say which bytes the steps checked.'
    );
  return (
    '\ncheck: refused. git could not observe the tree (no head commit, or no ' +
    'status), so nothing can say which bytes the steps checked.'
  );
}

if (isMainModule(import.meta.url)) {
  process.exit(run());
}
