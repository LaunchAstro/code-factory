// SPDX-License-Identifier: AGPL-3.0-only
// The one reader for the YAML the pin and dependency checks read.
//
// pins-check runs in the contamination gate, before anything is installed, so
// it has no YAML parser, and deps-check reads the same workflows. Each kept a
// hand reader of its own, and the two disagreed: one refused a quoted `run`
// key that the other skipped, so a dependency only that step ran was
// misreported (Sol CF-06-FIX3, criterion 6). Both now read workflows, settings
// files and pnpm-lock.yaml here, and cannot disagree.
//
// The owner's ruling ORCH73 74YAML put job-timeout-check on the `yaml`
// package; this reader stays because pins-check runs before any package is
// installed, so it may not depend on one.
//
// It reads a closed subset of YAML exactly, and refuses everything else with
// the line and a fixed reason, never the text:
//
//   - block mappings and block sequences, indented with spaces, each nested
//     level deeper than the key that opens it (a sequence may sit at its
//     key's indent), at most 100 levels, each key once in its mapping; a
//     level is a mapping or a sequence, never both, and a list item's
//     mapping and a flow value are levels too;
//   - plain keys;
//   - values on the key's line: plain, single-quoted, double-quoted without
//     an escape, a flow sequence of those that closes on its line, or `{}`;
//   - literal block scalars (`run: |`), whose lines are text and never keys;
//   - comments, and one `---` before the first key.
//
// pnpm's shape adds what pnpm writes: single-quoted keys, one-level flow
// mappings (`resolution: {integrity: ...}`) and several documents.
//
// Refused: a tab or any space but a plain one; a control character YAML
// forbids; a folded block scalar; an anchor, an alias, a tag or a `?` key; an
// escape; a quoted key outside pnpm's shape; a flow collection that nests or
// does not close on its line; a line indented under nothing.
//
// A value is a Map, an array, a string or null. Scalars stay strings.

/** A refusal: the 1-based line (none for the file as a whole) and a fixed reason. */
export class YamlRefusal extends Error {
  constructor(line, reason) {
    super(reason);
    Object.assign(this, { line, reason });
  }

  /** `file:line: reason`, or `file: reason` when no line is to blame. */
  at(file) {
    return `${file}:${this.line === undefined ? '' : `${this.line}:`} ${this.reason}`;
  }
}

const UNREAD = 'this check cannot read';
const DEEPEST = 100;
const TWICE = 'names a key its mapping already has, which YAML does not allow.';
const DEEP = `nests deeper than ${DEEPEST} levels, which ${UNREAD}.`;
const PLAIN = /^[^\s'"{}[\],#&*!|>%@`?:-]/u;
const KEY = /^(?:'((?:[^']|'')*)'|([^\s'"{}[\],#&*!|>%@`?:-]\S*?)):(?: +(.*))?$/u;
const QUOTED = /^(?:'(?:[^']|'')*'|"[^"\\]*")/u;
// The line each mapping's keys were written on.
const LINES = new WeakMap();

/** A scalar with no comment, its quotes off, or undefined when it is not one this reads. */
function scalar(written) {
  if (QUOTED.exec(written)?.[0] === written)
    return written[0] === "'" ? written.slice(1, -1).replaceAll("''", "'") : written.slice(1, -1);
  return PLAIN.test(written) && !/:(?: |$)| #/u.test(written) ? written : undefined;
}

/** A key as written, or undefined when this shape does not resolve it. */
function keyOf(entry, pnpm) {
  if (entry[1] === undefined) return entry[2];
  return pnpm ? entry[1].replaceAll("''", "'") : undefined;
}

