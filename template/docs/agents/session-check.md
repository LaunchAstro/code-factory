# Check a development session

Run the read-only repository check before implementation:

```sh
bash scripts/agent-session-check.sh
```

Use `--expect` to print the facts a fresh agent session must be able to
identify. The script inspects repository instructions, router wording,
vendored skills, local configuration, and required tools. Read a failure before
trying a workaround. Do not edit global configuration just to make a
repository check pass.

The check refuses a `.codex/skills` link that does not resolve to
`.claude/skills`, and a required tool that is on `PATH` but does not run. It
reads `.claude/settings.json` with a JSON parser: memory is off only when the
file is valid JSON (no `NaN` or `Infinity`) and its top level holds one
`autoMemoryEnabled` member set to `false`. Nothing else from that file is
printed, because it can hold credentials. Every Git the check runs, its
version probe included, gets only the variables `localGitEnv` in
`scripts/main-module.mjs` keeps, the rule the gates' Git reads use, so a
command the repository configures Git to run, such as `core.fsmonitor`,
receives no session token. When Node cannot read that rule, Git is not run.

Codex reads its global instructions from its home folder, `$CODEX_HOME` when
that is set and `~/.codex` otherwise: `AGENTS.override.md` there when it
exists, and `AGENTS.md` there when it does not. The check reads both files in
that folder, so removing one cannot bring in the other unchecked. Either may
name another project's context, meaning a pre-prompt, operating context or
system prompt, on one line only, its scope line, which may also name the file
to load:

```text
Pre-prompt scope: ~/that-project, "~/Folder With Spaces", ~/that-project-wt-1 | load "~/that-project/Pre-prompt.md"
```

The check does not read sentences. Its grammar, and nothing else, is:

- The line starts with `Pre-prompt scope:` at its first character, spelled
  exactly so, then one or more spaces.
- Then one or more folders, separated by a comma and optional spaces.
- Then, optionally, one or more spaces, `|`, one or more spaces, `load`, one
  or more spaces, and one file path, the load target.
- Then optional trailing spaces (and a carriage return in a CRLF file).
- A folder starts with `/` or `~/` (your home folder). No variables (`$HOME`,
  `${HOME}`), relative paths, `~user`, `.` or `..` segments, or empty
  segments (`//`).
- A folder is made of letters, digits and `_ @ + = % & ( ) ~ - .`; a
  segment may start with a dot but not end with one. A folder holding spaces
  is wrapped in double quotes.
- No glob: the line holds no `*`, `?`, `[`, `]`, `{` or `}`. Name each folder
  in full, one per worktree, rather than `~/that-project-wt-*`.
- The load target follows the same rules, except that it ends in a name, not
  a slash. It may name the context, as a path like `System Prompt/Pre-prompt.md`
  does, because it is on the scope line.

The line tells a session in one of those folders to read the load target,
and every other session to read nothing it names. The check holds the
folders to that: none may reach this repository. It does not check the load
target for reach, because it is a file read only inside the folders, nor
whether the file exists.

The check refuses the file, naming each line by number and never quoting its
text, when:

- any other line names the context. "Pre-prompt", "pre prompt", "preprompt",
  "operating context" and "system prompt" count in any case, with any dash,
  underscore or spacing between the words (a line break included), invisible
  format characters removed and full-width letters folded. A sentence that
  refuses the load still names it, so it is refused too;
- a line starts with `Pre-prompt scope:` and breaks the grammar, including
  anything after the folders other than one load target;
- the scope line holds a glob character, on a folder or the load target,
  whether or not it would reach this repository;
- a second line starts with `Pre-prompt scope:`;
- a scope folder reaches this repository: it is the repository, holds it, or
  sits inside it, compared by the folder's own path and the path its links
  resolve to, against the repository's path and its physical path, in any
  case, with the macOS spelling `/System/Volumes/Data/<path>` read as
  `/<path>`;
- a scope folder starts `/.vol/`, `/.nofollow/` or `/.resolve/`, macOS
  spellings of any folder that no link resolves;
- the file is not UTF-8 text, or holds a NUL byte.

A file that never names the context is accepted.

## The owner's own global instructions

The owner's global instructions are the `CLAUDE.md` of each of the owner's
seats and Codex's global `AGENTS.md` by design, and they name the owner's own
pre-prompt. The check recognises that file by its SHA-256, listed in the
owner's home folder at `~/.config/code-factory/owner-instructions.sha256`, one
hash at the start of a line, as `shasum -a 256` prints it. A listed file is
accepted as the Claude seat's `CLAUDE.md` and as either Codex global file,
without reading its lines for namings. A changed copy, or anyone else's file, has another hash
and is read as above. The repository holds neither the file's text nor its
path.

Only the owner writes that list. After a change to the global instructions,
the owner replaces the old line with the new file's hash:

```sh
mkdir -p ~/.config/code-factory &&
  shasum -a 256 <the global instructions file> > ~/.config/code-factory/owner-instructions.sha256
```

An agent never adds a hash to make the check pass. A red check on a file it
does not recognise is reported, not worked around.

## Inspect loaded context

The committed Claude configuration disables automatic memory. The committed
Codex project configuration disables memory generation and injection for new
trusted project sessions. User/global settings are not edited by the
repository. Project policy is not proof of the current session's effective
configuration; Codex skips project layers when the project is untrusted.

For an explicitly memory-off Codex startup, these command-line overrides
take precedence without changing global settings:

```sh
codex -c features.memories=false -c memories.generate_memories=false -c memories.use_memories=false
```

Verify the new session's effective settings before implementation. The
checker reports that runtime proof as unverified until it is supplied. See
[Codex configuration precedence](https://learn.chatgpt.com/docs/config-file/config-basic)
and [memory controls](https://learn.chatgpt.com/docs/config-file/config-reference).

File existence and runtime configuration do not prove what a session loaded.
For each supported runtime, record the actual instruction files, active
router, relevant memory settings, and skill resolution in a fresh session.
Use repository-local context for this project. Another project's identity or
private operating instructions supply no authority here.

An archive without Git history cannot satisfy checks that inspect branch and
head state. Inspect its manifest and files for local foundation review. Repeat
the complete development-session check in the authorised checkout before
implementation. Do not create history just to satisfy an archive check.

## Proof limits

No historical workstation transcript is a portable runtime receipt. A clean
session must be verified in the environment that will do the work. This page
records the procedure and does not claim that every supported runtime has
passed it for the current candidate.
