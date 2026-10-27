#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""The contamination gate.

Stops client material from ever entering this repository's history.

What it inspects, and why each mode exists
------------------------------------------

- **Before a commit**, it reads the *staged blobs* out of the index, not the
  working tree. Reading the working tree was the defect the sweep of
  6 September found: stage bad content, clean the working copy without
  staging the cleanup, and a working-tree scanner reports clean.
- **Before a push**, it reads *every blob in every outgoing commit*, on both
  sides of every change, so a file added and later deleted is still caught.
  A working-tree scan can never see that, and once it is pushed it is public
  for good.
- **Path rules run first, on every path, with no exclusions.** A directory
  the content scan skips must not become a place to hide a denied path.
- **It fails closed.** Anything it cannot read as text is a violation until
  someone writes that path into the binary allowlist on purpose.

The committed half is blind: it holds SHA-256 hashes of terms, never terms.
That is what lets it run in public continuous integration. Shape rules ship
in the clear because they name a shape and never an identifier, and they
catch the class of thing a hashed list misses: a hashed list only finds what
somebody thought to add.

Evidence is sanitised by default. A match prints its category and a short
fingerprint, never the matched text, because this output lands in continuous
integration logs and agent transcripts. No path is printed either: a filename
can hold a credential no rule knows, so every path prints as
`<withheld-path xxxxxxxx/N>`, the form scripts/public-content-check.mjs uses.

Every byte of a commit object is text to scan, signatures included. A chance
hit in a real signature is cleared like any false positive: a reviewed line in
approved-exemptions.sha256 approving that commit's exact bytes.

An empty scan set is absent evidence, not a clean result: nothing staged, no
tracked files, a range with no commits, a directory with no files, a shallow
history, an index with unresolved conflicts, commit text that is not text or a
private list with no searchable term is exit 3.

Exit codes
  0  clean
  1  contamination found
  2  the clear-text list is absent (literal mode only)
  3  the gate itself is broken, the arguments are wrong, or there was nothing
     to scan

Modes
  (none)        sweep the tracked files in the working tree
  --self-test   prove the gate still works, before believing any sweep
  --staged      read the staged blobs, for the pre-commit hook
  --range ...   read every blob in an outgoing commit range, for pre-push
  --path PATH   sweep one file or directory, anywhere on disk
  --literal     the maintainer-only clear-text sweep
