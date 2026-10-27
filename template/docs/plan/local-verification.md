# Verify a local foundation candidate

The aggregate suite tests the foundation tools. The candidate commands check
the actual files selected for publication. Neither is proof that a future
commit is signed or GitHub is enforcing its rules.

## Check the working copy

Use the Node major in `.nvmrc`, the package manager version in `package.json`,
Python 3.11 or newer, Git and Gitleaks. The Python minimum is required by the
standard-library TOML parser used for project configuration.

`corepack pnpm run node:policy` verifies that `.nvmrc` selects the same major
that `package.json` requires as its minimum. The aggregate suite runs it too.

Run `corepack pnpm check` in the working checkout. Resolve failures. Stage
only the intended candidate files, including removals, without committing.

A run on uncommitted changes reports its steps passing but records no green;
only a run on a clean commit does. The runner holds the tree to these rules:

- An untracked file counts unless a committed `.gitignore` ignores it. One
  ignored by `.git/info/exclude`, `core.excludesFile` or a `.gitignore` that is
  not committed keeps the run from green.
- An untracked `.gitignore` also keeps the run from green, in any case (a Mac
  reads `.GITIGNORE` as one), inside an ignored folder too. The runner names that file. pytest, ruff,
  mypy and a Python 3.13 or later virtual environment write one into their own
  folder, so remove it, or move the cache or environment outside the
  repository.
- A tracked file marked assume-unchanged or skip-worktree, whose edit Git
  hides, also keeps the run from green. Its bytes are still compared between steps.
- Run from a folder below the repository's top, the runner still asks Git about
  the whole repository, so a flag or rule file above the folder counts too.
- A committed nested repository (a gitlink, or a tracked folder holding its own
  `.git`) can hide its bytes behind its own rules and index. It runs no step,
  and the runner names it.
- The runner writes the record to a new file and renames it into place, so a
  link at its path is replaced, never followed.
- The runner compares the tree after every step with the tree before the
  first, so a commit, or an edit made and restored, between steps fails the
  run. One made and undone inside a single step is not seen.
- A tree Git cannot name a head commit or a status for runs no step.
- A tree holding an untracked path the runner cannot read (a nested
  repository, or a file nobody may read) runs no step either. The runner names
  it.
- Any warning from Git, such as a folder it could not open, runs no step
  either, and the runner quotes it.

`pnpm check` also resolves every relative link in the documentation
(`pnpm run docs:links`). The run fails, naming the document and the line, on a
link that points at:

- a moved or deleted file, even one still in the index;
- an untracked file;
- a directory;
- a path or tracked symlink leading outside the repository.

A checkout with no tracked documentation to read also fails the run. External
URLs are not checked: somebody else's uptime is not this repository's to assert.

The export command refuses nonignored untracked files, staged ignored files,
conflicts, or differences between the selected index and working files.
The aggregate suite also checks that owned text files are non-empty valid UTF-8,
contain no byte order mark or NUL byte, and end with a newline, and refuses a
checkout with no tracked owned text file to read.

```sh
git diff --cached --check
node scripts/public-content-check.mjs --repo "$PWD"
node scripts/candidate-snapshot.mjs export --repo "$PWD" --candidate ../foundation-candidate --manifest ../foundation-manifest.json
node scripts/candidate-snapshot.mjs check --candidate ../foundation-candidate --manifest ../foundation-manifest.json
node scripts/public-content-check.mjs --candidate ../foundation-candidate --manifest ../foundation-manifest.json
gitleaks dir ../foundation-candidate --redact --config .gitleaks.toml
```

Candidate and manifest destinations must be new, outside the working
repository, and have existing parent directories. The manifest is also
outside the candidate. Keep test logs and review reports outside the candidate.

The export contains selected file bytes and safe internal relative links. It
does not contain Git history or development dependencies. Its manifest hashes
the complete path/mode/content list. Rechecking the actual export detects
added, missing or changed files, changed modes and unsafe links. Changing
the manifest invalidates the recorded review identity.

The public-content guard supplements the existing contamination and secret
scanners. It uses hashed named exclusions, contextual rules and an exact-byte
exception for the inherited synthetic path canary. It does not recognise
every possible private name or paraphrase. Independently read the public
introduction, decisions and references before treating the content as cleared.

Pre-push and CI also scan commit metadata and every selected historical
blob/path pair, including removed files. A clean current tree cannot hide
private material in an earlier commit. An explicit committed range can be
checked with `node scripts/public-content-check.mjs --repo "$PWD" --range RANGE`.
First-root checks use the full ref. Shallow history, a graft file and
annotated tag targets are refused rather than presented as complete history
proof. The guard reads Git locally, without replacement refs, grafts or the
commit-graph cache, and gives it no GitHub or registry credential.

## Review and preserve evidence

Review the actual candidate and its manifest with a frontier model from a
different company than the builder's. Record the manifest identity, findings,
corrections and recheck. A local file review
does not substitute for the later signing or hosted enforcement
requirements. Do not certify inherited preparation history as the first
public root.

After the owner separately authorises a signed first-root commit, the clean
final repository can produce a commit-specific local receipt:

```sh
node scripts/publication-receipt.mjs --first-root --ref HEAD --output ../first-root-receipt.md
```

The receipt command requires:

- exactly one root commit, counted without replacement refs, grafts or the
  commit-graph cache, and refused in a shallow clone or one with a graft file;
- a matching clean checkout before and after its checks;
- an explicit revision;
- new external output, opened before the checks run.

Clean means three things. Every file of the commit has the same bytes and mode
in the checkout, hashed from the file as it is. The index holds the commit.
Status finds no change and no nonignored untracked file against a fresh index
of the commit. Git's own view is not trusted for this: an index flag, a stat
setting such as `core.checkStat` or a clean filter can hide a changed file from
status.

The checks run from a private temporary copy of the bytes the first clean check
read, never from the checkout, so a file swapped there while a check runs is
not the one run.

- The copy's files are read-only.
- The receipt hashes the copy again after the checks and once more just
  before the write. It must hold exactly the commit's files, with their bytes and modes,
  their folders, the Git link file and the dependency link.
- A changed copy is a FAIL after the checks and a refusal before the write.
- A process of the same user that changes a file in the copy and puts it back
  within one check's run is not detected.

A checkout with line-ending conversion (an `eol` or `text` attribute, or
`core.autocrlf`) holds CRLF bytes that differ from the commit while Git reports
no change. The receipt reads raw bytes, so it refuses that checkout and names
line-ending conversion as the reason, not an uncommitted edit.

The contamination scanner runs as `python3 -I`, so no module beside it, ignored
or not, stands in for one it imports. Each check must exit zero; any other
exit, including a tool that could not run, is a FAIL. The receipt checks local
signatures, provenance and the proposed content/history. Neither its checks
nor its own Git get a GitHub or registry credential from the environment.

Two things are asked again after the act:

1. After the write, the checkout must still be clean, at the commit and free of
   any index flag.
2. Then, as the last step, the receipt must still be the file opened and lie
   outside the repository, as it must after the open too. The last read in
   that step is the open receipt's own path, taken from the file rather than
   looked up by name (Python's `fcntl` on macOS, `/proc` on Linux), so a folder
   moved and linked during the step is still seen; one found inside is
   removed.

Either failure replaces the receipt with a refusal and exits non-zero. Every
refusal prints one fixed line, never an error message or anything the
repository holds. The receipt does not verify GitHub signature display,
rulesets, mailbox delivery or application behaviour.
