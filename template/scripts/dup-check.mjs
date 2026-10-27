// SPDX-License-Identifier: AGPL-3.0-only
// Copied code is refused, not discouraged.
//
// A rule in prose is followed most of the time. This is the same rule as a
// step that fails, so the second copy of a block never reaches `main`.
//
// Two refusals, both about names and shapes rather than meaning:
//
//   1. Twelve consecutive lines of code that appear in two files, or twice in
//      one. Twelve is long enough that an import block, a switch over exit
//      codes or a run of assertions does not reach it, and short enough that a
//      function lifted from a neighbour does.
//   2. Two code files in one directory under scripts/ whose names differ only
//      by extension. `foo.mjs` beside `foo.ts` is the same script twice and
//      the next reader runs the wrong one; `foo.mjs` beside `foo-check.mjs` is
//      two scripts, and `foo.mjs` beside `foo.json`, `foo.md` or `foo.yml` is
//      a script and the data it reads. The last two are allowed.
//
// Both rules read the same files the dependency gate reads: the same tree,
// from scripts/tree-files.mjs, and the same extensions, CODE below, so a copy
// cannot hide in a directory or an extension one gate looks at and the other
// does not.
//
// What it compares is a normalised file: comments and blank lines gone, runs
// of whitespace collapsed. So reindenting a copy, or writing it a new comment,
// does not hide it. A line ends where JavaScript ends one: at LF, CR, CRLF,
// U+2028 or U+2029, the last two text only inside a '' or "" string (Sol's
// review of 04a1860). Block comments go wherever they sit, `/* a */ code();`
// keeping the code, and quotes are tracked so `'src/**/*.ts'` stays a string.
// Line comments go only when they are the whole line; a trailing `//` comment
// stays in the line and simply makes that window unique, which errs towards
// letting a copy through rather than refusing an original. Regular
// expressions are followed too, so `/[/*]/` opens no comment. This gate does
// not parse, so it tells one from a division by the token before the `/`,
// past whitespace and comments, as a tokeniser does, on a closed list (see
// opensRegex). Any other token, or a line break after one that may end a
// statement, cannot tell: there it reads a division and no comment opens on
// the rest of that line. Either reading lexes that line alike unless a
// regular expression would close on it and a quote or brace follows; then a
// wrong one can drop the code after it (the security reviews of 3e550d6,
// 64400f0 and 4094bb8, and Sol's review of f555b81), so the file is refused.
// So is a `/*` on that line unless it closes there with no quote, brace or
// `/` inside: its body, read as code, can carry onto later lines, which the
// line's own check never reads (the security review of 711c4d2).
//
// scripts/dup-baseline.json carries the hits that were already here when the
// gate was written, so it fails on new duplication only. It records each one
// as it was: a block by its hash and the locations it was found at, a stem as
// the pair of files the rule refused. A third copy, a third extension or a new
// extension replacing one of the pair is new duplication. It is meant to stay
// short and to shrink. Adding to it is a decision, not a fix.
//
// Usage:
//   node scripts/dup-check.mjs [repository-root]

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { exitWith, isMainModule, readJson, refuse } from './main-module.mjs';
import { treeFiles } from './tree-files.mjs';

// Long enough that the shapes every file shares do not reach it. See above.
export const WINDOW = 12;

// Every extension a person writes code in here. scripts/deps-check.mjs reads
// this same set, so the two gates never disagree about what a source file is.
export const CODE = new Set([
  '.mjs',
  '.js',
  '.cjs',
  '.mts',
  '.cts',
  '.ts',
  '.tsx',
  '.jsx',
  '.sh',
  '.py',
  '.yml',
  '.yaml',
]);

// The subset that is a script: what the same-stem rule reads, and what
// scripts/inventory.mjs lists, imported from here so the two cannot drift. That
// rule asks whether one name means two scripts, and a script beside its own
// data is not that: `runner.mjs` and `runner.json` are a reader and what it
// reads, and neither is ambiguous.
export const SCRIPT = new Set(
  [...CODE].filter((extension) => !['.yml', '.yaml'].includes(extension)),
);

// The languages whose comments start with `#` rather than `//`, which is what
// normalise strips a line on.
const HASH_COMMENT = new Set(['.sh', '.py', '.yml', '.yaml']);

/** The subset of `paths` whose contents this gate compares block by block. */
export const codeFiles = (paths) => paths.filter((path) => CODE.has(extname(path)));

// CR and CRLF end a line wherever they sit, since neither may stand in a
// string, so they become LF before anything is read. The separators end one
// too, except inside a '' or "" string, so withoutBlocks reads them as LF and
// keeps such a string open across them.
const lf = (text) => text.replaceAll(/\r\n?/gu, '\n');
const SEPARATOR = /[\u{2028}\u{2029}]/gu;

