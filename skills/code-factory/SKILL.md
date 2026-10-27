---
name: code-factory
description: The orchestrator's Code Factory build policy. Use when writing a build lane's brief, or checking a READY line, review result or merge.
metadata:
  job: orchestrator's build policy
  form: reference
  source: local
  version: 0.5.0
---

The orchestrator's **build policy**: each role's boot stack and the rules its proof is checked against.

## Not for
- Panes, seats, dispatch mechanics and handover: `orchestrator` owns that.
- Relaying the owner's words: `director` owns that.

## Inputs and authority
- Needs: the round folder, the project method file and the build variant (none set: hardened production). Missing: reply `BLOCKED: need <input>`.
- May: write briefs, fill lanes, unblock and answer them.
- Never: write, review or merge product code; lanes build and run their own Sol review; the merge script merges.

## Rules

1. **Stacks at boot.** Each brief names the role's whole stack by path, with scope, input SHA, numeric ceilings and output path; the agent runs it unprompted. Builder, Opus 5.5 high: `build-review` SKILL.md, [CHECKLIST.md](../../docs/CHECKLIST.md), project method, close-out. Sol, GPT-6.1-Sol, headless: the prompt in [SOL-PROMPT.md](SOL-PROMPT.md). Cleanup lane: `batch-cleanup` SKILL.md, only its pass file, that pass's leaf skill at its pinned path, project method, close-out. No worker gets another role's stack; a builder's never includes `orchestrator`, `herdr`, this skill (except SOL-PROMPT.md, which the lane opens) or a clean-up pass; drop them from any older template. Evidence: every path resolves; the BOOTED line acknowledges the stack.
2. **Name the variant** ([Build variants](../../docs/METHOD.md#build-variants)): hardened production, production or prototype. The owner picks: offer yours with a one-line reason in the binding message and record his answer; a prototype needs his yes. `slow` is hardened production; METHOD's Old names cover the rest. Production runs METHOD with [production.md](../../docs/variants/production.md)'s changes, which win. A prototype lane follows [prototype.md](../../docs/variants/prototype.md), never `build-review` or `single-agent`. Evidence: the owner's recorded pick in each brief; `variant=hardened|production` on each READY line.
3. **The merge script merges** (`orchestration/enqueue.mjs`): every required check green by name, plus, in hardened production and production, Sol's approval of the exact head (or one carried per the variant, [INTEGRATOR.md](INTEGRATOR.md) step 4). There, the lane marks ready only with a clean security review and a green conformance proof for a protected part; you confirm both on its PR first, or the lane is `BLOCKED`. A prototype merges on green checks and both sweeps, only in its own repository, never with real client data or files, sign-in, permissions, money or a deploy. The five classes in [What review always covers](../../docs/METHOD.md#what-review-always-covers) always block, as does any real correctness defect. Evidence: head SHA, Sol, security review and any conformance proof URLs (prototype: the sweep results) and check names per merge.
4. **Pull request size** per [Pull request size](../../docs/METHOD.md#pull-request-size), every variant. In hardened production and production each stands alone on `main`, never stacked (hardened production's exceptions: [INTEGRATOR.md](INTEGRATOR.md)). Evidence: lines per pull request.
5. **Checkpoints.** Verify proof at dispatch, READY, review result, FIX-PUSHED, the PR's three lines and the close-out record; remind only for the missing item and hold the dependent step until it lands. Check rounds and fix size per [INTEGRATOR.md](INTEGRATOR.md); a re-cut's narrow checks never go to the owner as a budget question. Evidence: each reminder names its item.
6. **The owner**: routine calls are yours, mentioned at the next check-in, never as a question; only the items in [What reaches the owner](../../docs/METHOD.md#what-reaches-the-owner) go up, batched, one line each with a recommendation. Evidence: the batched lines.

## Output
Briefs with rule 1's stacks, each merge's rule 3 evidence, and the [Quality targets](../../docs/METHOD.md#quality-targets) report at each section end.

## Reads
- [INTEGRATOR.md](INTEGRATOR.md) at each review result, merge, rebase and section end.
