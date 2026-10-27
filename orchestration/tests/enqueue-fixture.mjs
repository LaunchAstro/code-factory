// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const head = "a".repeat(40);
export const sol = "Sol verdict for this revision";
export const structural = "structural checks (vs current main)";
export const runCheck = (name, extra = {}) => ({
  id: 1,
  name,
  head_sha: head,
  status: "completed",
  conclusion: "success",
  app: { id: 15368 },
  ...extra,
});

export const committed = "2026-10-15T00:00:00Z";
export const described = [
  "Builds the thing.",
  "",
  "**Why:** one gate in the script every lane already uses.",
  "**Left undone:** #12, LaunchAstro/work-map#40",
  "Closes #7",
  "Section: checks",
].join("\n");
// GitHub's filtered timeline: totalCount counts every event on the PR,
// filteredCount only the requested types (seen on ops-astro#1657, 15 Oct).
export const timeline = (nodes, extra = {}) => ({
  totalCount: nodes.length + 8,
  filteredCount: nodes.length,
  pageInfo: { hasPreviousPage: false },
  nodes,
  ...extra,
});
export const removal = (createdAt, reason = "failed required checks") => ({
  createdAt,
  reason,
});

// The stand-ins are the same for every case, so each test process writes
// them once and runs each once before its first case (#364). On macOS the
// first exec of a newly written script waits on a system check, which took
// over 3 s on a loaded M5 and, in full runs, past the merge script's 10 s
// budget; later execs of the same file take milliseconds.
const bin = mkdtempSync(join(tmpdir(), "a1-130-enqueue-bin-"));
process.on("exit", () => rmSync(bin, { recursive: true, force: true }));
/** @param {string} name @param {string} body */
function standin(name, body) {
  const path = join(bin, name);
  if (existsSync(path)) return;
  writeFileSync(
    path,
    `#!${process.execPath}\nif (process.argv[2] === '--warm') process.exit(0);\n${body}`,
    { mode: 0o755 },
  );
  const warm = spawnSync(path, ["--warm"]);
  if (warm.status !== 0) throw new Error(`stand-in ${name} did not start`);
}