"""

from __future__ import annotations

import argparse
import contextlib
import fnmatch
import functools
import hashlib
import io
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent

DENYLIST = HERE / "denylist.sha256"
PATH_DENYLIST = HERE / "path-denylist.txt"
SHAPE_RULES = HERE / "shape-rules.txt"
BINARY_ALLOWLIST = HERE / "binary-allowlist.txt"

CANARY_FILE = REPO / "tests" / "gate" / "canary.txt"
SHAPE_CANARY_FILE = REPO / "tests" / "gate" / "shape-canary.txt"

# The private clear-text list is supplied explicitly and never stored in git.
LITERAL_LIST_ENV = "HUB_GATE_TERMS"

# The shortest term the hashed list carries, with spaces removed. Shorter
# names are covered by the literal sweep instead.
#
# Note what this does not buy: the hashes are unsalted so public continuous
# integration can check them, and anyone can hash candidate names and compare.
# Six characters raises the cost of a dictionary run. It is not a guarantee of
# confidentiality, and scripts/gate/README.md says so.
MIN_TERM_LENGTH = 6

# The longest phrase assembled out of neighbouring words. The first version
# capped this at three, so four word entries on the denylist could never
# match. Raising it costs a little time and closes that hole.
MAX_NGRAM_WORDS = 6

# Content exclusions are of **bytes, not paths**.
#
# Four files exist to contain the thing the gate looks for. Exempting them by
# name exempted whatever anyone later put in them, which round four
# demonstrated by appending a denied term to the canary and getting a clean
# result. scripts/gate/approved-exemptions.sha256 holds the sha256 of the
# approved contents of each one; anything else at those paths is scanned like
# any other file.
EXEMPTIONS = HERE / "approved-exemptions.sha256"

# There is no path the gate declines to read. A file only reaches the index or
# the history because somebody put it there, and `git add -f node_modules/...`
# was a way past the content scan. Directory skipping belongs to filesystem
# walking, in --path mode, and nowhere else.

WORD = re.compile(r"[a-z0-9]+")
# The private list's words: any script, so a name like Zoë keeps its letters.
LITERAL_WORD = re.compile(r"[^\W_]+")
NULL_SHA = "0" * 40


class GateBroken(Exception):
    """The gate cannot do its job. Never reported as clean."""


def die(message: str, code: int = 3) -> None:
    print(f"gate: {message}", file=sys.stderr)
    raise SystemExit(code)


# ---------------------------------------------------------------------------
# Loading the rules


def load_hashes() -> set[str]:
    if not DENYLIST.is_file():
        die(f"denylist missing at {DENYLIST.relative_to(REPO)}")
    hashes: set[str] = set()
    for number, raw in enumerate(DENYLIST.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.split("#", 1)[0].strip().lower()
        if not line:
            continue
        if len(line) != 64 or not all(c in "0123456789abcdef" for c in line):
            die(f"denylist line {number} is not a sha256 (its text is withheld)")
        hashes.add(line)
    if not hashes:
        die("denylist is empty; the gate would pass everything")
    return hashes


def load_globs(path: Path, what: str, required: bool = False) -> list[str]:
    if not path.is_file():
        die(f"{what} missing at {path.relative_to(REPO)}")
    out: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            out.append(line)
    if required and not out:
        die(f"the {what} is empty; the gate would pass a .env")
    return out


@functools.lru_cache(maxsize=1)  # main and commit_metadata read one manifest
def load_exemptions() -> dict[str, set[str]]:
    """path -> every sha256 the gate will skip at that path.

    A set, not a single digest: these fixtures legitimately change, each
    change is an approval, and the old bytes stay approved because they are
    still in the history the pre-push scan reads.
    """
    if not EXEMPTIONS.is_file():
        die(f"approved exemptions missing at {EXEMPTIONS.relative_to(REPO)}")
    data = EXEMPTIONS.read_bytes()
    # Printable ASCII and LF only, so this reader and public-content-check.mjs
    # split it into the same lines: splitlines() also breaks at U+2028.
    if any(byte != 0x0A and not 0x20 <= byte <= 0x7E for byte in data):
        die("approved exemptions hold a byte outside printable ASCII and LF (its text is withheld)")
    out: dict[str, set[str]] = {}
    for number, raw in enumerate(data.decode("ascii").split("\n"), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) != 2 or not re.fullmatch(r"[0-9a-f]{64}", parts[0].lower()):
            die(f"exemption line {number} is not '<sha256>  <path>' (its text is withheld)")
        out.setdefault(parts[1].strip(), set()).add(parts[0].lower())
    if not out:
        die("the exemption list is empty; the fixtures would fail every sweep")
    return out


def load_shape_rules() -> list[tuple[str, "re.Pattern[str]", str]]:
    if not SHAPE_RULES.is_file():
        die(f"shape rules missing at {SHAPE_RULES.relative_to(REPO)}")
    rules: list[tuple[str, re.Pattern[str], str]] = []
    for number, raw in enumerate(SHAPE_RULES.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        # Split on the first and last bar only: a regex is full of bars.
        if line.count("|") < 2:
            die(f"shape rule on line {number} is not category|regex|description")
        category, rest = line.split("|", 1)
        pattern, description = rest.rsplit("|", 1)
        category, pattern, description = (
            category.strip(),
            pattern.strip(),
            description.strip(),
        )
        if not category or not pattern or not description:
            die(f"shape rule on line {number} has an empty field")
        try:
            compiled = re.compile(pattern, re.IGNORECASE)
        except re.error:
            die(f"shape rule on line {number} will not compile")
        rules.append((category, compiled, description))
    if not rules:
        die("no shape rules; the gate would pass a contact card")
    return rules


# ---------------------------------------------------------------------------
# Matching


def normalise(text: str) -> list[str]:
    return WORD.findall(text.lower())


def literal_words(text: str) -> list[str]:
    """Words as the private list matches them: case and accents folded, so
    Zoë on the list finds Zoë and Zoe, and is never cut down to Zo."""
    folded = unicodedata.normalize("NFKD", text.casefold())
    if not folded.isascii():
        folded = "".join(c for c in folded if not unicodedata.combining(c))
    return LITERAL_WORD.findall(folded)


def candidates(text: str):
    """Every 1 to MAX_NGRAM_WORDS word phrase in the text, normalised.

    Phrases are joined with a single space, and a term is hashed the same way
    when the list is built, so a multi word term matches whether the text
    separates the words with a space, an underscore, a hyphen or a full stop,
    and whatever the case.
    """
    words = normalise(text)
    for size in range(1, MAX_NGRAM_WORDS + 1):
        for i in range(len(words) - size + 1):
            phrase = " ".join(words[i : i + size])
            if len(phrase.replace(" ", "")) >= MIN_TERM_LENGTH:
                yield phrase


def digest(phrase: str) -> str:
    return hashlib.sha256(phrase.encode("utf-8")).hexdigest()


def fingerprint(text: str) -> str:
    """Enough to tell two findings apart, not enough to recover the term."""
    return f"{digest(text)[:8]}/{len(text)}"


def scan_text(text: str, hashes: set[str], shapes) -> list[tuple[str, str]]:
    """Return (category, matched text) for every hit. The caller decides
    whether the matched text is ever printed; by default it is not."""
    hits: list[tuple[str, str]] = []
    seen: set[str] = set()
    for phrase in candidates(text):
        if digest(phrase) in hashes and phrase not in seen:
            seen.add(phrase)
            hits.append(("denied term", phrase))
    for category, pattern, description in shapes:
        for match in pattern.finditer(text):
            value = match.group(0)
            key = f"{category}:{value}"
            if key in seen:
                continue
            seen.add(key)
            hits.append((f"shape, {category}: {description}", value))
    return hits


def read_path(path: Path) -> bytes | None:
    """The bytes git would store for this path.

    A symlink is not a file to open: git stores the target path as the blob,
    and opening it either follows the link or raises. Read the link itself,
    so a symlink is scanned for what it actually is and never counted as
    unreadable.
    """
    try:
        if path.is_symlink():
            return os.readlink(path).encode("utf-8", "surrogateescape")
        return path.read_bytes()
    except OSError:
        return None


def decode(data: bytes) -> str | None:
    """Text, or None when this is not text. None is a violation, not a skip."""
    if b"\x00" in data:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


# ---------------------------------------------------------------------------
# Git


# A replacement ref makes git show one object in place of another. The push
# publishes the original, so the gate reads the original.
GIT_ENV = {**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"}


def git(args: list[str], cwd: Path | None = None) -> bytes:
    try:
        return subprocess.run(
            ["git", *args],
            cwd=cwd or REPO,
            check=True,
            capture_output=True,
            env=GIT_ENV,
        ).stdout
    except FileNotFoundError as exc:
        raise GateBroken("git is not on PATH") from exc
    except subprocess.CalledProcessError as exc:
        # Its arguments and output can hold a revision or a path: withheld.
        raise GateBroken(f"git {args[0]} failed (exit {exc.returncode}); its output is withheld") from exc


def zsplit(data: bytes) -> list[str]:
    return [p for p in data.decode("utf-8", "surrogateescape").split("\0") if p]


def tracked_files() -> list[str]:
    return zsplit(git(["ls-files", "-z"]))


STAGED_LISTING = ["diff", "--cached", "--raw", "--no-renames", "--no-abbrev", "-z"]


def cat_blob(sha: str) -> bytes | None:
    try:
        return subprocess.run(
            ["git", "cat-file", "blob", sha],
            cwd=REPO,
            check=True,
            capture_output=True,
            env=GIT_ENV,
        ).stdout
    except subprocess.CalledProcessError:
        return None


def index_is_head() -> bool:
    try:
        head = git(["rev-parse", "--verify", "--quiet", "HEAD^{tree}"]).strip()
    except GateBroken:
        return False
    return head != b"" and git(["write-tree"]).strip() == head


def require_whole_history() -> None:
    """A shallow checkout or a graft file hides commits the push publishes."""
    if git(["rev-parse", "--is-shallow-repository"]).strip() != b"false":
        raise GateBroken("this checkout is shallow, so the history a push publishes cannot be read in full")
    grafts = os.environ.get("GIT_GRAFT_FILE") or git(
        ["rev-parse", "--git-path", "info/grafts"]
    ).decode("utf-8", "surrogateescape").strip()
    if grafts and (REPO / grafts).exists():
        raise GateBroken("a graft file rewrites this history's parents; remove it before scanning")


def outgoing_commits(revs: list[str]) -> list[str]:
    """The commits a push would publish.

    Given explicit revisions, use them. Otherwise take every commit on a local
    branch that is not already on a remote-tracking branch; with no remote at
    all, that is the whole history, which is the correct answer before the
    first push.
    """
    # rev-list has no NUL output mode; its shas are newline separated.
    def lines(args: list[str]) -> list[str]:
        return [
            l.strip()
            for l in git(args).decode("utf-8", "replace").splitlines()
            if l.strip()
        ]

    require_whole_history()
    if revs:
        if any(rev.startswith("-") for rev in revs):
            raise GateBroken("a revision may not start with '-'; options would change what is scanned")
        out = lines(["rev-list", "--end-of-options", *revs])
    else:
        out = lines(["rev-list", "--branches", "--not", "--remotes"]) or lines(
            ["rev-list", "--all"]
        )
    if not out:
        raise GateBroken("no commits to scan; an empty range is not evidence of a clean one")
    return out


def parents(commit: str) -> list[str]:
    out = git(["rev-list", "--parents", "-n", "1", commit]).decode("utf-8", "replace")
    return out.split()[1:]


def commit_blobs(commit: str) -> list[tuple[str, str]]:
    """Every (path, blob sha) this commit touched, both sides of the change.

    Both sides matters: the pre-image of a deletion is the last content that
    file ever had, and that is exactly the case a working-tree scan misses.

    Merges matter for a different reason. `git diff-tree` prints nothing at
    all for a merge commit unless it is asked to compare against a parent, so
    a value invented while resolving a conflict exists on neither parent,
    appears in no diff, and sails into the published history. Round four
    demonstrated it. Each parent is therefore compared separately, and a blob
    that differs from both shows up in both comparisons.
    """
    ps = parents(commit)
    if len(ps) > 1:
        found: list[tuple[str, str]] = []
        for parent in ps:
            found.extend(_raw_pairs(["diff-tree", "-r", "-M", "--no-commit-id", "--raw", "-z", parent, commit]))
        return found
    return _raw_pairs(
        ["diff-tree", "-r", "-M", "--root", "--no-commit-id", "--raw", "-z", commit]
    )


def _raw_pairs(args: list[str]) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for src_sha, dst_sha, src_path, dst_path, _status in _raw_entries(git(args)):
        if src_sha != NULL_SHA:
            found.append((src_path, src_sha))
        if dst_sha != NULL_SHA:
            found.append((dst_path, dst_sha))
    return found


def _raw_entries(output: bytes) -> list[tuple[str, str, str, str, str]]:
    """(src sha, dst sha, src path, dst path, status) for each line of --raw -z."""
    raw = output.decode("utf-8", "surrogateescape")
    fields = [f for f in raw.split("\0") if f != ""]
    found: list[tuple[str, str, str, str, str]] = []
    i = 0
    while i < len(fields):
        meta = fields[i]
        if not meta.startswith(":"):
            i += 1
            continue
        parts = meta.split()
        if len(parts) < 5:
            i += 1
            continue
        src_sha, dst_sha, status = parts[2], parts[3], parts[4]
        renamed = status[:1] in {"R", "C"}
        paths_taken = 2 if renamed else 1
        path_fields = fields[i + 1 : i + 1 + paths_taken]
        i += 1 + paths_taken
        if not path_fields:
            continue
        found.append((src_sha, dst_sha, path_fields[0], path_fields[-1], status))
    return found


# Headers git writes itself, and the only header names a finding prints. Any
# other name is scanned with its value and printed as other-header: a name is
# the commit's own text and can hold a credential.
KNOWN_HEADERS = {"author", "committer", "mergetag", "gpgsig", "gpgsig-sha256", "encoding"}
ROLES = KNOWN_HEADERS | {"tree", "parent"}
OBJECT_ID = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
# An approval of a commit's bytes in approved-exemptions.sha256, named as
# public-content-check.mjs labels commit metadata.
COMMIT_APPROVAL = re.compile(r"commit-(?:[0-9a-f]{40}|[0-9a-f]{64})-metadata")


def as_text(data: bytes, encoding: str, commit: str) -> str:
    """The bytes as UTF-8 and, when the object declares another encoding, as
    that too, so a label never turns a message into other text. Bytes that
    are text in neither, or hold a NUL, the gate cannot read as text."""
    texts = []
    for name in dict.fromkeys(["utf-8", encoding]) if b"\0" not in data else ():
        try:
            texts.append(data.decode(name))
        except (LookupError, ValueError):
            pass
    if not texts:
        raise GateBroken(f"commit {commit[:9]} holds text that is neither UTF-8 nor its declared encoding")
    return "\n".join(dict.fromkeys(texts))


def commit_metadata(commit: str) -> list[tuple[str, str]]:
    """(role, text) for every part of the raw commit object the push
    publishes except git's leading tree and parent ids: author, committer,
    every other header, signatures included, and the message. A merged
    signed tag's notes sit in a mergetag header that no log format shows, so
    the object itself is read. Bytes approved in the exemption list are
    skipped whole, as a fixture's are."""
    raw = git(["cat-file", "commit", commit])
    if hashlib.sha256(raw).hexdigest() in load_exemptions().get(f"commit-{commit}-metadata", ()):
        return []
    head, _, body = raw.partition(b"\n\n")
    headers: list[tuple[bytes, list[bytes]]] = []
    for line in head.split(b"\n"):
        if line.startswith(b" ") and headers:
            headers[-1][1].append(line[1:])
        else:
            name, _, value = line.partition(b" ")
            headers.append((name, [value]))
    encoding = next((v[0] for n, v in headers if n == b"encoding"), b"utf-8").decode("ascii", "replace").strip()
    out, leading = [], 0
    for index, (raw_name, raw_lines) in enumerate(headers):
        name, value = as_text(raw_name, encoding, commit), as_text(b"\n".join(raw_lines), encoding, commit)
        if index == leading and name == ("parent" if index else "tree") and OBJECT_ID.fullmatch(value):
            leading += 1
            continue
        role = name if name in ROLES else "other-header"
        out.append((role, value if name in KNOWN_HEADERS else f"{name} {value}"))
    return [*out, ("message", as_text(body, encoding, commit))]


