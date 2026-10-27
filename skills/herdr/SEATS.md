# Headless and unattended seats

For the [herdr skill](SKILL.md), when a seat runs without a person at the pane.

- **`claude -p` exits at turn end.** A headless seat that stands by for a background task to wake it exits instead and orphans its lanes. Keep it waiting inside the turn: loop short foreground checks (`sleep 240` then `tmux has-session`).
- **ssh has no macOS Keychain; `gui/501` launchd does.** Login auth and any `security` call fail from ssh-spawned processes ("Not logged in", "User interaction is not allowed"). Spawn unattended seats from a launchd job or a GUI pane. Proof: a one-shot RunAtLoad plist, read its output file, then `bootout`.
- **After any herdr update**, smoke the seat-boot path before the next unattended round: updates have changed the id format and removed subcommands (`wait` was gone in 0.7.5).
