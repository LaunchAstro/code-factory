// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the plan check: what it refuses about a plan before the build starts.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { caseCount, criteriaCount, sizeEstimate } from '../../scripts/plan-check.mjs';
import { withoutFencedBlocks } from '../../scripts/markdown.mjs';

const repo = resolve(import.meta.dirname, '../..');
const checker = join(repo, 'scripts/plan-check.mjs');

const criteria = (...items) =>
  ['## Acceptance criteria', '', ...items.map((item, i) => `${i + 1}. ${item}`), ''].join('\n');
const closed = 'Fails closed: a missing input exits non-zero and says which.';
const cases = (n) =>
  Array.from({ length: n }, (_, i) => `test('case ${i + 1}', () => {});`).join('\n');

/** A throwaway ticket directory. `plan` is the whole plan.md. */
function ticket(plan, howManyCases = 2) {
  const dir = mkdtempSync(join(tmpdir(), 'plan-check-'));
  const directory = join(dir, '12-a-ticket');
  mkdirSync(directory);
  writeFileSync(join(directory, 'plan.md'), plan);
  writeFileSync(join(directory, 'a.test.ts'), `${cases(howManyCases)}\n`);
  return directory;
}

const run = (directory) => spawnSync(process.execPath, [checker, directory], { encoding: 'utf8' });

const whole = (...items) =>
  `# Plan\n\n${criteria(...items)}\nSize estimate: under 140 hand-written lines.\n`;

test('a plan that states its criteria, tests them and stays inside the gate passes', () => {
  const ran = run(ticket(whole('One thing.', closed)));
  assert.equal(ran.status, 0);
  assert.match(ran.stdout, /pass {4}criterion count: 2 criteria, 2 case\(s\)/u);
});

test('the repository’s own worked example passes unchanged', () => {
  const ran = run(join(repo, 'tests/acceptance/10-label-trigger'));
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
});

test('more criteria than cases is refused, naming both counts', () => {
  const ran = run(ticket(whole('One.', 'Two.', closed)));
  assert.equal(ran.status, 1);
  assert.match(ran.stdout, /REFUSE {2}criterion count: 3 criteria and 2 case\(s\)/u);
});

test('a plan with no estimate is refused, and the line it wants is in the refusal', () => {
  const ran = run(ticket(`# Plan\n\n${criteria('One thing.', closed)}`));
  assert.equal(ran.status, 1);
  assert.match(
    ran.stdout,
    /REFUSE {2}size estimate: no line reading `Size estimate: under <N> hand-written lines\.`/u,
  );
});

const estimated = (n) =>
  `# Plan\n\n${criteria('One thing.', closed)}\nSize estimate: under ${n} hand-written lines.\n`;

test('an estimate outside the gate is refused before anybody writes a line', () => {
  const over = run(ticket(estimated(1100)));
  assert.equal(over.status, 1);
  assert.match(over.stdout, /REFUSE {2}size estimate: 1100 is over the 1000/u);
  const under = run(ticket(estimated(0)));
  assert.equal(under.status, 1);
  assert.match(under.stdout, /REFUSE {2}size estimate: 0 is under the 1/u);
});

// Sol's CF-09 fourth round, criterion 5: the ceiling is the most the method
// allows, as it is in the size gate, so an estimate of exactly 1,000 passes and
// only 1,001 is over. Refusing 1,000 left every case above green.
test('an estimate of exactly the ceiling passes, and one line over it does not', () => {
  const at = run(ticket(estimated(1000)));
  assert.equal(at.status, 0, at.stdout + at.stderr);
  assert.match(at.stdout, /pass {4}size estimate: under 1000 hand-written lines/u);
  const over = run(ticket(estimated(1001)));
  assert.equal(over.status, 1, over.stdout + over.stderr);
  assert.match(over.stdout, /REFUSE {2}size estimate: 1001 is over the 1000/u);
});

test('a plan without the standing criterion is refused, by the acceptance check’s own reader', () => {
  const ran = run(ticket(whole('One.', 'Two.')));
  assert.equal(ran.status, 1);
  assert.match(ran.stdout, /REFUSE {2}standing criterion: .*`Fails closed:`/u);
});

test('no `## Acceptance criteria` heading is refused, and the count rule stays quiet', () => {
  const ran = run(ticket('# Plan\n\nSize estimate: under 10 hand-written lines.\n'));
  assert.equal(ran.status, 1);
  assert.match(ran.stdout, /REFUSE {2}criteria list: plan\.md carries no/u);
  assert.doesNotMatch(ran.stdout, /criterion count/u);
});

