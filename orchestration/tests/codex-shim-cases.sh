#!/usr/bin/env bash
# Cases for orchestration/reviewer/codex-shim.sh: the deadline, the token
# boundary, and hostile input to both. Sol's review of 69afe53 found the token
# reaching the watchdog and shell tracing, a deadline argument run as shell
# syntax, and a TERM-resistant child outliving the deadline. Every token here
# is a synthetic marker in a scratch file; no case reads a real one.
# SHIM_SH=/bin/dash (or /bin/bash) runs every case against a copy of the shim
# with that shell in place of /bin/sh, as on a host where /bin/sh is that shell.
set -uo pipefail

committed=$(cd -- "$(dirname -- "$0")/.." && pwd)/reviewer/codex-shim.sh
shim=$committed
scratch=$(mktemp -d)
if [ -n "${SHIM_SH:-}" ]; then
  sed "s|/bin/sh |$SHIM_SH |g" "$committed" > "$scratch/codex-shim.sh"; shim=$scratch/codex-shim.sh
fi
child_pids=""
cleanup() {
  for pid in $child_pids; do kill -KILL "$pid" 2>/dev/null; done
  rm -rf "$scratch"
}
trap cleanup EXIT
fails=0
ok() { printf '  PASS  %s\n' "$1"; }
no() { printf '  FAIL  %s\n        %s\n' "$1" "$2"; fails=$((fails + 1)); }

marker="synthetic-shim-marker-$$-$RANDOM"
token_file="$scratch/token"
printf '%s\n' "$marker" > "$token_file"
chmod 600 "$token_file"

# shim <token file> <bash snippet>: source the shim in a fresh bash, point it
# at the token file, run the snippet. Inherited tokens are removed first.
shim() {
  env -u GH_TOKEN -u GITHUB_TOKEN bash -c 'source "$1"; REVIEWER_TOKEN_FILE="$2"; eval "$3"' \
    shim "$shim" "$1" "$2"
}

echo "codex shim cases, against $shim"

# The command alone gets the token, and its exit status comes back. Where a
# quick command must finish in time, its deadline is 60 s, far past any run:
# at load 14 the token case below failed once under 10 s, and the deadline is
# the only timing in it.
shim "$token_file" 'run_reviewer 60 /bin/sh -c '\''[ "$GH_TOKEN" = "$(cat "$1")" ]'\'' sh "$REVIEWER_TOKEN_FILE"'
[ $? = 0 ] && ok "the reviewer command sees the token" || no "the reviewer command sees the token" "GH_TOKEN was not the file's value"
# quick_runs <runs> <deadline> <runner...>: the runner, given `/bin/sh -c
# "exit 7"` or the like, until <runs> runs have returned 7. A 124 that came
# only after the run's full deadline is the watchdog doing its job on a starved
# machine, not a lost status (#315): that run is made again, at most five
# times in all. Any other status fails at once, and so does a 124 that came
# early, which is a deadline that fired early. macOS /bin/bash has no
# EPOCHREALTIME, so perl times each run. Prints nothing when every run held.
quick_runs='quick_runs() {
  local runs=$1 secs=$2 ok=0 late=0 t0 t1 rc; shift 2
  while [ "$ok" -lt "$runs" ]; do
    t0=$(perl -MTime::HiRes=time -e "printf q(%.3f), time")
    "$@" >/dev/null 2>&1; rc=$?
    t1=$(perl -MTime::HiRes=time -e "printf q(%.3f), time")
    if [ "$rc" = 7 ]; then
      ok=$((ok + 1))
    elif [ "$rc" = 124 ] && perl -e "exit !($t1 - $t0 >= $secs)"; then
      late=$((late + 1))
      [ "$late" -le 5 ] || { echo "$late runs reached their ${secs} s deadline; $ok of $runs returned 7"; return 1; }
    else
      echo "run $((ok + late + 1)) got $rc after $(perl -e "printf q(%.2f), $t1 - $t0") s"; return 1
    fi
  done
}'
# Sol's review of 87a9f77: with Bash as /bin/sh, a cancelled watchdog's second
# wait for its timer found it already reaped and turned a quick 7 into 125, at
# random; so twenty runs. The deadline is 60 s, far past any run.
out=$(shim "$token_file" "$quick_runs"'; quick_runs 20 60 run_reviewer 60 /bin/sh -c "exit 7"')
[ -z "$out" ] && ok "the command's exit status comes back, every time" || no "the command's exit status comes back, every time" "$out"
out=$(shim "$token_file" 'run_reviewer 10 true; printf "%s" "${GH_TOKEN-unset}"')
[ "$out" = unset ] && ok "the calling shell never holds the token" || no "the calling shell never holds the token" "GH_TOKEN was set after run_reviewer"

