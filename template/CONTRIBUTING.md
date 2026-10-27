# Contributing

Outside contributions are closed. Once the repository is hosted, the settings
are meant to let only collaborators open issues and pull requests. The
publication checklist verifies that. Nothing here claims the hosted
restrictions exist yet.

## Follow the build loop

Code Factory's route in [AGENTS.md](AGENTS.md) is the sole router. Read
the [inventory](docs/INVENTORY.md) before you build, and name what you build on
in the pull request body.

1. Resolve open requirements and record the specification.
2. Confirm the seams and break the specification into reviewable tickets.
3. Implement one ticket in an isolated worktree and ticket branch. Write meaningful tests at the agreed boundaries.

   The plan commit carries `tests/acceptance/<ticket>/plan.md`. Its `## Acceptance criteria` list carries the standing criterion as one numbered item beginning `Fails closed:`, in the ticket's own words.

   - `scripts/acceptance/standing-criterion.mjs` checks for that item and nothing more. The words after the label are yours, and so is the position in the list: `10-label-trigger/plan.md` carries it as item 4 of 9.
   - The item must say that when any input, file, tool or service the change depends on is missing, malformed or errors, the change refuses or exits non-zero and says why, and never reports success on an unread input.
   - The reviewer of record may hold on it like any other criterion.
   - The acceptance check refuses a plan this pull request adds or changes without that item. It also refuses a pull request that changes anything outside the documentation and presets exemption and brings no plan at all.
   - The acceptance check runs the plan's tests only at a head that changed nothing but product source and the plan's own directory. [The acceptance README](tests/acceptance/README.md#what-a-branch-may-change) says what that is.

4. Review the actual revision against both the specification and repository standards. A frontier model from a different company than the builder's performs the adversarial review. That review is the review of record. The reviewer posts it as a review on the pull request, bound to the head it read, and it carries:

   - `Reviewer:`, `Model:`, `Head SHA:` and `Verdict:` (`approve` or `changes requested`), each line stated once;
   - its findings with `file:line`;
   - on a refusal, one thing more: a `Criterion: <n>` line naming the acceptance criterion in the plan that the code breaks.

   The reviewer holds on a criterion or it does not hold. Every other finding is a note, recorded and read later, and the pull request merges over it.

   `review evidence for this revision` reads the verdict off the review of record. It refuses a merge when:

   - any review of that head requests changes;
   - its head is not the head being merged;
   - its verdict is not one of the two values;
   - there is none.

   A `changes requested` with no criterion named is not a review of record, and the check says so. A later review does not clear an earlier refusal on the same head; a new head does.

   For an approval:

   - An approval carries no HTML comment (`<!--`, quoted or fenced included) and quotes no refusal. A review holding either can refuse but cannot approve.
   - A `Verdict:` that refuses anywhere in a review makes it a refusal. That includes a `Verdict:` in a list, table, fence or HTML block, a bold or tagged one, one that refuses in the word `reject`, `not approved` or a value that starts with `changes requested`, and a quoted key such as `"verdict":`.
   - An approval binds only to the commit GitHub recorded it on.

   The check reads a refusal as written:

   - Its lines may repeat or be marked up.
   - A `Criterion:` anywhere in it counts, fenced or commented included.
   - It holds the commit GitHub recorded it on as well as every head it names, wherever it was posted.

   For labels:

   - Every `Verdict:` on a line is read, not only the first.
   - A label with words before or after it, `Previous verdict`, `Verdict (final)` or `[Verdict](#v)`, reads as that label, on a line or heading a table column. So an approval carries no earlier verdict and no per-finding Verdict column or line, or it is a verdict the check cannot read. Write a finding's state as prose, not after a label.
   - Any other review with a line that opens on a `Verdict:` label, or a table column one heads, is never dropped either. Short of a clean approval, with each field on one plain line, once, it holds the commit GitHub recorded it on as a verdict the check cannot read.

   GitHub's renderer decides what Markdown shows, not this check, so a refusal in any reading wins. A review whose state or submission time GitHub would not send is refused as malformed evidence, naming the review, never skipped. Dismissed and pending reviews are passed over. The check reads the reviews and the head, and nothing else. Nothing in the pull request body counts.

   The commit comes before the review. `/code-review` reads
   `git diff <base>...HEAD`, which carries committed changes only, so a review
   run on an uncommitted tree reviews a tree that does not contain the work.
   Commit the complete ticket to the ticket branch, everything the ticket
   changes and not the easy part; note the head with `git rev-parse HEAD` on a
   clean worktree; review that head against the branch's merge base. A fix that
   comes out of the review or the checks is a new head, and it invalidates the
   review and the check run before it, so the head is noted again and the review
   runs again. The [review checkpoint](docs/agents/review-checkpoint.md) carries
   the reasoning and the rehearsal that demonstrated it. The rule lived in the
   vendored `implement` skill until the vendored skills became untouched
   upstream copies, so it lives here.

   When the owner decides to merge over a refusal, the owner dismisses that review with the reason. The check honours the dismissal and the pull request records it. An owner's override that leaves no trace is a bypass, not an override.

   The check has one gap while the reviewer posts from the builder's own account. The account that posted a review body can edit it, so a refusal edited into an approval is beyond what the check reads. The check raises the cost of a mistake, not of a deliberate edit. A reviewer identity that is not the author's closes that gap: add the reviewer's account to this repository as a collaborator, so its review posts from an account the builder cannot edit.

5. Decide. Nobody types evidence into the body and nobody reads what is there. The decide step merges on the contexts and the review of record: every required context green on the head, and a review of record on that same head saying `approve`.
6. Complete the final verify ticket against the integrated feature.

Small work starts at implementation. The first full loop must be rehearsed
on a throwaway feature before product code begins. The rehearsal includes
hosted checks, the decide step's merge on the counts, and a retained CI-checked verify
command. Local foundation checks do not complete that rehearsal.

The [review checkpoint](docs/agents/review-checkpoint.md) binds review to the
complete change. Authorised local foundation work with commits held uses the
actual files, diff, and manifest. It creates no commit or pull request.

## Required reviews and merge decision

There is no checklist here. Step 5 above is the whole of it. A pull request the
reviewer held arrives with its criterion findings for a decision.

This section used to hold seven questions, answered by hand before every merge.
Four of them were contexts already: the ticket's criteria are the acceptance
check, the checks are the checks, the size cap is the size gate, and the review
findings are the review of record's verdict on this head. Two asked for typed
evidence that no longer exists. The last asked which layer should have caught
each finding. That question belongs to the weekly structure review, which reads
the reviewer's recorded notes together, not one pull request at a time.

Security review runs before a pull request touching auth, tenancy, tool
execution, egress, custody, or the audit chain. The prompt puts the question to
the reviewer of record and hands it the sensitive files;
`scripts/sensitive-paths.mjs` is the list and the hosted job prints it. Use
`/security-review`, or
[the runtime-neutral procedure](.claude/skills/_shared/security-review.md), for
a pass by hand.

A conformance proof is a separate condition. For changes to the domain
model, tenancy wrapper, queue and delivery contracts, gate engine, credential
broker, egress control, sandbox launcher, or migration system, that
component's conformance test must be green **before merge**, as a required
check. No test, no merge, whatever the review says.

The sandbox also requires the owner's approval (`<OWNER-HANDLE>`) of its
**final contract before implementation**, after adversarial findings are
resolved. Model review does not replace either hold.

[The ruleset procedure](docs/plan/ruleset.md) defines the intended hosted
controls. Merge commits only, linear history off, squash off, rebase-merge off,
and no automatic merges. Nobody bypasses required checks or signatures.
Hosted enforcement remains unproven until tested with the actual credentials.

## Attribute and sign work

Every agent-assisted commit carries truthful `Assisted-by: LLM`,
`Agent-model:`, and `Agent-tool:` trailers. The session supplies the actual
model and tool. Every human-only commit carries that human's `Signed-off-by`.
Agents never create a human sign-off. See [AI policy](AI_POLICY.md).

All project commits require cryptographic signatures. The DCO app's intended
organisation-member exemption is separate from provenance requirements.
Outside contributors must personally certify the
[Developer Certificate of Origin](https://developercertificate.org/) and
complete the contributor agreement when contributions open. The CLA is
currently a draft and no signing service is active.

## Keep changes reviewable

The size checker allows up to 1,000 hand-written lines and warns from 800.
Hand-written means product lines: lines added to a file outside `tests/`.
Tests ride along with the code they prove, so their lines print and do not
count. A test file outside `tests/` counts as product. Two more things sit
outside the count:

- The plan commit. It lives under `tests/acceptance/`, and the planning session
  wrote it, not the builder whose pull request the gate measures.
- Deletions. A deletion is not the reading an addition is: a cut that halves a
  file leaves less to read, not more.

Every figure prints, the gating one and the rest, so a reviewer can see the
whole diff is larger than the number the gate enforced. The checker also
allows up to 40 changed files and warns from 30. Forty small files is forty
context switches, and the last one is the one nobody reads.

Either waiver needs a recorded reason: `size-waiver-mechanical` for mechanical
changes, `size-waiver-coherence` for a change that must be reviewed together.
Either one lifts the line total and the file count. The maintainer decides a
coherence waiver.

No single file outside `tests/acceptance/`, a test file included, carries more
than 400 added lines in a pull request. Split work names the invariant test
that proves the integrated result.

These limits are becoming inform-only (owner, 26 October 2026): over a limit,
the check names the limit and passes. Until the switch, the checker runs in
shadow mode. Today's blocking result still decides, and a line beside it,
`pr-size: SHADOW block=<0|1> inform=0 over=<limits|none>`, says what
inform-only would have done. `PR_SIZE_MODE=inform` runs inform-only now. Once
ten pull requests' SHADOW lines agree with their blocking results, the switch
makes `inform` the default. With git's default rename detection, a renamed
file counts as a move, not as new lines.

The count runs over the whole pull request against `main`,
not the last commit. A fix that is small by itself still takes the pull
request over the ceiling, so before every push run
`node scripts/pr-size.mjs --base origin/main --head HEAD`.

`dup:check` refuses:

- twelve identical lines of code in two files, or twice in one;
- two code files in one directory under `scripts/` whose names differ only by
  extension.

`deps:check` refuses:

- a declared package nothing uses;
- an import the workspace does not declare;
- a `pnpm-lock.yaml` that is missing or no longer records the specifier a
  manifest declares.

Using a package means running it: a name in a command position in a script, a
hook or a workflow, or a package resolved by an `extends`, `plugins`, `preset`
or `parser` key. Naming one on any other line is not use, and neither gate
reads a name out of an ignore file. `deps:check` compares the lockfile as git
holds it in the index, because pnpm rewrites the copy on disk before it runs a
script. Both gates read one list of what they skip, `scripts/tree-files.mjs`.
Every skip in it is a whole directory name: `dist/` is build output and
`redist/` is read.

Use synthetic fixtures. Retain third-party licences and attribution. Presets
are data only, as the [preset boundary](docs/licensing/preset-boundary.md)
defines. The [code of conduct](CODE_OF_CONDUCT.md) applies to everyone.
Report vulnerabilities through [Security](SECURITY.md).
