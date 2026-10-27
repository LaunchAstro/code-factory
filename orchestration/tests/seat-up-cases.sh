#!/usr/bin/env bash
# Cases for orchestration/seats/claude-seat-up, under a scratch HOME with herdr
# stubbed on PATH. The stub's `pane run` hands its command to /bin/sh, the way
# a pane's shell would. Sol's review of 69afe53 found a pass-through argument
# run as a second command, and `all` reporting success after a pane failed.
# No case boots a real seat or reads a real token.
set -uo pipefail

seat_up=$(cd -- "$(dirname -- "$0")/.." && pwd)/seats/claude-seat-up
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
fails=0
ok() { printf '  PASS  %s\n' "$1"; }
no() { printf '  FAIL  %s\n        %s\n' "$1" "$2"; fails=$((fails + 1)); }

mkdir -p "$scratch/bin"
cat > "$scratch/bin/herdr" <<'STUB'
#!/bin/sh
state="$SEAT_CASE_DIR/workspaces"
case "$1 $2" in
  "workspace list")
    printf '{"result":{"workspaces":['
    sep=""
    [ -f "$state" ] && while IFS= read -r label; do
      printf '%s{"workspace_id":"w-%s","label":"%s"}' "$sep" "$label" "$label"; sep=","
    done < "$state"
    printf ']}}\n'
    # A list that prints good JSON and still fails, always or before any
    # workspace exists.
    case "${SEAT_CASE_FAIL_LIST:-}" in
      workspace) exit 43 ;;
      workspace-first) [ -f "$state" ] || exit 43 ;;
    esac ;;
  "workspace create")
    shift 2
    while [ $# -gt 0 ]; do [ "$1" = --label ] && echo "$2" >> "$state"; shift; done ;;
  "workspace focus")
    if [ -n "${SEAT_CASE_FAIL_FOCUS:-}" ]; then exit 43; fi
    echo "$3" >> "$SEAT_CASE_DIR/focused" ;;
  "pane list")
    printf '{"result":{"panes":[{"pane_id":"p1"}]}}\n'
    if [ "${SEAT_CASE_FAIL_LIST:-}" = pane ]; then exit 43; fi ;;
  "pane run")
    [ -n "${SEAT_CASE_FAIL_PANE:-}" ] && exit 43
    exec /bin/sh -c "$4" ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$scratch/bin/herdr"
# The script waits a second after each workspace create for herdr to settle.
# No stubbed herdr needs it, and 30 boots of real waits ran this suite past
# factory-cases.sh's 30-second limit on the M5 (#335 at 429ecd9).
printf '#!/bin/sh\nexit 0\n' > "$scratch/bin/sleep"
chmod +x "$scratch/bin/sleep"

# fresh: a scratch HOME with a launcher and a token for each named seat. The
# launcher writes each argument it got on its own line, and the AGENT_TASK it
# was started with.
fresh() {
  rm -rf "$scratch/home" "$scratch/seat-tokens" "$scratch/case"; mkdir -p "$scratch/home"/bin "$scratch/seat-tokens" "$scratch/case"
  for seat in "$@"; do
    printf '#!/bin/sh\nfor a in "$@"; do printf "%%s\\n" "$a"; done > "%s/args-%s"\nprintf "%%s" "${AGENT_TASK-unset}" > "%s/task-%s"\n' \
      "$scratch/case" "$seat" "$scratch/case" "$seat" > "$scratch/home"/bin/claude-$seat
    chmod +x "$scratch/home"/bin/claude-$seat
    printf 'synthetic-seat-marker\n' > "$scratch/seat-tokens/$seat.token"
  done
}
up() {  # AGENT_TASK unset, so a case sees only what claude-seat-up sets
  env -u AGENT_TASK HOME="$scratch/home" CLAUDE_SEAT_TOKEN_DIR="$scratch/seat-tokens" PATH="$scratch/bin:$PATH" SEAT_CASE_DIR="$scratch/case" zsh "$seat_up" "$@" >/dev/null 2>&1
}

echo "seat-up cases, against $seat_up"

fresh one
up one --model opus
rc=$?
if [ $rc = 0 ] && [ "$(cat "$scratch/case/args-one" 2>/dev/null)" = "$(printf -- '--dangerously-skip-permissions\n--model\nopus')" ]; then
  ok "a seat boots with its arguments passed through"
else
  no "a seat boots with its arguments passed through" "rc=$rc, launcher got: $(tr '\n' ' ' < "$scratch/case/args-one" 2>/dev/null)"
fi

# One argument stays one argument, whatever it holds.
fresh one
hostile="opus; : > $scratch/case/injected"
up one --model "$hostile"
if [ -e "$scratch/case/injected" ]; then
  no "a pass-through argument runs no command" "the argument ended the launcher's command and ran another"
elif [ "$(sed -n 3p "$scratch/case/args-one" 2>/dev/null)" != "$hostile" ]; then
  no "a pass-through argument runs no command" "the launcher got: $(tr '\n' '|' < "$scratch/case/args-one" 2>/dev/null)"
