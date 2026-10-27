// SPDX-License-Identifier: AGPL-3.0-only
import { appendFileSync, readFileSync } from "node:fs";
import { parseEventLine } from "./events.mjs";

/**
 * Append one watcher report to the round log and print it. The line must
 * parse back as `type`, and an unterminated log is refused, so a report can
 * neither write a line the grammar cannot read nor corrupt the log's last
 * physical line. Throws on either; the callers turn a throw into their exit 2
 * or UNKNOWN path.
 * @param {string} log @param {string} line @param {string} type
 */
export function appendReport(log, line, type) {
  if (parseEventLine(line).type !== type) throw new Error("invalid-report");
  const text = readFileSync(log, "utf8");
  if (text && !text.endsWith("\n")) throw new Error("unterminated-log");
  appendFileSync(log, `${line}\n`);
  console.log(line);
}
