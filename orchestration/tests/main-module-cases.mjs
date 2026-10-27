// SPDX-License-Identifier: AGPL-3.0-only
// The kit's main-module guard: a command runs when node is asked to run it,
// through a symlink too, and never when it is imported or evaluated.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(new URL("../main-module.mjs", import.meta.url));

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "cf-main-module-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, "tool.mjs");
  writeFileSync(
    script,
    `import { isMainModule } from ${JSON.stringify(guard)};\nif (isMainModule(import.meta.url)) console.log("ran");\n`,
  );
  return { dir, script };
}
const run = (args) => spawnSync(process.execPath, args, { encoding: "utf8" });

test("a command node is asked to run runs", (t) => {
  const { script } = scratch(t);
  assert.equal(run([script]).stdout, "ran\n");
});

test("a command run through a symlink still runs", (t) => {
  const { dir, script } = scratch(t);
  const link = join(dir, "linked.mjs");
  symlinkSync(script, link);
  assert.equal(run([link]).stdout, "ran\n");
});

test("an imported or evaluated command does not run", (t) => {
  const { dir, script } = scratch(t);
  const importer = join(dir, "importer.mjs");
  writeFileSync(importer, `import ${JSON.stringify(script)};\n`);
  assert.equal(run([importer]).stdout, "");
  const evaluated = run(["--input-type=module", "-e", `import ${JSON.stringify(script)};`, script]);
  assert.equal(evaluated.stdout, "");
  assert.equal(evaluated.status, 0);
});

test("an entry path that no longer resolves throws rather than answering false", (t) => {
  const { dir, script } = scratch(t);
  const link = join(dir, "gone.mjs");
  symlinkSync(script, link);
  const runner = join(dir, "runner.mjs");
  writeFileSync(
    runner,
    `import { rmSync } from "node:fs";\nrmSync(${JSON.stringify(link)});\nprocess.argv[1] = ${JSON.stringify(link)};\nawait import(${JSON.stringify(script)});\n`,
  );
  const result = run([runner]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /the main-module guard cannot resolve/);
});
