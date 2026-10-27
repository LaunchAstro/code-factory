// SPDX-License-Identifier: AGPL-3.0-only
// Git and GitHub both supply changed paths as newline-delimited text. Keep the
// boundary parsing in one place so callers receive stable unique paths. A space
// is part of a git path, so only a CRLF line ending's carriage return goes:
// trimming once turned ` docs/x.mjs` into the exempt `docs/x.mjs`.

export function changedFilesFrom(text) {
  const seen = new Set();
  return text
    .split('\n')
    .map((path) => path.replace(/\r$/u, ''))
    .filter((path) => {
      const first = !seen.has(path);
      seen.add(path);
      return path !== '' && first;
    });
}
