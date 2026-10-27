# The contamination gate

This foundation is intended for public release. The gate checks for known
private-content patterns before publication. It reduces accidental disclosure;
its limits are listed below.

## What it reads, and when

The scan target changes with the operation. A clean working tree does not
establish that the index or outgoing history is clean.

| When        | What is read                                                                                                                                         | Why that and not something else                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Pre-commit  | The **staged blobs**, out of the index                                                                                                               | Stage bad content, clean the working copy without staging the cleanup, and a working-tree scanner reports clean      |
| Pre-push    | **Every blob in every outgoing commit**, both sides of every change, and each commit's message and headers (author, committer, a merged tag's notes) | A file added and later deleted still sits in history, and once pushed it is public for good                          |
| `pnpm gate` | Every tracked file in the working tree                                                                                                               | The cheap continuous check. Not sufficient alone, which is why the two above exist                                   |
| CI          | The outgoing range on a pull request, and the tracked tree                                                                                           | Public continuous integration runs after a push, so it cannot undo a disclosure. It is the backstop, never the guard |

These rules apply to all four:

- **Path rules run first, on every path, with no exclusions.** A directory the
  content scan skips must never become a place to hide a denied path.
- **There is no path the gate declines to read.** `git add -f node_modules/x`
  was a way past the content scan; a file only reaches the index because
  somebody put it there. Directory skipping belongs to filesystem walking, in
  `--path` mode, and nowhere else. There a link is read as the blob git
  would store, its target path, and never followed, the root included.
- **Exemptions are of bytes, not names.** Four files exist to contain what the
  gate looks for. Exempting them by path exempted whatever anyone later put
  in them, so `scripts/gate/approved-exemptions.sha256` holds the sha256 of
  every approved version of each, and anything else at those paths is scanned
  like any other file. Changing a fixture is two deliberate edits.
- **A merge is compared against each parent.** `git diff-tree` prints nothing
  for a merge commit unless asked, so a value invented while resolving a
  conflict appeared in no diff and sailed into the history.
- **Paths are content too.** Every path meets the hashes and the shape rules,
  and in the literal sweep the private list, as well as the path globs.
- **Every byte of a commit object is read**, except git's leading `tree` and
  `parent` ids. Identity timestamps and timezones are read too. A header with
  any other name is scanned, a later `tree` line included. Signatures are
  text like the rest: every line of every header, `gpgsig` and a merged
  tag's `mergetag` included, meets the hashes, the
  shapes and the private list's substring match. No marker changes how a line
  is matched. Commit text is read as UTF-8 and, when the object declares
  another encoding, as that too. Text that is neither, or that holds a NUL
  byte, is exit 3.
- **It fails closed.** Anything the gate cannot read as UTF-8 text is a
  violation until someone writes that path into `binary-allowlist.txt` on
  purpose. A file the gate cannot read at all is a violation even then. A
  scanner that skips what it cannot parse is not a scanner.
- **Nothing to scan is not clean.** Nothing staged with no `HEAD`, no tracked files, a range
  with no commits, a directory with no files, an empty path denylist, an
  index with unresolved conflicts or a private list with no searchable term
  is exit 3. So is a shallow checkout or
  a graft file, which hide history a push publishes. Replacement refs are
  ignored: the gate reads the objects the push sends. A revision starting
  with `-` is refused, so no option can narrow the scan.
  An index that is exactly `HEAD`'s tree (a message-only amend, an empty
  commit, a merge resolved to ours) passes: it publishes no new blob, and
  pre-push scans the message.
- **The staged scan reads one snapshot.** It lists the index, reads the blobs
  that listing names, and lists it again. If anything was staged in between,
  it exits 3 rather than certify an index that is no longer there.
  A `git add` after that second listing and before git re-reads the index
  is not seen here; the pre-push scan reads that blob.

## Two layers, on purpose

**The committed layer is blind.** `denylist.sha256` holds SHA-256 hashes and
never the terms. It runs in public continuous integration, where publishing
the terms would defeat the entire exercise. Hashes are unsalted so the check
can run anywhere.

Be honest about what the six character minimum buys. It is **not** a guarantee
of confidentiality: anyone can hash candidate names and compare them against a
published list. It raises the cost of a dictionary run and nothing more. The
list holds only invented canaries today, so the question is still avoidable;
when real terms are added, that is the moment to weigh salting the list
against being able to check it in public.

**The shape rules ship in the clear**, in `shape-rules.txt`, because a shape
names no identifier. They catch the class a hashed list cannot: a hashed list
finds only what somebody thought to add, and the contamination audit of the
other codebase found a real-looking contact card that no term on any list
covered. Categories are `pii`, `provenance` and `infra`.

**The maintainer layer is literal.** A maintainer may supply an external
clear-text list through `HUB_GATE_TERMS`. Keep it outside the repository.
It drives `--literal` at pre-push. When the file is absent the script says so and exits 2. It never pretends to have run, and the pre-push hook refuses the push; no setting turns a sweep that did not run into a pass. Terms match in any script, with case and accents folded, so `Zoë` finds `Zoë` and `Zoe`. A list line that leaves fewer than three letters or digits to search is refused by its line number, never dropped.

Neither layer is sufficient alone. Together with gitleaks over the full
history, and with the rule that no material is ever copied across by hand,
they are the belt and the braces.

## The modes

