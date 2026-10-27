#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { constants, openSync, closeSync, fstatSync, readSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { isMainModule } from "./main-module.mjs";
import { execFileSync } from "node:child_process";
import { request } from "node:http";

const MODEL = "qwen3.6:35b-mlx",
  SIDECHAT = "qwen3.6:27b-mlx";
const M4 = new Set(["wQ1A", "wQ1B", "wQ1C", "wQ1D"]);
const LIMITS = Object.freeze({ timeout: 1500, maxBuffer: 16384 });
const URL = "http://127.0.0.1:11434/api/";
const UNKNOWN = Object.freeze({ status: "unknown", reason: "unavailable" });
// Only a reviewed source change and the parent's release may open this seal.
const LIVE_RELEASED = false;
const fail = () => {
  throw new Error("invalid-input");
};
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).length === keys.length && keys.every((k) => Object.hasOwn(x, k));
const label = (x) => typeof x === "string" && /^[A-Z][A-Za-z0-9_.-]{0,63}$/u.test(x);
function stamp(x) {
  if (typeof x !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(x)) fail();
  const n = Date.parse(x);
  if (!Number.isFinite(n) || new Date(n).toISOString().replace(".000Z", "Z") !== x) fail();
  return n;
}
function parseInventory(rows, now) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 16) fail();
  const ids = new Set(),
    panes = new Set();
  for (const row of rows) {
    if (
      !exact(row, ["id", "machine", "pane", "workOwed", "lastProgressAt"]) ||
      !label(row.id) ||
      !["M4", "M5"].includes(row.machine) ||
      typeof row.pane !== "string" ||
      !/^w[A-Za-z0-9]+:p[1-9]\d{0,2}$/u.test(row.pane) ||
      (row.machine === "M4" && !M4.has(row.pane.split(":")[0])) ||
      typeof row.workOwed !== "boolean" ||
      stamp(row.lastProgressAt) > now ||
      ids.has(row.id) ||
      panes.has(`${row.machine}/${row.pane}`)
    )
      fail();
    ids.add(row.id);
    panes.add(`${row.machine}/${row.pane}`);
  }
  return rows;
}

export function readCommand(lane, operation) {
  if (!["get", "read"].includes(operation)) fail();
  const args = [
    "pane",
    operation,
    lane.pane,
    ...(operation === "read" ? ["--source", "visible", "--lines", "80", "--format", "text"] : []),
  ];
  if (lane.machine === "M5") return ["herdr", args];
  const m4 = process.env.LANE_REPORT_M4_SSH ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(m4)) fail();
  return ["ssh", ["-oBatchMode=yes", "-oConnectTimeout=1", m4, "herdr", ...args]];
}

/** Never evict, change service settings or choose another model. */
export function sharedSlot(models) {
  if (!Array.isArray(models) || models.length > 2 || models.some((m) => typeof m !== "string") || new Set(models).size !== models.length)
    return false;
  return models.includes(MODEL) || models.every((m) => m === SIDECHAT);
}

// Redaction by projection: no original pane text or private value enters a prompt.
function signals(lane, status, text, now) {
  if (!["working", "idle", "done", "blocked"].includes(status) || typeof text !== "string" || Buffer.byteLength(text) > 8192) fail();
  if ([...text].some((c) => c.charCodeAt(0) < 32 && !["\n", "\r", "\t"].includes(c))) fail();
  return {
    dialog: /\b(permission|approval required|password|totp|verification code|confirm)\b/iu.test(text),
    repeatedError: (text.match(/\b(error|failed|exception)\b/giu) ?? []).length >= 3,
    idleOwed: status === "idle" && lane.workOwed,
    noProgress: status === "working" && now - stamp(lane.lastProgressAt) >= 3600000,
    blocked: status === "blocked",
    recent: status === "working",
    done: status === "done",
  };
}
function expected(s) {
  if (s.dialog) return { status: "needs-person", reason: "dialog" };
  if (s.repeatedError) return { status: "stuck", reason: "repeated-error" };
  if (s.idleOwed) return { status: "stuck", reason: "idle-work-owed" };
  if (s.noProgress) return { status: "stuck", reason: "no-progress-60m" };
  if (s.blocked) return { status: "needs-person", reason: "blocked" };
  return { status: "fine", reason: s.recent ? "recent-progress" : s.done ? "done" : "idle-no-work" };
}
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "reason"],
  properties: {
    status: { enum: ["fine", "stuck", "needs-person"] },
    reason: {
      enum: ["dialog", "repeated-error", "idle-work-owed", "no-progress-60m", "blocked", "recent-progress", "done", "idle-no-work"],
    },
  },
};

