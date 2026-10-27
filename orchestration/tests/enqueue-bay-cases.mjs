// SPDX-License-Identifier: AGPL-3.0-only
// The loading bay's two gates: the Why and Left undone lines, and one
// re-queue on a drop before the PR goes back to its lane.
import assert from "node:assert/strict";
import test from "node:test";
import {
  fixture,
  head,
  removal,
  described,
  timeline,
} from "./enqueue-fixture.mjs";

const writes = (f) =>
  f.recorded().filter((a) => a.join(" ").includes("enqueuePullRequest")).length;
const sent = (f) => f.herdr().filter((a) => a[1] === "send-text");
const entered = (f) =>
  f.herdr().filter((a) => a[1] === "send-keys" && a.includes("Enter"));

function refuses(f, pattern, extra = []) {
  const result = f.run(extra);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout.split("\n")[0], pattern);
  assert.equal(writes(f), 0);
  return result;
}

const malformed = {
  "only the Why line": "**Why:** one gate.",
  "only the Left undone line": "**Left undone:** none",
  "an empty Why": "**Why:**\n**Left undone:** none",
  "the template's placeholder": "**Why:** ...\n**Left undone:** none",
  "an angle-bracket placeholder":
    "**Why:** <the reasons for the choices in this code>\n**Left undone:** none",
  "a TODO reason": "**Why:** TODO\n**Left undone:** none",
  "prose in Left undone":
    "**Why:** one gate.\n**Left undone:** the bay runner, later",
  "a template ticket list":
    "**Why:** one gate.\n**Left undone:** <#ticket, #ticket, or none>",
  "none beside a ticket": "**Why:** one gate.\n**Left undone:** none, #12",
  "two Why lines": "**Why:** one gate.\n**Why:** again.\n**Left undone:** none",
  "both on one line": "**Why:** one gate. **Left undone:** none",
  "the lines only inside a code block": "```markdown\n" + described + "\n```",
  "the lines only inside a comment": "<!--\n" + described + "\n-->",
  "the lines inside a four-backtick block holding a three-backtick line":
    "````markdown\n```\n" + described + "\n````",
  "the lines inside an unclosed code block": "```\n" + described,
  "a TODO reason with a full stop": "**Why:** TODO.\n**Left undone:** none",
  "a TBD reason in backticks": "**Why:** `TBD`\n**Left undone:** none",
  "a reason of punctuation only": "**Why:** ...!\n**Left undone:** none",
  "the Why line only inside a code block":
    "```\n**Why:** one gate.\n```\n**Left undone:** none",
};
for (const [name, body] of Object.entries(malformed)) {
  test(`bay refuses a description with ${name}`, (t) => {
    const f = fixture(t);
    f.pr.body = body;
    refuses(f, /^WAIT gate=description reason=(malformed|missing)$/u);
  });
}

for (const body of ["Builds the thing.", "", null]) {
  test(`bay refuses a description without the two lines: ${JSON.stringify(body)}`, (t) => {
    const f = fixture(t);
    f.pr.body = body;
    refuses(f, /^WAIT gate=description reason=missing$/u);
  });
}

for (const [name, left] of [
  ["none", "none"],
  ["None with a full stop", "None."],
  ["a local ticket", "#7"],
  [
    "tickets in other repos",
    "LaunchAstro/work-map#40, LaunchAstro/ops-astro#1661",
  ],
  ["an issue link", "https://github.com/LaunchAstro/code-factory/issues/154"],
]) {
  test(`bay accepts Left undone as ${name}`, (t) => {
    const f = fixture(t);
    f.pr.body = `Text.\n\n- **Why:** the reason.\n- **Left undone:** ${left}\nCloses: none\n`;
    const result = f.run();
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /^ENQUEUED #17/u);
  });
}

const why = "**Why:** the reason.\n**Left undone:** none\n";
for (const [name, closes] of [
  ["no Closes line", ""],
  ["a second ticket without its keyword", "Closes #7, #8"],
  ["none beside a ticket", "Closes: none, #7"],
  ["prose", "Closes the bay work"],
  ["two none lines", "Closes: none\nCloses: none"],
  ["none beside a Closes line", "Closes: none\nCloses #7"],
  ["the line only inside a code block", "```\nCloses #7\n```"],
]) {
  test(`bay refuses a Closes line with ${name}`, (t) => {
    const f = fixture(t);
    f.pr.body = why + closes;
    refuses(f, /^WAIT gate=description reason=malformed$/u);
  });
}

