# Enqueue a READY pull request

The merge script, for any repository: point `--repo` at it. Where the base
branch has GitHub's merge queue (Ops Astro), it queues the pull request.
Where it has none (a private repository whose plan has no merge queue), it merges the
pull request itself behind the same gates plus Sol's approval
([With no merge queue](#with-no-merge-queue)).

An agent invokes one pass on the owner's existing `gh` credential, passing
the PR number and full head from its READY record:

```sh
node orchestration/enqueue.mjs --repo Example/project --pr 17 --head aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa [--pane w1:p3]
```

The command reads the PR's classic branch-protection checks and the effective
branch rules from GitHub. Every required context, including Sol's verdict,
must report success on the supplied commit. Names and source-app pins are
data; renaming a required check needs no command change. It reads paginated
check runs and combined commit statuses by that exact SHA, requires completed
`success` runs or `success` statuses, and refuses skipped or neutral results.
If a context has both a check run and a commit status, both must succeed.
Each app's newest run and each context's newest status supersede older
attempts. Optional failing checks do not block admission.

The command rechecks the PR's head, base, open/non-draft state, labels and
required list before the mutation. `hold`, `held` and `factory/held` labels
are recognised without regard to case. A moved head or changed required list
waits. GitHub's `enqueuePullRequest` mutation also receives `expectedHeadOid`,
so a head moved after the last read cannot be enqueued by this pass.
Already queued PRs produce no mutation, including on repeated invocations.

## The loading bay's gates

The owner made three description lines the price of the queue (15 October
2026, private ticket #154). Before
reading any check, the command needs three lines, each on its own line (a
leading `- ` is fine; Closes added at 11:45, #167):

```markdown
**Why:** the reasons for the choices in this code
**Left undone:** #12, LaunchAstro/work-map#40
Closes #7, closes LaunchAstro/work-map#8
Section: checks
```

`Left undone` is `none` or a comma-separated list of tickets (`#n`,
`owner/repo#n` or an issue link). Unfinished work becomes tickets; the code is
the truth. `Closes` uses GitHub's own keyword before every ticket, so GitHub
closes each on merge; one `Closes: none` line means the change finishes no
ticket. The description is read as GitHub renders it (`gh api markdown`, gfm), so code blocks (fenced or indented), HTML comments and inline code don't count, and a list continuation does (#169). A failed render waits with `gate=read-description`. Tests replay recorded renders from `tests/fixtures/rendered-descriptions.json`; `RECORD_MARKDOWN=1 REAL_GH=$(which gh)` records new ones. None of the
three waits with `gate=description reason=missing`; a duplicate, an empty or
placeholder reason (`...`, `<...>`, `TBD`, `TODO`) or prose in `Left undone`,
or a ticket in `Closes` without its keyword waits with `reason=malformed`.

**Section** (#203, owner 18 October 2026, private ticket #199):
the work map places a merged pull request by a `Section: <id>` line, the id
as the map reads it (lowercase letters, digits and hyphens, starting with a
letter), or `Section: outside` for work on no map. The grammar is strict and
every wrapper is paired: `Section: id`, `**Section:** id` or
`**Section: id**` (a list item is fine), the id in at most one pair of
backticks or, in the first two forms, one pair of bold markers, and at most
one full stop just inside or outside a closing bold. Any other line starting
`Section:` is malformed. Until 1 November 2026, 00:00 Sydney
time, a missing line prints `WARN gate=section reason=missing
required-from=2026-11-01` after the result and the pass carries on, so
pull requests opened before the rule still land; from then it waits with
`gate=section reason=missing`. A bad id or two different ids wait with
`reason=malformed` from the start. The same applies with and without a merge
queue. `ENQUEUE_NOW` pins the clock for the cases in
`tests/enqueue-section-cases.mjs`.

A drop is a `RemovedFromMergeQueueEvent` dated after the head commit's
committed date, so a new commit, rebase or merge of `main` starts the count
again. After one drop the command re-queues once and prints `REQUEUED`. After
two it waits with `gate=dropped reason=twice-at-head`: the PR is back with its
lane. A queued PR is left alone whatever its description says.

With `--pane <herdr pane id>`, either refusal sends the owning lane's pane
one line: the two-line template, or the drop and its last reason. It presses
Enter only once a new copy of the text (or a new paste marker) shows in the
pane and no dialog or option menu is up, and prints `NOTIFY pane=... sent` or `NOTIFY pane=... failed reason=...`
on the line after the `WAIT` line.

## With no merge queue

The PR's `isMergeQueueEnabled` decides the path, read again before the
mutation; a change between the reads waits with `gate=base`. With no queue:

- **The risk line.** The description carries a fourth line, `**Risk:** low`,
  `medium` or `high` with its reason (owner, 15 October 2026). None waits with
  `gate=risk reason=missing`; two, or no rank, waits with `reason=malformed`.
  Any edit to the description between the reads waits with `gate=description
  reason=changed-during-reads`; the next pass reads it whole.
- **Low risk skips Sol**, but only if no changed file (or renamed-from path)
  is one a low-risk change never touches: database migrations and SQL; CI,
  git hooks and deploy config; any file with "lock" in its name, Swift's
  `Package.resolved`, and the package manifests and
  toolchain pins of the JavaScript, Python, Rust, Go, Ruby, PHP, JVM, .NET,
  Dart, Swift and Nix ecosystems, plus Makefiles and task runners; env and secrets files; and sign-in, session, OAuth or middleware
  paths. The list is `NOT_LOW` in the script. One does: `gate=risk reason=not-low <path>`.
- **Every check on the head** must have finished without failing, required or
  not: `success`, `skipped` or `neutral` for each name's newest run, and
  `success` for each context's newest status. Required checks still bind as
  above. An empty required list is allowed, since Sol's verdict is the gate.
  One that hasn't passed waits with its own name as the gate, URL-encoded, and
  its state as the reason. This runs before the Sol step, so a newest
  `Sol verdict` status of `failure` waits as
  `gate=Sol%20verdict reason=failure`, at any risk, low included.
- **Medium and high risk need Sol's verdict** as a commit status on the exact
  head: context `Sol verdict` (any case, as GitHub matches it), `success` to approve, `failure` to refuse,
  which Sol sets after posting its review comment. GitHub binds a status to
  its commit and lets only people with write access set one, so the script
  parses no comments. None waits with `gate=sol reason=missing`; `pending`
  waits with `reason=pending`. Any `failure` or `error` on this head waits
  with `reason=changes-requested`; a later `success` on the same head does
  not clear it, a new head does.
- **The merge** is `PUT pulls/<n>/merge` with `sha=<head>`, so GitHub refuses
  it if the head moved. The method is a merge commit, else squash, else
  rebase, as the repository settings and any `pull_request` rule both allow.
  It prints `MERGED #17 head=... method=merge risk=medium`. A refused merge waits with
  `gate=merge`, exit 2, and is never retried.

The direct path tests are `tests/enqueue-direct-cases.mjs` and Sol's proofs from PR #181, `tests/enqueue-sol-proof-cases.mjs`.

## The work map hears of the merge

After `MERGED` (not on `ENQUEUED`: the queue merges later), the script asks
each local work map to Sync at once instead of at its next scheduled run
(#204, owner 18 October 2026, private ticket #197).
It kickstarts every loaded launchd job named `com.launchastro.live-roadmap.github`
or `com.launchastro.work-map.<name>.github`, without `-k`, so a Sync already
running is left alone, and prints `SYNC <label> started` or `SYNC <label>
failed` for each. No such job prints `SYNC skipped reason=no-map`; no
`launchctl` prints `SYNC skipped reason=launchctl-unavailable`.
`WORK_MAP_SYNC=0` turns it off. Nothing here changes the merge's exit code.
Cases: `tests/enqueue-sync-cases.mjs`, with a fake `launchctl`.

## Results

- Exit 0: `ENQUEUED #17 head=...`, `REQUEUED #17 head=... drops=1`,
  `ALREADY-QUEUED #17 head=...` or, with no queue, `MERGED #17 head=...
  method=... risk=...`.
- Exit 1: `WAIT gate=... reason=...` for a known refusal. Check names and
  reasons are percent encoded; a missing check names its required context.
- Exit 2: `WAIT gate=read-... reason=...` for failed, malformed or incomplete
  reads, or `gate=enqueue` for a failed or ambiguous mutation. It never retries
  a mutation automatically. Reconcile queue state before another invocation.

With a merge queue, an empty required list waits. Unreadable rules, partial pagination and labels
past the 100-label read limit wait. Each `gh` call has a 10-second timeout and
8 MiB output limit. Commit-status responses do not expose a source-app ID,
so app-pinned requirements need a matching check run; an unprovable legacy
status waits. These limits never convert missing evidence into success.

Labels, requirements and results are snapshots. The expected-head argument
guards head movement atomically; label changes are not an atomic condition of
GitHub's enqueue mutation. The orchestrator serialises hold and enqueue
decisions, and GitHub still owns final queue admission and required gates.
With a merge queue the command never merges; in no case does it enable
auto-merge, dequeue, jump the queue or rerun jobs, and it creates no loop or persistent state: the drop count is
read from GitHub each pass.

The owner superseded the next-round timing for this command on 14 October
2026, authorising enqueue-only use mid-round. The orchestrator keeps its
records check and watches the first hour; all required gates remain. See the
dated ruling and evidence limits (`2026-10-14-slow-burn/README.md`, a private round record).
The earlier adoption plan below remains the history of the original rollout,
not a claim that its prerequisites have passed:

Adopt only at the next round boundary, after Ops Astro #1606 and #1607 merge,
the required contexts are enabled and queue rehearsal passes. The orchestrator
owns that step; the current round's tools are untouched. The builder tests exclusively
through a fake `gh`; no real PR is enqueued during development:

```sh
node --test orchestration/tests/enqueue-cases.mjs orchestration/tests/enqueue-bay-cases.mjs
```

API contracts: [effective branch rules](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch),
[classic required checks](https://docs.github.com/en/graphql/reference/objects#branchprotectionrule),
and [enqueue input](https://docs.github.com/en/graphql/reference/input-objects#enqueuepullrequestinput).

## Sol effort is a launch setting

The same [risk-to-effort rule](../docs/SOL-EFFORT.md) applies in fleet and
single mode. The loading bay reads the exact-head Sol verdict; it does not
launch Sol and has no independent effort default. Launchers pin `medium` for
low/medium reviews and `high` for high-risk reviews, including fix passes.
