# What worked

*A record of how the method got here, kept as evidence for [HISTORY.md](HISTORY.md#dropped-and-why). You don't need it to run a build; start at the [reading order](../README.md#where-to-start).*

Every method change Code Factory tried, what it showed, and whether it stayed. It names sources and does not copy them. [FLEET.md](FLEET.md) is the current model. A new trial gets a row here with its measure, and a verdict once the measure is in.

Verdicts:

- **kept**: still in force.
- **dropped**: stopped, with the reason in the row.
- **replaced by FLEET.md**: the fleet model does it another way.
- **unproven**: tried, but never measured, or measured too thinly to call.

Some sources are private round records. Rows that rest on them name the file without a link.

## Review rounds and reviewers

| What was tried | What it showed | Verdict | Source |
| --- | --- | --- | --- |
| Copilot review on every push | Not reliably available, and it held merges on unticked threads rather than on the code | **dropped** | [HISTORY](HISTORY.md#copilots-place-in-the-chain-and-why-it-left) |
| Sol, a model from another company than the builder's, as reviewer of record | It names defects at the file and line | **kept** | [HISTORY](HISTORY.md#copilots-place-in-the-chain-and-why-it-left), [rounds index](rounds/README.md) |
| Up to three Sol reviews on each small pull request | Most first reads found a real problem, and the wait from approval to merge was long | **dropped** for pace | [HISTORY](HISTORY.md#build-speeds-before-trunk) |
| After a repeat finding in one path, write a two-line simpler design instead of patching | Followed a sensitive pull request that took many rounds; never measured after | **kept**. It became the round-2 split, and FLEET's "split after two rounds" | SKILL-WATCH |
| Minimal reviews until Sol had room, skipped ranges logged as owed | Owed reviews grew and none cleared | **dropped**. It was a stopgap | `BASELINE-2026-10-02.md` |
| Cap of three Sol rounds per pull request | Re-reviews kept finding real problems; the cap's effect was never measured | **dropped** for two rounds | SKILL-WATCH, `BASELINE-2026-10-02.md` |
| One issue catalogue per repo, one issue per root cause | Issues opened faster than fixes closed them; repeats never counted | **unproven** | SKILL-WATCH |
| Sol audits only; a fresh Opus writes and runs each proof | Lower Codex use on re-checks in a small sample | **unproven** | `BASELINE-2026-10-02.md` |
| Plain severity test in every Sol prompt | Far fewer findings marked blocking | **kept** | `BASELINE-2026-10-02.md` |
| Design system: two rounds, minors to one tidy pass | After round 1, nearly all findings were minor | **kept**, and widened | `BASELINE-2026-10-02.md` |
| All review deferred so a slice merged faster | Fast merges, then a large owed backlog of cross-model checks and most fix pull requests sent back | **replaced by FLEET.md**: Sol reviews product code before it merges | `README.md` (slice landing record) |
| Two Sol rounds; design first for locks, retries and authority; a round-2 red splits | Followed many pieces holding at round three; never measured after | **kept** in FLEET.md | SKILL-WATCH, [FLEET review](FLEET.md#review) |
| Race attack by a fresh sub-agent before READY | Often found something on sensitive code; UI-only attacks found nothing | **kept** for locks, sign-in, money, permissions and data separation only | `LEAN-RUNNING.md` |
| Opus reads every Codex fix diff (`FIX-DIFF-READ`) | No blocking catch in its short trial | **unproven** | `LEAN-RUNNING.md` |
| The lane runs its own fresh Sol review; Opus reads only sign-in, money and data separation; no Sol on styling or docs | Not measured yet | **unproven** ([open measures](#open-measures)) | [FLEET review](FLEET.md#review) |

## Model split

| What was tried | What it showed | Verdict | Source |
| --- | --- | --- | --- |
| Three tiers: Opus high, Opus medium, Sonnet for grunt work | Held for research; never ran | **dropped** | `MODEL-SPLIT-2026-10-02.md` |
| Opus 5.5 high for all product code, Sonnet only for mechanical jobs, Sol reviews by impact | Sonnet held on the mechanical jobs it got; effect on seat use never measured | **replaced by FLEET.md** | `BASELINE-2026-10-02.md` |
| Temporary split: Opus builds, Codex reviews and fixes, `SIMPLE` or `OPUS` tag per slice | No receipts in the record | **unproven**. Ended as planned | `README.md` (round record) |
| Codex (Sol) orchestrator on a large-context profile | Frequent handovers and poorer orchestration work | **replaced by FLEET.md**: Opus orchestrates | `EVIDENCE-CORRECTION.md` |
| Opus as thin director and orchestrator and for sensitive builds; Codex Sol builds ordinary pieces; Sol reviews | Checked weekly against the seats | **replaced**: Claude builds and Sol only reviews; the table lives in your model list | [FLEET models](FLEET.md#models) |

## Speeds, trunk and piece size

| What was tried | What it showed | Verdict | Source |
| --- | --- | --- | --- |
| Long prose briefs and no round cap | Few merges for the cost, and lanes skipped required steps | **dropped** | [HISTORY](HISTORY.md#from-long-prompts-to-short-briefs) |
| Self-contained briefs under about 600 words | A short brief carried everything compliance needed | **kept** | [HISTORY](HISTORY.md#from-long-prompts-to-short-briefs) |
| 400-line size gate | Tickets split into many parts, and nearly every fix needed a waiver | **dropped**: a guide, later 800 lines | LESSONS |
| Batches and slices, the medium speed | Slice pull requests too big to read, and many blocking findings per batch review | **dropped** for trunk | [HISTORY](HISTORY.md#build-speeds-before-trunk), `BASELINE-2026-10-02.md` |
| Fast: non-sensitive pieces merge on green checks, Sol reviews after | Did not hold | **dropped** | [HISTORY](HISTORY.md#build-speeds-before-trunk) |
| Trunk: each piece reviewed, then straight to `main` through the queue | Batch-size reviews gone | **kept** | `BASELINE-2026-10-02.md` |
| One Codex session owning delivery alone | No whole roadmap item delivered, and its "locally verified" candidate failed tests when audited | **dropped** | `CODEX-STALL-LESSONS.md`, `README.md` (single-owner record) |
| One Claude session as owner, in-session sub-agents, no director, about 800-line pull requests | Pull requests went green quickly, but the queue and SHA-tied review paperwork set a slow merge pace | **dropped**. The one-agent shape returns in FLEET.md for one feature or a switch-on | `OWNER-LESSONS.md`, [FLEET shape](FLEET.md#pick-the-shape-first) |

## Merge queue and CI

| What was tried | What it showed | Verdict | Source |
| --- | --- | --- | --- |
| Strict "up to date" rule before merge | A rebase, Sol re-checks and a full test run each time `main` moved | **dropped** once the queue came in | LESSONS |
| Shard CI for speed | Cost too many tokens | **dropped** | LESSONS |
| GitHub merge queue, with CodeQL as a scanning rule | Time in the queue was short; the wait came before enqueue. Red groups came from flaky tests already on `main` | **kept** | `BASELINE-2026-10-02.md` |
| Light checks on pull requests, full tests only in the queue, superseded runs cancelled | Merges came much faster | **kept** | `BASELINE-2026-10-02.md`, [CI-CHECKS](CI-CHECKS.md) |
| Self-hosted runner on the check machine | On a public repo an outside pull request could run code on it | **dropped** for public repos | SKILL-WATCH |
| Queue width set by runner slots; push-to-main CI cancelled while the queue runs; pull request CI only for the next in line | A wider queue added nothing, since groups sat unstarted; the cancel guard got merges moving again | **kept** | `README.md` (slice landing record) |
| Every CI job in about 10 minutes (CIITEM3) | Not measured after | **unproven** | SKILL-WATCH |
| An approved pull request not in the queue is a finding at every director check | Ready pull requests sat unqueued until a kick | **replaced by FLEET.md**: the loading bay picks up every ready pull request | `BASELINE-2026-10-02.md` |
| Merge scripts per orchestrator, then one merge tool, then an enqueue-only command | Script copies multiplied unreviewed; the tools never showed live use | **replaced by FLEET.md**: the loading bay | SKILL-WATCH |

## Lanes, seats, machines and sub-agents

| What was tried | What it showed | Verdict | Source |
| --- | --- | --- | --- |
| Fill every lane slot to the seat cap | Slow fills came from long waits and seat stops, not from dispatching | **kept**: in FLEET the orchestrator fills to the caps | `BASELINE-2026-10-02.md` |
| Seat stops changed during the week | Changing stops left the build idle with work waiting | **dropped**: set the stop once a week | `BASELINE-2026-10-02.md` |
| Heavy work split evenly between the owner's machine and the check machine | Work all went to the owner's machine, which then timed out tests | **dropped** for heavy runs on the check machine | `BASELINE-2026-10-02.md` |
| Heavy runs on the check machine, one local test process per lane | Leads still overloaded the check machine with test processes | **kept**. "Read both machines' load before a fill" waits for a skill pass | SKILL-WATCH |
| Fresh-only sub-agents and one sub-agents skill | Fewer blocking findings and fix rounds per piece, and far fewer bench failures with the skills | **kept** | SKILL-WATCH |
| A time limit on a sub-agent, flagged by the watchdog | Long runs before it had been spent on moot work | **kept** | `BASELINE-2026-10-02.md` |
| Disk floor and Sol container clean-up | Sol left large containers behind after each review and filled the disk | **kept** | `README.md` (slice landing record) |

## Handovers, boots and relays

| What was tried | What it showed | Verdict | Source |
| --- | --- | --- | --- |
| Lighter boot by role | The missed-items script flagged too much to score it | **unproven** | SKILL-WATCH |
| Orchestrator hands over at 50 percent context, not 30 | Orchestrators stayed in the seat much longer | **kept** | `BASELINE-2026-10-02.md` |
| Checks that matter run as scripts, not agent judgement | Verify watchdog behaviour against actual elapsed time and the session's text context gauge | **kept**. FLEET extends it to budgets and tripwires | `BASELINE-2026-10-02.md`, `LEAN-RUNNING.md` |
| Slim boot: state note, newest boot, register and recent event lines | Orchestrators booted with much less context used | **kept** | `README.md` (round record) |
| One unit of work per orchestrator turn | Owed work sat idle until a nudge | **dropped**: owed units run back to back | `LEAN-RUNNING.md` |
| Director lines typed into busy panes | Lines were lost at handovers | **dropped**: instructions live in files, panes get pointers | `EVIDENCE-CORRECTION.md` |
| Director over orchestrator over lanes, with lanes told to stop and report | Lane returns sat unread, and small fixes bounced between director and orchestrator | **replaced by FLEET.md**: lanes own their piece to merge; the director is thin | `ANSWERS.md`, `RELAY-LOG.md` |

## Paperwork and receipts

| What was tried | What it showed | Verdict | Source |
| --- | --- | --- | --- |
| Standing permission: agents answer routine questions and log each as `ORCH-DECISION` | Agents stopped stalling on answers they could give | **kept** for standing permission; the per-answer `ORCH-DECISION` line is **dropped**, since the event log keeps milestones only ([FLEET.md](FLEET.md#paperwork-four-things-per-agent-nothing-else)) | LESSONS, `README.md` (slice landing record) |
| Review-evidence lines tied to exact commit SHAs | Every move of `main` made every waiting pull request stale | **unproven**: the fix is a proposal that needs a security review | `README.md` (single-owner record) |
| Custody proofs at every lane close | They caught nothing, and paperwork grew to a large share of orchestrator events | **dropped** except for production, secrets and sign-in; then **replaced by FLEET.md** | `LEAN-RUNNING.md` |
| Check each wrap against real artefacts | Caught work left unpushed, unreported or incomplete | **kept**; the loading bay's description gate does the same job | `LEAN-RUNNING.md` |
| Three things per agent: a start line, a wrap-up on the pull request checked by the loading bay, tokens and time read by script | The wrap-up drifts from the code, so it was cut to two lines | **replaced** | none |
| `Why:`, `Left undone:` and `Closes` lines in the pull request description, checked by the loading bay; unfinished work becomes tickets; tickets close on merge by script; the code is the truth | Not measured yet | **unproven** | [FLEET paperwork](FLEET.md#paperwork-four-things-per-agent-nothing-else) |
| Agents that finish a task use a `close-out` skill (lines checked, tickets, a short record, the starter told); owner sessions keep the wrap-up | Not measured yet | **unproven** | [FLEET paperwork](FLEET.md#paperwork-four-things-per-agent-nothing-else) |

## Switch-ons

| What was tried | What it showed | Verdict | Source |
| --- | --- | --- | --- |
| Done means switched on: every ticket names its switch-on step | An audit found more coded than live | **kept** | SKILL-WATCH, [METHOD](METHOD.md#done-means-switched-on) |
| A frozen custom runner for a switch-on | Use the app's own tools; rehearse writes and preserve a restoration copy | **replaced by FLEET.md**: the app's own tools, a no-change rehearsal early, save before each write | [FLEET switch-ons](FLEET.md#switch-ons-and-deploys) |

## Open measures

The first slice built the FLEET.md way is the trial. It must measure:

1. **Tokens per merge**, against a baseline week of the earlier model. The ledger script (the panes plus each session log) runs back over that week first. Until it does, the comparison reads "pending".
2. **Work against overhead.** The daily split of tokens between builders and reviewers on one side and the director and orchestrator on the other. Target: at least 70 percent on the work.
3. **Merges per hour**, against the earlier model.
4. **Tripwires.** Count each review or switch-on cycle that restarts more than twice, and each 2-hour gap with no merge while work is in flight.
5. **Budgets.** The first week only calibrates the median and spread per ticket. The 1.5x and 2x alarms start after it.

Also owed: every **unproven** row above that names a measure.