for (const [name, closes] of [
  ["one ticket", "Closes #7"],
  ["a keyword per ticket", "Closes #7, closes LaunchAstro/work-map#8"],
  ["one line per ticket", "Closes #7\n- closes #8"],
  [
    "an issue link",
    "Closes https://github.com/LaunchAstro/code-factory/issues/167",
  ],
  ["none", "Closes: none"],
  ["GitHub's colon form", "Closes: #7"],
  ["a list item after a blank line", "\n- Closes #7"],
]) {
  test(`bay accepts a Closes line with ${name}`, (t) => {
    const f = fixture(t);
    f.pr.body = why + closes;
    const result = f.run();
    assert.equal(result.status, 0, result.stdout);
  });
}

// #169: the description is read as GitHub renders it, not by hand.
const lines2 = "**Why:** the reason.\n**Left undone:** none\n";
for (const [name, closes] of [
  ["four spaces after a blank line", "\n    Closes #7"],
  ["a space and a tab after a blank line", "\n \tCloses #7"],
  ["indented code after a fence", "```\nexample\n```\n    Closes #7"],
]) {
  test(`bay refuses a Closes line hidden as code: ${name}`, (t) => {
    const f = fixture(t);
    f.pr.body = lines2 + closes;
    refuses(f, /^WAIT gate=description reason=malformed$/u);
  });
}

test("bay accepts a Closes line continuing a list item", (t) => {
  const f = fixture(t);
  f.pr.body = lines2 + "\n- Closing ticket\n\n    Closes #7";
  const result = f.run();
  assert.equal(result.status, 0, result.stdout);
});

test("bay refuses the lines quoted inside inline code", (t) => {
  const f = fixture(t);
  f.pr.body = "`**Why:** the reason.`\n`**Left undone:** none`\n`Closes: none`";
  refuses(f, /^WAIT gate=description reason=missing$/u);
});

test("bay refuses the lines struck through", (t) => {
  const f = fixture(t);
  f.pr.body =
    "~~**Why:** the reason.~~\n~~**Left undone:** none~~\n~~Closes: none~~";
  refuses(f, /^WAIT gate=description reason=missing$/u);
});

test("bay renders an unchanged description once per pass", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  assert.equal(f.recorded().filter((a) => a[1] === "markdown").length, 1);
});

test("bay waits when GitHub cannot render the description", (t) => {
  const f = fixture(t);
  f.data.markdown = { exit: 1 };
  const result = f.run();
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^WAIT gate=read-description/u);
  assert.equal(writes(f), 0);
});

test("bay accepts Windows line ends", (t) => {
  const f = fixture(t);
  f.pr.body = described.replaceAll("\n", "\r\n");
  assert.equal(f.run().status, 0);
});

test("bay rechecks the description on the final read", (t) => {
  const f = fixture(t);
  f.data.final = {
    body: {
      data: { repository: { pullRequest: { ...f.pr, body: "cleared" } } },
    },
  };
  refuses(f, /^WAIT gate=description reason=missing$/u);
});

test("bay sends the owning lane one line with the template, then Enter", (t) => {
  const f = fixture(t);
  f.pr.body = "Builds the thing.";
  const result = refuses(f, /^WAIT gate=description/u, ["--pane", "w1:p3"]);
  assert.match(result.stdout, /^NOTIFY pane=w1%3Ap3 sent$/mu);
  const [line] = sent(f);
  assert.equal(line[2], "w1:p3");
  assert.doesNotMatch(line[3], /\n/u);
  assert.doesNotMatch(line[3], /^\//u);
  for (const part of [
    "#17",
    "**Why:**",
    "**Left undone:**",
    "Closes",
    "tickets",
  ])
    assert.ok(line[3].includes(part), part);
  assert.equal(entered(f).length, 1);
});

test("bay sends nothing to a pane when the wrap-up is fine", (t) => {
  const f = fixture(t);
  assert.equal(f.run(["--pane", "w1:p3"]).status, 0);
  assert.equal(f.herdr().length, 0);
});

test("bay never presses Enter when the text is not on screen", (t) => {
  const f = fixture(t);
  f.pr.body = "";
  const result = f.run(["--pane", "w1:p3"], true, "hidden");
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /^NOTIFY pane=w1%3Ap3 failed reason=not-visible$/mu,
  );
  assert.equal(entered(f).length, 0);
});

test("bay never presses Enter on a usage modal", (t) => {
  const f = fixture(t);
  f.pr.body = "";
  const result = f.run(["--pane", "w1:p3"], true, "modal");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^NOTIFY pane=w1%3Ap3 failed reason=modal$/mu);
  assert.equal(entered(f).length, 0);
});

