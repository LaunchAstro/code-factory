# Orchestrator state, rewritten `<HH:MM TZ> <DATE>` by orchestrator `<K>` (seat `<SEAT>`, `<PANE>`, `<MODEL>`, `<CONTEXT>` percent), ROUND `<N>` "`<ROUND-NAME>`" in flight

Under 30 lines, rewritten in full on every tick, never appended to. It is the successor's whole picture: what closed, what is bound, what each lane is doing, what happens next.

Rounds `<PRIOR>` CLOSED: `<PR> <sha>` MERGED, hands on CI 0; round `<PRIOR>` scored `<PASS or FAIL>` (`<report link>`). Round record: `<where>`.
ROUND `<N>` (owner's word, verbatim: "`<VERBATIM>`"): bound `<HH:MM>`. Assumptions stated to the owner before any pane existed: `<the base the round assumes, in one line: runtime, models, seats, billing account, external reviews budgeted>`.

| Lane | Pane | Brief | State |
| `<LABEL>` (`<model>`) | `<pane>` | `<brief file>` (`<words>`w): `<one line of what it does>` | `working since <HH:MM>, acked` |
| `<LABEL>` (`<model>`) | `<pane>` | `<brief file>` (`<words>`w): `<one line>` | `<state>` |
| `<LABEL>` (`<model>`) | not booted | `<brief file>` (`<words>`w): `<one line>` | boots when `<condition>` |
| `PLAN-CHECK-<ROUND>` (`<model>`) | `<pane>` | `<brief file>` (`<words>`w): the coverage half of the plan check | `plan <n> at <sha> in check since <HH:MM>`, or `PLAN-OK <n> sent <HH:MM>`, or `held <HH:MM>, <n> criterion lines, ticket held for the owner` |

Ceilings: reviewer sessions `<n>`, Copilot 0, sub-agents 0, spend 0, hands on CI 0; seat `<SEAT>` 5h `<n>` percent, 7d `<n>` percent at binding. Monitor `<id>` (events, handbacks, panes `<list>`, BLOCKER lines).

## Next
`<LABEL>` DONE -> verify by file (handback tail, events line, session record, the repository state the handback claims) -> close its pane -> boot `<next lane>` (`claude-seat-up <SEAT> --model <model>`, confirm the banner, the boot line names the artefact root). Then `<what closes the round>`: the round record, `close-out` once, report. Then: the owner's call on `<anything outward-facing left on the table>`.

## Mechanics
`<one line per thing that bit this round and would bite the successor>`. Standing ones: fix lanes use `worktree --detach` and push `HEAD:<branch>`; the boot line names the artefact root; read acks from the seat JSONL when the pane reader misses one; never a blind Enter; `runner.mjs` hold and release must agree with the label by the second `status --check`.
