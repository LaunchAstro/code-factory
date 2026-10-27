# Configure and prove the merge policy

This is the intended hosted configuration. No effective repository settings
or enforcement results are claimed by this document. Configure and test them
only during an authorised hosted preparation step.

## Configure the rulesets

The primary `main` protection ruleset requires a pull request, passing required
status checks, signed commits, blocked force pushes, and restricted deletions.
Its bypass list is empty, including for the maintainer.

Require no approving review, on this ruleset or any other. The reviewer of
record posts its review as a comment carrying `Reviewer:`, `Model:`,
`Head SHA:` and `Verdict:`, and the `review evidence for this revision` check
reads the verdict off it and turns red or green. An approving-review
requirement would add a second gate over the same review, and a solo maintainer
would then need an exemption from it, which is a bypass with a name.

Leave Copilot's automatic code review **off**, on every ruleset. Copilot is out
of the chain: the reviewer of record is the frontier model from a different
company than the builder's, and nothing else reviews. Leave Copilot's approving
reviews disabled as well. An administrator can now allow Copilot to approve,
and an approval that counts towards a required approval makes it a gate, which
is the thing this configuration refuses.

Require every conversation to be resolved. That gate governs the comments
that exist, so it blocks a merge on an unresolved finding and reports nothing
about whether a review ran.

Enable merge commits only. Disable squash merging, rebase merging, linear
history, and automatic merging, including dependency updates. These settings
preserve the signed commits and keep the merge an explicit act on the counts,
taken by the orchestrator or the runner rather than by reading the diff.

## Bind checks to real hosted results

Require the 8 contexts recorded in `.github/required-contexts.json`, and no
others: `contamination gate`, `gitleaks over the full history`,
`local checks`, `OSI licence allowlist`, `commit messages and provenance`,
`review evidence for this revision`, `pull request size`, and
`the plan's tests were red before the code`. Read the effective workflow check
names and originating apps from a real run, and check that each of the 8
exists for the final revision.

A DCO result is not among them. The DCO app is configured in
`.github/dco.yml` and exempts signed commits, so it reports no context to
require.

A conformance proof is not among them either. This template names 8 protected
components in prose and ships no conformance test and no context that reports
one. A project that wants that gate writes the tests, adds the context to
`.github/required-contexts.json`, and adds the workflow that reports it.

Do not require a check by name that no workflow in this repository reports. A
required context bound to no app, or to a check suite raised outside the pull
request event, is never counted and blocks every merge.

A missing required check remains pending and blocks merging. A wrong name
usually causes that blocked state; a check omitted from the required list
provides no protection. Verify both configuration and results instead of
assuming either from this page.

The review-evidence validator checks the recorded revision. The sensitive-files
report only tells the reviewer which files need a security review; it blocks
nothing. Structured evidence is not proof that a reviewer
actually read the change. Retain the review report and verify the real hosted
path, including each required check's app identity.

## Prove the actual path

Use the credentials that builders and the maintainer will use. Record each
result against the effective configuration:

1. Direct pushes to `main` fail.
2. An unsigned commit cannot merge.
3. A failing required check prevents merging.
4. A pending or absent required check prevents merging, including for the maintainer.
5. Evidence naming an earlier revision prevents merging until refreshed.
6. A pull request whose 8 contexts are green and whose head carries a review of
   record saying `approve` merges by merge commit with a verified signature,
   with no approving review on it.
7. Squash, rebase merge, and automatic merge are unavailable.

The [decide step](../../CONTRIBUTING.md) merges on those two conditions and
reads nothing else.
