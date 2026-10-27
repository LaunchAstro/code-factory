// SPDX-License-Identifier: AGPL-3.0-only
// Sol's proofs from PR #181's three rounds, kept for the mechanisms that
// remain. Criterion 2's comment-footer proofs (read-only members, quoted,
// indented and fenced footers) went with the comment reader: Sol's verdict is
// now a commit status, which GitHub binds to the head and lets only writers
// set; enqueue-direct-cases.mjs covers it.
import assert from "node:assert/strict";
import test from "node:test";
import { described, fixture, head } from "./enqueue-fixture.mjs";

const ranked = (rank) =>
  `${described}\n**Risk:** ${rank}, the reason for this rank.`;
const mutations = (f) =>
  f
    .recorded()
    .filter(
      (args) =>
        args[1]?.endsWith("/merge") ||
        args.join(" ").includes("enqueuePullRequest"),
    );
function direct(t, rank = "medium") {
  const f = fixture(t);
  f.pr.isMergeQueueEnabled = false;
  f.pr.body = ranked(rank);
  f.data.rules.body = [[]];
  f.data.runs.body = [{ total_count: 0, check_runs: [] }];
  f.data.sol.body = [[{ id: 1, context: "Sol verdict", state: "success" }]];
  return f;
}
function mustWait(f) {
  const result = f.run();
  assert.equal(
    result.status,
    1,
    `Expected WAIT without mutation; got ${result.stdout.trim()}; mutations=${mutations(f).length}`,
  );
  assert.match(result.stdout, /^WAIT /u);
  assert.equal(mutations(f).length, 0);
}
function finalPr(f, extra) {
  f.data.final = {
    body: { data: { repository: { pullRequest: { ...f.pr, ...extra } } } },
  };
}

test("Sol proof control: unchanged approved direct PR merges once", (t) => {
  const f = direct(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout);
  assert.equal(mutations(f).length, 1);
  assert.match(result.stdout, new RegExp(`head=${head}`));
});

for (const file of [
  ".circleci/config.yml",
  ".githooks/pre-commit",
  "Cargo.lock",
  "pyproject.toml",
  "wrangler.jsonc",
  "src/app/sign-in/page.tsx",
  "pom.xml",
  "build.gradle.kts",
  "packages.lock.json",
  "pubspec.yaml",
  "npm-shrinkwrap.json",
]) {
  test(`Sol proof, criterion 3: low risk refuses protected path ${file}`, (t) => {
    const f = direct(t, "low");
    f.data.sol.body = [[]];
    f.data.files.body = [[{ filename: file }]];
    mustWait(f);
  });
}
for (const from of [
  ".circleci/config.yml",
  "pom.xml",
  "packages/web/npm-shrinkwrap.json",
]) {
  test(`Sol proof, criterion 3: low risk refuses a rename out of ${from}`, (t) => {
    const f = direct(t, "low");
    f.data.sol.body = [[]];
    f.data.files.body = [
      [{ filename: "docs/retired.txt", previous_filename: from }],
    ];
    mustWait(f);
  });
}

test("Sol proof, criterion 4: a valid description edit with unchanged risk waits", (t) => {
  const f = direct(t);
  const changed = ranked("medium").replace("Closes #7", "Closes #8");
  finalPr(f, { body: changed });
  const html = (ticket) =>
    `<p>Builds the thing.</p><p><strong>Why:</strong> one gate in the script every lane already uses.<br>\n<strong>Left undone:</strong> #12, LaunchAstro/work-map#40<br>\nCloses #${ticket}<br>\n<strong>Risk:</strong> medium, the reason for this rank.</p>`;
  f.data.markdown = {
    byText: { [ranked("medium")]: html(7), [changed]: html(8) },
  };
  mustWait(f);
});

for (const [name, update] of [
  ["head", { headRefOid: "b".repeat(40) }],
  ["base", { baseRef: { name: "release", branchProtectionRule: null } }],
  ["queue setting", { isMergeQueueEnabled: true }],
  ["risk", { body: ranked("high") }],
]) {
  test(`Sol proof control: direct merge waits when ${name} changes`, (t) => {
    const f = direct(t);
    finalPr(f, update);
    mustWait(f);
  });
}
test("Sol proof control: direct merge waits when required checks change", (t) => {
  const f = direct(t);
  f.data.finalRules = {
    body: [
      [
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "new check" }] },
        },
      ],
    ],
  };
  mustWait(f);
});
