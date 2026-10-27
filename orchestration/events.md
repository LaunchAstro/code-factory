# Round event grammar

`events.mjs` exports `parseEventLine(line)`. All kit watchers and roadmap
readers should import this parser; deployment of the watchers is a separate
round-boundary step. This module performs no reads, writes, GitHub calls, or
pane actions. Existing round tools remain unchanged.

## Envelope and result

One physical UTF-8 line is:

```text
YYYY-MM-DDTHH:mm:ssZ ACTOR EVENT [MESSAGE]
```

The timestamp is a valid UTC calendar date and time, to whole seconds.
`ACTOR` starts with a letter or digit and contains letters, digits, dots,
underscores or hyphens. A single space separates the envelope fields.
Newlines and carriage returns inside an input are refused. Split a log into
physical lines first, removing its CRLF terminators if necessary. The final
file newline is a terminator, not an event. Blank lines are unknown.

Every recognised record has `timestamp`, `actor` and a discriminating `type`.
The exported JSDoc `EventRecord` union can be checked with TypeScript:

- `MergeRecord`: `type: 'MERGED'`, `pr: number`, `head: string | null`,
  `mergeCommit: string | null`, `fields: Record<string, string>`.
- `RunRecord`: `type: 'RUN-END'`, `subject: string`, `head: string | null`,
  `verdict: string | null`, `fields: Record<string, string>`.
- `ScopeRecord`: `type: 'SCOPE'`, `status: 'CLEAN' | 'FINDINGS' | 'UNKNOWN'`,
  `pr: number | null`, `fields: Record<string, string>`.
- `NoteRecord`: a listed literal `type`, `message: string`,
  `subject: string | null`, `pr: number | null`, `head: string | null`,
  `fields: Record<string, string>`, `counts: Record<string, number>`.
- Any unrecognised type, malformed envelope, invalid timestamp, or invalid
  merge identifier, lane declaration or SCOPE report returns exactly
  `{ type: 'unknown' }`. No exception, raw
  input echo, inferred event from a word in prose, or alternate unknown shape.

`MESSAGE` is historical free text unless a structured form below applies.
`fields` exposes every space-delimited `key=value` pair as a string. Keys
start with a letter, then letters, digits, underscores or hyphens; values end
at whitespace, comma, semicolon or parentheses. Empty values are retained,
duplicate keys use the last value, and unlisted keys remain data. These are
reported values, never health, gate, count or authorization decisions.
`pr` is the first positive, safe integer `#number` outside parentheses before
the space-delimited `head=` field (or a bare number immediately before that
field). In `PR-OPENED #issue piece #pr`, the piece identifier is the PR; the
leading issue is not. Suffixed batch labels such as `#1084-R4B-m2` are not
plain PR identifiers. `head` is 7–40 lowercase hexadecimal characters after
`head=` or `head ` at the start of the message or preceded by whitespace or
an opening parenthesis; a suffix such as `previous-head=` never matches.
Absent or invalid historical metadata stays `null`. The narrative remains in `message` for
notes. `subject` is the recipient for ASK and the leading `#number` for
ISSUE-NOTE; otherwise it is null. `counts` is empty except for SUBAGENTS.

Some historical announcements are incomplete: a READY correction has no
head; PR-OPENED can have a bare `#`, only a batch label, or a bare PR number.
These are known notes with nullable identifiers. Do not count them as an
identified READY PR or approval. An unlisted event token is always unknown,
even if its message resembles one of the events below.

## Structured forms

### Lane declarations

