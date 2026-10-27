// SPDX-License-Identifier: AGPL-3.0-only
// The sensitive surface ADR 0046 names, expressed as the paths that hold it.
//
// A keyword list would be guesswork; a path list is checkable and it is wrong
// in an obvious way when it is wrong, which is the better failure.
//
// This lived inside scripts/review-evidence-check.mjs, where it was the only
// definition and nothing else could reach it. Since ticket 52 nothing refuses
// over it: its reader is the report that tells the reviewer of record which
// files made a security question necessary. A second copy of a list like this
// drifts, and the drift is silent, so there is one copy.

export const SENSITIVE = [
  /^packages\/core-custody\//u, // custody
  /^packages\/core-connectors\//u, // tool execution and egress
  /^packages\/core-runtime\//u, // the agent loop, gates, the audit chain
  /^apps\/worker\//u, // tool execution
  /^scripts\/gate\//u, // the contamination gate itself
  /^\.husky\//u, // the hooks that enforce it
  /^\.github\/workflows\//u, // what runs with repository credentials
  // The keyword anywhere in the file name. Sol's review of 69afe53 found it
  // anchored to the start, so `0003-audit-chain.sql` slipped past; the
  // security review of 65dbe59 found `AuditLog.ts` and `auth.cjs`. Any case.
  /(^|\/)[^/]*(auth|tenancy|egress|custody|audit)[^/]*\.(ts|tsx|cts|mts|mjs|cjs|js|jsx|py|sql)$/iu,
];

/** The subset of `files` that lands on the sensitive surface, in order. */
export function sensitiveFiles(files) {
  return files.filter((file) => SENSITIVE.some((pattern) => pattern.test(file)));
}
