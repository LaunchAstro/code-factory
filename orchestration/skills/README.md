# Skills, by reference

The orchestrator's skills are not copied into this repository. `SOURCES.json`
names each one — repository, path, pinned commit, and the sha256 of its
`SKILL.md` at that commit — and `fetch.mjs` brings them down. The fetched
directories are git-ignored, so the manifest is the only thing here that is
committed, and a skill cannot drift from its source without the hash saying so.

This public copy carries a snapshot of the Code Factory skills in
[`skills/`](../../skills/README.md). The pins in `SOURCES.json` are examples:
point them at your own copy of those skills.

- `node orchestration/skills/fetch.mjs` populates `orchestration/skills/<name>/`.
  Run it after cloning, and whenever a pin moves. Each skill is fetched and
  verified in a staging directory first; a skill whose hash does not match its
  pin, or with a file read that is not one base64 file of its stated size,
  leaves the installed copy as it was and fails naming the skill. Each file
  keeps the executable bit its git tree gives it, so a skill's scripts run
  directly; a file whose tree mode is not a regular file's fails the skill.
- `node orchestration/skills/fetch.mjs --check` fetches each pin to a temporary
  directory and compares it, file by file, with the installed copy, writing
  nothing. Non-zero on any miss, hash mismatch, or installed skill that is
  absent or differs, its executable bits included.
- `--installed <dir>` names the skills directory when that copy of `fetch.mjs`
  is not in it. `factory.sh` runs the checked commit's `fetch.mjs` and
  `SOURCES.json` from a temporary directory this way, against the installed
  skills in the clone, at the preflight and again just before the boot.

Both refuse the whole manifest, before anything is fetched or removed, when it
pins no skills, pins one name twice, or a pin is malformed: a name that is
not one lower-case path segment, a repository, commit or sha256 of the wrong shape, or a path with an
empty, `.` or `..` part. Each path segment is URL-encoded, so a `?` or `#` in
it names a file and cannot replace the pinned commit.

Both read private and public repositories through `gh api` as the machine's own
login, so no token and no credentialled URL enters the tree.

## Prerequisites

`SOURCES.json` also lists the two installs this kit expects the operator to
already have — Matt Pocock's engineering skills and the pstack plugin. The
fetcher never downloads them; it reports each one present or missing and prints
its install command. A missing prerequisite is a warning, not a failure.

## Bumping a pin

Edit that skill's `commit` and `sha256` in `SOURCES.json`, run the fetcher, and
commit the manifest. Nothing else changes.
