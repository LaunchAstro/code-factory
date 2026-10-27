// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the skill reference gate, run as the command on a scratch skills tree.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

/**
 * Runs this checkout's skill-refs command in a scratch repository whose
 * .claude/skills holds an exclusion list naming `arena` plus `files`. A path
 * ending in `/` is a directory. The command reads the repository its scripts
 * sit in, so the scripts are copied there.
 */
function skillRefs(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'skill-refs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(resolve(import.meta.dirname, '../../scripts'), join(root, 'scripts'), { recursive: true });
  for (const [path, text] of Object.entries({
    '_shared/excluded-skills.txt': 'arena\n',
    ...files,
  })) {
    const full = join(root, '.claude/skills', path);
    mkdirSync(path.endsWith('/') ? full : dirname(full), { recursive: true });
    if (!path.endsWith('/')) writeFileSync(full, text);
  }
  return spawnSync(process.execPath, [join(root, 'scripts/skill-refs-check.mjs')], {
    encoding: 'utf8',
  });
}

// Sol's CF-11 review, skill-refs-check.mjs:124: the refusal had no hostile case.
test('a pointer to an excluded skill is refused, however it is written', (t) => {
  for (const text of ['Run `/arena`.\n', 'Run it as an `arena`.\n', 'Read (arena/SKILL.md).\n']) {
    const ran = skillRefs(t, { '_shared/notes.md': text });
    assert.equal(ran.status, 1, `${text}${ran.stdout}`);
    assert.match(ran.stderr, /_shared\/notes\.md: points at arena/u);
  }
  assert.equal(skillRefs(t, { '_shared/notes.md': 'An arena of ideas.\n' }).status, 0);
  assert.equal(
    skillRefs(t, { '_shared/notes.md': '# Notes\n', 'tdd/SKILL.md': '`/arena`\n' }).status,
    0,
  );
});

// Sol's CF-11 review, skill-refs-check.mjs:79: nothing read is not a pass.
test('an empty owned Markdown set is refused rather than certified', (t) => {
  for (const files of [{}, { 'tdd/SKILL.md': '# A vendored skill\n' }]) {
    const ran = skillRefs(t, files);
    assert.equal(ran.status, 2, ran.stdout);
    assert.match(ran.stderr, /skill-refs: no Markdown file this repository wrote/u);
    assert.doesNotMatch(ran.stdout, /every reference resolves/u);
  }
});

// Sol's CF-11 review, skill-refs-check.mjs:105: a directory is not the file the header promises.
test('a link to a directory is refused, and a link to a file resolves', (t) => {
  const directory = skillRefs(t, { '_shared/notes.md': '[d](folder)\n', '_shared/folder/': '' });
  assert.equal(directory.status, 1, directory.stdout);
  assert.match(directory.stderr, /_shared\/notes\.md: link to folder does not resolve to a file/u);
  const file = skillRefs(t, {
    '_shared/notes.md': '[f](other.md)\n',
    '_shared/other.md': '# Other\n',
  });
  assert.equal(file.status, 0, file.stderr);
});

// Sol's CF-11 review, skill-refs-check.mjs:31: tilde and unclosed fences were read as references.
test('a fenced example is not a reference, under the CommonMark fence rule', (t) => {
  const status = (text) => skillRefs(t, { '_shared/notes.md': text }).status;
  assert.equal(status('~~~md\n[example](missing.md)\n~~~\n'), 0);
  assert.equal(status('```md\n[example](missing.md)\n'), 0);
  assert.equal(status('````\n```\n[example](missing.md)\n```\n'), 0);
  assert.equal(status('~~~\n`/arena`\n~~~\n'), 0);
  assert.equal(status('```\n~~~\n```\n[visible](missing.md)\n'), 1);
});

// Sol's CF-11-FIX1 review, skill-refs-cases.mjs:21: every case named `arena`,
// so disabling the empty-list refusal left all four cases green.
test('an exclusion list that names nothing is refused rather than certified', (t) => {
  for (const list of ['', '# nothing excluded\n', '\n   \n# arena is a comment here\n']) {
    const ran = skillRefs(t, {
      '_shared/excluded-skills.txt': list,
      '_shared/notes.md': '# Notes\n',
    });
    assert.equal(ran.status, 2, `${JSON.stringify(list)}\n${ran.stdout}`);
    assert.match(ran.stderr, /skill-refs: the exclusion list is empty/u);
    assert.doesNotMatch(ran.stdout, /every reference resolves/u);
  }
});
