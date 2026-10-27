# What worked

*A record of how the method got here, kept as evidence for [HISTORY.md](HISTORY.md#dropped-and-why). You don't need it to run a build; start at the [reading order](../README.md#where-to-start).*

Every method change Code Factory tried, and whether it stayed. It names sources and does not copy them. [FLEET.md](FLEET.md) is the current model. A new trial gets a row here with its measure, and a verdict once the measure is in.

Verdicts:

- **kept**: still in force.
- **dropped**: stopped.
- **replaced by FLEET.md**: the fleet model does it another way.
- **unproven**: tried, but never measured, or measured too thinly to call.

Some sources are private round records. Rows that rest on them name the file without a link.

## Review rounds and reviewers

| What was tried | Verdict | Source |
| --- | --- | --- |
| Copilot review on every push | **dropped** | [HISTORY](HISTORY.md#copilots-place-in-the-chain-and-why-it-left) |
| Sol, a model from another company than the builder's, as reviewer of record | **kept** | [HISTORY](HISTORY.md#copilots-place-in-the-chain-and-why-it-left), [rounds index](rounds/README.md) |
| Up to three Sol reviews on each small pull request | **dropped** for pace | [HISTORY](HISTORY.md#build-speeds-before-trunk) |
| After a repeat finding in one path, write a two-line simpler design instead of patching | **kept**. It became the round-2 split, and FLEET's "split after two rounds" | SKILL-WATCH |
| Minimal reviews until Sol had room, skipped ranges logged as owed | **dropped**. It was a stopgap | `BASELINE-2026-10-02.md` |
| Cap of three Sol rounds per pull request | **dropped** for two rounds | SKILL-WATCH, `BASELINE-2026-10-02.md` |
| One issue catalogue per repo, one issue per root cause | **unproven** | SKILL-WATCH |
| Sol audits only; a fresh Opus writes and runs each proof | **unproven** | `BASELINE-2026-10-02.md` |
| Plain severity test in every Sol prompt | **kept** | `BASELINE-2026-10-02.md` |
| Design system: two rounds, minors to one tidy pass | **kept**, and widened | `BASELINE-2026-10-02.md` |
| All review deferred so a slice merged faster | **replaced by FLEET.md**: Sol reviews product code before it merges | `README.md` (slice landing record) |
| Two Sol rounds; design first for locks, retries and authority; a round-2 red splits | **kept** in FLEET.md | SKILL-WATCH, [FLEET review](FLEET.md#review) |
| Race attack by a fresh sub-agent before READY | **kept** for locks, sign-in, money, permissions and data separation only | `LEAN-RUNNING.md` |
| Opus reads every Codex fix diff (`FIX-DIFF-READ`) | **unproven** | `LEAN-RUNNING.md` |
| The lane runs its own fresh Sol review; Opus reads only sign-in, money and data separation; no Sol on styling or docs | **unproven** ([open measures](#open-measures)) | [FLEET review](FLEET.md#review) |

## Model split

| What was tried | Verdict | Source |
| --- | --- | --- |
| Three tiers: Opus high, Opus medium, Sonnet for grunt work | **dropped** | `MODEL-SPLIT-2026-10-02.md` |
| Opus 5.5 high for all product code, Sonnet only for mechanical jobs, Sol reviews by impact | **replaced by FLEET.md** | `BASELINE-2026-10-02.md` |
| Temporary split: Opus builds, Codex reviews and fixes, `SIMPLE` or `OPUS` tag per slice | **unproven**. Ended as planned | `README.md` (round record) |
| Codex (Sol) orchestrator on a large-context profile | **replaced by FLEET.md**: Opus orchestrates | `EVIDENCE-CORRECTION.md` |
| Opus as thin director and orchestrator and for sensitive builds; Codex Sol builds ordinary pieces; Sol reviews | **replaced**: Claude builds and Sol only reviews; the table lives in your model list | [FLEET models](FLEET.md#models) |

## Speeds, trunk and piece size

| What was tried | Verdict | Source |
| --- | --- | --- |
| Long prose briefs and no round cap | **dropped** | [HISTORY](HISTORY.md#from-long-prompts-to-short-briefs) |
| Self-contained briefs under about 600 words | **kept** | [HISTORY](HISTORY.md#from-long-prompts-to-short-briefs) |
| 400-line size gate | **dropped**: a guide, later 800 lines | LESSONS |
| Batches and slices, the medium speed | **dropped** for trunk | [HISTORY](HISTORY.md#build-speeds-before-trunk), `BASELINE-2026-10-02.md` |
| Fast: non-sensitive pieces merge on green checks, Sol reviews after | **dropped** | [HISTORY](HISTORY.md#build-speeds-before-trunk) |
| Trunk: each piece reviewed, then straight to `main` through the queue | **kept** | `BASELINE-2026-10-02.md` |
| One Codex session owning delivery alone | **dropped** | `CODEX-STALL-LESSONS.md`, `README.md` (single-owner record) |
| One Claude session as owner, in-session sub-agents, no director, about 800-line pull requests | **dropped**. The one-agent shape returns in FLEET.md for one feature or a switch-on | `OWNER-LESSONS.md`, [FLEET shape](FLEET.md#pick-the-shape-first) |

## Merge queue and CI

| What was tried | Verdict | Source |
| --- | --- | --- |
| Strict "up to date" rule before merge | **dropped** once the queue came in | LESSONS |
| Shard CI for speed | **dropped** | LESSONS |
| GitHub merge queue, with CodeQL as a scanning rule | **kept** | `BASELINE-2026-10-02.md` |
| Light checks on pull requests, full tests only in the queue, superseded runs cancelled | **kept** | `BASELINE-2026-10-02.md`, [CI-CHECKS](CI-CHECKS.md) |
| Self-hosted runner on the check machine | **dropped** for public repos | SKILL-WATCH |
| Queue width set by runner slots; push-to-main CI cancelled while the queue runs; pull request CI only for the next in line | **kept** | `README.md` (slice landing record) |
| Every CI job in about 10 minutes (CIITEM3) | **unproven** | SKILL-WATCH |
| An approved pull request not in the queue is a finding at every director check | **replaced by FLEET.md**: the lane invokes `enqueue.mjs` for the PR and exact head. After a drop, the caller invokes it again; one re-queue is permitted, then it refuses. Supply `--pane` for lane notification | `BASELINE-2026-10-02.md` |
| Merge scripts per orchestrator, then one merge tool, then an enqueue-only command | **replaced by FLEET.md**: the loading bay | SKILL-WATCH |

## Lanes, seats, machines and sub-agents

| What was tried | Verdict | Source |
| --- | --- | --- |
| Fill every lane slot to the seat cap | **kept**: in FLEET the orchestrator fills to the caps | `BASELINE-2026-10-02.md` |
| Seat stops changed during the week | **dropped**: set the stop once a week | `BASELINE-2026-10-02.md` |
| Heavy work split evenly between the owner's machine and the check machine | **dropped** for heavy runs on the check machine | `BASELINE-2026-10-02.md` |
| Heavy runs on the check machine, one local test process per lane | **kept**. "Read both machines' load before a fill" waits for a skill pass | SKILL-WATCH |
| Fresh-only sub-agents and one sub-agents skill | **kept** | SKILL-WATCH |
| A time limit on a sub-agent, flagged by the watchdog | **kept** | `BASELINE-2026-10-02.md` |
| Disk floor and Sol container clean-up | **kept** | `README.md` (slice landing record) |

## Handovers, boots and relays

| What was tried | Verdict | Source |
| --- | --- | --- |
| Lighter boot by role | **unproven** | SKILL-WATCH |
| Orchestrator hands over at 50 percent context, not 30 | **kept** | `BASELINE-2026-10-02.md` |
| Checks that matter run as scripts, not agent judgement | **kept**. FLEET extends it to budgets and tripwires | `BASELINE-2026-10-02.md`, `LEAN-RUNNING.md` |
| Slim boot: state note, newest boot, register and recent event lines | **kept** | `README.md` (round record) |
| One unit of work per orchestrator turn | **dropped**: owed units run back to back | `LEAN-RUNNING.md` |
| Director lines typed into busy panes | **dropped**: instructions live in files, panes get pointers | `EVIDENCE-CORRECTION.md` |
| Director over orchestrator over lanes, with lanes told to stop and report | **replaced by FLEET.md**: lanes own their piece to merge; the director is thin | `ANSWERS.md`, `RELAY-LOG.md` |

## Paperwork and receipts

| What was tried | Verdict | Source |
| --- | --- | --- |
| Standing permission: agents answer routine questions and log each as `ORCH-DECISION` | **kept** for standing permission; the per-answer `ORCH-DECISION` line is **dropped**, since the event log keeps milestones only ([FLEET.md](FLEET.md#paperwork-four-things-per-agent-nothing-else)) | LESSONS, `README.md` (slice landing record) |
| Review-evidence lines tied to exact commit SHAs | **unproven**: the fix is a proposal that needs a security review | `README.md` (single-owner record) |
| Custody proofs at every lane close | **dropped** except for production, secrets and sign-in; then **replaced by FLEET.md** | `LEAN-RUNNING.md` |
| Check each wrap against real artefacts | **kept**; the loading bay's description gate does the same job | `LEAN-RUNNING.md` |
| Three things per agent: a start line, a wrap-up on the pull request checked by the loading bay, tokens and time read by script | **replaced** | none |
| `Why:`, `Left undone:` and `Closes` lines in the pull request description, checked by the loading bay; unfinished work becomes tickets; tickets close on merge by script; the code is the truth | **unproven** | [FLEET paperwork](FLEET.md#paperwork-four-things-per-agent-nothing-else) |
| Agents that finish a task use a `close-out` skill (lines checked, tickets, a short record, the starter told); owner sessions keep the wrap-up | **unproven** | [FLEET paperwork](FLEET.md#paperwork-four-things-per-agent-nothing-else) |

## Switch-ons

| What was tried | Verdict | Source |
| --- | --- | --- |
| Done means switched on: every ticket names its switch-on step | **kept** | SKILL-WATCH, [METHOD](METHOD.md#done-means-switched-on) |
| A frozen custom runner for a switch-on | **replaced by FLEET.md**: the app's own tools, a no-change rehearsal early, save before each write | [FLEET switch-ons](FLEET.md#switch-ons-and-deploys) |

## Open measures

The first slice built the FLEET.md way is the trial. It must measure:

1. **Tokens per merge**, against a baseline week of the earlier model. The ledger script (the panes plus each session log) runs back over that week first. Until it does, the comparison reads "pending".
2. **Work against overhead.** The daily split of tokens between builders and reviewers on one side and the director and orchestrator on the other. Target: at least 70 percent on the work.
3. **Merges per hour**, against the earlier model.
4. **Tripwires.** Count each review or switch-on cycle that restarts more than twice, and each 2-hour gap with no merge while work is in flight.
5. **Budgets.** The first week only calibrates the median and spread per ticket. The 1.5x and 2x alarms start after it.

Also owed: every **unproven** row above that names a measure.
