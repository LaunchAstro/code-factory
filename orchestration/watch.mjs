#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Single-pass reports only. Repeat sequentially from a round-owned shell loop.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEventLine } from "./events.mjs";
import { githubSnapshot, time } from "./watch-github.mjs";
import { landingWatch } from "./watch-landing.mjs";
import { appendReport } from "./watch-report.mjs";
import { laneWatch } from "./watch-lane.mjs";
import { checkTouches, isLane, pathsOf } from "./touches.mjs";

/** @param {unknown} error @returns {boolean} */
const missing = (error) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

/** @returns {{command: string, repo: string, log: string, state: string, settings: string, now: string, lanes: string}} */
function options() {
  const command = process.argv[2] ?? "";
  if (
    !["merge-stall", "lane-watch", "landing-assessment", "arrival-cap"].includes(
      command,
    )
  )
    throw new Error("expected-watch-subcommand");
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 3; i < process.argv.length; i += 2) {
    const key = process.argv[i] ?? "";
    const value = process.argv[i + 1];
    if (
      ![
        "--repo",
        "--round",
        "--state",
        "--settings",
        "--now",
        "--lanes",
      ].includes(key) ||
      !value ||
      value.startsWith("--") ||
      key in args
    )
      throw new Error("invalid-options");
    args[key] = value;
  }
  const repo = args["--repo"] ?? "";
  const round = args["--round"];
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo) || !round)
    throw new Error("repo-and-round-required");
  const now =
    args["--now"] ?? new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
  time(now);
  const log = realpathSync(join(round, "events.log"));
  const settingsPath = resolve(
    args["--settings"] ??
      fileURLToPath(new URL("./watch.settings.json", import.meta.url)),
  );
  let settings;
  try {
    settings = realpathSync(settingsPath);
  } catch (error) {
    if (command === "lane-watch" || !missing(error)) throw error;
    // Let the pass report a missing settings read as UNKNOWN.
    settings = settingsPath;
  }
  const lanes = resolve(args["--lanes"] ?? join(round, "lanes.json"));
  let lanesPath = lanes;
  try {
    lanesPath = realpathSync(lanes);
  } catch {}
  const statePath = resolve(
    args["--state"] ?? join(round, `${command}.state.json`),
  );
  let state;
  try {
    state = realpathSync(statePath);
  } catch (error) {
    if (!missing(error)) throw error;
    state = join(realpathSync(dirname(statePath)), basename(statePath));
  }
  const paths =
    command === "lane-watch"
      ? [log, state, settings, lanesPath]
      : [log, state, settings];
  if (new Set(paths).size !== paths.length)
    throw new Error("paths-must-be-distinct");
  return { command, repo, log, state, settings, now, lanes };
}

/** @param {{repo: string, log: string, state: string}} config @returns {string|null} */
function previousStall(config) {
  let stall = null;
  try {
    const state = JSON.parse(readFileSync(config.state, "utf8"));
    if (
      state.version !== 1 ||
      typeof state.repo !== "string" ||
      (state.stall !== null && typeof state.stall !== "string")
    )
      throw new Error("state-shape");
    if (state.stall !== null) time(state.stall);
    if (state.repo === config.repo) stall = state.stall;
  } catch (error) {
    if (!missing(error))
      throw new Error("state-unreadable", { cause: error });
  }
  // Recover the append-before-state crash window using the shared grammar.
  for (const line of readFileSync(config.log, "utf8").split(/\r?\n/u)) {
    const event = parseEventLine(line);
    if (
      event.type !== "MERGE-STALL" ||
      event.actor !== "WATCH" ||
      event.fields["repo"] !== config.repo
    )
      continue;
    const status = event.message.split(" ")[0];
    if (status === "STALL") {
      const last = event.fields["last-merge"];
      if (last) {
        time(last);
        stall = last;
      }
    } else if (["OK", "EMPTY-QUEUE", "NO-MERGE-YET"].includes(status ?? "")) {
      stall = null;
    }
  }
  return stall;
}

/** @param {ReturnType<typeof options>} config @param {string} message */
function report(config, message) {
  appendReport(
    config.log,
    `${config.now} WATCH MERGE-STALL ${message} repo=${config.repo}`,
    "MERGE-STALL",
  );
}

