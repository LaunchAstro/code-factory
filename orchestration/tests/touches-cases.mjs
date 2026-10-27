// SPDX-License-Identifier: AGPL-3.0-only
// Exercise the report-only dispatch CLI against a round and a fake gh.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  fixture,
  records,
  holder,
  heldPath,
  stamp,
} from "./touches-fixture.mjs";

test("a second lane is refused with the shared busy file and holding lane", (t) => {
  const f = fixture(t, { busy: [heldPath], lanes: [holder()] });
  const reports = records(f.run(), 1, "HELD");
  assert.ok(
    reports.some(
      (r) =>
        r.fields.owner === "BUILD-A" &&
        decodeURIComponent(r.fields.path) === heldPath,
    ),
  );
  assert.ok(reports.some((r) => r.fields.reason === "busy-file"));
});

test("declared paths are exclusive even when they are absent from the busy list", (t) => {
  const f = fixture(t, { lanes: [holder()] });
  const [report] = records(f.run(), 1, "HELD");
  assert.equal(report.fields.owner, "BUILD-A");
  assert.equal(report.fields.reason, "lane-declaration");
});

test("a busy setting refuses even the first declaration and is configurable", (t) => {
  const f = fixture(t, { busy: [heldPath] });
  const [report] = records(f.run(), 1, "HELD");
  assert.equal(report.fields.owner, "ROUND-SETTING");
  writeFileSync(f.settings, JSON.stringify({ touches: { busyFiles: [] } }));
  const [allowed] = records(f.run(), 0, "DECLARED");
  assert.deepEqual(JSON.parse(decodeURIComponent(allowed.fields.paths)), [
    heldPath,
  ]);
});

test("WRAPPED releases a lane's declaration and its brief paths on the next process", (t) => {
  const f = fixture(t, {
    lanes: [holder()],
    events: `${stamp} BUILD-A BOOTED\n`,
  });
  records(f.run(), 1, "HELD");
  writeFileSync(
    join(f.round, "events.log"),
    `${stamp} BUILD-A BOOTED\n2026-10-14T00:01:00Z BUILD-A WRAPPED handback=done.md\n`,
  );
  rmSync(join(f.round, "holder.md"));
  records(f.run(), 0, "DECLARED");
});

test("a wrap before a new declaration and narrative wrap mentions do not release paths", (t) => {
  const events = `${stamp} BUILD-A WRAPPED\n2026-10-14T00:02:00Z BUILD-A NOTE WRAPPED\n`;
  const f = fixture(t, {
    lanes: [holder([heldPath], "2026-10-14T00:01:00Z")],
    events,
  });
  records(f.run(), 1, "HELD");
});

test("explicit brief paths are checked for both working lanes and the candidate", (t) => {
  const f = fixture(t, { lanes: [holder([])], candidateBrief: [heldPath] });
  writeFileSync(
    join(f.round, "holder.md"),
    `# Build\nTouches: ["${heldPath}"]\n`,
  );
  const [report] = records(f.run(["other.mjs"]), 1, "HELD");
  assert.equal(report.fields.owner, "BUILD-A");
  assert.equal(report.fields.reason, "brief");
});

test("open PR files and rename sources refuse dispatch and identify the holder", (t) => {
  const f = fixture(t, {
    lanes: [holder([])],
    prs: [
      [
        {
          number: 7,
          head: { ref: "feat/holder", repo: { full_name: "example/PROJECT" } },
        },
      ],
    ],
    files: { 7: [[{ filename: "renamed.mjs", previous_filename: heldPath }]] },
  });
  const [report] = records(f.run(), 1, "HELD");
  assert.equal(report.fields.owner, "BUILD-A");
  assert.equal(report.fields.pr, "7");
  assert.equal(report.fields.reason, "open-pr");
  const calls = readFileSync(f.calls, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    calls.every(
      (args) =>
        args[0] === "api" &&
        args[args.indexOf("--method") + 1] === "GET" &&
        args.includes("--paginate") &&
        args.includes("--slurp"),
    ),
  );
});

test("all GitHub pages are checked and an unassigned PR is named", (t) => {
  const f = fixture(t, {
    prs: [
      [],
      [
        {
          number: 8,
          head: {
            ref: "feat/elsewhere",
            repo: { full_name: "Example/project" },
          },
        },
      ],
    ],
    files: { 8: [[], [{ filename: heldPath }]] },
  });
  const [report] = records(f.run(), 1, "HELD");
  assert.equal(report.fields.owner, "PR-8");
});

test("a clear report encodes unusual paths and changes no round input", (t) => {
  const f = fixture(t);
  const before = Object.fromEntries(
    readdirSync(f.round).map((p) => [
      p,
      readFileSync(join(f.round, p), "utf8"),
    ]),
  );
  const paths = ["folder/space, semi; (one).mjs", "folder/other.mjs"];
  const [report] = records(f.run(paths), 0, "DECLARED");
  assert.deepEqual(JSON.parse(decodeURIComponent(report.fields.paths)), paths);
  const after = Object.fromEntries(
    readdirSync(f.round).map((p) => [
      p,
      readFileSync(join(f.round, p), "utf8"),
    ]),
  );
  assert.deepEqual(after, before);
});

test("failed GitHub reads are UNKNOWN and never produce a declaration", (t) => {
  const f = fixture(t, {
    prs: [
      [
        {
          number: 7,
          head: { ref: "feat/other", repo: { full_name: "Example/project" } },
        },
      ],
    ],
  });
  for (const fail of ["all", "pulls/7/files"]) {
    records(f.run([heldPath], [], { FAKE_FAIL: fail }), 2, "UNKNOWN");
  }
});

