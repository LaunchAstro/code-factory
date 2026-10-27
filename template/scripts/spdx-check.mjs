// SPDX-License-Identifier: AGPL-3.0-only
// Every owned source file carries one correct SPDX licence header; vendored code is left alone.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { localEnv } from './candidate-snapshot.mjs';
import { isMainModule } from './main-module.mjs';

const extensions = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.py',
  '.sh',
  '.sql',
]);

export function ownedSources(root) {
  return [
    ...new Set(
      execFileSync(
        'git',
        ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { encoding: 'utf8', env: localEnv },
      )
        .split('\0')
        .filter(Boolean),
    ),
  ]
    .filter((path) => !path.startsWith('.claude/skills/') && !path.startsWith('.codex/skills/'))
    .filter(
      (path) =>
        extensions.has(extname(path)) || (path.startsWith('.husky/') && extname(path) === ''),
    )
    .toSorted();
}

// Each language's own comment: in shell, `//` begins a command. Extensionless
// sources are Husky hooks, which are shell.
const comments = { '.py': '#', '.sh': '#', '.sql': '--', '': '#' };

// The header is the first line, or the second after a shebang: a line no string
// literal can have opened. A tracked source that cannot be read is an error,
// never a file quietly left out.
export function headerErrors(root, sources = ownedSources(root)) {
  return sources.filter((path) => {
    const lines = readFileSync(resolve(root, path), 'utf8').split(/\r?\n/u).slice(0, 6);
    const markers = lines.filter((line) => /^(?:\/\/|#|--)\s*SPDX-License-Identifier:/u.test(line));
    const header = lines[lines[0].startsWith('#!') ? 1 : 0];
    const comment = comments[extname(path)] ?? '//';
    return markers.length !== 1 || header !== `${comment} SPDX-License-Identifier: AGPL-3.0-only`;
  });
}

if (isMainModule(import.meta.url)) {
  try {
    const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..'));
    if (process.argv.length > 3) throw new Error('usage: spdx-check.mjs [working-repository]');
    const sources = ownedSources(root);
    if (sources.length === 0) throw new Error('no owned source files');
    const failures = headerErrors(root, sources);
    for (const path of failures) console.error(`spdx: ${path} needs one correct source header`);
    console.log(`spdx: ${sources.length} owned source files, ${failures.length} invalid headers`);
    process.exitCode = failures.length > 0 ? 1 : 0;
  } catch {
    console.error('spdx: no owned source found, or discovery or a header read failed');
    process.exitCode = 2;
  }
}
