// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the owned text-file policy: ordinary text with a final newline passes, and each
// non-portable shape is reported.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { textFileFindings } from '../../scripts/text-file-policy.mjs';

test('accepts ordinary text with a final newline', () => {
  assert.deepEqual(textFileFindings([{ path: 'README.md', bytes: Buffer.from('Hello\n') }]), []);
});

test('reports each non-portable text shape', () => {
  assert.deepEqual(
    textFileFindings([
      { path: 'empty.md', bytes: Buffer.alloc(0) },
      { path: 'bom.md', bytes: Buffer.from([0xef, 0xbb, 0xbf, 0x78, 0x0a]) },
      { path: 'nul.md', bytes: Buffer.from([0x78, 0x00, 0x0a]) },
      { path: 'invalid.md', bytes: Buffer.from([0xff, 0x0a]) },
      { path: 'unterminated.md', bytes: Buffer.from('text') },
    ]),
    [
      'empty.md: empty',
      'bom.md: byte order mark',
      'nul.md: NUL byte',
      'invalid.md: invalid UTF-8',
      'unterminated.md: no final newline',
    ],
  );
});

/**
 * A scratch repository carrying this checkout's scripts, untracked, with
 * `tracked` written and added. The command reads the repository its scripts
 * sit in, so this is how a case runs it on something other than this one.
 */
function policyRun(t, tracked) {
  const root = mkdtempSync(join(tmpdir(), 'text-file-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['-C', root, 'init', '-q']);
  cpSync(resolve(import.meta.dirname, '../../scripts'), join(root, 'scripts'), { recursive: true });
  for (const [path, text] of Object.entries(tracked)) {
    writeFileSync(join(root, path), text);
    execFileSync('git', ['-C', root, 'add', path]);
  }
  const script = join(root, 'scripts/text-file-policy.mjs');
  return spawnSync(process.execPath, [script], { encoding: 'utf8' });
}

// Sol's CF-11 review, text-file-policy-cases.mjs:5: the command itself, not only its function.
test('the command exits 1 on a tracked owned file with no final newline, and 0 once it has one', (t) => {
  const refused = policyRun(t, { 'README.md': 'no final newline' });
  assert.equal(refused.status, 1, refused.stdout);
  assert.match(refused.stderr, /text-file-policy: README\.md: no final newline/u);
  const passed = policyRun(t, { 'README.md': 'a final newline\n' });
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /text-file-policy: 1 owned text file\(s\), 0 finding\(s\)/u);
});

// Sol's CF-11 review, text-file-policy.mjs:53: nothing read is not a pass.
test('an empty tracked owned file set is refused rather than certified', (t) => {
  const ran = policyRun(t, { 'notes.txt': 'not an owned path\n' });
  assert.equal(ran.status, 2, ran.stdout);
  assert.match(ran.stderr, /text-file-policy: no tracked owned text file/u);
});
