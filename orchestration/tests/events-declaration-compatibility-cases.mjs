// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { parseEventLine } from "../events.mjs";

const prefix = "2026-10-14T01:00:00Z LANE-001 ";

test("issue ticket declarations remain valid at boot and on moves", () => {
  for (const type of ["BOOTED", "TICKET"]) {
    const control = parseEventLine(
      prefix + type + " Ticket: C80 Section: sitefix machine=m5",
    );
    assert.equal(control.type, type);
    assert.equal(control.fields.ticket, "C80");
    for (const completion of ["", " complete"]) {
      const line =
        prefix +
        type +
        ` Ticket: #1613${completion} Section: sitefix machine=m5`;
      const record = parseEventLine(line);
      assert.equal(record.type, type, line);
      assert.equal(record.fields.ticket, "#1613");
      assert.equal(record.fields.section, "sitefix");
      assert.equal(record.fields.machine, "m5");
      assert.equal(record.fields.complete, completion ? "true" : undefined);
    }
  }
});

test("ordinary Ticket Unit and Section words preserve legacy notes", () => {
  for (const type of ["BOOTED", "TICKET"]) {
    for (const message of [
      "Ticket moved after restart",
      "Unit restarted",
      "Section checks resumed",
    ]) {
      assert.deepEqual(
        parseEventLine(prefix + type + " " + message),
        {
          timestamp: "2026-10-14T01:00:00Z",
          actor: "LANE-001",
          type,
          message,
          subject: null,
          pr: null,
          head: null,
          fields: {},
          counts: {},
        },
        message,
      );
    }
  }
});

test("numeric or punctuated secondary tickets are refused instead of discarded", () => {
  for (const type of ["BOOTED", "TICKET"]) {
    const control = parseEventLine(
      prefix + type + " Ticket: C80, C81 Section: checks",
    );
    assert.equal(control.type, type);
    assert.equal(control.fields.ticket, "C80, C81");
    for (const id of ["81", "_C81", "/C81"]) {
      const line = prefix + type + ` Ticket: C80, ${id} Section: checks`;
      assert.deepEqual(parseEventLine(line), { type: "unknown" }, line);
    }
  }
});
