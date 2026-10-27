// SPDX-License-Identifier: AGPL-3.0-only
// Shared, read-only parser. See events.md for the wire grammar and legacy forms.

/** @typedef {'A02-1368CKPT-DONE'|'A02-1368MAIN'|'A02-1370APPR-DONE'|'A02-1370CKPT-DONE'|'A02-1370DEF-DONE'|'A05-1372DEC-DONE'|'ACK'|'ALREADY-FIXED'|'AREAS'|'ARRIVAL-CAP'|'ASK'|'BATCHES-READY'|'BLOCKED'|'BLOCKER'|'BODY-FIXED'|'BODY-UPDATED'|'BOOTED'|'BW-LOCKED'|'CARRIED'|'CFSPEED-ACK'|'CHATPATH-ESTIMATE'|'CHECK'|'CI-RERUN-OWED'|'CLOSED'|'CORRECTION'|'CUSTODY-LOADS'|'CUSTODY-WRITTEN'|'CUT-LIVE'|'DEMO-LOGIN-FILED'|'DEMO-URL'|'DESIGN-FINAL'|'DESIGN-READY'|'DESIGN-ROW'|'DESIGN-START'|'DIAG'|'DIRECTOR-REAP'|'DNS-ADDED'|'DOMAIN-VERIFIED'|'DONE'|'DROPPED'|'FILED'|'FILES'|'FINDINGS'|'FIX-PUSHED'|'FOUND'|'GAPS'|'GAUGE'|'GO-PT'|'HANDBACK'|'HANDBACK-MOVE'|'HANDBACK-READY'|'HANDOVER'|'HANDOVER-DUE'|'HELD'|'HOLD'|'HOOK-SKIP-SCANNED'|'INVENTORY'|'ISOLATION-DUP'|'ISSUE'|'ISSUE-FILED'|'LABELS'|'LAND'|'LANDING-ASSESSMENT'|'LANE-WATCH'|'LINE'|'M5LOAD1302'|'MAINCHK'|'MASTER'|'MEASURE'|'MERGE-RATE'|'MERGE-STALL'|'NAMEDSUITE'|'NAS'|'NOTE'|'NOTED'|'OR-CMD-READY'|'ORCH-ACK'|'ORCH-DECISION'|'ORCH-PT-WARM'|'ORCH-SUCCESSOR-BOOTED'|'ORCHESTRATOR-HANDOVER'|'P11'|'P2'|'P2-STAGING-DONE'|'P4-RECIPE'|'PARKED'|'PAUSED'|'PIECE-DONE'|'PIECE-HELD'|'PLAN'|'PR-OPENED'|'PRETRIAGE'|'PROGRESS'|'PROOF'|'PROOF-RUN'|'PUSHED'|'PUSHING'|'QUAL0016'|'RACECHK'|'RB-FLAKE'|'READY'|'READY-ack'|'RECIPE'|'REFUTED'|'RELATED'|'RELAY-HANDOVER'|'RELAYNAS0155'|'RESEND-DOMAIN-ADDED'|'RETARGETED'|'ROUND2-RED'|'RUN-START'|'SANDBOX-MAP'|'SCAN-CLEAN'|'SCOUT-GREEN'|'SCOUT-NAMES'|'SECURITY-REVIEW'|'SPLIT-PLAN'|'STATUS'|'STEP'|'SWITCHED-ON'|'TICKET'|'TOUCHES-CHECK'|'U117-DONE'|'U117-FAIL'|'U117-PASS'|'WAITING'|'WATCHDOG'|'WRAP'|'WRAP-NUDGE'|'WRAP:'|'WRAPPED'|'WRAPUP'|'ceiling'|'correction:'|'design'|'review-deferral'} NoteType */
/** @typedef {{timestamp: string, actor: string}} Envelope */
/** @typedef {Envelope & {type: NoteType|'ISSUE-NOTE'|'SUBAGENTS', message: string, subject: string|null, pr: number|null, head: string|null, fields: Record<string, string>, counts: Record<string, number>}} NoteRecord */
/** @typedef {Envelope & {type: 'MERGED', pr: number, head: string|null, mergeCommit: string|null, fields: Record<string, string>}} MergeRecord */
/** @typedef {Envelope & {type: 'RUN-END', subject: string, head: string|null, verdict: string|null, fields: Record<string, string>}} RunRecord */
/** @typedef {Envelope & {type: 'SCOPE', status: 'CLEAN'|'FINDINGS'|'UNKNOWN', pr: number|null, fields: Record<string, string>}} ScopeRecord */
/** @typedef {NoteRecord|MergeRecord|RunRecord|ScopeRecord|{type: 'unknown'}} EventRecord */

