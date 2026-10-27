# Delivering a prompt to an agent pane

For the [herdr skill](SKILL.md), rules 2 to 8. `send-text` then `Enter` into an agent TUI fails with no error: the text arrives before the first frame, a startup notice eats it, or the text lands and Enter never submits. The pane then sits at an empty prompt looking healthy.

## The send loop

`$text` is one line of prose ending in `$tail`, its own last words, unique to this message (no regex characters); given text is never added to. These are the skill's only copy of its timeouts and attempt cap.

```bash
IDLE_MS=240000 WORKING_MS=45000 TRIES=3
status()   { herdr pane get "$1" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["pane"]["agent_status"])'; }
composer() { herdr pane read "$1" --source visible --lines 14; }
ours()     { grep -qE "Pasted text|paste again to expand|$2" <<<"$1"; }
box()      { awk '/^(─)+[[:space:]]*$/ { n++; b = buf; buf = ""; next } { buf = buf $0 "\n" } END { if (n < 2) exit 1; printf "%s", b }' <<<"$1"; }  # the composer: between the last two rules
modal()    { grep -qiE "trust this folder|credit|billing|Do you want" <<<"$1"; }   # not "permission": the footer has it
deliver() {  # pane text tail; exit 0 delivered, 2 read and look, 3 blocked, 4 modal
  local p=$1 text=$2 tail=$3 s before after
  s=$(status "$p")
  if [ "$s" != done ] && [ "$s" != working ]; then               # cold start only
    herdr wait agent-status "$p" --status idle --timeout $IDLE_MS \
      || composer "$p" | grep -qF "I trust this folder" || return 1   # the dialog may block idle
    sleep 3
    if composer "$p" | grep -qF "I trust this folder"; then       # live dialog, fresh session
      herdr pane send-keys "$p" 1; herdr pane send-keys "$p" Enter; sleep 3
      composer "$p" | grep -qF "I trust this folder" && return 4
      herdr wait agent-status "$p" --status idle --timeout $IDLE_MS || return 1
    fi
  fi
  s=$(status "$p"); case $s in idle|done|working) ;; *) return 3 ;; esac
  before=$(composer "$p")
  [ "$s" = working ] || herdr pane send-keys "$p" Escape
  herdr pane send-text "$p" "$text"; sleep 2                      # sent once, never resent here
  after=$(composer "$p")
  { [ "$after" != "$before" ] && ours "$after" "$tail"; } || { echo "$after"; return 2; }
  for try in $(seq $TRIES); do
    modal "$after" && { echo "$after"; return 4; }                # no Enter on a modal
    herdr pane send-keys "$p" Enter
    if [ "$s" = working ]; then                                    # queues, no flip
      sleep 2; after=$(composer "$p"); b=$(box "$after") || { echo "$after"; return 2; }
      if ! ours "$b" "$tail"; then                                  # left the composer: the marker proves the queue
        grep -qF "queued message" <<<"$after" && return 0; echo "$after"; return 2
      fi; continue                                                  # still in the composer: Enter again
    fi
    herdr wait agent-status "$p" --status working --timeout $WORKING_MS && return 0
    after=$(composer "$p")
    ours "$after" "$tail" || { echo "$after"; return 2; }         # text gone but no flip: look
  done
  return 1
}
```

Exit 2: read and look (rule 6). Exit 4: stop and report the modal.

- A long paste renders collapsed: `[Pasted text #1]` plus a fragment, or only the last few lines followed by `paste again to expand`. A head-only probe then misses a delivered message, which is why the tail phrase exists.
- On a working pane, a `queued message` marker counts only once the composer (the lines between the last two `─` rules) no longer holds this message: an earlier queued message, or a line quoting the marker, leaves it on screen while Enter is swallowed. `orchestrator/send.sh` makes the same check.
- A failed probe means read and look. The usual cause is a delivered message that looks undelivered, and a blind resend double-prompts the lane. The loop compares the composer before and after the send, so a marker left from an earlier paste does not count.
- Trust persists per directory (`~/.claude.json`, `projects.<path>.hasTrustDialogAccepted`), so it bites once per new path; a worktree per agent makes those routine.

## Keystroke-free fallback

When delivery cannot be confirmed, fail loudly and switch to a shape that uses no keystrokes: `claude -p "$prompt"` takes the prompt as an argument and cannot hit this class of failure. Test the fallback too.

## A stuck composer

A pane at `done` with text in its composer (for example `❯ /wrapup`) and no artefact: read the pane, send `Backspace` 10 times (Escape does not clear it), then resend as prose through the loop. If the artefact does exist, the composer text was chrome: leave it.

**Ghost lines.** A finishing pane's composer can show unsent text that reads like its next message, even naming real state (a commit sha). Escape and Backspace do not clear it, so it is probably suggestion chrome. Verify anything it names in git or the artefacts, act only on what the ledger or seat channel carries, and close finished panes promptly.

## Verifying by artefact

```bash
find "$ARTEFACT_DIR" -maxdepth 1 -newermt "$BOOT_TIME" | grep -i "<phrase unique to this pane>"
```

Match by the ticket number or the lane's title words plus mtime, never by a word another lane could share: a shared word once closed a pane on an earlier lane's record. If the record is missing, rebuild it from the seat's transcript at `~/.claude-seat-<seat>/projects/<cwd-slug>/<session>.jsonl`, found with `grep -l` on the brief's filename.
