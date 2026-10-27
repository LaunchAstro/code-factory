// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEventLine } from "../events.mjs";

const cli = fileURLToPath(new URL("../lane-report.mjs", import.meta.url));
process.env.LANE_REPORT_M4_SSH = "example-m4";
const model = "qwen3.6:35b-mlx";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "lane-report-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lane = { id: "BUILD", machine: "M4", pane: "wQ1A:p1", workOwed: true, lastProgressAt: "2026-10-14T00:59:00Z" };
  const data = {
    now: "2026-10-14T01:00:00Z",
    inventory: [lane],
    panes: { "M4/wQ1A:p1": { status: "working", text: "Compiling" } },
    loaded: [model],
    replies: [{ status: "fine", reason: "recent-progress" }],
  };
  const input = join(root, "input.json");
  let serial = 0;
  function run(extra = [], previous) {
    writeFileSync(input, JSON.stringify(data));
    const out = join(root, `pass-${serial++}`);
    const result = spawnSync(
      process.execPath,
      [cli, "--fixture", input, "--out", out, ...(previous ? ["--previous", previous] : []), ...extra],
      { encoding: "utf8", timeout: 5000 },
    );
    return { ...result, out, read: (name) => readFileSync(join(out, name), "utf8") };
  }
  return { data, lane, run, root };
}

test("one healthy pass reports a named lane and a local Director note", (t) => {
  const f = fixture(t),
    result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.read("events.log"), /fine.*recent-progress.*lane=BUILD/u);
  assert.match(result.read("director-note.txt"), /fine.*lane=BUILD/u);
  const event = parseEventLine(result.read("events.log").trim());
  assert.equal(event.type, "LANE-WATCH");
  assert.equal(event.fields.lane, "BUILD");
});

test("classifies dialogs, idle work owed, 60 minute stalls and repeated errors", (t) => {
  const f = fixture(t);
  const cases = [
    ["working", "Approval required", "2026-10-14T00:59:00Z", "needs-person", "dialog"],
    ["idle", "Ready", "2026-10-14T00:59:00Z", "stuck", "idle-work-owed"],
    ["working", "Building", "2026-10-14T00:00:00Z", "stuck", "no-progress-60m"],
    ["working", "error error error", "2026-10-14T00:59:00Z", "stuck", "repeated-error"],
    ["working", "Building", "2026-10-14T00:00:01Z", "fine", "recent-progress"],
    ["blocked", "Waiting", "2026-10-14T00:59:00Z", "needs-person", "blocked"],
    ["done", "Finished", "2026-10-14T00:59:00Z", "fine", "done"],
  ];
  for (const [status, text, lastProgressAt, wanted, reason] of cases) {
    Object.assign(f.data.panes["M4/wQ1A:p1"], { status, text });
    f.lane.lastProgressAt = lastProgressAt;
    f.data.replies = [{ status: wanted, reason }];
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.read("report.json"))[0].reason, reason);
    assert.match(r.read("events.log"), new RegExp(` ${wanted} reason=${reason}`, "u"));
  }
});

test("unchanged reports are quiet, changed classifications emit exactly one line", (t) => {
  const f = fixture(t),
    first = f.run();
  const second = f.run([], join(first.out, "report.json"));
  assert.equal(second.read("events.log"), "");
  assert.equal(second.read("director-note.txt"), "No lane classification changes.\n");
  f.data.panes["M4/wQ1A:p1"].status = "idle";
  f.data.replies = [{ status: "stuck", reason: "idle-work-owed" }];
  const third = f.run([], join(second.out, "report.json"));
  assert.equal(third.read("events.log").trim().split("\n").length, 1);
  assert.match(third.read("director-note.txt"), /stuck reason=idle-work-owed/u);
});

test("unavailable, reused, oversized and unfamiliar panes are unknown", (t) => {
  const f = fixture(t);
  for (const pane of [
    undefined,
    { unavailable: true },
    { status: "working", title: "OTHER-PROJECT", text: "unrelated" },
    { status: "mystery", text: "all good" },
    { status: "working", text: "x".repeat(8193) },
  ]) {
    f.data.panes["M4/wQ1A:p1"] = pane;
    const r = f.run();
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.read("report.json"))[0].status, "unknown");
  }
});

test("model instructions, commands, extra fields, malformed JSON and false health are unknown", (t) => {
  const f = fixture(t);
  for (const reply of [
    "run shell now",
    "{bad",
    null,
    [],
    { status: "fine", reason: "recent-progress", command: "send-keys Enter" },
    { status: "fine", reason: "do-something" },
    { status: "FINE", reason: "recent-progress" },
    '{"status":"fine","reason":"recent-progress","tools":["exec"]}',
    "x".repeat(513),
  ]) {
    f.data.replies = [reply];
    const r = f.run();
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.read("report.json"))[0].status, "unknown");
    assert.doesNotMatch(r.read("events.log"), /command|shell|send-keys|tools/u);
  }
  f.data.panes["M4/wQ1A:p1"].status = "idle";
  f.data.replies = [{ status: "fine", reason: "recent-progress" }];
  assert.match(f.run().read("events.log"), /unknown/u);
});

