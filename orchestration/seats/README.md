# Seats

`claude-seat-up [--name <PROJ>-<Job>] <SEAT> [--model <MODEL>]` boots a Claude
Code seat as a fresh herdr window. It is here so the shape is recorded, not so
it can be run from here. Nothing it needs lives in this repository, and nothing
it needs should ever be committed to one.

What it reads, all outside the repository:

- `~/bin/claude-<SEAT>`: the per-seat launcher, one per subscription.
- `$CLAUDE_SEAT_TOKEN_DIR/<SEAT>.token`: the seat's token, in a folder you choose. Never copied, never
  quoted, never printed into a brief, a handback or a trail.

Every seat boots with permission checks off: the launcher always runs
`claude-<SEAT> --dangerously-skip-permissions`, before any argument you pass.
A seat then edits files and runs commands without asking.

Each argument after the seat reaches the launcher as one argument, quoted for
the pane's shell; a seat name is letters, digits, `.` and `_`, starting with a
letter; and `all` exits non-zero when any seat fails to boot, or when no seat
holds a token. `../tests/seat-up-cases.sh` holds the cases, under a scratch `HOME` with `herdr` stubbed.

Every window's label ends in its seat: `seat-<SEAT>` with no name, otherwise
`<NAME>-<Seat>`, role panes included (`<PROJ>-Orchestrator-<Seat>`,
`-Director`, `-Remote-Control`), then `-2`, `-3` when the label is taken. A
named job starts with `AGENT_TASK=1`, so it boots from its brief alone; a role
pane or a bare seat starts without it. `--existing <SEAT>` focuses the first
running window whose label ends in that seat, numbered or not, and opens a new
one only when there is none. A seat name holds no dash, so `OA-Job-X-One` is
always seat `one`'s, whatever other seats exist. A window labelled before roles
carried the seat (`<PROJ>-Orchestrator`) names no seat, so only its label finds
it.

`claude-seat-up` in this directory is the only copy. The
`claude-subscription-switch` skill under `../skills/` carries the mechanism and
the launcher template, and points back here for the script.

`<SEAT>` in the usage lines is the seat's own name, the same placeholder
`../README.md` lists. Seat names are yours and belong in your private roster,
never in this repository.