function paneIdentity(pane, lane) {
  if (!object(pane) || pane.pane_id !== lane.pane) return false;
  const clean = (title) => title.replace(/^[\u2800-\u28ff✳] /u, "");
  const named = (title) => {
    if (typeof title !== "string" || title.length > 256 || /[\p{C}]/u.test(title)) return false;
    const parts = title.split(" | ");
    return parts.length === 1 ? parts[0] === lane.id : parts.length === 2 && parts[0].trim() !== "" && parts[1] === lane.id;
  };
  const titles = ["title", "terminal_title", "terminal_title_stripped"].filter((key) => Object.hasOwn(pane, key));
  return (
    titles.length > 0 &&
    titles.every((key) =>
      key === "title"
        ? pane[key] === lane.id
        : named(key === "terminal_title" && typeof pane[key] === "string" ? clean(pane[key]) : pane[key]) &&
          (key !== "terminal_title_stripped" || clean(pane[key]) === pane[key]),
    ) &&
    (!Object.hasOwn(pane, "terminal_title") ||
      !Object.hasOwn(pane, "terminal_title_stripped") ||
      clean(pane.terminal_title) === pane.terminal_title_stripped)
  );
}

/** One pass. io is the transport boundary, exercised with fakes until release. */
export async function reportPass(config, io) {
  const now = stamp(config.now),
    lanes = parseInventory(config.inventory, now);
  const previous = config.previous ?? [];
  if (
    !Array.isArray(previous) ||
    previous.length > 16 ||
    previous.some(
      (row) =>
        !exact(row, ["id", "machine", "pane", "status", "reason"]) ||
        !label(row.id) ||
        !["fine", "stuck", "needs-person", "unknown"].includes(row.status) ||
        ![...SCHEMA.properties.reason.enum, "unavailable"].includes(row.reason) ||
        !["M4", "M5"].includes(row.machine) ||
        typeof row.pane !== "string",
    )
  )
    fail();
  const reports = [];
  for (const lane of lanes) {
    let result = UNKNOWN;
    try {
      const meta = JSON.parse(await io.command(...readCommand(lane, "get"), LIMITS));
      const pane = meta?.result?.pane;
      // Refuse a reused pane before reading any pane contents.
      if (!paneIdentity(pane, lane)) fail();
      const text = await io.command(...readCommand(lane, "read"), LIMITS);
      const observation = signals(lane, pane.agent_status, text, now);
      const loaded = JSON.parse(await io.http(`${URL}ps`, undefined, LIMITS));
      if (!object(loaded) || !Array.isArray(loaded.models) || !sharedSlot(loaded.models.map((m) => m?.name))) fail();
      const body = {
        model: MODEL,
        stream: false,
        keep_alive: "5m",
        format: SCHEMA,
        options: { temperature: 0, num_predict: 128, num_ctx: 2048 },
        prompt:
          "Classify these fixed lane signals. Priority: dialog, repeatedError, idleOwed, noProgress, blocked, recent, done, idle-no-work. Return only status and reason.\n" +
          JSON.stringify(observation),
      };
      const answer = JSON.parse(await io.http(`${URL}generate`, body, LIMITS));
      if (answer?.done !== true || typeof answer.response !== "string" || answer.response.length > 512) fail();
      const value = JSON.parse(answer.response),
        wanted = expected(observation);
      if (
        !exact(value, ["status", "reason"]) ||
        value.status !== wanted.status ||
        value.reason !== wanted.reason ||
        answer.response.replace(/\s/gu, "") !== JSON.stringify(value)
      )
        fail();
      result = value;
    } catch {
      /* Unavailable or untrusted input must never become fine. */
    }
    reports.push({ id: lane.id, machine: lane.machine, pane: lane.pane, ...result });
  }
  const changed = reports.filter((row) => !previous.some((old) => Object.keys(row).every((key) => row[key] === old[key])));
  const lines = changed.map(
    (row) => `${config.now} WATCH LANE-WATCH ${row.status} reason=${row.reason} lane=${row.id} machine=${row.machine} pane=${row.pane}`,
  );
  return {
    reports,
    events: lines.join("\n") + (lines.length ? "\n" : ""),
    note: lines.length ? lines.join("\n") + "\n" : "No lane classification changes.\n",
  };
}