/**
 * The lines of `text` that carry code, each with the line number it came from.
 *
 * Comments and blank lines are dropped and runs of whitespace become one
 * space, so the same block reindented or recommented normalises the same way.
 */
export function normalise(text, path) {
  const hashComment = HASH_COMMENT.has(extname(path));
  const plain = lf(text);
  const lines = [];
  for (const [index, raw] of (hashComment ? plain : withoutBlocks(plain)).split('\n').entries()) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (hashComment ? trimmed.startsWith('#') : trimmed.startsWith('//')) continue;
    lines.push({ line: index + 1, code: trimmed.replaceAll(/\s+/gu, ' ') });
  }
  return lines;
}

/**
 * `plain`, its CRs already LF, with every `/* ... *\/` span removed and its
 * line breaks kept as LF, so the code after a span stays on its own line. Quotes and regular
 * expressions are followed, so a marker inside one is left alone, and so is the
 * rest of a `//` line. A template's `${...}` is code, read until the brace that
 * closes it, so a comment there goes like any other. `found.unread` is where
 * the first `/` only a parser could read sits, or a `/*` after one whose body
 * could carry past its line, if one does.
 */
function withoutBlocks(plain, found = {}) {
  const text = plain.replaceAll(SEPARATOR, '\n');
  const scanned = new Uint8Array(text.length);
  const written = writer();
  const emit = written.emit;
  const lineBefore = breaks(text);
  let quote;
  let unsure = -1;
  let shut = -1;
  let depth = 0;
  const quoteOrBrace = quoteOrBraceAfter(text, lineBefore);
  const templates = [];
  for (let at = 0; at < text.length; at += 1) {
    const c = text[at];
    if (quote !== undefined) {
      if (c === '\\') emit(c + (text[(at += 1)] ?? ''));
      else if (quote === '`' && text.startsWith('${', at)) {
        emit('${');
        at += 1;
        quote = undefined;
        templates.push(depth);
      } else {
        if (c === quote || (plain[at] === '\n' && quote !== '`')) quote = undefined;
        emit(c);
      }
    } else if (text.startsWith('/*', at) && unsure <= lineBefore(at)) {
      const end = text.indexOf('*/', at + 2);
      const span = text.slice(at, end === -1 ? text.length : end + 2);
      emit(`${span.replaceAll(/[^\n]/gu, '')} `);
      at += span.length - 1;
    } else if (text.startsWith('//', at)) {
      const end = text.indexOf('\n', at);
      written.out += text.slice(at, end === -1 ? text.length : end);
      at = (end === -1 ? text.length : end) - 1;
    } else if (c === '/' && !text.startsWith('/*', at)) {
      const regex = opensRegex(written.tail);
      const span = regex === false ? c : regexAt(text, at, scanned);
      if (regex === undefined && span !== c && quoteOrBrace(at)) found.unread ??= at;
      const read = regex === undefined ? c : span;
      if (regex !== false && read === c) unsure = at;
      emit(read);
      at += read.length - 1;
    } else {
      if (c === '/' && at + 2 > shut && found.unread === undefined) {
        shut = closesBare(text, at);
        if (shut === -1) found.unread = at;
      }
      if (c === '}' && templates.at(-1) === depth) {
        templates.pop();
        quote = '`';
      } else if (c === "'" || c === '"' || c === '`') quote = c;
      else depth += Number(c === '{') - Number(c === '}');
      emit(c);
    }
  }
  return written.out;
}

/**
 * Where the `*\/` closing the `/*` at `at` sits, or -1 if a line break, quote,
 * brace or `/` comes first: read as code, any of those can carry past it.
 */
function closesBare(text, at) {
  for (let end = at + 2; end < text.length; end += 1)
    if (text.startsWith('*/', end)) return end;
    else if ('\n\'"`{}/'.includes(text[end])) return -1;
  return -1;
}

/**
 * What withoutBlocks writes, and apart from it the last 64 characters of code,
 * which is all opensRegex reads: no line comment, a whitespace run as one line
 * break if it holds one and one space if not, so padding or a comment cannot
 * push the token before a `/` out of it (Sol's review of 03b8239), nor hide a
 * line break (Sol's review of f555b81). Block comments are already whitespace
 * when written.
 */
function writer() {
  const written = { out: '', tail: '' };
  written.emit = (piece) => {
    written.out += piece;
    written.tail = (written.tail + piece)
      .replaceAll(/\s+/gu, (run) => (run.includes('\n') ? '\n' : ' '))
      .slice(-64);
  };
  return written;
}

/**
 * Whether a quote or brace follows `at` on its line, read once a line: a later
 * `/` on that line has less after it.
 */
