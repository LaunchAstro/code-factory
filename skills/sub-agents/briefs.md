# Briefs and build pieces

## Brief

Under 40 lines, given whole as the prompt. A build piece keeps the `[build]` lines without the tag; any other job drops them:

```text
You are sub-agent <x> of <LABEL>, starting fresh: this brief is all you know. Job: <what, one line>.
Done when: <acceptance rows or the question answered>, proven by <tests or evidence>.
Read first: <repo>/AGENTS.md and <conventions files>. Rulings that apply: <quoted, with their source>.
Inputs: <paths, shas, links>. Change only <files or folders>, or nothing (read-only); write any report to <path>.
[build] Work only in <worktree path> on branch <branch>, off <sha7>; other paths stay untouched.
[build] Resources: ports <ports>, database <label, cluster and port>, at most <n> test workers. Name any container or server you start <LABEL>-<x>-<what>, stop only those, by PID after checking the command, and remove them before you reply.
[build] Tests first: each new test fails for its criterion's reason before the code. Focused tests only: <command>. Full checks are the lead's.
[build] Commit with <the repo's trailers>; keep work in progress as commits, never `git stash`, whose stack every worktree of the repo shares. The lead pushes and opens the pull request.
Needing anything outside this brief: stop and reply SUBAGENT-BLOCKED <x> <reason>.
Otherwise reply with one line: SUBAGENT-DONE <x> <result, or sha7 and focused pass/total>. That reply is your whole hand-back; the lead finishes the lane with `close-out`.
```

## Independence test

Two pieces are independent only if all hold:

1. No file is changed by both. Legacy only, in a repo without area files ([Building on `main`](../../docs/METHOD.md#building-on-main) item 4, no shared hotspot files): both may append to one list (a suite registry), merged as a union at the join.
2. Neither needs the other's code to build or pass its tests.
3. Neither waits on unbuilt or unmerged work, unless it builds to an agreed interface on labelled mock data.
4. At most one adds a database migration.

## Worktrees

One per piece, off your branch head, each with its own ports, `<LABEL>-<x>-` container names, and its own database for tests that change database state:

```sh
git worktree add ../<LABEL>-<x> -b <branch>-<x> <head-sha>
```

## Join

In your own worktree, one piece at a time, in reply order. `git diff --stat <head-sha>...<branch>-<x>` shows only the piece's files; a file outside them gets reverted on its branch first, or the piece is rebuilt in order.

```sh
git merge --no-ff <branch>-<x> -m "join piece <x>: <what>"
```

- A conflict only in that legacy append-only list: keep both sides' lines and commit.
- Any other conflict: `git merge --abort`, and rebuild the piece in order.
- After the merge, rerun the piece's focused tests on your branch and fix any red.

## Ending one

`SUBAGENT-BLOCKED` ends it: do the job yourself, in order. A sub-agent still running at your close or handover:

1. `TaskStop` it by id; `docker ps -a --filter name=^<LABEL>-<x>-` and `ps` show nothing of it running.
2. Stage only its listed paths (`git add <paths>`), run `gitleaks protect --staged`, commit `wip piece <x>: ended at handover`, push the branch and remove its worktree.
3. File a ticket for what is unfinished, naming the branch, and put it in your PR's `Left undone` line.