# ---------------------------------------------------------------------------
# Reporting

Violation = tuple[str, str, str, str, str]  # where, path, kind, sanitised, raw


def normalised_terms(lines: list[str]) -> list[str]:
    """Private-list terms as the literal sweep matches them. Matching is on
    normalised words, so a term is only a term once normalised. A line that
    leaves under three characters to search is refused, never dropped."""
    terms = []
    for number, line in enumerate(lines, 1):
        if line.strip() and not line.strip().startswith("#"):
            terms.append(" ".join(literal_words(line)))
            if len(terms[-1].replace(" ", "")) < 3:
                raise GateBroken(f"private list line {number} has under three characters to search (its text is withheld)")
    return terms


def withheld(path: str) -> str:
    """A path as scripts/public-content-check.mjs prints one: its UTF-8
    sha256 and its length in UTF-16 units, so both checkers name it alike."""
    digest = hashlib.sha256(path.encode("utf-8", "surrogateescape")).hexdigest()
    return f"<withheld-path {digest[:8]}/{len(path.encode('utf-16-le', 'surrogatepass')) // 2}>"


def report(violations: list[Violation], reveal: bool, scanned: str) -> int:
    """Every path is withheld like matched content, since a filename can carry
    a credential no rule knows. Commit metadata keeps its label."""
    if not violations:
        print(f"gate: clean ({scanned})")
        return 0
    print(f"gate: {len(violations)} violation(s) ({scanned})", file=sys.stderr)
    for where, path, kind, sanitised, raw in violations:
        shown_path = path if reveal else withheld(path) if path else ""
        where = ":".join(part for part in (where, shown_path) if part)
        print(f"  {where}: {kind}: {raw if reveal else sanitised}", file=sys.stderr)
    if not reveal:
        print(
            "\ngate: matched text is withheld on purpose. This output goes into\n"
            "logs and transcripts. Re-run locally with --reveal to see it.",
            file=sys.stderr,
        )
    print(
        "\ngate: this is a stop, not a nuisance. Client material must never enter\n"
        "this history. Remove it from the history, not just from the commit.",
        file=sys.stderr,
    )
    return 1


