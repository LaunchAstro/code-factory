# Acceptance plans and their tests

One directory per ticket, `tests/acceptance/<ticket>/`, holding `plan.md` and
the failing tests written from its acceptance criteria. The first commit on a
branch may touch only this directory, so the plan and its tests land before any
code. `scripts/acceptance-check.mjs` then refuses the pull request unless those
tests were red at that commit, are byte-identical at the head, and are green at
the head. The criteria list carries the standing criterion as one numbered
item beginning `Fails closed:`, which is all
`scripts/acceptance/standing-criterion.mjs` looks for: the words after the
label and the item's position in the list are the ticket's own.
`CONTRIBUTING.md` carries the full rule.

## What a branch may change

Both runs are refused, before anything at that commit runs, when the branch
changed a path outside product source and its own `tests/acceptance/<ticket>/`.
Product source is the root `src/` tree and each package's (`apps/<name>/src/`,
`packages/<name>/src/`), regular files only, and nothing under `__mocks__`.
Mocks, test helpers, a package manifest, a link or Markdown changed with the
code could make wrong code pass (a test or helper can load a file whatever its
extension, `.md` included), and vitest's configuration, setup files and a
PostCSS configuration go with them under one rule, so a pull request that
changes any of them with product code splits. The refusal names the paths;
`scripts/acceptance/run.mjs` has the list. A pull request that changes only
tooling, setup or configuration is refused too: this check has no route for
it, and the worked example below, which changed workflows and a script, would
be refused today. Split it from the code, or ask the owner to waive
acceptance, as the refusal says. A documentation-only pull request needs no
plan, and a link is never documentation, whatever its name.

Both runs use the runner's own vitest configuration, never the repository's:
no plugin, no setup file, no global setup, PostCSS given inline, and test files
from `tests/acceptance/<ticket>/` alone, so a test file under `src/` never runs.
They run the `*.test.ts` files there, the same files the check grades, so a
`.spec.ts` or `.test.js` file in the plan's directory never runs.
Nothing at that commit runs before the plan's tests do, so product source runs
only where those tests import it, and the base's layout is never read: a setup
file or helper under `src/` is product source the branch may change, and it
runs only if a plan's test imports it. The repository's aliases, test environment and
globals do not apply either, so a plan's tests import what they test by
relative path.

Tested code runs with only a short list of the caller's environment variables,
and with `HOME` and the XDG configuration directories in a fresh, empty
directory, so a credential stored in the caller's home is out of reach through
them. Nothing stops tested code reading a file by its absolute path. The
value of every other variable, whatever its length, is withheld from what the
check prints, failure messages included, unless it is one of the check's own
inputs or a shell's `HOME`, `CI`, `PWD`, `OLDPWD` or `SHLVL`. The check's own
Git reads get only what Git needs.

## The worked example

`10-label-trigger/` is kept as the one worked example of the shape: a plan that
states why, nine acceptance criteria with the standing criterion as item 4,
and `label-trigger.test.ts` written from them. Read it before writing a plan
of your own.

The verification-loop rehearsal that produced this template carried fourteen
more of these directories, one per trial ticket. They were left out because a
new project has no use for another project's tickets; `docs/rounds/` in the
Code Factory repository holds what they proved. Three comments under
`tests/ci/` and `scripts/` still name them by path as illustrations. They are
prose, not lookups, and nothing reads those paths.
