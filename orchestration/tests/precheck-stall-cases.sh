#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Cases for orchestration/precheck-stall.sh on fixture round logs, with a fixed
# clock. Run checks read scratch PID folders or a stub ssh; no case reaches a
# real machine, pane or GitHub.
#
#   bash orchestration/tests/precheck-stall-cases.sh
set -uo pipefail

check=$(cd -- "$(dirname -- "$0")/.." && pwd)/precheck-stall.sh
scratch=$(cd "$(mktemp -d)" && pwd -P)
started=()
trap 'for p in "${started[@]}"; do kill "$p" 2>/dev/null; done; rm -rf "$scratch"' EXIT
fails=0
ok() { printf '  PASS  %s\n' "$1"; }
no() { printf '  FAIL  %s\n        %s\n' "$1" "$2"; fails=$((fails + 1)); }

NOW=2026-10-19T06:00:00Z
export PRECHECK_NOW=$NOW PRECHECK_PIDS_A= PRECHECK_PIDS_B=
# at MINUTES-BEFORE-NOW: a log timestamp that many minutes before $NOW.
at() { printf '2026-10-19T%02d:%02d:00Z' $(( (360 - $1) / 60 )) $(( (360 - $1) % 60 )); }
# round NAME: a fresh round folder with events.log read from stdin.
round() { mkdir -p "$scratch/$1"; cat > "$scratch/$1/events.log"; echo "$scratch/$1"; }
alerts() { cat "$1/RELAY-LOG.md" 2>/dev/null | grep -c 'RELAY-ALERT'; }
# has NAME ROUND TEXT...: every text is on one RELAY-ALERT line.
has() {
  local name=$1 dir=$2 line; shift 2
  line=$(grep 'RELAY-ALERT' "$dir/RELAY-LOG.md" 2>/dev/null)
  for t in "$@"; do line=$(grep -F -- "$t" <<<"$line"); done
  [ -n "$line" ] && ok "$name" || no "$name" "no alert with: $* in: $(cat "$dir/RELAY-LOG.md" 2>/dev/null)"
}
none() { [ "$(alerts "$2")" = 0 ] && ok "$1" || no "$1" "$(cat "$2/RELAY-LOG.md")"; }

echo "stalled batches"
R=$(round stalled-a <<EOF
$(at 300) ORCH PRECHECK-WAIT PR 1900 head 1111111111
$(at 200) LANE-OA-Precheck-3 START batch of 6: #1901 #1902 #1903 #1904 #1905 #1906 after the queue's #2099
$(at 100) LANE-OA-Runs-R2 START M5 slot (after Precheck-3 END 05:00Z)
$(at 90) LANE-OA-Runs-R2 ack waiter on '^<UTC> LANE-OA-Precheck-N END b-1901'
EOF
)
ROUND=$R "$check"
has "line A START with no END past 190 min" "$R" "[precheck-stall A $(at 200)]" "line A" "#1901 #1902 #1903 #1904 #1905 #1906" "200 min"
ROUND=$R "$check"
[ "$(alerts "$R")" = 1 ] && ok "a second run writes nothing more" || no "a second run writes nothing more" "$(cat "$R/RELAY-LOG.md")"
# A NUL byte in RELAY-LOG.md made a grep that skips binary files (ugrep, the
# agent shells' grep, does) miss the key, so every run wrote the alert again.
# The stub grep does the same: without -a, a file holding a NUL never matches.
mkdir -p "$scratch/binarygrep"
cat > "$scratch/binarygrep/grep" <<'STUB'
#!/bin/sh
last=; for a in "$@"; do last=$a; done
text=no; for a in "$@"; do case $a in --) break ;; --*) ;; -*a*) text=yes ;; esac; done
if [ "$text" = no ] && [ -f "$last" ] && ! LC_ALL=C tr -d '\000' < "$last" | cmp -s - "$last"; then exit 1; fi
exec /usr/bin/grep "$@"
STUB
chmod +x "$scratch/binarygrep/grep"
printf 'a pasted line with a \000 byte\n' >> "$R/RELAY-LOG.md"
PATH="$scratch/binarygrep:$PATH" ROUND=$R "$check"
[ "$(LC_ALL=C grep -ac 'RELAY-ALERT' "$R/RELAY-LOG.md")" = 1 ] && ok "a NUL byte in the relay log does not repeat the alert" \
  || no "a NUL byte in the relay log does not repeat the alert" "$(LC_ALL=C grep -a 'RELAY-ALERT' "$R/RELAY-LOG.md")"

