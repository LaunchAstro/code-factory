#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from "node:child_process";

class Wait extends Error {
  /** @param {string} gate @param {string} reason @param {number} [code] */
  constructor(gate, reason, code = 1) {
    super(reason);
    this.gate = gate;
    this.code = code;
  }
}

/** @param {unknown} value @returns {value is string} */
const text = (value) => typeof value === "string" && value.length > 0;
/** @param {unknown} value @returns {value is number} */
const id = (value) => Number.isSafeInteger(value) && Number(value) > 0;

/** @param {string[]} args @returns {{repo: string, pr: number, head: string, pane: string|null}} */
function options(args) {
  /** @type {Record<string, string>} */
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i],
      value = args[i + 1];
    if (
      !flag ||
      !["--repo", "--pr", "--head", "--pane"].includes(flag) ||
      !value ||
      flag in values
    )
      throw new Wait(
        "input",
        "usage: --repo OWNER/REPO --pr NUMBER --head FULL_SHA [--pane HERDR_PANE]",
        2,
      );
    values[flag] = value;
  }
  const repo = values["--repo"] ?? "",
    pr = Number(values["--pr"]),
    head = values["--head"] ?? "",
    pane = values["--pane"] ?? null;
  if (
    (pane !== null && !/^[A-Za-z0-9_.:-]+$/u.test(pane)) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo) ||
    !/^[1-9][0-9]*$/u.test(values["--pr"] ?? "") ||
    !id(pr) ||
    !/^[a-f0-9]{40}$/u.test(head)
  )
    throw new Wait(
      "input",
      "expected repository, PR number and full lowercase SHA",
      2,
    );
  return { repo, pr, head, pane };
}

