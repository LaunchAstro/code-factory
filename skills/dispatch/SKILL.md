---
name: dispatch
description: Hand one task to a fresh Claude or Codex agent in its own herdr tab, seeded with a self-contained prompt. Use when asked to dispatch, hand off or spin up a task in a new tab, or an orchestrator boots a Codex lane.
metadata:
  job: hand off a task
  form: workflow
  source: local
  version: 0.3.0
---

**Hand off** one task to a fresh agent in its own visible tab: you write the prompt, `herdr-dispatch` opens the tab, launches the agent with permission prompts skipped, and sends the prompt as its first message. The session stays interactive for the owner.

## Not for
- A helper whose result comes back into this conversation: `sub-agents` owns that.
- Booting a Claude lane on a chosen seat: `claude-subscription-switch` owns that.

## Inputs and authority
- Needs: `HERDR_ENV=1`, the task, the backend (`claude` or `codex`; ask if unsaid) and the working folder (else `$HOME`). Not inside herdr: reply `BLOCKED: not inside herdr`.
- May: write a spec file in the temp folder, run `herdr-dispatch`, read the new tab's pane, and send the trust answer or re-send a lost prompt per [GOTCHAS.md](GOTCHAS.md).
- Never: keep working the task yourself or pull its output back into this chat; once it is live, it belongs to the owner, or to the orchestrator for a fleet lane. Never press a key into a billing, extra-usage or trust dialog except the trust answer in [GOTCHAS.md](GOTCHAS.md).

## Steps
1. **Install once.** Run `install -m 755 herdr-dispatch ~/.local/bin/herdr-dispatch` from this skill's folder. Done when: `command -v herdr-dispatch` prints a path.
2. **Write the prompt**, self-contained: context, limits and the definition of done; the new agent sees only this. It ends by telling the agent to finish with `close-out`. A fleet lane's prompt is its one boot line pointing at its brief (`orchestrator` brief.md); the lane then owns its piece until it merges. A single agent's prompt names the repo, the problem and the area, and tells it to run `single-agent`; pick its seat with `seat-gauge` first. Done when: the prompt names its done.
3. **Write the spec** to `$TMPDIR/dispatch-<slug>.json`:

   ```json
   {"task": "Refactor the auth module", "slug": "refactor-auth", "backend": "claude",
    "cwd": "/abs/path/to/repo", "prompt": "Full self-contained brief...", "wait": false}
   ```

   `slug` is the tab label (`<REPO>-<Section>-<Seat>` for a fleet lane); left out, the script builds one from `task`. The tab opens beside you, never in a director's workspace: the script refuses one (any label with a `Director` or `Remote-Control` part). `agent` overrides the launch command, for example `codex --yolo -m gpt-6.1-sol -c model_reasoning_effort=high`. That example is a builder launch. For Code Factory reviews in either mode, use the risk-aware `run_sol_review <seconds> <low|medium|high> <prompt-file>` entry point from the assigned Code Factory shim instead: medium except high-risk at high, unsure high; fix passes retain the whole PR rank ([risk categories](../../docs/SOL-EFFORT.md)). Leave `wait` false unless asked to block. Done when: the file parses as JSON.
4. **Launch** with `herdr-dispatch $TMPDIR/dispatch-<slug>.json` (add `--dry-run` first to test the layout without an agent). Launch several dispatches 5 seconds apart. Done when: it prints a `tab_id` and `pane`.
5. **Confirm and step back.** About 10 seconds later, `herdr tab list`: a `blocked` tab is a trust dialog, handled per [GOTCHAS.md](GOTCHAS.md). Done when: the tab shows `working` and you have said which tab, which backend and what it was told.

## Output
One line: the tab label, the backend and the task. For a fleet lane, the orchestrator then waits for its `LANE-<LABEL>-BOOTED` reply.

## Reads
- [GOTCHAS.md](GOTCHAS.md) when a tab is blocked or starts with an empty prompt.
