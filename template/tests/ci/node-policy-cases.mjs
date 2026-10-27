// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the Node version policy: one matching major accepted, drift and ranges refused.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkNodePolicy } from '../../scripts/node-policy-check.mjs';

test('accepts one matching Node major', () => {
  assert.deepEqual(checkNodePolicy('24\n', '>=24'), []);
});

test('refuses version drift', () => {
  assert.deepEqual(checkNodePolicy('24', '>=22'), [
    '.nvmrc and engines.node must name the same major',
  ]);
});

test('refuses ranges and malformed selectors', () => {
  assert.deepEqual(checkNodePolicy('lts/*', '^24.0.0'), [
    '.nvmrc must contain one positive major version',
    'engines.node must be an exact >= major floor',
  ]);
});

test('refuses an engines.node that is not a string', () => {
  for (const engine of [['>=24'], 24, { node: '>=24' }])
    assert.deepEqual(
      checkNodePolicy('24', engine),
      ['engines.node must be an exact >= major floor'],
      JSON.stringify(engine),
    );
});

// The CLI reads the repository it sits in, so each run is a copy of it in a
// throwaway one.
const scripts = resolve(import.meta.dirname, '../../scripts');

// Planted in the inputs the cases malform. The CLI may name a file, never quote one.
const MARKER = ['CF08', 'PLANTED', 'MARKER'].join('_');

/**
 * The CLI's result in a throwaway repository with this `.nvmrc` and manifest.
 * Every CLI case runs it here, so every case also proves the output: no line
 * quotes an input, and no line is anything but the check's own `node-policy: `
 * report.
 */
function cliRun(t, nvmrc, engine, manifest = JSON.stringify({ engines: { node: engine } })) {
  const root = mkdtempSync(resolve(tmpdir(), 'node-policy-cases-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, 'scripts'));
  for (const name of ['node-policy-check.mjs', 'main-module.mjs'])
    copyFileSync(resolve(scripts, name), resolve(root, 'scripts', name));
  writeFileSync(resolve(root, '.nvmrc'), nvmrc);
  writeFileSync(resolve(root, 'package.json'), manifest);
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/node-policy-check.mjs')], {
    encoding: 'utf8',
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(output.includes(MARKER), false, 'the CLI quoted an input');
  assert.ok(
    output.split('\n').every((line) => line === '' || line.startsWith('node-policy: ')),
    'the CLI printed a line that is not its own report',
  );
  return result;
}

test('the CLI exits non-zero on a policy problem and zero without one', (t) => {
  const run = (nvmrc, engine) => cliRun(t, nvmrc, engine);
  assert.equal(run('24\n', '>=24').status, 0);
  const drift = run('24\n', '>=22');
  assert.equal(drift.status, 1, drift.stdout);
  assert.match(drift.stderr, /must name the same major/u);
});

test('the CLI exits 1 on a malformed selector, an array engines.node included', (t) => {
  for (const [nvmrc, engine, problem] of [
    ['24\n', ['>=24'], /engines\.node must be an exact >= major floor/u],
    ['24\n', `^24.0.0-${MARKER}`, /engines\.node must be an exact >= major floor/u],
    [`lts/${MARKER}\n`, '>=24', /\.nvmrc must contain one positive major version/u],
  ]) {
    const result = cliRun(t, nvmrc, engine);
    assert.equal(result.status, 1, String(Array.isArray(engine)));
    assert.match(result.stderr, problem);
  }
});

test('the CLI refuses a manifest that is not JSON, or repeats a key, by naming it', (t) => {
  for (const [shape, manifest] of Object.entries({
    'a trailing comma': `{"secret":"${MARKER}",}`,
    'a key with no value': `{"${MARKER}":}`,
    'a repeated top-level key': `{"engines":{"node":">=24"},"engines":{"node":"${MARKER}"}}`,
    'a repeated nested key': `{"engines":{"node":">=24","node":"${MARKER}"}}`,
    'not an object': `["${MARKER}"]`,
    null: 'null',
  })) {
    const result = cliRun(t, '24\n', undefined, manifest);
    assert.equal(result.status, 2, shape);
    assert.match(result.stderr, /package\.json/u, shape);
  }
});

test('the CLI reads a real manifest: escapes, nested arrays, one key in two objects', (t) => {
  const manifest = String.raw`{"engines":{"node":">=24"},"other":{"node":"caf\u00E9","list":[[1],[2,[3]]]}}`;
  assert.equal(cliRun(t, '24\n', undefined, manifest).status, 0);
});
