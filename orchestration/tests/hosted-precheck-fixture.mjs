// SPDX-License-Identifier: AGPL-3.0-only
// A fake GitHub and real git repositories for hosted-precheck.mjs: an origin
// with main and two pull request heads, the clone the script builds in, a
// round folder with its event log, and a `gh` on PATH that answers from
// routes and records every call.
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../hosted-precheck.mjs", import.meta.url),
);
export const REPO = "fixture/repo";
export const RUN_URL = "https://github.com/fixture/repo/actions/runs/700";
const ENV = {
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...ENV },
  }).trim();

/** The jobs a full pull request run reports, gate first, all green. */
export function jobs(config) {
  const names = [config.gateJob, ...config.requiredJobs];
  for (const job of Object.values(config.units))
    if (typeof job === "string") names.push(job);
  return [...new Set(names)].map((name, i) => ({
    id: 900 + i,
    name,
    status: "completed",
    conclusion: "success",
    started_at: i === 0 ? "2026-10-19T03:00:00Z" : "2026-10-19T03:05:00Z",
    completed_at: i === 0 ? "2026-10-19T03:04:00Z" : "2026-10-19T03:15:00Z",
  }));
}

export function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "hosted-precheck-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, "origin.git"),
    work = join(root, "work"),
    clone = join(root, "clone"),
    round = join(root, "round"),
    bin = join(root, "bin");
  for (const d of [work, round, bin]) mkdirSync(d);
  git(root, "init", "-q", "--bare", origin);
  git(work, "init", "-q", "-b", "main");
  mkdirSync(join(work, ".github/workflows"), { recursive: true });
  writeFileSync(join(work, ".github/workflows/ci.yml"), "name: ci\n");
  writeFileSync(join(work, "a.txt"), "a\n");
  writeFileSync(join(work, "b.txt"), "b\n");
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "chore: main");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "-q", "origin", "main");
  const pin = git(work, "rev-parse", "HEAD:.github/workflows/ci.yml");
  /** A pull request head on top of main that writes one file. */
  const head = (pr, file, text) => {
    git(work, "checkout", "-q", "-B", `pr-${pr}`, "main");
    writeFileSync(join(work, file), text);
    git(work, "commit", "-q", "-am", `feat: pull request ${pr}`);
    git(work, "push", "-q", "origin", `HEAD:refs/pull/${pr}/head`);
    return git(work, "rev-parse", "HEAD");
  };
  const heads = {
    11: head(11, "a.txt", "a11\n"),
    12: head(12, "b.txt", "b12\n"),
  };
  git(root, "clone", "-q", origin, clone);

  const units = {
    gate: "contamination gate",
    secrets: "gitleaks over the full history",
  };
  for (const i of [1, 2]) units[`db${i}`] = `database conformance shard ${i}`;
  const config = {
    repo: REPO,
    workflow: "ci",
    workflowPath: ".github/workflows/ci.yml",
    context: "hosted/precheck",
    lane: "OA-Precheck-C",
    identities: ["Round-Identity"],
    holdLabels: ["held", "unreviewed", "sent-back", "precheck-batch"],
    batchLabels: ["ci-next", "precheck-batch"],
    branchPrefix: "precheck-c/",
    maxBuildingGroups: 1,
    pins: { ".github/workflows/ci.yml": pin },
    gateJob: "contamination gate",
    requiredJobs: ["full checks"],
    units,
    deferred: ["deferred on a pull request"],
    settleSeconds: 180,
  };
  const pull = (pr, extra = {}) => ({
    number: pr,
    state: "open",
    draft: false,
    user: { login: "Round-Identity" },
    head: { sha: heads[pr], repo: { full_name: REPO } },
    base: { ref: "main" },
    labels: [],
    ...extra,
  });
  // Routes: the first whose pattern matches the joined arguments answers.
  // `seq` answers in turn and then repeats its last.
  const routes = {
    pull11: { match: "^api repos/fixture/repo/pulls/11$", body: pull(11) },
    pull12: { match: "^api repos/fixture/repo/pulls/12$", body: pull(12) },
    queue: {
      match: "actions/runs\\?event=merge_group",
      body: { workflow_runs: [] },
    },
    batches: { match: "issues\\?labels=precheck-batch", body: [] },
    create: {
      match: "^api repos/fixture/repo/pulls -X POST",
      body: { number: 500 },
    },
    labels: { match: "^api repos/fixture/repo/issues/500/labels", body: [] },
    runs: {
      match: "actions/runs\\?head_sha=",
      body: {
        workflow_runs: [
          {
            id: 700,
            name: "ci",
            path: ".github/workflows/ci.yml",
            // The branch start names from HOSTED_PRECHECK_NOW's default.
            head_branch: "precheck-c/c-20261019T033000",
            head_repository: { full_name: REPO },
            status: "completed",
            conclusion: "success",
            html_url: RUN_URL,
            created_at: "2026-10-19T03:00:00Z",
          },
        ],
      },
    },
    jobs: { match: "actions/runs/700/jobs", body: { jobs: jobs(config) } },
    logs: {
      match: "actions/jobs/\\d+/logs",
      raw: "ci-scope: database conformance: runs\n",
    },
    status: { match: "^api repos/fixture/repo/statuses/", body: {} },
    close: { match: "^api repos/fixture/repo/pulls/500 -X PATCH", body: {} },
    branch: {
      match: "^api repos/fixture/repo/git/refs/heads/precheck-c/",
      body: {},
    },
  };
  const responses = join(root, "routes.json"),
    calls = join(root, "calls.jsonl");
  writeFileSync(
    join(bin, "gh"),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_CALLS, JSON.stringify(args) + '\\n');