# The watchdog's own processes never see the token. A `sleep` early on PATH
# records what the watchdog's environment held; the command is an absolute path
# so it never reaches the stub.
mkdir -p "$scratch/bin"
printf '#!/bin/sh\nif [ -n "${GH_TOKEN+x}" ]; then echo inherited >> "%s"; else echo absent >> "%s"; fi\nexec /bin/sleep "$@"\n' \
  "$scratch/watchdog" "$scratch/watchdog" > "$scratch/bin/sleep"
chmod +x "$scratch/bin/sleep"
t0=$(perl -MTime::HiRes=time -e 'printf q(%.3f), time')
PATH="$scratch/bin:$PATH" shim "$token_file" 'run_reviewer 10 /bin/sleep 1.5'
rc=$?
t1=$(perl -MTime::HiRes=time -e 'printf q(%.3f), time')
if [ ! -s "$scratch/watchdog" ]; then
  no "the watchdog never holds the token" "the watchdog's sleep never ran, so nothing was observed"
elif grep -q inherited "$scratch/watchdog"; then
  no "the watchdog never holds the token" "a watchdog process inherited GH_TOKEN"
else
  ok "the watchdog never holds the token"
fi
# The same run proves the deadline does not fire early: 1.5 s inside 10 s
# returns 0. A 124 passes only after the full 10 s, as in quick_runs above.
if [ $rc = 0 ] || { [ $rc = 124 ] && perl -e "exit !($t1 - $t0 >= 10)"; }; then
  ok "a command inside its deadline is not cut short"
else
  no "a command inside its deadline is not cut short" "got $rc after $(perl -e "printf q(%.2f), $t1 - $t0") s"
fi

# Shell tracing prints every assignment and expansion; none of them may be the
# token.
out=$(shim "$token_file" 'set -x; run_reviewer 5 /bin/sleep 0.1' 2>&1)
case "$out" in
  *"$marker"*) no "shell tracing never prints the token" "the marker reached the trace" ;;
  *) ok "shell tracing never prints the token" ;;
esac

# The security review of 65dbe59: with SHELLOPTS exported, xtrace reaches the
# sh that reads the token.
out=$(shim "$token_file" 'set -x; export SHELLOPTS; run_reviewer 5 true' 2>&1)
case "$out" in
  *"$marker"*) no "an exported SHELLOPTS trace never prints the token" "the marker reached the trace" ;;
  *) ok "an exported SHELLOPTS trace never prints the token" ;;
esac

# One argument is one program name, never a shell command line: perl's
# `exec LIST` with a single element hands it to /bin/sh.
shim "$token_file" 'run_with_deadline 5 ": > '"$scratch"'/one-arg"' 2>/dev/null
[ ! -e "$scratch/one-arg" ] && ok "a single-argument command is not run by a shell" \
  || no "a single-argument command is not run by a shell" "the argument was run as a shell command"