# ---------------------------------------------------------------------------
# The checks


def path_violations(paths, patterns: list[str]) -> list[Violation]:
    """Path rules. Run on every path, before any content exclusion, because a
    directory the content scan skips must not hide a denied path. paths:
    (where, rel), where naming the commit or empty."""
    out: list[Violation] = []
    for where, rel in paths:
        name = rel.rsplit("/", 1)[-1]
        for pattern in patterns:
            if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(name, pattern):
                out.append((where, rel, "denied path", pattern, pattern))
                break
    return out


def content_violations(
    items, hashes: set[str], shapes, binary_allow: list[str], exemptions: dict[str, set[str]]
) -> list[Violation]:
    """items: an iterable of (where, rel, bytes-or-None). The path is
    published too, so its words meet the same hashes and shapes."""
    out: list[Violation] = []
    for where, rel, data in items:
        for kind, value in scan_text(rel, hashes, shapes):
            out.append((where, rel, f"{kind}, in the path", fingerprint(value), value))
        approved = exemptions.get(rel)
        if approved is not None and data is not None:
            if hashlib.sha256(data).hexdigest() in approved:
                continue
            # The path is exempt and these are not the approved bytes. Say so,
            # because "the canary changed" is a thing somebody must look at,
            # not a thing to scan quietly and maybe pass.
            out.append(
                (
                    where,
                    rel,
                    "exempt path, unapproved contents",
                    "scanned like any other file; update approved-exemptions.sha256 on purpose",
                    "scanned like any other file; update approved-exemptions.sha256 on purpose",
                )
            )
        name = rel.rsplit("/", 1)[-1]
        allowed_binary = any(
            fnmatch.fnmatch(rel, p) or fnmatch.fnmatch(name, p) for p in binary_allow
        )
        if data is None:
            # The binary allowlist approves bytes it has seen as binary. It
            # never approves bytes nobody read.
            out.append(
                (
                    where,
                    rel,
                    "unreadable",
                    "the gate could not read this file",
                    "the gate could not read this file",
                )
            )
            continue
        text = decode(data)
        if text is None:
            if allowed_binary:
                continue
            out.append(
                (
                    where,
                    rel,
                    "binary or undecodable",
                    "not UTF-8 text, and not on the binary allowlist",
                    "not UTF-8 text, and not on the binary allowlist",
                )
            )
            continue
        for kind, value in scan_text(text, hashes, shapes):
            out.append((where, rel, kind, fingerprint(value), value))
    return out


