#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# ORCH73 78PATH, 4 October: a head that changed any path outside product source
# and the plan's own directory is refused before anything in it runs. Sol
# CF-05-FIX1 to CF-05-FIX4 each found a file the test setup loads that a list of
# what it loads had missed; this rule lists what the builder may change instead.
# One refused case for each surface those reviews used, then what the rule lets
# through, which runs only through the plan's tests' own imports (ORCH75
# 78SEC). And a plan's test is red only when an assertion in it failed.
#
# Sourced by tests/ci/acceptance-base-config-cases.sh, after its own cases and
# before its summary, so the counts and the exit are that file's. A second file
# because that one is near the per-file cap in CONTRIBUTING.md.

wrong_answer() {
  mkdir -p "$1/src"
  printf 'export function answer(): number {\n  return 0;\n}\n' > "$1/src/answer.ts"
}
commit_all() { git -C "$1" add -A >/dev/null; git -C "$1" commit -qm "$2"; }
setup_config() {
  base_config "$1" <<'TS'
export default { test: { setupFiles: ['./test/setup.ts'] } };
TS
}

# A mock. A mock with no factory loads the file of the same name in a __mocks__
# directory beside the module, so __mocks__ is never product source, src/ or not.
dir="$(new_repo)"; wrong_answer "$dir"; mkdir -p "$dir/test"
printf "import { vi } from 'vitest';\n\nvi.mock('../src/answer');\n" > "$dir/test/setup.ts"
base="$(setup_config "$dir")"
plan_importing "$dir" "7-the-answer"
mkdir -p "$dir/src/__mocks__"
printf '%s\nexport function answer(): number {\n  return 42; // %s\n}\n' "$EFFECT_JS" "$MARKER" \
  > "$dir/src/__mocks__/answer.ts"
commit_all "$dir" "feat: a mocks file with the right answer"
refused_naming "a mocks file the head adds beside the module is refused" \
  "src/__mocks__/answer.ts" "$dir" "$base"
rm -rf "$dir"

# A helper that an unchanged root mock imports (Sol CF-05-FIX4).
dir="$(new_repo)"; wrong_answer "$dir"; mkdir -p "$dir/test" "$dir/__mocks__"
printf "import { vi } from 'vitest';\nimport { platform } from 'node:os';\n\nvi.mock('node:os');\nplatform();\n" \
  > "$dir/test/setup.ts"
printf "import '../test/helper';\n\nexport const platform = () => 'synthetic';\n" > "$dir/__mocks__/os.ts"
printf 'export {};\n' > "$dir/test/helper.ts"
base="$(setup_config "$dir")"
plan_importing "$dir" "7-the-answer"
printf "import { vi } from 'vitest';\n%s\n// %s\nvi.mock('../src/answer', () => ({ answer: () => 42 }));\n" \
  "$EFFECT_JS" "$MARKER" > "$dir/test/helper.ts"
commit_all "$dir" "feat: the wrong answer, and a mock in a helper the root mock imports"
refused_naming "a helper an unchanged root mock imports is refused" "test/helper.ts" "$dir" "$base"
rm -rf "$dir"

# A PostCSS configuration, which vite loads by its name. A TypeScript one went
# through a loader nothing checked (Sol CF-05-FIX4). With the right code, and a
# change that does nothing, it is refused all the same.
dir="$(new_repo)"; mkdir -p "$dir/test"
printf 'export {};\n' > "$dir/test/setup.ts"
printf 'enum Mode { Proof }\nexport default { plugins: [] };\n' > "$dir/postcss.config.ts"
base="$(setup_config "$dir")"
plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
printf '%s\nenum Mode { Proof } // %s\nexport default { plugins: [] };\n' "$EFFECT_JS" "$MARKER" \
  > "$dir/postcss.config.ts"
commit_all "$dir" "chore: a PostCSS configuration"
refused_naming "a PostCSS configuration the head changes is refused" "postcss.config.ts" "$dir" "$base"
rm -rf "$dir"

