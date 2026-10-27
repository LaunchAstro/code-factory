# What the merge script's answer means

Open at step 8 on any answer but `MERGED #<n> head=... method=... risk=...`. A refusal prints `WAIT gate=... reason=...`. The script's full gate list is Code Factory's [enqueue.md](../../orchestration/enqueue.md).

- **`WAIT` on a check, the description or the risk line** (`gate=<check-name>`, `gate=description`, `gate=risk`): fix that gate and rerun the script once.
- **`gate=risk reason=not-low <path>`:** the change touches a path a low rank never covers. Re-rank it medium or high, edit the `**Risk:**` line, and go back to step 7.
- **`gate=sol`:** Sol's approval of this exact head is missing or refused. Go back to step 7.
- **`gate=head`, or the head moved** (a fix pushed, or the branch updated from `main`): Sol's approval covers the old head only. Run step 4 on the new head. A rebase carries the approval only as [METHOD item 6](../../docs/METHOD.md#building-on-main) allows (hardened production: under [A2](../../docs/variants/hardened-production.md#production-learnings-adopted-owner-26-october-2026)'s condition too; production: [production.md](../../docs/variants/production.md) change 2), and only through Sol's quick range-diff check at step 7, which posts the verdict on the new head (or #272's carry tool once it lands). Any other change gets Sol's narrow check of what changed, and Sol re-runs the touched proofs. Never post a `Sol verdict` status by hand.
- **`gate=merge` on a behind pull request** (`gh pr view <n> --json mergeStateStatus` reads `BEHIND`): on a private repo with no merge queue and no tree-binding landing tool, GitHub's "require branches to be up to date" stays on, whatever the agent count, and is the owner's setting. Update from `main`, carry per the line above, and rerun the script.
- **Any other `gate=merge`, `gate=enqueue`, `gate=dropped`, `gate=base`, or any other exit 2 (`gate=read-...`):** never rerun. Hold.
- **A second `WAIT` after one fix:** hold.
- **`ENQUEUED`, `REQUEUED` or `ALREADY-QUEUED`:** check `gh pr view` every 5 minutes, up to 60 minutes, then hold.

To hold: add the `hold` label and comment the gate and its reason on the PR, then go to step 9.
