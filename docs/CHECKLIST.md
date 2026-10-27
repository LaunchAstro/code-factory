# Builder checklist

Before review, go through every section. For each guarantee the change
affects, put a real proof and its head in the pull request body or the
handback; for a section it does not affect, one line saying why. Sol checks
that call against the changed dependencies. "Not applicable" never stands in
for a missing proof. Every slice brief carries this file.

The sections are the classes of finding that reviews raise most often on a
production app. Races, data separation and tests that don't prove their claim
come up most.

"Tenant" below means the top-level owner of data (a business, an
organisation); "client" means a customer record inside a tenant; "person" means
one signed-in user. Rename them to match your product.

## Data separation

- Every read, list, export and restore filters by the caller's grant inside the
  query, not after it.
- The isolation test makes three real crossings and checks the status of each:
  another tenant; another client in the same tenant; another person, including
  one acting on someone else's behalf.
- A planted marker record read across a boundary never shows a foreign id,
  title or count in any response body, refusals included.
- Writes and clears check the record's own owner, not only a matching pointer.

## Tests that don't prove their claim

- Commit the test first. It fails for the right reason (not a missing import),
  then passes.
- Undo the fix: the test fails again.
- Test the real process, route or scanner, not a stand-in.
- Timeout, poll and retry tests use the code's own clock or a short,
  configurable timeout. Keep a long real wait only where the proof needs the
  real process or timer.
- A suite that didn't run is a NON-RUN, never a pass. Tell it apart from RED
  before acting on it ([Lane hygiene](#lane-hygiene)).

## Secrets and sign-in

- A planted credential marker never reaches logs, stderr, errors, traces or CI
  output, your own test's failure message included.
- Check first, then act: a refusal writes, fetches and returns nothing.
- Malformed keys, overrides and caller-supplied inputs are refused, never
  silently skipped.
- Signing out ends only that session. No network route reaches the host or a
  metadata service. Database connections use TLS.

## Races and timing

Races are the largest class. They cluster in four places: write authority,
read authority, the time read before the lock wait, and race tests run
through one connection.

- Every read-then-write names its lock. Test two transactions at once, and a
  crash or lost response at each step.
- Grants, delegations and expiry are checked again, under the lock, when the
  effect applies.
- Every write, expiry check and step-up check re-reads authority and the time
  inside the locked statement, after the lock wait: never a grant list from an
  earlier statement, a time read before the lock, or the transaction's start
  time.
- Race proofs use separate connections, never a one-connection pool, which runs
  them one after the other.

## Money

- Caps, currency, budgets and approvals are read under lock at decision time.
  A failed attempt applies nothing. Test two approvers at once.

## Permissions

- Every command checks the grant for its own collection and action. Fields the
  schema doesn't declare are refused.

## Guard and scanner bypasses

- Any checker gets hostile cases: odd quoting, nested markup, comments, tabs,
  case, encodings, symlinks, renames.
- Parse structured text with a real parser, not a line pattern.

## Web writes

Web findings cluster in three places: in-flight responses overwriting newer
edits, state kept across a business or person switch, and a retry minting a
new operation id.

- One operation id per user intent, made once and reused on every retry.
- Each response is tagged with its request and business, and dropped when it
  is stale.
- A business or person switch clears all per-business state.

## Docs match the code

- Docs, decision records and comments on what you changed say what the code now
  does. Nothing stale.

## Lane hygiene

These rules cover how a lane works, not what its change guarantees, so they
need no line in the pull request body.

- Read each check's real exit code. Never infer success through `grep`,
  `head`, `tail` or a pipeline, never hide the checked command's stderr, and
  never chain gates through `grep -c` or any stage that exits 1 on no match.
- NON-RUN is not green: see
  [Tests that don't prove their claim](#tests-that-dont-prove-their-claim).
- Deploy from a detached worktree pinned to a SHA, never from a shared
  checkout, and never copy `.env.local` into a deploy or staging copy.
- A read-only verifier never checks out, switches or resets the main checkout;
  it works in a detached worktree.
- Take migrations, deploys and other release work from the diff, never from
  the lane's description.
- Git: stage explicit paths, never `git commit -a` in a repo with live-state
  files; after `git mv` on an edited file, `git add` the new path; stage new
  files before any count that reads `git ls-files`; `git branch -d`, never
  `-D`, and skip a dirty tree.
- Never edit in a shared main checkout, not even a quick fix; work only in your
  own worktree. In a worktree session, Write and Edit only inside it; change
  files outside it (vault, session records, `~/.claude`) by Bash, never through
  the shared main checkout.
- A tool that removes worktrees or retires lanes reads the live-lane list first
  and refuses when it can't; an empty read is never proof that nothing is live.
  It also refuses while the staffing lock is held, and never removes a worktree
  younger than about 20 minutes.
- A list of approvals or exceptions fails loudly when its source is missing,
  never by coming back empty.
- Register every new probe or test with the runner that runs it.