# Links. Where the base's setup file was, a link out of the worktree is refused
# and nothing is written through it, and a link to an unchanged mock inside it
# is refused the same (Sol CF-05-FIX4). A link is never product source either,
# so src/answer.ts as a link to a right answer elsewhere is refused.
for shape in outside alternate product; do
  dir="$(new_repo)"; outside="$(mktemp -d)"; mkdir -p "$dir/test" "$dir/lib"
  printf 'SYNTHETIC_OUTSIDE_ORIGINAL\n' > "$outside/setup.ts"
  printf 'export {};\n' > "$dir/test/setup.ts"
  printf "import { vi } from 'vitest';\n%s\nvi.mock('../src/answer', () => ({ answer: () => 42 }));\n" \
    "$EFFECT_JS" > "$dir/test/alternate.ts"
  printf '%s\nexport function answer(): number {\n  return 42;\n}\n' "$EFFECT_JS" > "$dir/lib/answer.ts"
  base="$(setup_config "$dir")"
  plan_importing "$dir" "7-the-answer"
  linked=test/setup.ts
  case "$shape" in
    outside) wrong_answer "$dir"; rm "$dir/test/setup.ts"; ln -s "$outside/setup.ts" "$dir/test/setup.ts" ;;
    alternate) wrong_answer "$dir"; rm "$dir/test/setup.ts"; ln -s alternate.ts "$dir/test/setup.ts" ;;
    product) mkdir -p "$dir/src"; ln -s ../lib/answer.ts "$dir/src/answer.ts"; linked=src/answer.ts ;;
  esac
  commit_all "$dir" "feat: a link at $linked"
  refused_naming "a link at $linked ($shape) is refused" "$linked" "$dir" "$base"
  if [ "$shape" != outside ]; then :
  elif [ "$(cat "$outside/setup.ts")" = SYNTHETIC_OUTSIDE_ORIGINAL ]; then pass "a link out of the worktree writes nothing outside"
  else fail "a link out of the worktree writes nothing outside" "the file outside the worktree changed"; fi
  rm -rf "$dir" "$outside"
done

# What a branch may change runs only through the plan's tests' own imports: the
# plan's tests run under the runner's own configuration, with no setup, global
# setup or plugin, and the base's layout is never read (ORCH75 78SEC). Sol
# CF-05-FIX5 finding 2: a setup the base names under src/, which the head
# rewrote into a mock of the wrong answer, never runs.
dir="$(new_repo)"; wrong_answer "$dir"; printf 'export {};\n' > "$dir/src/setup.ts"
base="$(base_config "$dir" <<'TS'
export default { test: { setupFiles: ['./src/setup.ts'] } };
TS
)"
plan_importing "$dir" "7-the-answer"
printf "import { vi } from 'vitest';\n%s\n// %s\nvi.mock('./answer', () => ({ answer: () => 42 }));\n" \
  "$EFFECT_JS" "$MARKER" > "$dir/src/setup.ts"
commit_all "$dir" "feat: a mock in the setup under src"
never_ran "a setup the base names under src/, changed, never runs" "$dir" "$base"
rm -rf "$dir"

