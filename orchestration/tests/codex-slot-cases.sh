#!/usr/bin/env bash
# Cases for the login-wide Codex limiter in orchestration/reviewer/codex-shim.sh
# (#352): every `codex exec` takes one of 5 slots held by one lock host, the
# M5 over ssh, with a small fallback pool on this machine when the M5 can't be
# reached. Two "machines" share this box: a fake M5 home (the lock host, with
# its LOCK-HOST marker) and a fake laptop home that reaches it through a fake
# ssh. A fake codex holds its slot until the case releases it. No case touches
# a real host, a real lock or a real codex.
set -uo pipefail

shim=$(cd -- "$(dirname -- "$0")/.." && pwd)/reviewer/codex-shim.sh
S=$(mktemp -d)
cleanup() {
  for f in "$S"/pid-*; do [ -e "$f" ] && kill -KILL -- -"$(cat "$f")" 2>/dev/null; done
  rm -rf "$S"
}
trap cleanup EXIT
fails=0
ok() { printf '  PASS  %s\n' "$1"; }
no() { printf '  FAIL  %s\n        %s\n' "$1" "$2"; fails=$((fails + 1)); }

mkdir -p "$S/tmp" "$S/bin" "$S/m5/.codex-slots" "$S/laptop"
: > "$S/m5/.codex-slots/LOCK-HOST"
# The fake ssh: `ssh-fake -o .. -o .. <host> <command>` runs the command as the
# M5 would (its home, its name), or fails as ssh does (255) while $S/down-<host>
# exists. Every call is logged.
cat > "$S/bin/ssh-fake" <<EOF
#!/bin/sh
while [ "\$1" = -o ]; do shift 2; done
host=\$1; shift
echo "\$host \$*" >> "$S/ssh-calls"
[ -e "$S/down-\$host" ] && { echo "ssh: connect to host \$host: Connection refused" >&2; exit 255; }
# lose-reply-<host>: the command runs, but its answer is lost once (255).
if [ -e "$S/lose-reply-\$host" ]; then
  rm -f "$S/lose-reply-\$host"
  (cd "$S/m5" && HOME="$S/m5" CODEX_SLOT_ME=m5 sh -c "\$*") > /dev/null 2>&1
  exit 255