else
  ok "a pass-through argument runs no command"
fi
fresh one
up one '$(: > '"$scratch"'/case/injected)' "a'b" 'c d'
expected="$(printf '%s\n%s\n%s' '$(: > '"$scratch"'/case/injected)' "a'b" 'c d')"
if [ -e "$scratch/case/injected" ]; then
  no "quotes, spaces and substitutions arrive as written" "a substitution was expanded by the pane's shell"
elif [ "$(sed -n 2,4p "$scratch/case/args-one" 2>/dev/null)" != "$expected" ]; then
  no "quotes, spaces and substitutions arrive as written" "the launcher got: $(tr '\n' '|' < "$scratch/case/args-one" 2>/dev/null)"
else
  ok "quotes, spaces and substitutions arrive as written"
fi

# A seat name becomes part of a path and of the pane's command, so it is a
# plain name or nothing.
fresh one
up 'one;: > '"$scratch"'/case/injected'
rc=$?
[ $rc != 0 ] && [ ! -e "$scratch/case/injected" ] && ok "a seat name with shell syntax is refused" \
  || no "a seat name with shell syntax is refused" "rc=$rc, injected: $([ -e "$scratch/case/injected" ] && echo yes || echo no)"

# `all` says so when a seat did not boot.
fresh one two
SEAT_CASE_FAIL_PANE=1 up all
rc=$?
[ $rc != 0 ] && ok "all fails when a pane does not run" || no "all fails when a pane does not run" "exit 0 after herdr pane run exited 43"
fresh one two
up all
rc=$?
[ $rc = 0 ] && [ -e "$scratch/case/args-one" ] && [ -e "$scratch/case/args-two" ] && ok "all boots every seat holding a token" \
  || no "all boots every seat holding a token" "rc=$rc"
fresh one
SEAT_CASE_FAIL_PANE=1 up one
rc=$?
[ $rc != 0 ] && ok "one seat fails when its pane does not run" || no "one seat fails when its pane does not run" "exit 0"
fresh one
rm "$scratch/home"/bin/claude-one
up all
rc=$?
[ $rc != 0 ] && ok "all fails when a seat has no launcher" || no "all fails when a seat has no launcher" "exit 0"
# Sol's review of 8e3681d: no case gave `all` an empty token directory.
fresh
up all
rc=$?
[ $rc != 0 ] && ok "all fails when no seat holds a token" || no "all fails when no seat holds a token" "exit 0 with no seat booted"

# Sol's review of 7790dc6: a list piped into the JSON parser returned the
# parser's status, so a herdr list that failed still booted a seat.
for failing in workspace workspace-first pane; do
  for how in one all '--existing one'; do
    fresh one
    SEAT_CASE_FAIL_LIST=$failing up $how
    rc=$?
    [ $rc != 0 ] && [ ! -e "$scratch/case/args-one" ] && ok "a failing $failing list boots no seat ($how)" \
      || no "a failing $failing list boots no seat ($how)" "rc=$rc, launcher ran: $([ -e "$scratch/case/args-one" ] && echo yes || echo no)"
  done
done

# Sol's review of 87a9f77: no --existing case had a running seat to focus, so
# a focus failure reported as success left every case green.
fresh one
echo seat-one > "$scratch/case/workspaces"
SEAT_CASE_FAIL_FOCUS=1 up --existing one
rc=$?
[ $rc != 0 ] && [ ! -e "$scratch/case/args-one" ] && ok "a running seat whose focus fails is not reported up" \
  || no "a running seat whose focus fails is not reported up" "rc=$rc, launcher ran: $([ -e "$scratch/case/args-one" ] && echo yes || echo no)"

# Sol's review of #318 at 54c8417: a role window (OA-Orchestrator) carried no
# seat, so --existing could not find it, nor a numbered OA-Job-Alpha-2. Every
# label now ends in the seat; only the name decides AGENT_TASK.
for name in OA-Orchestrator OA-Director OA-Remote-Control OA-Slice-8; do
  fresh one
  up --name $name one
  rc=$?
  [ $rc = 0 ] && grep -qx "$name-One" "$scratch/case/workspaces" 2>/dev/null && ok "--name $name labels its window $name-One" \
    || no "--name $name labels its window $name-One" "rc=$rc, labels: $(tr '\n' ' ' 2>/dev/null < "$scratch/case/workspaces")"
done
for name in OA-Orchestrator OA-Director OA-Remote-Control ''; do
  fresh one
  up ${name:+--name "$name"} one
  task=$(cat "$scratch/case/task-one" 2>/dev/null)
  what="the ${name:-bare seat} pane boots without AGENT_TASK"
  [ "$task" = unset ] && ok "$what" || no "$what" "AGENT_TASK=$task"
