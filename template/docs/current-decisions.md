# Current product decisions

> **Fill this in.** This file arrives with the Code Factory template. Record
> the project's confirmed decisions here: its foundation, its domain and
> behaviour decisions, and its sequence and holds. The
> [example product](example-product/current-decisions.md) shows one project's
> filled-in file; its choices are not this project's defaults. Keep the holds
> below until the project's owner replaces them with a recorded decision.

The maintainer's confirmed decisions govern direction. This file carries the
public baseline; ADRs explain its trade-offs and tickets define executable
scope. New decisions must be recorded here before a ticket relies on them.
Private conversation history cannot be an implementation dependency.

## Selected foundation

| Area              | Decision | Proof still required |
| ----------------- | -------- | -------------------- |
| Application       | Fill in  | Fill in              |
| Operational store | Fill in  | Fill in              |
| Login             | Fill in  | Fill in              |
| Development       | Fill in  | Fill in              |

The detailed decisions are indexed in [ADRs](adr/README.md).

## Current domain and behaviour decisions

| ID  | Confirmed requirement                    |
| --- | ---------------------------------------- |
| C01 | Fill in: one confirmed requirement a row |

## Sequence and holds

These holds came with the template from the example product, with their dates.

**Amended 10 September 2026**: engineer approval for the eight protected
components was withdrawn and replaced by a green conformance proof per
affected component, per
[ADR 0049](adr/0049-senior-engineer-signed-engagement-stop-authority.md).

The full build-loop rehearsal precedes product code. A green conformance
proof is required before merging changes to the eight protected components.
The sandbox's final contract must be approved after adversarial findings are
resolved and before implementation. [Contributing](../CONTRIBUTING.md) is the
canonical review and merge procedure.

No external engineer review, legal opinion, security assessment, hosted enforcement,
mailbox delivery, or service deployment is certified here. A public technical
evidence digest with adjudicated verdicts remains outstanding. The
[plan index](plan/README.md) distinguishes that work from the private archive.
