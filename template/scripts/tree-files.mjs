// SPDX-License-Identifier: AGPL-3.0-only
// The files the duplication gate and the dependency gate both read.
//
// The two gates only hold if they read the same tree: a copy hidden in a
// directory one gate skips and the other does not is a copy that ships. So
// the list of what is skipped lives here, once, and both gates import it.
//
// A skip matches a whole directory name, never a substring of one. `dist/` is
// build output and `redist/` is a directory somebody wrote, so the first is
// skipped and the second is read; the same for `node_modules`. Getting this
// wrong is silent in both directions, which is why it has its own module and
// its own cases.
//
// What is skipped, and why:
//
//   node_modules  installed code, not ours.
//   dist          build output, a copy of the source by construction.
//   tests/**/fixtures/**  planted inputs, including deliberate duplicates.
//   .claude/skills/, .codex/  vendored skills, kept byte-for-byte as they
//                 arrived so a refresh is a readable diff.
//   pnpm-lock.yaml  generated, and read as a lockfile rather than as source.

import { execFileSync } from 'node:child_process';

/** The directory names that are skipped wherever they appear in a path. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist']);

/** Vendored third-party trees, matched by prefix because that is what they are. */
const VENDORED = ['.claude/skills/', '.codex/'];

/** The generated files that are read as data, if at all, and never as source. */
const GENERATED = new Set(['pnpm-lock.yaml']);

/**
 * Whether neither gate reads `path`, a repository-relative POSIX path.
 *
 * Every directory test is against a whole path segment, so `redist/x.mjs` and
 * `predist/x.mjs` are read and `dist/x.mjs` and `a/dist/x.mjs` are not.
 */
export function excluded(path) {
  const segments = path.split('/');
  const directories = segments.slice(0, -1);
  return (
    directories.some((segment) => SKIPPED_DIRECTORIES.has(segment)) ||
    (segments[0] === 'tests' && directories.includes('fixtures')) ||
    GENERATED.has(segments.at(-1)) ||
    VENDORED.some((prefix) => path.startsWith(prefix))
  );
}

/** Every file in the working tree both gates read, repository-relative, sorted. */
export function treeFiles(root) {
  return [
    ...new Set(
      execFileSync(
        'git',
        ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { encoding: 'utf8' },
      )
        .split('\0')
        .filter(Boolean),
    ),
  ]
    .filter((path) => !excluded(path))
    .toSorted();
}
