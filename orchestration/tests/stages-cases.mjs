// node --test orchestration/tests/stages-cases.mjs
// Each case builds a throwaway root the way the repository is laid out, then
// asks checkStages what it refuses.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { BEGIN, END, checkStages, renderTable } from '../archive/stages.mjs';

const STAGES = [
  {
    stage: 'BUILD',
    actor: 'the build lane',
    model: 'Opus 5',
    context: 40,
    wall: 75,
    pushes: 2,
    reviews: 0,
    pullRequests: null,
    brief: 'orchestration/archive/briefs/BRIEF-BUILD-TEMPLATE.md',
    starts: 'The plan is approved.',
    ends: 'The code is pushed.',
  },
  {
    stage: 'REVIEW',
    actor: 'the reviewer of record',
    model: 'gpt-5.6-sol',
    context: 40,
    wall: 15,
    pushes: 0,
    reviews: 6,
    reviewsPerPullRequest: 2,
    pullRequests: 0,
    brief: 'orchestration/archive/briefs/BRIEF-REVIEW-TEMPLATE.md',
    starts: 'The orchestrator sends a REVIEW line.',
    ends: 'The verdict is posted.',
  },
  {
    stage: 'FIX',
    actor: 'the fix lane',
    model: 'Opus 5',
    context: 30,
    wall: 45,
    pushes: 1,
    reviews: 0,
    pullRequests: 0,
    brief: 'orchestration/archive/briefs/BRIEF-FIX-TEMPLATE.md',
    starts: 'Decide grants one pass.',
    ends: 'The fix head is pushed.',
  },
];

const MINUTES = { plan: 45, build: 75, review: 15, fix: 45 };
const PER_PULL_REQUEST = { opus: 2, sol: 2, copilot: 0 };

// A brief takes each ceiling its row carries from a placeholder factory.sh
// fills out of stages.json: `<BUILD-WALL>` and the like.
const CEILINGS = {
  context: 'CONTEXT',
  wall: 'WALL',
  pushes: 'PUSHES',
  reviews: 'REVIEWS',
  reviewsPerPullRequest: 'REVIEWS-PER-PULL-REQUEST',
  pullRequests: 'PULL-REQUESTS',
};

// The stages whose brief runs each session at a deadline, in seconds.
const DEADLINES = new Set(['PLAN-CHECK', 'REVIEW']);

function briefFor(stage) {
  const placeholders = Object.entries(CEILINGS)
    .filter(([field]) => stage[field] !== null && stage[field] !== undefined)
    .map(([, name]) => `<${stage.stage.toUpperCase()}-${name}>`);
  if (DEADLINES.has(stage.stage)) placeholders.push(`<${stage.stage}-WALL-SECONDS>`);
  return `# a brief\n\n${placeholders.join(' ')}\n`;
}

function write(root, path, body) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}

// The orchestrator's boot holds a pull request at the REVIEW row's
// per-pull-request cap.
const BOOT = 'orchestration/archive/boot/ORCHESTRATOR-BOOT-TEMPLATE.md';
const BOOT_TEXT = '# a boot\n\nHold at any count at <REVIEW-REVIEWS-PER-PULL-REQUEST>.\n';

// The fix-head brief, which no row names, judges pass line 4 at the REVIEW
// row's per-pull-request cap and stops at its run cap.
const FIXHEAD = 'orchestration/archive/briefs/BRIEF-REVIEW-FIXHEAD-TEMPLATE.md';
const FIXHEAD_TEXT = '# a fix-head brief\n\nPass line 4 holds Sol to <REVIEW-REVIEWS-PER-PULL-REQUEST> per pull request; stop at <REVIEW-REVIEWS>.\n';

