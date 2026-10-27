// SPDX-License-Identifier: AGPL-3.0-only
// Cases for normalising the changed-file list git prints: whitespace, blank lines, repeats, order.
import assert from 'node:assert/strict';
import test from 'node:test';
import { changedFilesFrom } from '../../scripts/changed-files.mjs';

test('preserves first-seen path order', () => {
  assert.deepEqual(changedFilesFrom('docs/plan/ruleset.md\nscripts/pr-size.mjs'), [
    'docs/plan/ruleset.md',
    'scripts/pr-size.mjs',
  ]);
});

// Sol CF-05: a space is part of a git path. Trimming it turned ` docs/x.mjs`
// into the exempt `docs/x.mjs`.
test('keeps leading and trailing spaces, which are part of the path', () => {
  assert.deepEqual(changedFilesFrom(' docs/guard.mjs\nscripts/pr-size.mjs \n'), [
    ' docs/guard.mjs',
    'scripts/pr-size.mjs ',
  ]);
});

test('drops the carriage return of a CRLF line ending', () => {
  assert.deepEqual(changedFilesFrom('README.md\r\nNOTICE\r\n'), ['README.md', 'NOTICE']);
});

test('collapses repeated changed paths', () => {
  assert.deepEqual(changedFilesFrom('README.md\nREADME.md\nNOTICE'), ['README.md', 'NOTICE']);
});

test('empty input yields no paths', () => {
  assert.deepEqual(changedFilesFrom(''), []);
});

test('a trailing newline, as git prints one, adds no empty path', () => {
  assert.deepEqual(changedFilesFrom('README.md\n'), ['README.md']);
});

test('blank lines between paths are dropped', () => {
  assert.deepEqual(changedFilesFrom('README.md\n\nNOTICE\n'), ['README.md', 'NOTICE']);
});
