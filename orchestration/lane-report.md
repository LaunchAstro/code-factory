# Lane report

`lane-report.mjs` makes one report-only pass over an explicit fleet inventory.
The shipped CLI runs synthetic fixtures. `--live` refuses before reading a
pane, contacting Ollama, creating a timer or writing a report. The source seal
`LIVE_RELEASED = false` has no flag or environment override.

## Run the synthetic example

Use a new output directory for each pass. The parent directory must exist.

```sh
node orchestration/lane-report.mjs \
  --fixture orchestration/tests/fixtures/lane-report.json \
  --out /tmp/lane-report-example-1
node orchestration/lane-report.mjs \
  --fixture orchestration/tests/fixtures/lane-report.json \
  --previous /tmp/lane-report-example-1/report.json \
  --out /tmp/lane-report-example-2
node --test orchestration/tests/lane-report*-cases.mjs
```

The first pass writes `events.log`, `director-note.txt` and `report.json`.
The second emits no event because the classification has not changed.
Files are created with mode 0600 inside a new directory with mode 0700.
An existing output directory is refused. Input JSON is bounded to 128 KiB;
symlinks and non-regular files are refused.
Invoking the CLI through a symlink runs the same report pass. Symlinked
`--live` invocations return the same explicit refusal as direct invocations.

## Input and classifications

The inventory is an array of 1 to 16 rows. Each row has exactly `id`,
`machine`, `pane`, `workOwed` and `lastProgressAt`. The example shows their
types. The parent supplies the inventory from its current round state.
M4 workspaces are limited to `wQ1A`, `wQ1B`, `wQ1C` and `wQ1D`. M5 rows must
name only the parent's assigned lane labels and panes. No pane discovery runs.
Duplicate labels, duplicate machine/pane pairs, extra fields, invalid times
and future progress timestamps refuse the whole pass before external I/O.

A metadata read must match the expected pane ID and exact named lane identity.
The legacy `title` must equal the inventory's `id`. Native `terminal_title`
and `terminal_title_stripped` may equal that label or have exactly the form
`caption | label`, with the final label equal to `id`. A single leading
Braille spinner or `✳` and space is removed from `terminal_title`. When both
native fields are supplied, the cleaned title must equal the stripped title.
Every supplied title field must agree; substring matches, suffix additions
and conflicting fields are refused. A reused or renamed pane becomes `unknown`
before any content read. Progress timestamps are parent evidence, not
inferred from spinner activity or a model's claim. Refresh that evidence
before each future live pass. Stale inventory cannot establish current health.

The model receives only boolean signals. No original text, inventory label,
credential, password, verification code or third-party content enters its
prompt. Signal priority and accepted results are:

| Signal                                           | Status       | Reason          |
| ------------------------------------------------ | ------------ | --------------- |
| Dialog keyword                                   | needs-person | dialog          |
| At least three error/failed/exception words      | stuck        | repeated-error  |
| Idle with work owed                              | stuck        | idle-work-owed  |
| Working with no progress for at least 60 minutes | stuck        | no-progress-60m |
| Blocked                                          | needs-person | blocked         |
| Working below that threshold                     | fine         | recent-progress |
| Done                                             | fine         | done            |
| Idle without work owed                           | fine         | idle-no-work    |

This is conservative keyword classification. It does not understand arbitrary
dialogs or prove an agent's work correct. Unknown metadata, failed reads,
control characters, oversized content, unavailable models and invalid or
contradictory replies become `unknown`, reason `unavailable`. Model JSON must
have exactly two enum fields. Duplicate members, commands, tools, free prose
and added fields are refused. A model cannot override an observed problem.

Only changed label/machine/pane/status/reason tuples produce an event line
and Director note. `report.json` supplies the next pass's `--previous` input.
Reports stay in the pass's local directory. This command never appends to a
shared production log, posts a message or acts on a lane.

## Runtime held for review and release

The live transport is present behind the source seal and has not been run.
Its command line is `node orchestration/lane-report.mjs --live --inventory
<file> --out <file> [--now <UTC time>] [--previous <file>]`; until the seal
(`LIVE_RELEASED = false` in `lane-report.mjs`) is lifted in a reviewed
release, it prints `lane-report: refused-or-unavailable; live requires Sol
review and parent release` and exits 1.
Its command plan uses only `herdr pane get` and `herdr pane read`, 80 visible
lines, with a 1.5 second timeout and 16 KiB command output cap. Observed text
is further limited to 8 KiB. M5 reads are local; M4 uses the SSH alias named in
`LANE_REPORT_M4_SSH` (required; letters, digits, dot, dash and underscore) with batch mode and a one second connect timeout. No input command,
pane control, stop, merge, review, rebase or product write exists in the plan.

The HTTP transport pins TCP to `127.0.0.1:11434`, accepts only `/api/ps` and
`/api/generate`, ignores HTTP proxy environment settings, refuses redirects,
caps each response at 16 KiB and ends a request after 1.5 seconds. Generation
uses only `qwen3.6:35b-mlx`, 128 predicted tokens and a 2048 token context.
It may use an already loaded 35b, or load it when only
`qwen3.6:27b-mlx` or no model is loaded. A snapshot with more than two loaded
models is refused. No other model is loaded or unloaded. The slot snapshot
cannot prevent another client loading a model between the check and call.
The parent must coordinate the shared slot with the work-map audit before
runtime release. This command never changes an Ollama service cap.

Read the [one-day trial runbook](lane-report-trial.md) before any runtime release.
