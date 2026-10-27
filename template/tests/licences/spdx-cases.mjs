// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the source header check over tracked, untracked and hook files, sparing vendored code.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const checker = resolve(import.meta.dirname, '../../scripts/spdx-check.mjs');
const header = '// SPDX-License-Identifier: AGPL-3.0-only\n';

test('source header check covers tracked, untracked and hook files without relicensing vendored code', () => {
  const root = mkdtempSync(join(tmpdir(), 'foundation-spdx-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    mkdirSync(join(root, 'scripts'));
    const source = join(root, 'scripts/run.mjs');
    writeFileSync(source, 'export const value = 1;\n');
    execFileSync('git', ['-C', root, 'add', '.']);
    const check = () => spawnSync(process.execPath, [checker, root], { encoding: 'utf8' }).status;
    assert.equal(check(), 1, 'tracked source without a header fails');
    writeFileSync(source, header + 'export const value = 1;\n');
    assert.equal(check(), 0, 'correct header passes');
    writeFileSync(source, header.replace('AGPL-3.0-only', 'Apache-2.0'));
    assert.equal(check(), 1, 'incorrect licence identifier fails');
    writeFileSync(source, header + header);
    assert.equal(check(), 1, 'duplicate headers fail');
    writeFileSync(source, header);
    writeFileSync(join(root, 'new.ts'), 'export const value = 1;\n');
    assert.equal(check(), 1, 'new untracked source is checked');
    rmSync(join(root, 'new.ts'));
    mkdirSync(join(root, '.husky'));
    const hook = join(root, '.husky/commit-msg');
    writeFileSync(hook, '#!/bin/sh\nexit 0\n');
    assert.equal(check(), 1, 'extensionless hook is checked');
    writeFileSync(hook, '#!/bin/sh\n# SPDX-License-Identifier: AGPL-3.0-only\nexit 0\n');
    assert.equal(check(), 0, 'shebang stays first');
    mkdirSync(join(root, '.claude/skills/vendor'), { recursive: true });
    writeFileSync(
      join(root, '.claude/skills/vendor/upstream.mjs'),
      '// SPDX-License-Identifier: MIT\n',
    );
    assert.equal(check(), 0, 'vendored licence stays unchanged');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Sol CF-07, 3 October: a check that passes over nothing, or over a marker that is not a comment.
function repository(run) {
  const root = mkdtempSync(join(tmpdir(), 'foundation-spdx-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    run(root, (status) =>
      assert.equal(
        spawnSync(process.execPath, [checker, root], { encoding: 'utf8' }).status,
        status,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a tracked source missing from the working tree is refused, not dropped', () =>
  repository((root, expect) => {
    writeFileSync(join(root, 'present.mjs'), header);
    writeFileSync(join(root, 'missing.mjs'), 'export const value = 1;\n');
    execFileSync('git', ['-C', root, 'add', '.']);
    rmSync(join(root, 'missing.mjs'));
    expect(2);
  }));

test('no owned source at all is refused: zero files is no evidence', () =>
  repository((root, expect) => {
    writeFileSync(join(root, 'README.md'), 'Prose only.\n');
    expect(2);
  }));

test('the header is the first line, or the second after a shebang, never string data', () =>
  repository((root, expect) => {
    const source = join(root, 'example.mjs');
    writeFileSync(source, 'export const value = `\n' + header + '`;\n');
    expect(1);
    writeFileSync(source, '// A note first.\n' + header);
    expect(1);
    writeFileSync(source, header + 'export const value = 1;\n');
    expect(0);
  }));

// Sol CF-07 round three: discovering source paths needs no GitHub or registry credential.
test('local Git never receives a GitHub or registry credential', () =>
  repository((root) => {
    writeFileSync(join(root, 'example.mjs'), header);
    const bin = mkdtempSync(join(tmpdir(), 'foundation-spdx-bin-'));
    try {
      const tokens = ['GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN'];
      const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
      writeFileSync(
        join(bin, 'git'),
        `#!/bin/sh\n: > '${bin}/ran'\n[ -n "${tokens.map((name) => `\${${name}:-}`).join('')}" ] && : > '${bin}/seen'\nexec '${realGit}' "$@"\n`,
      );
      chmodSync(join(bin, 'git'), 0o755);
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
      for (const name of tokens) env[name] = 'synthetic-unused';
      const result = spawnSync(process.execPath, [checker, root], { encoding: 'utf8', env });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(existsSync(join(bin, 'ran')), 'the real local Git ran');
      assert.equal(existsSync(join(bin, 'seen')), false, 'a credential reached local Git');
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  }));

// Sol CF-07 round five: each language has its own comment, so `//` in shell is a command.
const spdx = (comment) => `${comment} SPDX-License-Identifier: AGPL-3.0-only\n`;
test("the header uses its own language's comment delimiter, never another's", () =>
  repository((root) => {
    const status = () => spawnSync(process.execPath, [checker, root], { encoding: 'utf8' }).status;
    mkdirSync(join(root, '.husky'));
    for (const [path, own, others] of [
      ['run.sh', '#', ['//', '--']],
      ['run.py', '#', ['//', '--']],
      ['.husky/pre-commit', '#', ['//', '--']],
      ['schema.sql', '--', ['//', '#']],
      ['value.ts', '//', ['#', '--']],
      ['value.mjs', '//', ['#', '--']],
    ]) {
      const shebang = path.startsWith('.husky/') ? '#!/bin/sh\n' : '';
      writeFileSync(join(root, path), shebang + spdx(own) + 'exit 0\n');
      assert.equal(status(), 0, `${path} with ${own}`);
      for (const comment of others) {
        writeFileSync(join(root, path), shebang + spdx(comment) + 'exit 0\n');
        assert.equal(status(), 1, `${path} with ${comment}`);
      }
      rmSync(join(root, path));
    }
  }));

// Sol's CF-07-FIX5: when Git cannot start, nothing was listed, so nothing passes.
test('a Git that cannot start is refused, never a pass', () =>
  repository((root) => {
    writeFileSync(join(root, 'example.mjs'), header);
    const empty = mkdtempSync(join(tmpdir(), 'foundation-spdx-nogit-'));
    try {
      const env = { ...process.env, PATH: empty };
      const result = spawnSync(process.execPath, [checker, root], { encoding: 'utf8', env });
      assert.equal(result.status, 2, 'no Git ran, so no source was checked');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }));