// stages: the JSON the root carries. table: what sits between the markers.
// end: the closing marker, dropped to make a root with no marker pair.
// minutes and perPullRequest: runner.json's counts. briefs: the brief files
// that exist. texts: a brief's own text, by path, in place of briefFor's.
// boot and fixhead: those templates' texts.
function buildRoot(t, options = {}) {
  const { stages = STAGES, table, end = END, minutes = MINUTES, briefs, texts = {}, boot = BOOT_TEXT, fixhead = FIXHEAD_TEXT } = options;
  const perPullRequest = options.perPullRequest ?? PER_PULL_REQUEST;
  const root = mkdtempSync(join(tmpdir(), 'stages-case-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, 'orchestration/archive/stages.json', JSON.stringify(stages, null, 2));
  const body = table === undefined ? renderTable(stages) : table;
  write(root, 'README.md', `## Run a round\n\n${BEGIN}\n\n${body}\n\n${end}\n`);
  write(
    root,
    'template/scripts/runner/runner.json',
    JSON.stringify({ minutes, perPullRequest }, null, 2),
  );
  for (const stage of stages) {
    const { brief } = stage;
    if (brief !== null && (briefs ?? [brief]).includes(brief)) {
      write(root, brief, texts[brief] ?? briefFor(stage));
    }
  }
  write(root, BOOT, boot);
  write(root, FIXHEAD, fixhead);
  return root;
}

test('a root whose README, briefs and runner all agree passes', (t) => {
  assert.deepEqual(checkStages(buildRoot(t)), []);
});

test('a README table that drifted from the JSON is refused', (t) => {
  const table = renderTable(STAGES).replace('75 minutes', '90 minutes');
  const failures = checkStages(buildRoot(t, { table }));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, 'readme');
});

test('a brief path with no file behind it is refused', (t) => {
  const briefs = STAGES.map((s) => s.brief).filter((b) => !b.includes('FIX'));
  const failures = checkStages(buildRoot(t, { briefs }));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, 'brief');
  assert.match(failures[0].message, /BRIEF-FIX-TEMPLATE\.md is not there/);
});

test('a runner.json minute that differs from its stage wall is refused', (t) => {
  const minutes = { ...MINUTES, build: 90 };
  const failures = checkStages(buildRoot(t, { minutes }));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, 'runner');
  assert.match(failures[0].message, /build: runner\.json 90 against BUILD wall 75/);
});

test('a README with no closing marker is refused', (t) => {
  const failures = checkStages(buildRoot(t, { end: '' }));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, 'readme');
  assert.match(failures[0].message, /^no .* and .* pair$/);
});

test('a runner.json minute with no stage row behind it is refused', (t) => {
  const stages = STAGES.filter((s) => s.stage !== 'BUILD');
  const failures = checkStages(buildRoot(t, { stages }));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, 'runner');
  assert.match(failures[0].message, /build: no BUILD row to check it against/);
});

test('a runner.json per-pull-request count that differs from its REVIEW row is refused', (t) => {
  const perPullRequest = { ...PER_PULL_REQUEST, sol: 3 };
  const failures = checkStages(buildRoot(t, { perPullRequest }));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, 'runner');
  assert.match(failures[0].message, /sol: runner\.json 3 against REVIEW reviews per pull request 2/);
});

test('two rows for one stage are refused, whatever the runner compares', (t) => {
  const stages = [...STAGES, { ...STAGES[0], wall: 999 }];
  const failures = checkStages(buildRoot(t, { stages }));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, 'stages');
  assert.match(failures[0].message, /BUILD: 2 rows/);
});

test('a brief that states a ceiling instead of taking it from stages.json is refused', (t) => {
  const build = STAGES[0];
  const texts = { [build.brief]: briefFor(build).replace('<BUILD-WALL>', 'Wall 75 minutes.') };
  const failures = checkStages(buildRoot(t, { texts }));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, 'brief');
  assert.match(failures[0].message, /BUILD: .*BRIEF-BUILD-TEMPLATE\.md does not carry <BUILD-WALL>/);
});

test('two rows for one stage in different cases are refused', (t) => {
  const stages = [...STAGES, { ...STAGES[0], stage: 'build', wall: 999 }];
  const failures = checkStages(buildRoot(t, { stages }));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, 'stages');
  assert.match(failures[0].message, /BUILD: 2 rows/);
});