/** @param {string} file @returns {{minutes: number, timeout: number, maxBuffer: number}} */
function settingsOf(file) {
  const settings = JSON.parse(readFileSync(file, "utf8")).mergeStall;
  const minutes = settings?.minutes;
  const timeout = settings?.githubTimeoutMs;
  const maxBuffer = settings?.githubMaxBufferBytes;
  if (
    !Number.isFinite(minutes) ||
    minutes <= 0 ||
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    !Number.isSafeInteger(maxBuffer) ||
    maxBuffer <= 0
  )
    throw new Error("settings-invalid");
  return { minutes, timeout, maxBuffer };
}

/** @param {ReturnType<typeof options>} config @returns {number} */
function mergeStall(config) {
  let prior;
  let last;
  let queue;
  let clean;
  let minutes;
  try {
    const settings = settingsOf(config.settings);
    minutes = settings.minutes;
    const { timeout, maxBuffer } = settings;
    prior = previousStall(config);
    ({ last, queue, clean } = githubSnapshot(
      config.repo,
      timeout,
      maxBuffer,
      time(config.now),
    ));
  } catch {
    // Never echo API errors, command output or credentials into the round log.
    report(config, "UNKNOWN reason=read-failed");
    return 1;
  }
  const age = last === null ? null : (time(config.now) - time(last)) / 60000;
  const status =
    queue + clean === 0
      ? "EMPTY-QUEUE"
      : last === null
        ? "NO-MERGE-YET"
        : age !== null && age >= minutes
          ? "STALL"
          : "OK";
  const stall = status === "STALL" ? last : null;
  if (status !== "STALL" || prior !== stall) {
    report(
      config,
      `${status} queued=${queue} clean=${clean} last-merge=${last ?? "none"} age-minutes=${age ?? "none"} threshold-minutes=${minutes}`,
    );
  }
  writeFileSync(
    config.state,
    `${JSON.stringify({ version: 1, repo: config.repo, stall })}\n`,
    { mode: 0o600 },
  );
  return 0;
}

function runTouches() {
  const args = process.argv.slice(2);
  /** @type {Map<string, string>} */
  const flags = new Map();
  let actor = "WATCH";

  /** @param {string} name @returns {string} */
  function required(name) {
    const value = flags.get(name);
    if (!value) throw new Error("missing-option");
    return value;
  }

  /** @param {string} outcome @param {Record<string, string|number>} fields */
  function reportTouches(outcome, fields) {
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
    const message = Object.entries(fields)
      .map(([key, value]) => {
        const encoded = encodeURIComponent(value).replaceAll(
          /[!'()*]/gu,
          (char) => `%${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()}`,
        );
        return `${key}=${encoded}`;
      })
      .join(" ");
    process.stdout.write(
      `${timestamp} ${actor} TOUCHES-CHECK ${outcome} ${message}\n`,
    );
  }

  try {
    if (args[0] !== "touches" || args.length % 2 !== 1)
      throw new Error("invalid-command");
    const allowed = new Set([
      "--round",
      "--settings",
      "--repo",
      "--lane",
      "--paths",
      "--brief",
    ]);
    for (let i = 1; i < args.length; i += 2) {
      const key = args[i] ?? "";
      const value = args[i + 1] ?? "";
      if (!allowed.has(key) || flags.has(key) || !value)
        throw new Error("invalid-option");
      flags.set(key, value);
    }
    const lane = required("--lane");
    if (isLane(lane)) actor = lane;
    const result = checkTouches({
      round: required("--round"),
      settings: required("--settings"),
      repo: required("--repo"),
      lane,
      paths: pathsOf(JSON.parse(required("--paths"))),
      brief: required("--brief"),
    });
    if (result.clashes.length > 0) {
      for (const clash of result.clashes)
        reportTouches("HELD", { lane, ...clash });
      process.exitCode = 1;
    } else {
      reportTouches("DECLARED", { lane, paths: JSON.stringify(result.paths) });
    }
  } catch {
    // Do not echo GitHub stderr, brief contents, or partially trusted input.
    reportTouches("UNKNOWN", { reason: "failed-read-or-invalid-input" });
    process.exitCode = 2;
  }
}

if (process.argv[2] === "touches") {
  runTouches();
} else {
  try {
    const config = options();
    process.exitCode =
      config.command === "merge-stall"
        ? mergeStall(config)
        : config.command === "lane-watch"
          ? laneWatch(config)
          : landingWatch(config);
  } catch {
    console.error(
      "watch: refused options or file write; use merge-stall|lane-watch|landing-assessment|arrival-cap --repo OWNER/REPO --round DIR [--settings FILE] [--state FILE] [--now UTC] [--lanes FILE]",
    );
    process.exitCode = 2;
  }
}