function quoteOrBraceAfter(text, lineBefore) {
  let read = -2;
  return (at) => {
    if (read === lineBefore(at)) return false;
    read = lineBefore(at);
    const end = text.indexOf('\n', at);
    return /["'`{}]/u.test(text.slice(at, end === -1 ? text.length : end));
  };
}

/**
 * The last line break in `text` before `at`, for a caller whose `at` only
 * grows, so each character is read once: looking back from each `/*` for its
 * line's start took seconds on one long line.
 */
function breaks(text) {
  let last = -1;
  let read = 0;
  return (at) => {
    for (; read < at; read += 1) if (text[read] === '\n') last = read;
    return last;
  };
}

// The keywords after which a `/` on the same line starts a regular expression.
const BEFORE_REGEX = new Set(
  'case delete do else in instanceof new return throw typeof void'.split(' '),
);

// Every other keyword, after which a `/` is undecided: `of`, `await` and
// `yield` may be names, and `break` or `continue` end a statement where a line
// break follows. `this`, `null`, `true` and `false` are not here: they end an
// expression, so they read as names do.
const KEYWORDS = new Set([
  ...'await break catch class const continue debugger default enum export extends'.split(' '),
  ...'finally for function if import let of static super switch try var while with'.split(' '),
  'yield',
]);

/**
 * Whether a `/` after `before` opens a regular expression, by a closed rule:
 * true after start of file, `=>`, one of `( , = : [ & | ? { ; + - * % < ~ ^`
 * or a `!` that follows one of them, or a word in BEFORE_REGEX on its line;
 * false after a name that is no keyword (any word after a `.` that ends no
 * spread), `this`, `null`, `true`, `false`, a number, a string or `]` on its
 * line; undefined, which only a parser could decide, after anything else: `)`,
 * `}`, `>`, `++`, `--`, `/`, a `!` after an expression, another keyword, or a
 * line break after a token not in the first list.
 */
function opensRegex(before) {
  const broken = /\n\s*$/u.test(before);
  const last = before.trimEnd();
  const word = /((?<!\.)\.)?\s*([\p{ID_Continue}$]+)$/u.exec(last);
  const keyword = word?.[1] === undefined ? word?.[2] : undefined;
  if (KEYWORDS.has(keyword)) return undefined;
  if (BEFORE_REGEX.has(keyword)) return !broken || undefined;
  if (word !== null || /[\]'"`]$/u.test(last)) return broken ? undefined : false;
  if (last.endsWith('!')) return opensRegex(last.slice(0, -1)) || undefined;
  return last === '' || /(?:=>|[^+-][+-]|^[+-]|[(,=:[&|?{;*%<~^])$/u.test(last) || undefined;
}

/**
 * The regular expression literal opening at `text[at]`, or the lone `/` when
 * none closes on its line.
 *
 * `scanned` marks each position a scan has passed, inside a class or not. The
 * scan from there on is the same whoever reaches it, and a scan that closed is
 * consumed whole, so a marked position is one that reached the end of its line:
 * the scan stops there, and a line of unclosed `/` is read once, not once per
 * `/`, which took seconds on one long line. An undecidable `/` reads as a
 * division and leaves its closed scan unconsumed: its line then lexes the same
 * either way, or the file is refused (see the header).
 */
function regexAt(text, at, scanned) {
  let inClass = false;
  for (let end = at + 1; end < text.length && text[end] !== '\n'; end += 1) {
    const state = inClass ? 2 : 1;
    if (scanned[end] & state) break;
    scanned[end] |= state;
    const c = text[end];
    if (c === '\\' && text[end + 1] !== '\n') end += 1;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return text.slice(at, end + 1);
  }
  return '/';
}

/** A short, stable name for a block of normalised lines. */
const hash = (codes) => createHash('sha256').update(codes.join('\n')).digest('hex').slice(0, 16);

/**
 * Every window of `size` normalised lines in `files`, as hash -> locations.
 *
 * `files` is `{ path, text }`. A location is `path:line`, the line the window
 * starts on in the file as written, not in its normalised form, because that
 * is the line a person opens.
 */
export function windows(files, size = WINDOW) {
  const found = new Map();
  for (const { path, text } of files) {
    const lines = normalise(text, path);
    for (let start = 0; start + size <= lines.length; start += 1) {
      const block = lines.slice(start, start + size);
      const key = hash(block.map((entry) => entry.code));
      found.set(key, [...(found.get(key) ?? []), `${path}:${block[0].line}`]);
    }
  }
  return found;
}

/** A file's name with its extension removed, and the directory it sits in. */
const stemOf = (path) => `${dirname(path)}/${basename(path, extname(path))}`;

/**
 * Directories under scripts/ holding two code files whose names differ only by
 * extension, as stem -> the paths sharing it.
 *
 * Code only: a script beside its own `.json`, `.md` or `.yml` is a script and
 * its data, which is one script under one name.
 */
export function stems(paths) {
  const byStem = new Map();
  const scripts = paths.filter(
    (candidate) => candidate.startsWith('scripts/') && SCRIPT.has(extname(candidate)),
  );
  for (const path of scripts) byStem.set(stemOf(path), [...(byStem.get(stemOf(path)) ?? []), path]);
  return new Map([...byStem].filter(([, sharing]) => sharing.length > 1));
}

/** A location's file: line numbers move when the file above a copy is edited. */
const fileOf = (location) => location.replace(/:\d+$/u, '');

/** The locations in `found` that `recorded` does not cover, one record covering one copy. */
function unrecorded(found, recorded) {
  const left = [...found];
  for (const entry of recorded) {
    const at = left.findIndex((candidate) => fileOf(candidate) === fileOf(entry));
    if (at !== -1) left.splice(at, 1);
  }
  return left;
}

/**
 * Every duplication in `files` and `paths` that `baseline` does not already
 * record, one line each.
 *
 * `baseline` is the parsed scripts/dup-baseline.json: `windows` as hash -> the
 * locations recorded for it, and `stems` as a list of the sets of files the
 * stem rule refused. A location the baseline does not record, or a set of
 * files sharing a stem that it does not record exactly, is new.
 */
export function dupFindings({
  files,
  paths,
  baseline = { windows: {}, stems: [] },
  size = WINDOW,
}) {
  const findings = [];
  for (const { path, text } of files) {
    const found = {};
    if (!HASH_COMMENT.has(extname(path))) withoutBlocks(lf(text), found);
    if (found.unread !== undefined)
      findings.push(
        `${path}:${lf(text).slice(0, found.unread).replaceAll(SEPARATOR, '\n').split('\n').length} has a / only a parser could read, so where its code ends is a guess. Rewrite that line`,
      );
  }

  for (const [key, locations] of windows(files, size)) {
    if (locations.length < 2) continue;
    const added = unrecorded(locations, baseline.windows[key] ?? []);
    if (added.length === 0) continue;
    const first = locations.find((location) => !added.includes(location)) ?? added.shift();
    findings.push(`${first} repeats at ${added.join(', ')} (${size} lines)`);
  }

  const recorded = new Set(baseline.stems.map((sharing) => sharing.toSorted().join('\n')));
  for (const sharing of stems(paths).values())
    if (!recorded.has(sharing.toSorted().join('\n')))
      findings.push(
        `${sharing.join(' and ')} differ only by extension, so one name means two files`,
      );

  return findings.toSorted();
}

const isStrings = (value) =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * scripts/dup-baseline.json, parsed and held to its shape: `windows` an object
 * of hash -> locations, `stems` a list of sets of two or more files, an
 * optional `note`, and nothing else. A baseline of any other shape, or one
 * that names a key twice, exempts nothing anybody meant, so it is refused
 * rather than read as empty.
 */
export function parseBaseline(text) {
  const baseline = readJson(text);
  const valid =
    Object.keys(baseline).every((key) => ['note', 'windows', 'stems'].includes(key)) &&
    (baseline.note === undefined || typeof baseline.note === 'string') &&
    isObject(baseline.windows) &&
    Object.values(baseline.windows).every((locations) => isStrings(locations)) &&
    Array.isArray(baseline.stems) &&
    baseline.stems.every((sharing) => isStrings(sharing) && sharing.length > 1);
  if (!valid)
    throw new Error('is not { note?, windows: { hash: [location] }, stems: [[path, path]] }');
  return baseline;
}

if (isMainModule(import.meta.url)) {
  const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..'));
  const paths = treeFiles(root);
  const files = codeFiles(paths).map((path) => ({
    path,
    text: readFileSync(resolve(root, path), 'utf8'),
  }));
  let baseline;
  try {
    baseline = parseBaseline(readFileSync(resolve(root, 'scripts/dup-baseline.json'), 'utf8'));
  } catch {
    refuse('dup', 'scripts/dup-baseline.json', 'is missing, not JSON or not the recorded shape');
  }
  if (files.length === 0) {
    exitWith(1, `dup: no code files to compare under ${root}, so there is nothing to pass.`);
  }

  const findings = dupFindings({ files, paths, baseline });
  console.log(
    `dup: ${files.length} code file(s), ${Object.keys(baseline.windows).length} baselined ` +
      `block(s), ${baseline.stems.length} baselined stem(s)`,
  );
  for (const finding of findings) console.error(`dup: ${finding}`);
  if (findings.length > 0) {
    console.error('dup: copied code. Extract it, or record the hit in scripts/dup-baseline.json.');
    process.exitCode = 1;
  } else console.log('dup: no new duplication.');
}
