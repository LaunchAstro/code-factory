# CI checks: what each one guards, what it costs, what it caught

A record of the checks on a production app's pull requests and merge queue.
It exists so the next person who touches CI can see what each check is for,
what it costs and what it tends to catch.

Nothing here says remove a check. Speed CI up, never thin it. No suite, check
or assertion is dropped to make CI faster.

## What each check guards and costs

Required means the merge rule reads it. The database shards count through one
aggregate name, `database conformance`. Minutes are typical metered job
minutes per run on GitHub's hosted runners.

| Check | Required | What it guards | Min per run |
| --- | --- | --- | ---: |
| database conformance shard (8) | yes, via the aggregate | Named invariant suites and affected conformance suites on a real Postgres. Fails on a skipped test, a missing suite, zero tests, or a run that never touched the database. Tenancy, isolation, upgrade and acceptance suites live here | 10.6 |
| database look-ahead, Postgres 18 | no | The same conformance run on the next Postgres major, so a break shows before the provider moves | 41.0 |
| isolation tests | yes | Client isolation, restricted calls, pooled crossover, permission refusals. One client seeing or changing another's data | 13.4 |
| local checks | yes | `pnpm check`: lint, types, ratchets, format, unit and web suites, browser captures, container suites, a planted-script test of the built page | 12.9 |
| visual drift | no | The design catalogue notices a moved control or changed token, on the built app in a pinned headless browser | 2.8 |
| commit messages and provenance | yes | Every commit has a valid message and the agent trailers; applied migrations are unchanged and uniquely numbered | 1.7 |
| database conformance gate | yes | Probes that start their own Postgres and assert the runner refuses skipped, missing, empty and database-free suites. Tests the runner, not the product | 1.6 |
| contamination gate | yes | First job on purpose. Scans every blob for client material, secrets in public content, action pins, the nothing-merges-itself rule | 1.5 |
| review evidence for this revision | yes | Red until the pull request body carries a security review line and a second-company review record for this head | 1.0 |
| static analysis | yes | Semgrep (p/default, p/secrets, p/typescript). Every finding recorded with a reason, none new | 1.1 |
| Analyze (javascript-typescript) | no | CodeQL on the TypeScript | 2.2 |
| command parity | no | Every app action has an API and CLI equivalent | 0.8 |
| OSI licence allowlist | yes | Every dependency licence is on the allowlist | 0.6 |
| dependency audit | yes | High or critical advisories fail; moderate needs a recorded exception | 0.6 |
| gitleaks over the full history | yes | Secret scan over every commit, not just the diff | 0.6 |
| Analyze (python) | no | CodeQL on the Python files | 1.1 |
| pull request size | yes | Reports the diff against the size rule. It informs and blocks nothing | 0.6 |
| Analyze (actions) | no | CodeQL on the workflow files | 1.1 |
| database conformance (aggregate) | yes | The one required name over all 8 shards, `always()`, so a failed, skipped or cancelled shard fails it | 0.1 |

`DCO` is required but is a GitHub app check, not a job in these runs.

The database shards and the look-ahead are most of the bill. The cheap checks,
under 2 minutes a run, cost little together.

## How often each check was right

Each failure sorts into one kind:

- **Real** means red on a head, a new commit on the pull request, then green. A defect was fixed. It does not prove the red was the first sign of the defect.
- **Flaky** means the same code later passed, or the log has a known flake signature. A flaky label is a rule, not a proof.
- **Infra** means runner, setup or network.
- **Policy hold** means the check did its designed job, such as a missing review record or missing commit trailers. Neither bug nor flake.
- **Unclear** means no later green on that pull request inside the range.

What a sort of failures shows:

