// SPDX-License-Identifier: AGPL-3.0-only
// The acceptance check: the plan's tests were red before the code and are
// green after it.
//
// Neither this repository nor the product one made anyone write a test first.
// The prose asks for it in four places and nothing read it, so the night of
// 17 September merged control code whose only proof was a sentence in a body.
// This check reads git and vitest instead of English. Shape A, the plan
// commit first:
//
// 1. The first commit on the branch touches only tests/acceptance/<ticket>/.
// 2. That directory holds at least one test file at that commit.
// 3. The pull request's ticket number is the directory's number.
// 4. The plan's tests are byte-identical at the head: the builder may add
//    tests elsewhere, it may not edit the ones it is being measured against.
// 5. A plan.md this branch brings carries the standing criterion, and a change
//    outside the exemption brings one: it runs either side of the exemption.
// 6. vitest exits non-zero at the plan commit. A test green before the code
//    exists tests nothing, and no reviewer reliably notices that.
// 7. vitest exits zero at the head.
//
// Both runs use the runner's own vitest configuration, not the tree's: the plan
// commit may touch only its own directory, so every configuration file on the
// branch is the builder's, and a builder who writes the configuration decides
// what green means (issue 30). It has no setup, global setup or plugin, so
// product source runs only where the plan's tests import it. And neither run
// happens at a commit whose branch changed anything but product source and the
// plan's own directory, because mocks and helpers decide it too:
// scripts/acceptance/run.mjs has the list.
//
// Exemptions are a path list, never a word in a body, for the reason
// scripts/review-evidence-check.mjs gives at its own list: a path list is
// wrong in an obvious way when it is wrong.
//
// It reads BASE_SHA, HEAD_SHA, PR_BODY, PR_HEAD_REF and PR_NUMBER, so the
// same code runs in continuous integration, in its own cases, and in a
// builder's terminal before the push.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  changesBetween,
  inRun,
  notFailing,
  notPassing,
  PLAN_TEST,
  transcript,
  vitestAt,
} from './acceptance/run.mjs';
import { changedFilesFrom } from './changed-files.mjs';
import { keepOnlyLocalGitEnv } from './local-git-env.mjs';
import { exitWith } from './main-module.mjs';
import { missingStandingCriterion, plansIn } from './acceptance/standing-criterion.mjs';
import { visibleText } from './markdown.mjs';

// `core.quotePath=false` so a path with a non-ASCII byte comes back as itself
// rather than wrapped in quotes, which would fail every prefix test below and
// refuse correct work with a message naming a file nobody has.
const gitText = (args) =>
  execFileSync('git', ['-c', 'core.quotePath=false', ...args], { encoding: 'utf8' });
const git = (args) => gitText(args).trim();

// Every input this check takes from the environment is read here, and then the
// environment is cut to what Git needs, so no credential reaches a Git child,
// as commit-range-check.mjs does (Sol's review of 03b8239). The vitest runs get
// theirs from run.mjs, which kept the caller's when it loaded.
const requested = Object.fromEntries(
  ['BASE_SHA', 'HEAD_SHA', 'PR_BODY', 'PR_HEAD_REF', 'PR_NUMBER'].map((name) => [
    name,
    process.env[name],
  ]),
);
keepOnlyLocalGitEnv();