BOOTED and TICKET notes also expose these optional declarations in
`fields`, following the live roadmap's
`CONVENTION.md` (in the private roadmap repository)
and the section convention (private ticket #141):

```text
2026-10-14T01:00:00Z BUILD-A BOOTED (model, seat example) Ticket: C80 Section: checks machine=m5
2026-10-14T01:01:00Z BUILD-B BOOTED Ticket: none Section: checks
2026-10-14T01:02:00Z BUILD-A TICKET Ticket: C81 Section: checks
2026-10-14T01:03:00Z BUILD-A TICKET Ticket: C81 complete Section: checks
```

- `Ticket: C80` becomes `fields.ticket: 'C80'`; several IDs such as
  `Ticket: C80, C81` become `'C80, C81'`. `Ticket: none` explicitly names
  work outside the plan. IDs start with an uppercase letter, contain a digit,
  and consist of uppercase letters/digits with optional hyphen-separated
  alphanumeric segments, including `S0-1` and `MP-1-2`. This parser checks
  spelling, not membership of a project's plan. Descriptive words after
  the IDs, such as `Ticket: C80, the About page`, remain in `message`.
- `Unit: U32` becomes `fields.unit: 'U32'` for work naming a whole unit.
  Ticket and Unit declarations cannot be combined in the same line.
- `Section: checks` becomes `fields.section: 'checks'`. Section IDs are
  lowercase letters/digits or hyphens and start with a letter, matching
  #141's section-map schema (`^[a-z][a-z0-9-]*$`). Project-specific IDs are
  supported; membership belongs to the project's section-map validator.
  A missing section stays absent, means
  "no section" to readers, and never makes the event unknown.
- `machine=m5` remains `fields.machine: 'm5'`. Other machine labels are
  lowercase letters/digits, dots, underscores or hyphens, starting with a
  letter or digit; these are labels, never hostnames to resolve.
- An explicit `complete` word immediately after the declared Ticket IDs is reported as
  `fields.complete: 'true'`; readers decide how to use that observation.
- Declarations use the exact labels above, a colon and space for Ticket,
  Unit and Section, and an equals sign for machine. Duplicate declarations,
  empty values, malformed IDs or a mixed `none`/ID list return unknown.
  Old BOOTED and TICKET narratives without declarations still parse with
  their previous NoteRecord shape. Missing ticket, section or machine is
  allowed; the parser never invents a declaration from a lane's name.

### Scope reports

Watch ticket #143 (a private ticket)
uses this structured SCOPE form for one PR result. It remains advisory;
parsing a report never decides whether a merge may proceed.

```text
2026-10-14T01:00:00Z WATCH SCOPE CLEAN pr=81 section=checks added=12 removed=3 outOfScope=0 bloat=0 mapGaps=0
2026-10-14T01:01:00Z WATCH SCOPE FINDINGS pr=82 section=checks added=30 removed=2 outOfScope=2 bloat=1 mapGaps=3
2026-10-14T01:02:00Z WATCH SCOPE UNKNOWN pr=83 reason=read-failed
2026-10-14T01:03:00Z WATCH SCOPE UNKNOWN reason=read-failed
```

`CLEAN` and `FINDINGS` require a positive safe-integer `pr` plus nonnegative
safe-integer measurements `added`, `removed`, `outOfScope`, `bloat` and
`mapGaps`. The last three count reported signals. CLEAN has zero signals;
FINDINGS has at least one. Measurements remain strings in `fields`; `pr`
also appears as a number on ScopeRecord. `section` is optional and follows
the section ID spelling above; absent or `none` reports no declared section.
Added/removed values support the watcher's per-section round tally; this
parser performs no aggregation or deduplication.

`UNKNOWN` requires a nonempty `reason`, optionally a known `pr`. It carries
no measurements, so a failed read cannot become a zero-count report. Other
nonempty key/value observations, such as `repo` or an encoded result
fingerprint, are retained. All SCOPE tokens after the status must be unique
`key=value` pairs; empty values, prose, invalid statuses or numeric values,
contradictory CLEAN/FINDINGS signals and malformed sections return unknown.
Encode whitespace, commas, semicolons and parentheses in field values with
percent encoding; the parser leaves them encoded.

| Wire form                                             | Record and fields                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MERGED #1192`                                        | MERGED; positive safe-integer `pr`, null head and mergeCommit.                                                                                                                                                                                                                                                                                   |
| `MERGED PR #1192` or `MERGED pr=1192`                 | The same MERGED metadata, with key/value fields retained.                                                                                                                                                                                                                                                                                        |
| `MERGED #1192 as abcdef12 (head 123456789)`           | MERGED; `mergeCommit` from `as`, `head` from `head`; trailing prose is discarded; key/value fields are retained.                                                                                                                                                                                                                                 |
| `MERGED #1192 merge=abcdef12 head=123456789`          | The same MERGED metadata from key/value spelling.                                                                                                                                                                                                                                                                                                |
| `SOL-PR 1192 RUN-END head=abcdef123 Verdict: approve` | Actor SOL-PR; RUN-END; numeric subject as a string, optional head, fields, and verdict. Verdict is `approve`, `changes requested` or `none` at end of line; otherwise null.                                                                                                                                                                      |
| `SOL-AREA A03 RUN-END exit=0 findings=3 last=[done]`  | Actor SOL-AREA; RUN-END; area subject, head null, verdict null, fields exit/findings/last.                                                                                                                                                                                                                                                       |
| `SOL-SWEEP C RUN-END exit=0 findings=7 last=[done]`   | Actor SOL-SWEEP; RUN-END; sweep subject, head null, verdict null, fields exit/findings/last.                                                                                                                                                                                                                                                     |
| `ACTOR SUBAGENTS build 0, review 3 (note)`            | SUBAGENTS; named nonnegative safe-integer counts: build, review, race attack, race, research, check. Only consecutive comma-separated declarations at the start of the message count; job annotations and narrative do not. Missing categories remain absent. Corrections and other historical prose remain known notes with no inferred counts. |
| `ACTOR #1481 note`                                    | ISSUE-NOTE; subject `#1481`, narrative message. This recognises the historical issue-led status form, not arbitrary unlisted words.                                                                                                                                                                                                              |

## Event catalogue

The touches dispatch writer uses the existing `TOUCHES-CHECK` note type:
`TOUCHES-CHECK DECLARED lane=BUILD-A paths=%5B%22packages%2Fexample.mjs%22%5D`,
`TOUCHES-CHECK HELD lane=BUILD-B path=packages%2Fexample.mjs owner=BUILD-A reason=lane-declaration`,
or `TOUCHES-CHECK UNKNOWN reason=failed-read-or-invalid-input`. All have the
standard UTC/actor envelope. DECLARED reports a clear snapshot, not a
reservation; the orchestrator records the declaration before dispatch.
HELD may also include `pr=number`. All field values use percent encoding,
including punctuation that terminates grammar fields; decode them with
`decodeURIComponent`, then JSON-parse `paths`. The parser leaves these values
encoded. `WRAPPED` releases a recorded declaration as described in the
[kit README](README.md#touches-before-dispatch).

Every row below uses NoteRecord and the common extraction rules above,
except SCOPE, which uses ScopeRecord and its structured validation.
`message` is present (possibly empty); `pr`, `head` and `subject` are nullable,
and the listed key/value fields are optional observations from the snapshot.
An opaque narrative is deliberately not split into additional invented
fields. This preserves older ASK, PARKED, HELD and wrap wording.

| Event token             | Message / reported fields                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `A02-1368CKPT-DONE`     | Status / reason / progress narrative. Observed keys: `BASE_SHA`, `OPS_INTERNAL_STAGE1_REVIEW_DEFERRAL`.                                                                                                                                                                                                                              |
| `A02-1368MAIN`          | Status / reason / progress narrative. Observed keys: `backoff`, `health-hang`.                                                                                                                                                                                                                                                       |
| `A02-1370APPR-DONE`     | Status / reason / progress narrative. Observed keys: `BASE_SHA`, `OPS_INTERNAL_STAGE1_REVIEW_DEFERRAL`.                                                                                                                                                                                                                              |
| `A02-1370CKPT-DONE`     | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `A02-1370DEF-DONE`      | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `A05-1372DEC-DONE`      | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `ACK`                   | Status / reason / progress narrative. Observed keys: `OPS_WORKER_JOBS`, `checks`, `head`, `mode`, `race`, `red`, `related`.                                                                                                                                                                                                          |
| `ALREADY-FIXED`         | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `AREAS`                 | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `ARRIVAL-CAP`           | Arrival decision narrative; optional ready and cap.                                                                                                                                                                                                                                                                                  |
| `ASK`                   | Recipient followed by the question; recipient returned as subject. Observed keys: `CI`, `after`, `before`, `head`, `head_sha`, `race`, `red`, `related`.                                                                                                                                                                             |
| `BATCHES-READY`         | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `BLOCKED`               | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `BLOCKER`               | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `BODY-FIXED`            | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `BODY-UPDATED`          | Status / reason / progress narrative. Observed keys: `head`.                                                                                                                                                                                                                                                                         |
| `BOOTED`                | Optional model/seat narrative; optional Ticket:, Unit:, Section: and machine declarations, validated as above. Observed keys: `base`, `kind`, `machine`, `model`, `seat`, `stack`, `sub-agent-cap`, `worktree`.                                                                                                                      |
| `BW-LOCKED`             | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `CARRIED`               | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `CFSPEED-ACK`           | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `CHATPATH-ESTIMATE`     | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `CHECK`                 | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `CI-RERUN-OWED`         | Status / reason / progress narrative. Observed keys: `head`.                                                                                                                                                                                                                                                                         |
| `CLOSED`                | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `CORRECTION`            | Status / reason / progress narrative. Observed keys: `head`, `net`, `race`.                                                                                                                                                                                                                                                          |
| `CUSTODY-LOADS`         | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `CUSTODY-WRITTEN`       | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `CUT-LIVE`              | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `DEMO-LOGIN-FILED`      | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `DEMO-URL`              | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `DESIGN-FINAL`          | Status / reason / progress narrative. Observed keys: `sha256`.                                                                                                                                                                                                                                                                       |
| `DESIGN-READY`          | Status / reason / progress narrative. Observed keys: `issue`, `issues`, `main`, `path`, `sha256`.                                                                                                                                                                                                                                    |
| `DESIGN-ROW`            | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `DESIGN-START`          | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `DIAG`                  | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `DIRECTOR-REAP`         | Legacy PANE-CLOSED plus closure narrative.                                                                                                                                                                                                                                                                                           |
| `DNS-ADDED`             | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `DOMAIN-VERIFIED`       | Status / reason / progress narrative. Observed keys: `id`.                                                                                                                                                                                                                                                                           |
| `DONE`                  | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `DROPPED`               | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `FILED`                 | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `FILES`                 | Declared path list separated by spaces or commas; optional scope narrative.                                                                                                                                                                                                                                                          |
| `FINDINGS`              | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `FIX-PUSHED`            | PR, batch or branch announcement; optional head, net, related and race. Observed keys: `BROWSER_PROOFS`, `clock`, `commit`, `head`, `id`, `kind`, `lane`, `net`, `new`, `old`, `pre-rebase`, `pre-split`, `race`, `reason`, `red`, `related`, `round`, `scope`, `split`.                                                             |
| `FOUND`                 | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `GAPS`                  | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `GAUGE`                 | Seat/threshold narrative; optional key/value readings.                                                                                                                                                                                                                                                                               |
| `GO-PT`                 | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `HANDBACK`              | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `HANDBACK-MOVE`         | Status / reason / progress narrative. Observed keys: `head`.                                                                                                                                                                                                                                                                         |
| `HANDBACK-READY`        | Status / reason / progress narrative. Observed keys: `checks`, `head`, `race`.                                                                                                                                                                                                                                                       |
| `HANDOVER`              | Status / reason / progress narrative. Observed keys: `handback`, `race`.                                                                                                                                                                                                                                                             |
| `HANDOVER-DUE`          | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `HELD`                  | Optional issue or PR reference and reason narrative.                                                                                                                                                                                                                                                                                 |
| `HOLD`                  | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `HOOK-SKIP-SCANNED`     | Status / reason / progress narrative. Observed keys: `head`, `related`.                                                                                                                                                                                                                                                              |
| `INVENTORY`             | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `ISOLATION-DUP`         | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `ISSUE`                 | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `ISSUE-FILED`           | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `LABELS`                | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `LAND`                  | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `LANDING-ASSESSMENT`    | Assessment narrative; optional pr, gate, owner and age.                                                                                                                                                                                                                                                                              |
| `LANE-WATCH`            | Suspected stall or pause/tool/review-wait narrative; optional lane, reason and silence readings.                                                                                                                                                                                                                                     |
| `LINE`                  | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `M5LOAD1302`            | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `MAINCHK`               | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `MASTER`                | Status / reason / progress narrative. Observed keys: `blocking`, `major`, `minor`, `unrated`.                                                                                                                                                                                                                                        |
| `MEASURE`               | Status / reason / progress narrative. Observed keys: `before`, `shards`.                                                                                                                                                                                                                                                             |
| `MERGE-RATE`            | OK, WARN, ALARM or ERROR followed by reported rates or error narrative.                                                                                                                                                                                                                                                              |
| `MERGE-STALL`           | OK, STALL, NO-MERGE-YET, EMPTY-QUEUE or UNKNOWN, with optional reason and queue/merge readings.                                                                                                                                                                                                                                      |
| `NAMEDSUITE`            | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `NAS`                   | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `NOTE`                  | Status / reason / progress narrative. Observed keys: `P`, `head`, `tests`.                                                                                                                                                                                                                                                           |
| `NOTED`                 | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `OR-CMD-READY`          | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `ORCH-ACK`              | Status / reason / progress narrative. Observed keys: `red`.                                                                                                                                                                                                                                                                          |
| `ORCH-DECISION`         | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `ORCH-PT-WARM`          | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `ORCH-SUCCESSOR-BOOTED` | Successor boot narrative.                                                                                                                                                                                                                                                                                                            |
| `ORCHESTRATOR-HANDOVER` | Old actor -> successor target, with optional narrative; retained as text.                                                                                                                                                                                                                                                            |
| `P11`                   | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `P2`                    | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `P2-STAGING-DONE`       | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `P4-RECIPE`             | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `PARKED`                | Optional issue, piece or PR reference and reason narrative. Observed keys: `head`, `launch`, `race`.                                                                                                                                                                                                                                 |
| `PAUSED`                | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `PIECE-DONE`            | Status / reason / progress narrative. Observed keys: `agent`, `found`, `head`, `race`.                                                                                                                                                                                                                                               |
| `PIECE-HELD`            | Status / reason / progress narrative. Observed keys: `agent`.                                                                                                                                                                                                                                                                        |
| `PLAN`                  | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `PR-OPENED`             | PR or batch/PR announcement; optional head; older incomplete announcements allowed. Observed keys: `base`, `head`, `kind`, `max_entries_to_build`, `product`, `related`, `tests`.                                                                                                                                                    |
| `PRETRIAGE`             | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `PROGRESS`              | Status / reason / progress narrative. Observed keys: `dup`, `fixed`, `stale`.                                                                                                                                                                                                                                                        |
| `PROOF`                 | Status / reason / progress narrative. Observed keys: `head`.                                                                                                                                                                                                                                                                         |
| `PROOF-RUN`             | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `PUSHED`                | PR push announcement; optional head. Observed keys: `head`.                                                                                                                                                                                                                                                                          |
| `PUSHING`               | PR/batch push announcement; optional head and related. Observed keys: `head`, `related`.                                                                                                                                                                                                                                             |
| `QUAL0016`              | Status / reason / progress narrative. Observed keys: `red`.                                                                                                                                                                                                                                                                          |
| `RACECHK`               | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `RB-FLAKE`              | Status / reason / progress narrative. Observed keys: `head`.                                                                                                                                                                                                                                                                         |
| `READY`                 | PR or batch/PR announcement; optional head, product, tests, lane, checks, kind, related, red and race. Observed keys: `after`, `base`, `before`, `checks`, `design`, `docs`, `head`, `kind`, `lane`, `max_entries_to_build`, `merge`, `product`, `race`, `red`, `related`, `scope`, `security`, `security-review`, `speed`, `tests`. |
| `READY-ack`             | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `RECIPE`                | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `REFUTED`               | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `RELATED`               | Status / reason / progress narrative. Observed keys: `related`.                                                                                                                                                                                                                                                                      |
| `RELAY-HANDOVER`        | Old actor -> successor target, with optional narrative; retained as text.                                                                                                                                                                                                                                                            |
| `RELAYNAS0155`          | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `RESEND-DOMAIN-ADDED`   | Status / reason / progress narrative. Observed keys: `id`, `region`.                                                                                                                                                                                                                                                                 |
| `RETARGETED`            | Status / reason / progress narrative. Observed keys: `base`, `head`.                                                                                                                                                                                                                                                                 |
| `ROUND2-RED`            | Status / reason / progress narrative. Observed keys: `head`.                                                                                                                                                                                                                                                                         |
| `RUN-START`             | Run-start narrative; optional head or run metadata.                                                                                                                                                                                                                                                                                  |
| `SANDBOX-MAP`           | Status / reason / progress narrative. Observed keys: `id`, `key`.                                                                                                                                                                                                                                                                    |
| `SCAN-CLEAN`            | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `SCOUT-GREEN`           | Status / reason / progress narrative. Observed keys: `head`.                                                                                                                                                                                                                                                                         |
| `SCOUT-NAMES`           | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `SCOPE`                 | ScopeRecord; CLEAN or FINDINGS with PR and advisory measurements, or UNKNOWN with reason and optional PR, as above.                                                                                                                                                                                                                  |
| `SECURITY-REVIEW`       | Status / reason / progress narrative. Observed keys: `head`.                                                                                                                                                                                                                                                                         |
| `SPLIT-PLAN`            | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `STATUS`                | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `STEP`                  | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `SWITCHED-ON`           | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `TICKET`                | Optional Ticket:, Unit: and Section: declarations, optional complete marker; legacy narrative remains known.                                                                                                                                                                                                                         |
| `TOUCHES-CHECK`         | Dispatch decision narrative; optional path, lane and owner.                                                                                                                                                                                                                                                                          |
| `U117-DONE`             | Status / reason / progress narrative. Observed keys: `data`, `fail`, `harness`, `pass`.                                                                                                                                                                                                                                              |
| `U117-FAIL`             | Status / reason / progress narrative. Observed keys: `target`.                                                                                                                                                                                                                                                                       |
| `U117-PASS`             | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `WAITING`               | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `WATCHDOG`              | Legacy check A/B/C and finding narrative.                                                                                                                                                                                                                                                                                            |
| `WRAP`                  | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `WRAP-NUDGE`            | Legacy nudge narrative.                                                                                                                                                                                                                                                                                                              |
| `WRAP:`                 | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `WRAPPED`               | Optional handback path and wrap narrative. Observed keys: `handback`, `head`.                                                                                                                                                                                                                                                        |
| `WRAPUP`                | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `ceiling`               | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `correction:`           | Status / reason / progress narrative. Observed keys: `product`.                                                                                                                                                                                                                                                                      |
| `design`                | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `review-deferral`       | Status / reason / progress narrative.                                                                                                                                                                                                                                                                                                |
| `SUBAGENTS`             | Named category counts and optional narrative, as above.                                                                                                                                                                                                                                                                              |

## Replay fixture and validation

`tests/fixtures/round-2000-01-01.events.log` is a synthetic round of 1,908
lines dated 1–3 January 2000. It keeps realistic line order, event tokens,
intervals between records, PR identifiers in structured announcements, head
lengths, named subagent counts, review subjects/verdicts, and the key/value
fields in PR announcements and RUN-END lines. Lanes are `EXAMPLE-001` onwards
and pull requests are numbered from 1001; narrative, paths and branch names
are neutral notes, heads and bases repeated hexadecimal characters. It
contains no pane ids, names, URLs, credentials or client data. Narrative is
opaque in this grammar, so the neutral notes do not hide an unlisted event
token.

Run:

```sh
node --test orchestration/tests/events-cases.mjs
```

The test removes exactly one terminal LF (the final line terminator), then
checks every physical fixture line and names its number and full sanitised
text on an unknown result. Additional trailing blank lines remain unknown;
the replay regression runs this test against a temporary copy to prove that
line 1909 is reported. It also checks merge compatibility,
typed fields, incomplete historical records, review prefixes, subagent
counts, watcher spellings, fixture privacy, malformed input and a format
drift failure. To adopt a new writer token, update this catalogue, the
literal parser union, and the fixture/tests together. No live watcher is
switched to this parser during a running round.