// Markdown that renders as nothing: a placeholder there states no ceiling a
// reader sees, so the brief is refused whatever the hidden text carries.
const HIDDEN = {
  'a link reference definition': '[//]: # (<BUILD-WALL>)',
  'a reference definition over two lines': '[ceiling]:\n  /x "<BUILD-WALL>"',
  'an HTML comment over three lines': '<!--\n<BUILD-WALL>\n-->',
  'a link title': '[ceiling](/x "<BUILD-WALL>")',
  'an image destination': '![](<BUILD-WALL>)',
  'a tag attribute over two lines': '<span\ntitle="<BUILD-WALL>">x</span>',
  'a processing instruction': '<?x <BUILD-WALL> ?>',
  'an element with a boolean hidden attribute': '<div hidden>\n<BUILD-WALL>\n</div>',
  'a tag whose bare attribute is on the next line': '<div\nhidden>\n<BUILD-WALL>\n</div>',
  'an element that never renders what it holds': '<template>\n<BUILD-WALL>\n</template>',
  'an element named in upper case': '<DETAILS>\n<BUILD-WALL>\n</DETAILS>',
  'an element left open to the end': '<noscript>\n<BUILD-WALL>',
};
for (const [form, hidden] of Object.entries(HIDDEN)) {
  test(`a placeholder in ${form} does not stand for the ceiling`, (t) => {
    const build = STAGES[0];
    const text = `${briefFor(build).replace('<BUILD-WALL>', 'Wall 75 minutes.')}\n${hidden}\n`;
    const failures = checkStages(buildRoot(t, { texts: { [build.brief]: text } }));
    assert.ok(failures.length > 0, `${form} passed the gate`);
    assert.ok(failures.every((f) => f.label === 'brief'), JSON.stringify(failures));
  });
}

test('a review deadline stated in seconds instead of from stages.json is refused', (t) => {
  const review = STAGES[1];
  const texts = { [review.brief]: briefFor(review).replace('<REVIEW-WALL-SECONDS>', '901') };
  const failures = checkStages(buildRoot(t, { texts }));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, 'brief');
  assert.match(failures[0].message, /REVIEW: .*BRIEF-REVIEW-TEMPLATE\.md does not carry <REVIEW-WALL-SECONDS>/);
});

// A ceiling factory.sh fills must be a whole number: "15" would be repeated
// sixty times for a deadline, 15.5 and true rendered as written.
const NOT_WHOLE = { 'the string "40"': '40', 'a fraction': 40.5, 'a boolean': true, 'a negative number': -1 };
for (const [what, context] of Object.entries(NOT_WHOLE)) {
  test(`a ceiling that is ${what} is refused`, (t) => {
    const stages = [{ ...STAGES[0], context }, ...STAGES.slice(1)];
    const failures = checkStages(buildRoot(t, { stages }));
    assert.equal(failures.length, 1, JSON.stringify(failures));
    assert.equal(failures[0].label, 'stages');
    assert.match(failures[0].message, /BUILD: context .* is not a whole number/);
  });
}

test('a string wall the runner repeats is refused', (t) => {
  const stages = [STAGES[0], { ...STAGES[1], wall: '15' }, STAGES[2]];
  const failures = checkStages(buildRoot(t, { stages, minutes: { ...MINUTES, review: '15' } }));
  assert.equal(failures.length, 1, JSON.stringify(failures));
  assert.equal(failures[0].label, 'stages');
  assert.match(failures[0].message, /REVIEW: wall "15" is not a whole number/);
});

test('a boot that states the hold cap instead of taking it from stages.json is refused', (t) => {
  const failures = checkStages(buildRoot(t, { boot: '# a boot\n\nHold at any count at 2.\n' }));
  assert.equal(failures.length, 1, JSON.stringify(failures));
  assert.equal(failures[0].label, 'boot');
  assert.match(failures[0].message, /ORCHESTRATOR-BOOT-TEMPLATE\.md does not carry <REVIEW-REVIEWS-PER-PULL-REQUEST>/);
});

test('a boot that hides its hold cap is refused', (t) => {
  const boot = '# a boot\n\nHold at any count at 2.\n<!-- <REVIEW-REVIEWS-PER-PULL-REQUEST> -->\n';
  const failures = checkStages(buildRoot(t, { boot }));
  assert.ok(failures.length > 0, 'a hidden cap passed the gate');
  assert.ok(failures.every((f) => f.label === 'boot'), JSON.stringify(failures));
});

