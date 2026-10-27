# Work-map declarations

`declare.mjs` is a Node 24 writer with no dependencies or
model calls. It does not approve work, merge a
pull request, verify a deployment or calculate a finish date.

## Record schema

[`declare.schema.json`](declare.schema.json) describes version 1 record shapes.
`validateRecord(record, project)` also checks the project's repository and section
membership.

## Project configuration

Configuration belongs to each project. No project aliases, repository names or
diagram section IDs are built into the writer. This synthetic example shows all
required fields:

```json
{
  "schemaVersion": 1,
  "projectId": "sample",
  "aliases": ["SAMPLE"],
  "repositories": ["example/product", "example/roadmap"],
  "sections": ["checks"],
  "sectionSource": "https://example.invalid/project/diagram"
}
```

Repositories must be non-empty. Membership lists reject duplicates. Sections use
lowercase letters, digits and hyphens, starting with a letter. Non-empty sections
require their authoritative source reference. An empty list with `sectionSource:
null` supports an unresolved project inventory; only `sectionId: null` is then
accepted. Aliases are metadata and never silently rewrite a reference or identity.

## CLI and public functions

The command argument order below is fixed. `append` reads one JSON object from
standard input, omitting the writer-owned `schemaVersion` and `observedAt`.

```sh
node orchestration/declare.mjs append --config project.json --dir round/ledgers < assignment.json
```

`append` writes nothing to disk: it prints the validated record and its compatibility
lines. `--dir` is required but neither read nor written: the ledger is #299.

`append` returns JSON containing `record` and `compatibility`. Boot and assignment records
emit these exact whole-line forms:

```text
<UTC> <lane> BOOTED Section: <section-or-none> Ticket: <repo-qualified-ticket-or-none>
<UTC> <lane> PHASE Phase: <map|tickets|spec|build>
```

An assignment uses `TICKET` in place of `BOOTED`. The phase line remains separate.
Public functions are `loadProject(path)`, `validateRecord(record, project)`,
`validateHistory(records, project)`,
`appendDeclaration(dir, project, input)`,
`compatibilityLines(record)`. CLI refusals exit 1 with a fixed error code and no
input values. Unknown fields, including transcript fields, are refused.