for (const [mode, reason] of [
  ["paylimit", "modal"],
  ["stale", "not-visible"],
]) {
  test(`bay never presses Enter on a ${mode} screen`, (t) => {
    const f = fixture(t);
    f.pr.body = "";
    const result = f.run(["--pane", "w1:p3"], true, mode);
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      new RegExp(`^NOTIFY pane=w1%3Ap3 failed reason=${reason}$`, "mu"),
    );
    assert.equal(entered(f).length, 0);
  });
}

test("bay presses Enter for a fresh paste marker after an old one scrolls away", (t) => {
  const f = fixture(t);
  f.pr.body = "";
  const result = f.run(["--pane", "w1:p3"], true, "scrolled");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^NOTIFY pane=w1%3Ap3 sent$/mu);
  assert.equal(entered(f).length, 1);
});

test("bay accepts the lines after a closed code block", (t) => {
  const f = fixture(t);
  f.pr.body = "````\n```\nexample\n```\n````\n" + described;
  assert.equal(f.run().status, 0);
});

test("bay refuses a malformed pane id before any read", (t) => {
  const f = fixture(t);
  const result = f.run(["--pane", "w1 p3;rm"]);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^WAIT gate=input/u);
  assert.equal(f.recorded().length, 0);
});

test("bay re-queues once after one drop at this head", (t) => {
  const f = fixture(t);
  f.pr.timelineItems = timeline([removal("2026-10-15T01:00:00Z")]);
  const result = f.run(["--pane", "w1:p3"]);
  assert.equal(result.status, 0, result.stdout);
  assert.match(
    result.stdout,
    new RegExp(`^REQUEUED #17 head=${head} drops=1$`, "mu"),
  );
  assert.equal(writes(f), 1);
  assert.equal(f.herdr().length, 0);
});

test("bay hands a second drop back to the lane", (t) => {
  const f = fixture(t);
  f.pr.timelineItems = timeline([
    removal("2026-10-15T01:00:00Z"),
    removal("2026-10-15T02:00:00Z", "merge conflict"),
  ]);
  const result = refuses(f, /^WAIT gate=dropped reason=twice-at-head$/u, [
    "--pane",
    "w1:p3",
  ]);
  assert.match(result.stdout, /^NOTIFY pane=w1%3Ap3 sent$/mu);
  const [line] = sent(f);
  assert.ok(line[3].includes("#17"));
  assert.ok(line[3].includes("merge conflict"));
  assert.ok(line[3].includes(head.slice(0, 7)));
});

test("bay ignores drops from before this head's commit", (t) => {
  const f = fixture(t);
  f.pr.timelineItems = timeline([
    removal("2026-10-14T01:00:00Z"),
    removal("2026-10-14T02:00:00Z"),
    removal("2026-10-15T01:00:00Z"),
  ]);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /^REQUEUED #17 .* drops=1$/mu);
});

test("bay reads GitHub's real filtered timeline (ops-astro#1657, 15 Oct)", (t) => {
  const f = fixture(t);
  f.pr.timelineItems = {
    totalCount: 9,
    filteredCount: 1,
    pageCount: 1,
    pageInfo: { hasPreviousPage: false, hasNextPage: false },
    nodes: [removal("2026-10-14T19:57:22Z", "manual")],
  };
  const result = f.run();
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /^ENQUEUED #17/u);
  assert.equal(writes(f), 1);
});

for (const [name, extra] of [
  ["an earlier page of removals", { pageInfo: { hasPreviousPage: true } }],
  ["fewer removals than GitHub counted", { filteredCount: 2 }],
  ["no filtered count", { filteredCount: undefined }],
  ["no page information", { pageInfo: undefined }],
]) {
  test(`bay waits on a drop history with ${name}`, (t) => {
    const f = fixture(t);
    f.pr.timelineItems = timeline([removal("2026-10-15T01:00:00Z")], extra);
    const result = f.run();
    assert.equal(result.status, 2);
    assert.match(result.stdout, /^WAIT gate=read-pr/u);
    assert.equal(writes(f), 0);
  });
}

test("bay waits when the newest commit is not the expected head", (t) => {
  const f = fixture(t);
  f.pr.commits.nodes[0].commit.oid = "b".repeat(40);
  const result = f.run();
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^WAIT gate=read-pr/u);
});

test("bay leaves an already-queued PR alone whatever its description", (t) => {
  const f = fixture(t);
  f.pr.mergeQueueEntry = { id: "MQ_fixture" };
  f.pr.body = "";
  const result = f.run(["--pane", "w1:p3"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^ALREADY-QUEUED/u);
  assert.equal(f.herdr().length, 0);
});
