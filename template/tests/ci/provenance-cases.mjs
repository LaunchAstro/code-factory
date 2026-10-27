// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the commit-msg hook: a message declares the model and tool that actually wrote the change.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { isPlatformMergeCommit, validateProvenance } from '../../scripts/provenance.mjs';

const repo = resolve(import.meta.dirname, '../..');
const agent = '\n\nAssisted-by: LLM\nAgent-model: declared-test-model\nAgent-tool: fixture-tool';
const human = '\n\nSigned-off-by: Fixture Person <fixture@example.invalid>';
const cases = [
  ['complete agent declaration', `fix: valid declaration${agent}`, true],
  [
    'invalid assistance value',
    `fix: invalid assistance${agent.replace('LLM', 'not-an-llm-declaration')}`,
    false,
  ],
  ['lowercase assistance value', `fix: invalid assistance${agent.replace('LLM', 'llm')}`, false],
  [
    'conflicting assistance duplicate',
    `fix: invalid assistance${agent}\nAssisted-by: automation`,
    false,
  ],
  [
    'conflicting model duplicate',
    `fix: invalid assistance${agent}\nAgent-model: another-declared-model`,
    false,
  ],
  ['human declaration', `docs: human declaration${human}`, true],
  [
    'human template placeholder',
    'docs: template declaration\n\nSigned-off-by: [actual person] <fixture@example.invalid>',
    false,
  ],
  ['human review of agent work', `fix: reviewed declaration${agent}${human}`, true],
  ['missing provenance', 'fix: missing declaration', false],
  ['partial provenance', 'fix: partial declaration\n\nAssisted-by: LLM', false],
  ['empty values', 'fix: empty declaration\n\nAssisted-by:\nAgent-model:\nAgent-tool:', false],
  ['partial with human declaration', `fix: partial declaration${human}\nAssisted-by: LLM`, false],
  [
    'template model',
    `fix: template declaration${agent.replace('declared-test-model', '<actual-model-id>')}`,
    false,
  ],
  [
    'template tool',
    `fix: template declaration${agent.replace('fixture-tool', '[actual tool]')}`,
    false,
  ],
  [
    'placeholder token',
    `fix: template declaration${agent.replace('declared-test-model', 'TODO')}`,
    false,
  ],
  ['empty duplicate', `fix: duplicate declaration${agent}\nAgent-model:`, false],
  ['invalid human declaration', `fix: invalid declaration${agent}\nSigned-off-by: Someone`, false],
  ['nonconventional subject', `made changes${agent}`, false],
  ['unknown conventional type', `wibble: changes${agent}`, false],
];

for (const [label, body, accepted] of cases) {
  test(`actual commit-msg hook: ${label}`, () => {
    const fixture = mkdtempSync(join(tmpdir(), 'hub-message-'));
    try {
      const path = join(fixture, 'message');
      writeFileSync(path, body);
      const result = spawnSync('sh', [join(repo, '.husky/commit-msg'), path], {
        cwd: repo,
        encoding: 'utf8',
      });
      assert.equal(result.status === 0, accepted, `hook exit ${result.status}: ${label}`);
      assert.equal(
        readFileSync(path, 'utf8'),
        body,
        'the hook must not add or rewrite declarations',
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}

test('the commit template requires the author to declare the actual model and tool', () => {
  const template = readFileSync(join(repo, '.gitmessage'), 'utf8');
  assert.match(template, /^Agent-model: <actual-model-id>$/mu);
  assert.match(template, /^Agent-tool: <actual-tool>$/mu);
  assert.doesNotMatch(template, /^Signed-off-by:/mu);
});

test('pure provenance requires exact assistance values and rejects conflicting agent declarations', () => {
  const valid = 'Assisted-by: LLM\nAgent-model: synthetic-model\nAgent-tool: synthetic-tool';
  assert.deepEqual(validateProvenance(valid), []);
  for (const block of [
    valid.replace('LLM', 'automation'),
    valid.replace('LLM', 'llm'),
    `${valid}\nAssisted-by: automation`,
    `${valid}\nAgent-model: another-model`,
  ]) {
    assert.ok(validateProvenance(block).length > 0);
  }
});

// The ruleset requires merge commits and GitHub writes them with no trailers.
// Three things must hold at once for the exemption, and the wording of the
// subject is not one of them. The third, already on the base's history, is
// what stops a branch writing a commit that exempts itself.
test("GitHub's own merge commit is the only commit exempt from provenance", () => {
  const webFlow = { name: 'GitHub', email: 'noreply@github.com' };
  const person = { name: 'A Person', email: 'person@example.invalid' };
  const merge = { parents: ['a', 'b'], onBaseHistory: true };

  assert.equal(isPlatformMergeCommit({ ...merge, author: person, committer: webFlow }), true);
  assert.equal(
    isPlatformMergeCommit({
      ...merge,
      author: person,
      committer: { name: 'web-flow', email: 'noreply@github.com' },
    }),
    true,
  );

  const refused = [
    ['an ordinary identity', { ...merge, author: person, committer: person }],
    ['the web-flow claim on the author alone', { ...merge, author: webFlow, committer: person }],
    ['one parent', { parents: ['a'], onBaseHistory: true, author: person, committer: webFlow }],
    [
      'an octopus merge, which GitHub does not write',
      { parents: ['a', 'b', 'c'], onBaseHistory: true, author: person, committer: webFlow },
    ],
    [
      'the name without the address',
      { ...merge, author: person, committer: { name: 'GitHub', email: 'someone@example.invalid' } },
    ],
    [
      'no parents at all',
      { parents: [], onBaseHistory: true, author: webFlow, committer: webFlow },
    ],
    [
      'a commit the branch introduces',
      { parents: ['a', 'b'], onBaseHistory: false, author: person, committer: webFlow },
    ],
    [
      'nothing said about the base history',
      { parents: ['a', 'b'], author: person, committer: webFlow },
    ],
  ];
  for (const [label, commit] of refused) {
    assert.equal(isPlatformMergeCommit(commit), false, label);
  }
});
