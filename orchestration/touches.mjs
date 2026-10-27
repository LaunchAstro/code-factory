// SPDX-License-Identifier: AGPL-3.0-only
// Read a dispatch snapshot. Only the orchestrator records declarations.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { parseEventLine } from "./events.mjs";

/** @typedef {{lane: string, declaredAt: string, paths: string[], brief: string, branch?: string}} Declaration */
/** @typedef {{path: string, owner: string, reason: string, pr?: number}} Clash */
/** @typedef {{round: string, settings: string, repo: string, lane: string, paths: string[], brief: string}} Request */

/** @param {unknown} value @returns {Record<string, unknown>} */
function object(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid-object");
  return (
    /** @type {Record<string, unknown>} */
    (value)
  );
}

/** @param {unknown} value @returns {string} */
function string(value) {
  if (typeof value !== "string" || value.length === 0)
    throw new Error("invalid-string");
  return value;
}

/** @param {string} value @returns {boolean} */
export function isLane(value) {
  return (
    /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value) &&
    !["SOL-PR", "SOL-AREA", "SOL-SWEEP"].includes(value)
  );
}

/** @param {unknown} value @returns {string[]} */
export function pathsOf(value) {
  if (!Array.isArray(value)) throw new Error("invalid-path-list");
  return [
    ...new Set(
      value.map((entry) => {
        const path = string(entry);
        if (
          path.includes("\\") ||
          [...path].some(
            (char) =>
              (char.codePointAt(0) ?? 0) < 32 ||
              (char.codePointAt(0) ?? 0) === 127,
          ) ||
          path.split("/").some((part) => ["", ".", ".."].includes(part))
        )
          throw new Error("invalid-repository-path");
        return path;
      }),
    ),
  ];
}

/** @param {string} path @returns {unknown} */
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** @param {string} round @param {string} brief @returns {string[]} */
function briefPaths(round, brief) {
  const text = readFileSync(resolve(round, brief), "utf8");
  const lines = text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("Touches:"));
  if (lines.length !== 1) throw new Error("invalid-brief-touches");
  return pathsOf(JSON.parse((lines[0] ?? "").slice("Touches:".length)));
}

/** @param {unknown} value @returns {Declaration[]} */
function declarations(value) {
  const lanes = object(value)["lanes"];
  if (!Array.isArray(lanes)) throw new Error("invalid-declarations");
  const names = new Set();
  return lanes.map((entry) => {
    const data = object(entry);
    const lane = string(data["lane"]);
    const declaredAt = string(data["declaredAt"]);
    if (
      !isLane(lane) ||
      names.has(lane) ||
      parseEventLine(`${declaredAt} ${lane} NOTE`).type === "unknown"
    )
      throw new Error("invalid-declaration-identity");
    names.add(lane);
    /** @type {Declaration} */
    const declaration = {
      lane,
      declaredAt,
      paths: pathsOf(data["paths"]),
      brief: string(data["brief"]),
    };
    if (data["branch"] !== undefined)
      declaration.branch = string(data["branch"]);
    return declaration;
  });
}

/** @param {string} round @returns {Map<string, string>} */
function wraps(round) {
  const lines = readFileSync(join(round, "events.log"), "utf8").split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  // An empty log is a valid initial round, but additional blank lines are unknown.
  const wrapped = new Map();
  for (const line of lines) {
    const record = parseEventLine(line);
    if (record.type === "unknown") throw new Error("unknown-event");
    if (
      record.type === "WRAPPED" &&
      record.timestamp > (wrapped.get(record.actor) ?? "")
    )
      wrapped.set(record.actor, record.timestamp);
  }
  return wrapped;
}

/** @param {string} endpoint @returns {unknown[]} */
function githubPages(endpoint) {
  const result = spawnSync(
    "gh",
    ["api", "--method", "GET", "--paginate", "--slurp", endpoint],
    {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0 || result.error) throw new Error("github-read");
  const pages = JSON.parse(result.stdout);
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.some((page) => !Array.isArray(page))
  )
    throw new Error("github-shape");
  return pages.flat();
}

/**
 * A single pass. It reads all inputs before returning an outcome, and writes nothing.
 * Exact repository paths are compared; directory/glob declarations are not expanded.
 * @param {Request} request
 * @returns {{paths: string[], clashes: Clash[]}}
 */
export function checkTouches(request) {
  if (
    !isLane(request.lane) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(request.repo)
  )
    throw new Error("invalid-request");
  const paths = [
    ...new Set([
      ...pathsOf(request.paths),
      ...briefPaths(request.round, request.brief),
    ]),
  ];
  const busy = pathsOf(
    object(object(readJson(request.settings))["touches"])["busyFiles"],
  );
  const lanes = declarations(readJson(join(request.round, "touches.json")));
  const wrapped = wraps(request.round);
  const working = lanes.filter(
    (lane) => (wrapped.get(lane.lane) ?? "") < lane.declaredAt,
  );
  /** @type {Clash[]} */
  const clashes = [];
  const wanted = new Set(paths);
  for (const path of busy) {
    if (wanted.has(path))
      clashes.push({ path, owner: "ROUND-SETTING", reason: "busy-file" });
  }
  for (const lane of working) {
    const brief = briefPaths(request.round, lane.brief);
    if (lane.lane === request.lane) continue;
    for (const path of new Set([...lane.paths, ...brief])) {
      if (wanted.has(path))
        clashes.push({
          path,
          owner: lane.lane,
          reason: lane.paths.includes(path) ? "lane-declaration" : "brief",
        });
    }
  }
  clashes.push(...prClashes(request.repo, working, wanted));
  return { paths, clashes };
}

/** @param {string} repo @param {Declaration[]} working @param {Set<string>} wanted @returns {Clash[]} */
function prClashes(repo, working, wanted) {
  /** @type {Clash[]} */
  const clashes = [];
  for (const entry of githubPages(
    `repos/${repo}/pulls?state=open&per_page=100`,
  )) {
    const pr = object(entry);
    const number = pr["number"];
    const head = object(pr["head"]);
    const branch = string(head["ref"]);
    const headRepo =
      head["repo"] === null ? null : string(object(head["repo"])["full_name"]);
    if (
      typeof number !== "number" ||
      !Number.isSafeInteger(number) ||
      number <= 0 ||
      (headRepo !== null &&
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(headRepo))
    )
      throw new Error("github-pr-identity");
    const files = githubPages(
      `repos/${repo}/pulls/${number}/files?per_page=100`,
    );
    // GitHub's pull-files endpoint cannot return more than 3,000 files.
    if (files.length >= 3000) throw new Error("github-file-limit");
    const owner =
      (headRepo?.toLowerCase() === repo.toLowerCase()
        ? working.find((lane) => lane.branch === branch)?.lane
        : undefined) ?? `PR-${number}`;
    const touched = new Set(
      files.flatMap((fileEntry) => {
        const file = object(fileEntry);
        return pathsOf(
          file["previous_filename"] === undefined
            ? [file["filename"]]
            : [file["filename"], file["previous_filename"]],
        );
      }),
    );
    for (const path of touched) {
      if (wanted.has(path))
        clashes.push({ path, owner, reason: "open-pr", pr: number });
    }
  }
  return clashes;
}
