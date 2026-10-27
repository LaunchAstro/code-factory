# Architecture

> **Fill this in.** Describe the project's stack, its runtime and data, how
> execution and review work, and what remains unbuilt. The
> [example product's architecture](docs/example-product/ARCHITECTURE.md) shows
> one project's answer; its stack is not this project's default. The
> [current decisions](docs/current-decisions.md) distinguish selected direction
> from proposals and pending proof.

## Product structure

| Responsibility              | Planned home               | State     |
| --------------------------- | -------------------------- | --------- |
| Runtime and agent execution | `packages/core-runtime`    | Not built |
| Records engine              | `packages/core-records`    | Not built |
| Credential broker           | `packages/core-custody`    | Not built |
| Provider operations         | `packages/core-connectors` | Not built |
| Shared interface components | `packages/ui`              | Not built |
| Web application             | `apps/web`                 | Not built |
| Worker                      | `apps/worker`              | Not built |
| Declarative presets         | `presets`                  | Not built |

The directories are placeholders. Development scripts and their tests exist;
an empty product build does not verify any row above.

The directories ship with the template, laid out for the example product.
Change them through a reviewed ticket.

## Evidence states

Use these evidence states consistently: **not built**; **written, not
applied**; **built, not enabled**; **live, verified against a named revision
and environment**. A test of a fixture does not change a production component's
state. Missing operational facts must remain visibly missing.
