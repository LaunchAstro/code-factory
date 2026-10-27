# Review checkpoints

A review covers an identified set of bytes. The rule is that the review is
bound to the revision it read, and a later commit invalidates it.

That binding is now hosted, not typed. The reviewer posts its verdict as a
review on the pull request, GitHub records which commit it was posted against,
and `review evidence for this revision` refuses a merge unless a review of
record covers the head being merged. A fix pushes a new head, and the new head
needs its own review. Nobody pastes a block, nobody writes a count, and nothing
in the pull request body is read by that check.

The context appears on a head only after a review event on it: one workflow
reports it, `.github/workflows/review-evidence.yml`, triggered by a review
being submitted, edited or dismissed. Until then there is no check run for it,
and a required context with no run on the head blocks a merge just as a red one
does, so an unreviewed head is unmergeable by absence rather than by failure.

The preflight that printed a checkpoint block into the body is gone, along with
the typed `Code review:` and security lines and the step count. Round 1 of the
rehearsal passed a stale typed line on all twelve pull requests, and no rule
over English proved sound in both directions at once.

## Local foundation review while commits are held

The first local foundation review uses the actual proposed files and diff. It
must not create a project commit to satisfy a hosted rule.

1. Identify the source baseline and the exact proposed file set, including
   additions, deletions, and symlinks.
2. Retain a content manifest outside that file set.
3. Give the independent reviewer the actual files, full relevant diff,
   specification, and check results.
4. Record the manifest identity in the review. After fixes, regenerate the
   manifest, rerun affected checks, and obtain recheck.

The reviewed snapshot is a local candidate. It carries no new commit,
signature, hosted-check, or publication claim. A later small pull request does
not retroactively certify this initial candidate.

## Hosted evidence

The evidence is the reviewer's posted verdict on the head being merged, and the
acceptance check that proves the plan's tests were red before the code. The
ruleset and the check's existence must be verified on the hosted repository; a
local rule alone cannot enforce merging behaviour.