/** No flag, environment variable or fixture can release live I/O. */
export function livePorts() {
  if (!LIVE_RELEASED) throw new Error("live-held-for-sol-review-and-parent-release");
  return {
    command: async (tool, args) =>
      execFileSync(tool, args, {
        ...LIMITS,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "", USER: process.env.USER ?? "" },
      }),
    http: (url, body) =>
      new Promise((resolveResult, reject) => {
        if (![`${URL}ps`, `${URL}generate`].includes(url)) return reject(new Error("endpoint-refused"));
        const req = request(
          {
            hostname: "127.0.0.1",
            port: 11434,
            path: body === undefined ? "/api/ps" : "/api/generate",
            method: body === undefined ? "GET" : "POST",
            agent: false,
            headers: { "Content-Type": "application/json" },
          },
          (res) => {
            if (res.statusCode !== 200) {
              res.destroy();
              req.destroy(new Error("http-failed"));
              return;
            }
            let bytes = 0;
            const chunks = [];
            res.on("data", (chunk) => {
              bytes += chunk.length;
              if (bytes > LIMITS.maxBuffer) req.destroy(new Error("response-limit"));
              else chunks.push(chunk);
            });
            res.on("error", reject);
            res.on("end", () => resolveResult(Buffer.concat(chunks).toString("utf8")));
          },
        );
        const deadline = setTimeout(() => req.destroy(new Error("read-timeout")), LIMITS.timeout);
        req.on("close", () => clearTimeout(deadline));
        req.on("error", reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      }),
  };
}

function readJSON(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 131072) fail();
    const buffer = Buffer.alloc(131073),
      bytes = readSync(fd, buffer, 0, buffer.length, 0);
    if (bytes > 131072) fail();
    return JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
  } finally {
    closeSync(fd);
  }
}
async function main(args) {
  const live = args.includes("--live");
  const liveIO = live ? livePorts() : undefined;
  if (live) args = args.filter((arg) => arg !== "--live");
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      ![...(live ? ["--inventory", "--now"] : ["--fixture"]), "--out", "--previous"].includes(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--") ||
      args[i] in opts
    )
      fail();
    opts[args[i]] = args[i + 1];
  }
  if (!(live ? opts["--inventory"] : opts["--fixture"]) || !opts["--out"]) fail();
  const fixture = live
    ? { now: opts["--now"] ?? new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"), inventory: readJSON(opts["--inventory"]) }
    : readJSON(opts["--fixture"]);
  let reply = 0;
  const result = await reportPass(
    { now: fixture.now, inventory: fixture.inventory, previous: opts["--previous"] ? readJSON(opts["--previous"]) : [] },
    liveIO ?? {
      command: async (tool, argv) => {
        const remote = tool === "ssh",
          a = remote ? argv.slice(4) : argv;
        const lane = fixture.inventory.find((l) => l.machine === (remote ? "M4" : "M5") && l.pane === a[2]);
        const pane = fixture.panes[`${lane.machine}/${lane.pane}`];
        if (!pane || pane.unavailable) fail();
        return a[1] === "get"
          ? JSON.stringify({
              result: {
                pane: {
                  pane_id: lane.pane,
                  title: pane.title ?? lane.id,
                  agent_status: pane.status,
                },
              },
            })
          : pane.text;
      },
      http: async (url) =>
        url === `${URL}ps`
          ? JSON.stringify({ models: fixture.loaded.map((name) => ({ name })) })
          : JSON.stringify({
              done: true,
              response: typeof fixture.replies[reply] === "string" ? fixture.replies[reply++] : JSON.stringify(fixture.replies[reply++]),
            }),
    },
  );
  // New directories prevent overwrites and concurrent state races.
  const out = resolve(opts["--out"]);
  mkdirSync(out, { mode: 0o700 });
  for (const [name, text] of [
    ["events.log", result.events],
    ["director-note.txt", result.note],
    ["report.json", JSON.stringify(result.reports) + "\n"],
  ])
    writeFileSync(join(out, name), text, { mode: 0o600, flag: "wx" });
  console.log(`lane-report: ${result.reports.length} lane(s), ${live ? "released-live" : "fixture-only"}`);
}
Promise.resolve()
  .then(() => {
    if (isMainModule(import.meta.url)) return main(process.argv.slice(2));
  })
  .catch(() => {
    console.error("lane-report: refused-or-unavailable; live requires Sol review and parent release");
    process.exitCode = 1;
  });
