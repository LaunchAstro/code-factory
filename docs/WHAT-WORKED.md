# What worked

The record of every method change Code Factory tried, what it measured, and whether it stayed. It points to the sources and does not copy them. [FLEET.md](FLEET.md) is the current model, approved by the owner on 15 October 2026. A new trial gets a row here with its measure, and a verdict once the measure is in.

Verdicts:

- **kept**: still in force.
- **dropped**: stopped, with the reason in the row.
- **replaced by FLEET.md**: the 15 October model does it another way.
- **unproven**: tried, but never measured, or measured too thinly to call.

"Not measured" means no source gives a number. Many rows from 5 October stay unproven because the re-measure tables for 6 October in BASELINE (`BASELINE-2026-10-02.md`, a private round record) were never filled in.

Some evidence is private. The Ops Astro round files (`events.log`, `RELAY-LOG.md`, `REGISTER.md`, the `NATHAN-*` and `DIRECTOR-*` files) and the 15 October grilling answers live in ops-astro-roadmap's git-ignored `.local/` folder. Rows that rest on them name the file without a link. The record of the 15 October session is issue #154 (a private ticket).

## Review rounds and reviewers

| Date | What was tried | What it measured | Verdict | Source |
| --- | --- | --- | --- | --- |
| 17 to 21 Sep | Copilot review on every push | Not consistently available for required reviews. Missing for 3 planted defects and 16 of 17 fix heads. The 8 PRs GitHub called `BLOCKED` were the 8 with unticked Copilot threads | **dropped** | [HISTORY](HISTORY.md#copilots-place-in-the-chain-and-why-it-left) |
| 17 to 21 Sep | Sol, a model from another company than the builder's, as reviewer of record | Named planted defects 8 of 10 in round 1, 4 of 4 in round 2, 2 of 2 in rounds 3, 5 and 6 | **kept** | [HISTORY](HISTORY.md#copilots-place-in-the-chain-and-why-it-left), [rounds index](rounds/README.md) |
| 28 to 29 Sep | Up to three Sol reviews on each small PR of Ops Astro's core | 157 results over 54 PRs. 2 of about 46 passed the first read. Median 4.4 h from approval to merge | **dropped** for pace | [HISTORY](HISTORY.md#build-speeds-before-trunk) |
| 1 Oct | After a repeat finding in one path, write a two-line simpler design instead of patching | Prompted by #296, which took 13 security rounds. Rounds per sensitive PR after: not measured | **kept**. It became the round-2 split, and FLEET's "split after two rounds" | [SKILL-WATCH 1 Oct](SKILL-WATCH.md#seen-in-the-build-1-october-evening-director-9s-feedback-to-skill-factory) |
| 2 Oct | Minimal reviews until Sol had room, skipped ranges logged as owed | Owed rows went from 325 to 365 in a day, 0 cleared | **dropped**. It was a stopgap | BASELINE look-back 1 (`BASELINE-2026-10-02.md`, a private round record) |
| 4 Oct | Cap of three Sol rounds per PR, down from as many as 9 | Re-reviews found more per review than first reads, 4.3 findings against 3.6. Before and after the cap: not measured | **dropped** for two rounds on 12 Oct | [SKILL-WATCH 4 Oct](SKILL-WATCH.md#checkpoint-4-october-2026), BASELINE 4 Oct (`BASELINE-2026-10-02.md`, a private round record) |
| 4 Oct | One issue catalogue per repo, one issue per root cause | 323 open at setup, 360 four hours later, 0 closed by a fix. `Seen again:` count: not measured | **unproven** | [SKILL-WATCH 4 Oct](SKILL-WATCH.md#checkpoint-4-october-2026) |
| 5 Oct | Sol audits only; a fresh Opus writes and runs each proof | Codex tokens per run down 33 percent on narrow re-checks (n=12) and about 29 percent on fix-head reviews (n=3). 3 of 3 findings reproduced | **unproven** | BASELINE 5 Oct, row b (`BASELINE-2026-10-02.md`, a private round record) |
| 5 Oct | Plain severity test in every Sol prompt | Blocking catalogue issues went from 70 to 26 | **kept** | BASELINE 5 Oct, row d (`BASELINE-2026-10-02.md`, a private round record) |
| 5 Oct | Design system: two rounds, minors to one tidy pass | After round 1, 70 of 79 findings were minor | **kept**, and widened on 12 Oct | BASELINE 5 Oct, row c (`BASELINE-2026-10-02.md`, a private round record) |
| 11 Oct | All review deferred so Slice One merged faster | 50 merges in about 21 h. Then 178 merged PRs owed a cross-model check, 99 of them sensitive; 456 root causes; 8 of 10 fix PRs sent back | **replaced by FLEET.md**: Sol reviews product code before it merges | Slice One numbers (`2026-10-11-slice-one-landing/README.md`, a private round record) |
| 12 Oct | Two Sol rounds; design first for locks, retries and authority; a round-2 red splits | Eight round-3 holds in two hours led to it. Third rounds since: not measured | **kept** in FLEET.md | [SKILL-WATCH 12 Oct](SKILL-WATCH.md#owner-directed-nathan-cf-speed-check-they-hold), [FLEET review](FLEET.md#review) |
| 12 Oct | Race attack by a fresh sub-agent before READY | Found something in 73 of 94 cases. UI-only attacks found nothing | **kept** for locks, sign-in, money, permissions and data separation only | LEAN-RUNNING (`2026-10-14-slow-burn/LEAN-RUNNING.md`, a private round record) |
| 14 Oct | Opus reads every Codex fix diff (`FIX-DIFF-READ`) until 18 Oct | 6 reads in one day, no blocking catch | **unproven**. Report the catch count on 18 Oct | LEAN-RUNNING (`2026-10-14-slow-burn/LEAN-RUNNING.md`, a private round record) |
| 15 Oct | The lane runs its own fresh Sol review; Opus reads only sign-in, money and data separation; no Sol on styling or docs | Not measured yet | **unproven**: the 19 October trial's results are not recorded yet ([open measures](#open-measures)) | [FLEET review](FLEET.md#review) |

## Model split

| Date | What was tried | What it measured | Verdict | Source |
| --- | --- | --- | --- | --- |
| 1 to 2 Oct | Three tiers: Opus high, Opus medium, Sonnet for grunt work | The owner held it for research. It never ran | **dropped** | MODEL-SPLIT (`MODEL-SPLIT-2026-10-02.md`, a private round record) |
| 2 Oct | Opus 5.5 high for all product code, Sonnet only for mechanical jobs, Sol reviews by impact | Next day: 45 Opus and 4 Sonnet dispatches, 0 Sonnet slips. Its effect on seat use per merge: not measured | **replaced by FLEET.md** | BASELINE look-back 1 (`BASELINE-2026-10-02.md`, a private round record) |
| 14 Oct | Temporary split to 18 Oct: Opus builds, Codex reviews and fixes, `SIMPLE` or `OPUS` tag per slice | No receipts in the record | **unproven**. Ends 18 Oct | slow-burn record (`2026-10-14-slow-burn/README.md`, a private round record) |
| 14 Oct | Codex (Sol) orchestrator on a 500k-token profile | About 3.3 merges an hour in its first 90 minutes, with a handover every 15 to 25 minutes (`RELAY-LOG.md`, 14 Oct). Handover rate on the bigger profile: not measured. Owner, 15 Oct: Sol orchestrators "blabber", get stuck and do poor work (`REGISTER.md`) | **replaced by FLEET.md**: Opus orchestrates | EVIDENCE-CORRECTION (`2026-10-14-slow-burn/EVIDENCE-CORRECTION.md`, a private round record) |
| 15 Oct | Opus as thin director and orchestrator and for sensitive builds; Codex Sol builds ordinary pieces; Sol reviews | Checked each Monday against the seats | **replaced**: Claude builds and Sol only reviews (owner, 17 October); the table lives in Skill Factory's models.md | [FLEET models](FLEET.md#models) |

## Speeds, trunk and piece size

| Date | What was tried | What it measured | Verdict | Source |
| --- | --- | --- | --- | --- |
| 17 to 18 Sep | Long prose briefs and no round cap, the control night | 4 merges for USD 243, 132 Codex sessions, 12 h 55 min | **dropped** | [HISTORY](HISTORY.md#from-long-prompts-to-short-briefs) |
| 21 Sep | Self-contained briefs under about 600 words | A 324-word brief: 5 of 5 criteria, 4 min 57 s, USD 2.07. A 1,768-word brief: 3 of 3, 20 min 32 s, USD 6.59. Different defects, so a ratio, not a proof | **kept** | [HISTORY](HISTORY.md#from-long-prompts-to-short-briefs) |
| 28 Sep | 400-line size gate | 30 tickets cut into 141 parts. Nearly every fix needed a waiver | **dropped**: a guide, later 800 lines | [LESSONS](LESSONS-2026-09.md#merging-and-checks) |
| 30 Sep to 2 Oct | Batches and slices, the medium speed | Slice PRs of 13,000 to 24,000 lines. Batch reviews raised about 15 blocking findings each. Batch 2c1 was bumped from the queue | **dropped** for trunk | [HISTORY](HISTORY.md#build-speeds-before-trunk), BASELINE (`BASELINE-2026-10-02.md`, a private round record) |
| 30 Sep to 2 Oct | Fast: non-sensitive pieces merge on green checks, Sol reviews after | Did not hold on Stage 1 (owner, 4 Oct) | **dropped** | [METHOD build speeds](METHOD.md#build-speeds) |
| 2 Oct | Trunk: each piece reviewed, then straight to `main` through the queue | READY to `main` median 4.5 h. Batch-size reviews gone | **kept** | BASELINE look-back 1 (`BASELINE-2026-10-02.md`, a private round record) |
| 10 to 11 Oct | One Codex session owning delivery alone | No whole roadmap item in about 10 h 25 min. The "locally verified" candidate failed 76 tests when the audit ran it | **dropped** | CODEX-STALL-LESSONS (`2026-10-11-claude-single-owner/CODEX-STALL-LESSONS.md`, a private round record), single-owner result (`2026-10-11-claude-single-owner/README.md`, a private round record) |
| 11 Oct | One Claude session as owner, in-session sub-agents, no director, about 800-line PRs | 10 PRs green in about 1.5 h. 3 merged by 08:19Z, about 0.5 an hour; the queue and SHA-tied review paperwork set the pace | **dropped** that day. The one-agent shape returns in FLEET.md for one feature or a switch-on | OWNER-LESSONS (`2026-10-11-claude-single-owner/OWNER-LESSONS.md`, a private round record), [FLEET shape](FLEET.md#pick-the-shape-first) |

## Merge queue and CI

| Date | What was tried | What it measured | Verdict | Source |
| --- | --- | --- | --- | --- |
| 28 to 29 Sep | Strict "up to date" rule before merge | 60 rebases, 42 Sol re-checks and a 26-minute test run each time `main` moved. Median 4.4 h from approval to merge | **dropped** once the queue came in | [LESSONS](LESSONS-2026-09.md#merging-and-checks) |
| Sep | Shard CI for speed | Cancelled because it burned tokens | **dropped** | [LESSONS](LESSONS-2026-09.md#merging-and-checks) |
| 2 Oct | GitHub merge queue, with CodeQL as a scanning rule | Time in the queue median 30 min; the wait was before enqueue. 6 of 23 groups red, all on flaky tests already on `main` | **kept** | BASELINE look-back 1 (`BASELINE-2026-10-02.md`, a private round record) |
| 4 Oct | Light checks on PRs, full tests only in the queue, superseded runs cancelled | 0.38 merges an hour over the 24 h before; 2.6 an hour over the 68 minutes after. CI minutes per merge about 2,250 before; after: not measured | **kept** | BASELINE 4 Oct (`BASELINE-2026-10-02.md`, a private round record), [CI-CHECKS](CI-CHECKS.md) |
| 4 Oct | Self-hosted runner on the M5 | Held: on a public repo an outside PR could run code on the production M5 | **dropped** for public repos | [SKILL-WATCH 4 Oct](SKILL-WATCH.md#checkpoint-4-october-2026) |
| 12 Oct | Queue width set by runner slots; push-to-main CI cancelled while the queue runs; PR CI only for the next in line | Width 5 added nothing: about 20 jobs ran at once and groups sat 40 min unstarted. After the cancel guard, 3 merges in the next hour after none for 50 min | **kept** | Slice One, after 07:00Z (`2026-10-11-slice-one-landing/README.md`, a private round record) |
| 12 Oct | Every CI job in about 10 minutes (CIITEM3) | Before: slowest merge-group job 34.5 min. After: not measured | **unproven** | [SKILL-WATCH 12 Oct](SKILL-WATCH.md#owner-directed-nathan-cf-speed-check-they-hold) |
| 5 Oct | An approved PR not in the queue is a finding at every director check | 68 minutes with no merge while 2 of 11 clean PRs were queued. Two merged 15 minutes after the kick | **replaced by FLEET.md**: the loading bay picks up every ready PR | BASELINE evening, row l (`BASELINE-2026-10-02.md`, a private round record) |
| 5 to 14 Oct | Merge scripts per orchestrator, then one merge tool (#115), then an enqueue-only command (#139) | 236 forked script copies. #115 parked after two red design checks. #139 merged 14 Oct; no live-use receipt recorded | **replaced by FLEET.md**: the loading bay | [SKILL-WATCH 12 Oct](SKILL-WATCH.md#repeats-ready-for-the-next-pass), slow-burn record (`2026-10-14-slow-burn/README.md`, a private round record) |

## Lanes, seats, machines and sub-agents

| Date | What was tried | What it measured | Verdict | Source |
| --- | --- | --- | --- | --- |
| 30 Sep | Fill every lane slot to the seat cap | 8.9 lanes an hour against a cap of 15 on 2 Oct. 1.6 an hour the next day, from one long wait and seat stops, not from dispatching | **kept**: in FLEET the orchestrator fills to the caps | BASELINE (`BASELINE-2026-10-02.md`, a private round record) |
| 2 Oct | Seat stops changed during the week | The stop moved 4 times in one day. The build sat idle 12.3 h with work waiting | **dropped**: set the stop once a week | BASELINE look-back 1 (`BASELINE-2026-10-02.md`, a private round record) |
| 2 Oct | Heavy work split half on the laptop, half on the M5 | 49 of 49 dispatches went to the laptop. Laptop load 38 timed out a test | **dropped** for "heavy runs on the M5" on 4 Oct | BASELINE look-back 1 (`BASELINE-2026-10-02.md`, a private round record) |
| 4 Oct | Heavy runs on the M5, one laptop test process per lane | 12 Oct: M5 load 139 with 90 test processes started by leads | **kept**. "Read both machines' load before a fill" waits for a skill pass | [SKILL-WATCH 12 Oct](SKILL-WATCH.md#repeats-ready-for-the-next-pass) |
| 1 Oct | Fresh-only sub-agents and one sub-agents skill | About 14 pieces an hour, 0.57 blocking findings and 0.14 fix rounds per piece. Bench: 1 critical failure in 28 runs with the skills, 11 in 16 without | **kept** | [SKILL-WATCH 1 Oct](SKILL-WATCH.md#checkpoint-1-october-2026) |
| 5 Oct | 90-minute limit on a sub-agent, flagged by the watchdog | Two runs before it were on moot work: 5 h 40 min and 508k tokens, and 178 min and 545k tokens | **kept** | BASELINE evening, row m (`BASELINE-2026-10-02.md`, a private round record) |
| 4 to 12 Oct | Disk floor and Sol container clean-up | Sol left about 1 GB per review. Laptop disk fell 12 GB an hour on 12 Oct | **kept** | Slice One, after 07:00Z (`2026-10-11-slice-one-landing/README.md`, a private round record) |

## Handovers, boots and relays

| Date | What was tried | What it measured | Verdict | Source |
| --- | --- | --- | --- | --- |
| 1 Oct | Lighter boot by role, target 15 percent fewer boot tokens | The missed-items script flagged too much to score it | **unproven** | [SKILL-WATCH 1 Oct](SKILL-WATCH.md#checkpoint-1-october-2026) |
| 5 Oct | Orchestrator hands over at 50 percent context, not 30 | Mean time in the seat 82 min, against 22 before (n=4) | **kept**. The Codex profile used 75 percent from 14 Oct | BASELINE evening, row o (`BASELINE-2026-10-02.md`, a private round record) |
| 5 Oct | Checks that matter run as scripts, not agent judgement | Verify watchdog behaviour against actual elapsed time and the session's text context gauge | **kept**. FLEET extends it to budgets and tripwires | BASELINE evening, row k (`BASELINE-2026-10-02.md`, a private round record), LEAN-RUNNING (`2026-10-14-slow-burn/LEAN-RUNNING.md`, a private round record) |
| 14 Oct | Slim boot: state note, newest boot, register and 50 event lines | A Codex orchestrator finished booting at 28 percent context, against 45 to 47 before (`RELAY-LOG.md`, 14 Oct) | **kept** | slow-burn record (`2026-10-14-slow-burn/README.md`, a private round record) |
| 14 Oct | One unit of work per orchestrator turn | Owed work sat idle until a 20-minute nudge | **dropped** that evening: owed units run back to back | LEAN-RUNNING (`2026-10-14-slow-burn/LEAN-RUNNING.md`, a private round record) |
| 14 Oct | Director lines typed into busy panes | 3 lines stranded at handovers in one day | **dropped**: instructions live in files, panes get pointers | EVIDENCE-CORRECTION (`2026-10-14-slow-burn/EVIDENCE-CORRECTION.md`, a private round record) |
| to 15 Oct | Director over orchestrator over lanes, with lanes told to stop and report | Lane returns unread for up to 75 min. A two-line CSS fix bounced between director and orchestrator. Heavy token use on one slice with little shipped (owner's estimate). Orchestration stopped at 09:40 on 15 Oct | **replaced by FLEET.md**: lanes own their piece to merge; the director is thin | private ticket #154; `ANSWERS.md`, `RELAY-LOG.md` |

## Paperwork and receipts

| Date | What was tried | What it measured | Verdict | Source |
| --- | --- | --- | --- | --- |
| 28 Sep | Standing permission: agents answer routine questions and log each as `ORCH-DECISION` | Before: 25 minutes stalled on two answers agents could give. Slice One landing logged 184 routine calls | **kept** for standing permission; the per-answer `ORCH-DECISION` line is **dropped**, since the event log keeps milestones only ([FLEET.md](FLEET.md#paperwork-four-things-per-agent-nothing-else), 15 October) | [LESSONS](LESSONS-2026-09.md#the-owner-and-the-flow), Slice One numbers (`2026-10-11-slice-one-landing/README.md`, a private round record) |
| 11 Oct | Review-evidence lines tied to exact commit SHAs | Every move of `main` made every waiting PR stale. It failed or blocked 4 PRs, #1192 twice | **unproven**: the fix is a proposal that needs a security review | single-owner gap (`2026-10-11-claude-single-owner/README.md`, a private round record) |
| to 14 Oct | Custody proofs at every lane close | 0 catches in 75 closures. Paperwork was 15 percent of orchestrator events on 13 Oct and 62 percent on 14 Oct | **dropped** except for production, secrets and sign-in; then **replaced by FLEET.md** | LEAN-RUNNING (`2026-10-14-slow-burn/LEAN-RUNNING.md`, a private round record) |
| to 14 Oct | Check each wrap against real artefacts | Caught about 20 cases of work unpushed, unreported or incomplete | **kept**; the loading bay's description gate does the same job | LEAN-RUNNING (`2026-10-14-slow-burn/LEAN-RUNNING.md`, a private round record) |
| 15 Oct | Three things per agent: a start line, a wrap-up on the PR checked by the loading bay, tokens and time read by script | Not measured. Within the hour the owner cut the wrap-up to two lines: the wrap-up drifts from the code | **replaced** the same day | private ticket #154 |
| 15 Oct | `Why:`, `Left undone:` and `Closes` lines in the PR description, checked by the loading bay; unfinished work becomes tickets; tickets close on merge by script; the code is the truth | Not measured yet | **unproven** | [FLEET paperwork](FLEET.md#paperwork-four-things-per-agent-nothing-else) |
| 15 Oct | Agents that finish a task use a new `close-out` skill (lines checked, tickets, a short record in the private vault, the starter told); owner sessions keep the wrap-up. Replaced a two-form wrap-up tried the same afternoon | Not measured yet | **unproven** | [FLEET paperwork](FLEET.md#paperwork-four-things-per-agent-nothing-else), private ticket #154 |

## Switch-ons

| Date | What was tried | What it measured | Verdict | Source |
| --- | --- | --- | --- | --- |
| 13 Oct | Done means switched on: every ticket names its switch-on step | An audit that day found more coded than live | **kept** | [SKILL-WATCH 13 Oct](SKILL-WATCH.md#checkpoint-13-october-2026), [METHOD](METHOD.md#done-means-switched-on) |
| 13 to 15 Oct | A frozen custom runner for the side chat switch-on | Use the app's own tools; rehearse writes and preserve a restoration copy | **replaced by FLEET.md**: the app's own tools, a no-change rehearsal early, save before each write | private ticket #154, [FLEET switch-ons](FLEET.md#switch-ons-and-deploys) |

## Open measures

The first slice built the FLEET.md way, on Monday 19 October 2026, is the trial. Its results are not recorded here yet (26 October 2026). It must measure:

1. **Tokens per merge**, against the week of 12 October. That baseline does not exist yet. The 25M figure is the owner's estimate, and per-agent tokens were never collected. The ledger script (herdr's panes plus each session log) has to run back over the week of 12 October first. Until it does, the comparison reads "pending".
2. **Work against overhead.** The daily split of tokens between builders and reviewers on one side and the director and orchestrator on the other. Target: at least 70 percent on the work.
3. **Merges per hour.** The night of 14 to 15 October ran about 1.8 an hour, against 1.5 before (private ticket #154).
4. **Tripwires.** Count each review or switch-on cycle that restarts more than twice, and each 2-hour gap with no merge while work is in flight.
5. **Budgets.** The first week only calibrates the median and spread per ticket. The 1.5x and 2x alarms start after it.

Also owed: the `FIX-DIFF-READ` catch count on 18 October, and every **unproven** row above that names a measure.
