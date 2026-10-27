// SPDX-License-Identifier: AGPL-3.0-only
// Every relative link in the documentation points at a tracked file.
//
// The documentation is the part of this repository that a reader trusts
// without running anything, and it is the part nothing checks. CONTRIBUTING.md
// links docs/agents/review-checkpoint.md, AGENTS.md links the ADRs, the pull
// request template links docs/TRAPS.md. A file moves, the link stays, and the
// reader concludes the rule it described was never real.
//
// Two rules, both about relative links only. An external URL is somebody
// else's uptime and this check says nothing about it.
//
//   1. A relative link resolves to a tracked file that is a file on this
//      disk inside the repository: not one that is only on this disk, not a
//      tracked one deleted or replaced by a directory, not a directory, not a
//      path or a tracked symlink leading outside the repository.
//   2. A link to a heading in another file resolves to that file. The anchor
//      itself is not checked, because Markdown anchor generation differs
//      between renderers and a wrong guess here would be worse than silence.
//
// No tracked document at all is a refusal, exit 2: a run that read nothing
// cannot say every link resolves. The index is read once, and the documents
// counted are the documents read. A tracked document that cannot be read as a
// file inside the repository, from the file its checks saw, is refused.
//
// Usage:
//   node scripts/doc-links-check.mjs [repository-root]

import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { exitWith, isMainModule } from './main-module.mjs';
import { fenceAfter } from './markdown.mjs';

// Inline links only: [text](target). Reference definitions and bare autolinks
// are not used anywhere in this repository's documentation, and a pattern that
// matched them loosely would report on code fences as well.
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/gu;

// Vendored material is kept byte-for-byte as it arrived, so its links are not
// ours to fix. The same exclusion the SPDX header check makes.
const VENDORED = ['.claude/skills/', '.codex/'];

/**
 * The lines of a Markdown source with every fenced code block blanked, its
 * fence lines included, so a line's number is still its own, by the fence rule
 * in markdown.mjs. One left open runs to the end. Fences inside list
 * items and block quotes are not followed. A line opening with
 * `<!--` starts a comment block that runs to the line holding `-->`; its lines
 * are kept but open no fence, as Sol's CF-11-FIX2 review found a backtick line
 * in a closed comment hiding every link after it.
 */
export function unfencedLines(markdown) {
  let fence = '';
  let comment = false;
  return String(markdown)
    .split(/\r\n|\r|\n/u)
    .map((line) => {
      const opens = fence === '' && !comment && /^ {0,3}<!--/u.test(line);
      if (comment || opens) {
        comment = !line.slice(opens ? line.indexOf('<!--') + 4 : 0).includes('-->');
        return line;
      }
      const inside = fence !== '';
      fence = fenceAfter(fence, line);
      return inside || fence !== '' ? '' : line;
    });
}

/** Every relative link target in a Markdown source, with the line it sits on. */
export function linkTargets(markdown) {
  const found = [];
  for (const [index, line] of unfencedLines(markdown).entries()) {
    for (const match of line.matchAll(LINK)) {
      const target = match[1];
      if (target === undefined) continue;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu.test(target)) continue;
      found.push({ target, line: index + 1 });
    }
  }
  return found;
}

/** The repository path a link target points at, with any anchor removed. */
export function targetPath(fromFile, target) {
  const withoutAnchor = target.split('#')[0] ?? '';
  if (withoutAnchor === '') return '';
  return join(dirname(fromFile), decodeURIComponent(withoutAnchor));
}

/**
 * Does the link name a file in `tracked`, the repository's tracked files? A
 * directory, an untracked file and a path outside the repository are not in
 * it, although the filesystem would have answered for all three.
 */
export function resolves(tracked, fromFile, target) {
  const path = targetPath(fromFile, target);
  return path === '' || tracked.has(path);
}

/**
 * Every tracked path from one read of the index, mapped to where it really is
 * and that file's identity when it is a file under the repository's real root,
 * else to undefined. Sol's CF-11-FIX1 review found index membership alone
 * passing a tracked target deleted, replaced by a directory, or a symlink to a
 * file outside. Sol's CF-11-FIX2 review found those paths filtered out before
 * documents were chosen, so such a document dropped out unread; it stays in
 * the map and is refused.
 */
export function trackedFiles(root) {
  const real = realpathSync(root) + sep;
  const files = new Map();
  for (const path of execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)) {
    try {
      const where = realpathSync(resolve(root, path));
      const stat = statSync(where, { bigint: true });
      files.set(path, where.startsWith(real) && stat.isFile() ? { where, stat } : undefined);
    } catch {
      files.set(path, undefined);
    }
  }
  return files;
}

/** The tracked Markdown outside the vendored directories, from `paths`. */
export const documents = (paths) =>
  [...paths]
    .filter((path) => path.endsWith('.md'))
    .filter((path) => !VENDORED.some((prefix) => path.startsWith(prefix)))
    .toSorted();

/**
 * The text of the file `checked` describes, or undefined. Sol's CF-11-FIX2
 * review found the path read again after its checks, so a document swapped for
 * a symlink leading outside in between was read. One descriptor, opened without
 * following a final symlink, must still be that same regular file.
 */
function readChecked(checked) {
  if (checked === undefined) return undefined;
  let fd;
  try {
    fd = openSync(checked.where, constants.O_RDONLY | constants.O_NOFOLLOW);
    const now = fstatSync(fd, { bigint: true });
    const same = now.isFile() && now.dev === checked.stat.dev && now.ino === checked.stat.ino;
    return same ? readFileSync(fd, 'utf8') : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Every broken link, and every document that could not be read as a file
 * inside the repository, in the documents of `tracked`, the map trackedFiles()
 * read.
 */
export function brokenLinks(tracked) {
  const files = new Set([...tracked].filter(([, file]) => file).map(([path]) => path));
  const failures = [];
  for (const path of documents(tracked.keys())) {
    const markdown = readChecked(tracked.get(path));
    if (markdown === undefined) failures.push(`${path}: not read as a file inside the repository`);
    for (const { target, line } of linkTargets(markdown ?? '')) {
      if (!resolves(files, path, target))
        failures.push(`${path}:${line}: ${target} does not resolve`);
    }
  }
  return failures.toSorted();
}

if (isMainModule(import.meta.url)) {
  const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..'));
  const tracked = trackedFiles(root);
  const checked = documents(tracked.keys()).length;
  if (checked === 0) {
    exitWith(2, 'doc-links: no tracked Markdown outside the vendored directories to check.');
  }
  const failures = brokenLinks(tracked);

  console.log(`doc-links: ${checked} document(s) checked`);

  if (failures.length > 0) {
    console.error(`\ndoc-links: ${failures.length} broken link(s) or unread document(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\ndoc-links: a link that does not resolve teaches a reader that the rule it\n' +
        'doc-links: described was never real. Fix the link or move the file back.',
    );
    process.exitCode = 1;
  } else {
    console.log('doc-links: every relative link resolves.');
  }
}