# A token file that is empty or missing stops the run before the command.
: > "$scratch/empty"
shim "$scratch/empty" 'run_reviewer 5 touch "'"$scratch"'/ran-empty"' 2>/dev/null
rc=$?
[ $rc != 0 ] && [ ! -e "$scratch/ran-empty" ] && ok "an empty token file runs nothing" \
  || no "an empty token file runs nothing" "rc=$rc, command ran: $([ -e "$scratch/ran-empty" ] && echo yes || echo no)"
shim "$scratch/absent" 'run_reviewer 5 touch "'"$scratch"'/ran-absent"' 2>/dev/null
rc=$?
[ $rc != 0 ] && [ ! -e "$scratch/ran-absent" ] && ok "a missing token file runs nothing" \
  || no "a missing token file runs nothing" "rc=$rc, command ran: $([ -e "$scratch/ran-absent" ] && echo yes || echo no)"

# The deadline ends a command that overruns it.
SECONDS=0
shim "$token_file" 'run_with_deadline 1 /bin/sleep 20'
rc=$?
[ $rc != 0 ] && [ $SECONDS -lt 8 ] && ok "the deadline ends an overrunning command" \
  || no "the deadline ends an overrunning command" "rc=$rc after ${SECONDS}s"

# Sol's review of 7790dc6: a command that handles the deadline's TERM with
# exit 0 made an expired run report success. An expired deadline returns 124,
# as timeout(1) does, whatever the command returned.
shim "$token_file" 'run_with_deadline 0.3 /bin/sh -c '\''trap "exit 0" TERM; while :; do /bin/sleep 0.05; done'\'
rc=$?
[ $rc = 124 ] && ok "an expired deadline returns 124 even when the command exits 0 on TERM" \
  || no "an expired deadline returns 124 even when the command exits 0 on TERM" "got $rc"
shim "$token_file" 'run_with_deadline 60 /bin/sh -c "trap \"exit 0\" TERM; exit 0"'
rc=$?
[ $rc = 0 ] && ok "a command that finishes in time keeps its own status" \
  || no "a command that finishes in time keeps its own status" "got $rc"

# A parent that exits on TERM leaves a child that ignores it. The deadline
# still ends the child: the KILL that follows the grace period is not cancelled
# because the parent went first.
printf '#!/bin/bash\ntrap "" TERM\necho $$ > "$1"\nexec /bin/sleep 30\n' > "$scratch/child.sh"
printf '#!/bin/bash\ntrap "exit 0" TERM\n"$1" "$2" >/dev/null 2>&1 &\nwhile :; do /bin/sleep 0.05; done\n' > "$scratch/parent.sh"
chmod +x "$scratch/child.sh" "$scratch/parent.sh"
# The deadline counts from the child's start, not the parent's: the M5 takes up
# to a second to run each new script the first time, so 2 s from launch fired
# before the child existed. The watchdog's timer is a `sleep` early on PATH that
# waits for the child's record (a minute at most) before its 2 s begin.
mkdir -p "$scratch/afterchild"
printf '#!/bin/sh\n[ "$1" = 0 ] && exit 0\ni=0\nwhile [ ! -s "%s" ] && [ $i -lt 600 ]; do /bin/sleep 0.1; i=$((i + 1)); done\nexec /bin/sleep "$@"\n' \
  "$scratch/child.pid" > "$scratch/afterchild/sleep"
chmod +x "$scratch/afterchild/sleep"
PATH="$scratch/afterchild:$PATH" shim "$token_file" 'run_with_deadline 2 "'"$scratch"'/parent.sh" "'"$scratch"'/child.sh" "'"$scratch"'/child.pid"'
child_pid=$(cat "$scratch/child.pid" 2>/dev/null); child_pids="$child_pids $child_pid"
if [ -z "$child_pid" ]; then
  no "no TERM-resistant child outlives the deadline" "the child never started"
elif kill -0 "$child_pid" 2>/dev/null; then
  no "no TERM-resistant child outlives the deadline" "child $child_pid was still alive when the shim returned"
else
  ok "no TERM-resistant child outlives the deadline"
