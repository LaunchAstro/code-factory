// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEventLine } from "../events.mjs";

export const now = "2026-10-14T02:00:00Z";
export const head = "a".repeat(40);
export const ready = (n, minute = n) =>
  `2026-10-14T01:${String(minute).padStart(2, "0")}:00Z BUILDER-${n} READY #${n} head=${head}\n`;
export const pr = (number, extra = {}) => ({
  number,
  headRefOid: head,
  body: "",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: "APPROVED",
  isDraft: false,
  labels: { nodes: [], totalCount: 0 },
  ...extra,
});
export const open = (nodes) => [
  {
    data: {
      repository: {
        pullRequests: {
          nodes,
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  },
];
export const check = (name, bucket = "pass") => ({
  name,
  state: bucket === "pass" ? "SUCCESS" : "PENDING",
  bucket,
});

// Long enough that a stub slowed by a loaded machine still answers; no case
// here waits for a read to time out.
export const GITHUB_TIMEOUT_MS = 30000;

export function fixture(t, count = 2) {
  const root = mkdtempSync(join(tmpdir(), "a1-127-watch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const round = join(root, "round"),
    bin = join(root, "bin");
  mkdirSync(round);
  mkdirSync(bin);
  const source = join(root, "source.log"),
    log = join(round, "events.log");
  const original = Array.from({ length: count }, (_, i) => ready(i + 1)).join(
    "",
  );
  writeFileSync(source, original);
  chmodSync(source, 0o444);
  writeFileSync(log, original);
  const settings = join(root, "settings.json"),
    responses = join(root, "responses.json"),
    calls = join(root, "calls.jsonl");
  const settingsData = {
    mergeStall: {
      minutes: 45,
      githubTimeoutMs: GITHUB_TIMEOUT_MS,
      githubMaxBufferBytes: 1048576,
    },
    landingAssessment: {
      minutes: 45,
      githubTimeoutMs: GITHUB_TIMEOUT_MS,
      githubMaxBufferBytes: 1048576,
    },
    arrivalCap: {
      ready: 4,
      githubTimeoutMs: GITHUB_TIMEOUT_MS,
      githubMaxBufferBytes: 1048576,
    },
  };
  writeFileSync(settings, JSON.stringify(settingsData));
  const data = {
    merged: { body: [[{ merged_at: "2026-10-14T01:00:00Z" }]] },
    queue: {
      body: {
        data: { repository: { mergeQueue: { entries: { totalCount: 0 } } } },
      },
    },
    open: { body: open(Array.from({ length: count }, (_, i) => pr(i + 1))) },
    checks: { body: [check("build")] },
    head: { body: { headRefOid: head } },
  };
  writeFileSync(
    join(bin, "gh"),
    `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
const kind = args[0] === 'pr' ? args[1] === 'checks' ? 'checks' : args[1] === 'view' ? 'head' : null : args[0] !== 'api' ? null : args[1]?.startsWith('repos/') ? 'merged' : args.join(' ').includes('mergeQueue') ? 'queue' : 'open';
if (!kind) process.exit(90);
const data = JSON.parse(readFileSync(process.env.RESPONSES, 'utf8'));
const response = data[kind + '-' + args[2]] ?? data[kind];
if (response.exit && !response.body) process.exit(response.exit);
process.stdout.write(response.raw ?? JSON.stringify(response.body));
process.exit(response.exit ?? 0);
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "herdr"),
    `#!/bin/sh\necho pane-action >> '${calls}'\nexit 91\n`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    RESPONSES: responses,
    CALLS: calls,
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const run = (command = "landing-assessment", extra = []) => {
    writeFileSync(responses, JSON.stringify(data));
    return spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../watch.mjs", import.meta.url)),
        command,
        "--repo",
        "fixture/repo",
        "--round",
        round,
        "--settings",
        settings,
        "--now",
        now,
        ...extra,
      ],
      { env, encoding: "utf8" },
    );
  };
  const records = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .map(parseEventLine)
      .filter((e) => e.type !== "unknown" && e.actor === "WATCH");
  return {
    root,
    round,
    source,
    log,
    original,
    settings,
    settingsData,
    data,
    calls,
    run,
    records,
  };
}
