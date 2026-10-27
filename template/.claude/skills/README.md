# Vendored skills

Two sets of skill files, committed like any other file, so every clone has
them and a change to a recipe is a pull request reviewed like code.

`AGENTS.md` is the law over both. Its one router is Code Factory's route,
and Pstack supplies standards within it. The exclusions are listed in
`_shared/excluded-skills.txt`.

## What is here

| Set | Count | Licence file |
|---|---|---|
| Matt Pocock, the official group | 25 | `LICENSE-mattpocock-skills` |
| Pstack, hand-picked | 15 | `LICENSE-open-pstack` and two more |

`../../.codex/skills` is a symlink to this directory, so Codex reads the same
files as Claude Code. There is one copy, not two.

### The Pocock 25

Installed with `npx skills@latest add mattpocock/skills`, at project scope,
copied rather than symlinked. The official group is the upstream
`engineering` folder (18) and `productivity` folder (7). Nothing from
`in-progress` or `misc` is here, which is why `setup-pre-commit` is absent.

The installer writes no licence file, so the upstream MIT licence is copied
in by hand as `LICENSE-mattpocock-skills`. The upstream commit is recorded in
the commit message that added them and in `skills-lock.json`.

### The Pstack 15

Copied by hand from the `open-pstack` checkout, because the installed plugin
directory does not contain the licence files and a naive copy would leave
them behind. All three MIT licences from the marketplace root are here:

- `LICENSE-open-pstack`, Lauren Tan.
- `LICENSE-open-pstack-cursor-team-kit`, Cursor, for seven imported skills.
- `LICENSE-open-pstack-superpowers`, Jesse Vincent, for the hook runner.

Seven are callable tools: `unslop`, `show-me-your-work`,
`create-verification-skill`, `maintain-verification-skill`, `blast-radius`,
`technical-writing`, `typescript-best-practices`.

Eight are principle leaves, marked `user-invocable: false`. Nobody types
`/principle-prove-it-works`. Upstream they are read by a router this
repository does not use, so here they are reference only.

Everything else in Pstack stays out by rule rather than by roster: the router
`poteto-mode` and its playbooks, `figure-it-out`, `arena`, `swarm`,
`interrogate`, `setup-pstack` (never run: it stands up a four-model panel,
which is spend), the personal explainers, and the remaining principle leaves.

## The `_shared` directory

`_shared/` is written by this repository, not vendored. It exists because the
vendored skills pointed at files that are not here.

- `codex-tools.md`, the neutral tool-name adapter. Upstream this reference
  lives inside `poteto-mode`, which is excluded as a second router, so two
  skills were linking to nothing.
- `security-review.md`, the same procedure `/security-review` runs, written
  so a runtime without that command can carry it out. `AGENTS.md` makes the
  review mandatory, and a rule only one runtime can obey is not a rule.
- `excluded-skills.txt`, the list `scripts/skill-refs-check.mjs` enforces.

`scripts/skill-refs-check.mjs` fails the build when a skill links to a file
that does not exist or to a directory, or points at a name on the exclusion
list, and when there is no file here of this repository's own to check. It
runs in `pnpm check` and in continuous integration.

## The local edits

Two Pstack skills differ from upstream, so that their links resolve here
(commit e8cb8b4, 14 October 2026):

- `create-verification-skill/SKILL.md` and `maintain-verification-skill/SKILL.md`
  link `../_shared/codex-tools.md` where upstream links
  `../poteto-mode/references/codex-tools.md`, because `poteto-mode` is excluded
  and not here.
- `create-verification-skill/SKILL.md` links
  `references/feature-map-example/README.md` where upstream links the
  directory.

Every other directory here is an untouched copy of its upstream skill.

A rule this repository wants belongs in this repository's own files, not in
somebody else's skill. The commit-before-review checkpoint that was added to
Pocock's `implement` is now in [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
beside the review step. The spend boundary that was added to Pstack's
`principle-never-block-on-the-human` came out with the other edits; the
authority over spending that `AGENTS.md` names is where that rule goes if it
is wanted again.

## Refreshing

Two rules, because the two sets arrive differently.

**Pocock.** Re-run the installer against a named upstream commit. Review the
diff like a dependency bump. Keep `LICENSE-mattpocock-skills`. Record the new
commit in the commit message.

**Pstack.** Re-copy from the checkout at a named version, then re-apply the
link edits above. Then check the three licence files are still here.
Record the version in the commit message.

Either way: the skills are vendored, so a refresh is a reviewed change, not
an update that happens to you.
