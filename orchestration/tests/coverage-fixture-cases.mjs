// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("every numbered train and event-wait check has a coverage decision", () => {
  const catalogue = readFileSync(
    new URL("../../docs/TOOLS.md", import.meta.url),
    "utf8",
  );
  const coverage = readFileSync(
    new URL("../watch-coverage.md", import.meta.url),
    "utf8",
  );
  const required = [
    ...catalogue.matchAll(/^\|\s*`(trainNq\.sh|wait-keyN\.sh)`[^\n]*$/gm),
  ].map((match) => match[1]);
  assert.deepEqual(required, ["trainNq.sh", "wait-keyN.sh"]);
  const sources = coverage
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|")[1].trim());
  const absent = required.filter((name) => {
    const prefix = name.startsWith("train")
      ? /^(?:train(?:[0-9N]|[: .-]|$)|merge[- ]train\b)/i
      : /^(?:wait-key(?:[0-9N]|[: .-]|$)|event[- ]wait\b)/i;
    return !sources.some((source) => prefix.test(source.replaceAll("`", "")));
  });
  assert.deepEqual(
    absent,
    [],
    "Each old watcher needs its own checks, replacement or not-covered reason; supervisor coverage cannot stand in for train and wait-key coverage",
  );
});

test("committed replay fixture strings contain structured values, not free prose or source locators", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/round-2000-01-01.replay.json", import.meta.url),
      "utf8",
    ),
  );
  const prosePaths = [];
  function inspect(value, path) {
    if (typeof value === "string") {
      if (!/^[A-Za-z0-9_.:-]+$/.test(value)) prosePaths.push(path);
    } else if (Array.isArray(value)) {
      value.forEach((entry, index) => inspect(entry, `${path}[${index}]`));
    } else if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (key === "sourceLines") prosePaths.push(`${path}.${key}`);
        inspect(entry, `${path}.${key}`);
      }
    }
  }
  inspect(fixture, "fixture");
  assert.deepEqual(
    prosePaths,
    [],
    "Incident causes should be structured codes in the fixture, with no line references into any source log",
  );
});
