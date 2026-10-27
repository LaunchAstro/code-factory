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
export const old = "2026-10-14T01:00:00Z";
export const recent = "2026-10-14T01:59:00Z";
export const push = (created_at, branch = "feat/build") => ({
  type: "PushEvent",
  created_at,
  payload: { ref: `refs/heads/${branch}` },
});

// Long enough that a stub slowed by a loaded machine still answers; no case
// waits on it, and the one timeout case sets its own 10 ms.
export const READ_TIMEOUT_MS = 30000;

export function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "a1-126-watch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const round = join(root, "round");
  const bin = join(root, "bin");
  mkdirSync(round);
  mkdirSync(bin);
  const source = join(root, "source.log");
  const original = `${old} BUILD BOOTED\n`;
  writeFileSync(source, original);
  chmodSync(source, 0o444);
  const log = join(round, "events.log");
  writeFileSync(log, readFileSync(source));
  const lanes = join(round, "lanes.json");
  const records = {
    version: 1,
    lanes: [
      {
        id: "BUILD",
        status: "working",
        branch: "feat/build",
        worktree: root,
        pane: "wBuild:p1",
        startedAt: old,
        lastPushAt: old,
      },
    ],
  };
  const settings = join(root, "settings.json");
  const limits = {
    laneWatch: { minutes: 30, readTimeoutMs: READ_TIMEOUT_MS, maxBufferBytes: 1048576 },
  };
  const responses = join(root, "responses.json");
  const calls = join(root, "calls.jsonl");
  const data = {
    gh: { body: [[]] },
    git: { raw: old },
    herdr: {
      body: {
        id: "cli:pane:list",
        result: {
          type: "pane_list",
          panes: [{ pane_id: "wBuild:p1", agent_status: "working" }],
        },
      },
    },
  };
  const stub = `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
const tool = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.CALLS, JSON.stringify({tool,args}) + '\\n');
if (tool === 'herdr' && JSON.stringify(args) !== JSON.stringify(['pane','list'])) process.exit(90);
if (tool === 'gh' && (args[0] !== 'api' || !args[1]?.endsWith('/events?per_page=100') || !args.includes('--paginate') || !args.includes('--slurp'))) process.exit(90);
const branchCheck = tool === 'git' && args[0] === 'check-ref-format' && args[1] === '--branch' && args.length === 3;
if (tool === 'git' && !branchCheck && (args[0] !== '-C' || !args.includes('log') || !args.includes('--format=%cI') || !args.includes('--no-walk'))) process.exit(90);
const response = JSON.parse(readFileSync(process.env.RESPONSES, 'utf8'))[tool];
if (response.delay) await new Promise(resolve => setTimeout(resolve, response.delay));
if (response.exit) process.exit(response.exit);
if (branchCheck) {
  const result = spawnSync('git', args, {env: {...process.env, PATH: process.env.ORIGINAL_GIT_PATH}, encoding: 'utf8'});
  process.stdout.write(result.stdout ?? '');
  process.exit(result.status ?? 1);
}
process.stdout.write(response.raw ?? JSON.stringify(response.body));
`;
  for (const tool of ["gh", "git", "herdr"])
    writeFileSync(join(bin, tool), stub, { mode: 0o755 });
  const clock = { now };
  const run = (extra = []) => {
    writeFileSync(lanes, JSON.stringify(records));
    writeFileSync(settings, JSON.stringify(limits));
    writeFileSync(responses, JSON.stringify(data));
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ORIGINAL_GIT_PATH: process.env.PATH,
      RESPONSES: responses,
      CALLS: calls,
    };
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    return spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../watch.mjs", import.meta.url)),
        "lane-watch",
        "--repo",
        "fixture/repo",
        "--round",
        round,
        "--settings",
        settings,
        "--now",
        clock.now,
        ...extra,
      ],
      { env, encoding: "utf8" },
    );
  };
  const events = () =>
    readFileSync(log, "utf8")
      .trimEnd()
      .split("\n")
      .map(parseEventLine)
      .filter((e) => e.type === "LANE-WATCH");
  return {
    root,
    round,
    source,
    original,
    log,
    lanes,
    records,
    settings,
    limits,
    calls,
    data,
    clock,
    run,
    events,
  };
}