done
fresh one
up --name OA-Slice-8 one
task=$(cat "$scratch/case/task-one" 2>/dev/null)
[ "$task" = 1 ] && ok "a named job boots with AGENT_TASK=1" || no "a named job boots with AGENT_TASK=1" "AGENT_TASK=$task"
for label in OA-Orchestrator-One OA-Remote-Control-One OA-Job-One-2 seat-one-2; do
  fresh one
  printf 'Other-Two\n%s\n' "$label" > "$scratch/case/workspaces"
  up --existing one
  rc=$?
  [ $rc = 0 ] && [ "$(cat "$scratch/case/focused" 2>/dev/null)" = "w-$label" ] && [ ! -e "$scratch/case/args-one" ] \
    && ok "--existing focuses $label" \
    || no "--existing focuses $label" "rc=$rc, focused: $(cat "$scratch/case/focused" 2>/dev/null), launcher ran: $([ -e "$scratch/case/args-one" ] && echo yes || echo no)"
done
# Sol r1 and r2 on #335: with a dash allowed in a seat name, OA-Job-X-One read
# as seat one's or seat x-one's depending on which seats held tokens, even after
# the window was made. A seat name is now letters, digits, . and _, starting
# with a letter, so a label's seat is its last part before an optional -<n>.
fresh one two
printf 'OA-Job-Two\nOA-Job-One-Extra\nCFR-Orchestrator\n' > "$scratch/case/workspaces"
up --existing one
rc=$?
[ $rc = 0 ] && [ ! -e "$scratch/case/focused" ] && [ -e "$scratch/case/args-one" ] && ok "--existing focuses no other seat's window" \
  || no "--existing focuses no other seat's window" "rc=$rc, focused: $(cat "$scratch/case/focused" 2>/dev/null)"
for seat in x-one 2c; do
  fresh one "$seat"
  up --name OA-Job "$seat"
  rc=$?
  [ $rc != 0 ] && [ ! -e "$scratch/case/workspaces" ] && [ ! -e "$scratch/case/args-$seat" ] && ok "a seat named $seat is refused" \
    || no "a seat named $seat is refused" "rc=$rc, labels: $(tr '\n' ' ' 2>/dev/null < "$scratch/case/workspaces")"
done
# Sol r3 on #335 (#336): a window made before roles carried the seat keeps its
# label (CFR-Director), so a seat named director would take it from the seat it
# runs on. A role word is never a seat, in any case. Sol r4 (#359): nor is old,
# which the orchestrator hand-over gives its outgoing window (CFR-Orchestrator-Old).
for seat in director orchestrator remote control old Director; do
  fresh "$seat"
  printf 'CFR-Director\nCFR-Orchestrator\nCFR-Remote-Control\nCFR-Remote\nCFR-Orchestrator-Old\n' > "$scratch/case/workspaces"
  up --existing "$seat"
  rc=$?
  [ $rc != 0 ] && [ ! -e "$scratch/case/focused" ] && [ ! -e "$scratch/case/args-$seat" ] && ok "--existing $seat is refused, not another seat's role window" \
    || no "--existing $seat is refused, not another seat's role window" "rc=$rc, focused: $(cat "$scratch/case/focused" 2>/dev/null)"
  fresh "$seat"
  up "$seat"
  rc=$?
  [ $rc != 0 ] && [ ! -e "$scratch/case/workspaces" ] && [ ! -e "$scratch/case/args-$seat" ] && ok "a seat named $seat is refused" \
    || no "a seat named $seat is refused" "rc=$rc, labels: $(tr '\n' ' ' 2>/dev/null < "$scratch/case/workspaces")"
done

fresh one
up --name OA-Job-X one
up --existing one
rc=$?
[ $rc = 0 ] && [ "$(cat "$scratch/case/focused" 2>/dev/null)" = w-OA-Job-X-One ] && ok "--existing one finds the OA-Job-X-One it booted" \
  || no "--existing one finds the OA-Job-X-One it booted" "rc=$rc, focused: $(cat "$scratch/case/focused" 2>/dev/null)"
# The same window, after a seat x-one is provisioned beside it: still one's.
cp "$scratch/seat-tokens/one.token" "$scratch/seat-tokens/x-one.token"
rm -f "$scratch/case/focused"
up --existing one
rc=$?
[ $rc = 0 ] && [ "$(cat "$scratch/case/focused" 2>/dev/null)" = w-OA-Job-X-One ] && ok "a window keeps its seat when an overlapping seat name is provisioned" \
  || no "a window keeps its seat when an overlapping seat name is provisioned" "rc=$rc, focused: $(cat "$scratch/case/focused" 2>/dev/null)"

fresh one
up --name 'OA-Job;: > '"$scratch"'/case/injected' one
rc=$?
[ $rc != 0 ] && [ ! -e "$scratch/case/args-one" ] && ok "a name with shell syntax is refused" || no "a name with shell syntax is refused" "rc=$rc"

echo
echo "seat-up cases: $fails failed"
[ $fails = 0 ]
