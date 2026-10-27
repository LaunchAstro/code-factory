// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, writeFileSync } from "node:fs";
import { parseEventLine } from "./events.mjs";
import { time } from "./watch-github.mjs";
import { landingSnapshot, remainingGate } from "./watch-landing-github.mjs";
import { appendReport } from "./watch-report.mjs";

/** @typedef {{repo: string, log: string, state: string, settings: string, now: string, command: string}} Config */
/** @typedef {{pr: import('./watch-landing-github.mjs').Pull, owner: string, since: string, predecessors: number[]}} Ready */

/** @param {Config} config */
function settingsOf(config) {
  const key =
    config.command === "arrival-cap" ? "arrivalCap" : "landingAssessment";
  const value = JSON.parse(readFileSync(config.settings, "utf8"))[key];
  const threshold =
    config.command === "arrival-cap" ? value?.ready : value?.minutes;
  const timeout = value?.githubTimeoutMs,
    maxBuffer = value?.githubMaxBufferBytes;
  if (
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    (config.command === "arrival-cap" && !Number.isSafeInteger(threshold)) ||
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    !Number.isSafeInteger(maxBuffer) ||
    maxBuffer <= 0
  )
    throw new Error("settings-invalid");
  return { threshold, timeout, maxBuffer };
}

/** @param {string} text @returns {number[]} */
function predecessors(text) {
  const values = text
    .replaceAll("#", "")
    .split(/[,|\s]+/u)
    .filter(Boolean);
  if (
    values.some(
      (value) =>
        !/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value)),
    )
  )
    throw new Error("predecessors-invalid");
  return values.map(Number);
}

/** @param {Config} config @param {import('./watch-landing-github.mjs').Pull[]} pulls @returns {Ready[]} */
function waitingReady(config, pulls) {
  /** @type {Map<number, {owner: string, since: string, head: string|null, predecessors: number[]}>} */
  const ready = new Map();
  for (const line of readFileSync(config.log, "utf8").split(/\r?\n/u)) {
    const event = parseEventLine(line);
    if (event.type === "unknown" || !("pr" in event) || event.pr === null)
      continue;
    if (
      "fields" in event &&
      event.fields.repo &&
      event.fields.repo !== config.repo
    )
      continue;
    if (event.type === "READY") {
      time(event.timestamp);
      if (time(event.timestamp) > time(config.now))
        throw new Error("ready-future");
      const previous = ready.get(event.pr);
      ready.set(event.pr, {
        owner: event.head === null && previous ? previous.owner : event.actor,
        since: previous?.since ?? event.timestamp,
        head: event.head ?? previous?.head ?? null,
        predecessors:
          event.fields.predecessors === undefined
            ? (previous?.predecessors ?? [])
            : predecessors(event.fields.predecessors),
      });
    } else if (
      ["MERGED", "CLOSED", "DROPPED", "HELD", "HOLD", "PARKED"].includes(
        event.type,
      )
    )
      ready.delete(event.pr);
  }
  return pulls
    .flatMap((pr) => {
      const record = ready.get(pr.number);
      if (
        !record ||
        (record.head !== null && !pr.headRefOid.startsWith(record.head))
      )
        return [];
      const declared = [
        ...pr.body.matchAll(/^(?:Depends-on|Predecessors):[ \t]*(.*)$/gimu),
      ].flatMap((match) => predecessors(match[1] ?? ""));
      return [
        {
          pr,
          owner: record.owner,
          since: record.since,
          predecessors: [...record.predecessors, ...declared],
        },
      ];
    })
    .sort(
      (a, b) => a.since.localeCompare(b.since) || a.pr.number - b.pr.number,
    );
}

/** @param {Config} config @param {string} type @returns {string|null} */
function previousReport(config, type) {
  let signature = null;
  let reported = false;
  try {
    const state = JSON.parse(readFileSync(config.state, "utf8"));
    if (
      state.version !== 1 ||
      typeof state.repo !== "string" ||
      state.command !== config.command ||
      typeof state.signature !== "string"
    )
      throw new Error("state-shape");
    if (state.repo === config.repo) signature = state.signature;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  for (const line of readFileSync(config.log, "utf8").split(/\r?\n/u)) {
    const event = parseEventLine(line);
    if (
      event.type !== "unknown" &&
      "fields" in event &&
      "message" in event &&
      event.type === type &&
      event.actor === "WATCH" &&
      event.fields.repo === config.repo
    ) {
      reported = true;
      if (event.message.startsWith("UNKNOWN ")) signature = null;
      else if (event.fields.signature) signature = event.fields.signature;
    }
  }
  // A state signature alone cannot stand in for missing report evidence.
  return reported ? signature : null;
}

/** @param {Config} config @param {string} type @param {string} message */
function report(config, type, message) {
  appendReport(
    config.log,
    `${config.now} WATCH ${type} ${message} repo=${config.repo}`,
    type,
  );
}

/** @param {Config} config @returns {number} */
export function landingWatch(config) {
  const cap = config.command === "arrival-cap",
    type = cap ? "ARRIVAL-CAP" : "LANDING-ASSESSMENT";
  let message, prior;
  try {
    const settings = settingsOf(config);
    prior = previousReport(config, type);
    const snapshot = landingSnapshot(
      config.repo,
      settings,
      time(config.now),
      !cap,
    );
    const waiting = waitingReady(config, snapshot.pulls);
    if (cap) {
      const status =
        waiting.length >= settings.threshold ? "CAP-HOLD" : "CAP-OPEN";
      const closing =
        waiting.map(({ pr, owner }) => `${pr.number}:${owner}`).join("|") ||
        "none";
      message = `${status} ready=${waiting.length} cap=${settings.threshold} closing=${closing} queued=${snapshot.queue}`;
    } else {
      const age =
        snapshot.last === null
          ? null
          : (time(config.now) - time(snapshot.last)) / 60000;
      const open = new Set(snapshot.pulls.map(({ number }) => number));
      const candidate = waiting.find(({ predecessors }) =>
        predecessors.every((number) => !open.has(number)),
      );
      let details = "";
      const status =
        snapshot.last === null
          ? "NO-MERGE-YET"
          : age !== null && age < settings.threshold
            ? "OK"
            : !waiting.length
              ? "EMPTY-READY"
              : !candidate
                ? "NO-INDEPENDENT-READY"
                : "ASSESS";
      if (status === "ASSESS" && candidate) {
        const gate = remainingGate(config.repo, candidate.pr, settings);
        details = ` pr=${candidate.pr.number} head=${candidate.pr.headRefOid} owner=${candidate.owner} ready-since=${candidate.since} gate=${gate.gate}${gate.check ? ` check=${gate.check}` : ""}`;
      }
      message = `${status}${details} last-merge=${snapshot.last ?? "none"} threshold-minutes=${settings.threshold} ready=${waiting.length} queued=${snapshot.queue}`;
    }
  } catch {
    report(config, type, "UNKNOWN reason=read-failed");
    return 1;
  }
  const signature = encodeURIComponent(message);
  if (prior !== signature)
    report(config, type, `${message} signature=${signature}`);
  writeFileSync(
    config.state,
    `${JSON.stringify({ version: 1, repo: config.repo, command: config.command, signature })}\n`,
    { mode: 0o600 },
  );
  return 0;
}