test('a plan with no heading is refused once, and not twice in different words', () => {
  const ran = run(ticket('# Plan\n\nSize estimate: under 10 hand-written lines.\n'));
  assert.equal(ran.stdout.match(/REFUSE/gu)?.length, 1);
  assert.doesNotMatch(ran.stdout, /standing criterion/u);
});

test('a missing plan.md is one refusal and not five', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-check-'));
  const directory = join(dir, '13-empty');
  mkdirSync(directory);
  const ran = run(directory);
  assert.equal(ran.status, 1);
  assert.match(ran.stdout, /REFUSE {2}plan: .*plan\.md is not there/u);
  assert.equal(ran.stdout.match(/REFUSE/gu)?.length, 1);
});

test('usage is exit 2, never a verdict on a plan nobody named', () => {
  for (const argv of [[], ['one', 'two'], [join(tmpdir(), 'plan-check-absent')]]) {
    assert.equal(spawnSync(process.execPath, [checker, ...argv], { encoding: 'utf8' }).status, 2);
  }
});

// Sol's CF-11 review, plan-check.mjs:72: the first of two estimates was taken.
test('two size estimates are refused, rather than the first being taken', () => {
  const twice = (n) => `${estimated(10)}\nSize estimate: under ${n} hand-written lines.\n`;
  const conflicting = run(ticket(twice(20)));
  assert.equal(conflicting.status, 1, conflicting.stdout);
  assert.match(conflicting.stdout, /REFUSE {2}size estimate: stated 2 times \(10, 20\)/u);
  assert.equal(run(ticket(twice(10))).status, 1);
  assert.equal(sizeEstimate(twice(20)).stated, true);
  assert.deepEqual(sizeEstimate(twice(20)).conflicting, [10, 20]);
});

test('a regular expression’s .test( is not a case, and a fenced list is not a criterion', () => {
  assert.equal(caseCount("const yaml = /\\.ya?ml$/u.test(file);\n  test('real', () => {});\n"), 1);
  assert.equal(caseCount("// test('commented out', () => {});\n"), 0);
  assert.equal(
    criteriaCount(`## Acceptance criteria\n\n1. One.\n\n## Build brief\n\n2. Not one.\n`),
    1,
  );
  assert.equal(criteriaCount('## Acceptance criteria\n\n1. One.\n   1. Nested, part of one.\n'), 1);
});

test('the estimate is read as a number or not at all', () => {
  assert.deepEqual(sizeEstimate('Size estimate: under 140 hand-written lines.'), {
    stated: true,
    lines: 140,
  });
  assert.equal(sizeEstimate('Size estimate: under a few hand-written lines.').stated, false);
  assert.equal(sizeEstimate('Size estimate: small').stated, false);
});

