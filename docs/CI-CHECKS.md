# CI checks: what each one guards, what it costs, what it caught

A record of the checks on Ops Astro's pull requests and merge queue (LaunchAstro/ops-astro). It exists so the next person who touches CI can see what each check is for, what it costs, how often it was right, and what changed on 4 October 2026 and why. Owner-directed: the owner asked on 4 October for every test to be documented in Code Factory, "so then we've got more documentation surrounding what works what doesn't work".

Nothing here says remove a check. The audit's recommendations were "keep" or "speed up" only, and the owner's quality guard holds: no suite, check or assertion is dropped to make CI faster.

## Where the numbers come from

All per-check numbers come from CI-AUDIT (`handbacks/CI-AUDIT.md` in the round folder, private), a read-only Sonnet 5.5 audit that touched nothing. Its range is every Ops Astro `pull_request` and `merge_group` run created from **2026-10-01T00:00Z to 2026-10-04T07:28Z** (pulled 07:35Z), about three and a half days: 2,298 runs, 18,616 job runs, 1,580 failed jobs read. It counts runs through `#392` merging, so it is the "before" for everything in the change log below. Push-to-main runs (133) are counted once and not analysed.

Terms, as CI-AUDIT defines them:

- **Fail %** is failures out of runs that finished, with cancelled runs left out.
- **Real** means red on a head, a new commit on the pull request, then green. A defect was fixed. It does not prove the red was the first sign of the defect.
- **Flaky** means the same code later passed, or the log has a known flake signature. A flaky label is a rule, not a proof.
- **Infra** means runner, setup or network.
- **Policy hold** means the check did its designed job, such as a missing review record or missing commit trailers. Neither bug nor flake.
- **Unclear** means no later green on that pull request inside the range.
- **Minutes** are metered job minutes, including time in jobs later cancelled.

## What each check guards and costs

Required means the merge rule reads it (13 names, `required60.txt` in the audit). The database shards count through one aggregate name, `database conformance`.

| Check | Required | What it guards | Runs | Min per run | Minutes | Share |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| database conformance shard (8) | yes, via the aggregate | Named invariant suites and affected conformance suites on a real Postgres. Fails on a skipped test, a missing suite, zero tests, or a run that never touched the database. Tenancy, isolation, upgrade and acceptance suites live here | 5,358 | 10.6 | 57,033 | 46.9% |
| database look-ahead, Postgres 18 | no | The same conformance run on the next Postgres major, so a break shows before the provider moves | 776 | 41.0 | 31,851 | 26.2% |
| isolation tests | yes | Client isolation, restricted calls, pooled crossover, permission refusals. One client seeing or changing another's data | 780 | 13.4 | 10,486 | 8.6% |
| local checks | yes | `pnpm check`: lint, types, ratchets, format, unit and web suites, browser captures, container suites, a planted-script test of the built page | 780 | 12.9 | 10,087 | 8.3% |
| visual drift | no | The design catalogue notices a moved control or changed token, on the built app in a pinned headless browser | 780 | 2.8 | 2,181 | 1.8% |
| commit messages and provenance | yes | Every commit has a valid message and the agent trailers; applied migrations are unchanged and uniquely numbered | 780 | 1.7 | 1,354 | 1.1% |
| database conformance gate | yes | Probes that start their own Postgres and assert the runner refuses skipped, missing, empty and database-free suites. Tests the runner, not the product | 780 | 1.6 | 1,227 | 1.0% |
| contamination gate | yes | First job on purpose. Scans every blob for client material, secrets in public content, action pins, the nothing-merges-itself rule | 783 | 1.5 | 1,197 | 1.0% |
| review evidence for this revision | yes | Red until the pull request body carries a security review line and a second-company review record for this head | 1,123 | 1.0 | 1,069 | 0.9% |
| static analysis | yes | Semgrep (p/default, p/secrets, p/typescript). Every finding recorded with a reason, none new | 780 | 1.1 | 886 | 0.7% |
| Analyze (javascript-typescript) | no | CodeQL on the TypeScript | 392 | 2.2 | 875 | 0.7% |
| command parity | no | Every app action has an API and CLI equivalent | 780 | 0.8 | 601 | 0.5% |
| OSI licence allowlist | yes | Every dependency licence is on the allowlist | 780 | 0.6 | 486 | 0.4% |
| dependency audit | yes | High or critical advisories fail; moderate needs a recorded exception | 780 | 0.6 | 478 | 0.4% |
| gitleaks over the full history | yes | Secret scan over every commit, not just the diff | 780 | 0.6 | 470 | 0.4% |
| Analyze (python) | no | CodeQL on the Python files | 392 | 1.1 | 448 | 0.4% |
| pull request size | yes | Reports the diff against the size rule. The limit was retired on 29 September (FU-400), so it informs and blocks nothing | 780 | 0.6 | 443 | 0.4% |
| Analyze (actions) | no | CodeQL on the workflow files | 392 | 1.1 | 420 | 0.3% |
| database conformance (aggregate) | yes | The one required name over all 8 shards, `always()`, so a failed, skipped or cancelled shard fails it | 777 | 0.1 | 42 | 0.0% |

