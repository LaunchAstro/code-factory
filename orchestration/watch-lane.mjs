// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseEventLine } from "./events.mjs";
import { time } from "./watch-github.mjs";
import { appendReport } from "./watch-report.mjs";

/** @typedef {{id: string, status: string, branch: string, worktree: string, pane: string, startedAt: string, lastPushAt?: string}} Lane */
/** @typedef {{repo: string, log: string, state: string, settings: string, now: string, lanes: string}} Config */
/** @typedef {{minutes: number, timeout: number, maxBuffer: number}} Limits */
/** @typedef {{version: number, repo: string, stalls: Record<string, string|null>}} State */

/** @param {string} value */
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} value @param {number} now */
function past(value, now) {
  const stamp = time(value);
  if (stamp > now) throw new Error("future-time");
  return stamp;
}

/** @param {string} file @returns {Lane[]} */
function lanesOf(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (data.version !== 1 || !Array.isArray(data.lanes))
    throw new Error("lanes-shape");
  const ids = new Set();
  for (const lane of data.lanes) {
    if (
      !lane ||
      typeof lane.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(lane.id) ||
      ids.has(lane.id) ||
      !["working", "ready", "parked", "wrapped"].includes(lane.status)
    )
      throw new Error("lane-identity");
    ids.add(lane.id);
  }
  return data.lanes.filter(
    (/** @type {Lane} */ lane) => lane.status === "working",
  );
}

/** @param {Config} config @returns {Limits} */
function limitsOf(config) {
  const s = JSON.parse(readFileSync(config.settings, "utf8")).laneWatch;
  if (
    !Number.isFinite(s?.minutes) ||
    s.minutes <= 0 ||
    !Number.isSafeInteger(s.readTimeoutMs) ||
    s.readTimeoutMs <= 0 ||
    !Number.isSafeInteger(s.maxBufferBytes) ||
    s.maxBufferBytes <= 0
  )
    throw new Error("settings-invalid");
  return {
    minutes: s.minutes,
    timeout: s.readTimeoutMs,
    maxBuffer: s.maxBufferBytes,
  };
}

