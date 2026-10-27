# Agent instructions

## Direction

Replace this paragraph with the project's own. Example: a portable
organisational system for records, knowledge, tasks and agent work, where
people keep authority over access, spending and consequential actions, durable
records explain progress and decisions, and the work is small verified
capabilities an organisation can operate itself.

## One router

The work follows Code Factory's route. No other routing block applies.

`wayfinder`, `to-spec`, `to-tickets`, the build, `close-out`; nothing is built
until the human says go. A settled job starts at the build. Pstack supplies
standards within this route.

Before work, read [current decisions](docs/current-decisions.md), the ticket
and the [inventory](docs/INVENTORY.md), and name what you build on in the pull
request body. [Model roles](docs/agents/model-roles.md) covers fresh context,
independent review, and written handoffs. Run the
[session check](docs/agents/session-check.md) before implementation.

## Build and review

One owner, ticket branch, and isolated worktree per ticket. Ticket review
reads the complete committed change. When commits are held during local
foundation preparation, review the files and diff against an identified
manifest, as [review checkpoints](docs/agents/review-checkpoint.md) requires.
Never commit just for that local review.

The final ticket verifies the integrated feature. Done is a checked artefact.
A frontier model from a different company than the builder's reviews it.
Merge is the decide step in [Contributing](CONTRIBUTING.md): on the head,
required contexts green and a review of record approving it. Changing one of
the eight protected components also needs its conformance test green. The
sandbox's final reviewed contract requires the owner's approval
(`<OWNER-HANDLE>`) before implementation.

Run `/security-review` before a pull request touching auth, tenancy, tool
execution, egress, custody, or the audit chain.

## References

For naming or public copy, read [Product identity](docs/product-identity.md).

[CONTEXT.md](CONTEXT.md) defines terms. [ADRs](docs/adr/README.md) explain
technical decisions. [Vendored skills](.claude/skills/README.md) define the
shared skill set. Write Australian English, sentence-case headings, and no
em dashes. Apply `unslop`.
