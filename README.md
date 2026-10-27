# Code Factory

Code Factory is a way to build the software you want with AI coding agents
and have it come out as solid as possible. You say what you want built.
Agents plan it, build it in small pieces and land each piece on `main` only
after it clears three checks:

- **Tests first.** Each piece starts from a failing test that proves what the
  ticket asks for, then the code that makes it pass.
- **An independent review.** A model from a different company than the
  builder's (Sol) reviews every change and keeps sending it back until it
  approves the exact commit that will merge.
- **The merge gate.** A script, not an agent, merges. It takes a pull request
  only when every required check is green on the exact head and the
  description carries its three lines.

You don't need to be a programmer to drive it. Those three checks are what
make the result solid, whoever is driving.

Code Factory was shaped over about 4,000 agent sessions and more than 30,000
commits across LaunchAstro's projects, since every one of them is built this
way, not only this repository. It's battle-tested, and it can still be
improved.

This repository holds the method (`docs/`), the skills agents load to run it
(`skills/`), the scripts behind it (`orchestration/`) and a repository
template a new project copies (`template/`).

## How it works

### Two modes

- **Single mode.** One agent owns one area of a repository and lands its work
  as a run of small pull requests. Use it for one feature or a switch-on.
  [docs/SINGLE.md](docs/SINGLE.md)
- **Full mode.** A director, an orchestrator and lanes, for a big build with
  many pieces running side by side. [docs/FLEET.md](docs/FLEET.md) sets the
  roles and [docs/METHOD.md](docs/METHOD.md) the build mechanics.

### The roles in full mode

- **The owner** is the person the software is for. They say what to build,
  answer product questions and give what only they can give (a login, spend,
  a yes to a public change). Routine build questions never reach them.
- **The director** is one long-lived session beside the owner. It routes the
  owner's words to the right place and keeps orchestrators and merges moving.
- **The orchestrator** keeps lanes filled, boots each with a short brief and
  unblocks stuck ones. It never builds.
- **A lane** is an agent that owns one piece until it has merged.
- **The merge script** queues ready pull requests and merges them.
- **Sol** is the reviewer of record. It reviews and never writes product code.

### A piece's path to `main`