fi
# Sol's review of 8e3681d: the same child, left by a command that succeeds.
printf '#!/bin/bash\n"$1" "$2" >/dev/null 2>&1 &\nwhile [ ! -s "$2" ]; do /bin/sleep 0.01; done\nexit 0\n' > "$scratch/quick-parent.sh"
chmod +x "$scratch/quick-parent.sh"
shim "$token_file" 'run_with_deadline 60 "'"$scratch"'/quick-parent.sh" "'"$scratch"'/child.sh" "'"$scratch"'/quick-child.pid"'
rc=$?
child_pid=$(cat "$scratch/quick-child.pid" 2>/dev/null); child_pids="$child_pids $child_pid"
if [ $rc != 0 ] || [ -z "$child_pid" ]; then
  no "no TERM-resistant child outlives a command that succeeds" "rc=$rc, child started: $([ -n "$child_pid" ] && echo yes || echo no)"
elif kill -0 "$child_pid" 2>/dev/null; then
  no "no TERM-resistant child outlives a command that succeeds" "child $child_pid was still alive when the shim returned"
else
  ok "no TERM-resistant child outlives a command that succeeds"
fi

# A deadline is a number of seconds and nothing else. Each of these used to
# reach `sh -c` as text.
for bad in "0; : > $scratch/injected" '$(: > '"$scratch"'/injected)' '' '-1' 'abc' '1e3' '1 2'; do
  # The command runs half a second, so a watchdog given shell text has time
  # to run it.
  env -u GH_TOKEN bash -c 'source "$1"; run_with_deadline "$2" sh -c ": > \"\$0\"; sleep 0.5" "$3"' \
    shim "$shim" "$bad" "$scratch/ran-bad" 2>/dev/null
  rc=$?
  if [ -e "$scratch/injected" ]; then
    no "the deadline '$bad' runs nothing" "it was executed as shell syntax"; rm -f "$scratch/injected"
  elif [ $rc != 2 ] || [ -e "$scratch/ran-bad" ]; then
    no "the deadline '$bad' runs nothing" "rc=$rc, command ran: $([ -e "$scratch/ran-bad" ] && echo yes || echo no)"
    rm -f "$scratch/ran-bad"
  else
    ok "the deadline '$bad' runs nothing"
  fi
done

# A timer that cannot run gives no deadline, so the command never starts and
# the shim fails. The command is quick on purpose: a watchdog that only finds
# out after starting lost that race on a loaded machine and returned 0.
mkdir -p "$scratch/brokenbin"
printf '#!/bin/sh\nexit 43\n' > "$scratch/brokenbin/sleep"
chmod +x "$scratch/brokenbin/sleep"
env -u GH_TOKEN PATH="$scratch/brokenbin:$PATH" bash -c 'source "$1"; run_with_deadline 5 /bin/sh -c ": > \"\$0\"" "$2"' \
  shim "$shim" "$scratch/ran-untimed" 2>/dev/null
rc=$?
if [ $rc = 0 ] || [ -e "$scratch/ran-untimed" ]; then
  no "a broken timer runs nothing and fails" "rc=$rc, command ran: $([ -e "$scratch/ran-untimed" ] && echo yes || echo no)"
else
  ok "a broken timer runs nothing and fails"
fi