# ---------------------------------------------------------------------------
# Modes


def mode_staged(hashes, shapes, patterns, binary_allow, exemptions, reveal: bool) -> int:
    """One listing of the index, blobs read by the ids it names, then the
    listing again. Anything staged in between means this scan read an index
    that is no longer there, so it certifies nothing."""
    listing = git(STAGED_LISTING)
    entries = _raw_entries(listing)
    if not entries:
        # A message-only amend, an empty commit or a merge resolved to ours
        # publishes no new blob, and pre-push scans the message. That needs
        # proof the index is HEAD's tree, not just an empty listing.
        if index_is_head():
            print("gate: clean (the index is HEAD's tree; no new blob is staged)")
            return 0
        raise GateBroken("nothing is staged; an empty index is not evidence of a clean one")
    if any(status == "U" for *_e, status in entries):
        raise GateBroken("the index has unresolved conflicts; an unmerged path is not a deletion")
    staged = [(dst_path, dst_sha) for _s, dst_sha, _p, dst_path, _st in entries if dst_sha != NULL_SHA]
    violations = path_violations([("", r) for r, _sha in staged], patterns)
    items = [("", rel, cat_blob(sha)) for rel, sha in staged]
    violations += content_violations(items, hashes, shapes, binary_allow, exemptions)
    if git(STAGED_LISTING) != listing:
        raise GateBroken("the index changed during the scan; stage again and re-run")
    return report(
        violations,
        reveal,
        f"{len(staged)} staged blob(s), {len(entries) - len(staged)} deletion(s)",
    )


