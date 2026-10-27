// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
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
import { pr, open, check, head } from "./watch-landing-fixture.mjs";

const watch = fileURLToPath(new URL("../watch.mjs", import.meta.url));
export const sourceURL = new URL(
  "./fixtures/round-2000-01-01.replay.log",
  import.meta.url,
);
export const evidence = JSON.parse(
  readFileSync(
    new URL("./fixtures/round-2000-01-01.replay.json", import.meta.url),
  ),
);
export const shift = (stamp, seconds) =>
  new Date(Date.parse(stamp) + seconds * 1000)
    .toISOString()
    .replace(".000Z", "Z");

export function fixture(lifetime, until) {
  const original = readFileSync(sourceURL, "utf8");
  const root = mkdtempSync(join(tmpdir(), "cf129-replay-"));
  lifetime.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin"),
    round = join(root, "round");
  mkdirSync(bin);
  mkdirSync(round);
  const source = join(root, "source.log"),
    log = join(round, "events.log");
  writeFileSync(source, original);
  chmodSync(source, 0o444);
  // A prefix prevents later READY/WRAPPED records from influencing past passes.
  const prefix =
    original
      .trimEnd()
      .split("\n")
      .filter((l) => parseEventLine(l).timestamp <= until)
      .join("\n") + "\n";
  writeFileSync(log, prefix);
  const settings = join(root, "settings.json");
  writeFileSync(
    settings,
    readFileSync(new URL("../watch.settings.json", import.meta.url)),
  );
  const responses = join(root, "responses.json"),
    calls = join(root, "calls.jsonl");
  const data = {
    merged: [[{ merged_at: until }]],
    queue: {
      data: { repository: { mergeQueue: { entries: { totalCount: 1 } } } },
    },
    open: open([]),
    checks: [check("recorded-required-check")],
    head: { headRefOid: head },
    pushes: [[]],
    commit: evidence.idle.lastSignal,
    panes: {
      result: {
        type: "pane_list",
        panes: [{ pane_id: "wReplay:p1", agent_status: "idle" }],
      },
    },
  };
  const stub = `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
const tool = basename(process.argv[1]), args = process.argv.slice(2);
appendFileSync(process.env.CALLS, JSON.stringify({tool,args}) + '\\n');
const d = JSON.parse(readFileSync(process.env.RESPONSES, 'utf8'));
let value;
if (tool === 'herdr' && JSON.stringify(args) === JSON.stringify(['pane','list'])) value = d.panes;
else if (tool === 'git' && args[0] === 'check-ref-format' && args[1] === '--branch' && args[2] === 'feat/replay') { process.stdout.write('feat/replay\\n'); process.exit(0); }
else if (tool === 'git' && args[0] === '-C' && args.includes('log') && args.includes('--no-walk') && args.includes('--format=%cI')) { process.stdout.write(d.commit); process.exit(0); }
else if (tool === 'gh' && args[0] === 'api' && args[1] === 'repos/fixture/repo/events?per_page=100') value = d.pushes;
else if (tool === 'gh' && args[0] === 'api' && args[1] === 'repos/fixture/repo/pulls?state=closed&sort=updated&direction=desc&per_page=100') value = d.merged;
else if (tool === 'gh' && args[0] === 'api' && args[1] === 'graphql' && !args.join(' ').includes('mutation')) value = args.join(' ').includes('mergeQueue') ? d.queue : d.open;
else if (tool === 'gh' && args[0] === 'pr' && args[1] === 'checks' && args.includes('--required')) value = d.checks;
else if (tool === 'gh' && args[0] === 'pr' && args[1] === 'view' && args.includes('headRefOid')) value = d.head;
else process.exit(90);
process.stdout.write(JSON.stringify(value));
`;
  for (const tool of ["gh", "git", "herdr"])
    writeFileSync(join(bin, tool), stub, { mode: 0o755 });
  const env = { ...process.env, PATH: bin, RESPONSES: responses, CALLS: calls };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  function run(command, now) {
    writeFileSync(responses, JSON.stringify(data));
    const result = spawnSync(
      process.execPath,
      [
        watch,
        command,
        "--repo",
        "fixture/repo",
        "--round",
        round,
        "--settings",
        settings,
        "--now",
        now,
      ],
      { env, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(
      result.status,
      0,
      `${command}: ${result.stdout} ${result.stderr}`,
    );
    return result;
  }
  const records = () =>
    readFileSync(log, "utf8")
      .trimEnd()
      .split("\n")
      .map(parseEventLine)
      .filter((e) => e.actor === "WATCH");
  const verify = () => {
    assert.equal(readFileSync(source, "utf8"), original);
    assert.equal(readFileSync(sourceURL, "utf8"), original);
    const invocations = readFileSync(calls, "utf8")
      .trimEnd()
      .split("\n")
      .map(JSON.parse);
    assert.ok(invocations.length > 0);
    assert.ok(
      invocations.every(
        ({ tool, args }) =>
          tool === "git" ||
          (tool === "herdr" && args.join(" ") === "pane list") ||
          (tool === "gh" &&
            (args[0] === "api" ||
              (args[0] === "pr" && ["checks", "view"].includes(args[1]))) &&
            !args.join(" ").includes("mutation")),
      ),
    );
    return true;
  };
  return { root, round, log, data, run, records, verify };
}

export function candidate(f, number) {
  f.data.open = open([pr(number)]);
}
