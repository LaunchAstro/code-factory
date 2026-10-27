# The example product's architecture decisions

These records were the template's own until 26 October 2026 (#334). They
explain [the example product's](../README.md) stack, isolation, records,
knowledge and tracing choices, and are kept as an example of the form, not as
decisions for a project made from the template. Their numbers are kept so
earlier references still name them. The template's own records are in
[docs/adr](../../adr/README.md).

| Decision                                                      | Responsibility                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| [0013](0013-gate-triple.md)                                   | One task and gate contract                                 |
| [0014](0014-business-id-on-every-table-and-key.md)            | Business isolation and enduring identity                   |
| [0019](0019-app-layer-vite-react-hono.md)                     | TypeScript, React, Vite, Hono, and Postgres                |
| [0028](0028-credential-broker-in-core.md)                     | A separate credential broker                               |
| [0030](0030-fixed-typed-slots-no-runtime-ddl.md)              | Fixed typed slots for records and tasks                    |
| [0031](0031-postgres-canonical-knowledge.md)                  | Postgres owns knowledge; exports are projections           |
| [0039](0039-audit-chain-serialisation-point.md)               | Serialise audit writes per business                        |
| [0067](0067-no-recovery-figures-until-rehearsed-and-timed.md) | Publish recovery figures only after measured rehearsal     |
| [0069](0069-tracing-and-analytics.md)                         | Separate diagnostics, analytics, and operational authority |
