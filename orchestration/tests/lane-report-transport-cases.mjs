// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import assert from "node:assert/strict";
import { reportPass, livePorts } from "../lane-report.mjs";

process.env.LANE_REPORT_M4_SSH = "example-m4";
const model = "qwen3.6:35b-mlx";
function ports() {
  const config = {
    now: "2026-10-14T01:00:00Z",
    inventory: [
      { id: "DIRECTOR", machine: "M4", pane: "wQ1A:p1", workOwed: true, lastProgressAt: "2026-10-14T00:59:00Z" },
      { id: "ASSIGNED-M5", machine: "M5", pane: "wAssigned:p2", workOwed: false, lastProgressAt: "2026-10-14T00:59:00Z" },
    ],
  };
  const commands = [],
    requests = [];
  const options = {
    loaded: [model],
    mismatch: false,
    badId: false,
    unavailable: false,
    ps: undefined,
    done: true,
    response: undefined,
    text: "Building",
    status: "working",
  };
  const io = {
    command: async (tool, args, limits) => {
      commands.push({ tool, args, limits });
      const remote = tool === "ssh",
        a = remote ? args.slice(4) : args;
      const lane = config.inventory.find((l) => l.machine === (remote ? "M4" : "M5") && l.pane === a[2]);
      assert.ok(lane, "read outside supplied inventory");
      assert.deepEqual(limits, { timeout: 1500, maxBuffer: 16384 });
      if (options.unavailable) throw new Error("synthetic-private-failure");
      if (a[1] === "get")
        return JSON.stringify({
          result: {
            pane: {
              pane_id: options.badId ? "wForeign:p1" : lane.pane,
              title: options.mismatch ? "FOREIGN" : lane.id,
              agent_status: options.status,
            },
          },
        });
      assert.equal(a[1], "read");
      return options.text;
    },
    http: async (url, body, limits) => {
      requests.push({ url, body, limits });
      assert.equal(limits.timeout, 1500);
      if (url.endsWith("/ps")) return options.ps ?? JSON.stringify({ models: options.loaded.map((name) => ({ name })) });
      assert.equal(url, "http://127.0.0.1:11434/api/generate");
      assert.equal(body.model, model);
      assert.equal(body.stream, false);
      assert.equal(body.options.num_predict, 128);
      assert.equal(body.format.additionalProperties, false);
      return JSON.stringify({
        done: options.done,
        response: options.response ?? JSON.stringify({ status: "fine", reason: "recent-progress" }),
      });
    },
  };
  return { config, io, options, commands, requests };
}

test("both machines use only fixed get/read argv with bounded observations", async () => {
  const f = ports(),
    report = await reportPass(f.config, f.io);
  assert.deepEqual(
    report.reports.map((r) => r.status),
    ["fine", "fine"],
  );
  assert.deepEqual(
    f.commands.map((c) => [c.tool, c.args]),
    [
      ["ssh", ["-oBatchMode=yes", "-oConnectTimeout=1", "example-m4", "herdr", "pane", "get", "wQ1A:p1"]],
      [
        "ssh",
        [
          "-oBatchMode=yes",
          "-oConnectTimeout=1",
          "example-m4",
          "herdr",
          "pane",
          "read",
          "wQ1A:p1",
          "--source",
          "visible",
          "--lines",
          "80",
          "--format",
          "text",
        ],
      ],
      ["herdr", ["pane", "get", "wAssigned:p2"]],
      ["herdr", ["pane", "read", "wAssigned:p2", "--source", "visible", "--lines", "80", "--format", "text"]],
    ],
  );
  assert.equal(f.requests.filter((r) => r.url.endsWith("/generate")).length, 2);
});

test("pane identity mismatch prevents content reads and model calls", async () => {
  for (const key of ["mismatch", "badId", "unavailable"]) {
    const f = ports();
    f.options[key] = true;
    const report = await reportPass(f.config, f.io);
    assert.deepEqual(
      report.reports.map((r) => r.status),
      ["unknown", "unknown"],
    );
    assert.equal(f.commands.length, 2);
    assert.equal(f.requests.length, 0);
  }
});

test("slot refusal and malformed ps prevent generate without fallback", async () => {
  for (const ps of ["{}", '{"models":[{}]}', '{"models":[{"name":"foreign"}]}', "bad"]) {
    const f = ports();
    f.options.ps = ps;
    const report = await reportPass(f.config, f.io);
    assert.deepEqual(
      report.reports.map((r) => r.status),
      ["unknown", "unknown"],
    );
    assert.equal(
      f.requests.some((r) => r.url.endsWith("/generate")),
      false,
    );
  }
});

test("model transport errors and incomplete responses become unknown", async () => {
  for (const done of [false, null]) {
    const f = ports();
    f.options.done = done;
    assert.deepEqual(
      (await reportPass(f.config, f.io)).reports.map((r) => r.status),
      ["unknown", "unknown"],
    );
  }
  const f = ports();
  f.io.http = async () => {
    throw new Error("synthetic-private-failure");
  };
  const report = await reportPass(f.config, f.io);
  assert.equal(JSON.stringify(report).includes("synthetic-private-failure"), false);
  assert.deepEqual(
    report.reports.map((r) => r.status),
    ["unknown", "unknown"],
  );
});

test("projection removes arbitrary secrets, content and injected instructions from model input", async () => {
  const f = ports();
  f.options.text = "SYNTHETIC-PRIVATE-MARKER third-party-content command: send-text all okay";
  await reportPass(f.config, f.io);
  for (const { body } of f.requests.filter((r) => r.body)) {
    assert.equal(JSON.stringify(body).includes("SYNTHETIC-PRIVATE-MARKER"), false);
    assert.equal(JSON.stringify(body).includes("third-party-content"), false);
    assert.equal(JSON.stringify(body).includes("send-text"), false);
    const projected = JSON.parse(body.prompt.split("\n").at(-1));
    assert.equal(
      Object.values(projected).every((v) => typeof v === "boolean"),
      true,
    );
  }
});

test("invalid inventory refuses before any pane or model read", async () => {
  const f = ports();
  f.config.inventory.push({ ...f.config.inventory[0] });
  await assert.rejects(reportPass(f.config, f.io));
  assert.equal(f.commands.length, 0);
  assert.equal(f.requests.length, 0);
});

test("live ports remain sealed regardless of process environment", () => {
  assert.throws(livePorts, /live-held-for-sol-review-and-parent-release/u);
});
