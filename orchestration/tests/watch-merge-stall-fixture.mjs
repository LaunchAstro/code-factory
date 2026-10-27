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

const watch = fileURLToPath(new URL("../watch.mjs", import.meta.url));
export const now = "2026-10-14T02:00:00Z";
export const oldMerge = "2026-10-14T01:00:00Z";
export const recentMerge = "2026-10-14T01:50:00Z";
export const queue = (count) => ({
  data: { repository: { mergeQueue: { entries: { totalCount: count } } } },
});
export const clean = (statuses) => [
  {
    data: {
      repository: {
        pullRequests: {
          nodes: statuses.map((mergeStateStatus) => ({ mergeStateStatus })),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  },
];

// Long enough that a stub slowed by a loaded machine still answers; no case
// here waits for a read to time out.
export const GITHUB_TIMEOUT_MS = 30000;

const defaultSettings = {
  mergeStall: {
    minutes: 45,
    githubTimeoutMs: GITHUB_TIMEOUT_MS,
    githubMaxBufferBytes: 1048576,
  },
};

export function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "a1-125-watch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const round = join(root, "round");
  const bin = join(root, "bin");
  mkdirSync(round);
  mkdirSync(bin);
  const source = join(root, "source.log");
  const original = "2026-10-14T01:59:00Z BUILDER MERGED #99\n";
  writeFileSync(source, original);
  chmodSync(source, 0o444);
  const log = join(round, "events.log");
  writeFileSync(log, readFileSync(source));
  const settings = join(root, "settings.json");
  writeFileSync(settings, JSON.stringify(defaultSettings));
  const responses = join(root, "responses.json");
  const calls = join(root, "calls.jsonl");
  stubGh(bin, calls);
  const data = {
    merged: { body: [[{ merged_at: oldMerge }]] },
    queue: { body: queue(1) },
    clean: { body: clean(["CLEAN"]) },
  };
  const run = runner(bin, responses, calls, data, round, settings);
  const records = () =>
    readFileSync(log, "utf8")
      .trimEnd()
      .split("\n")
      .slice(1)
      .map((line) => parseEventLine(line));
  return {
    root,
    round,
    log,
    source,
    original,
    settings,
    data,
    calls,
    run,
    records,
  };
}

function stubGh(bin, calls) {
  const stub = `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
const kind = args[1]?.startsWith('repos/') ? 'merged' : args.join(' ').includes('mergeQueue') ? 'queue' : 'clean';
if (args[0] !== 'api' || !['graphql'].includes(args[1]) && !args[1]?.startsWith('repos/')) process.exit(90);
const response = JSON.parse(readFileSync(process.env.RESPONSES, 'utf8'))[kind];
if (response.exit) process.exit(response.exit);
process.stdout.write(response.raw ?? JSON.stringify(response.body));
`;
  writeFileSync(join(bin, "gh"), stub, { mode: 0o755 });
  writeFileSync(
    join(bin, "herdr"),
    `#!/bin/sh\necho pane-action >> '${calls}'\nexit 91\n`,
    { mode: 0o755 },
  );
}

function runner(bin, responses, calls, data, round, settings) {
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    RESPONSES: responses,
    CALLS: calls,
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const run = (extra = []) => {
    writeFileSync(responses, JSON.stringify(data));
    return spawnSync(
      process.execPath,
      [
        watch,
        "merge-stall",
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
  return run;
}
