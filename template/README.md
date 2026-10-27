# Product Name

By Launch Astro.

> **Fill this in.** This README arrives with the Code Factory template. Set the
> product name in [product.json](product.json) and in the first line of this
> file and [NOTICE](NOTICE), and rewrite the three sections below for the
> project. The headings and the links are the part worth keeping: every file
> they point at ships with the template and the checks read them.
>
> These placeholders ship unfilled, and each one routes somewhere outside the
> copied project until it is replaced:
>
> - `<OWNER-HANDLE>`, in 8 files: [CODEOWNERS](CODEOWNERS),
>   [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md),
>   [SECURITY.md](SECURITY.md), [model roles](docs/agents/model-roles.md), and
>   ADRs 0001, 0048 and 0049. It is the GitHub handle that owns the project,
>   reviews its pull requests and holds the sandbox contract. This list is the
>   only one; `orchestration/README.md` in the Code Factory repository points
>   here rather than repeating it.
> - `Product Name` in [product.json](product.json), and as the first line of
>   this file and [NOTICE](NOTICE), which `brand:check` holds equal to it.
> - `<COPYRIGHT-HOLDER>` and `<YEAR>` in [NOTICE](NOTICE).
> - `@your-scope/your-product`, the package name in
>   [package.json](package.json).
> - `security@launchastro.com` in [SECURITY.md](SECURITY.md) and
>   [the code of conduct](CODE_OF_CONDUCT.md), and the maintainer named in the
>   licence stack ([LICENSING.md](LICENSING.md), [CLA.md](CLA.md),
>   [GOVERNANCE.md](GOVERNANCE.md), [TRADEMARK.md](TRADEMARK.md),
>   [AI_POLICY.md](AI_POLICY.md)): these name Launch Astro's maintainer by
>   design. They are the owner's to edit, not a placeholder the copied project
>   fills in.
> - [Current decisions](docs/current-decisions.md), the
>   [vocabulary](CONTEXT.md) and the [architecture](ARCHITECTURE.md) arrive as
>   placeholders to fill in. [The example product](docs/example-product/README.md)
>   holds one project's filled-in versions, its ADRs and its first task; they
>   are not this project's defaults. The holds in current decisions, and the
>   eight protected components that [governance](GOVERNANCE.md), the
>   [ruleset](docs/plan/ruleset.md) and the pull request template name, stay
>   until the owner replaces them with a recorded decision.

One paragraph on what the product is and who runs it. Name the maintainer who
accepts responsibility for merged changes. AI agents assist with authoring;
[AI policy](AI_POLICY.md) sets attribution and independent review.

## Status

Say what exists and what does not. A new copy of the template has
documentation, tooling, checks, vendored skills and empty package directories.
There is no application, worker, installer, release or deployed service, and
local checks prove none of those.

Then say what is planned and where the boundaries are written down, in
[current decisions](docs/current-decisions.md) and the first task
specification.

## Start here

- [Inventory](docs/INVENTORY.md) lists what already exists, so nothing gets built twice.
- [Architecture](ARCHITECTURE.md) describes the stack and what remains unbuilt.
- [Vocabulary](CONTEXT.md) defines the domain terms.
- [Contributing](CONTRIBUTING.md) explains the build and review workflow.
- [Plan and evidence](docs/plan/README.md) separates decisions from proof still outstanding.
- [Security](SECURITY.md), [governance](GOVERNANCE.md) and [support](SUPPORT.md) state the policies.

## Check the foundation

Use the Node major in `.nvmrc`, the pnpm version in `package.json`, Python
3.11 or newer, Git and Gitleaks. Install the pinned development dependencies in
a working checkout, then run `corepack pnpm check`.

[Local verification](docs/plan/local-verification.md) explains how to check and
export an exact candidate without making a commit. Hosted and runtime proof are
separate.

## Product name

[product.json](product.json) holds the public name. To change it, edit that
file and the first line of this file and of [NOTICE](NOTICE), then run
`corepack pnpm check`. Its `brand:check` step fails while either heading differs
from the name, and prints the line to change, so those two headings cannot
drift.
[Product identity](docs/product-identity.md) separates branding from technical
identifiers and deployment addresses.

## Licence

The project is AGPL-3.0-only. [LICENSE](LICENSE) has the full text;
[NOTICE](NOTICE) records third-party attribution. The
[preset and skill exception](LICENSE-EXCEPTIONS.md) is drafted and ungranted,
and the [contributor agreement](CLA.md) is a draft too. Legal review is
outstanding. [Licensing](LICENSING.md) describes the intended boundaries.
