#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from "node:child_process";

// Either pre-check line may report a head: line A on the M5, line C on hosted runners.
const CONTEXTS = ["m5/precheck", "hosted/precheck"];
const STATES = ["success", "pending", "failure", "error"];

/** @param {string} line @param {number} code */
function decide(line, code) {
  console.log(line);
  process.exitCode = code;
}

/** @param {string[]} args @returns {{repo: string, head: string}|null} */
function options(args) {
  const [f1, repo, f2, head] = args;
  if (
    args.length !== 4 ||
    f1 !== "--repo" ||
    f2 !== "--head" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo ?? "") ||
    !/^[a-f0-9]{40}$/u.test(head ?? "")
  )
    return null;
  return { repo, head };
}

/** @param {{repo: string, head: string}} target @returns {any[]} */
function statuses(target) {
  const pages = JSON.parse(
    execFileSync(
      "gh",
      [
        "api",
        `repos/${target.repo}/commits/${target.head}/statuses?per_page=100`,
        "--method",
        "GET",
        "--paginate",
        "--slurp",
      ],
      {
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p)))
    throw new Error("status pages");
  const all = pages.flat();
  // Each status names its commit in its URL; one for another commit is not this head's.
  const own = `/repos/${target.repo}/statuses/${target.head}`;
  if (
    all.some(
      (c) =>
        !Number.isSafeInteger(c?.id) ||
        c.id <= 0 ||
        typeof c.context !== "string" ||
        !STATES.includes(c.state) ||
        typeof c.url !== "string" ||
        !c.url.endsWith(own) ||
        !(c.description === null || typeof c.description === "string"),
    ) ||
    new Set(all.map((c) => c.id)).size !== all.length
  )
    throw new Error("status shape");
  return all;
}

// Each context's newest status, by id, decides for that context. A failure or
// error in either stops; else a success in either passes; else it waits.
try {
  const target = options(process.argv.slice(2));
  if (!target) decide("wait usage", 2);
  else {
    const all = statuses(target);
    const newest = CONTEXTS.map((context) =>
      all
        .filter((c) => c.context === context)
        .reduce((a, b) => (a && a.id > b.id ? a : b), null),
    ).filter(Boolean);
    const red = newest.find(
      (c) => c.state === "failure" || c.state === "error",
    );
    const chosen =
      red ?? newest.find((c) => c.state === "success") ?? newest[0];
    if (!chosen) decide("wait none", 2);
    else {
      const description = (chosen.description ?? "")
        .replace(/[\s\p{Cc}]+/gu, " ")
        .trim();
      decide(
        `${chosen.state} ${chosen.context} ${description}`.trimEnd(),
        chosen === red ? 1 : chosen.state === "success" ? 0 : 2,
      );
    }
  }
} catch {
  decide("wait read-failed", 2);
}
