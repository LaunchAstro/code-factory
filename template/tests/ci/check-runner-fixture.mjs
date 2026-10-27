// SPDX-License-Identifier: AGPL-3.0-only
// The throwaway repository and stub package manager the check runner cases
// run in.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const template = resolve(import.meta.dirname, '../..');

// Sol's review of CF-10: the cases in check-runner-cases.mjs passed with the
// runner's failure return changed to success. The check-runner-*-cases.mjs
// files run the actual runner in a throwaway repository, with a package
// manager that passes, fails, or edits the tree at the step it is told to.
export const git = (root, ...args) =>
  spawnSync(
    'git',
    ['-C', root, '-c', 'user.name=Runner case', '-c', 'user.email=runner@example.invalid'].concat([
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      ...args,
    ]),
    { encoding: 'utf8' },
  );

// `folder` is where the runner lives and runs, below the repository's top.
export function repository(t, folder = '.') {
  const temporary = mkdtempSync(join(tmpdir(), 'check-runner-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const top = join(temporary, 'repository');
  const root = join(top, folder);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const file of ['check.mjs', 'check-summary.mjs', 'main-module.mjs', 'build.mjs']) {
    copyFileSync(join(template, 'scripts', file), join(root, 'scripts', file));
  }
  writeFileSync(join(top, '.gitignore'), '*.local\n');
  writeFileSync(join(root, 'product.json'), '{"name":"Fixture"}\n');
  assert.equal(git(top, 'init', '-q').status, 0);
  assert.equal(git(top, 'add', '.').status, 0);
  assert.equal(git(top, 'commit', '-qm', 'fixture').status, 0);
  const manager = join(temporary, 'package-manager');
  writeFileSync(
    manager,
    [
      '#!/bin/sh',
      '# Called by the runner as: <manager> run <script>',
      'case "$2" in',
      '  "$FAIL_AT") exit "$FAIL_STATUS" ;;',
      `  "$EDIT_AT") cp "$EDIT_FILE" saved.local; printf 'edited\\n' > "$EDIT_FILE" ;;`,
      '  "$RESTORE_AT") git checkout -q -- product.json ;;',
      '  "$PUT_BACK_AT") cp saved.local "$EDIT_FILE" ;;',
      '  "$COMMIT_AT") git -c user.name=Runner -c user.email=runner@example.invalid \\',
      '    -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -q --allow-empty -m between ;;',
      '  "$UNCOMMIT_AT") git reset -q --soft HEAD~1 ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const runner = (env = {}) => {
    const result = spawnSync(process.execPath, [join(root, 'scripts/check.mjs')], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        npm_execpath: manager,
        FAIL_AT: '',
        FAIL_STATUS: '1',
        EDIT_AT: '',
        RESTORE_AT: '',
        PUT_BACK_AT: '',
        EDIT_FILE: 'product.json',
        COMMIT_AT: '',
        UNCOMMIT_AT: '',
        ...env,
      },
    });
    const record = join(root, '.check-summary.local');
    const summary = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : null;
    return { ...result, summary };
  };
  return { root, top, temporary, runner };
}
