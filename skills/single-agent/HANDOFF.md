# Hand off to a fresh session

Open when `G ctx` prints `WRAP`, `HANDOFF` or `HARD`, or when your brief is a hand-off note. The numbers behind the words are METHOD's [Seats, lanes and stops](../../docs/METHOD.md#seats-lanes-and-stops), the same for every role; `orchestration/single/handoff.sh` reads the gauge and prints the word.

**Starting from a note,** skip the steps below: re-read each of its pull requests live, then resume the one in hand at the step the note names.

1. **Settle the task in hand** (a pull request, a ticket, a fix round).
   - `WRAP`: finish it, reading the gauge after every push as before, then go on to step 2.
   - `HANDOFF`: park it. Finish it first only when that needs context you hold and a note cannot carry; write why in the note, and run `G ctx` after every push.
   - `HARD`: park it.

   Parked means committed and pushed, with Sol's round, last verdict and the head it read written into the note. Done when: in every worktree you used, `git status -sb` shows no changes and a branch tracking its remote with nothing ahead.
2. **Write the note.** `G note <owner/repo> --clone <the repository's main checkout> <each open pull request>` prints its path. Replace every `<fill>`: the area, job and variant, the pull request in hand and the step it stopped at, the tickets left in order by number, the live install state, and the owner's words not yet in a ticket, verbatim with the date. Point at tickets, pull requests and commits rather than copying them; keep secrets out. Pick the successor seat with `seat-gauge` as in step 3 before the dry run. Done when: `G dispatch <note> --cwd <dir> --label <label> --seat <seat> --dry-run` prints `DRY-RUN`.
3. **Launch your successor.** Pick its seat with `seat-gauge`: one `claude-subscription-switch` has already seeded (`~/.claude-seat-<seat>` exists). Pick its label by the project's lane rules. Run `G dispatch <note> --cwd <the repository's main checkout> --label <label> --seat <seat>`, then confirm it per `dispatch` step 5 and its GOTCHAS.md. Send keys only to a `blocked` tab that shows the trust question, never to a `working` one. `BLOCKED: not inside herdr`: give the owner the note's path instead. Done when: the new tab shows `working`, or the owner has the path.
4. **Stop.** Reply your `HANDED-OFF` line (SKILL.md's Output), finish with `close-out` naming your successor's tab, and leave your pane open for the owner. Done when: the close-out record exists.
