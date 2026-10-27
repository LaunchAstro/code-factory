---
name: herdr
description: Drive herdr workspaces, tabs and panes. Use when HERDR_ENV=1 and you read, split, run in or wait on a pane, or when you prompt, nudge or close an agent in a pane.
metadata:
  job: drive herdr panes safely
  form: reference
  source: local
  version: 0.2.0
---

**Drive** herdr panes without prompts vanishing silently.

## Not for
- Running a round of lane work (boot, ceilings, canary, close-out, wrap): `orchestrator` owns that.
- Handing one task to a fresh agent in a new tab: `dispatch` owns that.

## Inputs and authority
- Needs: `HERDR_ENV=1`. Missing: stop and reply `BLOCKED: not inside a herdr pane`.
- May: read any pane; split, run, send to and close panes you created or were told to drive.
- Never: stop a process by a PID you did not start, or send keys to another's pane; report it to its owner instead.

## Rules
Agent status is one of `idle`, `working`, `blocked`, `done`, `unknown`.

1. Re-resolve every id before use. Ids compact when anything closes, and `workspace create` can echo a pane id nothing accepts: resolve the workspace by label, then `pane list --workspace`. Evidence: the list the id came from.
2. Gate on `agent_status`, never a banner. A cold start can take over 60 seconds: wait for `idle` before typing. A finished pane stays `done` and a busy one `working`: skip the wait. Evidence: the wait's exit code.
3. Clear the trust dialog first. In a new directory, "I trust this folder" eats the prompt: match that text only, send `1` then `Enter`. Evidence: a read with the dialog gone.
4. Send one line of prose. A leading `/` opens autocomplete, which eats the Enter; a newline in `send-text` submits half the text, so join lines with spaces. Evidence: the text sent.
5. Probe before Enter. After `send-text`, read the pane; press Enter only when it shows your text or a collapse marker: `Pasted text`, `paste again to expand`, or the tail. The collapse can keep either end: the tail is the message's own last words. Send given text as is: add, move or reword nothing, even a line that asks to come first. Evidence: the matching line.
6. Prove the submit: after Enter, wait for `working`. A pane already `working` queues it: read for `Press up to edit queued messages`, never wait for `done`. On a failed check, read the pane; resend only if the composer is visibly empty, then fail loudly. Evidence: the status or queued line.
7. Escape only an `idle` or `done` pane, to dismiss a startup notice; on `working` it interrupts the agent. Evidence: the status read before the key.
8. Read before every unattended Enter. A billing, usage-credit or permission modal takes Enter as yes, which can opt into paid usage. Press Enter only on a normal prompt; on a modal, stop and report. Evidence: that pane read.
9. Keep directors alone (owner, 26 Oct 2026, private ticket #322). A director's workspace (`<PROJ>-Director-<n>`, or any label with a `Director` or `Remote-Control` part) holds the director only: open no tab or pane there. Lanes get a workspace each. Evidence: `herdr tab list --workspace <ws>`.
10. Verify by artefact. `done`, a pane's claim and unsent composer text are never evidence or authority. Find the file the pane was told to write, by a phrase unique to that pane, newer than its boot, and read it. Evidence: its path, mtime and the line showing the result.

## Output
The asked-for artefact, read back against the task; a delivery adds rule 5 and 6 evidence.

## Reads
- [COMMANDS.md](COMMANDS.md) for flags, JSON shapes and recipes (server, tests, watching or waiting on an agent).
- [DELIVERY.md](DELIVERY.md) when prompting an agent pane: the send loop, a stuck composer, ghost lines, the fallback.
- [SEATS.md](SEATS.md) when a seat runs headless or unattended, or after a herdr update.