# Sol's review of eba3667: only a watchdog status of 124 changed the result,
# so a watchdog that failed to launch let the command run untimed and report
# success. The command now starts only once the watchdog is running, and a
# watchdog that ends any way but cancelled or fired fails the run. A `perl`
# early on PATH breaks the watchdog's launch and passes the command's through.
real_perl=$(command -v perl)
for broken in 'exit 43' 'kill -KILL $$' 'exit 0'; do
  mkdir -p "$scratch/perlbin"
  printf '#!/bin/sh\ncase "$*" in *watchdog*) %s;; *) exec "%s" "$@";; esac\n' "$broken" "$real_perl" > "$scratch/perlbin/perl"
  chmod +x "$scratch/perlbin/perl"
  rm -f "$scratch/ran-wd"
  env -u GH_TOKEN PATH="$scratch/perlbin:$PATH" bash -c 'source "$1"; run_with_deadline 5 /bin/sh -c ": > \"\$0\"" "$2"' \
    shim "$shim" "$scratch/ran-wd" 2>/dev/null
  rc=$?
  if [ $rc = 0 ] || [ -e "$scratch/ran-wd" ]; then
    no "a watchdog whose launch does '$broken' runs nothing and fails" "rc=$rc, command ran: $([ -e "$scratch/ran-wd" ] && echo yes || echo no)"
  else
    ok "a watchdog whose launch does '$broken' runs nothing and fails"
  fi
done

# Sol's review of 8e3681d: the watchdog's TERM trap meant "cancelled" whoever
# sent it and whatever its timer did. A timer that passes `sleep 0`, starts,
# ignores the cancelling TERM and then fails was cleared by it; and a TERM from
# anyone else let the command run past its deadline to success. Both fixtures
# are Sol's proofs, unchanged.
mkdir -p "$scratch/failbin"
printf '#!/bin/sh\n[ "$1" = 0 ] && exit 0\ntrap "" TERM\ntouch "%s"\n/bin/sleep 0.1\ntouch "%s"\nexit 43\n' \
  "$scratch/timer-started" "$scratch/timer-failed" > "$scratch/failbin/sleep"
chmod +x "$scratch/failbin/sleep"
env -u GH_TOKEN PATH="$scratch/failbin:$PATH" bash -c 'source "$1"; run_with_deadline 5 /bin/sh -c '\''while [ ! -e "$2" ]; do /bin/sleep 0.01; done; touch "$1"'\'' proof "$2" "$3"' \
  shim "$shim" "$scratch/ran-quick" "$scratch/timer-started" 2>/dev/null
rc=$?
if [ ! -e "$scratch/timer-failed" ] || [ ! -e "$scratch/ran-quick" ]; then
  no "a timer that fails after a quick command fails the run" "the fixture never got there: timer failed $([ -e "$scratch/timer-failed" ] && echo yes || echo no), command ran $([ -e "$scratch/ran-quick" ] && echo yes || echo no)"
elif [ $rc = 0 ]; then
  no "a timer that fails after a quick command fails the run" "the timer exited 43 and the shim returned 0"
else
  ok "a timer that fails after a quick command fails the run"
fi
mkdir -p "$scratch/termbin"
printf '#!/bin/sh\n[ "$1" = 0 ] && exit 0\nif [ "$1" = 0.2 ]; then kill -TERM "$PPID"; fi\nexec /bin/sleep "$@"\n' > "$scratch/termbin/sleep"
chmod +x "$scratch/termbin/sleep"
env -u GH_TOKEN PATH="$scratch/termbin:$PATH" bash -c 'source "$1"; run_with_deadline 0.2 /bin/sh -c '\''/bin/sleep 1; touch "$1"'\'' proof "$2"' \
  shim "$shim" "$scratch/finished" 2>/dev/null
rc=$?
if [ ! -e "$scratch/finished" ]; then
  no "a TERM the shim did not send to the watchdog fails the run" "the fixture never got there: the command did not finish"
elif [ $rc = 0 ]; then
  no "a TERM the shim did not send to the watchdog fails the run" "the command ran past its deadline and the shim returned 0"
else
  ok "a TERM the shim did not send to the watchdog fails the run"
fi

