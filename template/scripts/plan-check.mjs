// SPDX-License-Identifier: AGPL-3.0-only
// The plan check: what the plan promises, read before the build is dispatched.
//
// `scripts/acceptance-check.mjs` proves the plan's tests were written first and
// are honest, and says nothing about what they do not cover. Round 3: a defect
// outside the plan's criteria cannot hold. Round 7: plan 16 estimated under 50
// hand-written lines and 70 landed. Both were found after the code existed, by
// the reviewer of record, the most expensive place to find either.
//
// This is the mechanical half of ticket 28's answer. It refuses what a script
// can decide about a plan on its own:
//
//   1. plan.md is there.
//   2. It carries a numbered `## Acceptance criteria` list.
//   3. The criterion count equals the test cases in the directory. A criterion
//      with no test is a promise nothing keeps, and a test with no criterion
//      cannot hold a defect at review.
//   4. It states a size estimate, once, as a number, of at least one line and
//      at or under the ceiling the size gate blocks at.
//   5. It carries the standing criterion, read by the acceptance check's own
//      module, which also reads the section, rather than by a second copy of
//      either rule.
//
// What it cannot decide is coverage: whether those criteria are the ticket's
// reproduction and its failure modes. That is the reviewer session in Code
// Factory's `orchestration/archive/briefs/BRIEF-PLAN-CHECK-TEMPLATE.md` (the
// archived first kit); the two are the stage.
//
// Usage: node scripts/plan-check.mjs tests/acceptance/<n>-<slug>

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PLAN_TEST } from './acceptance/run.mjs';
import { criteriaSection, missingStandingCriterion } from './acceptance/standing-criterion.mjs';
import { isMainModule } from './main-module.mjs';
import { visibleText } from './markdown.mjs';

// The size ceiling, declared once: scripts/pr-size.mjs imports it as the line
// it blocks above. 1,000 is docs/METHOD.md's "Pull request size". FLOOR is the
// smallest estimate that is one; the upper bound alone let `under 0` through.
export const CEILING = 1000;
export const FLOOR = 1;

