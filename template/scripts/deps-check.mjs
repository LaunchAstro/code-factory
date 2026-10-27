// SPDX-License-Identifier: AGPL-3.0-only
// The declared dependencies and the code that uses them say the same thing.
//
// A stray dependency is a supply chain nobody chose, and an import of a
// package this workspace never declared works on the machine that has it and
// fails on the one that does not. Both are prose rules elsewhere; here they
// are a step that fails.
//
// Three refusals:
//
//   1. A package in `dependencies` or `devDependencies` that nothing uses.
//      Use is an import or a require in a JavaScript file, or a name in a
//      command position in a package script, a hook or a workflow: the first
//      word of a command, the word after `npx`, `pnpm exec` or `pnpm dlx` past
//      only `--`, `--no`, `--yes` or `-y` (any other option may take it as its
//      value, so nothing counts), or a `node_modules/.bin/` path; handed to
//      anything, `echo`, `sh -c` and `node` included, it is an argument. A
//      settings file counts a package named as the value of a key that
//      resolves one (extends, plugins, preset, parser), alone or in an array;
//      a string in an object, an inline plugin say, names nothing. JavaScript
//      is lexed, JSON is read as JSON (a tsconfig or jsconfig without its
//      comments), and any other settings file is read by the YAML reader or
//      clears nothing. Anything else on a line is an argument, a path or a
//      YAML key, and naming a package is not running it: the first version
//      of this counted every word, so a package named `cache` passed on the
//      `cache:` key of a setup step. A file that names things without running
//      them never counts either, which is what an ignore file is.
//      Use counts only in the workspace that declares the package: a child
//      workspace importing it says nothing about the root's declaration.
//   2. An import of a package the importing workspace's own package.json does
//      not declare. The nearest package.json above the file is the workspace,
//      which is what pnpm resolves against.
//   3. A pnpm-lock.yaml that is missing, that is not in the shape pnpm writes,
//      or whose importers no longer record the specifier its package.json
//      declares. It is read, never rebuilt,
//      and it is read out of git's index rather than off disk. pnpm repairs
//      the working lockfile before it runs a script, so the earlier gate,
//      which asked `pnpm install --frozen-lockfile` from inside
//      `pnpm run deps:check`, was handed an answer pnpm had already corrected
//      and left a rewritten tree behind. The index is what is about to be
//      committed and is what a fresh checkout has, and nothing repairs it, so
//      it answers the question actually being asked: does the lockfile this
//      repository carries match the manifests it carries.
//
// The readers stop guessing. A source, a hook, a workflow `run:` or a package
// script this gate cannot read exactly is refused with exit 2, naming the
// file, and the line where there is one, but never the text: an unclosed
// string, template or comment, an HTML-like comment outside a module, a
// backslash in code or in a string-keyed member, a bracket that never closes
// or closes nothing, an import it cannot read (`module.require`,
// `module['require']` and `createRequire` among them), a `/` it cannot place,
// nesting past 100 levels, a backtick or heredoc in shell, a nested
// substitution, a reserved word outside the shapes it knows (a for is
// `for NAME in WORDS; do`, a function `NAME() {`), a command list a shell
// would reject (`a &&`, `then;`, `a | ! b`, `a) b && ;;`, `a b)`), a string
// anywhere else below a resolving key (`c ? 'a' : 'b'`), JSON settings that
// are not JSON, repeat a key, hold a line separator or lone CR, or a comment
// outside a tsconfig or jsconfig, an rc file holding `//`, `/*` or `#`, a
// mapping as a step's `run`. A package.json or scripts/deps-allow.json that
// is not one JSON object, a script that is not a string, and dependencies,
// scripts or allowed packages that are not a mapping of strings, null
// included, are refused the same way, never quoted.
// Workflows, YAML settings and the lockfile are read by scripts/yaml-subset.mjs,
// the reader pins-check uses, so the two checks read one workflow the same
// way. A refusal is never a pass and never a guess at what the text meant,
// and a finding never quotes a specifier or prints a key that is not a package
// name, either of which can carry a credential. The import grammar proves the
// names written down: a name worked out at run time, `require(name)` or
// `m[key]`, is invisible to it, so rule 2 catches a mistake, not an author
// hiding an import.
//
// scripts/deps-allow.json is for a package that is genuinely used and that no
// rule above can see: type definitions a compiler reads without anything
// naming the package, for instance. Each entry carries its reason, an entry
// without one allows nothing, and the list is meant to stay short. A tree
// with no package.json at all is refused: there would be nothing to check.
//
// Usage:
//   node scripts/deps-check.mjs [repository-root]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { basename, dirname, extname, resolve } from 'node:path';
import { CODE } from './dup-check.mjs';
import { exitWith, isMainModule, readJson, refuse } from './main-module.mjs';
import { treeFiles } from './tree-files.mjs';
import { YamlRefusal, readWorkflow, readYaml, valuesOf } from './yaml-subset.mjs';

// Files that name things without running them. An ignore file lists paths, so
// `left-pad` in .gitignore is a directory to skip and says nothing about any
// package; .npmrc names a registry, .nvmrc a Node version, .gitmessage a
// commit template; and renovate.json names packages in order to schedule their
// updates, which is the opposite of using one. Reading any of these as use
// would make this gate blind to exactly the dependency it is looking for.
const namesOnly = (path) =>
  ['renovate.json', '.npmrc', '.nvmrc', '.gitmessage'].includes(basename(path)) ||
  basename(path).endsWith('ignore');

// What a person edits to configure a tool, as opposed to what they write to
// build a product.
export const isConfig = (path) =>
  !namesOnly(path) &&
  (path.startsWith('.husky/') ||
    path.startsWith('.github/workflows/') ||
    (!path.includes('/') &&
      (path.startsWith('.') || path.includes('.config.') || path.endsWith('.json'))));

// A hook and a workflow are command lines, so any word in one may be a bin
// being run: .husky/commit-msg runs commitlint, a workflow may run a tool
// directly.
const runsCommands = (path) => path.startsWith('.husky/') || path.startsWith('.github/workflows/');