fi
cd "$S/m5" && HOME="$S/m5" CODEX_SLOT_ME=m5 exec sh -c "\$*"
EOF
# The fake codex: `codex exec <name> [exit code]` logs its start with the
# number of slots the M5 holds, copies its stdin, waits for its release file
# and exits with the code it was given. FAKE_NAME names it instead of <name>.
cat > "$S/bin/codex" <<EOF
#!/bin/sh
while [ \$# -gt 0 ] && [ "\$1" != exec ] && [ "\$1" != e ] && [ "\$1" != review ]; do shift; done
name=\${FAKE_NAME:-\$2}; rc=\${3:-0}
[ -n "\${FAKE_NAME:-}" ] && rc=0
n=\$(ls "$S/m5/.codex-slots/slots" 2>/dev/null | wc -l | tr -d ' ')
echo \$PPID > "$S/ppid-\$name"
echo "start \$name slots=\$n" >> "$S/log"
cat > "$S/stdin-\$name"
while [ ! -e "$S/release-\$name" ]; do sleep 0.05; done
echo "end \$name" >> "$S/log"
exit \$rc
EOF
chmod +x "$S/bin/ssh-fake" "$S/bin/codex"

export PATH="$S/bin:$PATH" CODEX_SLOT_POLL=0.1 CODEX_SLOT_BEAT=0.2 CODEX_SLOT_TTL=5 TMPDIR="$S/tmp"
unset CODEX_SLOTS CODEX_SLOT_HELD CODEX_SLOT_FALLBACK CODEX_SLOT_DIR
laptop_env=(HOME="$S/laptop" CODEX_SLOT_ME=laptop CODEX_SLOT_HOST=m5 CODEX_SLOT_SSH="$S/bin/ssh-fake")
m5_env=(HOME="$S/m5" CODEX_SLOT_ME=m5)

# start <laptop|m5> <name> [exit code]: one holder in its own process group,
# running `codex exec <name>` through the sourced shim, stdin from $S/in-<name>.
start() {
  local machine=$1 name=$2; shift 2
  local envs; if [ "$machine" = m5 ]; then envs=("${m5_env[@]}"); else envs=("${laptop_env[@]}"); fi
  [ -e "$S/in-$name" ] || : > "$S/in-$name"
  env "${envs[@]}" ${EXTRA_ENV:+$EXTRA_ENV} perl -e 'setpgrp(0, 0); exec @ARGV' \
    bash -c 'source "$1"; shift; codex exec "$@"; echo "rc=$?" > "$0"' "$S/rc-$name" "$shim" "$name" "$@" \
    < "$S/in-$name" > "$S/out-$name" 2> "$S/err-$name" &
  disown
  echo $! > "$S/pid-$name"
}
release() { : > "$S/release-$1"; }
# until_true <seconds> <test...>: polls the test every 0.05 s until it holds.
until_true() {
  local end=$(( $(date +%s) + $1 )); shift
  until "$@"; do [ "$(date +%s)" -le "$end" ] || return 1; sleep 0.05; done
}
started() { grep -qx "start $1 slots=.*" "$S/log" 2>/dev/null; }
finished() { [ -e "$S/rc-$1" ]; }
waiting() { grep -q 'codex-slot: waiting for a Codex slot' "$S/err-$1" 2>/dev/null; }
said() { grep -q "$2" "$S/err-$1" 2>/dev/null; }
held() { ls "$1" 2>/dev/null | wc -l | tr -d ' '; }
m5_held() { held "$S/m5/.codex-slots/slots"; }
# reset: every holder released and finished, every file of the last case gone.
reset() {
  for f in "$S"/pid-*; do [ -e "$f" ] || continue; release "${f##*/pid-}"; done
  for f in "$S"/pid-*; do
    [ -e "$f" ] || continue
    until_true 30 finished "${f##*/pid-}" || kill -KILL -- -"$(cat "$f")" 2>/dev/null
  done
  rm -f "$S"/pid-* "$S"/rc-* "$S"/out-* "$S"/err-* "$S"/in-* "$S"/stdin-* "$S"/release-* "$S"/down-* "$S"/lose-reply-* "$S"/ppid-* "$S/bg-pid" "$S/log" "$S/ssh-calls"
  rm -rf "$S/m5/.codex-slots/slots" "$S/laptop/.codex-slots"
}

echo "codex slot cases, against $shim"

# 1. Five holders run at once, each in a slot on the M5.
for i in 1 2 3 4 5; do start laptop job$i; done
if until_true 30 eval '[ "$(grep -c "^start job" "$S/log" 2>/dev/null)" = 5 ]' && [ "$(m5_held)" = 5 ]; then
  ok "five holders run, five slots held on the lock host"
else no "five holders run, five slots held on the lock host" "log: $(cat "$S/log" 2>/dev/null | tr '\n' ' ') slots: $(m5_held)"; fi

# 2. A sixth waits, says so once, and starts when one ends.
start laptop job6
if until_true 30 waiting job6 && ! started job6; then ok "a sixth holder waits"
else no "a sixth holder waits" "started=$(started job6 && echo yes || echo no) err: $(cat "$S/err-job6")"; fi
release job1
if until_true 30 started job6; then ok "the sixth starts when one ends"
else no "the sixth starts when one ends" "err: $(cat "$S/err-job6")"; fi
lines=$(grep -c . "$S/err-job6")
[ "$lines" = 1 ] && ok "the waiter prints one line" || no "the waiter prints one line" "$lines lines: $(cat "$S/err-job6")"

# 3. A killed holder on the laptop frees its slot once its lease runs out with
# no heartbeat; the M5 can't see a laptop PID.
start laptop job7
until_true 30 waiting job7
kill -KILL -- -"$(cat "$S/pid-job2")"; rm -f "$S/pid-job2"
if until_true 30 started job7; then ok "a killed laptop holder's slot is reclaimed when its lease runs out"
else no "a killed laptop holder's slot is reclaimed when its lease runs out" "err: $(cat "$S/err-job7")"; fi
grep -q 'reclaim .*(lease ran out)' "$S/m5/.codex-slots/log" && ok "the lock host logs the lease reclaim" \
  || no "the lock host logs the lease reclaim" "$(cat "$S/m5/.codex-slots/log")"
reset

# 3b. Sol r1 on 71fcd5e: killing only the shell that owns a slot must not
# hand the slot on while its command still runs. With one slot, a second
# caller waits until that command ends.
# k1 runs the fake codex binary by path: through the codex function, bash
# 3.2's `command` leaks a saved copy of the pipe and hid this.
: > "$S/in-k1"
env "${m5_env[@]}" CODEX_SLOTS=1 perl -e 'setpgrp(0, 0); exec @ARGV' \
  bash -c 'source "$1"; codex_slot "$2" exec k1' x "$shim" "$S/bin/codex" < "$S/in-k1" > /dev/null 2> "$S/err-k1" &
echo $! > "$S/pid-k1"; disown
until_true 30 started k1
kill -KILL "$(cat "$S/ppid-k1")"
EXTRA_ENV=CODEX_SLOTS=1
start m5 k2
if until_true 30 waiting k2 && ! started k2 && [ "$(m5_held)" = 1 ]; then ok "a killed slot shell keeps its slot while its command runs"
else no "a killed slot shell keeps its slot while its command runs" "slots $(m5_held); log: $(cat "$S/log" | tr '\n' ' ')"; fi
release k1
if until_true 30 started k2; then ok "the slot goes back when that command ends"
else no "the slot goes back when that command ends" "err: $(cat "$S/err-k2")"; fi
EXTRA_ENV=
reset
# A command that leaves a child running returns at once; the child holds the
# slot until it ends.
t0=$(date +%s)
env "${m5_env[@]}" bash -c 'source "$1"; codex_slot sh -c "sleep 30 > /dev/null 2>&1 & echo \$! > \"\$0\"" "$2"' x "$shim" "$S/bg-pid" > /dev/null 2>&1
t1=$(date +%s)
[ $((t1 - t0)) -lt 15 ] && [ "$(m5_held)" = 1 ] && ok "codex_slot returns when its command does, the child keeping the slot" \
  || no "codex_slot returns when its command does, the child keeping the slot" "$((t1 - t0)) s, slots $(m5_held)"
kill "$(cat "$S/bg-pid")" 2>/dev/null
if until_true 30 eval '[ "$(m5_held)" = 0 ]'; then ok "the slot goes back when that child ends"
else no "the slot goes back when that child ends" "slots $(m5_held)"; fi
reset

# 4. Holders on both machines share the same 5: three on the M5, two on the
# laptop, then a sixth from either side waits. A killed M5 holder frees its
# slot at once, since the M5 sees that its PID is gone.
for i in 1 2 3; do start m5 m$i; done
for i in 1 2; do start laptop l$i; done
until_true 30 eval '[ "$(grep -c "^start" "$S/log" 2>/dev/null)" = 5 ]'
start m5 m4; start laptop l3
if until_true 30 waiting m4 && until_true 30 waiting l3 && ! started m4 && ! started l3 && [ "$(m5_held)" = 5 ]; then
  ok "both machines share the same five slots"
else no "both machines share the same five slots" "slots $(m5_held); m4: $(cat "$S/err-m4"); l3: $(cat "$S/err-l3")"; fi
kill -KILL -- -"$(cat "$S/pid-m1")"; rm -f "$S/pid-m1"
if until_true 30 eval 'started m4 || started l3'; then ok "a killed M5 holder frees its slot"
else no "a killed M5 holder frees its slot" "slots $(m5_held)"; fi
grep -q 'reclaim .*(holder gone)' "$S/m5/.codex-slots/log" && ok "the M5 reclaims it because its PID is gone" \
  || no "the M5 reclaims it because its PID is gone" "$(cat "$S/m5/.codex-slots/log")"
reset

# 4b. Ten callers at once from both machines: five run, five wait, and no
# start ever saw more than five slots held.
for i in 1 2 3 4 5; do start m5 r$i; start laptop s$i; done
until_true 30 eval '[ "$(grep -c "^start" "$S/log" 2>/dev/null)" = 5 ] && [ "$(grep -l "waiting for a Codex slot" "$S"/err-* 2>/dev/null | wc -l | tr -d " ")" = 5 ]'
[ "$(grep -c "^start" "$S/log")" = 5 ] && [ "$(m5_held)" = 5 ] && ok "ten at once: five run, five wait" \
  || no "ten at once: five run, five wait" "$(cat "$S/log") slots $(m5_held)"
for f in "$S"/pid-*; do release "${f##*/pid-}"; done
until_true 60 eval '[ "$(grep -c "^end" "$S/log" 2>/dev/null)" = 10 ]'
most=$(sed -n 's/^start .* slots=//p' "$S/log" | sort -n | tail -1)
[ "$(grep -c "^end" "$S/log")" = 10 ] && [ "$most" -le 5 ] && ok "all ten ran, never more than five at once" \
  || no "all ten ran, never more than five at once" "most $most; $(cat "$S/log")"
reset

# 5. The M5 can't be reached: the laptop's fallback pool (1 slot by default)
# grants, and the line names the fallback host. A second laptop holder waits
# and takes the M5's pool once the M5 is back.
: > "$S/down-m5"
start laptop f1
if until_true 30 started f1 && said f1 'lock host m5 unreachable.*fallback lock host laptop'; then
  ok "the fallback grants when the lock host is unreachable, naming the fallback host"
else no "the fallback grants when the lock host is unreachable, naming the fallback host" "err: $(cat "$S/err-f1")"; fi
[ "$(held "$S/laptop/.codex-slots/fallback/slots")" = 1 ] && [ "$(m5_held)" = 0 ] \
  && ok "the fallback slot is held on the laptop, not the M5" \
  || no "the fallback slot is held on the laptop, not the M5" "laptop $(held "$S/laptop/.codex-slots/fallback/slots"), m5 $(m5_held)"
start laptop f2
if until_true 30 waiting f2 && ! started f2; then ok "the fallback pool is full at one slot"
else no "the fallback pool is full at one slot" "err: $(cat "$S/err-f2")"; fi
rm -f "$S/down-m5"
if until_true 30 started f2 && [ "$(m5_held)" = 1 ]; then ok "the waiter takes the M5's pool once it is back"
else no "the waiter takes the M5's pool once it is back" "m5 $(m5_held); err: $(cat "$S/err-f2")"; fi
reset
rm -f "$S/m5/.codex-slots/LOCK-HOST"
start laptop f3
if until_true 30 started f3 && said f3 'lock host m5 is not set up.*fallback lock host laptop'; then
  ok "a lock host without its LOCK-HOST marker is not used"
else no "a lock host without its LOCK-HOST marker is not used" "err: $(cat "$S/err-f3")"; fi
reset
: > "$S/m5/.codex-slots/LOCK-HOST"

# 5b. Sol r2 on aa00740: an acquire whose grant landed but whose answer was
# lost finds its own slot on the retry, rather than waiting on it forever.
: > "$S/lose-reply-m5"; : > "$S/in-lr1"
env "${laptop_env[@]}" CODEX_SLOTS=1 CODEX_SLOT_FALLBACK=0 perl -e 'setpgrp(0, 0); exec @ARGV' \
  bash -c 'source "$1"; codex exec lr1' x "$shim" < "$S/in-lr1" > /dev/null 2> "$S/err-lr1" &
echo $! > "$S/pid-lr1"; disown
if until_true 30 started lr1 && [ "$(m5_held)" = 1 ]; then ok "a lost acquire answer: the retry finds its own slot"
else no "a lost acquire answer: the retry finds its own slot" "slots $(m5_held); err: $(cat "$S/err-lr1")"; fi
reset

# 5c. Sol r2 on aa00740: every non-interactive Codex session takes a slot,
# with options before the subcommand, by its alias, and for review.
EXTRA_ENV=CODEX_SLOTS=1
start laptop g1
until_true 30 started g1
for form in "-c model_reasoning_effort=high exec g2" "e g3" "review g4"; do
  name=${form##* }; : > "$S/in-$name"
  env "${laptop_env[@]}" CODEX_SLOTS=1 perl -e 'setpgrp(0, 0); exec @ARGV' \
    bash -c 'source "$1"; shift; codex "$@"' x "$shim" $form < "$S/in-$name" > /dev/null 2> "$S/err-$name" &
  echo $! > "$S/pid-$name"; disown
  if until_true 30 waiting "$name" && ! started "$name"; then ok "codex $form waits for a slot"
  else no "codex $form waits for a slot" "started=$(started "$name" && echo yes || echo no)"; fi
done
EXTRA_ENV=
reset

# 6. The command's exit code and stdin pass through.
printf 'the prompt\n' > "$S/in-x7"
start laptop x7 7
until_true 30 started x7; release x7
if until_true 30 finished x7 && [ "$(cat "$S/rc-x7")" = rc=7 ]; then ok "codex's exit code passes through"
else no "codex's exit code passes through" "$(cat "$S/rc-x7" 2>/dev/null)"; fi
[ "$(cat "$S/stdin-x7")" = "the prompt" ] && ok "codex gets the caller's stdin" || no "codex gets the caller's stdin" "$(cat "$S/stdin-x7")"
rc=$(env "${laptop_env[@]}" bash -c 'source "$1"; codex_slot sh -c "exit 9"; echo $?' x "$shim" 2>&1)
[ "$rc" = 9 ] && ok "codex_slot returns its command's exit code" || no "codex_slot returns its command's exit code" "$rc"
for sh in bash zsh; do
  command -v $sh > /dev/null || continue
  out=$(env "${laptop_env[@]}" $sh -c 'set -e; source "$1"; codex_slot sh -c "exit 4"; echo not-reached' x "$shim" 2>&1; echo "rc=$?")
  [ "$out" = rc=4 ] && until_true 30 eval '[ "$(m5_held)" = 0 ]' && ok "$sh with set -e: a failing command's code comes back and its slot goes back" \
    || no "$sh with set -e: a failing command's code comes back and its slot goes back" "$out, slots $(m5_held)"
done
reset

# 7. The slot count is set by CODEX_SLOTS; a bad value refuses, starting nothing.
EXTRA_ENV=CODEX_SLOTS=2
start laptop c1; start laptop c2
until_true 30 eval 'started c1 && started c2'
start laptop c3
if until_true 30 waiting c3 && ! started c3 && [ "$(m5_held)" = 2 ]; then ok "CODEX_SLOTS=2 lets two run"
else no "CODEX_SLOTS=2 lets two run" "slots $(m5_held); err: $(cat "$S/err-c3")"; fi
EXTRA_ENV=
reset
for bad in 0 abc 1.5; do
  out=$(env "${laptop_env[@]}" CODEX_SLOTS=$bad bash -c 'source "$1"; codex_slot sh -c "echo ran"; echo "rc=$?"' x "$shim" 2>&1)
  case $out in *ran*) no "CODEX_SLOTS=$bad refuses" "$out" ;; *rc=2*) ok "CODEX_SLOTS=$bad refuses" ;; *) no "CODEX_SLOTS=$bad refuses" "$out" ;; esac
