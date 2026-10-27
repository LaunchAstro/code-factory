# Sol review effort

Owner decision, 17 October 2026, private ticket #188.
This applies to **both full (fleet) and single mode**, including fix passes,
capability reads, skill reviews and blind grading. It replaces the blanket
high-effort review default. It does not change builder models, review rounds,
who must review, approval requirements or spend limits.

| Review risk | Codex `model_reasoning_effort` |
| --- | --- |
| High | `high` |
| Medium or low, whenever a review runs | `medium` |

## High risk

This is the one list of what reviews at `high`; METHOD, FLEET, SINGLE and the
skills link here rather than copy it. High means money, sign-in and
permissions, secrets, client or personal data, database changes, deploy,
merge or release gates, or anything that cannot be undone. A change to a
merge-gate, review or safety rule is high whatever its files, a docs-only
pull request included. Styling, wording, tests and docs rank low, and Sol
reads them at `medium`, only when they change no behaviour, data handling or
security and no such rule. Use the higher rank when unsure. Production adds
its own: anything that deletes, moves or renames files, or picks where they go
([production.md](variants/production.md#what-stays-strict), rule 4).

Other lists differ on purpose and keep their own homes: the ordinary or
sensitive build tag picks builders and reviewers
([METHOD.md](METHOD.md#before-the-build-plan-deep)); the race attack
([METHOD.md](METHOD.md#what-review-always-covers)); the director's read
([FLEET.md](FLEET.md#review)); what the merge script never lets rank low
([enqueue.md](../orchestration/enqueue.md#with-no-merge-queue)). Select review
effort from this risk rule, not the tag or speed. The rank sets effort only:
whether Sol reviews at all is [Review rounds](METHOD.md#review-rounds)' rule,
and in both Sol variants Sol reviews every head.

## Rank, then launch

Rank the whole pull request before review, and keep that rank for its fix
passes. A small fix in a high-risk pull request still uses `high`. Record the
rank and reason on the PR; carry it into the brief and reviewer launch.

With the project's assigned reviewer shim configured:

```sh
source orchestration/reviewer/codex-shim.sh
run_sol_review 1800 <low|medium|high> /absolute/path/to/prompt.txt
```

The helper selects the effort and model explicitly, uses the existing token
and deadline boundary, and refuses a missing/unknown rank or extra flags.
It never prints a token. Render the prompt with the [file-based renderer](../orchestration/reviewer/README.md#render-a-sol-prompt).

Without an assigned reviewer shim, use the active login and the same selector:

```sh
source ~/.cache/code-factory/orchestration/reviewer/codex-shim.sh
review_effort=$(sol_review_effort <low|medium|high>) || exit
codex exec --dangerously-bypass-approvals-and-sandbox -m gpt-6.1-sol \
  -c "model_reasoning_effort=$review_effort" - < prompt.txt
```

Either way, the sourced shim makes the session wait for one of the login's
Codex slots first ([Codex slots](../orchestration/reviewer/README.md#codex-slots-one-cap-for-the-whole-login)).

The merge script consumes the exact-head `Sol verdict` status. It does not
launch Codex or select effort; the launch path owns this setting. Do not add a
model/effort claim to a success status as a substitute for running the review.

Proofs: `python3 orchestration/tests/sol-effort-cases.py` exercises the real
shim with a fake Codex and a disposable token fixture. No real review starts.