R=$(round stalled-b <<EOF
$(at 195) LANE-OA-Precheck-B CLAIM 2101 2102 line=B (run B-2101-c0ffee1-2102-bead002-on-2000 on main 0aa0001)
$(at 194) LANE-OA-Precheck-B NOTE batch B-2101 check1 red, suspect #2102
EOF
)
ROUND=$R "$check"
has "line B claim with no END past 190 min" "$R" "[precheck-stall B $(at 195)]" "line B" "B-2101-c0ffee1-2102-bead002-on-2000" "195 min"

R=$(round under <<EOF
$(at 185) LANE-OA-Precheck-2 START batch #2105 abc0004 #2106 abc0005, 5 workers
$(at 185) LANE-OA-Precheck-B CLAIM 2103 2104 line=B (run B-2103-fade003 on main 0aa0002)
EOF
)
ROUND=$R "$check"
none "185 min into a batch is no stall" "$R"
PRECHECK_STALL_MIN=180 ROUND=$R "$check"
has "the threshold is set inline and can be overridden" "$R" "[precheck-stall A $(at 185)]"

R=$(round ended <<EOF
$(at 300) LANE-OA-Precheck-2 START batch #2107 abc0006
$(at 210) PRECHECK-BATCH b-2107-abc0006-on-2000 red #2107 main 0aa0003 wall 90
$(at 300) LANE-OA-Precheck-B CLAIM 2101 line=B (run B-2101-c0ffee1 on main 0aa0001)
$(at 280) LANE-OA-Precheck-B PAUSED load 50.10 (B-2101-c0ffee1 stopped)
$(at 200) LANE-OA-Precheck-2 CLAIM 2108 2103 (hand claim, not a run)
EOF
)
ROUND=$R "$check"
none "the runner's batch line and PAUSED end a batch; a hand claim starts none" "$R"

echo "idle lines"
R=$(round idle <<EOF
$(at 120) LANE-OA-Precheck-2 START batch #2109 abc0007
$(at 50) ORCH PRECHECK-WAIT PR 2110 head abc0008abc
$(at 50) ORCH PRECHECK-WAIT PR 2111 head abc0009abc
$(at 50) ORCH PRECHECK-WAIT PR 2109 head abc0007abc
$(at 45) LANE-OA-Precheck-2 END b-2109-abc0007-on-2000: GREEN 75 min
$(at 44) PRECHECK-GREEN PR 2109 head abc0007abc0007abc0007abc0007abc0007abc0 main 0aa0002 75
$(at 300) LANE-OA-Precheck-B CLAIM 2103 line=B (run B-2103-fade003 on main 0aa0002)
$(at 10) LANE-OA-Precheck-B END B-2103-fade003
EOF
)
ROUND=$R "$check"
has "line A idle 30+ min after END while PRs wait" "$R" "[precheck-idle A $(at 45)]" "line A" "45 min" "2 PRs" "#2110" "#2111"
grep -F 'precheck-idle A' "$R/RELAY-LOG.md" | grep -qF '#2109' && no "a green PR no longer waits" "$(cat "$R/RELAY-LOG.md")" || ok "a green PR no longer waits"
grep -qF 'precheck-idle B' "$R/RELAY-LOG.md" && no "line B idle 10 min is not idle yet" "$(cat "$R/RELAY-LOG.md")" || ok "line B idle 10 min is not idle yet"
ROUND=$R "$check"
[ "$(alerts "$R")" = 1 ] && ok "the idle alert is written once per idle spell" || no "the idle alert is written once per idle spell" "$(cat "$R/RELAY-LOG.md")"

