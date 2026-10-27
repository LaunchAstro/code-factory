// SPDX-License-Identifier: AGPL-3.0-only
// Whether this module is the file node was asked to run.
//
// Every check under `scripts/` is two things at once: a module whose functions
// its cases import, and a command the workflow runs. The guard at the bottom of
// each one is what keeps the second from happening during the first, so a test
// that imports `jobs` does not also run the job-timeout check.
//
// Thirteen of them wrote that guard by comparing `import.meta.url` against the
// invoked path made absolute and no more, and the two sides are not the same
// kind of path. Node resolves symlinks when it loads
// an ES module, so the left-hand side is where the file really is. `resolve`
// only makes a path absolute, so the right-hand side is the path as it was
// typed. Run a script by an absolute path through a symlinked scripts
// directory and the two differ: the block does not run, nothing is printed, and
// the process exits 0. A check that cannot be told apart from a check that
// passed is the worst of the available failures, and `scripts/check.mjs` was
// one of the thirteen, so the whole suite was silent under the same condition.
// Issue 19.
//
// A symlinked path is ordinary: a tool directory linked into a sandbox, and a
// checkout under `os.tmpdir()` on macOS, where `/tmp` and `/var` are symlinks
// into `/private`, both reach it. The repository's own acceptance runner builds
// its worktrees there.
//
// One reader rather than thirteen copies of a line, so the next script written
// cannot copy the broken one from a neighbour.
//
// The other things a command here needs live beside it, because every
// script already imports this file and a copy of a script is run with only
// this file beside it: how it refuses, how it reads JSON, which pnpm it runs,
// and the environment its local Git reads get.

import { realpathSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The file node was asked to run, or nothing. Under `--eval`, `--print` or a
// program on stdin there is no entry file at all: `process.argv[1]` is then
// the first user argument, and asking the filesystem about a string that was
// never a path is how a JSON argument ends up looking like a missing file.
// Node exposes no "is there an entry file" of its own, so the flags it did
// accept are the nearest thing to asking it: `-e`, `-p`, `--eval`, `--print`,
// the long forms with `=value`, and the clusters `-pe` and `-ep`, where node
// folds the two short flags into one token. That set is named as string tests
// rather than one pattern, because both edges of a pattern went wrong in turn:
// reading a letter out of an open-ended token took `-expose-gc` for eval, and
// anchoring the `=value` tail rejected a program with a newline in it, since
// `.` does not cross one. Nothing after the `=` is read, so a value's newlines,
// quotes and length cannot matter.
const entry = () => {
  const evaluated = process.execArgv.some(
    (flag) =>
      ['-e', '-p', '-pe', '-ep', '--eval', '--print'].includes(flag) ||
      flag.startsWith('--eval=') ||
      flag.startsWith('--print='),
  );
  const first = process.argv[1];
  if (evaluated || !first || first === '-') return undefined;
  return first;
};

// The real location of a path, as a file URL. A path that cannot be resolved
// is a refusal, not a false. Falling back to the absolute form looked modest,
// but the two sides then stop matching for a reason that has nothing to do
// with which file node was asked to run: remove the entry symlink after node
// has loaded through it and the guard answers false, so the script exits 0
// having printed nothing, while the same invocation with the link intact
// exits 2 and says what is missing. That is the silent pass this module was
// written to remove, arrived at from the other side. Both sides here are a
// file node did read, so a lookup that fails says so and the caller exits
// non-zero.
const real = (path) => {
  const absolute = resolve(path);
  try {
    return pathToFileURL(realpathSync(absolute)).href;
  } catch (cause) {
    throw new Error(`the main-module guard cannot resolve ${absolute}`, { cause });
  }
};

/**
 * True when `url` names the module node was invoked with.
 *
 * Pass `import.meta.url`. False when the module was imported, when node was
 * invoked with `--eval` or from a pipe, and when node is running some other
 * file, so one script importing another does not make the imported one run.
 *
 * Throws when either path cannot be resolved. A guard that answered false
 * there would hand a caller the exit code of a check that passed.
 */
export const isMainModule = (url) => {
  const invoked = entry();
  return invoked !== undefined && real(fileURLToPath(url)) === real(invoked);
};

/**
 * Print `<tool>: <file>: <reason>` and exit. The reason is fixed text the
 * caller wrote: never a parser's message and never what the file holds, both
 * of which quote the input, whatever the input carries.
 */
export function refuse(tool, file, reason, code = 2) {
  exitWith(code, `${tool}: ${file}: ${reason}`);
}

// A synchronous pause: `Atomics.wait` is the one way to sleep on Node's main
// thread without spinning.
const pause = new Int32Array(new SharedArrayBuffer(4));

/**
 * Write each line to standard error as one `console.error` call per line
 * would, then exit with `code`. `process.exit` does not wait for a write still
 * queued, and on macOS Node writes to a pipe asynchronously, so a refusal
 * written with `console.error` just before it could arrive without its
 * reason: issue 316. These bytes are written synchronously and whole before
 * the exit. A pipe that is full and non-blocking (Node makes its own stdio
 * pipes so) is waited on until its reader drains it. Any other write error
 * loses the text but never the exit code, as with `console.error`.
 */
export function exitWith(code, ...lines) {
  const bytes = Buffer.from(lines.map((line) => `${line}\n`).join(''));
  let written = 0;
  while (written < bytes.length) {
    try {
      written += writeSync(2, bytes, written);
    } catch (error) {
      if (error?.code !== 'EAGAIN') break;
      Atomics.wait(pause, 0, 0, 10);
    }
  }
  process.exit(code);
}

/**
 * `text` as a JSON object, or a throw. `JSON.parse` takes exactly JSON, but a
 * repeated key overwrites the one before it, so one file says two things and
 * the reader sees one: `repeatsKey` refuses that.
 */
export function readJson(text) {
  const value = JSON.parse(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('not a JSON object');
  if (repeatsKey(text)) throw new TypeError('a repeated key');
  return value;
}

/**
 * Whether any object in `text`, which `JSON.parse` has already taken, names a
 * key twice. The keys are scanned again, decoded, per object, so `"MIT"` and
 * `"M\u0049T"` are the same key.
 */
export function repeatsKey(text) {
  const open = [];
  let last = '';
  for (const [token] of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\]:]/gu)) {
    if (token === '{') open.push(new Set());
    else if (token === '[') open.push(undefined);
    else if (token === '}' || token === ']') open.pop();
    else if (token !== ':') last = token;
    else if (open.at(-1).has(JSON.parse(last))) return true;
    else open.at(-1).add(JSON.parse(last));
  }
  return false;
}

/**
 * The pnpm running this script, not whatever "pnpm" resolves to on PATH:
 * under corepack there may be no pnpm on PATH at all. `npm_execpath` names it;
 * a JavaScript file there is run through this node. With nothing named, it
 * is `pnpm` from PATH. Run it as `command`, with `prefix` before its own
 * arguments.
 */
export function packageManager() {
  const execPath = process.env['npm_execpath'];
  if (execPath === undefined) return { command: 'pnpm', prefix: [] };
  if (/\.[cm]?js$/u.test(execPath)) return { command: process.execPath, prefix: [execPath] };
  return { command: execPath, prefix: [] };
}

// What Git needs to find itself, its configuration and a temporary directory.
// Reading commits already in the clone needs no credential, so no GitHub or
// registry token may reach Git, or a tool such as commitlint that runs Git in
// turn. An allowlist, because a list of what to remove misses the next token's
// name: Sol's CF-09 fourth round found an ambient GH_TOKEN in every Git child
// of the range and size gates, and its second review of PR 88 found the same
// in the run record's Git.
const LOCAL_GIT_ENV = new Set(
  [
    'PATH',
    'HOME',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'XDG_CONFIG_HOME',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_SYSTEM',
    'GIT_CONFIG_NOSYSTEM',
    'SystemRoot',
  ].map((name) => name.toUpperCase()),
);

/**
 * This process's environment cut to what a local Git read needs. The
 * comparison ignores case, because Windows spells PATH as `Path`.
 */
export const localGitEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([name]) => LOCAL_GIT_ENV.has(name.toUpperCase())),
  );
