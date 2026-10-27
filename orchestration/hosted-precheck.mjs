#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// The hosted pre-check line: a batch of ready pull requests runs the merge
// queue's units on GitHub-hosted runners, as a draft pull request built from
// main plus one merge per exact head. See hosted-precheck.md.
//
//   hosted-precheck.mjs start  --config FILE --root ROUND --clone DIR --agent-model MODEL PR SHA [PR SHA ...]
//   hosted-precheck.mjs finish --config FILE --root ROUND --state FILE
//
// Every check that reads runs before anything is written: a refusal writes
// nothing to GitHub. `finish` posts the commit status only from a completed
// run whose every mapped job succeeded, the contamination gate first.
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

const EXIT = { ok: 0, red: 1, usage: 2, refused: 3, wait: 4 };
const SHA = /^[0-9a-f]{40}$/u;

const now = () => new Date(process.env["HOSTED_PRECHECK_NOW"] ?? Date.now());
const utc = () =>
  now()
    .toISOString()
    .replace(/\.\d+Z$/u, "Z");

/** @param {string[]} args @returns {string} */
const gh = (...args) =>
  execFileSync("gh", ["api", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
/** @param {string[]} args @returns {any} */
const ghJson = (...args) => JSON.parse(gh(...args));

/** @param {string} cwd @param {string[]} args @returns {{status: number, out: string}} */
function git(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim() };
}

/** @param {string[]} argv */
function options(argv) {
  const [verb = "", ...rest] = argv;
  /** @type {Record<string, string>} */
  const flags = {};
  const pairs = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? "";
    if (a.startsWith("--")) {
      if (a in flags || rest[i + 1] === undefined) usage();
      flags[a] = rest[++i] ?? "";
    } else pairs.push(a);
  }
  const need =
    verb === "start"
      ? ["--config", "--root", "--clone", "--agent-model"]
      : ["--config", "--root", "--state"];
  if (!["start", "finish"].includes(verb) || need.some((f) => !flags[f]))
    usage();
  if (Object.keys(flags).some((f) => !need.includes(f))) usage();
  /** @type {{pr: number, sha: string}[]} */
  const members = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const pr = pairs[i] ?? "",
      sha = pairs[i + 1] ?? "";
    if (!/^[1-9][0-9]*$/u.test(pr) || !SHA.test(sha)) usage();
    if (members.some((m) => m.pr === Number(pr))) usage();
    members.push({ pr: Number(pr), sha });
  }
  if (verb === "start" && members.length === 0) usage();
  if (verb === "finish" && members.length > 0) usage();
  return { verb, flags, members };
}

// The orchestration copy of template/scripts/main-module.mjs `exitWith`
// (#316), as in skills/fetch.mjs: `process.exit` drops a `console.error`
// write still queued on a pipe, so each line goes to standard error whole
// before the exit, a full non-blocking pipe is waited on, and any other write
// error loses the text but never the exit code.
const pause = new Int32Array(new SharedArrayBuffer(4));
/** @param {number} code @param {string[]} lines @returns {never} */
function exitWith(code, ...lines) {
  const bytes = Buffer.from(lines.map((line) => `${line}\n`).join(""));
  let written = 0;
  while (written < bytes.length) {
    try {
      written += writeSync(2, bytes, written);
    } catch (error) {
      if (error?.code !== "EAGAIN") break;
      Atomics.wait(pause, 0, 0, 10);
    }
  }
  process.exit(code);
}

// Nothing is written before the arguments are read.
function usage() {
  exitWith(
    EXIT.usage,
    "usage: hosted-precheck.mjs start --config FILE --root ROUND --clone DIR --agent-model MODEL PR SHA [PR SHA ...]",
    "       hosted-precheck.mjs finish --config FILE --root ROUND --state FILE",
  );
}

/** @param {string} path */
function readConfig(path) {
  const c = JSON.parse(readFileSync(path, "utf8"));
  const strings = [
    "repo",
    "workflow",
    "workflowPath",
    "context",
    "lane",
    "branchPrefix",
    "gateJob",
  ];
  if (
    strings.some((k) => typeof c[k] !== "string" || c[k] === "") ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(c.repo) ||
    !/^[A-Za-z0-9-]+$/u.test(c.lane) ||
    !Number.isSafeInteger(c.maxBuildingGroups) ||
    !Number.isSafeInteger(c.settleSeconds) ||
    !Array.isArray(c.batchLabels) ||
    !c.batchLabels.includes("precheck-batch") ||
    !Array.isArray(c.deferred) ||
    c.deferred.length === 0 ||
    Object.keys(c.pins ?? {}).length === 0 ||
    Object.values(c.pins).some((v) => !SHA.test(String(v))) ||
    Object.keys(c.units ?? {}).length === 0
  )
    throw new Error(`config ${path} is incomplete`);
  return c;
}