- **The expensive checks find the most.** The 10 to 20 minute checks produce most real catches: the migration-number and tenancy suites, the upgrade drill, the generated acceptance cases, look parity, and the docs manifest of test files.
- **The migration catches are mostly lanes numbering ahead of `main`.**
- **Most reds are the rules working.** The review-record and commit-trailer checks hold a pull request until its record or trailers exist. They cost about a minute each.
- **Flakiness is small and concentrated.** The worst single cause is usually one browser capture timeout in `local checks`. A `Test timed out` failure can also be real slowness.
- **Infra trouble is rare** on hosted runners.
- **Run-level status misleads.** A run that holds a never-green, non-required job (such as the look-ahead) never ends green as a whole. The merge rule reads the per-check results.
- **Unclear is not a bug count.** Most unclear failures sit on stacked pull requests whose base is not `main`.
- **The conformance gate, licence allowlist, dependency audit, gitleaks and size checks rarely fail.** They cost little and stay.

## Where the cost went

- Jobs cancelled by a newer push are a large share of the minutes. Most of that is the look-ahead.
- The look-ahead often repeats what the required database checks already said on the same head. When it is red alone, the next Postgres major broke something.
- Pull requests use most minutes; merge groups use the rest.

## Reviews against CI

CI catches mechanical and integration breakage on every push. Opus catches security matters before the pull request. Sol catches logic, race and spec defects that CI was green on, and every Sol finding carries a failing proof test on the frozen head. A log that records reviews against a head, not against a defect, cannot show which found a given defect first.

## How CI runs

- **No self-hosted runner on a public repository.** An outside pull request's edited workflow can name `runs-on: self-hosted` and run on your machine. Label routing in the workflow does not stop that. Self-hosted runners are for private repositories only, and paid runners need the owner's yes.
- **Hosted-runner concurrency depends on the account's plan,** not on a setting of yours. Measure job demand and set queue width from the slots available. A full `ci` run fans out to about 22 jobs.
- **The look-ahead runs on pull requests only,** not required, never on merge groups or pushes. It holds a runner for up to 90 minutes, which inside a merge group blocks landing for a result nobody reads.
- **No `cancel-in-progress` on merge groups,** and a sent-back pull request is held off full CI until it changes.
- **Pull requests run the light set; the merge queue runs the full set.** On a pull request: every `pnpm check` step but the build, `vitest --changed`, isolation tests deferred, the shards off, and `database conformance` accepts skipped shards on pull requests only. `merge_group` and `push` run the full set unchanged, and the required check names stay byte-identical. Nothing reaches `main` untested, because the queue stays the only gate.
- **Read workflow job cases with a real YAML parser,** never line-based checks. A line reader misses YAML forms, and each miss can let a required job skip merge groups.
- **Reject a pull request whose head is a merge-queue commit,** and require approval before fork pull request workflows from outside contributors run.
- **A CI speed change proves it lost nothing.** The pull request body shows the same named-suite count and the same test totals before and after.

## What is not measured

- Queue wait on pull request runs. Only merge-group queue wait is easy to read.
- Which of CI, Opus or Sol found a given defect first.
- Real-catch rate as a share of all runs. A sort of failures counts failures, not runs.

## Detail behind METHOD's CI rules

[Where the full tests run](METHOD.md#where-the-full-tests-run) states the rules. The reasons behind them live here.

- **Hosted runners.** Running the suite on GitHub's hosted runners keeps the owner's machine free for the agents.
- **Slow CI.** A single database conformance job can take 40 to 50 minutes when every other job takes 1 to 6. That is why every job stays under about 10 minutes, a longer suite split into shards behind one aggregate check.

### Queue traps

- GitHub never posts CodeQL on a merge group, so under a queue CodeQL is a code scanning rule, not a required check.
- The DCO app reads at most 250 commits and does not re-run when the base changes. Replace the head in place with a re-signed commit of the same tree.

## Refreshing this record

Sort a fresh range of runs and update the figures and findings above in place, never in a new file. List runs with `gh run list --created`, in 6-hour windows because the list caps at 1,000. Fetch each run's jobs, download logs for failed jobs, and sort failures in this order: policy hold, infra, flaky, real, unclear. Count cancelled runs apart, and leave an aggregate check's failures out when they only repeat a shard's.