Shares are each check's minutes out of 121,635 total, rounded. `DCO` is required but is not a job in these runs (probably a GitHub app check), so it was not audited.

## How often each check was right

Failed jobs by kind, 1 Oct to 4 Oct 07:28Z. The percentages are of that check's own failures. The aggregate `database conformance` failed 455 times only because a shard failed, so it is left out.

| Check | Failed | Real | Flaky | Infra | Policy hold | Unclear |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| database conformance shard (8) | 481 | 376 (78%) | 5 (1%) | 0 | 0 | 100 |
| database look-ahead, Postgres 18 | 109 | 43 (39%) | 0 | 0 | 0 | 66 |
| isolation tests | 106 | 12 (11%) | 2 (2%) | 0 | 0 | 92 |
| local checks | 249 | 98 (39%) | 78 (31%) | 4 (2%) | 0 | 69 |
| visual drift | 18 | 11 (61%) | 0 | 0 | 0 | 7 |
| commit messages and provenance | 111 | 0 | 0 | 0 | 111 | 0 |
| contamination gate | 3 | 1 | 0 | 1 | 0 | 1 |
| review evidence for this revision | 471 | 0 | 0 | 0 | 471 | 0 |
| static analysis | 3 | 3 | 0 | 0 | 0 | 0 |
| Analyze (javascript-typescript) | 3 | 1 | 2 | 0 | 0 | 0 |
| command parity | 24 | 12 (50%) | 0 | 0 | 0 | 12 |
| Analyze (python) | 1 | 1 | 0 | 0 | 0 | 0 |
| Analyze (actions) | 1 | 1 | 0 | 0 | 0 | 0 |
| database conformance gate, OSI licence allowlist, dependency audit, gitleaks, pull request size | 0 | 0 | 0 | 0 | 0 | 0 |

In total: 1,580 failed jobs. 559 real (35%), 87 flaky (5.5%), 5 infra (0.3%), 582 policy holds (37%), 347 unclear (22%).

What that says:

- **The expensive checks found the most.** The 10 to 20 minute checks produced most real catches. Five clusters carry most of them: the migration-number and tenancy suites (`restricted-calls-prefixes`, `tenancy-conformance`), the upgrade drill, the generated acceptance cases (`d06-generated`), look-parity, and the docs manifest of test files. 559 real failures sat on 73 of the 111 pull requests in range.
- **The migration clusters are mostly lanes numbering ahead of main.** The audit read this from `events.log` and did not open the tests.
- **Most reds are the rules working.** 582 of 1,580 (37%) are the review-record and commit-trailer checks holding a pull request until its record or trailers exist. They cost about a minute each.
- **Flakiness is small and concentrated.** The worst single cause is one browser capture timeout at `capture.ts:234` in `local checks`: 49 failures, about 930 job minutes. It is named B1-CAPTURE-FLAKE. A further 22 are `Test timed out`, which could also be real slowness.
- **Infra trouble was nearly absent.** 5 failures: a Docker daemon error twice and a gitleaks download step three times. The audit searched the logs for runner shutdown, lost communication, out-of-disk, network-reset and DNS strings and found none. Merge-group jobs started in a median of 0.03 to 0.05 minutes, so there was no sign of a runner shortage. It did not measure queue wait on pull request runs.
- **Run-level status misleads.** No `ci` pull request run ended green in range (0 of 719: 140 failed, 566 cancelled, 13 pending). The look-ahead is part of the run and never passed. The per-check results are what the merge rule reads, and those were mostly green.
- **Unclear is 347.** 268 sit on stacked pull requests whose base is not `main`, 79 on pull requests into `main` with no later green found. Do not read the unclear column as bugs.

## Where the cost went