/** @type {ReadonlySet<string>} */
const NOTE_TYPES = new Set([
  "A02-1368CKPT-DONE",
  "A02-1368MAIN",
  "A02-1370APPR-DONE",
  "A02-1370CKPT-DONE",
  "A02-1370DEF-DONE",
  "A05-1372DEC-DONE",
  "ACK",
  "ALREADY-FIXED",
  "AREAS",
  "ARRIVAL-CAP",
  "ASK",
  "BATCHES-READY",
  "BLOCKED",
  "BLOCKER",
  "BODY-FIXED",
  "BODY-UPDATED",
  "BOOTED",
  "BW-LOCKED",
  "CARRIED",
  "CFSPEED-ACK",
  "CHATPATH-ESTIMATE",
  "CHECK",
  "CI-RERUN-OWED",
  "CLOSED",
  "CORRECTION",
  "CUSTODY-LOADS",
  "CUSTODY-WRITTEN",
  "CUT-LIVE",
  "DEMO-LOGIN-FILED",
  "DEMO-URL",
  "DESIGN-FINAL",
  "DESIGN-READY",
  "DESIGN-ROW",
  "DESIGN-START",
  "DIAG",
  "DIRECTOR-REAP",
  "DNS-ADDED",
  "DOMAIN-VERIFIED",
  "DONE",
  "DROPPED",
  "FILED",
  "FILES",
  "FINDINGS",
  "FIX-PUSHED",
  "FOUND",
  "GAPS",
  "GAUGE",
  "GO-PT",
  "HANDBACK",
  "HANDBACK-MOVE",
  "HANDBACK-READY",
  "HANDOVER",
  "HANDOVER-DUE",
  "HELD",
  "HOLD",
  "HOOK-SKIP-SCANNED",
  "INVENTORY",
  "ISOLATION-DUP",
  "ISSUE",
  "ISSUE-FILED",
  "LABELS",
  "LAND",
  "LANDING-ASSESSMENT",
  "LANE-WATCH",
  "LINE",
  "M5LOAD1302",
  "MAINCHK",
  "MASTER",
  "MEASURE",
  "MERGE-RATE",
  "MERGE-STALL",
  "NAMEDSUITE",
  "NAS",
  "NOTE",
  "NOTED",
  "OR-CMD-READY",
  "ORCH-ACK",
  "ORCH-DECISION",
  "ORCH-PT-WARM",
  "ORCH-SUCCESSOR-BOOTED",
  "ORCHESTRATOR-HANDOVER",
  "P11",
  "P2",
  "P2-STAGING-DONE",
  "P4-RECIPE",
  "PARKED",
  "PAUSED",
  "PIECE-DONE",
  "PIECE-HELD",
  "PLAN",
  "PR-OPENED",
  "PRETRIAGE",
  "PROGRESS",
  "PROOF",
  "PROOF-RUN",
  "PUSHED",
  "PUSHING",
  "QUAL0016",
  "RACECHK",
  "RB-FLAKE",
  "READY",
  "READY-ack",
  "RECIPE",
  "REFUTED",
  "RELATED",
  "RELAY-HANDOVER",
  "RELAYNAS0155",
  "RESEND-DOMAIN-ADDED",
  "RETARGETED",
  "ROUND2-RED",
  "RUN-START",
  "SANDBOX-MAP",
  "SCAN-CLEAN",
  "SCOUT-GREEN",
  "SCOUT-NAMES",
  "SECURITY-REVIEW",
  "SPLIT-PLAN",
  "STATUS",
  "STEP",
  "SWITCHED-ON",
  "TICKET",
  "TOUCHES-CHECK",
  "U117-DONE",
  "U117-FAIL",
  "U117-PASS",
  "WAITING",
  "WATCHDOG",
  "WRAP",
  "WRAP-NUDGE",
  "WRAP:",
  "WRAPPED",
  "WRAPUP",
  "ceiling",
  "correction:",
  "design",
  "review-deferral",
]);

/** @param {string} message @returns {Record<string, string>} */
function fieldsOf(message) {
  return Object.fromEntries(
    [
      ...message.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9_-]*)=([^\s,;()]*)/gu),
    ].map((match) => [match[1], match[2]]),
  );
}

const SECTION_ID = /^[a-z][a-z0-9-]*$/u;
const PLAN_ID = /^[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)*$/u;

