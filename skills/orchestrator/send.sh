#!/bin/zsh
# send.sh PANE TAIL "TEXT" : deliver one line of prose to a Claude pane and prove it landed.
# Idle or done pane: clear, send, probe, Enter, wait for working -> DELIVERED.
# Working pane: send, probe, Enter, then the composer must no longer hold this message and the queued-message marker must
# show -> QUEUED. A marker left by an earlier queued message proves nothing while this text still sits in the composer.
# Escape is never sent: a pane can turn working after the last status read, and Escape interrupts a working turn.
# The probe needs one more TAIL (or paste marker) on screen than before sending.
# Anything else prints STOP <reason> and exits 1. It never re-sends: on STOP, read the pane.
P=$1; TL=$2; X=$3
stop(){ echo "STOP $*"; exit 1; }
[[ -z $P || -z $TL || -z $X ]] && stop "usage: send.sh PANE TAIL TEXT"
[[ $X == *$'\n'* ]] && stop "text has a newline"
[[ $X == *"$TL"* ]] || stop "text does not contain its tail $TL"
status(){ herdr pane get "$P" 2>/dev/null | grep -oE '"agent_status":"[a-z]+"' | cut -d'"' -f4; }
screen(){ herdr pane read "$P" --source visible --lines 30 2>/dev/null; }
marks(){ screen | grep -cE "Pasted text|paste again to expand|$TL"; }
# The composer of the screen on stdin: the lines between its last two rules (lines of ─). Exits 1 with fewer than two.
composer(){ awk '/^(─)+[[:space:]]*$/ { n++; box = buf; buf = ""; next } { buf = buf $0 "\n" } END { if (n < 2) exit 1; printf "%s", box }'; }
DIALOG='usage credits|extra usage|pay-as-you-go|trust this folder|Do you want to|❯ *(1\. *)?(Yes|No)'
screen | grep -qiE "$DIALOG" && stop "pane shows a dialog; read it"
st=$(status)
case $st in
  idle|done)
    [[ $(status) == $st ]] || stop "status changed from $st; read the pane"
    for i in {1..10}; do herdr pane send-keys "$P" Backspace || stop "Backspace failed"; done ;;
  working) ;;
  *) stop "agent_status=${st:-none}" ;;
esac
before=$(marks)
# One send-text of a long line reaches the pane as ~1 KB writes, and Claude Code takes each as its own paste: 1,202 chars
# arrived as their last 180. Pieces of at most 400 bytes, 0.2 s apart, arrive as typing, whole. The UTF-8 locale makes
# a cut fall between characters, never inside one, even for a caller under the C locale.
export LC_ALL=en_US.UTF-8
bytes(){ setopt localoptions nomultibyte; REPLY=${#1}; }
for (( i = 1; i <= ${#X}; i += n )); do
  n=400; while bytes "${X[i,i+n-1]}"; (( REPLY > 400 )); do (( n /= 2 )); done
  herdr pane send-text "$P" "${X[i,i+n-1]}" || stop "send-text failed"; sleep 0.2
done; sleep 2
(( $(marks) > before )) || stop "probe failed; read the pane, do not re-send"
screen | grep -qiE "$DIALOG" && stop "a dialog appeared after the text; read the pane, do not press Enter"
herdr pane send-keys "$P" Enter || stop "Enter failed; read the pane"
if [[ $st == working ]]; then
  sleep 2; after=$(screen)
  box=$(print -r -- "$after" | composer) || stop "$P shows no composer after Enter; read the pane, do not re-send"
  print -r -- "$box" | grep -qE "Pasted text|paste again to expand|$TL" && stop "$P Enter did not submit; read the pane, do not re-send"
  print -r -- "$after" | grep -qF "queued message" && { echo "QUEUED $P"; exit 0; }
  stop "$P shows no queued message after Enter; read the pane, do not re-send"
fi
herdr agent wait "$P" --until working --timeout 45000 >/dev/null && { echo "DELIVERED $P"; exit 0; }
stop "$P not working after Enter; read the pane"
