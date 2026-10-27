// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from "node:child_process";

/** @param {string} value @returns {number} */
export function time(value) {
  const parsed = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString() !== value.replace("Z", ".000Z")
  ) {
    throw new Error("invalid-time");
  }
  return parsed.getTime();
}

/** @param {string[]} args @param {number} timeout @param {number} maxBuffer @returns {any} */
export function github(args, timeout, maxBuffer) {
  const text = execFileSync("gh", ["api", ...args], {
    encoding: "utf8",
    timeout,
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(text);
}

/** @param {any} response @returns {any} */
export function repository(response) {
  if (!response || response.errors !== undefined || !response.data?.repository)
    throw new Error("github-shape");
  return response.data.repository;
}

/** @param {any} pages @param {number} now @returns {string|null} */
export function newestMerge(pages, now) {
  if (!Array.isArray(pages) || pages.length === 0)
    throw new Error("merged-shape");
  let newest = null;
  for (const page of pages) {
    if (!Array.isArray(page)) throw new Error("merged-page");
    for (const pr of page) {
      if (!pr || !("merged_at" in pr)) throw new Error("merged-record");
      if (pr.merged_at === null) continue;
      if (typeof pr.merged_at !== "string" || time(pr.merged_at) > now)
        throw new Error("merged-time");
      if (newest === null || pr.merged_at > newest) newest = pr.merged_at;
    }
  }
  return newest;
}

/** @param {any} response @returns {number} */
export function queued(response) {
  const repo = repository(response);
  // GitHub has no queue configured.
  if (repo.mergeQueue === null) return 0;
  const count = repo.mergeQueue?.entries?.totalCount;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("queue-shape");
  return count;
}

/** @param {any} pages @returns {number} */
function cleanCount(pages) {
  if (!Array.isArray(pages) || pages.length === 0)
    throw new Error("clean-shape");
  let count = 0;
  for (const [i, page] of pages.entries()) {
    const prs = repository(page).pullRequests;
    if (
      !Array.isArray(prs?.nodes) ||
      typeof prs.pageInfo?.hasNextPage !== "boolean" ||
      prs.pageInfo.hasNextPage !== i < pages.length - 1 ||
      (prs.pageInfo.hasNextPage && typeof prs.pageInfo.endCursor !== "string")
    )
      throw new Error("clean-page");
    for (const pr of prs.nodes) {
      if (
        !pr ||
        ![
          "BEHIND",
          "BLOCKED",
          "CLEAN",
          "DIRTY",
          "DRAFT",
          "HAS_HOOKS",
          "UNKNOWN",
          "UNSTABLE",
        ].includes(pr.mergeStateStatus)
      ) {
        throw new Error("clean-record");
      }
      // An unresolved GitHub computation cannot prove there is no CLEAN work.
      if (pr.mergeStateStatus === "UNKNOWN")
        throw new Error("clean-unresolved");
      if (pr.mergeStateStatus === "CLEAN") count += 1;
    }
  }
  return count;
}

/** @param {string} repo @param {number} timeout @param {number} maxBuffer @param {number} now
 * @returns {{last: string|null, queue: number, clean: number}} */
export function githubSnapshot(repo, timeout, maxBuffer, now) {
  const [owner, name] = repo.split("/");
  const identity = `owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}`;
  const last = newestMerge(
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
  );
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
  const clean = cleanCount(
    github(
      [
        "graphql",
        "--paginate",
        "--slurp",
        "-f",
        `query=query($endCursor:String){repository(${identity}){pullRequests(states:OPEN,first:100,after:$endCursor){nodes{mergeStateStatus} pageInfo{hasNextPage endCursor}}}}`,
      ],
      timeout,
      maxBuffer,
    ),
  );
  return { last, queue, clean };
}