def mode_range(revs, hashes, shapes, patterns, binary_allow, exemptions, reveal: bool) -> int:
    commits = outgoing_commits(revs)
    violations: list[Violation] = []
    pairs: dict[tuple[str, str], str] = {}
    for commit in commits:
        short = commit[:9]
        for path, sha in commit_blobs(commit):
            pairs.setdefault((path, sha), short)
        for role, text in commit_metadata(commit):
            for kind, value in scan_text(text, hashes, shapes):
                violations.append(
                    (f"{short} ({role})", "", kind, fingerprint(value), value)
                )
    violations += path_violations(
        [(where, path) for (path, _sha), where in pairs.items()], patterns
    )
    items = [
        (where, path, cat_blob(sha))
        for (path, sha), where in pairs.items()
    ]
    violations += content_violations(items, hashes, shapes, binary_allow, exemptions)
    return report(violations, reveal, f"{len(pairs)} blob(s) in {len(commits)} outgoing commit(s)")


def mode_tracked(hashes, shapes, patterns, binary_allow, exemptions, reveal: bool) -> int:
    rels = tracked_files()
    if not rels:
        raise GateBroken("no tracked files; an empty sweep is not evidence of a clean one")
    violations = path_violations([("", r) for r in rels], patterns)
    items = [("", rel, read_path(REPO / rel)) for rel in rels]
    violations += content_violations(items, hashes, shapes, binary_allow, exemptions)
    return report(violations, reveal, f"{len(rels)} tracked file(s)")


