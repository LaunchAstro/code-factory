# Handover

Start step 1 when `ctx.sh` prints `PREPARE` (the skill's step 7), step 2 when it prints `HANDOVER` or `RELAY-LOG.md` has a `DIRWATCH` line for your pane, and finish inside METHOD's hard cap. A `HANDOVER` or `DIRWATCH` with no boot file written yet: do step 1 first, then step 2. Here n is your director number.

1. **Write the boot file** `$ROUND/REMOTE-CONTROL-BOOT-<n+1>.md`:
   - First line: `Load the director skill and follow it. You take over from <your-pane> (director <n>, <seat>), remote control on as <PROJ>-Director-<n+1>.`
   - `## Read first`: the register entries added since your boot, `ORCHESTRATOR-STATE.md`, and owner files added this round.
   - `## Where it stands`: the orchestrator's pane and seat; other fleets' panes to leave alone; open director reads.
   - `## Owed by the owner`: each item with your recommendation.
   - Last line: `DIRECTOR-<n+1>-BOOT-END`.

   Then run `wrap-up` (`/wrapup`) while you still have room for the owner's words verbatim. Done when: the three sections each have a bullet, `tail -1` shows `DIRECTOR-<n+1>-BOOT-END`, and the wrap-up printed its record's path.
2. **Boot the successor** with remote control already on. Each director sits alone in its own workspace, `<PROJ>-Director-<n>`: nothing opens a tab or pane in it, and `herdr-dispatch` refuses any workspace label with a `Director` or `Remote-Control` part. Pick a full-login seat with `claude-subscription-switch`, open a new workspace for it alone, `herdr workspace create --cwd "$HOME" --label <PROJ>-Director-<n+1> --no-focus` (never a tab or split in your own or any other workspace), resolve its pane with `herdr`, and launch on the seat's own login, which remote control needs:

   ```sh
   env -u CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CONFIG_DIR="$HOME/.claude-seat-<seat>" claude --dangerously-skip-permissions --model opus --effort high --remote-control "<PROJ>-Director-<n+1>"
   ```

   Read its pane before every key: a billing, extra-usage or trust dialog takes Enter as yes, so press nothing there and tell the owner. Type no slash command into its pane. Its first message: `Read $ROUND/REMOTE-CONTROL-BOOT-<n+1>.md in full and follow it.` with the path written out. Done when: its pane shows `working`.
3. **Wait for its line** `RELAY-HANDOVER <your-pane> -> <successor-pane>` (herdr pane ids) in `events.log`: look every 60 seconds for up to 20 minutes. Not there: read its pane, fix what blocks it, resend once. Still not there after 20 more minutes: tell the owner and stay on.
4. **Stop your own loops**: `kill <kicker PID>` from your boot line, and CronDelete your check. Done when: `ps -p <kicker PID>` prints no process.
5. **Tell the owner** in one line: `Director <n+1> is <successor-pane>, remote control as <PROJ>-Director-<n+1>.` Append `- HH:MM wrap: handed to director <n+1> (<successor-pane>).` to `RELAY-LOG.md`. Leave your pane open: the owner chats in it and closes it.