| Item | Minutes | Share |
| --- | ---: | ---: |
| All job minutes | 121,635 | 100% |
| Jobs later cancelled by a newer push | 39,190 | 32% |
| Of that, the Postgres 18 look-ahead | 24,019 | 20% |
| Jobs that failed | 18,372 | 15% |
| Look-ahead, all outcomes | 31,851 | 26% |
| Shards, all outcomes | 57,033 | 47% |
| Pull requests / merge groups | 107,287 / 14,348 | 88% / 12% |

Two checks were 73% of the bill. The look-ahead is not required, ran 776 times and never passed once: 109 red, 656 cancelled. On 43 of its 109 reds the required database checks were red on the same head, so it repeated what the shards said. The other 66 were red on Postgres 18 only. The 13 cheapest checks (under 2 minutes a run) used 7.5% of the minutes.

Shard medians for finished runs, in minutes: 10.9, 10.9, 11.4, 11.2, 11.8, 10.4, 14.1, 13.1. Shard 7 was both the slowest and the most-failing.

## Reviews against CI

From `events.log` lines 1 Oct onward. The first Sol result is 3 Oct 00:03Z, so Sol counts cover 3 to 4 Oct only.

| Reviewer | Reviews | Findings | Per review | Reviews with a finding |
| --- | ---: | ---: | ---: | ---: |
| Sol, all | 289 (284 with a count) | 1,110 | 3.9 | 270 |
| Sol, first round | 195 | 710 | 3.6 | |
| Sol, re-review after a fix | 94 | 400 | 4.3 | |
| Opus security review | 82 distinct heads | 137 | 1.7 | 18 |

Sol's 289 results: 271 asked for changes, 13 approved, 5 came back empty and were re-run. 458 of the 1,110 findings are on Code Factory, so about 650 are Ops Astro. Every Sol finding carries a failing proof test on the frozen head. CI catches mechanical and integration breakage on every push, Opus catches security matters before the pull request, and Sol catches logic, race and spec defects that CI was green on. The audit could not show which found a given defect first, because the log records reviews against a head, not against a defect.

## What changed on 4 October 2026, and why

Times are UTC, with the `events.log` line (`el`) for each. Status is as of 08:30Z (18:30 AEST).