/** One line in the round's event log. @param {string} root @param {any} c @param {string} text */
const event = (root, c, text) =>
  appendFileSync(join(root, "events.log"), `${utc()} LANE-${c.lane} ${text}\n`);

/** The heads lanes declared in the round's event log, by PR. @param {string} root */
function declared(root) {
  /** @type {Map<number, string[]>} */
  const heads = new Map();
  const line =
    /^\S+ LANE-\S+ (?:READY|FIX-PUSHED)\b.*?\bPR #(\d+)\b.*?\bhead[ =]([0-9a-f]{7,40})\b/u;
  for (const l of readFileSync(join(root, "events.log"), "utf8").split("\n")) {
    const m = line.exec(l);
    if (m)
      heads.set(Number(m[1]), [...(heads.get(Number(m[1])) ?? []), m[2] ?? ""]);
  }
  return heads;
}

/** Why a pull request is not a round lane's, ready at this head; empty when it is. */
function eligibility(c, root, { pr, sha }) {
  const why = [];
  let p;
  try {
    p = ghJson(`repos/${c.repo}/pulls/${pr}`);
  } catch {
    return [`#${pr} unreadable`];
  }
  if (!c.identities.includes(p.user?.login))
    why.push(`#${pr} is not a round lane's: author ${p.user?.login}`);
  if (p.head?.repo?.full_name !== c.repo)
    why.push(
      `#${pr} is not a round lane's: head in ${p.head?.repo?.full_name}`,
    );
  if (p.base?.ref !== "main")
    why.push(`#${pr} is based on ${p.base?.ref}, not main`);
  if (p.state !== "open" || p.draft)
    why.push(`#${pr} is ${p.draft ? "a draft" : p.state}`);
  if (p.head?.sha !== sha)
    why.push(
      `#${pr} head is ${String(p.head?.sha).slice(0, 7)}, not ${sha.slice(0, 7)}`,
    );
  // GitHub matches label names without regard to case.
  const hold = c.holdLabels.map((n) => n.toLowerCase());
  const held = (p.labels ?? [])
    .map((l) => String(l.name))
    .filter((n) => hold.includes(n.toLowerCase()));
  if (held.length) why.push(`#${pr} carries ${held.join(", ")}`);
  if (!(declared(root).get(pr) ?? []).some((h) => sha.startsWith(h)))
    why.push(`#${pr} has no READY or FIX-PUSHED line at ${sha.slice(0, 7)}`);
  return why;
}

/** Why the queue is too busy for a batch; empty when it is not. */
function queueBusy(c) {
  const building = new Set();
  try {
    for (const status of ["in_progress", "queued"])
      for (const r of ghJson(
        `repos/${c.repo}/actions/runs?event=merge_group&status=${status}&per_page=100`,
      ).workflow_runs)
        if (r.name === c.workflow) building.add(r.head_branch);
  } catch {
    return ["merge queue unreadable"];
  }
  return building.size > c.maxBuildingGroups
    ? [
        `${building.size} merge groups building (at most ${c.maxBuildingGroups})`,
      ]
    : [];
}

/** Why another batch blocks this one; empty when none is open. */
function openBatch(c) {
  try {
    const open = ghJson(
      `repos/${c.repo}/issues?labels=precheck-batch&state=open&per_page=100`,
    );
    return open
      .filter((i) => i.pull_request)
      .map((i) => `batch #${i.number} is still open`);
  } catch {
    return ["open batches unreadable"];
  }
}

/** Pinned files that differ from the map's pin at a tree-ish. */
function pinDrift(c, clone, at) {
  return Object.entries(c.pins).filter(
    ([path, blob]) => git(clone, "rev-parse", `${at}:${path}`).out !== blob,
  );
}