# Sol's review of 87a9f77, its proofs. Sol ran each under a 10-second cap,
# kept here with perl's alarm, which outlives exec. The cap only stops a hang;
# a loaded laptop held one quick run past a 5 s deadline, so it is 60 here
# (120 for the sixty runs).
# within <seconds> <command...>
within() { perl -e 'alarm shift; exec @ARGV or exit 127' "$@"; }
# Sol PRV-cf-85-R1, criterion 1. A timer that passes `sleep 0` and fails at once
# on the real duration started the command before it failed.
mkdir -p "$scratch/zerobin"
printf '#!/bin/sh\n[ "$1" = 0 ] && exit 0\nexit 43\n' > "$scratch/zerobin/sleep"
chmod +x "$scratch/zerobin/sleep"
within 60 env -u GH_TOKEN PATH="$scratch/zerobin:$PATH" bash -c 'source "$1"; run_with_deadline 5 /usr/bin/touch "$2"' \
  shim "$shim" "$scratch/ran-zero" 2>/dev/null
rc=$?
if [ $rc = 0 ] || [ -e "$scratch/ran-zero" ]; then
  no "a timer that only passes the zero-second probe runs nothing" "rc=$rc, command ran: $([ -e "$scratch/ran-zero" ] && echo yes || echo no)"
else
  ok "a timer that only passes the zero-second probe runs nothing"
fi
# Sol PRV-cf-85-R1, criterion 2. A timer that ran out while its watchdog was
# stopped was read as cancelled, and an over-deadline command returned 0.
mkdir -p "$scratch/stopbin" "$scratch/stop"
printf '#!/bin/sh\n[ "$1" = 0 ] && exit 0\nprintf %%s "$PPID" > "%s/watchdog"\nwhile [ ! -e "%s/ran" ]; do /bin/sleep 0.001; done\nkill -STOP "$PPID"\n/bin/sleep 0.06\ntouch "%s/expired"\nexit 0\n' \
  "$scratch/stop" "$scratch/stop" "$scratch/stop" > "$scratch/stopbin/sleep"
chmod +x "$scratch/stopbin/sleep"
within 60 env -u GH_TOKEN PATH="$scratch/stopbin:$PATH" bash -c 'source "$1"; run_with_deadline 0.06 /bin/bash -c '\''
touch "$1/ran"
while [ ! -e "$1/expired" ]; do /bin/sleep 0.001; done
/bin/sleep 0.05
(/bin/sleep 0.02; kill -CONT "$(cat "$1/watchdog")") &
exit 0'\'' proof "$2"' shim "$shim" "$scratch/stop" 2>/dev/null
rc=$?
if [ ! -e "$scratch/stop/expired" ]; then
  no "an expired timer is not cleared by a late cancel" "the fixture never got there: the timer did not expire"
elif [ $rc != 124 ]; then
  no "an expired timer is not cleared by a late cancel" "got $rc, wanted 124"
else
  ok "an expired timer is not cleared by a late cancel"
fi
# Linux dash refuses `kill -TERM -- -<group>`, so neither deadline signal was
# sent and the command finished after its deadline. This one has a longer
# deadline than Sol's, which follows it.
dash=$(command -v dash || true)
if [ -z "$dash" ]; then
  echo "  SKIP  the deadline stops work under dash as /bin/sh (no dash here)"
else
  sed "s|/bin/sh |$dash |g" "$committed" > "$scratch/dash-shim.sh"
  env -u GH_TOKEN bash -c 'source "$1"; run_with_deadline 0.3 /bin/bash -c '\''/bin/sleep 1.5; touch "$1"'\'' proof "$2"' \
    shim "$scratch/dash-shim.sh" "$scratch/dash-finished" 2>/dev/null
  rc=$?
  if [ $rc = 124 ] && [ ! -e "$scratch/dash-finished" ]; then
    ok "the deadline stops work under dash as /bin/sh"
  else
    no "the deadline stops work under dash as /bin/sh" "rc=$rc, finished: $([ -e "$scratch/dash-finished" ] && echo yes || echo no)"
  fi