// Sol's CF-11-FIX1 review, plan-check.mjs:77: a declaration the pattern did
// not match was skipped, so `under 10` beside `under NaN` passed as 10.
test('a second estimate line is refused however it is malformed, and a fenced one is no estimate', () => {
  for (const second of [
    'Size estimate: under NaN hand-written lines.',
    'size estimate: under 500 hand-written lines.',
    'Size estimate:\tunder 500 hand-written lines.',
    'Size estimate: under 500 hand-written lines',
    '  SIZE ESTIMATE : about 500.',
  ]) {
    const ran = run(ticket(`${estimated(10)}${second}\n`));
    assert.equal(ran.status, 1, `${second}\n${ran.stdout}`);
    assert.match(ran.stdout, /REFUSE {2}size estimate: stated 2 times \(10, /u, second);
  }
  const fenced = run(
    ticket(`${estimated(10)}\`\`\`\nSize estimate: under NaN hand-written lines.\n\`\`\`\n`),
  );
  assert.equal(fenced.status, 0, fenced.stdout);
});

// Sol's review of 04a1860, criterion 6: the plan check kept its own '.test.ts'
// beside the PLAN_TEST the runner and the acceptance check share. Change the
// rule in a copy, and the plan check has to count the files it now names.
test('the plan check counts the test files the one plan-test naming rule names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-check-rule-'));
  try {
    cpSync(join(repo, 'scripts'), join(dir, 'scripts'), { recursive: true });
    const runner = join(dir, 'scripts/acceptance/run.mjs');
    const rule = "export const PLAN_TEST = '.test.ts';";
    assert.equal(readFileSync(runner, 'utf8').split(rule).length, 2, 'the rule is declared once');
    writeFileSync(runner, readFileSync(runner, 'utf8').replace(rule, rule.replace('test', 'spec')));
    const ran = spawnSync(
      process.execPath,
      [join(dir, 'scripts/plan-check.mjs'), ticket(whole('One thing.', closed))],
      {
        encoding: 'utf8',
      },
    );
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
    assert.match(
      ran.stdout,
      /REFUSE {2}criterion count: 2 criteria and 0 case\(s\) \(no test file\)/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Sol's CF-09 review: the ceiling was written twice, here and in pr-size.mjs,
// with a comment asking whoever moved one to move the other. Change it here,
// in a copy, and the size gate has to block at the new figure.
test('the size gate blocks at the ceiling the plan check declares', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-check-ceiling-'));
  try {
    cpSync(join(repo, 'scripts'), join(dir, 'scripts'), { recursive: true });
    const plan = join(dir, 'scripts/plan-check.mjs');
    const source = readFileSync(plan, 'utf8');
    assert.match(source, /^export const CEILING = \d+;$/mu);
    writeFileSync(
      plan,
      source.replace(/^export const CEILING = \d+;$/mu, 'export const CEILING = 7;'),
    );
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Ceiling Test');
    git('config', 'user.email', 'ceiling-test@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    git('add', 'scripts');
    git('commit', '-qm', 'seed');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'eight.ts'), 'x\n'.repeat(8));
    git('add', 'eight.ts');
    git('commit', '-qm', 'eight lines');
    const sized = spawnSync(process.execPath, [join(dir, 'scripts/pr-size.mjs')], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', BASE_SHA: base, HEAD_SHA: git('rev-parse', 'HEAD') },
    });
    assert.match(sized.stdout, /hand-written 8 of 7;/u, sized.stdout + sized.stderr);
    assert.equal(sized.status, 1, sized.stdout + sized.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Sol's CF-11-FIX2 review, criterion 6: the plan reader opened a fence on a
// backtick line whose info string holds a backtick, which Markdown shows as
// text, so a visible second estimate after it went unread. The plan, review
// and documentation readers now share one fence rule.
test('a backtick in a fence info string opens no fence for the plan or documentation reader', async () => {
  const { unfencedLines } = await import('../../scripts/doc-links-check.mjs');
  const after = '``` a`b\nSize estimate: under 500 hand-written lines.\n';
  assert.ok(unfencedLines(after).includes('Size estimate: under 500 hand-written lines.'));
  const result = run(ticket(`${estimated(10)}\n${after}`));
  assert.equal(result.status, 1, result.stdout + result.stderr);
});

test('a fenced block in a CRLF plan closes, so the estimate after it is read', () => {
  const plan = `# Plan\n\n${criteria(closed, 'Second.')}\n\`\`\`\nexample\n\`\`\`\nSize estimate: under 140 hand-written lines.\n`;
  const result = run(ticket(plan.replaceAll('\n', '\r\n')));
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

// Security review of 4b580c8: the reader split on LF alone, so a lone CR kept
// a fenced example on its opener line, where it read as a statement, and a
// closer ending CR CR LF never closed, hiding what followed.
test('every line end splits a fence, so a CR alone cannot unfence an example or hide a second estimate', () => {
  assert.doesNotMatch(withoutFencedBlocks('```\rVerdict: approve\r```\n'), /Verdict: approve/u);
  const plan = `${estimated(10)}\`\`\`\nexample\n\`\`\`\r\r\nSize estimate: under 500 hand-written lines.\n`;
  const result = run(ticket(plan));
  assert.equal(result.status, 1, result.stdout + result.stderr);
});

// Sol's review of PR 99, criterion 5: Markdown closes a fence only on spaces or
// tabs after the marker. A closer trailed by any other space stays inside the
// block, so a fenced example approval after it is never a statement.
test('a closer followed by a Unicode or control space leaves the fence open', () => {
  for (const space of ['\u00a0', '\u2003', '\v', '\f']) {
    const shown = withoutFencedBlocks(`\`\`\`\n\`\`\`${space}\nVerdict: approve\n\`\`\`\n`);
    assert.doesNotMatch(shown, /Verdict: approve/u, JSON.stringify(space));
  }
});