/** Build main plus one merge per head in the clone, without touching its working tree. */
function buildBatch(c, clone, id, model, members) {
  const why = [],
    left = [],
    conflicts = [];
  if (
    git(
      clone,
      "fetch",
      "-q",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/precheck-c/main",
    ).status
  )
    return { why: ["fetch of main failed"] };
  const main = git(clone, "rev-parse", "refs/precheck-c/main").out;
  for (const [path, blob] of pinDrift(c, clone, main))
    why.push(
      `${path} on main is ${git(clone, "rev-parse", `${main}:${path}`).out.slice(0, 7) || "absent"}, ` +
        `the map was checked against ${blob.slice(0, 7)}`,
    );
  let tip = main;
  const kept = [];
  for (const m of members) {
    const ref = `refs/precheck-c/pr-${m.pr}`;
    if (
      git(
        clone,
        "fetch",
        "-q",
        "--no-tags",
        "origin",
        `+refs/pull/${m.pr}/head:${ref}`,
      ).status
    ) {
      why.push(`fetch of #${m.pr} failed`);
      continue;
    }
    if (git(clone, "cat-file", "-e", `${m.sha}^{commit}`).status) {
      why.push(`#${m.pr} head ${m.sha.slice(0, 7)} is not in the clone`);
      continue;
    }
    const tree = git(clone, "merge-tree", "--write-tree", tip, m.sha);
    if (tree.status) {
      const alone = git(
        clone,
        "merge-tree",
        "--write-tree",
        main,
        m.sha,
      ).status;
      (alone ? conflicts : left).push(m);
      continue;
    }
    const treeId = tree.out.split("\n")[0] ?? "";
    for (const [path] of pinDrift(c, clone, treeId))
      if (
        git(clone, "rev-parse", `${tip}:${path}`).out !==
        git(clone, "rev-parse", `${treeId}:${path}`).out
      )
        why.push(`#${m.pr} changes ${path}`);
    const message =
      `chore(precheck): batch ${id} merges #${m.pr} ${m.sha.slice(0, 7)}\n\n` +
      `A hosted pre-check batch, never merged. Its branch is deleted when its run ends.\n\n` +
      `Assisted-by: LLM\nAgent-model: ${model}\nAgent-tool: code-factory hosted-precheck\n`;
    const commit = spawnSync(
      "git",
      ["-C", clone, "commit-tree", treeId, "-p", tip, "-p", m.sha, "-F", "-"],
      {
        input: message,
        encoding: "utf8",
      },
    );
    if (commit.status) {
      why.push(`merge commit for #${m.pr} failed`);
      continue;
    }
    tip = commit.stdout.trim();
    kept.push(m);
  }
  return { why, main, tip, kept, left, conflicts };
}

/** @param {any} c @param {string} sha @param {"success"|"failure"} state @param {string} description @param {string} url */
function postStatus(c, sha, state, description, url) {
  const args = [
    `repos/${c.repo}/statuses/${sha}`,
    "-X",
    "POST",
    "-f",
    `state=${state}`,
    "-f",
    `context=${c.context}`,
  ];
  args.push("-f", `description=${description.slice(0, 140)}`);
  if (url) args.push("-f", `target_url=${url}`);
  gh(...args);
}

/** One start at a time per round: a second waits for the first's draft to be seen as open. */
function start(c, flags, members) {
  const dir = join(flags["--root"], "lane-scratch", c.lane);
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, "start.lock");
  let fd;
  try {
    fd = openSync(lock, "wx");
  } catch {
    console.log(
      `REFUSED: another start holds ${lock} (remove it only if no start is running)`,
    );
    return EXIT.refused;
  }
  try {
    return startLocked(c, flags, members, dir);
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}

