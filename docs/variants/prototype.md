# Prototype

For throwaway code that answers a question or shows an idea, on made-up or
public sample data, with nothing deployed and nothing kept as it is
([picking a variant](../METHOD.md#build-variants)). It trades review for
speed, so it starts only on the owner's yes.

## Never used for

- real client data or files, even read-only, even a copy;
- anything public, used by clients or shared between tenants;
- money, sign-in or permissions;
- deleting, moving or renaming real files;
- a deploy to production, or a switch turned on for real users;
- the first core of a product that will ship
  ([a first core goes slowly](../METHOD.md#building-on-main)).

A prototype that needs any of these stops and is promoted first (below).

## How it is built

1. **Its own repository.** A private repository for the prototype, or one
   the owner names as a prototype. Never a production repository's `main`.
2. **Any shape.** One agent or several lanes; stacked branches are allowed.
   Pull requests stay about 800 lines when they are used.
3. **No Sol.** No review of record, no director read, no merge script. The
   `build-review` and `single-agent` skills carry the Sol variants' review
   and merge rules, so a prototype lane follows this page instead.
4. **Merge straight to `main`** once the repository's own checks and both
   sweeps pass on the head: one committed check script (for example
   `scripts/check.sh`) that runs the tests and both sweeps over everything
   reachable from the head. The first commit goes to `main` directly. A
   stack merges bottom first, each piece directly; never queue a stack's
   children behind their parent (it failed on 20 October,
   private ticket #248).
5. **Record the start.** The first commit on `main` names the variant in its
   message (`Variant: prototype`), so a later promotion knows where unreviewed
   code begins.
6. **Description lines without pull requests.** A merge with no pull request
   carries `Why:` and `Left undone:` in its merge commit message; `Closes #n`
   only when a ticket exists.

## The safety floor

Prototype drops review, never these:

1. **Sweeps on every commit:** the secrets sweep (`gitleaks` or the repo's
   own) and the client-material sweep, as a pre-commit hook or before each
   push. A hit stops the commit; nothing is pushed around it. `git merge`
   skips the pre-commit hook, so a `pre-merge-commit` hook runs the same
   sweeps, and the pre-push hook sweeps every pushed commit. The hooks are
   committed in `hooks/` and switched on with
   `git config core.hooksPath hooks` in each clone. A repository
   with no client-material sweep gets one before its first commit; the
   model is raw-to-export's `scripts/sweep.py`, which refuses image, raw,
   video and catalog files by extension and by their first bytes.
2. **No client data in git:** made-up or public sample data only, and no
   client names, files or details in code, tests, commit messages or pull
   requests.
3. **No deletes without the owner's yes,** of anything outside the
   prototype's own repository and temp folders.
4. **The global safety rules:** no spend, no secrets printed or committed,
   no deploys outside daylight unless the owner is driving, stop after a
   step fails twice.
5. **The five checks the owner sees** ([Build variants](../METHOD.md#build-variants)).

## Promotion to production

A prototype is promoted only on the owner's yes, and before any real data
touches it. Promotion freezes the prototype: nothing lands on its `main`
from the pinned SHA until promotion ends, and the promoted head is that SHA
plus the reviewed fixes only (`git diff <pinned>..<promoted>` shows nothing
else).

- **Up to one area (about 4,000 lines):** pin one SHA, run
  [the review-debt method](../METHOD.md#review-debt) over the area from the
  `Variant: prototype` commit on (Sol reads it at one pinned SHA, findings are
  fixed and re-checked), add the production variant's live proofs, then
  every new pull request follows [production.md](production.md).
- **Larger:** rebuild it through [the route](../METHOD.md#before-the-build-plan-deep),
  with the prototype as the spec. Unreviewed code does not clear itself:
  when Code Factory deferred review in October, owed reviews grew from 325
  to 365 in a day with none cleared, and Slice One's 50 unreviewed merges
  left 456 root causes to find
  ([WHAT-WORKED.md](../WHAT-WORKED.md#review-rounds-and-reviewers)).

The promoted code moves to a production repository, or the prototype
repository becomes one, with its branch protection and merge script set up
first.