done
out=$(env "${laptop_env[@]}" CODEX_SLOT_HOST=-oProxyCommand=x bash -c 'source "$1"; codex_slot sh -c "echo ran"; echo "rc=$?"' x "$shim" 2>&1)
case $out in *ran*) no "a host that reads as an ssh option refuses" "$out" ;; *rc=2*) ok "a host that reads as an ssh option refuses" ;; *) no "a host that reads as an ssh option refuses" "$out" ;; esac

# 8. run_sol_review takes one slot, and a nested codex inside a held slot takes
# no second one.
printf 'synthetic\n' > "$S/token"; chmod 600 "$S/token"; printf 'prompt\n' > "$S/prompt"
env "${laptop_env[@]}" FAKE_NAME=sol bash -c 'source "$1"; REVIEWER_TOKEN_FILE="$2"; run_sol_review 60 high "$3"; echo "rc=$?" > "$4"' \
  x "$shim" "$S/token" "$S/prompt" "$S/rc-sol" > /dev/null 2> "$S/err-sol" &
echo $! > "$S/pid-sol"
if until_true 30 started sol && grep -qx 'start sol slots=1' "$S/log"; then ok "run_sol_review runs inside one slot"
else no "run_sol_review runs inside one slot" "log: $(cat "$S/log" 2>/dev/null) err: $(cat "$S/err-sol")"; fi
release sol; until_true 30 finished sol
env "${laptop_env[@]}" bash -c 'source "$1"; codex_slot codex exec nest < /dev/null' x "$shim" > /dev/null 2>&1 &
echo $! > "$S/pid-nest"
if until_true 30 started nest && grep -qx 'start nest slots=1' "$S/log"; then ok "a codex inside a held slot takes no second slot"
else no "a codex inside a held slot takes no second slot" "log: $(cat "$S/log" 2>/dev/null)"; fi
reset

