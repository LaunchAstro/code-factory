# Code Factory

Code Factory is Launch Astro's method for building a large product with agent
lanes for an owner who is not a programmer: each piece built test-first,
reviewed by Sol until it approves the exact head, and landed on `main` through
the merge script. [HISTORY.md](docs/HISTORY.md) says how it got here.

## Start here

- [docs/METHOD.md](docs/METHOD.md): the method, from
  [before the build](docs/METHOD.md#before-the-build-plan-deep) to the
  hand-off rule. Full mode (a director, an orchestrator and lanes) is METHOD
  with [docs/FLEET.md](docs/FLEET.md), which sets the roles, review and
  paperwork.
- [docs/SINGLE.md](docs/SINGLE.md): single mode, one agent owning one area.
- The build variants, one per build:
  [hardened production](docs/variants/hardened-production.md) (the default),
  [production](docs/variants/production.md) and
  [prototype](docs/variants/prototype.md).
- [docs/SOL-EFFORT.md](docs/SOL-EFFORT.md): Sol's review effort by risk.
- [skills/](skills/README.md): the skills that run a round (orchestrator,
  director, build-review and the rest), with links to the pstack and Matt
  Pocock skills they load.
- [docs/CI-CHECKS.md](docs/CI-CHECKS.md): what each check guards, costs and
  catches.
- [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md): tickets, the
  `Section:` line and the work map.
- [orchestration/README.md](orchestration/README.md): the current tools (the
  merge script, pre-checks, watchers, single mode's hand-off, the reviewer
  shim).

Also current: [docs/CHECKLIST.md](docs/CHECKLIST.md), what every builder
checks before asking for review. Records: [docs/LESSONS-2026-09.md](docs/LESSONS-2026-09.md),
[docs/WHAT-WORKED.md](docs/WHAT-WORKED.md) and `docs/rounds/`. Proposals
waiting on evidence: [docs/SKILL-PROPOSALS.md](docs/SKILL-PROPOSALS.md) and
[docs/SKILL-WATCH.md](docs/SKILL-WATCH.md). The method changes only through
the owner: [how this changes](docs/FLEET.md#how-this-changes). Designs waiting on the owner, such as the agent access survey (`docs/design/agent-access.md`), stay private.

## Archived: the first kit (17 to 21 September)

**A record, not the current method.** Everything below this line is the first
version: a repository template whose hosted checks take a ticket to a merged
pull request with no hand on CI, and an orchestration kit that ran briefed
lanes through seven stages against numeric ceilings. Its per-stage pipeline
was judged too heavy and retired; METHOD replaced it. The stages, ceilings,
briefs and hold rules below bound only the seven recorded rounds. The
reusable part is `template/`, copied as "Start a project" says. The
first kit's stages, briefs, boot file and `factory.sh`, all under
`orchestration/archive/`, are reference only; the current tools in
`orchestration/` are live
([orchestration/README.md](orchestration/README.md)).

A frontier model from a different company than the builder's is the reviewer
of record, and its verdict turns a required check red or green with nobody
reading the diff. A machine that has never run a round starts at
[docs/SETUP.md](docs/SETUP.md).

Seven rounds is the whole record, not a clean one. Rounds 1 to 3 are where it
was found wanting, round 2 at zero merges and round 3 a FAIL that merged a
planted defect; rounds 4 to 7 each passed the line below, and
`docs/rounds/README.md` scores every one of them.

`template/.github/` is source to copy into a project. Its workflows run from
the copied project's repository root, not here. The checks ran, and are evidenced, on the rehearsal repository
the rounds used.

### The pass line

Round 7 is the standard a round is scored against. All seven must hold:

1. Every pull request reaches its decision with no hand on CI: no rerun, no
   update-branch, no admin merge, no owner decision.
2. Every hold cites a `Criterion:` finding that reproduces against the module at
   that head. A hold on a finding that does not reproduce is a false hold, and a
   fail.
3. Every merged pull request leaves `main` green, and the ticket's own
   reproduction no longer reproduces.
4. The reviewer stays inside the REVIEW row's session ceilings, per pull
   request and over the run.
5. A reviewer-approved fix head merges on its own, or the round says the
   condition was not exercised.
6. An over-engineering sweep of every merged diff against its plan: a knob
   nothing sets, a case proving the same line twice, an abstraction with one
   caller, a stub for a later stage, error handling for an impossible state.
   Hits are a finding, not a fail.
7. A fresh agent can answer, from the repository alone, where the size rule
   lives, where the review of record is parsed, and where a new ticket's plan
   goes.

`docs/rounds/ROUND7-REPORT.md` is the worked example of scoring it.

### Start a project

1. Copy the whole of `template/` to the new repository's root, dotfiles
   included. "Copy `template/`" is the instruction; the names are only a guide,
   because the check reads more than the obvious ones. As well as `AGENTS.md`,
   `CONTRIBUTING.md`, `.github/`, `scripts/`, `tests/`, `docs/`, `package.json`
   and the lockfile, it reads `.claude/skills/`, `.husky/` (`prepare: husky`),
   `.nvmrc` (`scripts/node-policy-check.mjs` compares it to `engines.node`),
   the lint, format, TypeScript, vitest and commitlint configs at the root, and
   the root policy files `template/README.md` links. The root must be a git
   repository with at least one commit before the check runs: the commit
   message cases call the hook, and the hook calls git.
2. `corepack pnpm install && corepack pnpm check`. Green is the starting line.

   The `inventory:fresh` step in that run regenerates `template/docs/INVENTORY.md`
   from the tree and fails on a diff, so the page every build lane reads first
   cannot go stale. Run `corepack pnpm inventory` and commit the result.
3. Set the branch ruleset's required checks to the eight contexts in
   `.github/required-contexts.json`, with the rest of the ruleset as
   `template/docs/plan/ruleset.md` describes. `scripts/required-contexts-check.mjs`
   refuses a tree whose record and workflows disagree, but nothing can prove
   what the ruleset actually requires, so set it by hand and check it.
4. Add the reviewer's account as a collaborator, so its review posts under an
   identity that is not the builder's. A reviewer posting from the builder's
   account can edit its own refusal into an approval.
5. Read `template/tests/acceptance/README.md` and the one worked example in
   `10-label-trigger/` before writing a plan.

### Run a round

`orchestration/archive/stages.json` is the one source for every number below.
`node orchestration/archive/stages.mjs --render` rewrites the table from it, and
`node orchestration/archive/stages.mjs --check` refuses what disagrees with it;
`orchestration/README.md` says what it refuses. The briefs in
`orchestration/archive/briefs/` are the templates to fill; the `brief` column says
which.

The skills that run a round are in [skills/](skills/README.md). This README is
the authority for stage ceilings: the orchestrator skill carries no ceilings
table of its own, so this file is the only source for the numbers here.

<!-- stages:begin -->

| Stage | Actor | Model | Ceiling | Brief |
| --- | --- | --- | --- | --- |
| PLAN-CHECK | `scripts/plan-check.mjs`, then the reviewer of record on the plan commit | gpt-5.6-sol | 25 percent context, 10 minutes, 0 pushes, 1 review, 0 pull requests | `orchestration/archive/briefs/BRIEF-PLAN-CHECK-TEMPLATE.md` |
| BUILD | the build lane | Opus 5 | 40 percent context, 75 minutes, 2 pushes, 0 reviews | `orchestration/archive/briefs/BRIEF-BUILD-TEMPLATE.md` |
| DE-SLOP | the de-slop lane | Opus 5 | 20 percent context, 20 minutes, 1 push, 0 reviews, 0 pull requests | `orchestration/archive/briefs/BRIEF-DESLOP-TEMPLATE.md` |
| REVIEW | the reviewer of record | gpt-5.6-sol | 40 percent context, 15 minutes, 0 pushes, 6 reviews (2 per pull request), 0 pull requests | `orchestration/archive/briefs/BRIEF-REVIEW-TEMPLATE.md` |
| Decide | the orchestrator, on the counts | none | no ceiling of its own | none |
| FIX | the fix lane | Opus 5 | 30 percent context, 45 minutes, 1 push, 0 reviews, 0 pull requests | `orchestration/archive/briefs/BRIEF-FIX-TEMPLATE.md` |
| SCORE | the score lane | Fable 5.1 | 45 percent context, 60 minutes, 1 push, 0 reviews, 1 pull request | `orchestration/archive/briefs/BRIEF-SCORE-TEMPLATE.md` |

<!-- stages:end -->

PLAN-CHECK and REVIEW count their wall per session; the other rows count it per
lane. `orchestration/README.md` says what a row's `reviews` and
`reviewsPerPullRequest` count.

DE-SLOP cuts slop out of the build head on the same branch, so the review of
record reads the de-slopped head rather than the head BUILD pushed. A fix head
keeps de-slopping inline, in the fix lane's own step
(`orchestration/archive/briefs/BRIEF-FIX-TEMPLATE.md` line 28).

Decide is the orchestrator's: merge, one fix pass, or hold. It merges because a
round is watched, and the runner is the overnight decider that takes Decide only
once its merge step is written, which `template/scripts/runner/` does not yet
carry.

PLAN-CHECK is two halves of one stage. `template/scripts/plan-check.mjs`
refuses five things a script can decide about a plan: the plan file is there,
it carries the numbered criteria, one case per criterion, the size estimate is
a number inside the gate, and the standing criterion is in the list. The
session refuses what it cannot, whether those criteria cover the ticket's
reproduction and its failure modes, in the `codebase-design` vocabulary. Both
read the plan commit, before BUILD is dispatched.

`template/scripts/runner/runner.json` carries one `minutes` entry this table
does not, `plan`: the overnight runner's own planning session, which plans a
ticket from nothing where PLAN-CHECK reads a plan commit a build lane has
already pushed. It is not this stage and shares none of its ceilings, so
`--check` holds `build`, `review` and `fix` against the table and leaves `plan`
alone.

In the rounds: Copilot 0, hands on CI 0, no spend. Reaching a ceiling ended
the stage as a hold, never as a retry, and a held pull request was the owner's
decision, recorded as an `## Owner decision` comment before anything moved.

### Three rules out of round 7

- **A brief is self-contained, under 600 words, and premise-checked against the
  repository before dispatch.** Every lane that went off the rails was told to
  do something the repository could not support and told not to ask.
- **A fix adds no new precondition, and no regular expression over a token the
  user controls.** Three passes on one pull request each closed a finding and
  opened the next edge of the same regex. Plain string comparisons closed it.
- **One `REVIEW` line at a time.** Nothing is pre-loaded for a stage that has
  not started.

## Where things live

- `docs/`: the method ([Start here](#start-here)) and its records.
  `docs/rounds/` holds every round report and ledger, the dated records of
  18 September (the straight-line runner spec and the night audit), and the
  first kit's moved records (STATE, SKILLS-BY-STAGE, FIRST-READ and the
  5 October round tools catalogue).
- `skills/`: a scrubbed snapshot of the Code Factory skills
  ([skills/README.md](skills/README.md)).
- `template/`: the repository to copy. Two of its check steps refuse what prose
  only discouraged: `dup:check` refuses copied code and a duplicated script
  name, `deps:check` refuses an unused dependency, an undeclared import and a
  stale lockfile.
- `orchestration/`: the current tools, and the archived round kit with its
  placeholders ([orchestration/README.md](orchestration/README.md)).
- `orchestration/reviewer/`: the codex shim, Sol's prompt renderer and rules
  gate, and the README that says how to make the reviewer account's token
  file under `$HOME` outside every clone.
- `orchestration/seats/`: the first kit's copy of `claude-seat-up`. Seats boot
  today with the `claude-subscription-switch` skill's launcher.

## Licence

Code Factory is AGPL-3.0-only; [LICENSE](LICENSE) has the full text and
[NOTICE](NOTICE) records the third-party material under `template/`. The
[preset and skill exception](LICENSE-EXCEPTIONS.md) is drafted and ungranted.
[CONTRIBUTING.md](CONTRIBUTING.md) says how to propose a change and
[SECURITY.md](SECURITY.md) how to report a vulnerability.
