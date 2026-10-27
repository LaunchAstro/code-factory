# The Code Factory skills

These are the skills that run a Code Factory round, copied here so a reader
has the whole method in one place. They were copied on 27 October 2026 from
the owner's private skills repository and scrubbed like the rest of this
repository. The owner's live copies keep moving; these are a snapshot, not a
pin.

| Skill | What it does |
| --- | --- |
| [orchestrator](orchestrator/SKILL.md) | Runs a round of lanes in herdr panes: briefs, ticks, holds, hand-overs |
| [director](director/SKILL.md) | Sits over a fleet as the owner's one long-lived session; [kick.sh](director/kick.sh) is the director's kick, run on [WATCH.md](director/WATCH.md)'s loop |
| [code-factory](code-factory/SKILL.md) | The orchestrator's build policy: briefs, READY lines, review results, merges |
| [build-review](build-review/SKILL.md) | Builds one increment test-first, has Sol review it, lands it |
| [single-agent](single-agent/SKILL.md) | One agent owns one area and lands it in small, risk-ranked pull requests |
| [sub-agents](sub-agents/SKILL.md) | Briefs, runs and joins sub-agents inside a lane |
| [batch-cleanup](batch-cleanup/SKILL.md) | One section-end cleanup pass: thermonuclear, architecture, deslop or unslop |
| [dispatch](dispatch/SKILL.md) | Hands one task to a fresh agent in its own herdr tab |
| [herdr](herdr/SKILL.md) | Drives herdr workspaces, tabs and panes |

Links into `../docs/` and `../orchestration/` point at this repository's own
method and scripts.

## Install

Copy the folders you want into your agent's skills folder (for Claude Code,
`~/.claude/skills/`). To keep them pinned instead, put them in a repository of
your own and point [`orchestration/skills/SOURCES.json`](../orchestration/skills/SOURCES.json)
at it; `orchestration/skills/fetch.mjs` then fetches and checks them.

## Skills these name but don't include

The leaf skills come from two public collections. Install them from their
sources rather than from a copy:

- **pstack** ([ericlitman/open-pstack](https://github.com/ericlitman/open-pstack)):
  `unslop`, `deslop` and `thermo-nuclear-code-quality-review`, which
  batch-cleanup's passes load.
- **Matt Pocock's engineering skills** ([mattpocock/skills](https://github.com/mattpocock/skills)):
  `code-review`, `codebase-design` and `improve-codebase-architecture`, among
  others.

`SOURCES.json`'s `prerequisites` lists both, with their install commands.

A few skills named here are the owner's own and stay private:
`claude-subscription-switch` (boots an agent on a chosen subscription),
`seat-gauge` (reads how much of each subscription is left), `close-out` and
`wrap-up` (how a session records its end), and `afk-orchestrator`. Where a
skill names one, use your own equivalent or leave that step out.
