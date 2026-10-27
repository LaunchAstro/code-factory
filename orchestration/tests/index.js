// SPDX-License-Identifier: AGPL-3.0-only
// The one entry point for the kit's tests: `node --test orchestration/tests/`
// resolves this file. It imports every node:test file here and runs every
// shell case file and Python proof as one test each, from the repository
// root, so a non-zero exit from any of them fails the run. Twenty-five of
// these once ran under no runner at all (CF-Refine audit R5), so a file here
// of a kind this list does not know fails the run too, rather than going
// unrun.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = new URL(".", import.meta.url);
const root = fileURLToPath(new URL("../..", import.meta.url));
const files = readdirSync(here).sort();

const NODE_TEST = /-(?:cases|proofs?)\.mjs$/;
const SCRIPT = /-(?:cases|proofs?)\.(sh|py)$/;
const INTERPRETER = { sh: "bash", py: "python3" };
// Read by the tests above, never run on their own.
const SUPPORT = (file) =>
  file === "index.js" ||
  file === "fixtures" ||
  /-fixture\.mjs$/.test(file) ||
  file.endsWith(".json");

for (const file of files) {
  if (NODE_TEST.test(file)) await import(new URL(file, here));
}

// A script run from here would otherwise inherit node:test's child marker and
// report in its wire format if it ran `node --test` itself.
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;

for (const file of files) {
  const kind = SCRIPT.exec(file)?.[1];
  if (kind === undefined) continue;
  test(`${file} exits 0`, () => {
    const run = spawnSync(INTERPRETER[kind], [`orchestration/tests/${file}`], {
      cwd: root,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.slice(-4000);
    assert.equal(
      run.error,
      undefined,
      `${file} could not start: ${run.error?.message}`,
    );
    assert.equal(
      run.status,
      0,
      `${file} exited ${run.status ?? run.signal}\n${output}`,
    );
  });
}

test("every file in orchestration/tests/ is run or read by a test", () => {
  const unknown = files.filter(
    (file) => !NODE_TEST.test(file) && !SCRIPT.test(file) && !SUPPORT(file),
  );
  assert.deepEqual(unknown, [], "a test file of a kind index.js does not run");
});