def mode_path(target: Path, hashes, shapes, patterns, binary_allow, exemptions, reveal: bool) -> int:
    """Paths are reported and scanned relative to the target, so the folder
    the target sits in is never itself a finding."""
    if not os.path.lexists(target):
        die("no such path (the path is withheld)")
    # A link given as the root is a blob holding its target path, like any
    # link below it: read, never followed.
    single = target.is_symlink() or target.is_file()
    found: list[Path] = []
    if single:
        found = [target]
    else:
        for dirpath, dirnames, filenames in os.walk(target):
            # A link to a directory is a blob holding its target path, as git
            # would store it. os.walk lists it with the directories; read it.
            links = [d for d in dirnames if (Path(dirpath) / d).is_symlink()]
            dirnames[:] = [
                d for d in dirnames if d not in {".git", "node_modules", "dist"} and d not in links
            ]
            found.extend(Path(dirpath) / n for n in [*filenames, *links])
    if not found:
        raise GateBroken("no files under the path; an empty sweep is not evidence of a clean one")
    base = target.parent if single else target
    rels = [os.path.relpath(p, base) for p in found]
    violations = path_violations([("", r) for r in rels], patterns)
    items = [("", rel, read_path(path)) for path, rel in zip(found, rels)]
    violations += content_violations(items, hashes, shapes, binary_allow, exemptions)
    return report(violations, reveal, f"{len(found)} file(s) under the path")