/** A flow sequence, or in pnpm's shape a flow mapping, of scalars on one line. */
function flow(written, pnpm, fail) {
  const close = written[0] === '{' ? '}' : ']';
  const items = [''];
  let quote = '';
  let at = 1;
  for (; at < written.length; at += 1) {
    const char = written[at];
    if (quote !== '') quote = char === quote ? '' : quote;
    else if (char === "'" || char === '"') quote = char;
    else if (char === close) break;
    else if ('{}[]'.includes(char)) fail(`nests or crosses a flow collection, which ${UNREAD}.`);
    else if (char === ',') {
      items.push('');
      continue;
    }
    items[items.length - 1] += char;
  }
  if (at >= written.length || !/^(?: +#.*)?$/u.test(written.slice(at + 1)))
    fail(`has a flow collection that does not close on its line, which ${UNREAD}.`);
  const parts =
    items.length === 1 && items[0].trim() === '' ? [] : items.map((item) => item.trim());
  if (close === '}' && !pnpm && parts.length > 0)
    fail(`has a flow mapping, which ${UNREAD}. Write a block mapping.`);
  const read = (part) => scalar(part) ?? fail(`${UNREAD} this flow item.`);
  if (close === ']') return parts.map(read);
  const map = new Map();
  for (const part of parts) {
    const entry = KEY.exec(part);
    if (entry === null || entry[3] === undefined) fail(`${UNREAD} this flow entry.`);
    const key = keyOf(entry, pnpm);
    if (map.has(key)) fail(TWICE);
    map.set(key, read(entry[3]));
  }
  return map;
}

/** One value written on its key's or its item's line, `depth` levels down. */
function value(written, pnpm, fail, depth) {
  if (/^[[{]/u.test(written)) return depth < DEEPEST ? flow(written, pnpm, fail) : fail(DEEP);
  const comment = written.indexOf(' #');
  const text =
    QUOTED.exec(written)?.[0] ?? (comment < 0 ? written : written.slice(0, comment).trimEnd());
  if (!/^(?: +#.*)?$/u.test(written.slice(text.length))) fail(`${UNREAD} this value.`);
  return scalar(text) ?? fail(`${UNREAD} this value.`);
}

/** A literal block scalar's text from its lines, numbered from `first`. */
function literal({ lines, first, chomp }) {
  const content = lines.find((line) => line.trim() !== '');
  const width = content === undefined ? 0 : content.length - content.trimStart().length;
  const text = lines.map((line, index) => {
    if (line.trim() !== '' && line.length - line.trimStart().length < width)
      throw new YamlRefusal(first + index, `${UNREAD} a block scalar that ends here.`);
    return line.slice(width);
  });
  let end = text.length;
  while (end > 0 && text[end - 1] === '') end -= 1;
  const body = text.slice(0, end).join('\n');
  if (chomp === '-' || end === 0) return body;
  return `${body}\n${chomp === '+' ? '\n'.repeat(text.length - end) : ''}`;
}

/**
 * `text` as its documents, each a Map, an array or null. One document unless
 * `pnpm`, which also reads the shape pnpm-lock.yaml is written in. Throws
 * YamlRefusal on anything outside the subset.
 */
export function readYaml(text, { pnpm = false } = {}) {
  const documents = [];
  let frames;
  let open;
  let block;
  let [marked, content] = [false, false];
  const begin = () => {
    documents.push(null);
    frames = [];
    open = { indent: -1, set: (node) => (documents[documents.length - 1] = node) };
    content = false;
  };
  begin();
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  for (const [index, raw] of lines.entries()) {
    const number = index + 1;
    const fail = (reason) => {
      throw new YamlRefusal(number, reason);
    };
    const enter = (frame) => {
      if (frames.push(frame) > DEEPEST) fail(DEEP);
    };
    if (/[^\S ]/u.test(raw))
      fail(`has a tab or a space that is not a plain one, which ${UNREAD}. Indent with spaces.`);
    if (/[\p{Cc}\uFFFE\uFFFF]/u.test(raw))
      fail(`has a control character YAML does not allow, which ${UNREAD}.`);
    const indent = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (block !== undefined) {
      if (body === '' || indent > block.indent) {
        block.lines.push(raw);
        continue;
      }
      block.done(literal(block));
      block = undefined;
    }
    if (body === '' || body.startsWith('#')) continue;
    if (raw === '---') {
      if (content || marked) {
        if (!pnpm) fail(`starts a second document, which ${UNREAD}.`);
        begin();
      }
      marked = true;
      continue;
    }
    content = true;
    const item = body === '-' || body.startsWith('- ');
    // A list may sit at its key's indent; the next key at that indent ends it.
    const level = open?.indent === indent && item;
    if (open !== undefined && (indent > open.indent || level)) {
      const node = item ? [] : new Map();
      open.set(node);
      enter({ indent, node, level });
    } else {
      while (frames.at(-1)?.indent > indent) frames.pop();
      if (!item && frames.at(-1)?.level) frames.pop();
      if (frames.at(-1)?.indent !== indent) fail(`is indented under nothing, which ${UNREAD}.`);
    }
    open = undefined;
    let { node, indent: column } = frames.at(-1);
    let rest = body;
    if (item) {
      if (!Array.isArray(node)) fail('puts a list item among keys, which YAML does not allow.');
      rest = body.slice(1).trimStart();
      if (!KEY.test(rest)) {
        node.push(value(rest, pnpm, fail, frames.length));
        continue;
      }
      column = indent + body.length - rest.length;
      node.push((node = new Map()));
      enter({ indent: column, node });
    } else if (Array.isArray(node)) fail('puts a key among list items, which YAML does not allow.');
    const entry = KEY.exec(rest) ?? fail(`${UNREAD} a key written this way. Write it plainly.`);
    const key = keyOf(entry, pnpm) ?? fail(`${UNREAD} a key written this way. Write it plainly.`);
    const map = node;
    if (map.has(key)) fail(TWICE);
    if (!LINES.has(map)) LINES.set(map, new Map());
    LINES.get(map).set(key, number);
    const written = entry[3] ?? '';
    const chomp = /^\|([+-]?)(?: +#.*)?$/u.exec(written);
    if (written === '' || written.startsWith('#')) {
      map.set(key, null);
      open = { indent: column, set: (child) => map.set(key, child) };
    } else if (chomp !== null) {
      map.set(key, '');
      const done = (scalarText) => map.set(key, scalarText);
      block = { indent: column, first: number + 1, chomp: chomp[1], lines: [], done };
    } else map.set(key, value(written, pnpm, fail, frames.length));
  }
  if (block !== undefined) block.done(literal(block));
  return documents;
}

/** A workflow's top-level mapping, read in the one shape both checks read. Throws YamlRefusal. */
export function readWorkflow(text) {
  const [root] = readYaml(text);
  if (!(root instanceof Map) || root.size === 0)
    throw new YamlRefusal(undefined, 'has no top-level key, so it is not a workflow.');
  return root;
}

/** Every `{ value, line }` under a key `match` accepts, at any depth below `node`. */
export function* valuesOf(node, match) {
  if (Array.isArray(node)) for (const item of node) yield* valuesOf(item, match);
  if (!(node instanceof Map)) return;
  for (const [key, child] of node)
    if (match(key)) yield { value: child, line: LINES.get(node)?.get(key) };
    else yield* valuesOf(child, match);
}