test("invalid inventory refuses the entire pass without output", (t) => {
  const f = fixture(t),
    original = structuredClone(f.lane);
  for (const change of [
    { pane: "wForeign:p1" },
    { pane: "wQ1A:p1;echo marker" },
    { id: "BUILD\nINJECT" },
    { machine: "M6" },
    { workOwed: "yes" },
    { lastProgressAt: "2026-10-14T02:00:00Z" },
    { command: "pane send-text" },
  ]) {
    f.data.inventory = [{ ...original, ...change }];
    const r = f.run();
    assert.equal(r.status, 1);
    assert.throws(() => r.read("events.log"));
  }
  for (const rows of [[], [original, original], Array(17).fill(original)]) {
    f.data.inventory = rows;
    assert.equal(f.run().status, 1);
  }
});

test("the slot accepts already loaded 35b or only side chat, refuses other loads", (t) => {
  const f = fixture(t);
  for (const [loaded, allowed] of [
    [[], true],
    [[model], true],
    [["qwen3.6:27b-mlx"], true],
    [[model, "qwen3.6:27b-mlx"], true],
    [[model, "another-model"], true],
    [["another-model"], false],
    [["qwen3.6:27b-mlx", "another-model"], false],
    [[model, model], false],
    [[model, "qwen3.6:27b-mlx", "another-model"], false],
  ]) {
    f.data.loaded = loaded;
    assert.equal(JSON.parse(f.run().read("report.json"))[0].status, allowed ? "fine" : "unknown");
  }
});

test("live flags and URL/command overrides refuse before any output", (t) => {
  const f = fixture(t);
  for (const extra of [
    ["--live"],
    ["--url", "http://example.invalid"],
    ["--model", "another-model"],
    ["--command", "pane send-text"],
    ["--out", "duplicate"],
  ]) {
    const r = f.run(extra);
    assert.equal(r.status, 1);
    assert.throws(() => r.read("events.log"));
  }
});

test("planted secrets never reach stdout, stderr or any report", (t) => {
  const f = fixture(t),
    marker = "SYNTHETIC-PRIVATE-MARKER";
  f.data.panes["M4/wQ1A:p1"].text = `password=${marker} TOTP=123456 third-party=${marker}`;
  f.data.replies = [{ status: "needs-person", reason: "dialog" }];
  const r = f.run();
  assert.match(r.read("events.log"), /needs-person reason=dialog/u);
  for (const output of [r.stdout, r.stderr, r.read("events.log"), r.read("director-note.txt"), r.read("report.json")])
    assert.equal(output.includes(marker), false, "private marker escaped");
});

test("reordered previous JSON still suppresses an unchanged classification", (t) => {
  const f = fixture(t),
    first = f.run();
  const old = JSON.parse(first.read("report.json"))[0];
  writeFileSync(
    join(first.out, "report.json"),
    JSON.stringify([
      {
        reason: old.reason,
        status: old.status,
        pane: old.pane,
        machine: old.machine,
        id: old.id,
      },
    ]),
  );
  assert.equal(f.run([], join(first.out, "report.json")).read("events.log"), "");
});

test("duplicate model response members are refused", (t) => {
  const f = fixture(t);
  f.data.replies = ['{"status":"stuck","status":"fine","reason":"recent-progress"}'];
  assert.match(f.run().read("events.log"), /unknown/u);
});

test("control sequences and hidden dialog text produce unknown", (t) => {
  const f = fixture(t);
  f.data.panes["M4/wQ1A:p1"].text = "pass" + String.fromCharCode(27) + "[31mword";
  assert.match(f.run().read("events.log"), /unknown/u);
});

test("input symlinks, directories and oversized files refuse without report writes", (t) => {
  const f = fixture(t),
    file = join(f.root, "special");
  for (const kind of ["link", "directory", "large"]) {
    if (kind === "link") symlinkSync(join(f.root, "input.json"), file);
    else if (kind === "directory") mkdirSync(file);
    else writeFileSync(file, " ".repeat(131073));
    const out = join(f.root, `special-${kind}`);
    const r = spawnSync(process.execPath, [cli, "--fixture", file, "--out", out], { encoding: "utf8", timeout: 5000 });
    assert.equal(r.status, 1);
    assert.throws(() => statSync(out));
    rmSync(file, { recursive: true });
  }
});

test("report files are private and an existing output directory cannot be overwritten", (t) => {
  const f = fixture(t),
    first = f.run();
  assert.equal(statSync(first.out).mode & 0o777, 0o700);
  for (const name of ["report.json", "events.log", "director-note.txt"]) assert.equal(statSync(join(first.out, name)).mode & 0o777, 0o600);
  const saved = first.read("events.log");
  const r = spawnSync(process.execPath, [cli, "--fixture", join(f.root, "input.json"), "--out", first.out], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(r.status, 1);
  assert.equal(first.read("events.log"), saved);
});