| When | Change | Why | State |
| --- | --- | --- | --- |
| 02:18Z, el 17309 | Owner asks to speed merges: self-hosted M5 runners, cancel superseded runs, no full CI on sent-back heads, confirm the 8-job cap | Merge pace was about 5 per 6 hours against about 60 pull requests left (el 16390) | Started the CI-SPEED lane |
| 03:13Z, el 17381 | **No self-hosted runner on a public repo (CIRUNNER).** Held, then settled as option A at 05:44Z (el 18028): no M5 runner, no paid runners | The owner's yes was for a private repo. Ops Astro is public, and on a public repo an outside pull request's edited workflow can name `runs-on: self-hosted` and run on the production M5. Label routing in our workflow does not stop that | Settled. Prices for paid options went to the owner. Nothing bought |
| 03:36Z, el 17486 | The "8 runs at once" cap is not a setting of ours. Available hosted-runner concurrency depends on the account's plan. Measure job demand and configure queue width from the available slots | Evidence from 240 runs, 1,600 jobs between 3 Oct 23:00Z and 4 Oct 02:30Z: peak 68 jobs running, 55 or more running for 110 minutes, peak 250 waiting. A full `ci` run fans out to about 22 jobs | Recorded |
| 03:37Z, el 17489 | **Look-ahead off merge groups and pushes** (LOOKAHEAD B). It still runs on pull requests, not required | 0 of 63 runs green in its window, many cancelled at its 90-minute timeout, and it held a runner for up to 90 minutes inside every merge group whose branch was gone before it ended. Moving it to a schedule only was not taken, because it rewrites an accepted criterion of S0-7. A filed row records the hang (el 17524) | In `#392` |
| 04:25Z, el 17692 | Merge-group job cases read with the `yaml` package (2.9.0, already in the lockfile) instead of line-based checks | Opus security rounds 2 to 4 each found a new YAML form the line reader missed, each letting a required job skip merge groups behind the look-ahead. Same class three rounds running means a simpler design | In `#392` |
| 07:21:58Z, el 18460 | **`#392` merged.** The sent-back label hold, no `cancel-in-progress` on merge groups, look-ahead on pull requests only, YAML-parsed job cases. The 13 required check names are unchanged. Sol approved with 0 findings in round 1; a one-line fix for a false positive in the `.env` scan (7be6f62 to 1e77c39) got a narrow round 2 | Pull requests were starving the merge groups of runners, and the look-ahead was holding runners for a result nobody read | Merged |
| 08:29Z, el 18795 | **Pull requests run the light set; the full set runs only in the merge queue (CIITEM2, `#723`).** On a pull request: every `pnpm check` step but the build, `vitest --changed`, isolation tests deferred, the 8 shards off, `database conformance` accepts skipped shards on pull requests only. `merge_group` and `push` run the full set unchanged. The 13 names are byte-identical | The owner's reading of "won't run the full tests": nothing reaches `main` untested, because the queue stays the only gate. About 88% of minutes were on pull requests | Open, Sol review waiting. Not merged at the time of writing |
| 10:08:59Z, el 19412 | **Sol fix re-checks read only the fix.** Rounds 2 and 3 review the diff since Sol's last head and confirm each earlier finding closed, at medium effort; a new piece and round 1 stay full, at high | Owner, NATHAN-SOL-MOVES item 1 ("Go for it" to director 16's three Sol and test changes) | Applied by SOL-LEAD at 10:15Z (el 19459) |
| 10:08:59Z, el 19412 | **Some of Sol's review slots are kept for the area sweep.** Pre-merge runs use the rest and borrow a sweep slot only when no sweep chunk waits | Owner, NATHAN-SOL-MOVES item 2 | Applied by SOL-LEAD at 10:15Z (el 19459) |
| 10:10:04Z, el 19424 | **Merge queue groups up to 5 pull requests** (ruleset 23396133, `max_entries_to_merge` 3 to 5). `max_entries_to_build` stays 2 and the 90-minute timeout and 13 required checks are unchanged, so in practice a group merges at most 2 until build is raised (el 19427) | Owner, NATHAN-SOL-MOVES item 3. No test dropped, nothing bought | Applied |
| Planned | **CIITEM3.** One migrated database snapshot every shard starts from, database tests split 16 ways, the Postgres 18 look-ahead moved to a nightly run, and the B1-CAPTURE-FLAKE fix | The audit's three biggest costs: shards, look-ahead, `local checks` | Owner said yes at 08:27Z (el 18781). Builds after CIITEM2 is ready for main |

The quality guard for CIITEM3, in the owner's words, is "essentially we're not losing any quality but we're still getting all the tests that we need". The pull request body must prove it with the same named-suite count (697 or more) and the same test totals before and after. CI-AUDIT's numbers are the before-measure.

Rules from CIITEM2's security review: reject a pull request whose head is a merge-queue commit, and require approval before fork pull request workflows from outside contributors run.

## What is not measured

- Queue wait on pull request runs. Only merge-group queue wait was measured.
- The effect of the light-set change on merge pace. `#723` is not merged, so merges per hour after `#392` reflect `#392` alone. See the dated look-back in `BASELINE-2026-10-02.md` (a private round record).
- Which of CI, Opus or Sol found a given defect first.
- Real-catch rate as a share of all runs. The audit sorts failures, not runs.

## Detail behind METHOD's CI rules

[Where the full tests run](METHOD.md#where-the-full-tests-run) states the rules. The numbers and traps behind them live here.

- **Hosted runners.** Moving the suite to GitHub's hosted runners cut laptop load from about 45 to 15 on 16 cores (30 September 2026).
- **Slow CI.** On 30 September, database conformance took 40 to 50 minutes and every other job 1 to 6. That is why every job stays under about 10 minutes, a longer suite split into shards behind one aggregate check.

### Queue traps

- GitHub never posts CodeQL on a merge group, so under a queue CodeQL is a code scanning rule, not a required check.
- The DCO app reads at most 250 commits and does not re-run when the base changes. Replace the head in place with a re-signed commit of the same tree (Ops Astro #315).

## Refreshing this record

Re-run CI-AUDIT's method over a new range and add a dated section under the tables, never a new file. List runs with `gh run list --created`, in 6-hour windows because the list caps at 1,000. Fetch each run's jobs, download logs for failed jobs, and sort failures in this order: policy hold, infra, flaky, real, unclear. The scripts are `analyze.py` and `refine.py` in the audit's lane-scratch folder. Compare against the numbers above, and mark a row in [SKILL-WATCH.md](SKILL-WATCH.md) held or failed.
