# Skill watch

*A record of how the method got here, kept as evidence for [HISTORY.md](HISTORY.md#dropped-and-why). You don't need it to run a build; start at the [reading order](../README.md#where-to-start).*

The one list of skill and model changes still being proved. Each row says what changed, why, what "holding" looks like, and how the next review checks it. At each review, check every open row. Mark it **held** (with the evidence), **failed** (then a fix goes through a skill pass), or **applied** (for a finding that showed up again). Older proposals stay in [SKILL-PROPOSALS.md](SKILL-PROPOSALS.md).

To add a row, put it under a new checkpoint heading in the table that fits: a change to check, a repeat ready for the next pass, or a finding held until it shows again. Say the change in general words, why it was made, what holding looks like, and how a later review checks it. Evidence comes from the build's event log and from bench trials of the skills; cite it in the review that marks the row, not in the row.

## Checkpoint 1 October 2026

### Changes made: check they hold

| Change | Why | Holding looks like | How to check |
| --- | --- | --- | --- |
| New versions of `orchestrator`, `director`, `build-review` and `sub-agents` installed | Fill to the cap, fresh-only sub-agents, one sub-agents skill | No critical failure in real rounds; each still beats running with no skill | Re-run the frozen fleet trial on the bench and compare critical failures with and without the skills |
| `sub-agents` (drafted, **not installed**): fix a piece's known defect on its own branch before the join | A known defect is fixed before the piece joins | A bench re-test shows the error gone with no other case lost, and the change does not grow the skill much | Next pass: bundle it with the stop-at-deadline fix, one fresh review to a full pass, re-test twice, then the owner's yes |
| `team-onboarding` and its guide fixes | A skill pass on the onboarding guide | In real runs, old copies of third-party skills are removed only after the teammate agrees, and the secret hook reports a planted test value as refused | Each teammate's onboarding report |
| The smaller model runs only tightly scoped mechanical tasks with no decisions; the stronger model runs everything else | Keeps judgement work on the stronger model | No smaller-model lane makes a judgement call (review, route choice, planning) | Boot lines (`model=`) against each lane's brief |
| **Owner-directed**: `orchestrator`, `sub-agents` and `claude-subscription-switch` carry the model split, the stronger model at high effort by default and the smaller one at high effort for a mechanical job with no product-code decision | Each dispatch names its model. Owner-directed, so no bench and no evidence-over-time wait | The smaller model appears only on mechanical lanes and sub-agents; a quality slip moves that kind back to the stronger model | `model=` on DISPATCHED and BOOTED lines against each lane's brief, as the row above |
| Codex kept for Sol; no other Codex runs unless the owner asks | Keeps review capacity for Sol | The Sol-owed queue clears | The round's Sol-owed ledger |
| Lighter boot, by role | Fewer boot tokens | Median boot tokens down at least 15 percent, with no more misses or re-asks | The trial's pass rule; `BOOT-LIGHT TRIAL` lines |
| Slice leads load `resolving-merge-conflicts` when a merge stops on a conflict | Conflicts are resolved with the skill, not by hand | Leads load it at conflicts; conflict fixes are no worse | Sessions that hit a conflict and loaded it, out of all that hit one |

### Repeats on the bench: ready for the next pass

| Skill | Why | Proposed line | Status |
| --- | --- | --- | --- |
| `sub-agents` briefs.md, ending one | A deadline is never a reason to stop a running sub-agent or remove its container | "A slow sub-agent is waited on or asked for status; a deadline is never a reason to stop it before your wrap or handover." Also say what a lane does with a running sub-agent when its own wall arrives | Goes in the next pass on the owner's yes; a real-lane sighting also counts |

### Findings held: apply only if seen again

Each waits for a second sighting. A skill changes when the same problem shows twice on different dates. If a real lane shows it, apply the line through a skill pass and mark the row **applied**.

| Skill | Why | Proposed line | How to spot it in a real round |
| --- | --- | --- | --- |
| `orchestrator` tick.md step 7 | A seat's usage stop outranks seat order | "Before each dispatch, read each seat's 5h and 7d; a seat past its stop is skipped, whatever seat order the owner set." | A DISPATCHED line whose seat read was at or past its stop |
| `orchestrator` tick.md step 7 | Only working panes count as lanes | "Count as lanes only panes that are `working`; `done` panes go to close-out first, which frees their slots." | A fill report or LOW FILL note that counts `done` panes |
| `orchestrator` brief.md dispatch step 3 | A multi-line brief goes through the send script, and a dispatch counts only after its BOOTED reply | "Deliver every boot line with `$S/send.sh`, never raw `herdr send-text`; report a lane dispatched only after its BOOTED reply." | A DISPATCHED line with no `-BOOTED` reply after it, or a lane re-sent its brief |

### Seen in the build: director feedback on the skills

None is applied yet. Each needs a skill pass, or a METHOD change on the owner's yes.

| Area | Why | Candidate | Next check |
| --- | --- | --- | --- |
| `orchestrator` / `director` `kick.sh`: handover point | The watchdog fires later than the handover point, so a handover must not wait for a kick | A `kick.sh` line at the handover point for the orchestrator and leads, or the orchestrator checks its own gauge each tick | Count the handovers that self-trigger |
| Lighter boot: events read | A recent-events read must keep open questions, and the missed-items script needs a baseline that can score the trial | Keep unanswered ASK lines whatever their age. Give the script a better baseline | The next orchestrator checks |
| Merge path | A merge train runs checks one draft at a time | Run checks in parallel for every ready pull request and keep only the final re-run after `main` moves serial; consider GitHub's merge queue (no spend). METHOD's merge wording follows what lands | The orchestrator's answer |
| `build-review`: review scope | A whole-range read can find problems that per-piece reviews pass | A range-wide review step before `main` | How many blocking findings the fix lanes close; whether a range review at batch end catches them earlier |
| Security review convergence | Patching a repeat finding in one path can raise new races in it | After a repeat blocking finding in the same path, write a two-line simpler design instead of patching, then freeze the head and file minors as follow-ups. Candidate for METHOD | Rounds per sensitive pull request after the rule |
| Fresh sub-agents | A baseline is needed: pieces an hour, blocking findings per piece, fix rounds per piece | Baseline for `sub-agents` | Same measures on the next build day |
| `director` `deliver.sh` | A delivery queued to a working pane must not read as a failure | Read the queued-message probe correctly | Next director tooling pass |

## Checkpoint 4 October 2026

### Owner-directed process rules: check they hold

Owner rulings, made the method in [METHOD.md](METHOD.md). These are build rules, not skill text. None waited for evidence over time; each row stays open so a later review can still catch a rule that does not hold. The testing and CI rows are explained check by check in [CI-CHECKS.md](CI-CHECKS.md).

| Change | Why | Holding looks like | How to check |
| --- | --- | --- | --- |
| **Owner-directed** (METHOD [review rounds](METHOD.md#review-rounds)). Write and review together. Sol reviews every new piece before it merges. Sol rounds per pull request are capped, every project alike, and the last round is the last fix round (since lowered to two, row below). A blocking finding is fixed before merge, never carried; only major and minor findings still open after the last round go to the catalogue, and the pull request merges on Sol's approval of its exact head or of the change since an approved head | Rounds match what the findings warrant | No new piece merges without at least Sol's round 1. No pull request goes past the cap. Carried findings are written down (follow-up rows, Sol-owed rows, catalogue issues) and later closed. The hard gate is unchanged, so every owed finding still clears before Stage 2 and before any real client. Defects found after landing do not rise | Per pull request, count Sol round ids (`-R1` onwards plus `-FIX` heads) in `SOL-LEAD RESULT` lines. A round past the cap is **failed**. Decide whether coverage-only reads count as rounds. Count carried findings and how many closed. For each new piece's `MERGED` line, find a `SOL-LEAD RESULT` on that pull request before it |
| **Owner-directed** (METHOD [Fixes stay small](METHOD.md#fixes-stay-small)). Lean fixes. One proof test per finding, no duplicate suites around it. Timing-only cases (races, delays) are grouped by root cause into fewer, smaller pull requests. Fixes stay in full where they touch money, permissions, sign-in or data separation. One cut-back pass over what Sol fixes added. Finish before starting (a director's line, not in METHOD): while open pull requests outnumber merges, a lane lands its open ones before opening a new one | A fix adds only the code its finding needs | The Sol-fix additions stop growing. No duplicate guard or suite appears in new fix pull requests. Money, permission, sign-in and data-separation fixes are not trimmed. Open pull requests do not outnumber merges for long. A cut never removes the only case that catches a break | Count lines added by fix pull requests since the cut-back pass. Count pull requests per root-cause cluster. Compare open pull requests with merges per day. Read each trim pass's security review, since a trim can remove the only case that catches a break |
| **Owner-directed** (METHOD [review rounds](METHOD.md#review-rounds)). Sweeps by area and narrow re-checks. A fix re-check reads only the fix's diff and the findings it closes. One Sol sweep of `main` in chunks of about 2 to 4k lines, each chunk a whole area. Skip an area Sol already reviewed that has not changed. No old draft branches; their code reaches `main` through port pull requests, which Sol reviews as they land. Output is one issue per root cause, ranked, with no full proof tests (the fixer writes one). Codex stops at its set cap | Big area chunks find the main problems in one pass, so fix lanes stop iterating | Later reviews of swept areas find few new blocking items. Chunk heads are close to `main` when results land. Round 2 prompts name a range, not the whole head | Count `SWEEP-RESULT` lines and `sol-sweep` issues. For swept areas, count blocking findings from later reviews. Check two risks, that big chunks read shallower and that `main` moves while ports land, by comparing a chunk's pinned head with `main` at result time. Sample round 2 `FOR-SOL` lines: each names its range (`<old>..<new>`) and the findings it closes; a re-check that reads the whole head is **failed** |
| **Owner-directed** (METHOD [review rounds](METHOD.md#review-rounds)). The issue catalogue, one per product repo. One GitHub issue per root cause, label `catalogue` plus one of `severity:blocking`, `severity:major`, `severity:minor`. Before writing up a finding, search the catalogue. A repeat adds one `Seen again:` comment line, never a new write-up or proof. Lanes take issues top down by rank, one at a time, one Sol check per fix, `Closes #n` in the pull request. The Sol-owed ledger stays the merge gate and each row names its issue (`catalogue=#n`) | One list of root causes to work through, instead of findings repeated across reviews | New findings land as comments on existing issues more often than as new issues. Titles do not repeat a root cause. Blocking issues close before major, major before minor. Every Sol-owed row has its issue number | Count `Seen again:` comments against new issues since setup (a catalogue that only grows by new issues is not deduplicating), sample titles for repeats, and watch closes by rank |
| **Owner-directed** (METHOD [Where the full tests run](METHOD.md#where-the-full-tests-run)). Pull requests run the light checks, and the full test set runs only in the merge queue, which stays `main`'s gate. Superseded pull request runs cancel. Slow optional jobs (such as a database look-ahead) run nightly, never on the merge path. No test is dropped to go faster: a CI change proves the same named-suite count and test totals. The required check names still report on every pull request so the queue accepts it | Faster merges with nothing reaching `main` untested ([CI-CHECKS.md](CI-CHECKS.md)) | Nothing reaches `main` untested, because the queue is the only gate. Merges per hour go up and CI minutes per merge go down. Queue groups do not turn red more often, since a defect first seen in the queue drops a whole group. Real catches still appear, now in the queue. No CI pull request lowers the named-suite count or the test totals | After the CI change has run on several queue groups, re-run the CI audit's method and compare with the [CI-CHECKS.md](CI-CHECKS.md) tables. Count merge-group failures on a required check before and after. Each CI pull request body carries before and after suite counts and test totals; no merge-group job runs the look-ahead |
| **Owner-directed** (METHOD [Where the full tests run](METHOD.md#where-the-full-tests-run)). No self-hosted runner on a public repo, and no paid runner. Speed comes from free CI changes | On a public repo an outside pull request's edited workflow can name `runs-on: self-hosted` and run on that machine. Check merge-queue availability before changing a repository's visibility | No self-hosted runner is registered on any public repo. No workflow names `self-hosted`. Nothing bought | `gh api repos/<owner>/<repo>/actions/runners --jq .total_count` for each public repo, and a grep of `.github/workflows` for `self-hosted`. METHOD's local runner wording names private repos only. Fork pull request workflows require approval for all outside collaborators |
| **Owner-directed** (METHOD [Seats, lanes and stops](METHOD.md#seats-lanes-and-stops)). Disk floor. Sol starts no run below a free-space floor (`sol/DISKMIN`, 31G normal) and stops below 25G (`sol/STOP`). Free space is read after local snapshots are accounted for, because a deleted file frees nothing while a snapshot holds its blocks | A full disk stops every lane's tests | Free space stays above the floor while Sol runs. `DISK-WAIT` is rare and `DISK-STOP` never fires. After a cleanup, free space moves when it should | `RUN-START` lines carry `df=<n>G`. Count `DISK-WAIT` and `DISK-STOP` lines per day. After any cleanup, list local snapshots before trusting `df`. Deleting a snapshot needs the owner's yes |
| **Owner-directed** (METHOD [Seats, lanes and stops](METHOD.md#seats-lanes-and-stops)). Sol concurrency by disk and load. `sol/CAP` is the number of Sol runs at once, set from measured disk, load and memory, not from the number of queued heads | The machine's state sets how many runs it can carry | The cap tracks the machine. No test times out because of Sol load. The wait queue drains | Every `sol/CAP` change line carries its load, memory and disk readings. Settle which load average the guard reads. Log load hourly on both machines and compare it with slot count. Count browser-capture timeouts per hour against open slots |
| **Owner-directed** (METHOD [Seats, lanes and stops](METHOD.md#seats-lanes-and-stops)). Heavy runs on the check machine. Local full checks, test databases, browser captures and gate sweeps run on the check machine. A lane keeps at most one test process on the owner's machine, focused tests only | Heavy runs on the owner's machine overload it | The owner's machine stays responsive while lanes run. The check machine carries the heavy runs. No lane runs two test processes on the owner's machine at once | Log load hourly on both machines (the row above asks for the same log). `machine=` on dispatch lines and the check machine's run logs show where full checks ran. A full check on the owner's machine, or a lane with two test processes in `ps`, is **failed** |

A row is marked **held** once two reviews a few days apart show it with evidence. A row that fails goes back to the owner with the numbers, and its METHOD.md text with it.

## Proposals, 5 October 2026

Skill changes that follow the slow-method rules. Each stays a proposal until evidence over time and a grilling; nothing here is installed.

| Skill | Why | Proposed change | Status |
| --- | --- | --- | --- |
| `code-factory` SKILL.md rules 2 and 3 | Both still split fast pieces into sensitive and everything else, and let everything else merge on green checks with Sol after landing. METHOD makes slow the default, with Sol's approval before every merge ([Build variants](METHOD.md#build-variants), [review rounds](METHOD.md#review-rounds)) | Rules 2 and 3 follow METHOD: every piece merges on Sol's approval of its exact head, a narrow re-check of the change since an approved head, or a carried approval | Proposal. Waits for evidence over time and a grilling, then a skill pass |

## Checkpoint 5 October 2026

### Evidence rows for a later proposal

Method changes that touch a skill. Each row is **evidence for a later proposal**, not a proposal: no skill text changed, and none will until the evidence has held over time and been grilled.

| Change | Skill text it touches | Holding looks like | Re-check at the next review |
| --- | --- | --- | --- |
| The orchestrator hands over at 50 percent, with its boot file prepared from about 42 | `director` SKILL.md step 7 already says 50 for both | Orchestrators hold the seat longer and hand over near 50 percent | Minutes per orchestrator and context at hand-over for the next five |
| Sol audits only; a fresh Opus writes and runs each proof | `build-review` REVIEWER.md (Sol writes and runs the proof) and SKILL.md step 6 (apply each Sol proof unchanged) | Fewer review tokens, and Sol's findings still reproduce | After a set of sensitive runs: tokens, findings not reproduced, later rounds |
| Small codebases: two rounds, minors to one tidy pass, proofs only for blocking findings | `build-review` SKILL.md step 6 (round count); REVIEWER.md (a proof for every finding) | Fewer rounds per pull request, with no minor that turns out to matter | Rounds per pull request; tidy-list length; any minor that turned out to matter |
| Plain-test severity in every Sol prompt (`sol/severity-rule.txt`) | `build-review` REVIEWER.md and ALWAYS-BLOCKS.md carry no severity rule | Blocking is kept for real blocking findings | Blocking share of new catalogue issues; a minor or major later found to be blocking |
| Connections to the check machine are serialised, and lanes read one shared load figure | No skill names the check machine; `orchestrator` and `sub-agents` briefs send heavy runs there | No refused connections, and runs do not queue long | Refusal lines per day; runs queued past the cap |
| Overflow slots on the owner's machine | As above | Overflow runs used without overloading the owner's machine | Overflow runs per day; the owner's machine load while a slot is held |
| A pane reaper inside the director's regular kick | `director` WATCH.md item 6 leaves wrapped panes to the orchestrator | Wrapped panes close, and none closes in error | Panes closed and nudged per run; any pane closed in error |
| Owner steps batched with click paths; staging handed to an agent | `director` and `orchestrator` owner-facing steps | The owner gets one batch of steps, each with its click path, and agents finish the staging sittings | Owner steps outstanding at each morning page; staging sittings an agent finished |

A proposal only:

| Skill | Why | Proposed change | Status |
| --- | --- | --- | --- |
| `director` WATCH.md | The reaper runs from the kicker, outside the skill; WATCH.md item 6 still has the orchestrator close wrapped panes | WATCH.md runs the reaper each fill check | Proposal; waits for evidence over time and a grilling |

Proposals only:

| Skill | Why | Proposed change | Status |
| --- | --- | --- | --- |
| `director` WATCH.md "Start the kicker" | Watchdog startup and PID tracking must be part of the handover procedure | Start the watchdog loop with the kicker; the boot line reads `kicker PID <pid>, watchdog PID <pid>, ...`. The loop outlives the director, so a successor checks `ps -p` before starting another | Proposal; waits for evidence over time and a grilling |
| `director` WATCH.md items 2 and 7 | Item 2 asks the orchestrator to merge or name what holds each CLEAN pull request, which lets an approved pull request sit outside the queue. Item 7 waits 60 minutes; the watchdog's stall check uses 45 | Item 2: an approved pull request not in the merge queue is a finding at every check. Item 7: 45 minutes, matching the watchdog | Proposal; waits for evidence over time and a grilling |
| `director` HANDOVER.md steps 1 and 4 | A watchdog must outlive its starter; handover must not close active orchestrators | The boot file's "Where it stands" names the watchdog PID, and step 4 leaves that loop running. Never close an orchestrator pane that has not logged a hand-over from itself | Proposal; waits for evidence over time and a grilling |

## Checkpoint 12 October 2026

The review-debt method and the cross-model rule went into [METHOD.md](METHOD.md#review-debt). Five speed changes were ruled into METHOD; the first table checks they hold. Every other lesson is a row below. No skill text changed.

### Owner-directed speed changes: check they hold

Owner-ruled, so none waited for evidence over time. Each row stays open so a later review can still catch a rule that does not hold.

| Change | Why | Holding looks like | How to check |
| --- | --- | --- | --- |
| Race attack before READY ([METHOD](METHOD.md#what-review-always-covers)) | Races are the largest finding class ([CHECKLIST.md](CHECKLIST.md#races-and-timing)) | Every fix or package READY line carries `race=<found>/<fixed>` from a fresh sub-agent; fewer Sol round-1 race findings | Ready lines without `race=`; Sol round-1 findings in "Races and timing" and "Web writes", per pull request, before and after the rule |
| Design first for locks, authority, retries and reconcile; two Sol rounds; a round-2 red splits ([METHOD](METHOD.md#review-rounds)) | Replaces the three-round cap (row above) | No third Sol round. A round-2 red in own code becomes a package issue with a removal-only Sol check; only money, sensitive or no clean split reaches the director. One Sol design check per design | Third-round `SOL-PR` dispatches; `DIRECTOR-ANSWER` lines for round-2 reds that split cleanly; designs with more than one Sol check |
| Every CI job in about 10 minutes ([METHOD](METHOD.md#where-the-full-tests-run)) | Slow merge-group jobs set the merge pace ([CI-CHECKS.md](CI-CHECKS.md#how-ci-runs)) | Each job's median about 10 minutes or under; the same named-suite count and test totals before and after; database conformance still required | `gh run view --json jobs` medians on merge-group runs; the pull request's before-and-after counts |
| Queue hygiene: no push-to-main full run when the group tested the tree; pull request CI only next in line; width = runner slots / jobs per group ([METHOD](METHOD.md#where-the-full-tests-run)) | Runner contention can hold the queue head ([CI-CHECKS.md](CI-CHECKS.md#how-ci-runs)) | `main` runs the full set once per empty queue; no merge group waits for runners while pull request runs not next in line hold them; a lane whose run is cancelled is told | Push-to-main CI runs while the queue is non-empty; merge-group runs queued over 10 minutes; lane ASKs about a cancelled run |
| Sol's slots: pull request rounds first, one at-capacity retry after 3 minutes, containers removed on verdict ([METHOD](METHOD.md#seats-lanes-and-stops)) | An at-capacity refusal leaves a run with no verdict, and Sol's containers and worktrees use disk on every review | No pull request waits for Sol while a design check or second-reviewer run holds a slot; no `sol-*` container outlives its verdict | The Sol slot log against waiting pull requests; `docker ps -a --filter name=sol-` after each run; free disk on the hourly check |

### Repeats: ready for the next pass

Each was also seen on an earlier date. A skill pass, or the owner's yes for a METHOD line, applies it.

| Skill | Why | Proposed line | Status |
| --- | --- | --- | --- |
| `build-review` SKILL.md step 6; `orchestrator` round grants | A fix that answers only the last finding keeps a pull request past round two on one narrow check. See the security convergence row above | "After round 2 on the same path, change the approach: find the root cause, redesign, or cut the part out of the pull request. Never write another patch." Also: a round past METHOD's cap is **failed** | Repeat. The owner ruled the cap and split into METHOD (row above). The skill wording follows in the next pass |
| `orchestrator` merge steps; Code Factory `orchestration/` | A pull request stuck at the queue head stalls merges, and merge scripts copied per orchestrator multiply unreviewed. See also the proposals of 5 October | One tested merge tool under `orchestration/`: enqueue when CLEAN at the reviewed head, dequeue a head stuck 5 minutes and re-enqueue once, re-run a known flake once, log the merge rate. The skill then points at the tool instead of describing the steps | Repeat. The skill line follows once the tool has run a full day |
| `orchestrator` CI and label steps | A label or description edit can start CI. A closed pull request runs its own old workflow file, so a guard in the current workflow does not cover it | "Before mass label or body edits, check which workflows the event starts. On closed pull requests the guard must live outside the old workflow file, or the edits go in a window with those workflows off." | Repeat. Next pass |
| `orchestrator` fill step; `sub-agents` | Sub-agent fan-out can overload one machine while the other sits idle | "Read both machines' load before each sub-agent cap or fill. Sub-agents count in the load of the machine they run on. Send new pieces to the lighter machine." Also: one test run at a time per lane on the check machine, as METHOD already asks on the owner's machine | Repeat. Next pass, with the heavy-runs row above |
| Product test harness (no skill) | Tests must release containers and networks they create | "A suite that leaves a container or network behind fails." Make it a check | Repeat. Owed to the product, then the regular litter check confirms it |
| `sub-agents` briefs | Sub-agent briefs must carry the PID-only stopping rule | "Every sub-agent brief links METHOD's rule to [stop only what you started](METHOD.md#seats-lanes-and-stops)." | Repeat. Next pass |
| `orchestrator` tick, lane watch | Monitor all working lanes on both machines for inactivity | "Each tick lists working lanes on both machines with no event for 30 minutes, and nudges them." | Repeat. Next pass |
| `build-review` before READY | A pull request's own criteria and existing proofs run before READY, so Sol's round 1 is not the first run | "Before READY, run the pull request's own criteria and any proofs already on the issue against your head." | Repeat. Next pass, with the checklist |
| `orchestrator` round tools; `director` HANDOVER.md | Round tools must survive the sessions that start them | "Long-lived round tools run as their own process, with their PID in the state note, never inside a pane; a hand-over leaves them running." | Repeat. Next pass, with the 5 October watchdog rows |

### Findings held: apply only if seen again

First sightings. A skill changes when the same problem shows twice on different dates.

| Skill | Why | Proposed line | How to spot it in a real round |
| --- | --- | --- | --- |
| `orchestrator` Sol runs | A quiet Sol log is not a dead run, and a re-run on a live one gives one head two round-1 sessions | "Check the Sol process by its worktree path before a re-run; a quiet log is not a dead run." | Two Sol comments on one head from one dispatch |
| `orchestrator` Sol and second-reviewer scheduling | A Sol run that ends "Selected model is at capacity" has no verdict | "Retry an at-capacity Sol run once after 3 minutes; second-reviewer runs only where Sol's pull request rounds have room." Now in METHOD (row above); the skill line still waits for a pass | `at capacity` lines per day |
| Product push gate (no skill) | A pre-push gate's Git timeout under load must not read as an unreadable approval | "A gate that times out says so and fails closed; the lane retries at lower load and never bypasses." | Push refusals that pass on retry |
| Production writes (no skill) | A CLI's config push can run without a prompt when it detects an agent, and pick up the wrong config file | "Production configuration is written only from an explicit file named in the command, with `--agent no`, after a read-only diff." | Any production config write without a named file |
| Monitoring scripts (no skill) | Verify API-version compatibility before creating monitoring checks | "Choose the API version supported by the configured account." | A refused create call is reported without exposing account configuration |
| `orchestrator` brief.md, browser lanes; `claude-subscription-switch` | A browser lane launched on a seat token has its browser tools refused. METHOD already has the rule ([Seats, lanes and stops](METHOD.md#seats-lanes-and-stops)) | "A browser lane's dispatch follows METHOD's [browser-lane rule](METHOD.md#seats-lanes-and-stops) (seat token and config folder unset), then checks `/chrome` reads Enabled before sending the brief." | A browser lane BLOCKER naming Chrome tools |
| `orchestrator` review-evidence steps | The review-deferral line is the owed-review marker the required review-evidence check reads | "The review-deferral line is a gate input. Read the check before editing it; only the orchestrator changes it." | A body edit to the deferral line followed by a red review-evidence check |
| `orchestrator` hold handling | A reduced pull request red only in code identical to `main`, or in scope moved out, merges on green with a decision comment and the proof filed on the follow-up; a hold only when a red touches code it still changes. A director's standing rule, not an owner ruling | "Before holding a red, diff each flagged file against `main`. A red only in `main`-identical or moved-out code is filed as an issue with its proof, and the pull request merges on green." | A hold or `DIRECTOR-ANSWER` on a red whose files are blob-equal to `main` |
| `orchestrator` and `director` send scripts | A pane's own text or its tip line can hold a dialog's words | "Match a dialog only in the pane's bottom lines, never in its scrollback or tip line." | A send that stops on a dialog the pane is not showing |
| `orchestrator` package planning | A package that waits on open, often stacked, pull requests still in Sol rounds or the queue stays parked | "Prefer unstacked pieces. A package that must wait on an open pull request names it, and the orchestrator moves that pull request first." | `PARKED` lines that name open pull requests as the only wait |
| `build-review` queue failures | A new or flaky test can pass on pull request CI and time out in a merge group on loaded runners, jamming the queue head | "On the first merge-group timeout, the lane raises the test's timeout or fixes its wait at once; it never waits for a second jam." | A second `qjam` on the same test |
| `orchestrator` hourly check | First-pass clean is a METHOD [quality target](METHOD.md#quality-targets), and needs a logged check | "Each hourly check logs Sol's first-pass approval rate, numerator and denominator, against the 30 percent target." | An hourly check line without the rate |
| Code Factory merge tool (no skill) | A parked merge tool needs a restart point | Restart from the parked design and Sol's findings on it, not from the parked code | The next Code Factory batch starts it, or the next review asks why not |

## Checkpoint 13 October 2026

### Done means switched on: check it holds

| Change | Why | Holding looks like | How to check |
| --- | --- | --- | --- |
| **Owner-directed**: done means switched on ([METHOD](METHOD.md#done-means-switched-on)). Every unit and ticket names its switch-on step; merged but off is owed, not done; switch-on lanes run beside build lanes; the director's hourly check lists what is built but off, with its age. The behaviour lives in the installed `orchestrator` and `director` skills, so their wording follows in the next skill pass | More of a plan can be coded than live; the gap is switching on, not code. Owner-directed, so no evidence-over-time wait | The director's hourly line carries the switched-off list, and the coded-versus-live gap shrinks | Hourly director lines without the list; units and tickets with no switch-on step; the gap at the next completion audit |

## Checkpoint 14 October 2026

These rows record instructions and checks still owed, not completed outcomes. No skill text changed. Owner-directed METHOD rules take effect on the ruling; skill promotion still needs evidence on different dates, a grilling and a skill pass. No finding below is promoted or applied from same-day evidence.

### Owner-directed round rules: check they hold

| Change | Why | Holding looks like | Next check |
| --- | --- | --- | --- |
| An enqueue-only command, used mid-round | Enqueueing by hand at the reviewed head is slow and easy to get wrong. The wider merge-tool repeat stays in the 12 October table | Every enqueue has the exact-head required checks, records check and applicable reviews; the command never merges; other watchers stay report-only | Read the first hour of invocations and their queue receipts |
| Slim boot, script waiting, close on queued or parked | Boot reads cost context the session needs later (see the lighter-boot rows of 1 October) | Boot under 25 percent with state, newest boot, register, 50 event lines and newer owner files; older evidence read on demand; handover at 75 percent | Compare boot gauges and missed instructions. Read unanswered items from durable state even when their events are older |

### Findings held: apply only if seen again

| Area | Why | Candidate | Next check |
| --- | --- | --- | --- |
| Codex orchestrator launch profile | A long-lived orchestrator needs a bigger context window than a single job | A dedicated orchestrator profile: 500000 window, compaction 450000, exact Sol high launch, 75 percent handover. Plain single-job launches stay at 250000 | Check later launches read the profile's native window; a launch that reads less records `PROFILE-FAIL`. No global config change |
| Queued relay through canonical files | A line queued into a busy pane can sit unread | Every director line also lives in a `DIRECTOR-*.md` file. Keep its pointer through the register and the newest state or boot; tell queued from read | A later-date sighting and evidence the receiver read the file |
| Codex reviews of our own code | A review brief can be refused by the model's filter | Brief Codex reviews as reviews of our own code, and never reword or rerun a refused brief to get past the filter. A fresh exact-head Sol review scoped to correctness and concurrency replaces that separate gate; only a small Sonnet review is the fallback | All other gates stay unchanged. Verify the normal code review separately; it is not clearance of a refused request |

### Lean running proposals, 14 October 2026

Implementation changes only. No installed skill, shared brief template, watchdog script or declaration producer changes until a skill pass takes them.

| Area | Why | Proposal | Next check |
| --- | --- | --- | --- |
| `director` and `orchestrator` `kick.sh`, Codex context | The text gauge is the reliable reading | Read Codex's `Context N% used` before any bar pattern | A boot scenario with both the text gauge and a conflicting bar must use the text gauge |
| `director` and `orchestrator` `kick.sh`, handover alert | An unreadable handover line must not pass silently | Alert when the handover line cannot be read. Accept the plain whole-second UTC form after the state note; remove extra receipt requirements | Prove malformed and unreadable lines alert, and the valid form is read |
| Codex session wrap-up discovery | Codex wrap-ups land in a folder `/recall` does not search | Route every agent's wrap-up into the one searchable session index | Save a Codex wrap-up and find that record through the actual recall path |
| `orchestrator` shared brief template, declaration writer | Consumers read the declarations from every lane | Put Repo, Section, Spec, Ticket and Phase declarations in the shared template. Keep `Section:`, `Ticket:` and standalone `PHASE Phase:` lines. Take the versioned writer only from its separately reviewed contract branch | Read one live boot, assignment, phase change and wrap against the consumer contract |
| Enqueue command | A discarded error hides why an enqueue failed | Print GitHub's actual refusal instead of discarding stderr | A refused enqueue keeps the actual GitHub error and exits non-zero |
| Whole-tree public-content reporting | Inherited findings repeat on every candidate | Compare with fresh `main` and say "baseline already on main" plainly. Keep the non-zero result and every publication gate | Prove an inherited finding is labelled as baseline and a new finding is still refused |

## Checkpoint 17 October 2026

### Owner-directed: check it holds

| Change | Why | Holding looks like | Next check |
| --- | --- | --- | --- |
| `single-agent`: read the gauge after every push, Sol round and merge; 45 percent wraps up, 50 hands off, 70 is the hard cap, through `orchestration/single/handoff.sh` and the skill's `HANDOFF.md` | A session near its limit can have several pull requests in flight. Owner's go, no evidence-over-time wait | Successors boot from the note alone and pick up the pull request in hand at its step; no session reaches Claude Code's automatic summary; few run past 50 | For the next five hand-offs: the context on each `HANDED-OFF` line, whether the successor asked for anything the note lacked, and any `<fill>` refusal |
| `single-agent`: step 1 takes the route (`wayfinder` → `to-spec` → `to-tickets` → build → `close-out`) for a job that isn't settled; specs and tickets carry a `Section:` line | A job that isn't settled is mapped, specified and ticketed before it is built | Each new single-agent job that wasn't settled opens with a `wayfinder:map` issue, then a `Spec:` issue, then tickets with native blockers and a `Section:` line, before its first pull request | The next five single-agent jobs: count those that charted before building, and tickets created without a `Section:` line |

## Checkpoint 19 October 2026

The rules are in [METHOD.md, The merge pipeline](METHOD.md#the-merge-pipeline). They are owner rulings, so they took effect on the ruling, with no wait for evidence over time; each row stays open so a later review can catch one that doesn't hold.

### Owner-directed, merge pipeline: check they hold

| Change | Why | Holding looks like | Next check |
| --- | --- | --- | --- |
| **Owner-directed**: no pull request enters the queue without a green pre-check on its exact head; no fallback; queued entries are pre-checked too | A fallback lets unchecked pull requests, and real reds, into the queue | Every enqueue has a green `m5/precheck` on the same head; no `PRECHECK-SKIPPED` line; no queue drop on a check the pre-check runs | Match each `ENQUEUED` head to a `PRECHECK-GREEN` line. Count group reds whose failing step is in the pre-check's step list |
| **Owner-directed**: pre-check batches from the queue's next-to-build entries, smaller after a batch with two or more reds. Replaced by the critical-path row in the next table | Batching shares one long run across several pull requests | Pre-checked pull requests an hour keep up with merges an hour | START and END pairs per line; pull requests pre-checked an hour against merges an hour |
| **Owner-directed**: one big test run per machine at a time, check machine first; a second pre-check line on the owner's machine while it stays under 3 load per core; no new lanes above that; test containers removed at run end. Replaced by the machine row in the next table | Overlapping big runs on one machine slow every run | No two big runs overlap on one machine; the second line pauses above 3 per core; no round containers left after an END | Overlapping START and END lines per machine; the load reading at each START; the container list after each END. Read the run logs before calling a machine idle |
| **Owner-directed**: timing failures. A queue failure in an untouched test that passes on one automatic re-run is timing; twice moves the test to nightly through one quarantine file (test, reason, owner, ticket, 14-day expiry) | Separates timing failures from real ones without re-running a real failure into a merge | Every `TIMING` line names a test outside the pull request's diff and a passing re-run; every quarantine entry has an owner, a ticket and an expiry; none outlives it; a real failure is never re-run into a merge | The timing ledger against the quarantine file; expired entries; the first real automatic re-run |
| **Owner-directed**: merge alarm at 45 minutes with no merge while pull requests wait, plus a 3-an-hour floor | A stalled queue must raise an alarm | An alert within 10 minutes of every 45-minute gap; a floor alert each hour under 3; no alert from one failed GitHub read | Compare merge gaps with alerts; count false alarms |
| **Owner-directed**: split at the Sol ceiling. A gap `main` also has, in a pull request better than `main` everywhere else, becomes its own ticket with two rounds; the pull request merges after pre-check | More rounds on one pull request cost more than a separate ticket | No third Sol round; each split names its ticket in the issue body; the split-off tickets get built | Split-off tickets still unstarted at the stage review |
| **Owner-directed**: one director read in place of a third Sol round | A focused read settles what a third round would not | Each read has its file in the round's hand-backs and names the paths it read; no third round | Any later Sol run or escape that finds a defect in a path a director read passed |
| **Owner-directed**: a live-check-only gap moves onto the owner's step's checklist and the code merges; sensitive pieces keep their director read | A check that can only run live waits for the switch-on, not the merge | Each moved check is on its owner step's checklist and runs at that switch-on | Owner checklists against the moved checks at each switch-on; any merged piece whose live check never ran |
| **Owner-directed**: fill seats from the critical path, review debt last; one table names each critical piece's pull request, blocker and lane | Fill lanes drift to review debt while critical pieces wait | The table exists from round start; a lane works review debt only when no critical piece is unblocked; no critical piece sits a day without a pull request | Lanes by area against the table at each hourly check |
| **Owner-directed**: round tools read GitHub through one shared reader, never a polling loop per pull request | Per-pull-request polling loops use up the shared API budget other tools need | No per-pull-request polling loop runs; the shared budget never reaches other tools' reserve | The reader's cost log and the GitHub logs of tools that share the budget |
| **Owner-directed**: the director checks every 30 minutes, not hourly, and each check closes out passive lanes (done or idle, no work in hand) and reads both pre-check lines for a stall | Passive lanes and stalled batches go unseen between hourly checks | No done lane pane outlives the next 30-minute sweep without a live job named; each check line in `RELAY-LOG.md` reads both lines' START and END | Done-pane counts per check line; any batch START with no END well past its usual run time that no alert or check line caught |
| **Owner-directed**: the check machine's big-run slot serves pre-check batches first; lanes' focused and red/green runs go to hosted CI wherever the proof allows | The pre-check is the only feed into the queue | A pre-check batch never waits behind a lane run; lane runs on the check machine name why hosted CI couldn't carry the proof | Check-machine START lines by kind (pre-check against lane) and the wait before each pre-check START |
| **Owner-directed**: pre-check line C on GitHub-hosted runners (public repo, no cost): a draft-PR batch runs the full hosted set, counts as the pre-check only when it ran every check-machine unit (database tests included) on the exact heads, and runs only while at most one merge group builds | Hosted runners run a batch much faster, at no cost on a public repo | Line C greens carry a status the enqueue loop accepts; no line C batch overlaps two or more merge groups; no queue red on a unit line C passed | Pull requests pre-checked an hour per line; queue reds after a line C green; job-slot waits in the merge groups |
| **Owner-directed**: merged is not done. One `SWITCH-ON.md` row per merged-but-off piece (what turns it on, who, when); agents switch on what they may straight after merge; owner-only and daylight ones go to one morning list ordered by what unblocks most | Merged pieces otherwise sit switched off | Every MERGED line gets a row; agent-allowed rows are on with evidence within the hour; the owner gets one list a day | Rows merged-but-off for more than a day; owner list items done against offered |
| **Owner-directed**: audit the critical areas' tickets for done, redundant or combinable work before building | Finds work that needs no lane before a lane builds it | The audit's savings are real: closed tickets stay closed, a combined pull request stays under 800 product lines | Whether a second audit at the next round finds enough to pay for its lane |
| **Director**: a split at the Sol ceiling where `main` has no such route at all is gated on the owner step that first lets traffic through, instead of on `main` having the gap | The gap only matters once traffic flows | The gate line is on the owner step's checklist and the follow-up merges before that step runs | The owner step's checklist at that switch-on |

### Owner-directed, 19 October 2026: check they hold

Ruled during the same round, as the way future builds are set up.

| Change | Why | Holding looks like | How to check |
| --- | --- | --- | --- |
| **Owner-directed**: critical-path pieces pre-check alone, in parallel, as soon as ready (hosted runners on a public repo, or a free machine slot); the rest batch at most 3; a green enqueues within 5 minutes, a red gets a fix lane within 15; every slot takes the top tier first ([METHOD](METHOD.md#the-merge-pipeline)). Replaces the batches row above | In a large batch one red member holds all the others | Merges an hour at least 3, with the top tier merging first | `MERGED` lines per hour; `T1T2-COUNT` lines for the order; minutes from each `PRECHECK-GREEN` to its `ENQUEUED`, and from each red to its fix lane's `DISPATCHED` |
| **Owner-directed**: the check machine runs up to 4 big runs while it reads under 0.8 load per core with at least 12 GB free; the owner's machine is read by CPU and RAM use, not load: up to 2 big runs and new lanes under 70 percent CPU and 75 percent RAM use, nothing new at 85 percent CPU, load above 6 per core a safety stop ([METHOD](METHOD.md#the-merge-pipeline)). Replaces the one-big-run row above | So a lane never waits on a cap the machine doesn't need, and the CPU is never overloaded | No lane waits more than 15 minutes for a check-machine slot while it reads under 0.8 per core; check-machine load stays under 1 per core; the owner's machine CPU averages 55 to 80 percent during the round, with no new start logged at 85 or above | The wait before each check-machine `START` against the load reading then; check-machine load per core at each check; the owner's machine `cpu.used` at each of its `START` lines and its round average |
| **Owner-directed**: pausing and restoring the whole fleet ([FLEET](FLEET.md#pausing-and-restoring-the-whole-fleet)) | Rehearse whole-fleet restoration and record the successor handover | The next whole-fleet pause restores every lane from its file with no lost work | Lane files against lanes rebooted; any lane that redid or lost work; an `ORCHESTRATOR-HANDOVER` line after each restore |

### Findings held: apply only if seen again, 19 October 2026

| Skill | Why | Proposed line | How to spot it in a real round |
| --- | --- | --- | --- |
| `orchestrator` waiters | A waiter that matches free text can fire on a quoted copy of the line it waits for | "A waiter matches only the lane's own line prefix (`LANE-<label> `), never free text that other lines may quote." | A lane booted before the line its waiter names |

### Proposals for the skills, 19 October 2026

No skill text changed here. Each needs the usual route: evidence on different dates, a grilling and a skill pass.

| Skill | Proposal | Why | Next check |
| --- | --- | --- | --- |
| `orchestrator` | A merge-queue step: the pre-check gate, groups of at most 3 (METHOD's merge pipeline), dequeue reds before the front, cancel dead group runs after a dequeue, one shared GitHub reader; the critical-path fill order; the machine rule line in every brief | The skill has no queue step, and every brief should carry the machine rule | A boot scenario on the bench: the orchestrator pre-checks before enqueue and fills from the critical path without being told |
| `director` | `kick.sh` uses the 45-minute stall and 3-an-hour floor, reads both pre-check lines, and checks run logs before calling a machine idle; a director read in place of a third Sol round | Stall alerts must match the configured thresholds | Kick replay against a past event log: alerts at the same times as the queue watcher, no idle call while a run is open |
| `build-review` | Stable finding ids, disputes and the fail-closed count rule in the skill text; where a lane writes a dispute; the split at the Sol ceiling | These rules live in a round's Sol script, not the skill, and a dispute written in a reply gives a false fail-closed verdict | Rerun the `build-review` bench fixtures plus a disputed-finding and a count-mismatch scenario |
| `orchestrator`, `director` (sending) | A pointer over about 600 characters goes in a file and the pane gets the path | Long lines sent into a busy pane fail | A send of a long pointer lands whole on a busy pane |

## Checkpoint 21 October 2026

### Owner-directed: check it holds

| Change | Why | Holding looks like | How to check |
| --- | --- | --- | --- |
| `close-out` tidy step: a finished lane or Sol run removes its own work copies with the tool that made them, keeping and naming any with unpushed work; the check machine's weekly `lane-sweep.sh` moves copies idle 7 days to the Bin | Work copies pile up unless each lane clears its own | Each weekly sweep report moves few copies, most of them under a week past their lane's close | The week's sweep reports against the lanes closed that week |