const routes = JSON.parse(fs.readFileSync(process.env.FAKE_GH_ROUTES, 'utf8'));
const query = args.join(' ');
for (const [key, route] of Object.entries(routes)) {
  if (!new RegExp(route.match, 'u').test(query)) continue;
  let r = route;
  if (route.seq) {
    const seen = fs.readFileSync(process.env.FAKE_GH_CALLS, 'utf8').split('\\n').filter(Boolean)
      .filter((l) => new RegExp(route.match, 'u').test(JSON.parse(l).join(' '))).length;
    r = route.seq[Math.min(seen, route.seq.length) - 1];
  }
  if (r.exit) process.exit(r.exit);
  process.stdout.write(r.raw ?? JSON.stringify(r.body));
  process.exit(0);
}
process.stderr.write('fake gh: no route for ' + query + '\\n');
process.exit(90);
`,
    { mode: 0o755 },
  );
  const events = join(round, "events.log");
  writeFileSync(
    events,
    [11, 12]
      .map(
        (pr) =>
          `2026-10-19T02:00:0${pr - 10}Z LANE-OA-Fixture-${pr} READY PR #${pr} head ${heads[pr]} base main\n`,
      )
      .join(""),
  );
  const configPath = join(root, "config.json");
  const f = {
    root,
    origin,
    clone,
    round,
    events,
    heads,
    config,
    routes,
    run(verb, ...args) {
      writeFileSync(configPath, JSON.stringify(this.config));
      writeFileSync(responses, JSON.stringify(this.routes));
      return spawnSync(
        process.execPath,
        [script, verb, "--config", configPath, "--root", round, ...args],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            ...ENV,
            PATH: `${bin}:${process.env.PATH}`,
            FAKE_GH_ROUTES: responses,
            FAKE_GH_CALLS: calls,
            HOSTED_PRECHECK_NOW: this.now ?? "2026-10-19T03:30:00Z",
          },
        },
      );
    },
    start(...prs) {
      const pairs = prs.flatMap((pr) => [
        String(pr),
        this.heads[pr] ?? "f".repeat(40),
      ]);
      return this.run(
        "start",
        "--clone",
        clone,
        "--agent-model",
        "claude-opus-5-5",
        ...pairs,
      );
    },
    calls() {
      return existsSync(calls)
        ? readFileSync(calls, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l))
        : [];
    },
    /** Every call that changes GitHub: a write method or a status. */
    writes() {
      return this.calls().filter((a) =>
        /-X (POST|PATCH|DELETE|PUT)|\/statuses\//u.test(a.join(" ")),
      );
    },
    statuses() {
      return this.calls()
        .filter((a) => /\/statuses\//u.test(a[1] ?? ""))
        .map((a) => ({
          sha: a[1].split("/").pop(),
          fields: a.filter((x) =>
            /^(state|context|description|target_url)=/u.test(x),
          ),
        }));
    },
    branches() {
      return git(
        origin,
        "for-each-ref",
        "--format=%(refname)",
        "refs/heads/precheck-c/",
      );
    },
    log() {
      return readFileSync(events, "utf8")
        .split("\n")
        .filter((l) => / LANE-OA-Precheck-C /u.test(l));
    },
    /** The state file a STARTED line names, and what it holds. */
    state(stdout) {
      const file = / state=(\S+)/u.exec(stdout)?.[1] ?? "";
      return { file, ...JSON.parse(readFileSync(file, "utf8")) };
    },
    git: (...args) => git(clone, ...args),
  };
  return f;
}
