// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEventLine } from "../events.mjs";
const cli = new URL("../watch.mjs", import.meta.url).pathname;
export const stamp = "2026-10-14T00:00:00Z";
export const heldPath = "packages/example.mjs";

export function fixture(
  t,
  {
    busy = [],
    lanes = [],
    events = "",
    prs = [[]],
    files = {},
    candidateBrief = [],
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "a1-128-touches-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const round = join(root, ".local", "lanes");
  const bin = join(root, "bin");
  mkdirSync(round, { recursive: true });
  mkdirSync(bin);
  const settings = join(root, "watch.json");
  writeFileSync(settings, JSON.stringify({ touches: { busyFiles: busy } }));
  writeFileSync(join(round, "touches.json"), JSON.stringify({ lanes }));
  writeFileSync(join(round, "events.log"), events);
  writeFileSync(
    join(round, "candidate.md"),
    `# Build\nTouches: ${JSON.stringify(candidateBrief)}\n`,
  );
  writeFileSync(join(round, "holder.md"), "# Build\nTouches: []\n");
  writeFileSync(join(root, "github.json"), JSON.stringify({ prs, files }));
  writeFakeGh(bin);
  const calls = join(root, "calls.log");
  const context = { root, round, settings, calls, bin };
  const run = (paths = [heldPath], extra = [], env = {}) =>
    invoke(context, paths, extra, env);
  return { root, round, settings, calls, run };
}

export function records(result, status, outcome) {
  assert.equal(result.status, status, result.stdout + result.stderr);
  const lines = result.stdout.trimEnd().split("\n");
  return lines.map((line) => {
    const record = parseEventLine(line);
    assert.equal(record.type, "TOUCHES-CHECK", line);
    assert.equal(record.actor, "BUILD-B");
    assert.equal(record.message.split(" ")[0], outcome);
    return record;
  });
}

export function holder(paths = [heldPath], declaredAt = stamp) {
  return {
    lane: "BUILD-A",
    declaredAt,
    paths,
    brief: "holder.md",
    branch: "feat/holder",
  };
}

function writeFakeGh(bin) {
  writeFileSync(
    join(bin, "gh"),
    `#!${process.execPath}
import { readFileSync, appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CALLS, JSON.stringify(args) + '\\n');
if (process.env.FAKE_FAIL === 'all' || args.at(-1).includes(process.env.FAKE_FAIL || 'never-match')) process.exit(1);
const data = JSON.parse(readFileSync(process.env.FAKE_DATA, 'utf8'));
const parts = args.at(-1).split('/');
const number = parts.length === 6 ? parts[4] : undefined;
process.stdout.write(JSON.stringify(number ? data.files[number] : data.prs));
`,
    { mode: 0o755 },
  );
}

function invoke({ root, round, settings, calls, bin }, paths, extra, env) {
  return spawnSync(
    process.execPath,
    [
      cli,
      "touches",
      "--round",
      round,
      "--settings",
      settings,
      "--repo",
      "Example/project",
      "--lane",
      "BUILD-B",
      "--paths",
      JSON.stringify(paths),
      "--brief",
      "candidate.md",
      ...extra,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_DATA: join(root, "github.json"),
        FAKE_CALLS: calls,
        ...env,
      },
    },
  );
}
