# Lane CLEAN-<ROUND>: clear the local test debris, table the rest

You are lane `CLEAN-<ROUND>`, Opus 5, seat <SEAT>. This file is your whole brief. Paths are relative to `<ORCHESTRATION-ROOT>`; the clone is `<CLONE>`. Read first, then act. Nothing on GitHub changes; nothing in either repository's tracked files changes.

## Do, locally
1. Worktrees. `git -C <clone> worktree list`. Remove every worktree under `<clone>/.worktrees/` except `BUILD-<ROUND>-*` (a lane is using those now), and every detached worktree under `/private/tmp/`. Before each removal confirm it is clean (`git status --short` empty) and its branch, if any, is pushed (`git log origin/<branch>..HEAD` empty); leave a dirty or unpushed one and list it. Then `git worktree prune`.
2. Lane files. Under `.local/lanes/`, move to `.local/lanes/_archive/<ARCHIVE-DIR>/` (keep names) every `BRIEF-*` file and every `.ORCHESTRATOR-STATE.*.bak` dated before `<CUTOFF-DATE>`, and every `loop/work-*.tsv`, `loop/opus-review-prompt-*` and `loop/sol-review-prompt-*` file that belongs to a round before `<KEEP-FROM-ROUND>`. Leave `events.log`, `ORCHESTRATOR-STATE.md`, `ORCHESTRATOR-BOOT-*`, `loop/STATUS.md`, `loop/runner-budget.json`, `loop/codex-shim.sh`, every `handbacks/*`, and everything named `<KEEP-FROM-ROUND>` or later. That is the whole list this kit creates: a round writes no common file, so leave anything else under `.local/lanes/` where it is and put it in the table at step 3. Count what moved.
3. Table, do not do. One table for the owner of every outward-facing item: the trial repository `<OWNER>/<REPO>` itself; every open pull request on it with its state and label; every remote branch not `main`; anything the round left on `<UPSTREAM-OWNER>/<REPO>`. Each row: what, where, what deleting it loses, recommendation. Deleting an outward-facing thing is the owner's call, never the lane's.

## Do not
- Delete anything on GitHub, any branch on a remote, any handback, any file from `<KEEP-FROM-ROUND>` or later, or anything you have not read.
- Spend money, start a sub-agent, touch the `BUILD-<ROUND>-*` worktrees.
- Build around a `BLOCKER`: stop, handback with `LANE-CLEAN-<ROUND>-HANDBACK-POSTED`.

## Ceilings
Context 30 percent. Wall 30 minutes. Pull requests 0. Pushes 0. Sub-agents 0.

## Handback
Trail `.local/lanes/loop/work-CLEAN-<ROUND>.tsv`. Handback `.local/lanes/handbacks/CLEAN-<ROUND>.md`: worktrees removed and left (with reasons), files moved by category with counts, the table for the owner. End with `LANE-CLEAN-<ROUND>-DONE`, then `echo "$(date -u +%FT%TZ) LANE-CLEAN-<ROUND>-DONE" >> .local/lanes/events.log`, then the `close-out` skill, record title `<DATE> CLEAN-<ROUND>, test debris cleared locally`, and end your last message with the phrase.

Your first reply: the model you are running and `LANE-CLEAN-<ROUND>-BOOTED`. CLEAN-<ROUND>-BOOT-TAIL
