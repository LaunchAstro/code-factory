// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const cli = new URL('../declare.mjs', import.meta.url).pathname;
const config = {
  schemaVersion: 1,
  projectId: 'fixture',
  aliases: ['FX'],
  repositories: ['example/product', 'example/roadmap'],
  sections: ['checks', 'engine'],
  sectionSource: 'https://example.invalid/diagram',
};
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cf-declare-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'project.json'), JSON.stringify(config));
  return {
    root,
    dir: join(root, 'ledgers'),
    configPath: join(root, 'project.json'),
  };
}
function run(f, command, record) {
  return spawnSync(process.execPath, [cli, command, '--config', f.configPath, '--dir', f.dir], {
    input: record === undefined ? undefined : JSON.stringify(record),
    encoding: 'utf8',
  });
}
test('project identifier must be a string even when a numeric value matches the token alphabet', (t) => {
  const f = fixture(t);
  writeFileSync(f.configPath, JSON.stringify({ ...config, projectId: 123 }));
  assert.equal(run(f, 'read').status, 1);
});
