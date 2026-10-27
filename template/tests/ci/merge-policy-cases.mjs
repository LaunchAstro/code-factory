// SPDX-License-Identifier: AGPL-3.0-only
// The merge policy check, run over a copy of itself beside a hostile
// renovate.json. Sol's review of 69afe53 found it reading only literal
// `automerge` keys, so a preset that turns automerge on passed, and skipping a
// document that was not an object, so `null` was reported as a checked policy.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const template = resolve(import.meta.dirname, '../..');

const check = (renovateText) => {
  const dir = mkdtempSync(join(tmpdir(), 'merge-policy-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    for (const script of ['merge-policy-check.mjs', 'main-module.mjs'])
      cpSync(join(template, 'scripts', script), join(dir, 'scripts', script));
    writeFileSync(join(dir, 'renovate.json'), renovateText);
    return spawnSync(process.execPath, [join(dir, 'scripts/merge-policy-check.mjs')], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const refuses = (config, saying) => {
  const run = check(typeof config === 'string' ? config : JSON.stringify(config));
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, saying);
};

test("the template's own renovate.json passes", () => {
  const run = check(readFileSync(join(template, 'renovate.json'), 'utf8'));
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /nothing merges itself/u);
});

test('a document that is not an object is not a checked policy', () => {
  for (const text of ['null', '[]', '"automerge"', '7', 'true']) {
    refuses(text, /not an object/u);
  }
});

test('a literal automerge anywhere refuses', () => {
  refuses({ automerge: true }, /automerge is true/u);
  refuses(
    { packageRules: [{ matchDepTypes: ['devDependencies'], automerge: true }] },
    /automerge/u,
  );
  refuses({ platformAutomerge: true, packageRules: [] }, /platformAutomerge is true/u);
});

test('a preset that turns automerge on refuses, at the top or inside a rule', () => {
  refuses({ extends: [':automergeAll'] }, /:automergeAll/u);
  refuses({ extends: ['config:recommended', ':automergePatch'] }, /:automergePatch/u);
  refuses(
    { packageRules: [{ matchPackageNames: ['x'], extends: [':automergeMinor'] }] },
    /:automergeMinor/u,
  );
});

test('a preset nobody has checked refuses, since what it sets cannot be read here', () => {
  refuses({ extends: ['github>someone/presets'] }, /github>someone\/presets/u);
  refuses({ extends: ['config:best-practices'] }, /config:best-practices/u);
});

test('an extends that is not a list of preset names refuses', () => {
  refuses({ extends: ':automergeAll' }, /extends/u);
  refuses({ extends: [{ automerge: true }] }, /extends/u);
});

test('the checked presets pass', () => {
  const run = check(JSON.stringify({ extends: ['config:recommended', ':semanticCommits'] }));
  assert.equal(run.status, 0, run.stderr);
});