export function fixture(t, extraEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), "a1-130-enqueue-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const responses = join(root, "responses.json"),
    calls = join(root, "calls.jsonl");
  const pr = {
    id: "PR_fixture",
    state: "OPEN",
    headRefOid: head,
    isDraft: false,
    isMergeQueueEnabled: true,
    mergeQueueEntry: null,
    labels: { nodes: [], totalCount: 0 },
    baseRef: { name: "main", branchProtectionRule: null },
    body: described,
    commits: { nodes: [{ commit: { oid: head, committedDate: committed } }] },
    timelineItems: timeline([]),
  };
  const data = {
    pr: { body: { data: { repository: { pullRequest: pr } } } },
    rules: {
      body: [
        [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [sol, structural].map((context) => ({
                context,
                integration_id: 15368,
              })),
            },
          },
        ],
      ],
    },
    runs: {
      body: [
        {
          total_count: 2,
          check_runs: [runCheck(sol), runCheck(structural, { id: 2 })],
        },
      ],
    },
    statuses: { body: [{ sha: head, total_count: 0, statuses: [] }] },
    sol: { body: [[]] },
    files: { body: [[{ filename: "src/styles/site.css" }]] },
    repo: {
      body: {
        allow_merge_commit: true,
        allow_squash_merge: true,
        allow_rebase_merge: true,
      },
    },
    merge: { body: { merged: true, sha: "c".repeat(40) } },
    enqueue: {
      body: {
        data: { enqueuePullRequest: { mergeQueueEntry: { id: "MQ_fixture" } } },
      },
    },
  };
  standin(
    "gh",
    `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
const data = JSON.parse(fs.readFileSync(process.env.RESPONSES, 'utf8'));
const query = args.join(' ');
// GitHub's Markdown renderer, replayed from recorded renders. RECORD_MARKDOWN=1 with REAL_GH set
// records a missing one from the real API; otherwise a missing render fails the call.
if (args[0] === 'api' && args[1] === 'markdown') {
  if (data.markdown?.exit) process.exit(data.markdown.exit);
  if (data.markdown?.raw !== undefined) { process.stdout.write(data.markdown.raw); process.exit(0); }
  const input = fs.readFileSync(0, 'utf8');
  // Sol proof-only responses: two distinct rendered bodies during one pass.
  if (data.markdown?.byText) {
    const html = data.markdown.byText[JSON.parse(input).text];
    if (typeof html !== 'string') process.exit(93);
    process.stdout.write(html);
    process.exit(0);
  }
  const key = require('node:crypto').createHash('sha256').update(JSON.parse(input).text).digest('hex');
  const store = process.env.RENDERS;
  const renders = JSON.parse(fs.readFileSync(store, 'utf8'));
  if (!(key in renders)) {
    if (!process.env.RECORD_MARKDOWN) process.exit(93);
    renders[key] = require('node:child_process').execFileSync(process.env.REAL_GH, ['api', 'markdown', '--input', '-'], { input, encoding: 'utf8' });
    fs.writeFileSync(store, JSON.stringify(renders, null, 1) + '\\n');
  }
  process.stdout.write(renders[key]);
  process.exit(0);
}
const kind = args[0] !== 'api' ? null : query.includes('enqueuePullRequest') ? 'enqueue' : args[1]?.endsWith('/merge') ? 'merge' : args[1]?.includes('/statuses?') ? 'sol' : args[1]?.includes('/files?') ? 'files' : args[1] === 'repos/fixture/repo' ? 'repo' : args[1] === 'graphql' ? 'pr' : query.includes('/rules/branches/') ? 'rules' : query.includes('/check-runs') ? 'runs' : query.includes('/status') ? 'statuses' : null;
if (!kind) process.exit(90);
const count = fs.readFileSync(process.env.CALLS, 'utf8').split('\\n').filter(Boolean).map(JSON.parse).filter(a => a[1] === 'graphql' && !a.join(' ').includes('enqueuePullRequest')).length;
const ruleCount = fs.readFileSync(process.env.CALLS, 'utf8').split('\\n').filter(Boolean).map(JSON.parse).filter(a => a[1]?.includes('/rules/branches/')).length;
const response = (kind === 'pr' && count > 1 ? data.final : kind === 'rules' && ruleCount > 1 ? data.finalRules : null) ?? data[kind];
if (response.exit) { process.stdout.write(response.raw ?? ''); process.exit(response.exit); }
if (kind === 'enqueue' && !response.raw) {
  data.pr.body.data.repository.pullRequest.mergeQueueEntry = { id: 'MQ_fixture' };
  fs.writeFileSync(process.env.RESPONSES, JSON.stringify(data));
}
process.stdout.write(response.raw ?? JSON.stringify(response.body));
`,
  );
  // A fake launchctl, so no case ever kicks a real work map: `list` prints
  // LAUNCHCTL_LIST, `kickstart` exits LAUNCHCTL_KICK_EXIT (default 0).
  const launchctlCalls = join(root, "launchctl.jsonl");
  standin(
    "launchctl",
    `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.LAUNCHCTL_CALLS, JSON.stringify(args) + '\\n');
if (process.env.LAUNCHCTL_LIST_EXIT) process.exit(Number(process.env.LAUNCHCTL_LIST_EXIT));
if (args[0] === 'list') process.stdout.write('PID\\tStatus\\tLabel\\n' + (process.env.LAUNCHCTL_LIST ?? ''));
else if (args[0] === 'kickstart') process.exit(Number(process.env.LAUNCHCTL_KICK_EXIT ?? 0));
else process.exit(94);
`,
  );
  const herdrCalls = join(root, "herdr.jsonl"),
    screen = join(root, "screen.txt");
  // A fake herdr pane: sent text shows on screen unless SCREEN_MODE says
  // otherwise, so a test can hide it or put a usage modal in front of it.
  standin(
    "herdr",
    `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.HERDR_CALLS, JSON.stringify(args) + '\\n');
if (args[0] !== 'pane') process.exit(91);
if (args[1] === 'send-text') fs.writeFileSync(process.env.SCREEN, args[3]);
else if (args[1] === 'read') {
  const mode = process.env.SCREEN_MODE ?? 'shown';
  const sent = fs.existsSync(process.env.SCREEN) ? fs.readFileSync(process.env.SCREEN, 'utf8') : '';
  const screens = {
    shown: '> ' + sent,
    hidden: '> ',
    modal: 'Buy extra usage credits? 1. Yes 2. No\\n> ' + sent,
    paylimit: 'Usage limit reached\\nEnable pay-as-you-go?\\n\u276f Yes\\n  No\\n> ' + sent,
    stale: 'Earlier transcript: [Pasted text #1 +1 lines]\\n> ',
    scrolled: fs.existsSync(process.env.SCREEN) ? '> [Pasted text #2 +1 lines]' : 'Earlier transcript: [Pasted text #1 +1 lines]\\n> ',
  };
  process.stdout.write(screens[mode] + '\\n');
} else if (args[1] !== 'send-keys') process.exit(92);
`,
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    RESPONSES: responses,
    CALLS: calls,
    HERDR_CALLS: herdrCalls,
    SCREEN: screen,
    // The Section line is required from 1 Nov 2026; cases pin the clock.
    ENQUEUE_NOW: "2026-10-20T00:00:00Z",
    // The post-merge map Sync is off unless a case turns it on.
    WORK_MAP_SYNC: "0",
    LAUNCHCTL_CALLS: launchctlCalls,
    ...extraEnv,
    RENDERS: fileURLToPath(
      new URL("./fixtures/rendered-descriptions.json", import.meta.url),
    ),
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.GH_ENTERPRISE_TOKEN;
  delete env.GITHUB_ENTERPRISE_TOKEN;
  const run = (extra = [], reset = true, screenMode = "shown") => {
    if (reset) writeFileSync(responses, JSON.stringify(data));
    env.SCREEN_MODE = screenMode;
    return spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../enqueue.mjs", import.meta.url)),
        "--repo",
        "fixture/repo",
        "--pr",
        "17",
        "--head",
        head,
        ...extra,
      ],
      { env, encoding: "utf8" },
    );
  };
  const recorded = () => {
    try {
      return readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch {
      return [];
    }
  };
  const herdr = () => {
    try {
      return readFileSync(herdrCalls, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch {
      return [];
    }
  };
  const launchctl = () => {
    try {
      return readFileSync(launchctlCalls, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch {
      return [];
    }
  };
  return { data, pr, run, recorded, herdr, launchctl };
}