function startLocked(c, flags, members, dir) {
  const root = flags["--root"],
    clone = flags["--clone"];
  const id = `c-${utc().replace(/[-:]/gu, "").replace(/Z$/u, "")}`;
  const list = members.map((m) => `#${m.pr} ${m.sha.slice(0, 7)}`).join(" ");
  event(root, c, `START ${id} ${list}`);
  const refuse = (why) => {
    event(root, c, `END ${id} REFUSED ${why.join("; ")}`);
    console.log(`REFUSED ${id}: ${why.join("; ")}`);
    return EXIT.refused;
  };
  const why = members.flatMap((m) => eligibility(c, root, m));
  /** @type {Map<string, string[]>} */
  const unmapped = new Map();
  for (const [unit, job] of Object.entries(c.units))
    if (typeof job !== "string") {
      const reason = job?.none ?? "unmapped";
      unmapped.set(reason, [...(unmapped.get(reason) ?? []), unit]);
    }
  for (const [reason, units] of unmapped)
    why.push(`no hosted job for ${units.join(" ")}: ${reason}`);
  why.push(...queueBusy(c), ...openBatch(c));
  const built = buildBatch(c, clone, id, flags["--agent-model"], members);
  why.push(...built.why);
  if (why.length) return refuse(why);
  if (built.kept.length === 0)
    return refuse(["no member merges cleanly onto main"]);

  // Writes from here. A member that conflicts is left out with no status:
  // every status names a hosted run.
  const branch = `${c.branchPrefix}${id}`;
  const state = {
    id,
    repo: c.repo,
    branch,
    pr: 0,
    head: built.tip,
    main: built.main,
    members: built.kept,
    leftOut: built.left.map((m) => m.pr),
    conflicts: built.conflicts.map((m) => m.pr),
    startedAt: utc(),
  };
  const file = join(dir, `${id}.json`);
  const save = () => writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  // The push runs the repository's own pre-push hook (its local contamination gate).
  if (
    git(clone, "push", "-q", "origin", `${built.tip}:refs/heads/${branch}`)
      .status
  ) {
    event(root, c, `END ${id} FAILED push of ${branch} refused`);
    console.log(`FAILED ${id}: push of ${branch} refused`);
    return EXIT.refused;
  }
  try {
    const body =
      `Hosted pre-check batch ${id}: main ${built.main.slice(0, 7)} plus ` +
      `${state.members.map((m) => `#${m.pr} at ${m.sha}`).join(", ")}.\n\n` +
      `Never merged. Closed and its branch deleted when its run ends.`;
    state.pr = ghJson(
      `repos/${c.repo}/pulls`,
      "-X",
      "POST",
      "-f",
      `title=precheck batch ${id}`,
      "-f",
      `head=${branch}`,
      "-f",
      "base=main",
      "-f",
      `body=${body}`,
      "-F",
      "draft=true",
    ).number;
    save();
    gh(
      `repos/${c.repo}/issues/${state.pr}/labels`,
      "-X",
      "POST",
      ...c.batchLabels.flatMap((l) => ["-f", `labels[]=${l}`]),
    );
  } catch (error) {
    const cleanup = cleanUp(c, state);
    state.done = `FAILED ${id} opening the draft`;
    save();
    event(root, c, `END ${id} FAILED opening the draft (${cleanup})`);
    console.log(
      `FAILED ${id}: opening the draft: ${String(error).split("\n")[0]} state=${file} (${cleanup})`,
    );
    return EXIT.refused;
  }
  save();
  const extra = [
    ...state.leftOut.map((n) => `left-out #${n}`),
    ...state.conflicts.map((n) => `conflict #${n}`),
  ];
  console.log(
    `STARTED ${id} pr=${state.pr} branch=${branch} head=${built.tip} state=${file} ${extra.join(" ")}`.trim(),
  );
  return EXIT.ok;
}

/**
 * Close the draft and delete its branch, skipping what an earlier pass did;
 * records each step on the state so a failed one can be retried. Says what
 * happened.
 */
function cleanUp(c, state) {
  if (!state.closed)
    try {
      if (state.pr)
        gh(
          `repos/${c.repo}/pulls/${state.pr}`,
          "-X",
          "PATCH",
          "-f",
          "state=closed",
        );
      state.closed = true;
    } catch {}
  if (!state.deleted)
    try {
      gh(`repos/${c.repo}/git/refs/heads/${state.branch}`, "-X", "DELETE");
      state.deleted = true;
    } catch {}
  return [
    state.closed ? "closed" : "close failed",
    state.deleted ? "branch deleted" : "branch delete failed",
  ].join(", ");
}

/** The verdict of a completed run from its jobs and their logs. */
function judge(c, run) {
  const jobs = ghJson(
    `repos/${c.repo}/actions/runs/${run.id}/jobs?per_page=100`,
  ).jobs;
  const byName = new Map(jobs.map((j) => [j.name, j]));
  const nocount = [],
    red = [];
  const gate = byName.get(c.gateJob);
  if (gate?.conclusion !== "success")
    red.push(c.gateJob === c.units.gate ? "gate" : c.gateJob);
  else {
    const early = jobs.filter(
      (j) =>
        j !== gate &&
        j.started_at &&
        j.conclusion !== "skipped" &&
        j.started_at < gate.completed_at,
    );
    if (early.length)
      nocount.push(
        `${early.map((j) => j.name).join(", ")} started before the contamination gate finished`,
      );
  }
  for (const name of c.requiredJobs)
    if (byName.get(name)?.conclusion !== "success")
      nocount.push(`${name} ${byName.get(name)?.conclusion ?? "missing"}`);
  const checked = new Set();
  for (const [unit, name] of Object.entries(c.units)) {
    const job = byName.get(name);
    const result = job?.conclusion ?? "missing";
    if (result === "failure" || result === "timed_out") red.push(unit);
    else if (result !== "success") nocount.push(`${unit} (${name}) ${result}`);
    else if (!checked.has(job.id)) {
      checked.add(job.id);
      const log = gh(`repos/${c.repo}/actions/jobs/${job.id}/logs`);
      const hit = c.deferred.find((marker) => log.includes(marker));
      if (hit) nocount.push(`${name} log says "${hit}"`);
    }
  }
  return { red: [...new Set(red)], nocount };
}