fi
# Sol PRV-cf-85-R1, criterion 4. Red under Linux dash as /bin/sh, or with
# SHIM_SH=/bin/dash.
mkdir -p "$scratch/deadline"
within 60 env -u GH_TOKEN bash -c 'source "$1"; run_with_deadline 0.05 /bin/bash -c '\''/bin/sleep 0.4; touch "$1/finished"'\'' proof "$2"' \
  shim "$shim" "$scratch/deadline" 2>/dev/null
rc=$?
if [ $rc = 124 ] && [ ! -e "$scratch/deadline/finished" ]; then
  ok "the deadline stops a command before it completes"
else
  no "the deadline stops a command before it completes" "rc=$rc, finished: $([ -e "$scratch/deadline/finished" ] && echo yes || echo no)"
fi
# Sol PRV-cf-85-R1, criterion 4. Red at random with Linux Bash as /bin/sh, so
# sixty runs, each judged as the twenty runs above are. The cap only stops a
# hang: sixty quick runs and five that reach their 60 s deadline fit in 600.
out=$(within 600 env -u GH_TOKEN bash -c 'source "$1"; eval "$2"; quick_runs 60 60 run_with_deadline 60 /bin/bash -c "exit 7" || exit 1' \
  shim "$shim" "$quick_runs")
rc=$?
[ $rc = 0 ] && ok "a working watchdog keeps a quick command's status over sixty runs" \
  || no "a working watchdog keeps a quick command's status over sixty runs" "rc=$rc $out"
# Found on the M5 (#315): the watchdog forks its timer with TERM blocked and
# the watchdog's TERM handler in place. A quick command's cancel that reached
# the timer before it exec'd `sleep` ran that handler, which found the cancel
# file and returned, so the timer slept its whole deadline and a command that
# returned 7 read 124. A loaded machine does that at random; the fixture does it
# every time, holding the forked timer before it unblocks TERM until the
# cancel's TERM is pending (thirty seconds at most).
mkdir -p "$scratch/holdlib"
cat > "$scratch/holdlib/HoldTimer.pm" <<'PERL'
package HoldTimer;
use POSIX ();
my $loader = $$;
my $real = \&POSIX::sigprocmask;
no warnings 'redefine';
*POSIX::sigprocmask = sub {
  if ($$ != $loader) {
    open my $seen, '>', $ENV{HOLD_SEEN}; close $seen;
    my $pending = POSIX::SigSet->new;
    for (1 .. 3000) {
      POSIX::sigpending($pending);
      last if $pending->ismember(POSIX::SIGTERM());
      select undef, undef, undef, 0.01;
    }
  }
  $real->(@_);
};
1;
PERL
HOLD_SEEN="$scratch/hold-seen" PERL5LIB="$scratch/holdlib" PERL5OPT=-MHoldTimer \
  shim "$token_file" 'run_with_deadline 5 /bin/bash -c "exit 7"' 2>/dev/null
rc=$?
if [ ! -e "$scratch/hold-seen" ]; then
  no "a cancel that reaches the timer before it starts still cancels" "the fixture never got there: no forked timer was held"
elif [ $rc != 7 ]; then
  no "a cancel that reaches the timer before it starts still cancels" "got $rc, wanted 7"
else
  ok "a cancel that reaches the timer before it starts still cancels"
fi

# Sol's review of eba3667: run_reviewer with no command read the token, exported it,
# and ran an empty exec that succeeded. No command is refused before the token
# file is opened, so a missing file still reports the missing command.
shim "$token_file" 'run_reviewer 5' 2>/dev/null
rc=$?
[ $rc != 0 ] && ok "run_reviewer with no command fails" || no "run_reviewer with no command fails" "got $rc"
out=$(shim "$scratch/absent" 'run_reviewer 5' 2>&1)
rc=$?
case "$rc:$out" in
  2:*"no command"*) ok "run_reviewer refuses no command before it reads the token file" ;;
  *) no "run_reviewer refuses no command before it reads the token file" "rc=$rc, said: $out" ;;
esac

echo
echo "codex shim cases: $fails failed"
[ $fails = 0 ]