// A revision, resolved by git rather than trusted as text. `--end-of-options`
// is why this is not a plain pass-through: every git command below takes the
// value as an argument, and a value beginning with a dash would be read as an
// option rather than as a commit. Resolving it once here also lets a builder
// pass `origin/main` at a terminal while CI passes a sha.
const revision = (name) => {
  const value = (requested[name] ?? '').trim();
  if (value === '') {
    exitWith(2, `acceptance: ${name} must be set.`);
  }
  const resolved = spawnSync(
    'git',
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${value}^{commit}`],
    { encoding: 'utf8' },
  );
  if (resolved.status !== 0) {
    exitWith(2, `acceptance: ${name} is not a commit in this repository.`);
  }
  return resolved.stdout.trim();
};

const base = revision('BASE_SHA');
const head = revision('HEAD_SHA');

const refusals = [];
const pass = (rule, detail) => console.log(`acceptance: pass    ${rule}: ${detail}`);
const refuse = (rule, detail) => {
  console.log(`acceptance: REFUSE  ${rule}: ${detail}`);
  refusals.push(`${rule}: ${detail}`);
};

// The run ends where a refusal is, not only at the bottom of the file: the
// review of cb8051b found the exemption's own `process.exit(0)` past one.
const stopIfRefused = () => {
  if (refusals.length === 0) return;
  exitWith(
    1,
    `\nacceptance: ${refusals.length} refusal(s)\n`,
    ...refusals.map((refusal) => `  ${refusal}\n`),
    'acceptance: the plan stage writes the tests and commits them first, red.\n' +
      'acceptance: the builder makes them green without editing them. That order is\n' +
      'acceptance: the whole control, and this check is what makes it true.',
  );
};

const mergeBase = git(['merge-base', base, head]);
const changes = changesBetween(`${mergeBase}...${head}`);
const changed = changes.map(({ path }) => path);

// --- rule 5: the plan carries the standing criterion -------------------------
//
// The scope is every plan this branch's diff names, earlier rounds' left where
// they are, nothing filtered out of it now: `AM` dropped a rename and `d` a
// deleted plan, which then took the exemption. `--no-renames` is the last of
// them, from the review of bdf856a: git names a rename by its destination
// alone, so moving a plan or a script out to `docs/` hid the source it removed
// and the exemption exited 0 over it. A pair of sides is two paths here. One
// git cannot hand over at the head is a refusal, not a pass.

const plans = plansIn(changed);
for (const path of plans) {
  const shown = spawnSync('git', ['show', `${head}:${path}`], { encoding: 'utf8' });
  // A refusal names what happened. Over spawnSync's 1 MB maxBuffer git comes
  // back with a null status and no output, and "not in the tree" was untrue.
  const gone =
    shown.status === null
      ? `git could not read it at ${head.slice(0, 7)}: ${shown.error?.code ?? shown.signal}`
      : `it is not in the tree at ${head.slice(0, 7)}, so nothing carries it`;
  const why = shown.status === 0 ? missingStandingCriterion(shown.stdout) : gone;
  if (why === '') pass('standing criterion', `${path} carries it`);
  else refuse('standing criterion', `${path}: ${why}`);
}

// --- the exemption, by path ------------------------------------------------
//
// A link or a submodule is never documentation, whatever its name: what it
// points at is (Sol CF-05-FIX5). Its mode comes from changesBetween, the one
// reading run.mjs's path rule uses too.

const EXEMPT_PREFIXES = ['docs/', '.github/ISSUE_TEMPLATE/', 'presets/'];
const isExempt = (path) =>
  path.endsWith('.md') || EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
const links = changes.filter(({ regular }) => !regular).map(({ path }) => JSON.stringify(path));

if (changed.length === 0) {
  refuse('a diff', `nothing changed between ${mergeBase.slice(0, 7)} and ${head.slice(0, 7)}`);
} else if (changed.every((path) => isExempt(path)) && links.length > 0) {
  refuse(
    'exempt',
    `${links.join(', ')} ${links.length === 1 ? 'is a link' : 'are links'}, and only a file is documentation: this diff needs an acceptance directory`,
  );
} else if (changed.every((path) => isExempt(path))) {
  // The refusal first, or a plan-only diff it refused reads as a pass and then
  // a refusal, in that order.
  stopIfRefused();
  pass('exempt', `${changed.length} changed file(s), all documentation or presets`);
  console.log('acceptance: this diff needs no acceptance directory.');
  process.exit(0);
}

// --- rule 1: the plan commit ------------------------------------------------

// `--first-parent`, and it is the whole rule. `git rev-list` orders by commit
// date, so with a merge in the range the oldest date wins and a builder can
// commit the code first, commit the tests on a sibling branch off the merge
// base with a backdated `GIT_COMMITTER_DATE`, merge, and have the check name
// the tests as the plan. The first-parent chain is the branch's own history in
// the order it was built, and the merge cannot reorder it.
const plan =
  git(['rev-list', '--reverse', '--first-parent', '--topo-order', `${mergeBase}..${head}`])
    .split('\n')
    .find((line) => line !== '') ?? '';
// The plan commit's own diff, not its diff against the merge base. Once a
// branch merges main into itself, and this repository's own main carries such a
// merge, the merge base moves to main's tip and everything main gained since
// the fork is reported as a file the plan commit touched. The refusal was then
// false and said something untrue about a commit a reader can go and look at.
// `--root` for a repository whose first commit is the plan commit, which a pull
// request cannot produce and the cases do not reach; a merge as the first commit
// reports no file, and rule 1 refuses it, which is right.
const planFiles =
  plan === ''
    ? []
    : changedFilesFrom(
        gitText(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', plan]),
      );

const ACCEPTANCE = /^tests\/acceptance\/([^/]+)\//u;
const directories = [
  ...new Set(
    planFiles.map((path) => ACCEPTANCE.exec(path)?.[1]).filter((name) => name !== undefined),
  ),
];
const ticketDirectory = directories.length === 1 ? (directories[0] ?? '') : '';

if (plan === '') {
  refuse('plan commit', 'this branch adds no commit, so nothing planned anything');
} else if (planFiles.length === 0) {
  refuse('plan commit', `${plan.slice(0, 7)} is the first commit and it changes no file`);
} else if (directories.length > 1) {
  refuse(
    'plan commit',
    `${plan.slice(0, 7)} writes ${directories.length} acceptance directories (${directories.join(', ')}). One commit plans one ticket`,
  );
} else if (ticketDirectory === '' || !planFiles.every((path) => ACCEPTANCE.test(path))) {
  const strays = planFiles.filter((path) => !ACCEPTANCE.test(path));
  refuse(
    'plan commit',
    `${plan.slice(0, 7)} is the first commit and it touches ${strays.length} file(s) outside tests/acceptance/: ${strays.slice(0, 3).join(', ')}`,
  );
} else {
  pass(
    'plan commit',
    `${plan.slice(0, 7)} writes tests/acceptance/${ticketDirectory}/ and nothing else`,
  );
}

// --- rule 5 again: a code change brings a plan ------------------------------
//
// A branch that names no plan was never asked for the criterion at all: the
// review of 15473f1 built one and watched the check exit 0 with no `standing
// criterion` line. Rule 1 has just named the directory, CONTRIBUTING.md step 3
// puts the plan in it, and nothing outside the diff is opened: criterion 3.
if (ticketDirectory !== '') {
  const required = `tests/acceptance/${ticketDirectory}/plan.md`;
  if (plans.includes(required)) pass('plan required', `this branch brings ${required}`);
  else refuse('plan required', `this diff changes code and brings no ${required}`);
}

// --- rule 2: the plan holds tests -------------------------------------------

const planTests =
  ticketDirectory === ''
    ? []
    : changedFilesFrom(
        gitText([
          'ls-tree',
          '-r',
          '--name-only',
          plan,
          '--',
          `tests/acceptance/${ticketDirectory}/`,
        ]),
      ).filter((path) => path.endsWith(PLAN_TEST));

if (ticketDirectory !== '') {
  if (planTests.length === 0) {
    refuse(
      'plan tests',
      `tests/acceptance/${ticketDirectory}/ holds no *${PLAN_TEST} file at ${plan.slice(0, 7)}, so there is nothing to be red`,
    );
  } else {
    pass(
      'plan tests',
      `${planTests.length} test file(s) under tests/acceptance/${ticketDirectory}/`,
    );
  }
}

// --- rule 3: one integer against one integer --------------------------------
//
// The only thing read from the body, and the template's own instructions are
// HTML comments carrying an example `Closes #123`, which GitHub renders as
// nothing and this must read as nothing.

// Fenced blocks come out as well as comments, the way the review of record
// reads a body: the review checkpoint is pasted inside a fence and carries the
// branch's commit subjects, so a commit whose subject says "closes #12" would
// be a second ticket. And GitHub closes an issue on any of three verbs, so all
// three are read; reading one of them turns the other two into "names no
// ticket" on a body GitHub itself would act on.
const body = visibleText(requested['PR_BODY']);
const closes = [
  ...new Set(
    [...body.matchAll(/\b(?:closes|fixes|resolves)\s+#(\d+)\b/giu)].map((m) => Number(m[1])),
  ),
];
const branchNumber = /(?:^|\/)(\d+)-/u.exec(requested['PR_HEAD_REF'] ?? '');
const stated = closes.length > 0 ? closes : branchNumber === null ? [] : [Number(branchNumber[1])];
const directoryNumber = /^(\d+)-/u.exec(ticketDirectory);

if (ticketDirectory !== '') {
  if (directoryNumber === null) {
    refuse('ticket number', `tests/acceptance/${ticketDirectory}/ is not named <number>-<slug>`);
  } else if (stated.length === 0) {
    refuse(
      'ticket number',
      'the pull request names no ticket. Write `Closes #<n>` in the body, or number the branch',
    );
  } else if (stated.length > 1) {
    refuse(
      'ticket number',
      `the body closes ${stated.length} tickets (${stated.join(', ')}). One pull request, one ticket`,
    );
  } else if (stated[0] === Number(directoryNumber[1])) {
    pass('ticket number', `#${stated[0]}, in the body and in the directory name`);
  } else {
    refuse(
      'ticket number',
      `the pull request closes #${stated[0]} and the directory is for #${directoryNumber[1]}`,
    );
  }
}

// --- rule 4: untouched at the head ------------------------------------------

if (ticketDirectory !== '') {
  const edited = spawnSync(
    'git',
    ['diff', '--quiet', plan, head, '--', `tests/acceptance/${ticketDirectory}/`],
    { stdio: 'pipe' },
  );
  if (edited.status === 0) {
    pass('tests untouched', `tests/acceptance/${ticketDirectory}/ is byte-identical at the head`);
  } else {
    refuse(
      'tests untouched',
      `tests/acceptance/${ticketDirectory}/ changed after ${plan.slice(0, 7)}. The builder does not edit what it is measured against`,
    );
  }
}

// --- rules 6 and 7: red at the plan commit, green at the head ---------------

if (refusals.length === 0 && ticketDirectory !== '') {
  const directory = `tests/acceptance/${ticketDirectory}`;
  const red = vitestAt(plan, directory, mergeBase);
  console.log(
    "acceptance: both runs use the runner's vitest configuration, with no setup or plugin; the repository's is not read.",
  );
  const notRed = planTests
    .map((file) => [file, notFailing(inRun(red, file))])
    .filter(([, why]) => why !== '');
  if (!red.started) {
    refuse(
      'red at the plan commit',
      `vitest could not be run at ${plan.slice(0, 7)}, so nothing was established`,
    );
    console.log(transcript(red));
  } else if (notRed.length > 0) {
    refuse(
      'red at the plan commit',
      `at ${plan.slice(0, 7)}, before the code existed, ${notRed.map(([file, why]) => `${file} ${why}`).join('; ')}. ` +
        "Each of the plan's tests runs there and fails there. One that is already green tests nothing, and one that did not run proves nothing",
    );
    console.log(transcript(red));
  } else {
    pass(
      'red at the plan commit',
      `${planTests.length} test file(s) ran and failed at ${plan.slice(0, 7)}, vitest exit ${red.status}`,
    );
  }

  const green = vitestAt(head, directory, mergeBase);
  const notGreen = planTests
    .map((file) => [file, notPassing(inRun(green, file))])
    .filter(([, why]) => why !== '');
  if (!green.started) {
    refuse('green at the head', `vitest could not be run at ${head.slice(0, 7)}`);
    console.log(transcript(green));
  } else if (notGreen.length > 0) {
    refuse(
      'green at the head',
      `at ${head.slice(0, 7)}, ${notGreen.map(([file, why]) => `${file} ${why}`).join('; ')}. ` +
        'A zero exit and a file the reporter calls passed are both true of a file in which nothing ran',
    );
    console.log(transcript(green));
  } else if (green.status !== 0) {
    refuse(
      'green at the head',
      `every test in the plan's files passed at ${head.slice(0, 7)} and vitest still exited ${green.status}`,
    );
    console.log(transcript(green));
  } else {
    const tests = planTests.reduce(
      (sum, file) => sum + (inRun(green, file)?.assertions.length ?? 0),
      0,
    );
    pass(
      'green at the head',
      `${tests} test(s) across ${planTests.length} file(s) ran and passed at ${head.slice(0, 7)} under the runner's configuration, vitest exit 0`,
    );
  }
} else if (ticketDirectory !== '') {
  console.log(
    'acceptance: the two vitest runs were not attempted; an earlier rule already refused.',
  );
}

console.log(
  `acceptance: ${changed.length} changed file(s), pull request ${requested['PR_NUMBER'] ?? 'unnumbered'}`,
);

stopIfRefused();

console.log('acceptance: the plan was red before the code and is green after it.');