function finish(c, flags) {
  const root = flags["--root"],
    file = flags["--state"];
  const state = JSON.parse(readFileSync(file, "utf8"));
  const save = () => writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  if (state.repo !== c.repo || !SHA.test(state.head)) {
    console.log(
      `REFUSED ${state.id}: state ${file} is not a batch of ${c.repo}`,
    );
    return EXIT.refused;
  }
  // An ended batch posts nothing again; only its unfinished cleanup is retried.
  if (state.done) {
    const cleanup = cleanUp(c, state);
    save();
    event(root, c, `CLEANUP ${state.id} (${cleanup})`);
    console.log(`ENDED ${state.done} (${cleanup})`);
    return state.closed && state.deleted ? EXIT.ok : EXIT.refused;
  }
  const runs = ghJson(
    `repos/${c.repo}/actions/runs?head_sha=${state.head}&event=pull_request&per_page=100`,
  )
    // Only the pinned workflow file's run on the batch's own branch in this
    // repository: a member adding another workflow named the same, or a fork
    // reopening the batch commit, is not the batch's run.
    .workflow_runs.filter(
      (r) =>
        r.name === c.workflow &&
        r.path === c.workflowPath &&
        r.head_branch === state.branch &&
        r.head_repository?.full_name === c.repo,
    )
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const run = runs[0];
  const settling =
    now().getTime() - Date.parse(state.startedAt) < c.settleSeconds * 1000;
  if (
    !run ||
    run.status !== "completed" ||
    (run.conclusion === "cancelled" && settling)
  ) {
    console.log(
      `WAIT ${state.id} run ${run?.html_url ?? "none"} ${run?.status ?? "not started"}`,
    );
    return EXIT.wait;
  }
  const url = run.html_url;
  let verdict;
  try {
    verdict =
      run.conclusion === "cancelled"
        ? { red: [], nocount: ["run cancelled"] }
        : judge(c, run);
  } catch (error) {
    // A completed run whose jobs or logs can't be read proves nothing.
    const why = String(error instanceof Error ? error.message : error);
    verdict = {
      red: [],
      nocount: [`jobs or logs unreadable: ${why.split("\n")[0]}`],
    };
  }
  const prs = state.members.map((m) => `#${m.pr}`).join(" ");
  let line, code;
  if (verdict.nocount.length) {
    line = `NOCOUNT ${state.id} run ${url} ${verdict.nocount.join("; ")}`;
    code = EXIT.refused;
  } else if (verdict.red.length === 0) {
    for (const m of state.members)
      postStatus(
        c,
        m.sha,
        "success",
        `batch ${state.id} green, run ${url}`,
        url,
      );
    line = `GREEN ${state.id} run ${url} ${prs}`;
    code = EXIT.ok;
  } else if (state.members.length === 1) {
    const [m] = state.members;
    postStatus(
      c,
      m.sha,
      "failure",
      `batch ${state.id} red (${verdict.red.join(" ")}), run ${url}`,
      url,
    );
    line = `RED ${state.id} run ${url} units ${verdict.red.join(" ")} ${prs}`;
    code = EXIT.red;
  } else {
    const half = Math.ceil(state.members.length / 2);
    const side = (ms) => ms.map((m) => `#${m.pr}`).join(" ");
    line =
      `SPLIT ${state.id} run ${url} units ${verdict.red.join(" ")} suspects ` +
      `${side(state.members.slice(0, half))} | ${side(state.members.slice(half))}`;
    code = EXIT.red;
  }
  state.done = line;
  state.endedAt = utc();
  save();
  const cleanup = cleanUp(c, state);
  save();
  event(root, c, `END ${line.replace(/^(\S+) (\S+)/u, "$2 $1")} (${cleanup})`);
  console.log(`${line} (${cleanup})`);
  return code;
}

try {
  const { verb, flags, members } = options(process.argv.slice(2));
  const c = readConfig(flags["--config"]);
  process.exitCode =
    verb === "start" ? start(c, flags, members) : finish(c, flags);
} catch (error) {
  console.error(
    `hosted-precheck: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
  );
  process.exitCode = EXIT.usage;
}