// The keys a tool resolves a package name out of: a shareable config, a
// plugin, a preset, a parser. Only in key position, a key followed by its
// colon, does one say the value beside it is a package. Elsewhere, a string or
// a sentence included, a package name is mentioned, and a mention is nothing.
const RESOLVING = /^(?:extends|plugins?|presets?|parsers?)$/u;
// Spaces and tabs only, so the pattern cannot cross lines and stays linear.
const KEY_AT = /(?:^|[{,])[ \t]*(?:'(\d+)'|([\w$]+))[ \t]*:/gmu;

// The forms an import or require token takes, each read where it stands, so
// `const a = 1; import pad from 'left-pad'` is read like a line of its own.
// The lexer below has replaced each string with `'n'`, its index among the
// file's literals, so these match code and never prose.
const FORMS = [
  /import\s*\.\s*meta(?![\w$])/uy,
  /(?:import|require)\s*\(\s*'(\d+)'\s*[,)]/uy,
  /import(?![\w$])[^'";()=]*?(?<![\w$])from\s*'(\d+)'/uy,
  /import\s*'(\d+)'/uy,
];
const REEXPORT = /export\s*(?:type\s+)?(?:\*\s*(?:as\s+[\w$]+\s*)?|\{[^{}]*\}\s*)from\s*'(\d+)'/uy;
// `module.require(...)` is a require read off an object, and `createRequire`
// makes one no form reads, so a file holding either is refused.
const TOKEN =
  /(?<![\p{ID_Continue}$#])(?:import|require|export|createRequire)(?![\p{ID_Continue}$])/gu;
// `module['require']` and `m?.['createRequire']` are the same, by a string key.
const KEYED = /(?<=[\p{ID_Continue}$)\]'`]\s?(?:\?\.)?)\[\s?'(\d+)'\s?\]/gu;
// A call whose first argument is not one string: a value worked out at run
// time names nothing this check can read, but a string inside one is a name
// written down that this check cannot put together, so that refuses.
const COMPUTED = /(?:import|require)\s*\(/uy;
const JS = /\.[cm]?[jt]sx?$/u;
// How deep a `${`, a JSX element or a `$(` nests before it is refused.
const DEEPEST = 100;

/** Whether parsed JSON is an object, so its entries are names and values, not indexes. */
const plain = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Input this gate refuses to read rather than guess at: exit 2, naming the file. */
class Unreadable extends Error {}

// A `/` after one of these, a division included, starts a regular
// expression; after a name, a number, a closing bracket or a string it
// divides. After a `)` it depends on what the parenthesis opened, which the
// lexer tracks: an `if`, `for`, `while` or `with` head is followed by a
// statement, so a regular expression; anything else by an operator. After `}`, `++`, `--`, `of`, `yield` or
// `await` either reading is legal JavaScript, so it is refused, not guessed.
// The same holds for a JSX `<`.
const OPERAND = /(?:^|[=(,:[!&|?{;+\-*%~^<>/])$/u;
const OPERAND_WORDS = new Set(
  'return typeof case default do else extends in new delete void throw instanceof'.split(' '),
);
const EITHER = /(?:\}|\+\+|--)$/u;
const EITHER_WORDS = new Set(['of', 'yield', 'await']);
const HEADS = new Set(['if', 'while', 'for', 'with']);
const NAME = /[A-Za-z_$][\w$.:-]*/uy;

/** The word `code` ends with, unless it is a property name. */
function lastWord(code) {
  const trimmed = code.trimEnd();
  const word = /[\p{ID_Continue}$]*$/u.exec(trimmed.slice(-12))[0];
  const property = trimmed
    .slice(0, trimmed.length - word.length)
    .trimEnd()
    .endsWith('.');
  return property ? '' : word;
}

/**
 * JavaScript as its code alone, with its string literals beside it, and the
 * specifiers its imports, re-exports and requires name.
 *
 * Comments, template text, JSX text and regular expressions are blanked,
 * across lines; a string, or a template with no interpolation, becomes
 * `'n'`; a `${...}` interpolation and a JSX `{...}` expression stay code.
 * Every `import` and `require` token left in the code is then read by one of
 * the forms above, or the file is refused. Anything this does not read
 * exactly is refused, naming `path` and the line, never the text: a string,
 * template, comment, expression or element that never closes, a backslash in
 * code (`requ\u0069re` is `require`), a `/` or `<` it cannot place, JSX it
 * cannot follow, or an import it cannot read.
 */
function jsCode(text, path) {
  const jsx = path.endsWith('x');
  const esModule = /\.m[jt]s$/u.test(path);
  const literals = [];
  const starts = [];
  // For each character of `out`, where in `text` it came from, so a refusal
  // can name its line.
  const origin = [];
  // For each open `(`, whether it opens a control head; `head` is that for
  // the last `)`.
  const heads = [];
  let head = false;
  const out = [];
  // Where the line holding `from` ends: at any of JavaScript's four line terminators.
  const lineEnd = (from) => from + (text.slice(from).search(/[\n\r\u2028\u2029]/u) >>> 0);
  // How far one character of a string or a regular expression reaches.
  const reach = (from) => (text.startsWith('\\\r\n', from) ? 3 : text[from] === '\\' ? 2 : 1);
  let at = text.startsWith('#!') ? lineEnd(0) : 0;
  const fail = (why, where = at) => {
    const line = text.slice(0, where).split('\n').length;
    throw new Unreadable(`${path}:${line}: ${why}, which this check cannot read exactly`);
  };
  // A run of whitespace is kept as one character, a line terminator if it
  // holds one, so the code before a `/`, `<` or `(` is a short tail of `out`
  // and reading it costs the same however long the file is.
  const emit = (piece, from = at) => {
    for (const char of piece.split(''))
      if (!/\s/u.test(char) || !/\s/u.test(out.at(-1) ?? '')) {
        out.push(char);
        origin.push(from);
      } else if (/[\n\r\u2028\u2029]/u.test(char)) out[out.length - 1] = char;
  };
  const tail = () => out.slice(-40).join('').trimEnd();
  // Whether the `/` or `<` at `at` starts an operand (a regular expression, a
  // JSX element) rather than being an operator.
  const operandHere = () => {
    const before = tail();
    if (EITHER.test(before.slice(-2)) || EITHER_WORDS.has(lastWord(before)))
      fail(`a ${text[at]} that could be read either way`);
    if (before.endsWith(')')) return head;
    return OPERAND.test(before.slice(-1)) || OPERAND_WORDS.has(lastWord(before));
  };
  // Nested `${...}` and JSX are read by recursion, so depth is bounded here.
  let levels = 0;
  const deeper = (read) => {
    if (++levels > DEEPEST) fail(`nesting deeper than ${DEEPEST} levels`);
    read(true);
    levels -= 1;
  };
  const literal = (body, start) => {
    starts.push(start);
    emit(`'${literals.push(body) - 1}'`, start);
  };
  const name = () => {
    NAME.lastIndex = at;
    const found = NAME.exec(text)?.[0] ?? '';
    at += found.length;
    return found;
  };
  const space = () => {
    while (/\s/u.test(text[at] ?? '')) at += 1;
  };
  const string = (quote) => {
    let end = at + 1;
    for (; text[end] !== quote; end += reach(end))
      if (end >= text.length || '\n\r'.includes(text[end])) fail('a string that never closes');
    literal(text.slice(at + 1, end), at);
    at = end + 1;
  };
  const template = () => {
    const start = (at += 1);
    let interpolated = false;
    while (text[at] !== '`') {
      if (at >= text.length) fail('a template literal that never closes');
      if (text[at] === '\\') at += 2;
      else if (text.startsWith('${', at)) {
        interpolated = true;
        emit('`');
        at += 2;
        deeper(code);
      } else at += 1;
    }
    // An interpolated template is marked with backticks, so a call it is the
    // first argument of is known to hold a string.
    if (interpolated) emit('`');
    else literal(text.slice(start, at), start);
    at += 1;
  };
  // A regular expression ends on its line, escaped terminator or not.
  const regex = () => {
    let inClass = false;
    for (at += 1; inClass || text[at] !== '/'; at += reach(at)) {
      if (at >= text.length || /[\n\r\u2028\u2029]/u.test(text.slice(at, at + reach(at))))
        fail('a regular expression that never closes');
      if (text[at] === '[') inClass = true;
      else if (text[at] === ']') inClass = false;
    }
    for (at += 1; /[a-z]/u.test(text[at] ?? '');) at += 1;
    emit('0');
  };
  // A JSX element: its attributes, then its children to the closing tag.
  // Attribute strings and child text are prose; `{...}` is code.
  const element = () => {
    at += 1;
    name();
    for (space(); text[at] !== '>'; space()) {
      if (text.startsWith('/>', at)) {
        at += 2;
        emit(' 0');
        return;
      }
      if (text[at] === '{') {
        at += 1;
        deeper(code);
        continue;
      }
      if (name() === '') fail('a JSX tag');
      space();
      if (text[at] !== '=') continue;
      at += 1;
      space();
      if (text[at] === '{') {
        at += 1;
        deeper(code);
      } else if (text[at] === '"' || text[at] === "'") {
        const end = text.indexOf(text[at], at + 1);
        if (end < 0) fail('a JSX attribute that never closes');
        at = end + 1;
      } else fail('a JSX attribute');
    }
    for (at += 1; ;) {
      const stop = text.slice(at).search(/[<{]/u);
      if (stop < 0) fail('a JSX element that never closes');
      at += stop + 1;
      if (text[at - 1] === '{') deeper(code);
      else if (text[at] !== '/') {
        at -= 1;
        deeper(element);
      } else {
        at = text.indexOf('>', at) + 1 || fail('a JSX closing tag');
        emit(' 0');
        return;
      }
    }
  };
  // Code to the end of the file, or `nested`, to the `}` that closes it.
  const code = (nested) => {
    let depth = 0;
    while (at < text.length) {
      const [char, next] = [text[at], text[at + 1]];
      // Outside a module, Annex B reads both as a line comment; in a module
      // they are operators, and a `.js` file may be either.
      if (!esModule && (text.startsWith('<!--', at) || text.startsWith('-->', at)))
        fail('a <!-- or --> that is a comment unless this is a module');
      if (char === '/' && next === '/') at = lineEnd(at);
      else if (char === '/' && next === '*') {
        const end = text.indexOf('*/', at + 2);
        if (end < 0) fail('a comment that never closes');
        emit(text.slice(at, end).includes('\n') ? '\n' : ' ');
        at = end + 2;
      } else if (char === '/' && operandHere()) regex();
      else if (char === "'" || char === '"') string(char);
      else if (char === '`') template();
      else if (char === '<' && jsx && /[A-Za-z>]/u.test(next ?? '') && operandHere())
        deeper(element);
      else if (char === '\\') fail('a backslash in code');
      else if (char === '}' && depth === 0 && nested) {
        at += 1;
        return;
      } else {
        depth += { '{': 1, '}': -1 }[char] ?? 0;
        const word = char === '(' ? lastWord(tail()) : '';
        if (char === '(')
          heads.push(
            HEADS.has(word) || (word === 'await' && lastWord(tail().slice(0, -5)) === 'for'),
          );
        else if (char === ')') head = heads.pop() ?? false;
        emit(char, at++);
      }
    }
    if (nested) fail('an interpolation or expression that never closes');
  };
  code(false);
  const lexed = out.join('');
  for (const [, index] of lexed.matchAll(KEYED))
    if (/^(?:require|createRequire)$|\\/u.test(literals[index]))
      fail('an import or require read off an object, or an escaped key', starts[index]);
  const valueEnd = valueEnds(lexed, (where) => fail('an unbalanced bracket', origin[where]));
  const named = [];
  // Every search below starts past the last one, so the whole is one pass: a
  // token inside an import already read is part of it, `createRequire` aside,
  // and `quote` is the next string at or after the computed call being read.
  let [readTo, quote] = [0, -1];
  for (const { index } of lexed.matchAll(TOKEN)) {
    if (index < readTo && !lexed.startsWith('createRequire', index)) continue;
    if (/(?:^|[^.])\.\s?$/u.test(lexed.slice(Math.max(0, index - 3), index)))
      fail('an import or require read off an object', origin[index]);
    const read = [...FORMS, REEXPORT].reduce((found, form) => {
      form.lastIndex = index;
      return found ?? form.exec(lexed);
    }, null);
    readTo = index + (read?.[0].length ?? 0);
    if (read?.[1] !== undefined) {
      if (literals[read[1]].includes('\\'))
        fail('an import specifier written with an escape', starts[read[1]]);
      named.push(literals[read[1]]);
    } else if (read === null && !lexed.startsWith('export', index)) {
      COMPUTED.lastIndex = index;
      if (!COMPUTED.test(lexed)) fail('an import or require token', origin[index]);
      const from = COMPUTED.lastIndex;
      if (quote < from) quote = from + (lexed.slice(from).search(/['`]/u) >>> 0);
      if (quote < valueEnd(from, ','))
        fail('an import whose name is put together from strings', origin[index]);
    }
  }
  const failAt = (why, where) => fail(why, origin[where]);
  return { code: lexed, literals, specifiers: named, valueEnd, failAt };
}

/**
 * For `code`, where a value starting at `from` ends: at the first of `stops`
 * outside brackets, or at a bracket it did not open. Each bracket's partner
 * is found once, so a value nested in another is never walked again. A
 * bracket with no partner of its own kind calls `unbalanced` with its index.
 */
function valueEnds(code, unbalanced) {
  const [partner, open] = [[], []];
  for (let at = 0; at < code.length; at += 1)
    if ('([{'.includes(code[at])) open.push(at);
    else if (')]}'.includes(code[at])) {
      const from = open.pop();
      if ('([{'.indexOf(code[from]) !== ')]}'.indexOf(code[at])) unbalanced(at);
      partner[from] = at;
    }
  if (open.length > 0) unbalanced(open.at(-1));
  return (from, stops) => {
    let end = from;
    while (end < code.length && !stops.includes(code[end]) && !')]}'.includes(code[end]))
      end = '([{'.includes(code[end]) ? (partner[end] ?? code.length) + 1 : end + 1;
    return Math.min(end, code.length);
  };
}

// What npm lets a package be called. A specifier whose first segment is not a
// legal name is not a package: a shell script that writes
// `import('$REPO_ROOT/x.mjs')` into a heredoc names a path its shell expands.
const PACKAGE_NAME = /^(?:@[a-z0-9~*-][a-z0-9._~*-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/u;

/**
 * The package a specifier resolves to, or undefined when it names no package.
 *
 * Relative paths, absolute paths, node builtins with or without `node:`, `#`
 * subpath imports and anything npm would refuse as a name all resolve inside
 * the workspace or outside npm, and name nothing to declare. A scoped package
 * is two segments, an unscoped one is the first.
 */
export function packageOf(specifier) {
  if (/^[./]/u.test(specifier) || specifier.startsWith('#') || isBuiltin(specifier))
    return undefined;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return name === undefined || !PACKAGE_NAME.test(name) ? undefined : name;
}

/**
 * Every package name `text` imports, for a source file at `path`. Throws Unreadable.
 *
 * Only JavaScript is read. A shell script, a Python file or a workflow names
 * a package only inside a string, which is text it prints or hands to another
 * program, and reading those strings as code is how an echoed sentence came
 * to count as use.
 */
export function imported(text, path = 'file.mjs') {
  const names = (JS.test(path) ? jsCode(text, path).specifiers : []).map(packageOf);
  return new Set(names.filter((name) => name !== undefined));
}

// The runners that take a package name as their next argument. `pnpm` only
// does so after `exec` or `dlx`: `pnpm check` runs a package script, and
// `corepack pnpm ...` is pnpm again with a shim in front.
const RUNNERS = new Set(['npx', 'pnpm', 'pnpx', 'corepack']);
const TAKES_PACKAGE = new Set(['exec', 'dlx']);
// The runner options known to take no value; after any other, nothing counts.
const VALUELESS = new Set(['--', '--no', '--yes', '-y']);

// `FOO=bar cmd` runs cmd. The assignments in front of it are not the command.
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

// A bin invoked by path rather than by name, which is how a script reaches a
// package without a runner: the whole command word, one name under `.bin`.
const BIN_PATH = /(?:^|\/)node_modules\/\.bin\/([^/]+)$/u;

// How each reserved word the shell reader knows moves the compound commands
// open around it: the frame it needs on top, written `open/next`, and what it
// leaves there, `+` opening a frame and `-` closing it. Any other reserved
// word in command position is refused.
const SHAPES = new Map([
  ['if', ['', '+if/then']],
  ['then', ['if/then', 'if/fi']],
  ['elif', ['if/fi', 'if/then']],
  ['else', ['if/fi', 'else/fi']],
  ['fi', ['if/fi else/fi', '-']],
  ['while', ['', '+loop/do']],
  ['until', ['', '+loop/do']],
  ['for', ['', '+loop/do']],
  ['do', ['loop/do', 'loop/done']],
  ['done', ['loop/done', '-']],
  ['case', ['', '+case/esac']],
  ['esac', ['case/esac', '-']],
  ['{', ['', '+{/}']],
  ['}', ['{/}', '-']],
  ['!', ['', '']],
]);
const RESERVED = new Set([...SHAPES.keys(), ...'in function select time coproc [[ ]]'.split(' ')]);
// A for loop's variable and a function's name: unquoted, as the shell reads one.
const SHELL_NAME = /^[A-Za-z_]\w*$/u;
// The reserved words that end a list, which must hold a command.
const CLOSES = new Set('then elif else fi do done esac }'.split(' '));

/**
 * `script` as a shell reads it: its simple commands, each a list of words
 * with their quotes and redirections taken off.
 *
 * It reads a short grammar and refuses the rest: words, quotes, `$( )`,
 * `${ }`, `&&`, `||`, `;`, `|`, newlines, comments, leading assignments,
 * redirections, and the compound shapes the repository's own hooks are
 * written in: `if`, `while` and `until` lists, `{ ...; }`, `NAME() { ...; }`,
 * `for NAME in WORDS` and `case WORD in PATTERN) ... ;; esac`. Refused,
 * never guessed at: a backtick, a heredoc, `&` on its own, a subshell,
 * `$((`, a quote, `${` or `$(` that never closes, a reserved word in command
 * position that is quoted or is not one of those, and a `case` inside `$(`.
 */
function shellCommands(script) {
  const commands = [];
  let at = 0;
  const fail = (why) => {
    throw new Unreadable(`this check cannot read ${why}`);
  };
  // `${...}` is a piece of a word. Its quotes are skipped; a substitution in it is refused.
  const parameter = () => {
    let quote = '';
    let end = at + 2;
    for (; quote !== '' || script[end] !== '}'; end += 1) {
      const char = script[end];
      if (char === undefined) fail('a ${ that never closes');
      if (quote !== '') quote = char === quote ? '' : quote;
      else if (char === "'" || char === '"') quote = char;
      else if (char === '`' || script.startsWith('$(', end)) fail('a substitution inside ${...}');
    }
    const piece = script.slice(at, end + 1);
    at = end + 1;
    return piece;
  };
  let levels = 0;
  const substitution = () => {
    if (script[at + 2] === '(') fail('$((...))');
    if (++levels > DEEPEST) fail(`$( nested deeper than ${DEEPEST} levels`);
    at += 2;
    grammar(tokens(true), true);
    levels -= 1;
    return '$()';
  };
  const doubleQuoted = () => {
    let word = '';
    for (at += 1; script[at] !== '"';) {
      const [char, next] = [script[at], script[at + 1]];
      if (char === undefined) fail('a quote that never closes');
      if (char === '`') fail('a backtick');
      if (char === '$' && next === '(') word += substitution();
      else if (char === '$' && next === '{') word += parameter();
      else if (char === '\\' && next !== undefined) {
        word += '"\\$`'.includes(next) ? next : next === '\n' ? '' : char + next;
        at += 2;
      } else {
        word += char;
        at += 1;
      }
    }
    at += 1;
    return word;
  };
  // One list as tokens: a word is a string, an operator `{ op }`, and a word
  // with any quoting `{ op: 'quoted', word }`, which the shell never reads as
  // grammar or as a name.
  const tokens = (nested) => {
    const stream = [];
    let word;
    let quoted = false;
    const add = (piece, quoting = false) => {
      word = (word ?? '') + piece;
      quoted ||= quoting;
    };
    const close = () => {
      if (word !== undefined) stream.push(quoted ? { op: 'quoted', word } : word);
      [word, quoted] = [undefined, false];
    };
    const op = (name, length) => {
      close();
      stream.push({ op: name });
      at += length;
    };
    while (at < script.length) {
      const [char, next] = [script[at], script[at + 1]];
      const pair = char + (next ?? '');
      if (char === "'") {
        const stop = script.indexOf("'", at + 1);
        if (stop < 0) fail('a quote that never closes');
        add(script.slice(at + 1, stop), true);
        at = stop + 1;
      } else if (char === '"') add(doubleQuoted(), true);
      else if (char === '`') fail('a backtick');
      else if (pair === '$(') add(substitution());
      else if (pair === '${') add(parameter());
      else if (char === '#' && word === undefined) at = script.indexOf('\n', at) >>> 0;
      else if (char === '\\') {
        if (next !== '\n') add(next ?? '', true);
        at += 2;
      } else if (char === '<' || char === '>') {
        if (pair === '<<' && script[at + 2] !== '<') fail('a heredoc');
        // `2>&1`: the digits in front name the descriptor, and are no word.
        if (!quoted && /^\d+$/u.test(word ?? '')) word = undefined;
        op('redirect', /^(?:<<<|>>|>&|<&|>\||<>|.)/u.exec(script.slice(at))[0].length);
      } else if (['&&', '||', ';;'].includes(pair)) op(pair, 2);
      else if (char === '&' || pair === '|&' || pair === ';&') fail('&, |& or ;&');
      else if ('|;\n'.includes(char)) op(char, 1);
      else if (nested && char === '(') fail('a subshell inside $(...)');
      else if (nested && char === ')') {
        close();
        at += 1;
        return stream;
      } else if (char === '(' || char === ')') op(char, 1);
      else if (char === ' ' || char === '\t') {
        close();
        at += 1;
      } else {
        add(char);
        at += 1;
      }
    }
    if (nested) fail('a $( that never closes');
    close();
    return stream;
  };
  // The simple commands in one list's tokens, its reserved words read as grammar.
  const grammar = (stream, nested) => {
    let command = [];
    // `command` reads commands; `closed` follows fi, done, esac or }; `for`
    // and `case` read the words after those; `do` waits for a for's do;
    // `pattern` reads a case pattern.
    let state = 'command';
    let [started, target, count] = [false, false, 0];
    // What the list last read: `open` a reserved word that starts a list,
    // `sep` a `;` or a newline after a command, `cmd` a command, or the `&&`,
    // `||`, `|` or `!` (`op` for `NAME()`) that needs a command after it. A
    // separator needs a command before it, a word that closes a list needs a
    // list, and `!` starts a pipeline, never one already begun.
    let last = 'open';
    // The index of a command's first word when it is a name `NAME() {` may define.
    let named = -1;
    // The compound commands open here, innermost last, each with the reserved
    // word it waits for. A reserved word nothing waits for is a script no
    // shell runs, so it is refused rather than read.
    const frames = [];
    const end = () => {
      if (command.length > 0) commands.push(command);
      [command, started] = [[], false];
    };
    const reserved = (word) => {
      const [needs, leaves] = SHAPES.get(word) ?? fail(`the reserved word ${word} here`);
      if (nested && word === 'case') fail('a case inside $(...)');
      if (needs !== '' && !needs.split(' ').includes(frames.at(-1)))
        fail(`${word} where nothing waits for it`);
      if (CLOSES.has(word) && !['cmd', 'sep'].includes(last)) fail(`${word} after an empty list`);
      if (word === '!' && !['open', 'sep', '&&', '||'].includes(last))
        fail('a ! inside a pipeline');
      last = ['fi', 'done', 'esac', '}'].includes(word) ? 'cmd' : word === '!' ? '!' : 'open';
      if (leaves.startsWith('+')) frames.push(leaves.slice(1));
      else if (leaves === '-') {
        frames.pop();
        state = 'closed';
      } else if (leaves !== '') frames[frames.length - 1] = leaves;
      if (word === 'for' || word === 'case') [state, count] = [word, 0];
    };
    const between = () => state === 'command' || state === 'closed';
    for (let index = 0; index < stream.length; index += 1) {
      const token = stream[index];
      const { op } = typeof token === 'string' ? {} : token;
      const word = op === undefined ? token : token.word;
      if (target) {
        if (word === undefined) fail('a redirection with no target');
        target = false;
      } else if (word !== undefined) {
        count += 1;
        const first = state === 'command' && !started;
        if (first && RESERVED.has(word) && op === 'quoted')
          fail('a quoted reserved word in command position');
        else if (first && RESERVED.has(word)) reserved(word);
        else if (state === 'command') {
          named = first && op === undefined && SHELL_NAME.test(word) ? index : -1;
          command.push(word);
          [started, last] = [true, 'cmd'];
        } else if (state === 'closed') fail('a word after fi, done, esac or }');
        else if (state === 'case' && count === 2) {
          if (word !== 'in' || op !== undefined) fail('a case without in');
          [state, last] = ['pattern', 'start'];
        } else if (state === 'pattern' && last === 'start' && word === 'esac' && op === undefined) {
          frames.pop();
          [state, last] = ['closed', 'cmd'];
        } else if (state === 'pattern') {
          if (!['start', '(', '|'].includes(last)) fail('a case pattern');
          last = 'word';
        } else if (state === 'do' && word === 'do' && op === undefined) {
          [frames[frames.length - 1], state, last] = ['loop/done', 'command', 'open'];
        } else if (
          state === 'for' &&
          (count > 2 || (op === undefined && [SHELL_NAME, /^in$/u][count - 1].test(word)))
        )
          last = 'cmd';
        else if (state !== 'case') fail('a for that is not `for NAME in WORDS; do`');
        // Anything else is a for list or a case subject: data.
      } else if (state === 'pattern') {
        // `(a|b)`: newlines and one `(` before, a word on each side of a `|`.
        const before = { ')': 'word', '|': 'word', '(': 'start', '\n': 'start' }[op];
        if (before === undefined || last !== before) fail('a case pattern');
        [state, last] = op === ')' ? ['command', 'open'] : [state, op === '\n' ? 'start' : op];
      } else if (state === 'for' || state === 'do') {
        if (count < 2 || (op !== '\n' && (op !== ';' || state === 'do')))
          fail('a for that is not `for NAME in WORDS; do`');
        state = 'do';
      } else if (op === 'redirect' && between()) [target, started, last] = [true, true, 'cmd'];
      else if (
        op === '(' &&
        state === 'command' &&
        named === index - 1 &&
        stream[index + 1]?.op === ')' &&
        stream[index + 2] === '{'
      ) {
        // `NAME() {` defines a function: its name is not run, and a body follows.
        [command, started, last] = [[], false, 'op'];
        index += 1;
      } else if (op === ';;' && frames.at(-1) === 'case/esac' && between()) {
        if (!['cmd', 'sep', 'open'].includes(last)) fail(';; after an unfinished command');
        end();
        [state, last] = ['pattern', 'start'];
      } else if (
        [';', '\n'].includes(op) ? state !== 'case' : ['&&', '||', '|'].includes(op) && between()
      ) {
        if (op === '\n' ? last === '!' : last !== 'cmd')
          fail(op === '\n' ? 'a ! with no command after it' : `${op} after no command`);
        if (last === 'cmd') last = [';', '\n'].includes(op) ? 'sep' : op;
        end();
        state = 'command';
      } else fail('a subshell, or a for or case in a shape it does not know');
    }
    if (target || !between() || frames.length > 0 || !['cmd', 'sep', 'open'].includes(last))
      fail('a script that ends inside a command');
    end();
  };
  grammar(tokens(false), false);
  return commands;
}

/**
 * The shell scripts a workflow runs: each `run` value, read by the one
 * workflow reader pins-check reads with too. Nothing else in a workflow is
 * shell, so `cache: pnpm` is a setting, and a line inside a block scalar is
 * that scalar's text, never a key. `defaults.run` is a mapping of settings,
 * and a mapping anywhere else is refused.
 */
function runScripts(text) {
  const workflow = readWorkflow(text);
  const settings = new Set(
    [...valuesOf(workflow, (key) => key === 'defaults')].map(({ value }) => value?.get?.('run')),
  );
  return [...valuesOf(workflow, (key) => key === 'run')].flatMap(({ value, line }) => {
    if (typeof value === 'string') return [value];
    if (value instanceof Map && settings.has(value)) return [];
    throw new YamlRefusal(line, 'this check cannot read this run value.');
  });
}

/**
 * The names a YAML settings file resolves: the values of its resolving keys,
 * one name or a list of names. Block scalar text is a value, never a key.
 */
function yamlNames(text) {
  return [...valuesOf(readYaml(text), (key) => RESOLVING.test(key))].flatMap(({ value, line }) => {
    const names = value === null ? [] : [value].flat();
    if (names.some((name) => typeof name !== 'string'))
      throw new YamlRefusal(line, 'this check cannot read what this key resolves.');
    return names;
  });
}

/** `names(...)` with the file it read named on an Unreadable or a YAML refusal. */
function naming(where, names) {
  try {
    return names();
  } catch (error) {
    if (error instanceof YamlRefusal) throw new Unreadable(error.at(where));
    if (error instanceof Unreadable) throw new Unreadable(`${where}: ${error.message}`);
    throw error;
  }
}

/** Every token that could be a package name because `script` runs it. Throws Unreadable. */
export function commandNames(script) {
  const names = new Set();
  for (const tokens of shellCommands(script)) {
    let index = 0;
    const options = () => {
      while (tokens[index]?.startsWith('-'))
        index = VALUELESS.has(tokens[index]) ? index + 1 : tokens.length;
    };
    while (index < tokens.length && ASSIGNMENT.test(tokens[index])) index += 1;
    while (index < tokens.length) {
      const token = tokens[index];
      const binary = BIN_PATH.exec(token);
      if (binary || !RUNNERS.has(token)) {
        names.add(binary?.[1] ?? token);
        break;
      }
      index += 1;
      if (token === 'corepack') continue;
      // Past the runner: skip its options, then decide on the word.
      options();
      if (tokens[index] === undefined) break;
      if (token === 'npx' || token === 'pnpx') {
        names.add(basename(tokens[index]));
        break;
      }
      if (!TAKES_PACKAGE.has(tokens[index])) break;
      index += 1;
      options();
      if (tokens[index] !== undefined) names.add(basename(tokens[index]));
      break;
    }
  }
  return names;
}

// The fields npm itself defines. A tool may configure itself from a manifest
// key, which is how `lint-staged` is used without anything running its name,
// but `version` and `type` are npm's own words and carrying one is not use.
const MANIFEST_FIELDS = new Set(
  (
    'author bin browser bugs bundledDependencies config contributors cpu dependencies ' +
    'description devDependencies directories engines exports files funding homepage ' +
    'imports keywords license main man module name optionalDependencies os overrides ' +
    'packageManager peerDependencies peerDependenciesMeta private publishConfig ' +
    'repository resolutions scripts sideEffects type types typings version workspaces'
  ).split(' '),
);

/**
 * The workspace a file belongs to: the nearest manifest at or above it.
 *
 * `manifestDirs` are the directories holding a package.json, so '' is the
 * root. The longest one that is a prefix of the file's directory wins, which
 * is the same answer node's resolver reaches by walking upwards.
 */
export function workspaceOf(path, manifestDirs) {
  const dir = dirname(path) === '.' ? '' : dirname(path);
  return manifestDirs
    .filter((candidate) => candidate === '' || dir === candidate || dir.startsWith(`${candidate}/`))
    .reduce((deepest, candidate) => (candidate.length > deepest.length ? candidate : deepest), '');
}

/**
 * The names a settings file puts in use.
 *
 * A hook or a workflow runs commands, so a name in a command position in it
 * is used. Anywhere else a package is named rather than run, and only a key
 * that resolves one says the name beside it is a package; the key itself
 * never is.
 */
function configNames(path, text) {
  if (runsCommands(path))
    return naming(path, () =>
      (path.startsWith('.github/workflows/') ? runScripts(text) : [text]).flatMap((script) =>
        Array.from(commandNames(script)),
      ),
    );
  if (/\.ya?ml$/u.test(path)) return naming(path, () => yamlNames(text));
  // JavaScript is lexed, so neither a comment nor a string is ever a key. An
  // extensionless rc file is YAML to Prettier and JSON5 to Babel, which read a
  // comment differently, so one holding a comment marker refuses. A .json
  // file, or another that starts with `{` or a comment, is JSON. Any other,
  // `.prettierrc` say, is read by the YAML reader, so block scalar text is
  // never a key, and one it cannot read clears nothing: a TOML or INI file
  // names no package this check can see.
  if (/^\.[^.]+rc$/u.test(basename(path)) && /\/[/*]|#/u.test(text))
    throw new Unreadable(`${path}: holds a comment marker, which YAML and JSON readers differ on`);
  if (!JS.test(path) && (path.endsWith('.json') || /^\s*(?:\{|\/[/*])/u.test(text)))
    return jsonNames(path, text);
  if (!JS.test(path))
    try {
      return yamlNames(text);
    } catch (error) {
      if (error instanceof YamlRefusal) return [];
      throw error;
    }
  const { code, literals, valueEnd, failAt } = jsCode(text, path);
  const names = [];
  // A tool resolves one string, or an array's. A string in brackets, an inline
  // plugin's alias or a require's argument, names nothing; one elsewhere refuses.
  const read = (from, to) => {
    const value = /^\s*'(\d+)'\s*$/u.exec(code.slice(from, to));
    if (value) return names.push(literals[value[1]]);
    for (let at = from; at < to; at = '([{'.includes(code[at]) ? valueEnd(at + 1, '') + 1 : at + 1)
      if (code[at] === "'")
        failAt('a resolving value that is not a string or an array of them', at);
  };
  let done = 0;
  for (const key of code.matchAll(KEY_AT)) {
    const from = key.index + key[0].length;
    // A key inside a value already read names nothing that value did not.
    if (from < done || !RESOLVING.test(key[2] ?? literals[key[1]])) continue;
    // A value may start on the next line; it then ends at its line's end.
    done = valueEnd(/\s/u.test(code[from] ?? '') ? from + 1 : from, ',\n\r\u2028\u2029');
    // A line break ends a value only where its comma or closing bracket follows.
    if (/[\n\r\u2028\u2029][^,)\]}]/u.test(code.slice(done, done + 2)))
      failAt('a resolving value that is not a string or an array of them', done);
    const start = done - code.slice(from, done).trimStart().length;
    const close = code[start] === '[' ? valueEnd(start + 1, '') : done;
    if (close >= done || code.slice(close + 1, done).trim() !== '') read(from, done);
    else
      for (let at = start + 1, end; at < close; at = end + 1) read(at, (end = valueEnd(at, ',')));
  }
  return names;
}

// A JSON string or a comment, to its end or the file's, so the search is one
// pass; an unclosed comment is left for the JSON reader to refuse.
const JSON_COMMENT = /"(?:[^"\\]|\\[^])*(?:"|$)|\/\/[^\n\r]*|\/\*[^]*?(?:\*\/|$)/gu;

/**
 * The names a JSON settings file resolves, at any depth: a resolving key's
 * string, or its array's. It is read by the strict JSON reader, so malformed
 * JSON or a repeated key is refused, never lexed. Only TypeScript's own files
 * have their comments taken out: every other tool reads a comment its own way
 * (JSON5, strip-json-comments, YAML), so one refuses. A line or paragraph
 * separator or a lone CR refuses in any, as readers disagree on whether a
 * line comment ends there.
 */
function jsonNames(path, text) {
  if (/[\u2028\u2029]|\r(?!\n)/u.test(text))
    throw new Unreadable(`${path}: holds a line separator or a lone CR, where readers disagree`);
  const names = [];
  const walk = (node, depth) => {
    if (depth > DEEPEST) throw new Unreadable(`${path}: nests deeper than ${DEEPEST} levels`);
    for (const [key, value] of Object.entries(node))
      if (RESOLVING.test(key))
        names.push(...[value].flat().filter((name) => typeof name === 'string'));
      else if (typeof value === 'object' && value !== null) walk(value, depth + 1);
  };
  const bare = text.replace(JSON_COMMENT, (found) =>
    /^\/(?:\/|\*[^]*\*\/$)/u.test(found) ? ' ' : found,
  );
  if (bare !== text && !/^[jt]sconfig[^/]*\.json$/u.test(basename(path)))
    throw new Unreadable(`${path}: holds a comment, which only a tsconfig or jsconfig may`);
  let json;
  try {
    json = readJson(bare);
  } catch {
    throw new Unreadable(`${path}: is not one JSON object this check can read`);
  }
  walk(json, 0);
  return names;
}

/**
 * Every name that appears anywhere a package could be used, as dir -> names,
 * each under the workspace the file belongs to: imported by a source,
 * resolved by a key in a settings file, run by a hook or a workflow, or run
 * by a package script. A manifest's own key counts too, because `lint-staged`
 * configures itself from one. The `dependencies` blocks are skipped: a
 * package listing itself is the declaration under question, not its use.
 */
function usedNames({ workspaces, sources, configs }) {
  const dirs = workspaces.map((workspace) => workspace.dir);
  const used = new Map(dirs.map((dir) => [dir, new Set()]));
  const add = (path, names) => {
    for (const name of names) used.get(workspaceOf(path, dirs))?.add(name);
  };
  for (const { path, text } of sources) add(path, imported(text, path));
  for (const { path, text } of configs) add(path, configNames(path, text));
  for (const { path, manifest } of workspaces)
    for (const [key, value] of Object.entries(manifest)) {
      if (!MANIFEST_FIELDS.has(key)) add(path, [key]);
      if (key !== 'scripts') continue;
      if (!plain(value)) throw new Unreadable(`${path} scripts: is not a mapping of names`);
      for (const [name, script] of Object.entries(value)) {
        const where = `${path} scripts.${printable(name, /[/:]/u)}`;
        if (typeof script !== 'string') throw new Unreadable(`${where}: is not a string`);
        add(
          path,
          naming(where, () => commandNames(script)),
        );
      }
    }
  return used;
}

// The dependency kinds a package.json declares and pnpm records under an
// importer. `configDependencies` and `packageManagerDependencies` come from
// pnpm-workspace.yaml and `packageManager`, not from a manifest, so they are
// not compared here.
const LOCK_KINDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

// pnpm-lock.yaml is read by the one YAML reader, in the shape pnpm writes:
// single-quoted keys, one-level flow collections such as
// `resolution: {integrity: sha512-...}`, and several documents. Anything
// outside it is refused with its line number and the rule, never the text,
// and never read as evidence. The first version read the importers block by
// indentation alone and took a doubled importer, or a half-written
// lockfile, as a match.

// A lockfile name or importer, a manifest or allow-list key, or a script
// name split at `:` is printed only as a package name or a path of them: a
// hand-edited key can hold anything, a credential included.
const printable = (name, parts = '/') =>
  name === '.' || name.split(parts).every((part) => PACKAGE_NAME.test(part.replace(/^@/u, '')))
    ? name
    : 'a name this check will not print';

/** `value` as a mapping: a Map is one, `{}` included, and nothing is an empty one. */
function mapping(value, what) {
  if (value instanceof Map) return value;
  if (value === null || value === undefined) return new Map();
  throw new Error(`pnpm-lock.yaml: ${what} is not a mapping pnpm writes`);
}

/**
 * What pnpm-lock.yaml records each workspace declaring, as
 * `dir -> kind -> name -> specifier`, across every document in the file.
 * Throws when the lockfile is not in the shape pnpm writes.
 */
export function lockImporters(text) {
  const importers = new Map();
  let documents;
  try {
    documents = readYaml(text, { pnpm: true });
  } catch (error) {
    if (!(error instanceof YamlRefusal)) throw error;
    throw new Error(`pnpm-lock.yaml line ${error.line}: ${error.reason}`, { cause: error });
  }
  // pnpm writes the version in the main document, the last one.
  if (!/^\d+\.\d+$/u.test(mapping(documents.at(-1), 'a document').get('lockfileVersion') ?? ''))
    throw new Error('pnpm-lock.yaml: has no lockfileVersion pnpm writes, so it is not one');
  for (const document of documents)
    for (const [dir, entry] of mapping(
      mapping(document, 'a document').get('importers'),
      'importers',
    )) {
      const kinds = mapping(entry, `importer ${printable(dir)}`);
      if (!importers.has(dir)) importers.set(dir, new Map());
      const locked = importers.get(dir);
      for (const kind of LOCK_KINDS.filter((candidate) => kinds.has(candidate)))
        locked.set(
          kind,
          specifiers(kinds.get(kind), `${printable(dir)} ${kind}`, locked.get(kind)),
        );
    }
  return importers;
}

/** One kind's packages as name -> specifier, added to what an earlier document recorded. */
function specifiers(packages, where, recorded = new Map()) {
  for (const [name, entry] of mapping(packages, where)) {
    const fields = mapping(entry, `${where} ${printable(name)}`);
    const specifier = fields.get('specifier');
    if (
      typeof specifier !== 'string' ||
      !(typeof fields.get('version') === 'string' && fields.get('version').trim()) ||
      recorded.has(name)
    )
      throw new Error(
        `pnpm-lock.yaml: ${where} ${printable(name)} has no single specifier and version`,
      );
    recorded.set(name, specifier);
  }
  return recorded;
}

/**
 * A file as git holds it in the index, or undefined when git does not hold it.
 *
 * `:./path` is the index entry beside the current directory. Without the
 * `./` git reads the path from the root of the repository, which is a
 * different file whenever the project is a directory inside a larger one.
 */
export function indexText(root, path) {
  const shown = spawnSync('git', ['-C', root, 'show', `:./${path}`], { encoding: 'utf8' });
  return shown.status === 0 ? shown.stdout : undefined;
}

/**
 * Every disagreement between pnpm-lock.yaml and the manifests, one line each.
 *
 * `lockText` is undefined when there is no lockfile at all, which is the same
 * refusal by a shorter route. Nothing here writes: an answer about the tree
 * should not change the tree to reach it.
 */
export function lockfileFindings(lockText, workspaces) {
  if (lockText === undefined) return ['pnpm-lock.yaml is not in the repository'];
  let importers;
  try {
    importers = lockImporters(lockText);
  } catch (error) {
    return [error.message];
  }
  const findings = [];
  const dirs = new Set();
  for (const { path, dir, manifest } of workspaces) {
    const key = dir === '' ? '.' : dir;
    dirs.add(key);
    const locked = importers.get(key);
    if (locked === undefined) {
      findings.push(`pnpm-lock.yaml has no importer for ${key}, which ${path} declares`);
      continue;
    }
    for (const kind of LOCK_KINDS) {
      const declared = manifest[kind] ?? {};
      const recorded = locked.get(kind) ?? new Map();
      for (const name of Object.keys(declared).toSorted()) {
        const specifier = declared[name];
        if (!recorded.has(name))
          findings.push(`pnpm-lock.yaml records no ${kind} ${printable(name)} for ${key}`);
        else if (recorded.get(name) !== specifier)
          findings.push(
            `pnpm-lock.yaml records another specifier for ${printable(name)} in ${key} than ${path} declares`,
          );
      }
      for (const name of [...recorded.keys()].toSorted())
        if (!Object.hasOwn(declared, name))
          findings.push(
            `pnpm-lock.yaml records ${kind} ${printable(name)} for ${key}, which ${path} does not declare`,
          );
    }
  }
  for (const key of [...importers.keys()].toSorted())
    if (!dirs.has(key))
      findings.push(
        `pnpm-lock.yaml has an importer for ${printable(key)}, which has no package.json`,
      );
  return findings;
}

/**
 * Every disagreement between what `workspaces` declare and what `sources`,
 * `scripts` and `configs` use, one line each.
 *
 * `workspaces` is `{ dir, path, manifest }`; `sources` and `configs` are
 * `{ path, text }`; `bins` maps a package name to the commands it installs,
 * because `typescript` is run as `tsc` and a manifest cannot say so; `allow`
 * is the parsed scripts/deps-allow.json.
 */
export function depsFindings({ workspaces, sources, configs = [], bins = {}, allow = {} }) {
  if (workspaces.length === 0)
    return ['no package.json anywhere in the repository; this check would pass vacuously'];
  const findings = [];
  const dirs = workspaces.map((workspace) => workspace.dir);
  const allowed = new Set();
  for (const [name, reason] of Object.entries(allow))
    if (typeof reason === 'string' && reason.trim() !== '') allowed.add(name);
    else
      findings.push(
        `scripts/deps-allow.json: ${printable(name)} has no reason, so it allows nothing`,
      );
  const used = usedNames({ workspaces, sources, configs });

  for (const { dir, path, manifest } of workspaces) {
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const name of Object.keys(declared).toSorted()) {
      if (allowed.has(name)) continue;
      const names = [name, ...(Object.hasOwn(bins, name) ? bins[name] : [])];
      if (names.some((candidate) => used.get(dir).has(candidate))) continue;
      findings.push(
        `${path}: ${printable(name)} is declared and nothing imports it, runs its bin or names it in a config`,
      );
    }
  }

  const declaredIn = new Map(
    workspaces.map(({ dir, manifest }) => [
      dir,
      new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ]),
    ]),
  );

  for (const { path, text } of sources) {
    const dir = workspaceOf(path, dirs);
    const declared = declaredIn.get(dir) ?? new Set();
    for (const name of [...imported(text, path)].toSorted())
      if (!declared.has(name))
        findings.push(
          `${path}: imports ${name}, which ${dir === '' ? 'package.json' : `${dir}/package.json`} does not declare`,
        );
  }

  return findings;
}

/**
 * `text`, read from `path`, as one JSON object, or a refusal naming `path`
 * and never the text: a parser's message quotes it, credentials included.
 */
function jsonObject(path, text) {
  try {
    return readJson(text);
  } catch {
    return refuse('deps', path, 'is not one JSON object this check can read');
  }
}

/** A package.json whose dependency blocks map names to specifiers, so no index is a name. */
function manifestOf(path, text) {
  const manifest = jsonObject(path, text);
  const blocks = [...LOCK_KINDS, 'peerDependencies'].map((kind) => manifest[kind]);
  for (const block of blocks.filter((value) => value !== undefined))
    if (!plain(block) || Object.values(block).some((specifier) => typeof specifier !== 'string'))
      refuse('deps', path, 'dependencies are not a mapping of names to specifiers');
  return manifest;
}

/** The commands each installed package adds, read from node_modules, never beside it. */
export function installedBins(root, names) {
  const bins = {};
  for (const name of names.filter((candidate) => PACKAGE_NAME.test(candidate))) {
    const manifest = resolve(root, 'node_modules', name, 'package.json');
    if (!existsSync(manifest)) continue;
    const { bin } = jsonObject(manifest, readFileSync(manifest, 'utf8'));
    if (typeof bin === 'string') bins[name] = [name.split('/').at(-1)];
    else if (bin) bins[name] = Object.keys(bin);
  }
  return bins;
}

if (isMainModule(import.meta.url)) {
  const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..'));
  const paths = treeFiles(root);

  const read = (path) => ({ path, text: readFileSync(resolve(root, path), 'utf8') });
  const workspaces = paths
    .filter((path) => path === 'package.json' || path.endsWith('/package.json'))
    .map((path) => ({
      path,
      dir: dirname(path) === '.' ? '' : dirname(path),
      manifest: manifestOf(path, readFileSync(resolve(root, path), 'utf8')),
    }));
  const sources = paths.filter((path) => CODE.has(extname(path))).map(read);
  const configs = paths
    .filter((path) => isConfig(path) && !path.endsWith('package.json'))
    .map(read);
  const allowPath = 'scripts/deps-allow.json';
  const allowText = readFileSync(resolve(root, allowPath), 'utf8');
  const { packages: allow = {} } = jsonObject(allowPath, allowText);
  if (!plain(allow)) refuse('deps', allowPath, 'packages is not a mapping of names to reasons');
  const declared = workspaces.flatMap(({ manifest }) =>
    Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }),
  );

  let findings;
  try {
    findings = depsFindings({
      workspaces,
      sources,
      configs,
      bins: installedBins(root, declared),
      allow,
    });
  } catch (error) {
    if (!(error instanceof Unreadable)) throw error;
    exitWith(2, `deps: ${error.message}`);
  }

  console.log(
    `deps: ${workspaces.length} workspace(s), ${declared.length} declared package(s), ` +
      `${Object.keys(allow).length} allowed`,
  );
  for (const finding of findings) console.error(`deps: ${finding}`);

  // The lockfile is read, never rebuilt. An install would rewrite the tree to
  // answer a question about it, and pnpm repairs a lockfile before it runs a
  // script, so a frozen install launched from inside `pnpm run deps:check`
  // was always handed an answer that had already been corrected.
  // Out of the index. A manifest git has not been told about yet is still a
  // manifest, so that one falls back to disk; a lockfile is not, because the
  // copy on disk is the one pnpm has just rewritten, and outside a repository
  // there is no index to read and disk is all there is.
  const onDisk = (path) => {
    const full = resolve(root, path);
    return existsSync(full) ? readFileSync(full, 'utf8') : undefined;
  };
  const tracked = spawnSync('git', ['-C', root, 'rev-parse', '--git-dir']).status === 0;
  const manifestText = (path) => (tracked ? (indexText(root, path) ?? onDisk(path)) : onDisk(path));
  const lockFindings = lockfileFindings(
    tracked ? indexText(root, 'pnpm-lock.yaml') : onDisk('pnpm-lock.yaml'),
    workspaces.map(({ path, dir }) => ({
      path,
      dir,
      manifest: manifestOf(path, manifestText(path)),
    })),
  );
  for (const finding of lockFindings) console.error(`deps: ${finding}`);
  if (lockFindings.length > 0) console.error('deps: run pnpm install and commit the lockfile.');

  if (findings.length > 0 || lockFindings.length > 0) process.exitCode = 1;
  else console.log('deps: every declared package is used and every import is declared.');
}
