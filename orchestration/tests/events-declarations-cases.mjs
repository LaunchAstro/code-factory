// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { parseEventLine } from "../events.mjs";

const prefix = "2026-10-14T01:00:00Z LANE-001 ";

test("boot declarations expose the ticket, section and machine", () => {
  for (const [message, fields] of [
    ["Ticket: C80", { ticket: "C80" }],
    ["Ticket: none Section: checks", { ticket: "none", section: "checks" }],
    [
      "Ticket: C80 Section: checks machine=m5",
      { ticket: "C80", section: "checks", machine: "m5" },
    ],
    ["machine=m5", { machine: "m5" }],
    [
      "Ticket: C80, C81 Section: checks",
      { ticket: "C80, C81", section: "checks" },
    ],
    [
      "Ticket: C80, the About page Section: sitefix",
      { ticket: "C80", section: "sitefix" },
    ],
    ["Unit: U32 Section: workbench", { unit: "U32", section: "workbench" }],
    ["Section: project--checks-", { section: "project--checks-" }],
    [
      "Ticket: S0-1, MP-1-2 Section: project-checks machine=laptop",
      { ticket: "S0-1, MP-1-2", section: "project-checks", machine: "laptop" },
    ],
  ]) {
    const record = parseEventLine(
      prefix + "BOOTED (model, seat example) " + message,
    );
    assert.equal(record.type, "BOOTED", message);
    assert.deepEqual(record.fields, fields, message);
  }
});

test("ticket moves and completion carry declarations without inventing a section", () => {
  for (const [message, fields] of [
    ["Ticket: C81", { ticket: "C81" }],
    ["Ticket: none Section: checks", { ticket: "none", section: "checks" }],
    [
      "Ticket: C81 complete Section: checks",
      { ticket: "C81", complete: "true", section: "checks" },
    ],
    ["Unit: U32 Section: workbench", { unit: "U32", section: "workbench" }],
  ]) {
    const record = parseEventLine(prefix + "TICKET " + message);
    assert.equal(record.type, "TICKET", message);
    assert.deepEqual(record.fields, fields, message);
  }
});

test("historical boot and move notes retain their original record shape", () => {
  for (const type of ["BOOTED", "TICKET"]) {
    assert.deepEqual(parseEventLine(prefix + type + " legacy note"), {
      timestamp: "2026-10-14T01:00:00Z",
      actor: "LANE-001",
      type,
      message: "legacy note",
      subject: null,
      pr: null,
      head: null,
      fields: {},
      counts: {},
    });
  }
  assert.deepEqual(parseEventLine(prefix + "BOOTED Section: checks").fields, {
    section: "checks",
  });
});

test("completion words in descriptive prose do not finish a ticket", () => {
  for (const message of [
    "Ticket: C81 work is not complete Section: checks",
    "Ticket: C81, complete the checks Section: checks",
    "Ticket: C81 complete-later Section: checks",
  ]) {
    const record = parseEventLine(prefix + "TICKET " + message);
    assert.equal(record.type, "TICKET");
    assert.deepEqual(record.fields, { ticket: "C81", section: "checks" });
  }
  assert.deepEqual(
    parseEventLine(prefix + "TICKET Ticket: C80, C81 complete Section: checks")
      .fields,
    { ticket: "C80, C81", complete: "true", section: "checks" },
  );
});

test("malformed ticket and section declarations are unknown", () => {
  for (const message of [
    "Ticket:",
    "Ticket:C80",
    "Ticket= C80",
    "Ticket: c80",
    "Ticket: C80x",
    "Ticket: C80/extra",
    "Ticket: C80,",
    "Ticket: C80, c81",
    "Ticket: none, C80",
    "Ticket: C80 Ticket: C81",
    "Ticket: C80 Unit: U32",
    "Unit: wrong",
    "Section:",
    "Section:Checks",
    "Section= checks",
    "Section: Checks",
    "Section: checks/extra",
    "Section: checks Section: engine",
    "Section: checks,engine",
  ]) {
    for (const type of ["BOOTED", "TICKET"]) {
      const line = prefix + type + " " + message;
      assert.deepEqual(parseEventLine(line), { type: "unknown" }, line);
    }
  }
});

test("malformed hyphenated IDs after a valid ticket cannot become descriptive prose", () => {
  for (const type of ["BOOTED", "TICKET"]) {
    for (const id of [
      "MP-1/extra",
      "S0-1/extra",
      "MP-1-2?extra",
      "MP-1-2x/extra",
    ]) {
      const line = prefix + type + ` Ticket: C80, ${id} Section: checks`;
      assert.deepEqual(parseEventLine(line), { type: "unknown" }, line);
    }
    const valid = parseEventLine(
      prefix + type + " Ticket: C80, MP-1-2 Section: checks",
    );
    assert.equal(valid.type, type);
    assert.deepEqual(valid.fields, {
      ticket: "C80, MP-1-2",
      section: "checks",
    });
    assert.deepEqual(
      parseEventLine(
        prefix + type + " Ticket: C80, the About page Section: checks",
      ).fields,
      { ticket: "C80", section: "checks" },
    );
  }
});

