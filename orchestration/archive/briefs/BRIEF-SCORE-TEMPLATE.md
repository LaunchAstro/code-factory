# Lane SCORE-<ROUND>: score the run end to end

You are lane `SCORE-<ROUND>`, Fable 5.1, seat <SEAT>. This file is your whole brief. Paths are relative to `<ORCHESTRATION-ROOT>`; the trial repository is `<OWNER>/<REPO>` (clone `<CLONE>`); `gh` active account `<GH-ACCOUNT>`, never `gh auth switch`. Boots only after the orchestrator has decided every pull request in the round.

## The pass line
The round ran `<T>` real tickets (no planted defects, no key) through the loop: BUILD-<ROUND> opened them, Sol reviewed, at most one fix pass each, the orchestrator decided from GitHub counts. Pass means all of:
1. Every pull request reached its decision with no hand on CI: no rerun, no update-branch, no admin merge, no owner decision. Prove it from run attempts, single-parent branch commits, the merge method and the runner's rows.
2. Every hold cites a `Criterion:` finding that is real: reproduce each one against the module at that head. A hold on a finding you cannot reproduce is a FALSE HOLD and a fail.
3. Every merged pull request leaves `main` green: `corepack pnpm check` at the final `main`, and the ticket's own reproduction from its issue no longer reproduces.
4. Sol at most <REVIEW-REVIEWS-PER-PULL-REQUEST> sessions per pull request and <REVIEW-REVIEWS> in the run.
5. A fix head Sol approved merged on its own, or say the condition was not exercised.
6. Over-engineering sweep of every merged diff against its plan, the fixed bar: a config knob nothing sets, a case proving the same line twice, an abstraction with one caller, a stub for a later stage, error handling for a state the counters make impossible. Table each hit with `file:line`. One or more hits is a finding, not a fail; none is what the owner is looking for.
7. Navigability: without reading any lane file, answer from the repository alone, citing the file you found it in: where does the size rule live and what runs it; where is the review of record parsed; where does a new ticket's plan go and what checks it. If any answer took more than one wrong turn, say so.
Name the failing condition and pull request if any.

## Read, in this order
`docs/rounds/ROUND7-REPORT.md` and `docs/rounds/ROUND7-LEDGER.tsv` in the Code Factory repository (the shape to match); then every `handbacks/*<ROUND>*.md`, every `loop/work-*<ROUND>*.tsv`, `loop/STATUS.md`, `events.log` from the line `<ROUND-BOUND-LINE>`, and on GitHub each of the round's pull requests: reviews, checks, check-run attempts, workflow run attempts and merge state.

## Report
Pull requests <SCORE-PULL-REQUESTS>, to `<ORCHESTRATION-REPO>` from your own worktree, squash merged with `--delete-branch`: `<REPORT-DIR>/ROUND<N>-REPORT.md` (under 800 words, pass or fail first, then the seven conditions, then what the run did not evidence) and `<REPORT-DIR>/ROUND<N>-LEDGER.tsv`. Nothing else changes in either repository.

## Ceilings
Context <SCORE-CONTEXT> percent. Wall <SCORE-WALL> minutes. Pull requests <SCORE-PULL-REQUESTS>. Pushes <SCORE-PUSHES>. Sol <SCORE-REVIEWS>. Copilot 0. Sub-agents 0. No spend. A `BLOCKER` or unexpected 4xx: stop, handback with `LANE-SCORE-<ROUND>-HANDBACK-POSTED`.

## Handback
Trail `.local/lanes/loop/work-SCORE-<ROUND>.tsv`. Handback `.local/lanes/handbacks/SCORE-<ROUND>.md`, one screen, ending `LANE-SCORE-<ROUND>-DONE`; then `echo "$(date -u +%FT%TZ) LANE-SCORE-<ROUND>-DONE" >> .local/lanes/events.log`; then the `close-out` skill, record title `<DATE> SCORE-<ROUND>, the run against the pass line`; end your last message with the phrase.

Your first reply: the model you are running and `LANE-SCORE-<ROUND>-BOOTED`. SCORE-<ROUND>-BOOT-TAIL
