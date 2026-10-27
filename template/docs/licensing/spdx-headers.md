# Source licence headers

Project-authored code carries one licence identifier as its first line, or
its second after a shebang:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
```

Use `#` for Python and shell, and `--` for SQL. Keep the identifier exactly
`AGPL-3.0-only`; the project does not grant the later-version option.
The full licence and project notice remain in [LICENSE](../../LICENSE) and
[NOTICE](../../NOTICE).

`pnpm spdx` checks tracked and non-ignored new JavaScript, TypeScript, Python,
shell and SQL files, including source-based configuration and extensionless
Husky hooks. It requires one correct header in that place and no second one
in the first six lines, so a marker inside a string never counts. A tracked
file missing from the working tree, or no source file at all, is refused.
Git lists the files locally with no GitHub or registry credential.
`pnpm spdx:cases` verifies rejection of missing, misplaced, wrong and duplicate
headers.
Both run in `pnpm check` and therefore in the CI `local checks` job.

Do not add project headers to third-party skills: they keep their upstream
licences and attribution in `NOTICE`. The check excludes `.claude/skills/`
and its `.codex/skills` link. Licence texts, Markdown, data fixtures, JSON,
YAML and lock files are outside this source-header convention.

Add support before introducing another source language or generated-code
exception. The future Apache-2.0 SDK needs its own reviewed path and licence
rule before SDK files are introduced; it is not implemented here.

This enforces a repository convention. Legal review of the wider licensing
arrangements remains outstanding.
