# M5 lane sweep

Lanes and Sol runs remove their own work copies when their work is pushed
(the `close-out` skill's tidy step). `lane-sweep.sh` is the weekly safety net
for what they leave on the M5: every git copy in the lanes folder (`$LANE_ROOT`) idle for 7 days
moves to the Bin, after its unpushed commits, uncommitted edits and small
untracked files are saved to `$LANE_ARCHIVE_ROOT/<date>/`. It never empties the
Bin; the owner does, and it prunes nothing. A moved worktree's record in its
repository goes to the Bin beside it as `<name>.git-admin`: moving both back
restores the worktree until the mirror's next `git gc`; the archive's verified
`unpushed.bundle` is the lasting copy of any commit made only there. The script's header lists what it never touches and why
a copy stays.

The report is added to the vault's `Orchestration/Lane Sweep/<date>.md`,
which the M5 syncs to the owner's other machines; the per-copy log is
`$LANE_ROOT/logs/lane-sweep-<date>.log`.

## Install on the M5

```sh
export LANE_ROOT=<LANE-ROOT> LANE_ARCHIVE_ROOT=<LANE-ARCHIVE-ROOT>
cp orchestration/m5/lane-sweep.sh "$LANE_ROOT/bin/lane-sweep.sh"
"$LANE_ROOT/bin/lane-sweep.sh" --dry-run | tail -12
"$LANE_ROOT/bin/lane-sweep.sh" --limit 3
sed -e "s#LANE_ROOT_DIR#$LANE_ROOT#g" -e "s#LANE_ARCHIVE_DIR#$LANE_ARCHIVE_ROOT#g" orchestration/m5/com.launchastro.lane-sweep.plist \
  > ~/Library/LaunchAgents/com.launchastro.lane-sweep.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.launchastro.lane-sweep.plist
launchctl print gui/$(id -u)/com.launchastro.lane-sweep | grep -A3 'event triggers'
```

It runs Sundays at 22:00 machine time (AEST). Tests:
`bash orchestration/tests/lane-sweep-cases.sh`.

# M5 check queue

`checks/` holds the scripts that run a repository's full checks on the M5:
`checks.sh` runs every step into `summary.tsv`; `green-run.sh` finds the newest
all-green run of a commit, which is reused instead of a new run;
`checks-locked.sh` waits for a turn, then runs `checks.sh`. Rounds call it
through their `checks-m5.sh` wrappers, which make the `chk-<sha>-<n>` worktree
and copy `out-<sha>-<n>` back.

`check-queue.py` gives the turns (owner, 27 Oct 2026, #333): one queue for
every project, in arrival order, up to 3 runs at once. A second or later run
starts only while the M5 reads under 0.8 load per core (METHOD "Big runs by
machine") and 2 minutes after the last start, since the load average lags a
new run. The first run always starts. A waiter for a commit of the same project
already running waits for that run and lets later waiters by. A waiter or run
whose process has gone loses its place. Once the mode is `on`, another project
uses it as `check-queue.py run --project <name> --key <sha> -- <command>`; in
shadow `run` refuses (exit 3) and runs nothing, since the old slots would not
count its run.

Its folder is `~/Desktop/Agents/check-queue/`: `state.json`, `queue.log` and
`mode`. `check-queue.py status` prints who runs and who waits. A damaged
`state.json` holds every start, since it may have held live runs, and logs
`DAMAGED`; once `ps` shows no check run, `check-queue.py repair` sets it aside.

## Shadow, then the flip

Until the mode is `on`, `checks-locked.sh` keeps the interim slots the M5 ran
from 27 Oct 2026 (slot 1 any time, slots 2 and 3 while the 1-minute load is
under 12; `.checks.lock`, `.checks.lock2`, `.checks.lock3`) and the queue only
writes a `SHADOW` line to `queue.log` each time a slot is taken: `order=agree`
when the slot went to the longest waiter (`jump:head=seq<n>` when it didn't),
and `would=start:slot=<n>` or `would=hold:<reason>`. A queue error never stops
the old path in shadow; once on, a broken queue fails the run rather than
falling back to the old slots.

Each run takes its place and reads the mode in one step under the queue's
lock, and `set-mode` changes the mode under that lock only while no run waits
or runs, in the queue or in an old slot, so the two kinds never overlap. A
caller that couldn't reach the queue reads the mode again once it holds an old
slot and queues instead if it is now `on`; `set-mode` checks the slots again
after writing and puts the old mode back if one appeared. It prints
`live: ...` and exits 1 when refused; try again between runs. The flip,
after 10 shadow lines agree:

```sh
grep SHADOW ~/Desktop/Agents/check-queue/queue.log | tail -10
python3 ~/Desktop/Agents/repos/code-factory/check-queue.py set-mode on \
  --legacy ~/Desktop/Agents/repos/code-factory/.checks.lock{,2,3}
```

Back to the old slots: the same command with `shadow`.

## Install on the M5

From a checkout of `main` on the M5, between runs:

```sh
bash orchestration/m5/checks/install.sh
```

It writes each file beside its target and renames it over: bash reads a script
as it runs, and an edit in place killed a run on 26 Oct 2026. Tests:
`python3 orchestration/tests/check-queue-cases.py`.