// A top-level numbered item. Three columns in is a nested item, which is part
// of its parent rather than a criterion of its own.
const ITEM = /^ {0,2}\d+[.)]\s+\S/u;
// A vitest case as a case is written: the call opens the line. That keeps
// `/\.ya?ml$/u.test(file)` and a `//` commented-out case out of the count, and
// a plan author can satisfy it without guessing. Left as they are, on purpose:
// a case inside a `/* ... */` block counts, `test.skip(` and `test.todo(`
// count, and two cases on one line count as one. `corepack pnpm check` is what
// reads whether a case runs.
const CASE = /^\s*(?:it|test)(?:\.[\w$]+)*\s*\(/u;
const ESTIMATE = /^\s*Size estimate: under (\d+) hand-written lines\.\s*$/u;
const SHAPE = 'Size estimate: under <N> hand-written lines.';
const DECLARATION = /^\s*size estimate\s*:/iu;

const shown = (text) => visibleText(text).split('\n');

/** How many top-level numbered criteria the plan states. */
export const criteriaCount = (text) =>
  (criteriaSection(text) ?? []).filter((line) => ITEM.test(line)).length;

/** How many cases one test file holds. */
export const caseCount = (text) =>
  String(text ?? '')
    .split('\n')
    .filter((line) => CASE.test(line)).length;

/**
 * The estimate the plan states: `{ stated: false }`, or the number. Every
 * visible line opening `Size estimate:`, in any case, is a declaration, and a
 * plan with more than one also carries `conflicting`, in order, each the
 * number or the malformed line quoted: Sol's CF-11 review found the first
 * taken, so `under 10` then `under 500` passed as 10, and its CF-11-FIX1
 * review found a malformed second line skipped, so `under NaN` did too.
 */
export function sizeEstimate(text) {
  const all = shown(text)
    .filter((line) => DECLARATION.test(line))
    .map((line) => {
      const found = ESTIMATE.exec(line);
      return found === null ? `\`${line.trim()}\`` : Number(found[1]);
    });
  if (all.length > 1) return { stated: true, lines: NaN, conflicting: all };
  return typeof all[0] === 'number' ? { stated: true, lines: all[0] } : { stated: false, lines: 0 };
}

const finding = (ok, rule, detail) => ({ ok, rule, detail });

/** The `criterion count` verdict, or nothing when there are no criteria to count against. */
function countFinding(criteria, tests) {
  if (criteria === 0) return [];
  const counted = tests.map((file) => ({ path: file.path, cases: caseCount(file.text) }));
  const cases = counted.reduce((sum, file) => sum + file.cases, 0);
  const where =
    counted.length === 0
      ? 'no test file'
      : counted.map((file) => `${file.path} ${file.cases}`).join(', ');
  const detail =
    cases === criteria
      ? `${criteria} criteria, ${cases} case(s) across ${counted.length} file(s)`
      : `${criteria} criteria and ${cases} case(s) (${where}). A criterion with no test is a ` +
        'promise nothing keeps, and a case with no criterion cannot hold a defect';
  return [finding(cases === criteria, 'criterion count', detail)];
}

/** The `size estimate` verdict: stated, numeric, and inside the gate. */
function estimateFinding(plan) {
  const { stated, lines, conflicting } = sizeEstimate(plan);
  if (!stated) {
    const why = `no line reading \`${SHAPE}\`. Round 7 estimated 50, landed 70, nobody read it`;
    return finding(false, 'size estimate', why);
  }
  if (conflicting !== undefined) {
    const which = `stated ${conflicting.length} times (${conflicting.join(', ')})`;
    return finding(false, 'size estimate', `${which}; a plan states one estimate`);
  }
  if (lines < FLOOR || lines > CEILING) {
    const why =
      lines < FLOOR
        ? `under the ${FLOOR} line a ticket that changes anything needs`
        : `over the ${CEILING} scripts/pr-size.mjs blocks at, so the size gate refuses it`;
    return finding(false, 'size estimate', `${lines} is ${why}`);
  }
  return finding(true, 'size estimate', `under ${lines} hand-written lines, against ${CEILING}`);
}

/**
 * Every rule's verdict, in order. `tests` are `{ path, text }` for the
 * directory's test files; `plan` is null when there is no plan.md.
 */
export function planFindings(directory, plan, tests) {
  if (plan === null) {
    return [finding(false, 'plan', `${directory}/plan.md is not there, so nothing planned it`)];
  }
  const here = finding(true, 'plan', `${directory}/plan.md`);
  // No heading is one fault, so it is one refusal: it used to draw two in
  // different words, here and from the standing criterion's reader. With no
  // section there is nothing to count the other rules against either.
  const noHeading = 'plan.md carries no `## Acceptance criteria` heading';
  if (criteriaSection(plan) === null) return [here, finding(false, 'criteria list', noHeading)];
  const criteria = criteriaCount(plan);
  const why = missingStandingCriterion(plan);
  const list =
    criteria > 0
      ? `${criteria} numbered criteria`
      : 'the `## Acceptance criteria` section carries no top-level numbered item';
  return [
    here,
    finding(criteria > 0, 'criteria list', list),
    ...countFinding(criteria, tests),
    estimateFinding(plan),
    finding(why === '', 'standing criterion', why === '' ? `${directory}/plan.md carries it` : why),
  ];
}

/** The directory's test files, by the one rule the runner runs and the acceptance check grades. */
export const testFilesIn = (directory) =>
  readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith(PLAN_TEST))
    .toSorted()
    .map((path) => ({ path, text: readFileSync(join(directory, path), 'utf8') }));

export function run(argv) {
  if (argv.length !== 1) {
    console.error('plan-check: one argument, the ticket directory tests/acceptance/<n>-<slug>.');
    return 2;
  }
  const directory = String(argv[0]).replace(/\/+$/u, '');
  try {
    if (!statSync(directory).isDirectory()) throw new Error('not a directory');
  } catch {
    console.error(`plan-check: ${directory} is not a directory in this repository.`);
    return 2;
  }
  let plan = null;
  try {
    plan = readFileSync(join(directory, 'plan.md'), 'utf8');
  } catch {
    plan = null;
  }
  const findings = planFindings(directory, plan, testFilesIn(directory));
  for (const { ok, rule, detail } of findings) {
    console.log(`plan-check: ${ok ? 'pass   ' : 'REFUSE '} ${rule}: ${detail}`);
  }
  const refused = findings.filter((each) => !each.ok);
  if (refused.length === 0) {
    console.log('plan-check: the plan states its criteria, tests them, and stays inside the gate.');
    return 0;
  }
  console.error(`\nplan-check: ${refused.length} refusal(s)\n`);
  for (const { rule, detail } of refused) console.error(`  ${rule}: ${detail}\n`);
  console.error(
    'plan-check: a criterion nothing tests, or an estimate nobody stated, is a gap that\n' +
      'plan-check: only shows up once the code exists and it is too late to be cheap.',
  );
  return 1;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