# The security review of 633f8a3 (medium): a base whose layout reaches src/
# through files a reader of configuration names misses. A project file named
# outside the configuration pattern, a shared module it re-exports, a setup
# outside src/ importing a helper under it, and a PostCSS configuration vite
# loads by name importing the same helper. The head rewrites the helper, whose
# effect is enough: a PostCSS configuration loads outside any test, where vi
# cannot be imported.
dir="$(new_repo)"; wrong_answer "$dir"; mkdir -p "$dir/test" "$dir/src/testing"
printf 'export {};\n' > "$dir/src/testing/helper.ts"
printf "import '../src/testing/helper';\n" > "$dir/test/setup.ts"
printf "import './src/testing/helper';\n\nexport default { plugins: [] };\n" > "$dir/postcss.config.ts"
printf "export default { test: { setupFiles: ['./test/setup.ts'] } };\n" > "$dir/vitest.shared.ts"
printf "export { default } from './vitest.shared';\n" > "$dir/vitest.unit.config.ts"
base="$(base_config "$dir" <<'TS'
export default { test: { projects: ['./vitest.unit.config.ts'] } };
TS
)"
plan_importing "$dir" "7-the-answer"
printf '%s\n// %s\nexport {};\n' "$EFFECT_JS" "$MARKER" > "$dir/src/testing/helper.ts"
commit_all "$dir" "feat: a helper the base's setup chain loads"
never_ran "a helper under src/ the base's setup chain loads, changed, never runs" "$dir" "$base"
rm -rf "$dir"

# The security review of 64400f0 (medium): a test file under src/ whose path
# holds the plan's directory, here under the plan file's own name. vitest read
# that directory as a filter on any path containing it, so this file ran
# unimported and rewrote src/answer.ts before the plan's test loaded it.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; wrong_answer "$dir"
mkdir -p "$dir/src/tests/acceptance/7-the-answer"
cat > "$dir/src/tests/acceptance/7-the-answer/answer.test.ts" <<TS
$EFFECT_JS
import { test } from 'vitest';

// $MARKER
writeFileSync(new URL('../../../answer.ts', import.meta.url), 'export const answer = () => 42;\n');
test('the answer is the one the ticket asked for', () => {});
TS
commit_all "$dir" "feat: the wrong answer, and a test under src/ that rewrites it"
never_ran "a test under src/ named like the plan's never runs" "$dir" \
  "$(git -C "$dir" rev-list --max-parents=0 HEAD)"
rm -rf "$dir"

# The security review of 633f8a3 (low): a base configuration that names src/
# for an alias, an include or coverage refused every code change, blamed on
# test setup. Nothing reads it now, so the right answer passes.
dir="$(new_repo)"
base="$(base_config "$dir" <<'TS'
import { resolve } from 'node:path';

// Keep fixtures out of src/.
export default {
  resolve: { alias: { '@': resolve(import.meta.dirname, './src') } },
  test: { include: ['src/**/*.test.ts', 'tests/**/*.test.ts'], coverage: { include: ['src'] } },
};
TS
)"
plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
run_saying "a base configuration naming src/ does not refuse a code change" 0 \
  "ran and passed at" "$dir" "Closes #7" "work" "$base"
rm -rf "$dir"

# What the rule lets through: the plan's own directory at the plan commit, and
# product source, here a package's src/ tree as ARCHITECTURE.md lays them out.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer" with packages/core/src/answer
mkdir -p "$dir/packages/core/src"
printf 'export function answer(): number {\n  return 42;\n}\n' > "$dir/packages/core/src/answer.ts"
commit_all "$dir" "feat: the answer, in a package"
run_saying "a change to a package's src/ tree is product source, and runs" 0 \
  "ran and passed at" "$dir" "Closes #7"
rm -rf "$dir"

# A test that loads missing code inside itself fails on the load, before any
# assertion: the shape the happy path used until Sol CF-05-FIX1. Not red.
dir="$(new_repo)"
mkdir -p "$dir/tests/acceptance/7-the-answer"
cat > "$dir/tests/acceptance/7-the-answer/answer.test.ts" <<'TS'
import { expect, test } from 'vitest';

test('the answer is the one the ticket asked for', async () => {
  const { answer } = await import('../../../src/answer');
  expect(answer()).toBe(42);
});
TS
criteria_doc with > "$dir/tests/acceptance/7-the-answer/plan.md"
commit_all "$dir" "test: the acceptance criteria"
build_answer "$dir" 42
run_saying "a missing import inside a test is not red at the plan commit" 1 \
  "no assertion failed" "$dir" "Closes #7"
rm -rf "$dir"
