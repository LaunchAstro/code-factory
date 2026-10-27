# Lessons, September 2026

*A record of how the method got here, kept as evidence for [HISTORY.md](HISTORY.md#dropped-and-why). You don't need it to run a build; start at the [reading order](../README.md#where-to-start).*

The rules an early core build left in [METHOD.md](METHOD.md), one or two lines
each.

## The owner and the flow

- Agents have standing permission to answer routine questions, and log each
  call as `ORCH-DECISION`, so the build never waits on an answer an agent can give.
- Standing acceptance: a reviewed, passing result is the final yes, so
  protected parts don't wait for the owner.
- When the plan is too big to finish at the measured pace, finish the core,
  then recut the rest into slices and batches, one stage at a time.
- Agents never close an owner-chat pane, even when it logs DONE.

## Review

- Every finding comes with Sol's failing proof test, applied unchanged, so a
  fix closes what the reviewer meant.
- Every separation test names each boundary: business, client, person.
- Run the builder checklist before review; a green suite is not proof
  ([CHECKLIST.md](CHECKLIST.md)).
- Every Sol prompt carries the current ticket text.
- Use a real parser, not line patterns, for structured text such as Markdown.
- A review ceiling reached is a hold with the unread part recorded, never an
  approval.

## Merging and checks

- Keep the up-to-date rule and remove the churn: group merges, then one merge
  per batch.
- Keep `main` still while a chain merges.
- Prove every required check runs on the batch pull request route before the
  first batch.
- After the lower ticket of a stack merges, rebase onto `main` and rebuild
  derived files there.
- 400 lines is a guide, never a gate.
- Size checks measure moves as moves.
- Check review evidence once, at merge; a description edit runs only the
  evidence job.
- No extra work only for speed.

## The fleet and the machine

- Count working lanes, not open panes; floor of 6.
- Every brief says to carry on in the same turn; nudge a silent lane within
  10 minutes.
- Wait on events, one wait at a time, and act on everything pending after
  each wake.
- Stop only your own processes, by PID.
- Tests clean up after themselves, a suite fails if it leaves anything behind,
  and new worktrees pause under 20 GB free.
- Tests that change shared database state get their own cluster or an
  exclusive slot, and lanes drop what they create.
- Fewer, bigger lanes after the core.
- Wait for a pane to read `done` before closing it, then verify the wrap-up
  by file.

## Secrets

- Keep secrets in hidden fields. Rotate any token exposed in a transcript
  before copying that transcript.
