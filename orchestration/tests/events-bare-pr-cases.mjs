// node --test orchestration/tests/events-bare-pr-cases.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseEventLine } from "../events.mjs";

const prefix = "2000-01-01T04:48:27Z EXAMPLE-012 ";

test("bare PR announcements retain the PR number before their head", () => {
  const fixture = readFileSync(
    new URL("./fixtures/round-2000-01-01.events.log", import.meta.url),
    "utf8",
  ).split("\n");
  assert.equal(parseEventLine(fixture[643]).pr, 1106);
});

test("bare and hash PR announcements expose the same identifier and head", () => {
  const hashed = parseEventLine(
    prefix + "PR-OPENED M-A04-3a #1192 head=abcdef123",
  );
  assert.equal(hashed.pr, 1192);
  const bare = parseEventLine(
    prefix + "PR-OPENED M-A04-3a 1192 head=abcdef123",
  );
  assert.equal(bare.pr, hashed.pr);
  assert.equal(bare.head, hashed.head);
  assert.equal(bare.type, hashed.type);
  assert.equal(parseEventLine(prefix + "PR-OPENED M-A04-3a 1192").pr, null);
  assert.equal(
    parseEventLine(prefix + "PR-OPENED M-A04-3a 1192 previous-head=abcdef123")
      .pr,
    null,
  );
});