test('a fix-head brief that states its caps instead of taking them from stages.json is refused', (t) => {
  const failures = checkStages(buildRoot(t, { fixhead: '# a fix-head brief\n\nPass line 4 holds Sol to 2 per pull request; stop at 6.\n' }));
  assert.equal(failures.length, 2, JSON.stringify(failures));
  assert.ok(failures.every((f) => f.label === 'brief'), JSON.stringify(failures));
  assert.match(failures[0].message, /BRIEF-REVIEW-FIXHEAD-TEMPLATE\.md does not carry <REVIEW-REVIEWS-PER-PULL-REQUEST>/);
});

// A count written beside a ceiling's unit restates the ceiling the template
// takes from its placeholder, and goes stale when stages.json changes.
const RESTATED = {
  'an ordinal whose unit is left out': [STAGES[0].brief, 'That is the code, and there is no third.'],
  'an ordinal before its unit': [STAGES[0].brief, 'That is the second push.'],
  'a count with a command before its unit': [STAGES[2].brief, 'One signed commit, one `git push --force-with-lease`.'],
  'a number word before its unit': [STAGES[1].brief, 'At most six sessions in the run.'],
  // Sol's review of 11bb360: a word list that stopped at twelve let this pass.
  'a number word past twelve': [STAGES[1].brief, 'At most thirteen sessions in the run.'],
  // Sol's review of 87a9f77: words past the list's scale and ordinals ending in
  // "first" let these pass.
  'a scale word past a million': [STAGES[1].brief, 'At most a billion sessions.'],
  'a compound ordinal ending in first': [STAGES[1].brief, 'A twenty-first review is forbidden.'],
  'a numeral before its unit': [STAGES[0].brief, 'Wall 75 minutes.'],
  'a capitalised count': [STAGES[1].brief, 'Two reviews per pull request.'],
};
for (const [form, [brief, line]] of Object.entries(RESTATED)) {
  test(`a brief that restates a ceiling as ${form} is refused`, (t) => {
    const stage = STAGES.find((s) => s.brief === brief);
    const failures = checkStages(buildRoot(t, { texts: { [brief]: `${briefFor(stage)}\n${line}\n` } }));
    assert.equal(failures.length, 1, JSON.stringify(failures));
    assert.equal(failures[0].label, 'brief');
    assert.match(failures[0].message, /restates a ceiling/);
  });
}

// Sol PRV-cf-85-R1, criterion 1.
test('a scale word or a compound ordinal added to the committed REVIEW brief is refused', (t) => {
  const repo = resolve(import.meta.dirname, '../..');
  const root = mkdtempSync(join(tmpdir(), 'stages-case-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['README.md', 'orchestration', 'template/scripts/runner']) cpSync(join(repo, path), join(root, path), { recursive: true });
  const brief = join(root, 'orchestration/archive/briefs/BRIEF-REVIEW-TEMPLATE.md');
  const original = readFileSync(brief, 'utf8');
  assert.deepEqual(checkStages(root), [], 'the unmodified fixture must pass');
  const missed = [];
  for (const text of ['At most a billion sessions.', 'A twenty-first review is forbidden.']) {
    writeFileSync(brief, `${original}\n${text}\n`);
    if (!checkStages(root).some((f) => f.message.includes('restates a ceiling'))) missed.push(text);
  }
  assert.deepEqual(missed, [], 'accepted written ceilings');
});

test('the fix-head brief that calls a session past the per-pull-request cap a third is refused', (t) => {
  const failures = checkStages(buildRoot(t, { fixhead: `${FIXHEAD_TEXT}A third session breaks it.\n` }));
  assert.equal(failures.length, 1, JSON.stringify(failures));
  assert.equal(failures[0].label, 'brief');
  assert.match(failures[0].message, /BRIEF-REVIEW-FIXHEAD-TEMPLATE\.md restates a ceiling/);
});

test('a count beside a unit the template takes no ceiling for is not a restatement', (t) => {
  const boot = `${BOOT_TEXT}Hand over at 50 percent; nothing dispatches past 85 percent of 5h.\n`;
  assert.deepEqual(checkStages(buildRoot(t, { boot })), []);
});