# 9. With the limiter off the shim behaves as before: no lock, no ssh, no wait.
EXTRA_ENV=CODEX_SLOTS=off
for i in 1 2 3 4 5 6 7; do start laptop o$i; done
if until_true 30 eval '[ "$(grep -c "^start o" "$S/log" 2>/dev/null)" = 7 ]'; then ok "off: seven run at once"
else no "off: seven run at once" "$(cat "$S/log" 2>/dev/null)"; fi
[ ! -e "$S/ssh-calls" ] && [ ! -e "$S/laptop/.codex-slots" ] && [ "$(m5_held)" = 0 ] \
  && ok "off: no ssh call and no slot taken" || no "off: no ssh call and no slot taken" "$(cat "$S/ssh-calls" 2>/dev/null)"
printf 'off prompt\n' > "$S/in-o8"; start laptop o8 5
until_true 30 started o8; release o8
until_true 30 finished o8
[ "$(cat "$S/rc-o8")" = rc=5 ] && [ "$(cat "$S/stdin-o8")" = "off prompt" ] && ! [ -s "$S/err-o8" ] \
  && ok "off: exit code and stdin pass through, nothing printed" || no "off: exit code and stdin pass through, nothing printed" "$(cat "$S/rc-o8") $(cat "$S/err-o8")"
EXTRA_ENV=
reset

# No holder or lock process outlives the cases.
left=$(pgrep -f "$S/" | grep -v "^$$\$" || true)
[ -z "$left" ] && ok "no process left behind" || no "no process left behind" "$(ps -o pid,command -p $(echo $left | tr ' ' ,))"

[ "$fails" = 0 ] && echo "all codex slot cases pass" || echo "$fails codex slot case(s) failed"
[ "$fails" = 0 ]