/** @param {string} tool @param {string[]} args @param {Limits} limits */
function read(tool, args, limits) {
  return execFileSync(tool, args, {
    encoding: "utf8",
    timeout: limits.timeout,
    maxBuffer: limits.maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** @param {Config} config @param {Limits} limits @param {number} now */
function pushesOf(config, limits, now) {
  const pages = JSON.parse(
    read(
      "gh",
      [
        "api",
        `repos/${config.repo}/events?per_page=100`,
        "--paginate",
        "--slurp",
      ],
      limits,
    ),
  );
  if (
    !Array.isArray(pages) ||
    !pages.length ||
    pages.some((p) => !Array.isArray(p) || p.length > 100)
  )
    throw new Error("push-pages");
  const events = pages.flat();
  if (events.length > 300) throw new Error("push-limit");
  let oldest = now;
  /** @type {Map<string, number>} */
  const pushes = new Map();
  for (const event of events) {
    if (
      !event ||
      typeof event.type !== "string" ||
      typeof event.created_at !== "string"
    )
      throw new Error("push-event");
    const stamp = past(event.created_at, now);
    oldest = Math.min(oldest, stamp);
    if (event.type !== "PushEvent") continue;
    const ref = event.payload?.ref;
    if (typeof ref !== "string" || !ref.startsWith("refs/heads/"))
      throw new Error("push-ref");
    pushes.set(ref, Math.max(pushes.get(ref) ?? 0, stamp));
  }
  // GitHub retains at most 300 events. A saturated recent feed cannot prove silence.
  if (events.length === 300 && oldest > now - limits.minutes * 60000)
    throw new Error("push-coverage");
  return pushes;
}

/** @param {Limits} limits */
function panesOf(limits) {
  const data = JSON.parse(read("herdr", ["pane", "list"], limits));
  const panes = data?.result?.panes;
  if (data?.result?.type !== "pane_list" || !Array.isArray(panes))
    throw new Error("pane-shape");
  /** @type {Map<string, string>} */
  const states = new Map();
  for (const pane of panes) {
    if (
      !pane ||
      typeof pane.pane_id !== "string" ||
      typeof pane.agent_status !== "string" ||
      states.has(pane.pane_id)
    )
      throw new Error("pane-record");
    states.set(pane.pane_id, pane.agent_status);
  }
  return states;
}

/** @param {Lane} lane @param {Limits} limits @param {number} now */
function commitOf(lane, limits, now) {
  if (
    typeof lane.worktree !== "string" ||
    !isAbsolute(lane.worktree) ||
    typeof lane.branch !== "string" ||
    !/^w[A-Za-z0-9]+:p[1-9]\d*$/u.test(lane.pane)
  )
    throw new Error("lane-shape");
  // Let Git validate literal branch names, without interpreting checkout shorthand.
  if (
    read("git", ["check-ref-format", "--branch", lane.branch], limits).replace(
      /\n$/u,
      "",
    ) !== lane.branch
  )
    throw new Error("branch-invalid");
  const stamp = read(
    "git",
    [
      "-C",
      lane.worktree,
      "log",
      "--no-walk",
      "-1",
      "--format=%cI",
      `refs/heads/${lane.branch}`,
      "--",
    ],
    limits,
  ).trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/u.test(stamp)
  )
    throw new Error("commit-time");
  time(`${stamp.slice(0, 19)}Z`);
  const date = new Date(stamp);
  if (!Number.isFinite(date.getTime()) || date.getTime() > now)
    throw new Error("commit-time");
  return date.getTime();
}

/** @param {Config} config @param {string[]} lines @returns {State} */
function stateOf(config, lines) {
  /** @type {State} */
  let state = { version: 1, repo: config.repo, stalls: {} };
  try {
    const saved = JSON.parse(readFileSync(config.state, "utf8"));
    if (
      saved.version !== 1 ||
      typeof saved.repo !== "string" ||
      !saved.stalls ||
      Array.isArray(saved.stalls) ||
      typeof saved.stalls !== "object" ||
      Object.entries(saved.stalls).some(
        ([key, value]) =>
          !/^[a-f0-9]{64}$/u.test(key) ||
          (value !== null &&
            (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))),
      )
    )
      throw new Error("state-shape");
    if (saved.repo === config.repo) state = saved;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw new Error("state-unreadable");
  }
  for (const line of lines) {
    const e = parseEventLine(line);
    if (
      e.type !== "LANE-WATCH" ||
      e.actor !== "WATCH" ||
      e.fields.repo !== config.repo
    )
      continue;
    const key = e.fields.instance;
    if (!key || !/^[a-f0-9]{64}$/u.test(key)) continue;
    const status = e.message.split(" ")[0];
    if (status === "SUSPECTED-STALL") {
      const stall = e.fields["stall-key"];
      if (stall && /^[a-f0-9]{64}$/u.test(stall)) state.stalls[key] = stall;
    } else if (status === "OK" || status === "WAITING")
      state.stalls[key] = null;
  }
  return state;
}

/** @param {Config} config @param {string} lane @param {string} message */
function report(config, lane, message) {
  appendReport(
    config.log,
    `${config.now} WATCH LANE-WATCH ${message} lane=${lane} repo=${config.repo}`,
    "LANE-WATCH",
  );
}

/** @param {Lane} lane @param {string[]} lines @param {number} now */
function activityOf(lane, lines, now) {
  const start = past(lane.startedAt, now);
  let last = start;
  let ordinal = -1;
  let boot = -1;
  let reason = "none";
  let activeTool;
  for (const [i, line] of lines.entries()) {
    const e = parseEventLine(line);
    if (e.type === "unknown" || e.actor !== lane.id || e.actor === "WATCH")
      continue;
    const stamp = past(e.timestamp, now);
    if (stamp < start) continue;
    last = Math.max(last, stamp);
    ordinal = i;
    if (e.type === "BOOTED") {
      boot = i;
      reason = "none";
    } else if (e.type === "PAUSED" && e.fields.reason === "owner")
      reason = "owner-pause";
    else if (e.type === "WAITING" && e.fields.reason === "review")
      reason = "review-wait";
    else if (
      (e.type === "RUN-START" && e.fields.tool) ||
      (e.type === "WAITING" && e.fields.reason === "tool")
    ) {
      reason = "long-running-tool";
      activeTool = e.fields.tool;
    } else if (
      e.type === "DONE" &&
      e.fields.tool &&
      reason === "long-running-tool" &&
      (activeTool === undefined || activeTool === e.fields.tool)
    )
      reason = "none";
    else if (
      [
        "PROGRESS",
        "PUSHED",
        "FIX-PUSHED",
        "READY",
        "WRAPPED",
        "PARKED",
      ].includes(e.type)
    )
      reason = "none";
  }
  return { last, ordinal, boot, reason, start };
}

/** One read-only pass. A failed lane read cannot borrow health from a sibling.
 * @param {Config} config */
export function laneWatch(config) {
  let lanes;
  try {
    lanes = lanesOf(config.lanes);
  } catch {
    report(config, "unknown", "UNKNOWN reason=lane-records-unreadable");
    return 1;
  }
  let limits, lines, state, pushes, panes;
  const now = time(config.now);
  try {
    limits = limitsOf(config);
    lines = readFileSync(config.log, "utf8").split(/\r?\n/u);
    state = stateOf(config, lines);
    if (!lanes.length) return 0;
    pushes = pushesOf(config, limits, now);
    panes = panesOf(limits);
  } catch {
    for (const lane of lanes)
      report(config, lane.id, "UNKNOWN reason=read-failed");
    return 1;
  }
  let failed = false;
  for (const lane of lanes) {
    let message, key, stall;
    try {
      const activity = activityOf(lane, lines, now);
      const commit = commitOf(lane, limits, now);
      const push = Math.max(
        activity.start,
        lane.lastPushAt === undefined
          ? activity.start
          : past(lane.lastPushAt, now),
        pushes.get(`refs/heads/${lane.branch}`) ?? 0,
      );
      const pane = panes.get(lane.pane) ?? "absent";
      if (!["working", "blocked", "idle", "done", "absent"].includes(pane))
        throw new Error("pane-status");
      const ages = [activity.last, commit, push].map(
        (stamp) => (now - stamp) / 60000,
      );
      const silent = ages.every((age) => age >= limits.minutes);
      const status =
        activity.reason !== "none"
          ? "WAITING"
          : silent
            ? "SUSPECTED-STALL"
            : "OK";
      key = hash(
        JSON.stringify([
          config.repo,
          lane.id,
          lane.branch,
          lane.worktree,
          lane.pane,
          lane.startedAt,
          activity.boot,
        ]),
      );
      stall =
        status === "SUSPECTED-STALL"
          ? hash(
              JSON.stringify([
                key,
                activity.last,
                activity.ordinal,
                commit,
                push,
              ]),
            )
          : null;
      if (stall !== null && state.stalls[key] === stall) continue;
      message = `${status} reason=${activity.reason === "none" ? (silent ? "no-event+no-commit+no-push" : "recent-activity") : activity.reason} silence=${silent ? "no-event+no-commit+no-push" : "below-threshold"} pane=${lane.pane} pane-state=${pane} event-minutes=${ages[0]} commit-minutes=${ages[1]} push-minutes=${ages[2]} threshold-minutes=${limits.minutes} instance=${key}${stall === null ? "" : ` stall-key=${stall}`}`;
    } catch {
      report(config, lane.id, "UNKNOWN reason=lane-read-failed");
      failed = true;
      continue;
    }
    report(config, lane.id, message);
    state.stalls[key] = stall;
  }
  writeFileSync(config.state, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  return failed ? 1 : 0;
}