/** @param {string} value @returns {string|null} */
function planDeclaration(value) {
  const parts = value.split(/\s*,\s*/u);
  /** @type {string[]} */
  const ids = [];
  for (const [index, part] of parts.entries()) {
    const token = part.split(/\s/u)[0] ?? "";
    const id =
      (PLAN_ID.test(token) && /\d/u.test(token)) ||
      (/^#[1-9]\d*$/u.test(token) &&
        Number.isSafeInteger(Number(token.slice(1))));
    if (token === "none") {
      if (index !== 0) return null;
      ids.push(token);
    } else if (id) {
      if (ids.includes("none")) return null;
      ids.push(token);
    } else {
      // The convention permits descriptive words after the leading IDs.
      if (index === 0 || !token || /(?:\d|^#)/u.test(token)) return null;
      break;
    }
    if (part !== token) break;
  }
  return ids.join(", ") || null;
}

/** @param {string} message @returns {Record<string, string>|null} */
function laneFields(message) {
  const fields = fieldsOf(message);
  const declarations = [
    ...message.matchAll(/(?:^|\s)(Ticket|Unit|Section|machine)(?=\s*[:=])/gu),
  ];
  const seen = new Set();
  for (const [index, match] of declarations.entries()) {
    const name = match[1] ?? "";
    if (seen.has(name)) return null;
    seen.add(name);
    const rest = message
      .slice(match.index + match[0].length, declarations[index + 1]?.index)
      .trimEnd();
    if (name === "machine") {
      const machine = /^=([a-z0-9][a-z0-9_.-]*)(?=\s|$)/u.exec(rest);
      if (machine === null) return null;
      fields.machine = machine[1] ?? "";
      continue;
    }
    if (!rest.startsWith(": ")) return null;
    // Generic key/value observations can follow a declaration too.
    const value =
      rest
        .slice(2)
        .split(/\s+[A-Za-z][A-Za-z0-9_-]*=/u)[0]
        ?.trimEnd() ?? "";
    if (name === "Section") {
      const section = value.split(/\s/u)[0] ?? "";
      if (!SECTION_ID.test(section)) return null;
      fields.section = section;
    } else {
      const ids = planDeclaration(value);
      if (ids === null) return null;
      fields[name.toLowerCase()] = ids;
      const completion = new RegExp(
        `^${ids.split(", ").join("\\s*,\\s*")}\\s+complete(?:\\s|$)`,
        "u",
      );
      if (name === "Ticket" && completion.test(value)) fields.complete = "true";
    }
  }
  if (seen.has("Ticket") && seen.has("Unit")) return null;
  return fields;
}

/** @param {Envelope} base @param {string} message @returns {EventRecord} */
function scopeRecord(base, message) {
  const [status, ...tokens] = message.split(" ");
  if (status !== "CLEAN" && status !== "FINDINGS" && status !== "UNKNOWN")
    return { type: "unknown" };
  const fields = fieldsOf(message);
  // SCOPE is a structured report: no opaque prose, duplicate keys or empty values.
  if (
    tokens.length !== Object.keys(fields).length ||
    tokens.some((token) => !/^[A-Za-z][A-Za-z0-9_-]*=[^\s,;()]+$/u.test(token))
  )
    return { type: "unknown" };
  let pr = null;
  if (fields.pr !== undefined) {
    if (!/^[1-9]\d*$/u.test(fields.pr)) return { type: "unknown" };
    pr = Number(fields.pr);
    if (!Number.isSafeInteger(pr)) return { type: "unknown" };
  }
  if (fields.section !== undefined && !SECTION_ID.test(fields.section))
    return { type: "unknown" };
  const measurements = ["added", "removed", "outOfScope", "bloat", "mapGaps"];
  if (status === "UNKNOWN") {
    if (!fields.reason || measurements.some((key) => fields[key] !== undefined))
      return { type: "unknown" };
  } else {
    if (
      pr === null ||
      measurements.some(
        (key) =>
          !/^\d+$/u.test(fields[key] ?? "") ||
          !Number.isSafeInteger(Number(fields[key])),
      )
    )
      return { type: "unknown" };
    const hasFindings = ["outOfScope", "bloat", "mapGaps"].some(
      (key) => Number(fields[key]) > 0,
    );
    if ((status === "FINDINGS") !== hasFindings) return { type: "unknown" };
  }
  return { ...base, type: "SCOPE", status, pr, fields };
}

/** @param {string} message @returns {string|null} */
function headOf(message) {
  return (
    /(?:^|[\s(])head(?:=| )([a-f0-9]{7,40})(?=\s|[).,;]|$)/u.exec(
      message,
    )?.[1] ?? null
  );
}

/** @param {string} message @param {string} type @returns {number|null} */
function prOf(message, type) {
  // Parenthesised piece/issue references precede the actual PR in older announcements.
  const beforeHead = message
    .replaceAll(/\([^)]*\)/gu, "")
    .split(/(?:^|\s)head=/u);
  const outside = beforeHead[0]?.trim() ?? "";
  const piece =
    type === "PR-OPENED"
      ? /^#[1-9]\d*\s+piece\s+#([1-9]\d*)(?=\s|[,:;.]|$)/u.exec(outside)
      : null;
  const match =
    piece ??
    /(?:^|\s)#([1-9]\d*)(?=\s|[,:;.]|$)/u.exec(outside) ??
    (beforeHead.length > 1 ? /(?:^|\s)([1-9]\d*)$/u.exec(outside) : null);
  const value = match === null ? null : Number(match[1]);
  return value !== null && Number.isSafeInteger(value) ? value : null;
}

/** @param {string} message @returns {Record<string, number>} */
function countsOf(message) {
  /** @type {Record<string, number>} */
  const counts = {};
  let remaining = message;
  while (remaining) {
    const match =
      /^(build|review|race attack|race|research|check) ([0-9]+)(?=\s|,|$)/u.exec(
        remaining,
      );
    if (match === null) break;
    const value = Number(match[2]);
    if (Number.isSafeInteger(value)) counts[match[1] ?? ""] = value;
    remaining = remaining.slice(match[0].length).trimStart();
    if (!remaining.startsWith(",")) break;
    remaining = remaining.slice(1).trimStart();
  }
  return counts;
}

/** @param {Envelope} base @param {string} subject @param {string} message @returns {EventRecord} */
function runRecord(base, subject, message) {
  const end = /^RUN-END(?: (.*))?$/u.exec(message);
  if (end === null) return { type: "unknown" };
  if (base.actor === "SOL-PR" && !/^[1-9]\d*$/u.test(subject))
    return { type: "unknown" };
  message = end[1] ?? "";
  return {
    ...base,
    type: "RUN-END",
    subject,
    head: headOf(message),
    verdict:
      /(?:^|\s)Verdict: (approve|changes requested|none)$/u.exec(
        message,
      )?.[1] ?? null,
    fields: fieldsOf(message),
  };
}

/** @param {Envelope} base @param {string} message @returns {EventRecord} */
function mergeRecord(base, message) {
  const merged = /^(?:PR #|#|pr=)([1-9]\d*)(?=\s|$)/u.exec(message);
  if (merged === null) return { type: "unknown" };
  const pr = Number(merged[1]);
  if (!Number.isSafeInteger(pr)) return { type: "unknown" };
  return {
    ...base,
    type: "MERGED",
    pr,
    fields: fieldsOf(message),
    head: headOf(message),
    mergeCommit:
      /(?:\bas |\bmerge=)([a-f0-9]{7,40})(?=\s|[).,;]|$)/u.exec(message)?.[1] ??
      null,
  };
}

/**
 * Parse one physical line. No I/O, side effects, inferred health, or fallback to prose.
 * Missing historical identifiers remain null; a known event is not evidence of a passed gate.
 * @param {unknown} line
 * @returns {EventRecord}
 */
export function parseEventLine(line) {
  if (typeof line !== "string" || /[\r\n]/u.test(line))
    return { type: "unknown" };
  const envelope =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) ([A-Za-z0-9][A-Za-z0-9_.-]*) (\S+)(?: (.*))?$/u.exec(
      line,
    );
  if (envelope === null) return { type: "unknown" };
  const timestamp = envelope[1] ?? "";
  const date = new Date(timestamp);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== timestamp.replace("Z", ".000Z")
  )
    return { type: "unknown" };
  const actor = envelope[2] ?? "";
  let type = envelope[3] ?? "";
  const message = envelope[4] ?? "";
  const base = { timestamp, actor };

  if (["SOL-PR", "SOL-AREA", "SOL-SWEEP"].includes(actor))
    return runRecord(base, type, message);
  if (type === "MERGED") return mergeRecord(base, message);
  if (type === "SCOPE") return scopeRecord(base, message);

  let subject = null;
  if (/^#[1-9]\d*$/u.test(type)) {
    subject = type;
    type = "ISSUE-NOTE";
  } else if (!NOTE_TYPES.has(type) && type !== "SUBAGENTS") {
    return { type: "unknown" };
  }
  if (type === "ASK") subject = message.split(" ")[0] || null;
  const fields =
    type === "BOOTED" || type === "TICKET"
      ? laneFields(message)
      : fieldsOf(message);
  if (fields === null) return { type: "unknown" };
  const counts = type === "SUBAGENTS" ? countsOf(message) : {};
  const noteType =
    /** @type {NoteRecord['type']} */
    (type);
  return {
    ...base,
    type: noteType,
    message,
    subject,
    pr: prOf(message, type),
    head: headOf(message),
    fields,
    counts,
  };
}