def mode_self_test(hashes, shapes, exemptions) -> int:
    """The gate proving itself, before any sweep result is believed.

    Three assertions, as the contamination audit set them out: the canary
    matches, every shape rule fires, and a missing private list is exit 2
    rather than a clean pass.
    """
    failures: list[str] = []

    if not CANARY_FILE.is_file():
        failures.append(f"the canary is missing at {CANARY_FILE.relative_to(REPO)}")
    else:
        text = CANARY_FILE.read_text(encoding="utf-8")
        terms = [v for k, v in scan_text(text, hashes, []) if k == "denied term"]
        if not terms:
            failures.append("the canary was not flagged; the hashed matcher is broken")
        else:
            widest = max(len(t.split()) for t in terms)
            print(f"gate: canary flagged on {len(terms)} phrase(s), widest {widest} word(s)")
            if widest < 4:
                failures.append(
                    f"the widest matched phrase is {widest} words; a four word entry "
                    "on the denylist could never match"
                )

    if not SHAPE_CANARY_FILE.is_file():
        failures.append(f"the shape canary is missing at {SHAPE_CANARY_FILE.relative_to(REPO)}")
    else:
        text = SHAPE_CANARY_FILE.read_text(encoding="utf-8")
        fired = {
            category
            for category, pattern, _d in shapes
            for _m in [pattern.search(text)]
            if _m
        }
        missed = [
            description
            for category, pattern, description in shapes
            if not pattern.search(text)
        ]
        print(
            f"gate: {len(shapes) - len(missed)} of {len(shapes)} shape rule(s) fired, "
            f"categories {sorted(fired)}"
        )
        for description in missed:
            failures.append(f"a shape rule never fired: {description}")

    # The exemption list must describe the fixtures as they are now. A stale
    # line means the gate is scanning a fixture it should skip, or skipping
    # bytes nobody approved.
    for rel, digests in sorted(exemptions.items()):
        path = REPO / rel
        if COMMIT_APPROVAL.fullmatch(rel):
            continue  # a commit's bytes, checked when that commit is scanned
        if not path.is_file():
            failures.append(f"an exempt path does not exist: {withheld(rel)}")
            continue
        current = hashlib.sha256(path.read_bytes()).hexdigest()
        if current not in digests:
            failures.append(
                f"{withheld(rel)} is not in approved-exemptions.sha256 as it stands now.\n"
                f"    Its digest is {current}. Add that line on purpose, or find out\n"
                "    why the file changed."
            )
    print(f"gate: {len(exemptions)} exempt path(s), all matching an approved digest")

    # The real literal branch, not a stand-in for it. Its message about the
    # missing list is expected here, so it is kept off the terminal.
    absent = "/nonexistent/gate-terms-that-are-not-there.txt"
    with contextlib.redirect_stderr(io.StringIO()):
        code = mode_literal([], [], False, absent)
    print(f"gate: a missing private list exits {code}")
    if code != 2:
        failures.append(f"a missing private list exited {code}, not 2")

    if failures:
        print("gate: SELF-TEST FAILED", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        print(
            "\ngate: no sweep result can be trusted while this fails. A blind gate\n"
            "that has stopped working looks exactly like a clean repository.",
            file=sys.stderr,
        )
        return 1
    print("gate: self-test passed")
    return 0


def mode_literal(revs, patterns: list[str], reveal: bool, location) -> int:
    """The maintainer-only clear-text sweep. Second layer, not the only one.

    It needs the private list and refuses to pretend when it is absent. It
    reads what a push publishes: blobs, paths, commit headers and messages.
    """
    listfile = Path(location) if location else None
    if listfile is None or not listfile.is_file():
        print(
            "gate: no readable private clear-text list was supplied.\n"
            f"gate: set {LITERAL_LIST_ENV} to its path, or run this on a maintainer\n"
            "gate: machine. Exiting 2: the literal sweep did not run.",
            file=sys.stderr,
        )
        return 2
    terms = [
        *normalised_terms(listfile.read_text(encoding="utf-8").splitlines())
    ]
    # A list of punctuation has nothing to search for.
    if not terms:
        die("the clear-text list has no searchable term")

    def found_in(text: str) -> list[str]:
        haystack = " ".join(literal_words(text))
        return [t for t in terms if t in haystack]

    commits = outgoing_commits(revs)
    pairs: dict[tuple[str, str], str] = {}
    violations: list[Violation] = []
    for commit in commits:
        for path, sha in commit_blobs(commit):
            pairs.setdefault((path, sha), commit[:9])
        for role, text in commit_metadata(commit):
            for term in found_in(text):
                violations.append(
                    (f"{commit[:9]} ({role})", "", "denied term, literal", fingerprint(term), term)
                )
    violations += path_violations(
        [(where, path) for (path, _s), where in pairs.items()], patterns
    )
    for (path, sha), where in pairs.items():
        for term in found_in(path):
            violations.append(
                (where, path, "denied term, literal, in the path", fingerprint(term), term)
            )
        data = cat_blob(sha)
        text = decode(data) if data is not None else None
        if text is None:
            violations.append(
                (where, path, "unreadable", "not readable as text", "not readable as text")
            )
            continue
        for term in found_in(text):
            violations.append(
                (where, path, "denied term, literal", fingerprint(term), term)
            )
    return report(
        violations,
        reveal,
        f"literal, {len(pairs)} blob(s) in {len(commits)} outgoing commit(s), {len(terms)} term(s)",
    )


# ---------------------------------------------------------------------------


class Parser(argparse.ArgumentParser):
    """Argparse exits 2 on a usage error, and 2 already means "the private
    list is absent" here. A hook reading exit codes must not confuse the two,
    so a bad argument exits 3 with the rest of the gate's own breakage."""

    def error(self, message: str) -> None:  # type: ignore[override]
        die(f"bad arguments: {message}")


def in_ci() -> bool:
    return any(
        os.environ.get(name, "").strip().lower() not in {"", "0", "false"}
        for name in ("CI", "GITHUB_ACTIONS")
    )


def main() -> int:
    parser = Parser(description="The contamination gate.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--self-test", action="store_true", help="prove the gate works")
    group.add_argument("--staged", action="store_true", help="read the staged blobs")
    group.add_argument("--range", action="store_true", help="read the outgoing commits")
    group.add_argument("--literal", action="store_true", help="maintainer clear-text sweep")
    group.add_argument("--path", type=Path, help="sweep one path anywhere on disk")
    parser.add_argument(
        "--reveal",
        action="store_true",
        help="print the matched text. Local use only; never in continuous integration.",
    )
    parser.add_argument("revs", nargs="*", help="revisions for --range")
    args = parser.parse_args()
    if args.reveal and in_ci():
        die("--reveal prints matched text and is refused in continuous integration")

    try:
        patterns = load_globs(PATH_DENYLIST, "path denylist", required=True)
        binary_allow = load_globs(BINARY_ALLOWLIST, "binary allowlist")
        hashes = load_hashes()
        shapes = load_shape_rules()
        exemptions = load_exemptions()

        if args.literal:
            return mode_literal(
                args.revs, patterns, args.reveal, os.environ.get(LITERAL_LIST_ENV)
            )
        if args.self_test:
            return mode_self_test(hashes, shapes, exemptions)
        if args.staged:
            return mode_staged(hashes, shapes, patterns, binary_allow, exemptions, args.reveal)
        if args.range:
            return mode_range(args.revs, hashes, shapes, patterns, binary_allow, exemptions, args.reveal)
        if args.path is not None:
            return mode_path(args.path, hashes, shapes, patterns, binary_allow, exemptions, args.reveal)
        return mode_tracked(hashes, shapes, patterns, binary_allow, exemptions, args.reveal)
    except GateBroken as exc:
        die(str(exc))
        return 3


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # a traceback would print this checkout's path
        die(f"internal error ({type(exc).__name__}); details withheld")
