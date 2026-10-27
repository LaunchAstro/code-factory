// Independent fix-pass proofs for 238046a3959e2d0deb1b8a22c63aab99bb179665.
// All renders are actual GitHub gh api markdown responses recorded for these bodies.
// Run: node --test orchestration/tests/sol-206-fix-proof-cases.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fixture, head } from './enqueue-fixture.mjs';
const renders = JSON.parse(readFileSync(new URL('./sol-206-fix-rendered.json', import.meta.url), 'utf8'));
const prefix = '**Why:** the reason.\n**Left undone:** none\nCloses #7\n';
const warning = 'WARN gate=section reason=missing required-from=2026-11-01';
const writes = f => f.recorded().filter(a => a.join(' ').includes('enqueuePullRequest') || a[1]?.endsWith('/merge'));
function body(section, queue) { return prefix + section + (queue ? '' : '\n**Risk:** low, the reason.'); }
function setup(t, section, queue = true, now = '2026-11-02T00:00:00Z') {
  const f = fixture(t, { ENQUEUE_NOW: now });
  f.pr.isMergeQueueEnabled = queue;
  f.pr.body = body(section, queue);
  assert.equal(typeof renders[f.pr.body], 'string', 'real rendered fixture exists');
  f.data.markdown = { byText: renders };
  return f;
}
function final(f, section, queue = true) {
  f.data.final = { body: { data: { repository: { pullRequest: { ...f.pr, body: body(section, queue) } } } } };
}
function allowed(f, queue) {
  const r = f.run();
  assert.equal(r.status, 0, `${r.stdout}mutations=${writes(f).length}`);
  assert.equal(r.stdout.trim(), queue ? `ENQUEUED #17 head=${head}` : `MERGED #17 head=${head} method=merge risk=low`);
  assert.equal(writes(f).length, 1);
}
function malformed(f) {
  const r = f.run();
  assert.equal(r.status, 1, `${r.stdout}mutations=${writes(f).length}`);
  assert.equal(r.stdout.trim(), 'WAIT gate=section reason=malformed');
  assert.equal(writes(f).length, 0);
}
for (const queue of [true, false]) {
  const path = queue ? 'queue' : 'direct';
  for (const section of ['Section: **checks', 'Section: checks**']) {
    test(`Sol proof, criterion 4: unmatched bold ${JSON.stringify(section)} is malformed on the ${path} path`, t => {
      malformed(setup(t, section, queue, '2026-10-20T00:00:00Z'));
    });
  }
  for (const section of ['Section: **checks**.', '**Section: checks**.', 'Section: **`checks`**.']) {
    test(`Sol proof, criterion 8: bold plus closing full stop ${JSON.stringify(section)} is accepted on the ${path} path`, t => {
      allowed(setup(t, section, queue), queue);
    });
  }
  for (const section of ['Section: **checks.**', 'Section: `checks`.', '**Section: `checks`.**', '**Section:** **checks**', 'Section: **checks**']) {
    test(`Sol control: valid ${JSON.stringify(section)} passes on the ${path} path`, t => {
      allowed(setup(t, section, queue), queue);
    });
  }
  for (const section of ['Section: checks..', 'Section: checks`', 'Section: `checks']) {
    test(`Sol control: malformed ${JSON.stringify(section)} waits on the ${path} path`, t => {
      malformed(setup(t, section, queue, '2026-10-20T00:00:00Z'));
    });
  }
}
test('Sol proof, criterion 8: adding Section between reads removes the first warning', t => {
  const f = setup(t, '', true, '2026-10-20T00:00:00Z');
  final(f, 'Section: checks');
  allowed(f, true);
  assert.equal(f.recorded().filter(a => a[1] === 'markdown').length, 2);
});
test('Sol control: adding Section during direct reads waits without mutation', t => {
  const f = setup(t, '', false, '2026-10-20T00:00:00Z');
  final(f, 'Section: checks', false);
  const r = f.run();
  assert.equal(r.status, 1, r.stdout);
  assert.equal(r.stdout.trim(), 'WAIT gate=description reason=changed-during-reads');
  assert.equal(writes(f).length, 0);
});
test('Sol proof, criterion 4: unmatched bold introduced between reads waits without mutation', t => {
  const f = setup(t, 'Section: checks', true, '2026-10-20T00:00:00Z');
  final(f, 'Section: **checks');
  malformed(f);
});
