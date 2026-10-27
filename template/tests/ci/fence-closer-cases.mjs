// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the fence closer: an example approval stays fenced, and the committed cases notice a widened rule.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const childEnv = Object.fromEntries(
  ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'CI']
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]),
);
const git = (...args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: childEnv }).trim();
const head = git('rev-parse', 'HEAD');
const fields = `Reviewer: Sol\nModel: independent\nHead SHA: ${head}\nVerdict: approve\n`;
const reviewRun = (where, body) =>
  spawnSync(process.execPath, [join(where, 'scripts/review-evidence-check.mjs')], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HEAD_SHA: head,
      REVIEWS: JSON.stringify([
        { id: 1, state: 'COMMENTED', commit_id: head, submitted_at: '2026-10-04T00:00:00Z', body },
      ]),
    },
  });

// Sol PRV-cf-99-R1-2217, criterion 2.
test('a closer trailed by a non-ASCII or control space cannot expose a fenced approval', () => {
  for (const space of ['\u00A0', '\u2003', '\v', '\f']) {
    const ran = reviewRun(root, `\`\`\`\n\`\`\`${space}\n${fields}`);
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
    assert.doesNotMatch(ran.stdout, /the review covers this exact revision/u);
  }
  assert.equal(reviewRun(root, `\`\`\`\n\`\`\` \t\n${fields}`).status, 0);
});

/** A copy of the scripts and the plan cases, to break without touching the tree. */
function scratchCopy(prefix) {
  const scratch = mkdtempSync(join(tmpdir(), prefix));
  cpSync(join(root, 'scripts'), join(scratch, 'scripts'), { recursive: true });
  mkdirSync(join(scratch, 'tests/ci'), { recursive: true });
  cpSync(
    join(root, 'tests/ci/plan-check-cases.mjs'),
    join(scratch, 'tests/ci/plan-check-cases.mjs'),
  );
  return scratch;
}

/**
 * Runs the one plan case called `name` in the copy. Matching none or several is
 * an error; with none, Node reports the file itself as the one test that passed.
 */
function runCase(scratch, name) {
  const ran = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      `--test-name-pattern=${name}`,
      join(scratch, 'tests/ci/plan-check-cases.mjs'),
    ],
    { encoding: 'utf8', env: childEnv },
  );
  const out = ran.stdout + ran.stderr;
  const result = ran.stdout.split('\n').find((line) => /^(?:not )?ok 1 - /u.test(line));
  assert.ok(
    /^# tests 1$/mu.test(ran.stdout) && [`ok 1 - ${name}`, `not ok 1 - ${name}`].includes(result),
    `exactly one case is called '${name}'\n${out}`,
  );
  return { status: ran.status, out };
}

const passes = (scratch, name) => {
  const { status, out } = runCase(scratch, name);
  assert.equal(status, 0, `'${name}' passes before the mutation\n${out}`);
};

const failsOnAssertion = (scratch, name) => {
  const { status, out } = runCase(scratch, name);
  assert.equal(status, 1, name + '\n' + out);
  assert.ok(out.includes(`\nnot ok 1 - ${name}\n`), `'${name}' is the case that fails\n${out}`);
  assert.match(out, /AssertionError/u);
  assert.doesNotMatch(out, /SyntaxError|ERR_MODULE_NOT_FOUND/u);
};

// Sol PRV-cf-99-R1-2217, criterion 5.
test('the opener and line-end cases fail when their fixes are undone', () => {
  const scratch = scratchCopy('fence-closer-revert-');
  try {
    const file = join(scratch, 'scripts/markdown.mjs');
    const source = readFileSync(file, 'utf8');
    const patterns = [
      'a backtick in a fence info string opens no fence for the plan or documentation reader',
      'a fenced block in a CRLF plan closes, so the estimate after it is read',
      'every line end splits a fence, so a CR alone cannot unfence an example or hide a second estimate',
    ];
    for (const name of patterns) passes(scratch, name);
    const opener = '(?=[^`]*$)';
    assert.equal(source.split(opener).length, 2);
    writeFileSync(file, source.replace(opener, ''));
    failsOnAssertion(scratch, patterns[0]);
    const split = '.split(/\\r\\n|\\r|\\n/u)';
    assert.equal(source.split(split).length, 2);
    writeFileSync(file, source.replace(split, ".split('\\n')"));
    for (const name of patterns.slice(1)) failsOnAssertion(scratch, name);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// Sol PRV-cf-99-R1-2217 and PRV-cf-99-R2, criterion 5: the hostile-closer case
// itself must catch the widened rule; another suite failing is not evidence.
test('the committed cases fail when the closer rule is widened to Unicode and control spaces', () => {
  const scratch = scratchCopy('fence-closer-widened-');
  try {
    const hostile = 'a closer followed by a Unicode or control space leaves the fence open';
    passes(scratch, hostile);
    const module = join(scratch, 'scripts/markdown.mjs');
    const source = readFileSync(module, 'utf8');
    const strict =
      "return new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`, 'u').test(line)";
    assert.equal(source.split(strict).length, 2, 'exactly one closer rule is mutated');
    writeFileSync(
      module,
      source.replace(strict, () => strict.replace('[ \\t]', '[\\\\s]')),
    );
    const exposed = reviewRun(scratch, `\`\`\`\n\`\`\`\u00A0\n${fields}`);
    assert.equal(
      exposed.status,
      0,
      'the disposable mutation really lets an example approval authorise this head\n' +
        exposed.stdout +
        exposed.stderr,
    );
    failsOnAssertion(scratch, hostile);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