R=$(round idle-clear <<EOF
$(at 90) ORCH PRECHECK-WAIT PR 1900 head 1111111111
$(at 90) ORCH PRECHECK-WAIT PR 1901 head 2222222222
$(at 90) ORCH PRECHECK-WAIT PR 1902 head 3333333333
$(at 90) ORCH PRECHECK-WAIT PR 1903 head 4444444444
$(at 60) LANE-OA-Precheck-2 RERUN-END
$(at 55) PRECHECK-RED PR 1900 head 1111111111aaaa main 0aa0002 0 unit=check2
$(at 55) ORCH PRECHECK-SKIPPED PR 1901 head 2222222222 after 45 min
$(at 55) ORCH ENQUEUED PR 1902 head 3333333333 (by hand)
$(at 55) PRECHECK-GREEN PR 1903 head 4444444444bbbb main 0aa0002 10 line=B
EOF
)
ROUND=$R "$check"
none "red, skipped, enqueued and green each stop a PR waiting" "$R"
echo "$(at 20) ORCH PRECHECK-WAIT PR 1903 head 5555555555" >> "$R/events.log"
ROUND=$R "$check"
has "a later wait for the same PR waits again" "$R" "[precheck-idle A $(at 60)]" "1 PR" "#1903"

R=$(round queue <<EOF
$(at 50) LANE-OA-Precheck-2 END b-2109-abc0007-on-2000
$(at 40) LANE-OA-Precheck-B END B-2103-fade003
EOF
)
mkdir -p "$R/lane-scratch/OA-Precheck-B"
printf '# line B queue\n2120 2121   # next\n# 2122 done\n' > "$R/lane-scratch/OA-Precheck-B/line.txt"
ROUND=$R "$check"
has "a PR in line B's queue file waits for line B" "$R" "[precheck-idle B $(at 40)]" "2 PRs" "#2120 #2121"
grep -qF 'precheck-idle A' "$R/RELAY-LOG.md" && no "line B's queue is not line A's" "$(cat "$R/RELAY-LOG.md")" || ok "line B's queue is not line A's"
grep -qF '#2122' "$R/RELAY-LOG.md" && no "a commented-out PR does not wait" "$(cat "$R/RELAY-LOG.md")" || ok "a commented-out PR does not wait"

echo "runner gone"
mkdir -p "$scratch/pids-a" "$scratch/pids-b" "$scratch/bin"
printf '#!/bin/sh\ntrap '"'"'kill $!; exit'"'"' TERM\nsleep 300 & wait\n' > "$scratch/bin/fake-run.sh"; chmod +x "$scratch/bin/fake-run.sh"
# runner RUN DIR: a stand-in mac-run.sh for RUN, its PID in DIR/RUN.pid.
runner() { "$scratch/bin/fake-run.sh" "$1" & started+=($!); disown; echo $! > "$2/$1.pid"; }
runner B-2103-fade003 "$scratch/pids-b"
runner b-1899-0000000 "$scratch/pids-a"   # another batch's runner on line A
sleep 99999 & started+=($!); disown
echo $! > "$scratch/pids-a/b-1901-aaaaaaa.pid"   # a live process, but not a runner
R=$(round gone <<EOF
$(at 30) LANE-OA-Precheck-3 START batch #1901 aaaaaaa #1902 bbbbbbb
$(at 30) LANE-OA-Precheck-B CLAIM 2103 line=B (run B-2103-fade003 on main 0aa0002)
EOF
)
PRECHECK_PIDS_A=$scratch/pids-a PRECHECK_PIDS_B=$scratch/pids-b ROUND=$R "$check"
has "line A START, no END, and no runner process of its own" "$R" "[precheck-gone A $(at 30)]" "line A" "#1901 #1902" "30 min"
grep -qF 'precheck-gone B' "$R/RELAY-LOG.md" && no "a live runner is not gone" "$(cat "$R/RELAY-LOG.md")" || ok "a live runner is not gone"

