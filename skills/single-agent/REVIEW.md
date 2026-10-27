# Sol's review, run by the single agent

Open at step 7. The loop is builder, Sol, builder fixes, Sol, until Sol approves the exact head. Sol reviews every head, low risk included, as both Sol variant pages say ([hardened-production.md](../../docs/variants/hardened-production.md), [production.md](../../docs/variants/production.md) "What stays strict" 1). Review and rounds go by SINGLE.md's [rank table](../../docs/SINGLE.md#risk), so a high-risk PR also gets one fresh Opus read ([Review rounds](../../docs/METHOD.md#review-rounds)). Effort follows [Sol effort](../../docs/SOL-EFFORT.md), with the PR's rank kept for fix passes.

Before each review, update the Code Factory clone `C` from `main`. Verify `python3 orchestration/reviewer/make_sol_prompt.py --help` and, in `C`, `source orchestration/reviewer/codex-shim.sh; type sol_review_effort run_sol_review`.
A missing renderer or selector blocks the review; never fall back to an inline
diff or inherited effort.

1. **Render the prompt** from the template in `code-factory`'s [SOL-PROMPT.md](../code-factory/SOL-PROMPT.md), with its two inserts from `build-review`'s [ALWAYS-BLOCKS.md](../build-review/ALWAYS-BLOCKS.md) and [REVIEWER.md](../build-review/REVIEWER.md). Single mode has no brief, so fill these yourself:
   - pull request, repository, branch, base SHA, full head SHA;
   - Worktree: a detached worktree at that head, outside your working one;
   - Speed: `slow`;
   - the ticket's criteria, numbered;
   - Ceilings: context 60 percent, wall 30 minutes;
   - Boot stack method path: Code Factory `docs/SINGLE.md`;
   - Checks: the repo's check commands from its `AGENTS.md`;
   - the diff from the base to the head.

   Use Code Factory's `orchestration/reviewer/make_sol_prompt.py`: first and fix prompts open with the exact no-skill line, and every diff is a separate private file, never inline. Save the prompt outside the repo.
2. **Run it headless.** With an assigned reviewer shim, use `run_sol_review <seconds> <risk> <prompt-file>`; otherwise select the same explicit effort and use the active login:

   ```sh
   source ~/.cache/code-factory/orchestration/reviewer/codex-shim.sh
   review_effort=$(sol_review_effort <low|medium|high>) || exit
   codex exec --dangerously-bypass-approvals-and-sandbox -m gpt-6.1-sol -c "model_reasoning_effort=$review_effort" - < prompt.txt
   ```

   Sol posts one comment ending in its five footer lines (the work map reads it). On a private repo, add to the prompt's instructions that Sol then sets the verdict the merge script reads, on the head it reviewed:

   ```sh
   gh api repos/<owner>/<repo>/statuses/<full-head-sha> -f context="Sol verdict" -f state=<success|failure> -f description="<approve|changes requested>"
   ```

   Done when Sol has exited and `gh api repos/<owner>/<repo>/commits/<full-head-sha>/statuses` lists a `Sol verdict` that matches its comment.
3. **Fix every finding.** Apply each finding's failing test or scenario unchanged, make the smallest change that passes it and the suite, deleting before adding, and push once per round. Sol counts any open finding as `changes requested`, and only a new head clears it. A finding of the same kind as the last round's: fix the whole class or tighten the rule into a strict criterion in Sol's criteria file, never another patch (SINGLE.md).
4. **Re-review the fix diff only:** the same prompt with the fix-head line and the range from the reviewed head to the new one.

Still `changes requested` after the rank's last round: take METHOD's ladder ([Review rounds](../../docs/METHOD.md#review-rounds)). Split the red part out as its own piece, with Sol checking the removal, and merge the rest; or get one director read, whose findings hold the piece. That read is the director's where there is one; otherwise a fresh Opus sub-agent gives it. A red touching money or sensitive data, or one with no clean split, takes that read; whoever started you hears by your `HELD` line. While it waits, add the `hold` label, comment the open finding on the PR, and go to step 9. The owner hears only what [What reaches the owner](../../docs/METHOD.md#what-reaches-the-owner) lists.
