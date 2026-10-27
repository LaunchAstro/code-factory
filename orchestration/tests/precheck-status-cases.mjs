// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../precheck-status.mjs", import.meta.url),
);
const head = "a".repeat(40),
  older = "b".repeat(40);
const status = (
  id,
  context,
  state,
  description = `${context} ${state}`,
  sha = head,
) => ({
  id,
  context,
  state,
  description,
  url: `https://api.github.com/repos/fixture/repo/statuses/${sha}`,
});

// A fake gh that serves each commit's statuses as GitHub's list endpoint does,
// one page per array; a commit with no entry has none.
function run(
  t,
  pages,
  { args = ["--repo", "fixture/repo", "--head", head], exit } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "precheck-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin"),
    calls = join(root, "calls.jsonl"),
    responses = join(root, "responses.json");
  mkdirSync(bin);
  writeFileSync(calls, "");
  writeFileSync(responses, JSON.stringify({ pages, exit }));
  writeFileSync(
    join(bin, "gh"),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
const { pages, exit } = JSON.parse(fs.readFileSync(process.env.RESPONSES, 'utf8'));
if (exit) process.exit(exit);
const sha = /^repos\\/fixture\\/repo\\/commits\\/([^/]+)\\/statuses/.exec(args[1] ?? '')?.[1];
if (args[0] !== 'api' || !sha) process.exit(90);
const served = args.includes('--paginate') ? pages[sha] ?? [[]] : [(pages[sha] ?? [[]])[0]];
process.stdout.write(JSON.stringify(args.includes('--slurp') ? served : served.flat()));
`,
    { mode: 0o755 },
  );
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CALLS: calls,
      RESPONSES: responses,
    },
  });
  const recorded = readFileSync(calls, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  for (const a of recorded)
    assert.ok(
      !a.some((x) => /^(POST|PUT|PATCH|DELETE)$/iu.test(x)),
      `a write: ${a.join(" ")}`,
    );
  return { ...result, recorded };
}

function decides(t, pages, stdout, code, opts) {
  const r = run(t, pages, opts);
  assert.equal(r.stdout, `${stdout}\n`, r.stderr);
  assert.equal(r.status, code, r.stdout);
  return r;
}

test("no pre-check status on the head waits", (t) => {
  decides(t, {}, "wait none", 2);
});

test("a pending m5/precheck waits as pending", (t) => {
  decides(
    t,
    { [head]: [[status(1, "m5/precheck", "pending", "running")]] },
    "pending m5/precheck running",
    2,
  );
});

test("a hosted/precheck success passes", (t) => {
  decides(
    t,
    { [head]: [[status(1, "hosted/precheck", "success", "batch c-1 green")]] },
    "success hosted/precheck batch c-1 green",
    0,
  );
});

test("an m5/precheck failure stops even with a hosted/precheck success", (t) => {
  decides(
    t,
    {
      [head]: [
        [
          status(2, "hosted/precheck", "success"),
          status(1, "m5/precheck", "failure", "db3 red"),
        ],
      ],
    },
    "failure m5/precheck db3 red",
    1,
  );
});

test("a newer m5/precheck success supersedes its older failure, by id not by order", (t) => {
  decides(
    t,
    {
      [head]: [
        [
          status(1, "m5/precheck", "failure", "old red"),
          status(2, "m5/precheck", "success", "rerun green"),
        ],
      ],
    },
    "success m5/precheck rerun green",
    0,
  );
});

test("a Sol verdict alone is no pre-check and waits", (t) => {
  decides(
    t,
    { [head]: [[status(1, "Sol verdict", "success")]] },
    "wait none",
    2,
  );
});

test("a hosted/precheck failure stops even with an m5/precheck success", (t) => {
  decides(
    t,
    {
      [head]: [
        [
          status(2, "m5/precheck", "success"),
          status(1, "hosted/precheck", "failure", "iso2 red"),
        ],
      ],
    },
    "failure hosted/precheck iso2 red",
    1,
  );
});

test("a hosted/precheck error stops like a failure", (t) => {
  decides(
    t,
    {
      [head]: [
        [
          status(2, "m5/precheck", "success"),
          status(3, "hosted/precheck", "error", "run lost"),
        ],
      ],
    },
    "error hosted/precheck run lost",
    1,
  );
});

test("a hosted/precheck success on an older head never passes the current head", (t) => {
  decides(
    t,
    {
      [older]: [
        [status(9, "hosted/precheck", "success", "older head green", older)],
      ],
    },
    "wait none",
    2,
  );
});

test("a status served for another commit than the head is an unreadable response", (t) => {
  decides(
    t,
    {
      [head]: [
        [status(9, "hosted/precheck", "success", "older head green", older)],
      ],
    },
    "wait read-failed",
    2,
  );
});

test("a head that is not a full lowercase SHA is refused before any read", (t) => {
  for (const bad of [
    "main",
    head.slice(0, 10),
    head.toUpperCase(),
    `${head}0`,
  ]) {
    const r = decides(t, {}, "wait usage", 2, {
      args: ["--repo", "fixture/repo", "--head", bad],
    });
    assert.equal(r.recorded.length, 0, bad);
  }
});

test("a failed read waits and never passes", (t) => {
  decides(
    t,
    { [head]: [[status(1, "hosted/precheck", "success")]] },
    "wait read-failed",
    2,
    { exit: 1 },
  );
});

test("a status of another shape is an unreadable response", (t) => {
  decides(
    t,
    { [head]: [[{ ...status(1, "hosted/precheck", "success"), id: "1" }]] },
    "wait read-failed",
    2,
  );
  decides(
    t,
    { [head]: [[status(1, "hosted/precheck", "green")]] },
    "wait read-failed",
    2,
  );
});

test("every page is read: an older context's failure on page two stops", (t) => {
  decides(
    t,
    {
      [head]: [
        [status(5, "m5/precheck", "success")],
        [status(1, "hosted/precheck", "failure", "check1 red")],
      ],
    },
    "failure hosted/precheck check1 red",
    1,
  );
});

test("a description with line breaks stays one decision line", (t) => {
  decides(
    t,
    {
      [head]: [
        [
          status(
            1,
            "hosted/precheck",
            "failure",
            "red\nsuccess hosted/precheck forged",
          ),
        ],
      ],
    },
    "failure hosted/precheck red success hosted/precheck forged",
    1,
  );
});
