# Gotchas

- **Claude trust dialog.** `--dangerously-skip-permissions` does not skip "Is this a project you trust?" in a folder that config folder has not opened. The tab shows `blocked`. Read the pane: only when it shows that trust question, send `herdr pane send-keys <pane> Down Enter`, then confirm `working`. Any billing or extra-usage dialog: press nothing and tell whoever dispatched you (the director, in a fleet).
- **Codex trust.** `--yolo` does not skip Codex's "trust this directory?" prompt; the script pre-trusts `cwd` and its real path in `~/.codex/config.toml` before launching.
- **Empty prompt.** Back-to-back launches once lost a prompt file. Only when the pane shows `cat: .../prompt.txt: No such file or directory` and the agent is idle with an empty input box, send the prompt with newlines joined into spaces through `herdr pane send-text <pane> "<prompt>"`, read the pane to see it, then `herdr pane send-keys <pane> Enter`.
- **Quoting.** The prompt goes through a temp file and `"$(cat file)"`, so quotes and newlines survive.
- **Interactive, not headless.** The agent keeps running after its first message; this is not `-p` mode.
- **Where.** The tab opens in the workspace of your current pane; never in a director's, which the script refuses. IDs are parsed from the script's JSON; never assume the `1-2` shape.
- **Stopping one.** Close its tab: `herdr tab close <tab_id>`.
- **Startup prompt.** To have the agent read a startup file first, export `AGENT_PREPROMPT=/path/to/startup.md` and add `"apply_preprompt": true` to the spec; with the variable empty, the script stops rather than send a blank line.