runner b-2001-bbbbbbb-on-1900 "$scratch/pids-a"
R=$(round same-pr <<<"$(at 30) LANE-OA-Precheck-3 START batch #2001 BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB, #2002 ccccccc")
PRECHECK_PIDS_A=$scratch/pids-a ROUND=$R "$check"
none "a START's full head finds its own runner by head7" "$R"
R=$(round no-head <<<"$(at 30) LANE-OA-Precheck-3 START batch #2001 after #1900")
PRECHECK_PIDS_A=$scratch/pids-a ROUND=$R "$check"
none "a START with no head after its first PR keeps the PR-only name" "$R"

R=$(round gone-early <<EOF
$(at 5) LANE-OA-Precheck-3 START batch #1901 aaaaaaa
EOF
)
PRECHECK_PIDS_A=$scratch/pids-a ROUND=$R "$check"
none "a runner is given 10 min to start" "$R"

printf '#!/bin/sh\necho "ssh: connect to host example-host: timed out" >&2\nexit 255\n' > "$scratch/bin/ssh"; chmod +x "$scratch/bin/ssh"
R=$(round unknown <<EOF
$(at 30) LANE-OA-Precheck-3 START batch #1901 aaaaaaa
EOF
)
PATH="$scratch/bin:$PATH" PRECHECK_PIDS_A=example-host:lanes/precheck ROUND=$R "$check"
has "an unreadable runner check is UNKNOWN, never fine" "$R" "[precheck-unknown A $(at 30)]" "line A" "UNKNOWN"
mkdir -p "$scratch/argbin"
printf '#!/bin/sh\nprintf "%%s|" "$@" > "$SSH_ARGS"\necho 1\n' > "$scratch/argbin/ssh"; chmod +x "$scratch/argbin/ssh"
R2=$(round hostile <<<"$(at 30) LANE-OA-Precheck-B CLAIM 2130 line=B (run B-2130-\$(touch-x);rm-y\`z\` on main 0aa0002)")
SSH_ARGS=$scratch/ssh-args.txt PATH="$scratch/argbin:$PATH" PRECHECK_PIDS_B=mac:oa-precheck-b ROUND=$R2 "$check"
[[ "$(cat "$scratch/ssh-args.txt")" == *"|oa-precheck-b|B-2130-touch-xrm-yz|" ]] && ok "a run name reaches ssh as letters, digits and dashes only" || no "a run name reaches ssh as letters, digits and dashes only" "$(cat "$scratch/ssh-args.txt")"
rm -f "$R/RELAY-LOG.md"
PRECHECK_PIDS_A=$scratch/no-such-folder ROUND=$R "$check"
has "a missing PID folder is UNKNOWN, not a gone runner" "$R" "[precheck-unknown A $(at 30)]"
PATH="$scratch/bin:$PATH" PRECHECK_PIDS_A=example-host:lanes/precheck ROUND=$R "$check"
grep -qF 'timed out' "$R/RELAY-LOG.md" && no "ssh's own text is not copied into the log" "$(cat "$R/RELAY-LOG.md")" || ok "ssh's own text is not copied into the log"

echo "healthy"
R=$(round healthy <<EOF
$(at 100) ORCH PRECHECK-WAIT PR 1900 head 1111111111
$(at 60) LANE-OA-Precheck-3 START batch #1900 1111111
$(at 80) LANE-OA-Precheck-B END B-2103-fade003
$(at 79) ORCH PRECHECK-WAIT PR 1910 head 9999999999
$(at 20) LANE-OA-Precheck-B CLAIM 1910 line=B (run B-1910-9999999 on main 0aa0002)
EOF
)
runner b-1900-1111111 "$scratch/pids-a"
runner B-1910-9999999 "$scratch/pids-b"
PRECHECK_PIDS_A=$scratch/pids-a PRECHECK_PIDS_B=$scratch/pids-b ROUND=$R "$check"
none "both lines running inside their time, runners up" "$R"
R=$(round quiet <<<"$(at 60) ORCH PRECHECK-WAIT PR 1900 head 1111111111")
ROUND=$R "$check"
none "a round with no pre-check line yet alerts nothing" "$R"

echo
[ "$fails" = 0 ] && echo "precheck-stall: all cases pass" || { echo "precheck-stall: $fails failing"; exit 1; }