test("missing or malformed local reads and unknown event lines are UNKNOWN", (t) => {
  for (const target of [
    "settings",
    "touches.json",
    "events.log",
    "holder.md",
    "candidate.md",
  ]) {
    for (const missing of [true, false]) {
      const f = fixture(t, { lanes: [holder()] });
      const path = target === "settings" ? f.settings : join(f.round, target);
      if (missing) rmSync(path);
      else writeFileSync(path, "unreadable structure\n");
      records(f.run(), 2, "UNKNOWN");
    }
  }
});

test("malformed GitHub responses and unsafe path declarations are UNKNOWN", (t) => {
  for (const data of [
    { prs: {} },
    { prs: [[{ number: 9 }]] },
    { prs: [[{ number: 9, head: { ref: "feat/x" } }]] },
    { prs: [[{ number: 9, head: { ref: "feat/x", repo: {} } }]] },
    {
      prs: [
        [
          {
            number: 9,
            head: { ref: "feat/x", repo: { full_name: "invalid" } },
          },
        ],
      ],
    },
    {
      prs: [
        [
          {
            number: 9,
            head: { ref: "feat/x", repo: { full_name: "Example/project" } },
          },
        ],
      ],
      files: { 9: [[{}]] },
    },
  ]) {
    const f = fixture(t, data);
    records(f.run(), 2, "UNKNOWN");
  }
  const f = fixture(t);
  for (const paths of [
    ["../file"],
    ["/absolute"],
    ["a/../file"],
    ["file\nname"],
  ]) {
    records(f.run(paths), 2, "UNKNOWN");
  }
});

test("an open PR at the API file limit is UNKNOWN rather than a clear snapshot", (t) => {
  const f = fixture(t, {
    prs: [
      [
        {
          number: 9,
          head: { ref: "feat/large", repo: { full_name: "Example/project" } },
        },
      ],
    ],
    files: {
      9: [
        Array.from({ length: 3000 }, (_, i) => ({ filename: `file-${i}.mjs` })),
      ],
    },
  });
  records(f.run(), 2, "UNKNOWN");
});

test("the example busy setting records the four incident paths", () => {
  const settings = JSON.parse(
    readFileSync(new URL("../watch.example.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(settings.touches.busyFiles, [
    "packages/core-commands/src/commands/outcome.ts",
    "tests/reads/task-rank-core-upgrade-durable.test.ts",
    "tests/reads/task-rank-core-contract.test.ts",
    "apps/web/src/screens/Projects.tsx",
  ]);
  assert.match(settings.touches.busyFilesSource, /OWNER-LESSONS\.md/u);
});

test("the boot template carries the report-only touches dispatch step", () => {
  const boot = readFileSync(
    new URL("../archive/boot/ORCHESTRATOR-BOOT-TEMPLATE.md", import.meta.url),
    "utf8",
  );
  assert.match(
    boot,
    /node .*orchestration\/watch\.mjs"? touches .*--round .*--settings .*--repo .*--lane .*--paths .*--brief/u,
  );
  assert.match(boot, /UNKNOWN.*do not dispatch/u);
});

test("a lane with explicit empty path lists can be declared before dispatch", (t) => {
  const f = fixture(t);
  const [report] = records(f.run([]), 0, "DECLARED");
  assert.deepEqual(JSON.parse(decodeURIComponent(report.fields.paths)), []);
  records(f.run([], [], { FAKE_FAIL: "all" }), 2, "UNKNOWN");
  rmSync(join(f.round, "candidate.md"));
  records(f.run([]), 2, "UNKNOWN");
});

test("the boot dispatch command reads settings installed in the round", (t) => {
  const f = fixture(t);
  const settings = join(f.round, "watch.json");
  writeFileSync(settings, readFileSync(f.settings));
  rmSync(f.settings);
  const boot = readFileSync(
    new URL("../archive/boot/ORCHESTRATOR-BOOT-TEMPLATE.md", import.meta.url),
    "utf8",
  );
  const command = boot.match(/`(node [^`]+ touches [^`]+)`/u)?.[1];
  assert.ok(command);
  const values = {
    "<CLONE>": new URL("../../", import.meta.url).pathname,
    "<ORCHESTRATION-ROOT>": f.root,
    "<OWNER>/<REPO>": "Example/project",
    "<slug>": "BUILD-B",
    "<file>": "candidate.md",
    "path/to/file": heldPath,
  };
  const rendered = Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(key, value),
    command,
  );
  const run = (command) =>
    spawnSync("sh", ["-c", command], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(f.root, "bin")}:${process.env.PATH}`,
        FAKE_DATA: join(f.root, "github.json"),
        FAKE_CALLS: f.calls,
      },
    });
  const control = rendered.replace(
    /--settings "[^"]+"/u,
    `--settings "${settings}"`,
  );
  records(run(control), 0, "DECLARED");
  records(run(rendered), 0, "DECLARED");
});

test("a fork PR sharing a branch name is held by its PR rather than a local lane", (t) => {
  for (const repo of [{ full_name: "ForkOwner/project" }, null]) {
    const f = fixture(t, {
      lanes: [holder([])],
      prs: [
        [
          {
            number: 7,
            head: { ref: "feat/holder", repo },
          },
        ],
      ],
      files: { 7: [[{ filename: heldPath }]] },
    });
    const [report] = records(f.run(), 1, "HELD");
    assert.equal(report.fields.owner, "PR-7");
    assert.equal(report.fields.pr, "7");
    assert.equal(report.fields.reason, "open-pr");
  }
});
