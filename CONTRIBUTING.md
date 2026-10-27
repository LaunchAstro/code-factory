# Contributing to Code Factory

Outside contributions are closed while the repository is private. What follows
is how a change is proposed when they open, and how they are made now.

## Propose a change

1. Branch off `main`. One change per branch, and name it for what it does.
2. Commit signed (`git commit -S`) and signed off (`git commit -s`). The
   sign-off certifies the
   [Developer Certificate of Origin](https://developercertificate.org/). An
   agent never writes a human's sign-off; an agent-assisted commit carries
   truthful `Assisted-by: LLM`, `Agent-model:` and `Agent-tool:` trailers
   instead.
3. Prove it. A change under `template/` is proved from a scratch copy of that
   directory: `git init`, one commit, `corepack pnpm install`, then
   `corepack pnpm check` green. Run `gitleaks detect --source . --no-git` over
   the whole repository either way. Put both results in the pull request body.
4. One pull request, and fill the template. It opens with the lines the
   merge script reads (`**Why:**`, `**Left undone:**`, `Closes`, `Section:`
   and `**Risk:**`), then asks for the claim, the proof, and which layer
   should have caught anything the review finds.

## The review

Code Factory reviews and merges its own changes the way it builds anything
else. Sol, a frontier model from a different company than the one that wrote
the change (the builder is Claude; [FLEET.md](docs/FLEET.md#models)), reads
it adversarially, every head until it approves the exact head
([FLEET.md](docs/FLEET.md#review), rounds in
[METHOD.md](docs/METHOD.md#review-rounds)), and the merge script lands it
([SINGLE.md](docs/SINGLE.md#merge)). Sol's comment is the review of record:
`Reviewer:`, `Model:`, `Head SHA:`, `Verdict:`, and a `Criterion:` line for
every hold. A refusal without a criterion is not a hold. A later review does
not clear an earlier refusal on the same head; a new head does.

`docs/rounds/` is the dated record of what the seven rounds proved. It is not
edited. A correction to it is a new file.

The [code of conduct](CODE_OF_CONDUCT.md) applies to everyone. Report
vulnerabilities through [Security](SECURITY.md).
