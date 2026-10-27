// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from "node:child_process";
import { github, newestMerge, queued, repository } from "./watch-github.mjs";

/** @typedef {{number: number, headRefOid: string, body: string, mergeable: string, mergeStateStatus: string, reviewDecision: string|null, isDraft: boolean, labels: {nodes: {name: string}[], totalCount: number}}} Pull */
/** @typedef {{timeout: number, maxBuffer: number}} Limits */

/** @param {any} pages @returns {Pull[]} */
function openPulls(pages) {
  if (!Array.isArray(pages) || pages.length === 0)
    throw new Error("open-shape");
  /** @type {Pull[]} */
  const result = [];
  const seen = new Set();
  for (const [index, page] of pages.entries()) {
    const prs = repository(page).pullRequests;
    if (
      !Array.isArray(prs?.nodes) ||
      typeof prs.pageInfo?.hasNextPage !== "boolean" ||
      prs.pageInfo.hasNextPage !== index < pages.length - 1 ||
      (prs.pageInfo.hasNextPage && !prs.pageInfo.endCursor)
    )
      throw new Error("open-page");
    for (const pr of prs.nodes) {
      if (
        !Number.isSafeInteger(pr?.number) ||
        pr.number <= 0 ||
        seen.has(pr.number) ||
        !/^[a-f0-9]{40}$/u.test(pr.headRefOid) ||
        typeof pr.body !== "string" ||
        typeof pr.isDraft !== "boolean" ||
        !["MERGEABLE", "CONFLICTING", "UNKNOWN"].includes(pr.mergeable) ||
        ![
          "BEHIND",
          "BLOCKED",
          "CLEAN",
          "DIRTY",
          "DRAFT",
          "HAS_HOOKS",
          "UNKNOWN",
          "UNSTABLE",
        ].includes(pr.mergeStateStatus) ||
        ![null, "APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"].includes(
          pr.reviewDecision,
        ) ||
        !Array.isArray(pr.labels?.nodes) ||
        pr.labels.totalCount !== pr.labels.nodes.length ||
        pr.labels.nodes.some(
          (/** @type {any} */ label) => typeof label?.name !== "string",
        )
      )
        throw new Error("open-record");
      seen.add(pr.number);
      result.push(pr);
    }
  }
  return result;
}

/** @param {string} repo @param {Limits} limits @param {number} now @param {boolean} withMerge */
export function landingSnapshot(repo, limits, now, withMerge) {
  const { timeout, maxBuffer } = limits;
  const [owner, name] = repo.split("/");
  const identity = `owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}`;
  const last = withMerge
    ? newestMerge(
        github(
          [
            `repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
            "--paginate",
            "--slurp",
          ],
          timeout,
          maxBuffer,
        ),
        now,
      )
    : null;
  const queue = queued(
    github(
      [
        "graphql",
        "-f",
        `query={repository(${identity}){mergeQueue{entries{totalCount}}}}`,
      ],
      timeout,
      maxBuffer,
    ),
  );
  const pulls = openPulls(
    github(
      [
        "graphql",
        "--paginate",
        "--slurp",
        "-f",
        `query=query($endCursor:String){repository(${identity}){pullRequests(states:OPEN,first:100,after:$endCursor){nodes{number headRefOid body mergeable mergeStateStatus reviewDecision isDraft labels(first:100){nodes{name} totalCount}} pageInfo{hasNextPage endCursor}}}}`,
      ],
      timeout,
      maxBuffer,
    ),
  );
  return { last, queue, pulls };
}

/** @param {string} repo @param {Pull} pr @param {Limits} limits @returns {{gate: string, check?: string}} */
export function remainingGate(repo, pr, limits) {
  if (pr.mergeable === "UNKNOWN" || pr.mergeStateStatus === "UNKNOWN")
    throw new Error("merge-unresolved");
  if (
    pr.labels.nodes.some(({ name }) =>
      ["hold", "held", "factory/held"].includes(name.toLowerCase()),
    )
  )
    return { gate: "hold" };
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY")
    return { gate: "conflict" };
  if (
    pr.isDraft ||
    ["REVIEW_REQUIRED", "CHANGES_REQUESTED"].includes(pr.reviewDecision ?? "")
  )
    return { gate: "review" };
  const options = {
    encoding: /** @type {const} */ ("utf8"),
    timeout: limits.timeout,
    maxBuffer: limits.maxBuffer,
    stdio: /** @type {["ignore", "pipe", "pipe"]} */ ([
      "ignore",
      "pipe",
      "pipe",
    ]),
  };
  let text;
  try {
    text = execFileSync(
      "gh",
      [
        "pr",
        "checks",
        String(pr.number),
        "--repo",
        repo,
        "--required",
        "--json",
        "name,state,bucket",
      ],
      options,
    );
  } catch (error) {
    // gh uses 1 for failed checks and 8 for pending checks. API failures without
    // a valid check array still fail the read below.
    if (!(
      error instanceof Error &&
      "status" in error &&
      [1, 8].includes(Number(error.status)) &&
      "stdout" in error
    ))
      throw error;
    text = String(error.stdout);
  }
  const checks = JSON.parse(text);
  if (
    !Array.isArray(checks) ||
    checks.some(
      (check) =>
        typeof check?.name !== "string" ||
        !check.name ||
        typeof check.state !== "string" ||
        !["pass", "fail", "pending", "skipping", "cancel"].includes(
          check.bucket,
        ),
    )
  )
    throw new Error("checks-shape");
  const current = JSON.parse(
    execFileSync(
      "gh",
      ["pr", "view", String(pr.number), "--repo", repo, "--json", "headRefOid"],
      options,
    ),
  );
  if (current?.headRefOid !== pr.headRefOid) throw new Error("head-changed");
  const check = checks.find(
    (check) => !["pass", "skipping"].includes(check.bucket),
  );
  if (check)
    return { gate: "required-check", check: encodeURIComponent(check.name) };
  if (pr.mergeStateStatus === "BEHIND") return { gate: "branch-update" };
  // A blocked PR with no named check cannot safely be called ready.
  if (pr.mergeStateStatus === "BLOCKED") throw new Error("gate-unresolved");
  return { gate: "ready" };
}
