# Plan: the label trigger and the size count, ticket 10

The plan artefact for issue 10. It sits inside the acceptance directory because
the first commit on the branch may touch only `tests/acceptance/<ticket>/`, and
the plan has to be in that first commit.

## Why

Two controls misbehaved in round five, and both misbehaved in the direction
that costs evidence rather than the direction that stops work.

`ci.yml` fires on `labeled` and `unlabeled` for every label name. The runner
applies `held` after a hold decision, so the act of recording that a pull
request has stopped starts a fresh run of the whole workflow on it: run
35526854303 on pull request 8, on a head nobody had pushed to. The trigger
exists for one reason, and the reason is that `scripts/pr-size.mjs` reads the
labels: a waiver applied after a red result must turn it green, and a waiver
removed after a green result must turn it red. No other job in the workflow
reads a label.

The obvious repair is the wrong one, and it was built and measured before this
plan was written. GitHub filters a `pull_request` trigger by action and never
by label name, so a guard on the first job is the only place a label name can
be read. On a throwaway draft, applying `held` to a guarded `ci.yml` created
run 35542012433 anyway, cancelled the real run 35541995564 that was still in
progress, and left all seven required contexts reporting `skipping` on the
head. GitHub reports a job skipped by a condition as a check run, and a skipped
required check is not a red one. So the guard does not stop a run, it destroys
the evidence of the run it replaces, and it hands any label the power to clear
a context. That is a bigger hole than the one it closes.

What is left is to take the label out of the heavy workflow altogether and give
the size gate its own, the way `review-evidence.yml` already owns the context
it reports. A label event then starts one short job that reports the true size
result, and nothing else in the repository wakes up.

`scripts/pr-size.mjs` reads `BASE_SHA` and `HEAD_SHA` from the environment and
takes no arguments, so there is no way to run the gate before pushing. Both
round five fix lanes counted their own commit instead of the pull request, and
pull request 8 reached 429 hand-written lines against the ceiling of 400 then,
with neither lane seeing it. The count is over the whole pull request against
`main`. A builder who cannot run it does not know it.

## Acceptance criteria

1. `.github/workflows/ci.yml` names neither `labeled` nor `unlabeled` in its
   `pull_request` types, so applying or removing `held` starts no run of it and
   cancels nothing that is running.
2. `.github/workflows/pr-size.yml` runs on `pull_request` with `labeled` and
   `unlabeled` among its types, so a waiver applied after a red result still
   turns it green and a waiver removed after a green one still turns it red.
3. One workflow reports one context: the job named `pull request size` is in
   `pr-size.yml` and `ci.yml` has no job of that name. Two workflows reporting
   one context is ticket 1's defect, where either one's stale run held the
   merge.
4. Fails closed: no job whose name is a required context in
   `.github/required-contexts.json` carries an `if:` reading
   `github.event.action` or `github.event.label`. A job a condition skips still
   reports its context, and a skipped required check is not a red one, so a
   guard by label name would let any label clear a result.
5. `node scripts/pr-size.mjs --base <ref> --head <ref>` runs with no CI
   environment set, resolves branch names as well as shas, and prints the same
   `hand-written N of 1000` line.
6. That run measures the whole range and not the last commit: a branch of
   three commits of 350 added lines each reports 1050 and exits 1, where the
   last commit alone is 350 and would pass.
7. `--base` or `--head` naming something that is not a commit in this
   repository exits non-zero and says which flag, rather than measuring an
   empty range and reporting zero hand-written lines.
8. The environment path is unchanged: `BASE_SHA` and `HEAD_SHA` with no
   arguments still measure the same range, because that is how the workflow
   invokes it.
9. `CONTRIBUTING.md` says the count is over the whole pull request against
   `main` rather than the last commit, and carries the command to run before
   every push.

## Build brief

Files: `.github/workflows/ci.yml`, the two label actions and the `pr-size` job
out of it, with the trigger comment made true; `.github/workflows/pr-size.yml`,
new, one job, the same action pin and the same two steps; `scripts/pr-size.mjs`,
argument parsing in front of the environment it already reads;
`CONTRIBUTING.md`, one sentence where the size rule is described;
`tests/ci/pr-size-cases.sh`, cases for the command line and for the trigger the
comment now describes.

Size estimate: under 140 hand-written lines.