/** @param {string} gate @param {string[]} args @param {(data: any) => any} validate @returns {any} */
function read(gate, args, validate) {
  try {
    const data = JSON.parse(
      execFileSync("gh", ["api", ...args], {
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    if (!data || data.errors !== undefined) throw new Error("api errors");
    return validate(data);
  } catch {
    throw new Wait(gate, "failed-or-incomplete-response", 2);
  }
}

/** @param {{repo: string, pr: number}} target @returns {any} */
function pull(target) {
  const [owner, name] = target.repo.split("/");
  const query = `query { repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) {
    pullRequest(number:${target.pr}) { id state headRefOid isDraft isMergeQueueEnabled mergeQueueEntry { id } body
      commits(last:1) { nodes { commit { oid committedDate } } }
      timelineItems(itemTypes:[REMOVED_FROM_MERGE_QUEUE_EVENT], last:100) {
        filteredCount pageInfo { hasPreviousPage }
        nodes { ... on RemovedFromMergeQueueEvent { createdAt reason } } }
      labels(first:100) { nodes { name } totalCount }
      baseRef { name branchProtectionRule { requiredStatusChecks { context app { databaseId } } } }
    }
  } }`;
  return read("read-pr", ["graphql", "-f", `query=${query}`], (data) => {
    const pr = data.data?.repository?.pullRequest;
    if (
      !text(pr?.id) ||
      !["OPEN", "CLOSED", "MERGED"].includes(pr.state) ||
      !/^[a-f0-9]{40}$/u.test(pr.headRefOid) ||
      typeof pr.isDraft !== "boolean" ||
      typeof pr.isMergeQueueEnabled !== "boolean" ||
      !(pr.mergeQueueEntry === null || text(pr.mergeQueueEntry?.id)) ||
      !Array.isArray(pr.labels?.nodes) ||
      pr.labels.totalCount !== pr.labels.nodes.length ||
      pr.labels.nodes.some((/** @type {any} */ l) => !text(l?.name)) ||
      !text(pr.baseRef?.name) ||
      !(pr.body === null || typeof pr.body === "string") ||
      !/^[a-f0-9]{40}$/u.test(pr.commits?.nodes?.[0]?.commit?.oid) ||
      Number.isNaN(Date.parse(pr.commits.nodes[0].commit.committedDate)) ||
      !Array.isArray(pr.timelineItems?.nodes) ||
      // totalCount counts every timeline event; filteredCount counts the
      // removals asked for. Complete means all of those, with no earlier page.
      pr.timelineItems.filteredCount !== pr.timelineItems.nodes.length ||
      pr.timelineItems.pageInfo?.hasPreviousPage !== false ||
      pr.timelineItems.nodes.some((/** @type {any} */ e) =>
        Number.isNaN(Date.parse(e?.createdAt)),
      ) ||
      !(
        pr.baseRef.branchProtectionRule === null ||
        Array.isArray(pr.baseRef.branchProtectionRule?.requiredStatusChecks)
      )
    )
      throw new Error("pr shape");
    return pr;
  });
}

/** @param {any} pr @param {string} head */
function eligible(pr, head) {
  if (pr.headRefOid !== head) throw new Wait("head", "moved-or-stale");
  if (pr.state !== "OPEN" || pr.isDraft)
    throw new Wait("pr-state", "closed-or-draft");
  if (
    pr.labels.nodes.some((/** @type {any} */ l) =>
      ["hold", "held", "factory/held"].includes(l.name.toLowerCase()),
    )
  )
    throw new Wait("hold", "hold-label");
}

const TEMPLATE =
  "**Why:** <the reasons for the choices in this code> **Left undone:** <#ticket, #ticket, or none> Closes <#ticket, closes #ticket, or Closes: none> Section: <work map section id, or outside>";
const TICKET =
  /^(?:(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#|https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/)[1-9][0-9]*$/u;

// The description as GitHub shows it, one visible line per entry (#169). GitHub's own
// renderer decides what is code (fenced or indented), a comment or a list continuation;
// code blocks are dropped, inline code is kept but can never start a line.
/** @param {string} body @returns {string[]} */
function rendered(body) {
  if (!body.trim()) return [];
  let html;
  try {
    html = execFileSync("gh", ["api", "markdown", "--input", "-"], {
      input: JSON.stringify({ text: body, mode: "gfm" }),
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Wait("read-description", "failed-or-incomplete-response", 2);
  }
  /** @type {Record<string, string>} */
  const named = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&", nbsp: " " };
  return html
    .replace(/<pre[\s\S]*?<\/pre>/giu, "\n")
    .replace(/<del>[\s\S]*?<\/del>/giu, "")
    .replace(
      /<code[^>]*>([\s\S]*?)<\/code>/giu,
      (_, code) => "`" + code.replace(/\*/gu, "\u2217") + "`",
    )
    .replace(/<strong>([\s\S]*?)<\/strong>/giu, "**$1**")
    .replace(
      /<br\s*\/?>|<\/?(p|li|ul|ol|h[1-6]|blockquote|div|table|tr|td|th)(\s[^>]*)?>/giu,
      "\n",
    )
    .replace(/<[^>]+>/gu, "")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (m, e) =>
      e[0] === "#"
        ? String.fromCodePoint(
            e[1] === "x" || e[1] === "X"
              ? parseInt(e.slice(2), 16)
              : Number(e.slice(1)),
          )
        : (named[e.toLowerCase()] ?? m),
    )
    .split("\n");
}

// The price of the queue (owner, 15 October 2026): the description carries
// one "**Why:**" line with a real reason, one "**Left undone:**" line listing
// follow-up tickets or none, and "Closes #n" lines in GitHub's own keyword
// form (one keyword per ticket, so auto-close works) or "Closes: none". The code is the truth; these point at it.
/** @param {string|null} body @returns {string[]} */
function described(body) {
  const lines = rendered(body ?? "").map((l) =>
    l.trim().replace(/^[-*] +/u, ""),
  );
  const why = lines.filter((l) => l.startsWith("**Why:**"));
  const left = lines.filter((l) => l.startsWith("**Left undone:**"));
  const closes = lines.filter((l) => /^closes\b/iu.test(l));
  if (!why.length && !left.length && !closes.length)
    throw new Wait("description", "missing");
  const reason = why[0]?.slice("**Why:**".length).trim() ?? "";
  const tickets = (left[0]?.slice("**Left undone:**".length).trim() ?? "")
    .replace(/\.$/u, "")
    .split(/ *, */u);
  if (
    why.length !== 1 ||
    left.length !== 1 ||
    !/\p{L}{2}/u.test(reason) ||
    /^(<.*>|tbd|todo)$/iu.test(
      reason.replace(/^[`'"*_\s]+|[`'"*_\s.!?:;,\u2026]+$/gu, ""),
    ) ||
    !(
      (tickets.length === 1 && /^none$/iu.test(tickets[0] ?? "")) ||
      tickets.every((t) => TICKET.test(t))
    ) ||
    !(
      (closes.length === 1 && /^closes: *none\.?$/iu.test(closes[0] ?? "")) ||
      (closes.length > 0 &&
        closes.every((l) =>
          l
            .replace(/\.$/u, "")
            .split(/ *, */u)
            .every((part) => {
              const [, ref] = part.match(/^closes:? +(\S+)$/iu) ?? [];
              return ref !== undefined && TICKET.test(ref);
            }),
        ))
    )
  )
    throw new Wait("description", "malformed");
  return lines;
}

// The work map places a merged PR by its "Section: <id>" line (#203), the id
// as the map reads it, or "outside". Missing warns until 1 Nov 2026 00:00 in
// Sydney, then waits; malformed or two different ids wait from the start.
// The grammar is strict and every wrapper is paired (#206, two review rounds
// on edge forms): "Section: id", "**Section:** id", "**Section: id**", with
// the id optionally in one pair of backticks, or (after the first two forms)
// in one pair of bold markers, and at most one full stop, just inside or just
// outside a closing bold. Any other line starting "Section:" is malformed.
// ENQUEUE_NOW pins the clock for the test cases.
const SECTION_FROM = "2026-10-31T13:00:00Z";
const SECTION = /^(?:\*\*)?Section:/u;
const SECTION_ID = [
  /^(?:\*\*Section:\*\*|Section:) *(\*\*)?(`?)([a-z][a-z0-9-]*)\2(?:\.?\1|\1\.?)$/u,
  /^\*\*Section: *()(`?)([a-z][a-z0-9-]*)\2(?:\.?\*\*|\*\*\.?)$/u,
];
/** @param {string[]} lines @returns {string|null} a warning to print, if any */
function sectioned(lines) {
  const found = lines.filter((l) => SECTION.test(l));
  const ids = new Set(
    found.map(
      (l) => SECTION_ID.map((r) => l.match(r)?.[3]).find(Boolean) ?? "",
    ),
  );
  if (ids.has("") || ids.size > 1) throw new Wait("section", "malformed");
  if (found.length) return null;
  const now = Date.parse(process.env.ENQUEUE_NOW ?? "") || Date.now();
  if (now >= Date.parse(SECTION_FROM)) throw new Wait("section", "missing");
  return "WARN gate=section reason=missing required-from=2026-11-01";
}

// With no merge queue, the description also carries the change's risk
// (owner, 15 October 2026): "**Risk:** low|medium|high" and its reason. Low
// skips Sol; medium and high need Sol's approval of the head.
/** @param {string[]} lines @returns {"low"|"medium"|"high"} */
function risk(lines) {
  const found = lines.filter((l) => l.startsWith("**Risk:**"));
  if (!found.length) throw new Wait("risk", "missing");
  const [, level] =
    (found[0] ?? "").match(/^\*\*Risk:\*\* *(low|medium|high)\b/iu) ?? [];
  if (found.length !== 1 || !level) throw new Wait("risk", "malformed");
  return /** @type {"low"|"medium"|"high"} */ (level.toLowerCase());
}

// Files a low-risk change never touches. A match means the rank is wrong and
// Sol reads it: database changes, what runs in CI or deploys, what installs,
// secrets, and sign-in.
const NOT_LOW = [
  // Database changes.
  /(^|\/)(migrations?|supabase|prisma|drizzle)\//iu,
  /\.sql$/iu,
  // What runs in CI, on commit or on deploy.
  /^\.(github|circleci|husky|githooks|buildkite)\//u,
  /(^|\/)(\.gitlab-ci\.yml|Jenkinsfile|azure-pipelines\.ya?ml|\.pre-commit-config\.yaml|lefthook\.ya?ml)$/u,
  /(^|\/)(vercel\.json|netlify\.toml|wrangler\.(toml|json|jsonc)|fly\.toml|render\.yaml|Procfile|Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml)$/u,
  // What installs. Any file with "lock" in its name, Swift's resolved pins,
  // then each ecosystem's manifests and toolchain pins. A false match only
  // sends the change to Sol.
  /(^|\/)[^/]*lock[^/]*$/iu,
  /(^|\/)Package\.resolved$/u,
  /(^|\/)(package\.json|npm-shrinkwrap\.json|pnpm-workspace\.yaml|\.npmrc|\.yarnrc(\.yml)?|bunfig\.toml|deno\.jsonc?)$/u,
  /(^|\/)(pyproject\.toml|requirements[^/]*\.(txt|in)|constraints[^/]*\.txt|Pipfile|setup\.(py|cfg)|environment\.ya?ml)$/u,
  /(^|\/)(Cargo\.toml|rust-toolchain(\.toml)?|go\.(mod|sum|work)|Gemfile|[^/]*\.gemspec|composer\.json)$/u,
  /(^|\/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|gradle-wrapper\.properties|build\.sbt|project\.clj|deps\.edn|mix\.exs)$/u,
  /(^|\/)([^/]*\.(cs|fs|vb)proj|Directory\.(Packages|Build)\.props|nuget\.config|global\.json)$/iu,
  /(^|\/)(pubspec\.yaml|Package\.swift|Podfile|Cartfile|[^/]*\.podspec)$/u,
  /(^|\/)(flake\.nix|shell\.nix|default\.nix|\.tool-versions|\.nvmrc|\.node-version|\.python-version|\.ruby-version|Makefile|justfile|Taskfile\.ya?ml)$/u,
  // Secrets.
  /(^|\/)\.env/u,
  /(^|\/)(secrets?|credentials?)(\/|\.|$)/iu,
  // Sign-in and sessions.
  /(^|\/)(auth|middleware|sign-?in|sign-?up|log-?in|session|sessions|oauth|sso)(\/|\.|$)/iu,
];

/** @param {{repo: string, pr: number}} target */
function lowRisk(target) {
  const files = read(
    "read-files",
    [
      `repos/${target.repo}/pulls/${target.pr}/files?per_page=100`,
      "--method",
      "GET",
      "--paginate",
      "--slurp",
    ],
    (pages) => {
      if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p)))
        throw new Error("file pages");
      const all = pages.flat();
      // GitHub lists at most 3,000 files; a list that long is not low risk.
      if (all.length >= 3000 || all.some((f) => !text(f?.filename)))
        throw new Error("file shape");
      return all.flatMap((f) =>
        text(f.previous_filename)
          ? [f.filename, f.previous_filename]
          : [f.filename],
      );
    },
  );
  const hit = files.find((f) => NOT_LOW.some((p) => p.test(f)));
  if (hit) throw new Wait("risk", `not-low ${hit}`);
}

// Drops since this head's commit: one re-queue, then the lane takes it back.
/** @param {any} pr @returns {{count: number, reason: string}} */
function drops(pr) {
  // The newest commit must be the head, or its date says nothing about it.
  if (pr.commits.nodes[0].commit.oid !== pr.headRefOid)
    throw new Wait("read-pr", "failed-or-incomplete-response", 2);
  const since = Date.parse(pr.commits.nodes[0].commit.committedDate);
  const after = pr.timelineItems.nodes
    .filter((/** @type {any} */ e) => Date.parse(e.createdAt) > since)
    .sort((/** @type {any} */ a, /** @type {any} */ b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  const count = after.length;
  if (count >= 2)
    throw Object.assign(new Wait("dropped", "twice-at-head"), {
      last: String(after.at(-1).reason ?? "unknown"),
    });
  return { count, reason: count ? String(after[0].reason ?? "unknown") : "" };
}

/** @param {Wait & {last?: string}} wait @param {{pr: number, head: string}} target */
function laneLine(wait, target) {
  if (wait.gate === "description" || wait.gate === "section")
    return `Loading bay: PR #${target.pr} can't be queued until its description has four lines, each on its own line: ${TEMPLATE} Unfinished work goes in tickets. Then mark it ready again.`;
  if (wait.gate === "dropped")
    return `Loading bay: PR #${target.pr} was dropped from the merge queue twice at head ${target.head.slice(0, 7)} (last reason: ${wait.last}). It is back with you: reproduce, fix, push, and mark it ready again.`;
  return null;
}

/** @param {string[]} args */
const herdr = (args) =>
  execFileSync("herdr", args, {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

// A dialog or option menu takes Enter as a choice, which can opt into paid
// usage, so any sign of one stops the send.
const MODAL =
  /usage (?:credit|limit)|extra usage|pay-as-you-go|billing|upgrade your plan|trust this folder|do you want to|^\s*[\u276f\u203a]\s*(?:\d+\.\s*)?(?:yes|no|allow|enable|continue)\b|^\s*\d+\.\s*(?:yes|no)\b/imu;

// One line to the owning lane's pane. Enter only when a new copy of the text
// (or a new paste marker) has appeared since the send and no dialog is up.
/** @param {string} pane @param {string} line @returns {string} */
function tell(pane, line) {
  const read = () =>
    herdr([
      "pane",
      "read",
      pane,
      "--source",
      "recent-unwrapped",
      "--lines",
      "30",
    ]);
  const tail = line.slice(-40);
  /** @param {string} screen */
  const marks = (screen) =>
    screen
      .split("\n")
      .filter(
        (l) => l.includes(tail) || /Pasted text|paste again to expand/u.test(l),
      );
  try {
    const before = read();
    if (MODAL.test(before)) return "failed reason=modal";
    herdr(["pane", "send-text", pane, line]);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    const after = read();
    if (MODAL.test(after)) return "failed reason=modal";
    const old = marks(before),
      now = marks(after);
    if (now.length <= old.length && now.every((l) => old.includes(l)))
      return "failed reason=not-visible";
    herdr(["pane", "send-keys", pane, "Enter"]);
    return "sent";
  } catch {
    return "failed reason=herdr";
  }
}

/** @param {string} repo @param {any} pr @returns {any[]} */
function rules(repo, pr) {
  return read(
    "read-rules",
    [
      `repos/${repo}/rules/branches/${encodeURIComponent(pr.baseRef.name)}?per_page=100`,
      "--method",
      "GET",
      "--paginate",
      "--slurp",
    ],
    (data) => {
      if (
        !Array.isArray(data) ||
        !data.length ||
        data.some((p) => !Array.isArray(p))
      )
        throw new Error("rules pages");
      return data.flat();
    },
  );
}

/** @typedef {{context: string, app: number|null}} Required */
/** @param {any[]} branchRules @param {any} pr @returns {Required[]} */
function requirements(branchRules, pr) {
  try {
    /** @type {Required[]} */
    const result = [];
    /** @param {any} context @param {any} app */
    const add = (context, app) => {
      if (!text(context) || !(app === null || id(app)))
        throw new Error("required shape");
      if (!result.some((r) => r.context === context && r.app === app))
        result.push({ context, app });
    };
    for (const rule of branchRules) {
      if (!text(rule?.type)) throw new Error("rule shape");
      if (rule.type !== "required_status_checks") continue;
      if (!Array.isArray(rule.parameters?.required_status_checks))
        throw new Error("required checks");
      for (const check of rule.parameters.required_status_checks)
        add(check?.context, check?.integration_id ?? null);
    }
    for (const check of pr.baseRef.branchProtectionRule?.requiredStatusChecks ??
      [])
      add(check?.context, check?.app === null ? null : check?.app?.databaseId);
    return result.sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  } catch {
    throw new Wait("read-rules", "invalid-required-checks", 2);
  }
}

/** @param {string} gate @param {string} endpoint @param {string} key @param {string} head @returns {any[]} */
function results(gate, endpoint, key, head) {
  return read(
    gate,
    [endpoint, "--method", "GET", "--paginate", "--slurp"],
    (pages) => {
      if (
        !Array.isArray(pages) ||
        !pages.length ||
        pages.some(
          (p) =>
            !Array.isArray(p?.[key]) ||
            !Number.isSafeInteger(p.total_count) ||
            p.total_count < 0 ||
            p.total_count !== pages[0].total_count ||
            (key === "statuses" && p.sha !== head),
        )
      )
        throw new Error("result pages");
      const all = pages.flatMap((p) => p[key]);
      if (
        all.length !== pages[0].total_count ||
        new Set(all.map((c) => c?.id)).size !== all.length
      )
        throw new Error("incomplete results");
      for (const c of all) {
        if (
          !id(c?.id) ||
          (key === "check_runs"
            ? !text(c.name) ||
              c.head_sha !== head ||
              !text(c.status) ||
              !(c.conclusion === null || text(c.conclusion)) ||
              !(c.app === null || id(c.app?.id))
            : !text(c.context) ||
              !["success", "pending", "failure", "error"].includes(c.state))
        )
          throw new Error("result shape");
      }
      return all;
    },
  );
}

/** @param {Required[]} required @param {any[]} runs @param {any[]} statuses @param {boolean} queue */
function green(required, runs, statuses, queue) {
  if (queue && !required.length)
    throw new Wait("required-checks", "empty-list");
  // With no queue the merge is final, so every check on the head must have
  // finished without failing, required or not. Skipped and neutral pass here.
  if (!queue) {
    const newest = new Map();
    for (const c of runs) {
      const key = `${c.name}\u0000${c.app?.id ?? ""}`;
      if (!newest.has(key) || newest.get(key).id < c.id) newest.set(key, c);
    }
    for (const c of newest.values())
      if (
        c.status !== "completed" ||
        !["success", "skipped", "neutral"].includes(c.conclusion)
      )
        throw new Wait(
          c.name,
          c.status !== "completed" ? c.status : (c.conclusion ?? "pending"),
        );
    const latest = new Map();
    for (const c of statuses) {
      const key = c.context.toLowerCase();
      if (!latest.has(key) || latest.get(key).id < c.id) latest.set(key, c);
    }
    for (const c of latest.values())
      if (c.state !== "success") throw new Wait(c.context, c.state);
  }
  for (const r of required) {
    // Keep each app's newest run; an old green attempt cannot hide its rerun.
    const latest = new Map();
    for (const c of runs.filter(
      (c) => c.name === r.context && (r.app === null || c.app?.id === r.app),
    )) {
      const app = c.app?.id ?? null;
      if (!latest.has(app) || latest.get(app).id < c.id) latest.set(app, c);
    }
    const status = statuses
      .filter((c) => c.context.toLowerCase() === r.context.toLowerCase())
      .sort((a, b) => b.id - a.id)[0];
    const checks = [...latest.values()];
    // REST commit statuses do not identify the source app. A pinned requirement
    // needs a matching check run; never infer the app from a creator login.
    if (!checks.length && !(status && r.app === null))
      throw new Wait(r.context, "missing");
    for (const c of checks) {
      if (c.status !== "completed" || c.conclusion !== "success")
        throw new Wait(
          r.context,
          c.status !== "completed" ? c.status : (c.conclusion ?? "pending"),
        );
    }
    // GitHub requires both when a status and check run share a context.
    if (status && status.state !== "success")
      throw new Wait(r.context, status.state);
  }
}

// With no queue there is no required check to carry Sol's verdict, so Sol
// records it as a commit status on the head it read (owner, 15 October 2026):
// context "Sol verdict", state success to approve, failure to refuse. GitHub
// binds a status to its commit and lets only people with write access set one,
// so nothing here parses comments or looks up permissions. A refusal on this
// head is never cleared by a later approval on the same head; a new head is.
const SOL = "Sol verdict";

/** @param {{repo: string, head: string}} target */
function reviewed(target) {
  const statuses = read(
    "read-sol",
    [
      `repos/${target.repo}/commits/${target.head}/statuses?per_page=100`,
      "--method",
      "GET",
      "--paginate",
      "--slurp",
    ],
    (pages) => {
      if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p)))
        throw new Error("status pages");
      const all = pages.flat();
      if (
        all.some(
          (c) =>
            !id(c?.id) ||
            !text(c.context) ||
            !["success", "pending", "failure", "error"].includes(c.state),
        )
      )
        throw new Error("status shape");
      // GitHub matches status contexts without regard to case.
      return all.filter((c) => c.context.toLowerCase() === SOL.toLowerCase());
    },
  );
  if (!statuses.length) throw new Wait("sol", "missing");
  if (statuses.some((c) => c.state === "failure" || c.state === "error"))
    throw new Wait("sol", "changes-requested");
  const newest = statuses.reduce((a, b) => (b.id > a.id ? b : a));
  if (newest.state !== "success") throw new Wait("sol", newest.state);
}

// The repository's own merge method: a merge commit, else squash, else rebase,
// as the repository settings and any branch rule both allow.
/** @param {string} repo @param {any[]} branchRules @returns {string} */
function method(repo, branchRules) {
  const settings = read("read-repo", [`repos/${repo}`], (data) => {
    if (
      ["allow_merge_commit", "allow_squash_merge", "allow_rebase_merge"].some(
        (k) => typeof data[k] !== "boolean",
      )
    )
      throw new Error("repo shape");
    return data;
  });
  const ruled = branchRules
    .filter((r) => r.type === "pull_request")
    .map((r) => r.parameters?.allowed_merge_methods)
    .filter(Array.isArray);
  const chosen = ["merge", "squash", "rebase"].find(
    (m) =>
      settings[m === "merge" ? "allow_merge_commit" : `allow_${m}_merge`] &&
      ruled.every((allowed) => allowed.includes(m)),
  );
  if (!chosen) throw new Wait("merge", "no-allowed-method");
  return chosen;
}

// After MERGED, ask each local work map to Sync now rather than at its next
// scheduled run (#204): kickstart its GitHub refresh job, without -k, so a
// Sync already running is left alone. Nothing here changes the merge's result.
const MAP_JOB = /^com\.launchastro\.(?:live-roadmap|work-map\.[A-Za-z0-9_.-]+)\.github$/u;
function syncMap() {
  if (process.env.WORK_MAP_SYNC === "0") return;
  const run = (/** @type {string[]} */ args) =>
    execFileSync("launchctl", args, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  let labels;
  try {
    labels = run(["list"])
      .split("\n")
      .map((l) => l.split("\t")[2]?.trim() ?? "")
      .filter((l) => MAP_JOB.test(l));
  } catch {
    console.log("SYNC skipped reason=launchctl-unavailable");
    return;
  }
  if (!labels.length) console.log("SYNC skipped reason=no-map");
  for (const label of labels) {
    try {
      run(["kickstart", `gui/${process.getuid?.() ?? 0}/${label}`]);
      console.log(`SYNC ${label} started`);
    } catch {
      console.log(`SYNC ${label} failed`);
    }
  }
}

/** @type {{repo: string, pr: number, head: string, pane: string|null}|null} */
let target = null;
try {
  target = options(process.argv.slice(2));
  const initial = pull(target);
  eligible(initial, target.head);
  if (initial.mergeQueueEntry) {
    console.log(`ALREADY-QUEUED #${target.pr} head=${target.head}`);
  } else {
    const lines = described(initial.body);
    let warning = sectioned(lines);
    const queue = initial.isMergeQueueEnabled;
    const level = queue ? null : risk(lines);
    const dropped = drops(initial);
    const branchRules = rules(target.repo, initial);
    const required = requirements(branchRules, initial);
    const prefix = `repos/${target.repo}/commits/${target.head}`;
    const runs = results(
      "read-runs",
      `${prefix}/check-runs?filter=all&per_page=100`,
      "check_runs",
      target.head,
    );
    const statuses = results(
      "read-statuses",
      `${prefix}/status?per_page=100`,
      "statuses",
      target.head,
    );
    green(required, runs, statuses, queue);
    if (level === "low") lowRisk(target);
    else if (level) reviewed(target);
    const current = pull(target);
    eligible(current, target.head);
    // The final read re-renders only a description that changed since the first.
    if (current.body !== initial.body) {
      // With no queue the merge is final: an edited description waits, and the
      // next pass reads it whole.
      if (!queue) throw new Wait("description", "changed-during-reads");
      warning = sectioned(described(current.body));
    }
    if (drops(current).count !== dropped.count)
      throw new Wait("dropped", "changed-during-reads");
    if (
      current.id !== initial.id ||
      current.baseRef.name !== initial.baseRef.name ||
      current.isMergeQueueEnabled !== queue
    )
      throw new Wait("base", "changed-pr-or-base");
    const currentRules = rules(target.repo, current);
    if (
      JSON.stringify(requirements(currentRules, current)) !==
      JSON.stringify(required)
    )
      throw new Wait("required-checks", "changed-list");
    if (!queue) {
      // GitHub refuses the merge if the head moved after these reads.
      const how = method(target.repo, currentRules);
      read(
        "merge",
        [
          `repos/${target.repo}/pulls/${target.pr}/merge`,
          "--method",
          "PUT",
          "-f",
          `sha=${target.head}`,
          "-f",
          `merge_method=${how}`,
        ],
        (data) => {
          if (data.merged !== true) throw new Error("merge response");
        },
      );
      console.log(
        `MERGED #${target.pr} head=${target.head} method=${how} risk=${level}`,
      );
      syncMap();
    } else if (current.mergeQueueEntry) {
      console.log(`ALREADY-QUEUED #${target.pr} head=${target.head}`);
    } else {
      const query = `mutation { enqueuePullRequest(input:{pullRequestId:${JSON.stringify(current.id)},expectedHeadOid:${JSON.stringify(target.head)}}) { mergeQueueEntry { id } } }`;
      read("enqueue", ["graphql", "-f", `query=${query}`], (data) => {
        if (!text(data.data?.enqueuePullRequest?.mergeQueueEntry?.id))
          throw new Error("enqueue response");
      });
      console.log(
        dropped.count
          ? `REQUEUED #${target.pr} head=${target.head} drops=${dropped.count}`
          : `ENQUEUED #${target.pr} head=${target.head}`,
      );
    }
    if (warning) console.log(warning);
  }
} catch (error) {
  const wait =
    error instanceof Wait ? error : new Wait("internal", "unexpected-error", 2);
  console.log(
    `WAIT gate=${encodeURIComponent(wait.gate)} reason=${encodeURIComponent(wait.message)}`,
  );
  process.exitCode = wait.code;
  const line = target?.pane ? laneLine(wait, target) : null;
  if (target?.pane && line)
    console.log(
      `NOTIFY pane=${encodeURIComponent(target.pane)} ${tell(target.pane, line)}`,
    );
}
