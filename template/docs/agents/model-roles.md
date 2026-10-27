# Model roles and development context

[AGENTS.md](../../AGENTS.md) declares Code Factory's route as the only router.
Pstack supplies selected standards inside it.

| Role                       | Responsibility                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planner                    | Resolve open requirements and prepare the specification and proposed ticket boundaries.                                                                                                                                            |
| Builder                    | Own one ticket, isolated worktree, and branch. Produce implementation and evidence.                                                                                                                                                |
| Independent model reviewer | A frontier model from a different company than the builder's, in fresh context. Inspect the exact files, diff, specification, and boundaries.                                                                                      |
| Security reviewer          | Review sensitive changes before their pull request under the repository's security procedure.                                                                                                                                      |
| Verifier                   | Exercise the integrated behaviour and inspect durable results.                                                                                                                                                                     |
| Owner (`<OWNER-HANDLE>`)   | Decide a held pull request and set the policy. The merge itself is an act on the counts, taken by the orchestrator or the runner: see [ruleset](../plan/ruleset.md). Approve the final sandbox contract before its implementation. |
| Conformance proof          | The component's conformance test must be green before a change to one of the 8 protected components merges. A check, not a person, and this template ships neither the tests nor the context: see [ruleset](../plan/ruleset.md).   |

The builder cannot approve its own work. A model's report is not a
conformance proof. A review of a previous revision does not cover later
changes.

## Fresh context and handoff

Start each ticket in a fresh context. Load repository instructions, the
current decisions, the specification, the ticket, and current evidence.
Verify the applicable runtime memory settings. Private conversation memory
must not supply requirements or a hidden second task store. Product tasks,
knowledge, approvals, and execution records remain persistent.

A written handoff includes the ticket and acceptance criteria, the exact
revision or candidate manifest, verification commands and results, findings
with file references, and their disposition. The receiver inspects the actual
artefact. An earlier agent's assurance does not replace that inspection.

Keep comments for non-obvious reasons and constraints. Keep intent and durable
decisions in concise prose. The capability registry generates navigation when
implemented; do not maintain a competing manual inventory.

## Scope and evidence

Complete authorised reversible work. Spending, outward messages, destructive
actions, production changes, and publication require the applicable explicit
authority. A local preparation approval does not authorise those actions.

No model calls run in CI under this foundation. Any later API-based evaluation
requires an approved budget and credential arrangement. Local tooling tests,
independent model review, and conformance proofs are separate forms of
evidence.
