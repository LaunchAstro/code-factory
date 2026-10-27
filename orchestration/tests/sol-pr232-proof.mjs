// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./hosted-precheck-fixture.mjs";

const mutateMain = (f, file, contents) => {
  f.git("checkout", "-q", "-B", "sol-main", "origin/main");
  writeFileSync(join(f.clone, file), contents);
  f.git("add", file);
  f.git("commit", "-q", "-m", "chore: main advances");
  f.git("push", "-q", "origin", "HEAD:main");
};

test("Sol proof, criterion 1: a multi-head batch cannot post a failure before a hosted run exists", (t) => {
  const f = fixture(t);
  mutateMain(f, "a.txt", "main conflicts with PR11\n");
  const result = f.start(11, 12);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(f.statuses(), [], "start posted a failure for #11 with no hosted run or run URL");
});

test("Sol proof, criterion 1: a completed batch is closed and deleted when its logs are unreadable", (t) => {
  const f = fixture(t);
  const start = f.start(11, 12);
  assert.equal(start.status, 0, start.stdout + start.stderr);
  const state = f.state(start.stdout);
  f.routes.logs = { match: f.routes.logs.match, exit: 1 };
  const result = f.run("finish", "--state", state.file);
  assert.deepEqual(f.statuses(), []);
  assert.ok(f.calls().some((a) => a[1] === "repos/fixture/repo/pulls/500" && a.includes("PATCH")),
    `completed run abandoned its draft: exit=${result.status} ${result.stderr}`);
  assert.ok(f.calls().some((a) => a[1].includes("/git/refs/heads/") && a.includes("DELETE")));
});

test("Sol proof, criterion 1: failed draft cleanup can be retried after a completed run", (t) => {
  const f = fixture(t);
  const start = f.start(11, 12);
  assert.equal(start.status, 0, start.stdout + start.stderr);
  const state = f.state(start.stdout);
  f.routes.close = { match: f.routes.close.match, seq: [{ exit: 1 }, { body: {} }] };
  const first = f.run("finish", "--state", state.file);
  assert.match(first.stdout, /close failed/);
  const retry = f.run("finish", "--state", state.file);
  const closes = f.calls().filter((a) => a[1] === "repos/fixture/repo/pulls/500" && a.includes("PATCH"));
  assert.equal(closes.length, 2, `failed cleanup was made permanent: ${retry.stdout}`);
});