1. **Plan.** Before the build, the work is mapped into tickets. Each carries
   a `Section:` line and numbered criteria
   ([issue tracker](docs/agents/issue-tracker.md),
   [before the build](docs/METHOD.md#before-the-build-plan-deep)).
2. **Build test-first.** The lane writes the failing test, then the code, and
   checks its work against [docs/CHECKLIST.md](docs/CHECKLIST.md).
3. **Review.** The lane starts Sol on the pull request, fixes what Sol finds
   and asks again, until Sol approves the exact head. Rounds are capped. At the
   cap the piece splits or goes to the director
   ([review rounds](docs/METHOD.md#review-rounds)). Sol's effort follows the
   change's risk ([docs/SOL-EFFORT.md](docs/SOL-EFFORT.md)).
4. **Checks.** The method's policy is a light set on the pull request and
   the full set in the merge queue on the exact combined head. The template's
   CI runs the full `pnpm check` on every pull request and push to `main`, so
   a project adds and rehearses merge-group checks before relying on that
   split. Heavy local runs (full checks, browser tests, builds) go to a separate
   check machine, so the machine the owner works on stays free
   ([where the full tests run](docs/METHOD.md#where-the-full-tests-run)).
5. **Describe.** The pull request carries three lines: `**Why:**`,
   `**Left undone:**` (follow-up tickets, or `none`) and `Closes #n`
   ([paperwork](docs/FLEET.md#paperwork-four-things-per-agent-nothing-else)).
6. **Merge.** The lane runs the merge script (`orchestration/enqueue.mjs`)
   for the pull request and its exact head. The script checks the three lines
   and the required checks, then puts the pull request in GitHub's merge
   queue, or merges it directly on a repository with no queue. After a drop
   the lane runs it again: one re-queue is allowed, then it refuses and the
   piece goes back to the lane
   ([the merge pipeline](docs/METHOD.md#the-merge-pipeline)).

### Build variants

Each build picks one at the start, and it sets how strict the rules are:
[hardened production](docs/variants/hardened-production.md) (the default, for
code a defect in could reach the public),
[production](docs/variants/production.md) (private code for the owner's own
team, on real data) and [prototype](docs/variants/prototype.md) (throwaway
code on sample data, no Sol).

## Where to start

Read in this order. An agent new to the repository needs steps 1 to 4 before
it touches a build; the rest is reference for when a step names it.

1. This README.
2. [docs/METHOD.md](docs/METHOD.md) for full mode, or
   [docs/SINGLE.md](docs/SINGLE.md) for single mode.
3. [docs/FLEET.md](docs/FLEET.md): the roles, review and paperwork in full
   mode.
4. The variant page for your build, under [docs/variants/](docs/variants/).
5. [docs/CHECKLIST.md](docs/CHECKLIST.md): what every builder checks before
   asking for review.
6. [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md): tickets, the
   `Section:` line and the work map.
7. [skills/README.md](skills/README.md): the skill for your role (director,
   orchestrator, build-review, single-agent and the rest).
8. [orchestration/README.md](orchestration/README.md): the scripts, when a
   step names one.

Reference: [docs/SOL-EFFORT.md](docs/SOL-EFFORT.md) (review effort by risk),
[docs/CI-CHECKS.md](docs/CI-CHECKS.md) (what each check guards and costs),
[docs/TOOLS.md](docs/TOOLS.md) (the round tools),
[docs/SETUP.md](docs/SETUP.md) (setting up a machine) and
[template/README.md](template/README.md) (the project template).

## Start a project

1. Copy the whole of `template/` to the new repository's root, dotfiles
   included. The check reads more than the obvious files: `.claude/skills/`,
   `.husky/`, `.nvmrc`, the root configs and the policy files
   `template/README.md` links. The root must be a git repository with at
   least one commit first, because the commit-message cases call the hook.
2. Run `corepack pnpm install && corepack pnpm check`. Green is the starting
   line. Its `inventory:fresh` step fails when `docs/INVENTORY.md` is stale;
   run `corepack pnpm inventory` and commit the result.
3. Set the branch ruleset's required checks to the contexts in
   `.github/required-contexts.json`, with the rest of the ruleset as
   `template/docs/plan/ruleset.md` describes. Nothing can prove what the
   ruleset requires, so set it by hand and check it.
4. Add the reviewer's account as a collaborator, so its review posts under an
   identity that is not the builder's
   ([orchestration/reviewer/README.md](orchestration/reviewer/README.md)).
5. Read `template/tests/acceptance/README.md` and its worked example before
   writing a plan.

## Where things live

- `docs/`: the method and its reference pages.
  [docs/HISTORY.md](docs/HISTORY.md) lists rules that were dropped and why;
  check it before bringing one back.
- `docs/rounds/`: the round records are private. Other files cite them by
  file name as evidence ([docs/rounds/README.md](docs/rounds/README.md)).
- `skills/`: the skills that run a build ([skills/README.md](skills/README.md)).
- `orchestration/`: the merge script, pre-checks, watchers, the reviewer shim
  and single mode's hand-off ([orchestration/README.md](orchestration/README.md)).
- `template/`: the repository a new project copies.

## Inspired by

Three projects shaped Code Factory. [NOTICE](NOTICE) lists what is copied
from each and under which licence.

- [Matt Pocock's skills](https://github.com/mattpocock/skills): the planning
  route, `wayfinder` then `to-spec` then `to-tickets`
  ([before the build](docs/METHOD.md#before-the-build-plan-deep)), and the
  twenty-five skills the template carries
  ([template/.claude/skills/README.md](template/.claude/skills/README.md)).
- [pstack](https://github.com/ericlitman/open-pstack), Lauren Tan's, with
  parts from Cursor's team kit and Jesse Vincent's superpowers: the
  thermonuclear, deslop and unslop cleanup passes
  ([batch-cleanup](skills/batch-cleanup/SKILL.md)), and the fifteen standards
  skills the template carries.
- [37signals' house-skills](https://github.com/basecamp/house-skills): the
  trust gate from
  [`address-pr-reviews`](https://github.com/basecamp/house-skills/tree/main/plugins/dev/skills/address-pr-reviews)
  ([orchestration/trust-gate/](orchestration/trust-gate/README.md)), and the
  close gate from
  [`ralph-lisa-loop`](https://github.com/basecamp/house-skills/tree/main/plugins/dev/skills/ralph-lisa-loop)
  behind Sol's finding ids and disputes
  ([the close gate](orchestration/reviewer/README.md#finding-ids-disputes-and-the-close-gate)).

## Works with

Two separate LaunchAstro repositories work alongside Code Factory. Neither is
part of it, and a build runs without either.

- [Work Map](https://github.com/LaunchAstro/work-map): a live local map of a
  project's work, read from GitHub. It places each ticket and pull request on
  a section by its `Section:` line, so a build's tickets and pull requests
  show up there with nothing extra to write
  ([docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)).
- [Seat Gauge](https://github.com/LaunchAstro/seat-gauge): a macOS window
  showing each Claude Code and Codex subscription's usage and reset times.
  Its `seat-gauge` skill reads the files the window writes, and the skills
  here use it to put new work on the seat with the most room and to check
  each machine's load
  ([Seats, lanes and stops](docs/METHOD.md#seats-lanes-and-stops)).

## Licence

Code Factory is AGPL-3.0-only; [LICENSE](LICENSE) has the full text and
[NOTICE](NOTICE) records the third-party material under `template/`. The
[preset and skill exception](LICENSE-EXCEPTIONS.md) is drafted and not yet
granted. [CONTRIBUTING.md](CONTRIBUTING.md) says how to propose a change and
[SECURITY.md](SECURITY.md) how to report a vulnerability.

<details>
<summary>Stage table of the first orchestration kit (kept here because
<code>orchestration/archive/stages.mjs --check</code> reads it)</summary>

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

</details>