| Command                                    | What it does                                                  |
| ------------------------------------------ | ------------------------------------------------------------- |
| `pnpm gate:selftest`                       | Proves the gate still works. Runs first, always               |
| `pnpm gate:cases`                          | Runs the regression cases against throwaway repositories      |
| `pnpm gate`                                | Sweeps every tracked file                                     |
| `pnpm gate:range`                          | Sweeps every blob in every outgoing commit. The pre-push hook |
| `python3 scripts/gate/sweep.py --staged`   | Sweeps the staged blobs. The pre-commit hook                  |
| `python3 scripts/gate/sweep.py --path DIR` | Sweeps anything on disk, inside the repository or out         |
| `pnpm gate:literal`                        | The maintainer clear-text sweep. Exits 2 with no list         |

Exit codes: 0 clean, 1 contamination found, 2 the clear-text list is absent,
3 the gate is broken or the arguments are wrong. A bad argument is 3, not
argparse's usual 2, so a hook can never read a typo as a missing list.

**Evidence is sanitised.** A finding prints its category and a short
fingerprint, never the matched text, because this output lands in continuous
integration logs and agent transcripts. No path is printed in any mode or
hook, since a filename can hold a credential no rule knows: every path prints
as `<withheld-path xxxxxxxx/N>`, the first eight hex digits of its sha256 and
its length, the same form `scripts/public-content-check.mjs` prints, so one
path reads alike in both. A commit's metadata keeps its `<commit> (<header>)`
label, where the header is one git writes (`tree`, `parent`, `author`,
`committer`, `mergetag`, `gpgsig`, `gpgsig-sha256`, `encoding`) or `message`;
any other header name is the commit's own text, so it prints as
`other-header`. The self-test withholds an exempt path the same way. A
malformed rule file is reported by line number, never by its text. A
missing rule file is named relative to the repository, and a failed git call
prints neither its arguments nor git's output, since either can hold a
revision or a path. An unexpected error prints its type, never a traceback. `--reveal` prints the matched text and the paths, and is
for a local terminal only: with `CI` or `GITHUB_ACTIONS` set, the gate refuses
it with exit 3.

## The self-test comes first

A blind gate that has quietly stopped working looks exactly like a clean
repository. So the self-test runs before the sweep, every time, in the hook
and in continuous integration. If it fails, the run fails and no sweep result
is to be believed.

It makes three assertions:

1. The canary is flagged, and the widest phrase it matches is at least four
   words, so a four word entry on the denylist cannot silently never match.
2. Every shape rule fires against `tests/gate/shape-canary.txt`.
3. A missing private list exits 2, never 0, through the literal sweep's own
   branch rather than a stand-in for it.

Both fixtures are synthetic. `tests/gate/canary.txt` holds an invented
business name; `tests/gate/shape-canary.txt` holds one made-up example of each
shape. Neither is ever a real value.

`pnpm gate:cases` goes further and builds throwaway repositories to prove the
gate against the cases it once missed: a staged blob that differs from the
working tree, a file added and then deleted, a denied path inside an excluded
directory, unreadable content, a four word phrase, the shape rules firing
outside their fixture, and the CF-02 review's empty inputs, history tricks,
metadata, paths and withheld output.

`tests/gate/shape-canary.txt`'s approved digests also excuse its path shapes
in `scripts/public-content-check.mjs`, which reads them from
`approved-exemptions.sha256`. One edit there approves a fixture for both.
Both read the manifest strictly: it must be printable ASCII and LF only, so
both split it into the same lines, in comments too, and hold at least one
record, and every record must be a 64-digit hex sha256 and a path. An absent,
empty, comment-only or malformed manifest is refused (exit 3 from the gate,
exit 1 from public-content), with its text withheld. There is no "no
approvals" manifest: the fixtures need theirs.

## A hit in a real signature

A signature's base64 is scanned like any other text, so a short private-list
term can turn up in one by chance. The literal sweep names the commit by its
first nine hex digits, and the header (`gpgsig`, or `mergetag` for a merged
signed tag). Clear it the way any
false positive is cleared, by approving exact bytes, after a reviewer has read
the whole commit object and found nothing but the chance match:

```sh
git cat-file commit <full commit id> | shasum -a 256
```

and add the digest to `approved-exemptions.sha256` as
`<sha256>  commit-<full commit id>-metadata`, in a reviewed pull request. The
name is the label `scripts/public-content-check.mjs` gives commit metadata.
The approval skips that commit's headers and message in `--range` and
`--literal`, and only while its bytes are the approved ones; its files are
still scanned. The self-test passes over commit approvals, which name no file.
Never approve a commit to get real private text past the gate: rewrite it.

## Adding a term

On a maintainer machine, with the clear-text list open:

```sh
printf '%s' "the term" \
  | tr '[:upper:]' '[:lower:]' \
  | tr -c 'a-z0-9' ' ' \
  | tr -s ' ' \
  | sed 's/^ //; s/ $//' \
  | shasum -a 256
```

Put the hash in `denylist.sha256`, the clear text in the private list, and
never the other way round. Terms shorter than six characters go in the private
list only.

Phrases of up to six words match, so a multi-word business name can go on the
list whole. The first version capped phrases at three words, which meant a
four word entry could never match and the list quietly lied about its own
coverage. `pnpm gate:selftest` now fails if the widest matching phrase drops
below four words.

A new shape rule goes in `shape-rules.txt` as `category|regex|description`,
with one synthetic example added to `tests/gate/shape-canary.txt`. The
self-test fails if any rule has no example that fires.

## What it cannot do

- It cannot catch a term nobody thought to add, unless it has a shape.
- It cannot catch a paraphrase, a screenshot or a re-typed value.
- It cannot read a binary file. It fails on one instead of skipping it, which
  turns a blind spot into a decision somebody has to make in writing.
- It cannot undo a push. Continuous integration runs after publication, so the
  pre-push hook is the guard and CI is only the backstop.

So it is a net under a rule, not the rule itself. The rule is that no client
material is copied into this repository, ever, by anyone, for any reason.