test("the ordinary word machine in historical notes is preserved", () => {
  for (const type of ["BOOTED", "TICKET"]) {
    for (const message of [
      "on a different machine after restart",
      "restarted on another machine",
    ]) {
      assert.deepEqual(parseEventLine(prefix + type + " " + message), {
        timestamp: "2026-10-14T01:00:00Z",
        actor: "LANE-001",
        type,
        message,
        subject: null,
        pr: null,
        head: null,
        fields: {},
        counts: {},
      });
    }
    assert.deepEqual(
      parseEventLine(
        prefix + type + " Ticket: C80, machine maintenance Section: checks",
      ).fields,
      { ticket: "C80", section: "checks" },
    );
    assert.deepEqual(
      parseEventLine(prefix + type + " Ticket: C80 machine=m5").fields,
      { ticket: "C80", machine: "m5" },
    );
  }
});

test("malformed explicit machine fields are unknown", () => {
  for (const message of [
    "machine=",
    "machine: m5",
    "machine =m5",
    "machine=m5/extra",
    "machine=m5,extra",
    "machine=m5 machine=laptop",
  ]) {
    const line = prefix + "BOOTED Ticket: C80 " + message;
    assert.deepEqual(parseEventLine(line), { type: "unknown" }, line);
  }
});

test("scope results expose a PR and all advisory measurements", () => {
  for (const [status, counts] of [
    ["CLEAN", "outOfScope=0 bloat=0 mapGaps=0"],
    ["FINDINGS", "outOfScope=2 bloat=1 mapGaps=3"],
  ]) {
    const record = parseEventLine(
      prefix +
        `SCOPE ${status} pr=81 section=checks added=12 removed=3 ${counts} repo=fixture/repo`,
    );
    assert.equal(record.type, "SCOPE");
    assert.equal(record.status, status);
    assert.equal(record.pr, 81);
    assert.deepEqual(record.fields, {
      pr: "81",
      section: "checks",
      added: "12",
      removed: "3",
      outOfScope: status === "CLEAN" ? "0" : "2",
      bloat: status === "CLEAN" ? "0" : "1",
      mapGaps: status === "CLEAN" ? "0" : "3",
      repo: "fixture/repo",
    });
  }
  for (const section of ["", "section=none "]) {
    const record = parseEventLine(
      prefix +
        `SCOPE CLEAN pr=81 ${section}added=0 removed=0 outOfScope=0 bloat=0 mapGaps=0`,
    );
    assert.equal(record.type, "SCOPE", "missing section is advisory");
  }
});

test("a failed scope read reports UNKNOWN with an optional known PR", () => {
  for (const pr of ["", "pr=81 "]) {
    const record = parseEventLine(
      prefix + `SCOPE UNKNOWN ${pr}reason=read-failed`,
    );
    assert.equal(record.type, "SCOPE");
    assert.equal(record.status, "UNKNOWN");
    assert.equal(record.pr, pr ? 81 : null);
    assert.equal(record.fields.reason, "read-failed");
  }
});

test("malformed scope results cannot become a clean or identified report", () => {
  const clean =
    "CLEAN pr=81 section=checks added=12 removed=3 outOfScope=0 bloat=0 mapGaps=0";
  for (const message of [
    "",
    "note",
    clean.replace("CLEAN", "PASS"),
    clean.replace("pr=81 ", ""),
    clean.replace("pr=81", "pr=0"),
    clean.replace("pr=81", "pr=81x"),
    clean.replace("pr=81", "pr=9007199254740992"),
    clean.replace("added=12", "added=-1"),
    clean.replace("removed=3", "removed=1.5"),
    clean.replace("mapGaps=0", "mapGaps="),
    clean.replace("bloat=0", "bloat=9007199254740992"),
    clean.replace("outOfScope=0", "outOfScope=1"),
    clean.replace("section=checks", "section=Checks"),
    clean + " pr=82",
    clean + " prose",
    "FINDINGS pr=81 added=1 removed=0 outOfScope=0 bloat=0 mapGaps=0",
    "UNKNOWN",
    "UNKNOWN reason=",
    "UNKNOWN pr=x reason=read-failed",
    "UNKNOWN reason=read-failed added=0",
    "UNKNOWN reason=read-failed;ignored",
  ]) {
    const line = prefix + "SCOPE " + message;
    assert.deepEqual(parseEventLine(line), { type: "unknown" }, line);
  }
});
