// SPDX-License-Identifier: AGPL-3.0-only
// The inventory is worth reading only if it is true, and it is true only if
// something fails when it stops being true.
//
// What is proved here, against a fixture tree rather than this repository, so
// a file added to `scripts/` does not rewrite a test:
//
//   1. Two runs on one tree produce identical bytes. A generated file that
//      moves on its own turns `inventory:fresh` into noise people rerun until
//      it passes.
//   2. A file that says nothing about itself is listed as `(no description)`.
//      Leaving it out would hide it, which is the failure the page exists to
//      stop.
//   3. A committed inventory that no longer matches the tree fails the check,
//      naming the file and printing the diff.
//   4. Workflows and the Markdown beside a skill are on the page at all.
//   5. A purpose is the head of the file and the whole of its first paragraph:
//      a comment buried in the body is not a purpose, a wrapped sentence is
//      one line, a Python docstring counts, and an underline never does. A
//      true-looking page carrying the wrong sentence is worse than a gap,
//      because nobody checks a page that looks answered.
//   6. What cannot be read is refused, not listed as nothing: a missing or
//      empty check-step list, a step that is not a script and its label, and a
//      linked skill directory. A symlinked script is listed like any other.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

const INVENTORY = fileURLToPath(new URL('../../scripts/inventory.mjs', import.meta.url));

let root: string;

/** Write a file and the directories above it. */
function put(path: string, contents: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

// Planted in the inputs the cases malform. The CLI may name a file, never quote one.
const MARKER = ['CF08', 'PLANTED', 'MARKER'].join('_');

/**
 * Run the generator against the fixture, returning its output and exit code.
 * Every case runs it here, so every case also proves the output: no line
 * quotes an input, and every line before a stale page's diff is the
 * generator's own `inventory: ` report.
 */
function inventory(mode: '--check' | '--write'): { status: number; output: string } {
  const result = spawnSync(process.execPath, [INVENTORY, mode, root], { encoding: 'utf8' });
  const output = `${result.stdout}${result.stderr}`;
  expect(output.includes(MARKER), 'the CLI quoted an input').toBe(false);
  const report = output.split(/^diff --git /mu)[0] ?? '';
  expect(
    report.split('\n').every((line) => line === '' || line.startsWith('inventory: ')),
    'the CLI printed a line that is not its own report',
  ).toBe(true);
  return { status: result.status ?? 1, output };
}

const committed = (): string => readFileSync(join(root, 'docs/INVENTORY.md'), 'utf8');

/** The generated row for one path, which is where its purpose is. */
const rowFor = (path: string): string | undefined =>
  committed()
    .split('\n')
    .find((line) => line.includes(`\`${path}\``));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'inventory-cases-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  put('scripts/check.mjs', "export const STEPS = [['lint', 'lint'], ['test', 'tests']];\n");
  put('scripts/described.mjs', '// SPDX-License-Identifier: AGPL-3.0-only\n// What it is for.\n');
  put('apps/web/package.json', '{ "name": "web", "description": "The web application." }\n');
  put('packages/ui/package.json', '{ "name": "ui" }\n');
  put(
    '.claude/skills/tdd/SKILL.md',
    '---\nname: tdd\ndescription: Test-driven development.\n---\n',
  );
  put('tests/ci/one.test.ts', '// SPDX-License-Identifier: AGPL-3.0-only\n// One suite.\n');
});

describe('the generated inventory', () => {
  it('produces identical bytes on two runs of the same tree', () => {
    expect(inventory('--write').status).toBe(0);
    const first = committed();
    expect(inventory('--write').status).toBe(0);
    expect(committed()).toBe(first);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
  });

  it('lists what each file says about itself', () => {
    inventory('--write');
    const page = committed();
    expect(page).toContain('| `apps/web`');
    expect(page).toContain('The web application.');
    expect(page).toContain('What it is for.');
    expect(page).toContain('Test-driven development.');
    expect(page).toContain('| `package.json#scripts.lint`');
    expect(page).toContain('| `tests/ci/one.test.ts`');
  });

  it('shows (no description) for a file that carries no purpose line', () => {
    put('scripts/silent.mjs', '// SPDX-License-Identifier: AGPL-3.0-only\nexport const a = 1;\n');
    inventory('--write');
    const row = committed()
      .split('\n')
      .find((line) => line.includes('`scripts/silent.mjs`'));
    expect(row).toBeDefined();
    expect(row).toContain('(no description)');
    expect(committed()).toContain('| `packages/ui`');
  });

  it('passes the check when the committed inventory matches the tree', () => {
    inventory('--write');
    const result = inventory('--check');
    expect(result.status).toBe(0);
    expect(result.output).toContain('is what the tree says it is');
  });

  it('fails the check with a diff when the committed inventory is stale', () => {
    inventory('--write');
    put('scripts/added-later.mjs', '// SPDX-License-Identifier: AGPL-3.0-only\n// Added later.\n');
    const result = inventory('--check');
    expect(result.status).toBe(1);
    expect(result.output).toContain('docs/INVENTORY.md is stale');
    expect(result.output).toContain('corepack pnpm inventory');
    expect(result.output).toContain('added-later.mjs');
  });

  it('fails the check when there is no committed inventory at all', () => {
    const result = inventory('--check');
    expect(result.status).toBe(1);
    expect(result.output).toContain('docs/INVENTORY.md is stale');
  });
  it('names a workflow by its `name:` and lists the briefs beside a skill', () => {
    put('.github/workflows/ci.yml', 'name: pull request size\n\non:\n  pull_request:\n');
    put('.claude/skills/tdd/AGENT-BRIEF.md', '# Writing agent briefs\n\nWhat a brief is.\n');
    inventory('--write');
    expect(rowFor('.github/workflows/ci.yml')).toContain('pull request size');
    expect(rowFor('.github/workflows/ci.yml')).toContain('workflow');
    expect(rowFor('.claude/skills/tdd/AGENT-BRIEF.md')).toContain('Writing agent briefs');
    expect(rowFor('.claude/skills/tdd/AGENT-BRIEF.md')).toContain('brief template');
  });

  it('lists the scripts a skill carries, with what each one says about itself', () => {
    put(
      '.claude/skills/tdd/scripts/loop.sh',
      '#!/usr/bin/env bash\n# Runs the red-green loop against one failing test.\n',
    );
    put('.claude/skills/tdd/scripts/report.py', '"""Prints the last run as a table."""\n');
    put('.claude/skills/tdd/scripts/fixture.json', '{}\n');
    inventory('--write');
    expect(rowFor('.claude/skills/tdd/scripts/loop.sh')).toContain('skill script');
    expect(rowFor('.claude/skills/tdd/scripts/loop.sh')).toContain(
      'Runs the red-green loop against one failing test.',
    );
    expect(rowFor('.claude/skills/tdd/scripts/report.py')).toContain('skill script');
    expect(rowFor('.claude/skills/tdd/scripts/report.py')).toContain(
      'Prints the last run as a table.',
    );
    expect(rowFor('.claude/skills/tdd/scripts/fixture.json')).toBeUndefined();
  });

  it('reads a placeholder package directory from its README.md', () => {
    put(
      'packages/core-runtime/README.md',
      '---\ndescription: Placeholder for runtime and agent execution.\n---\n\n# Runtime\n',
    );
    inventory('--write');
    expect(rowFor('packages/core-runtime')).toContain('package');
    expect(rowFor('packages/core-runtime')).toContain(
      'Placeholder for runtime and agent execution.',
    );
    expect(rowFor('packages/ui')).toContain('(no description)');
  });

  it('ignores a comment buried in the body and reports (no description)', () => {
    put(
      'scripts/buried.mjs',
      [
        '// SPDX-License-Identifier: AGPL-3.0-only',
        "import { join } from 'node:path';",
        '',
        'const one = 1;',
        'const two = 2;',
        'const three = 3;',
        'const four = 4;',
        'const five = 5;',
        'const six = 6;',
        '',
        '// This describes the line under it, not the file.',
        'export const path = join(String(one), String(six));',
        '',
      ].join('\n'),
    );
    inventory('--write');
    expect(rowFor('scripts/buried.mjs')).toContain('(no description)');
    expect(committed()).not.toContain('describes the line under it');
  });

  it('joins a wrapped comment paragraph into one line', () => {
    put(
      'scripts/wrapped.mjs',
      [
        '// SPDX-License-Identifier: AGPL-3.0-only',
        '// The sentence starts on one line, carries on',
        '// over a second line and finishes',
        '// on a third.',
        '//',
        '// A later paragraph, which is not the purpose.',
        '',
      ].join('\n'),
    );
    inventory('--write');
    const row = rowFor('scripts/wrapped.mjs');
    expect(row).toContain(
      'The sentence starts on one line, carries on over a second line and finishes on a third.',
    );
    expect(row).not.toContain('later paragraph');
  });

  it('reads a Python docstring as the purpose, first paragraph only', () => {
    put(
      'scripts/gate.py',
      [
        '#!/usr/bin/env python3',
        '# SPDX-License-Identifier: AGPL-3.0-only',
        '"""The contamination gate.',
        '',
        'A second paragraph, which is not the purpose.',
        '"""',
        '',
        'import sys',
        '',
      ].join('\n'),
    );
    inventory('--write');
    const row = rowFor('scripts/gate.py');
    expect(row).toContain('The contamination gate.');
    expect(row).not.toContain('second paragraph');
  });

  it('skips an underline written under a title', () => {
    put(
      'scripts/underlined.py',
      ['#!/usr/bin/env python3', '"""The sweep', '------------', '', 'Body.', '"""', ''].join('\n'),
    );
    put(
      'scripts/dashed.mjs',
      ['// SPDX-License-Identifier: AGPL-3.0-only', '// The title', '// -----------', ''].join(
        '\n',
      ),
    );
    inventory('--write');
    expect(rowFor('scripts/underlined.py')).toContain('The sweep');
    expect(rowFor('scripts/underlined.py')).not.toContain('--');
    expect(rowFor('scripts/dashed.mjs')).toContain('The title');
    expect(rowFor('scripts/dashed.mjs')).not.toContain('--');
  });

  it('refuses a missing check runner, a missing STEPS and an empty STEPS', () => {
    for (const runner of [
      undefined,
      'export const unrelated = 1;\n',
      'export const STEPS = [];\n',
    ]) {
      if (runner === undefined) rmSync(join(root, 'scripts/check.mjs'));
      else put('scripts/check.mjs', runner);
      inventory('--write');
      const result = inventory('--check');
      expect(result.status, String(runner)).toBe(1);
      expect(result.output, String(runner)).toContain('scripts/check.mjs');
    }
  });

  it('refuses a check step that is not a script and its label', () => {
    for (const steps of [
      "['lint']",
      "[['lint']]",
      "[['lint', 'lint', 'extra']]",
      "[['lint', 3]]",
      "[['', 'lint']]",
      '[null]',
    ]) {
      put('scripts/check.mjs', `export const STEPS = ${steps};\n`);
      inventory('--write');
      const result = inventory('--check');
      expect(result.status, steps).toBe(1);
      expect(result.output, steps).toContain('scripts/check.mjs');
    }
  });

  it('refuses a sparse or blank check step with the problem message, not a crash', () => {
    for (const steps of [
      "[[, 'lint']]",
      "[['lint', , ]]",
      "[, ['lint', 'lint']]",
      "[[' ', 'lint']]",
      "[['lint', '  ']]",
    ]) {
      put('scripts/check.mjs', `export const STEPS = ${steps};\n`);
      inventory('--write');
      const result = inventory('--check');
      expect(result.status, steps).toBe(1);
      expect(result.output, steps).toContain('STEPS are not [script, label] pairs');
    }
  });

  it('refuses a linked skill directory rather than leaving it off the page', () => {
    put('docs/demo/SKILL.md', '---\nname: demo\ndescription: A linked skill.\n---\n');
    put('docs/demo/tool.mjs', '// A linked skill script.\n');
    mkdirSync(join(root, '.claude/skills'), { recursive: true });
    inventory('--write');
    symlinkSync('../../docs/demo', join(root, '.claude/skills/demo'));
    const result = inventory('--check');
    expect(result.status).toBe(2);
    expect(result.output).toContain('.claude/skills/demo');
  });

  it('refuses what its parser cannot read or warns about, naming the file', () => {
    put('.github/workflows/ci.yml', 'name: CI\non: push\n');
    inventory('--write');
    expect(inventory('--check').status, 'control').toBe(0);
    const unreadable: Record<string, [string, string]> = {
      'a duplicate workflow key': ['.github/workflows/ci.yml', `name: CI\nname: ${MARKER}\n`],
      'a tab as workflow indentation': ['.github/workflows/ci.yml', `jobs:\n\ttest: ${MARKER}\n`],
      'an unsupported workflow tag': [
        '.github/workflows/ci.yml',
        `name: CI\non: push\nenv:\n  SECRET: !unsupported ${MARKER}\n`,
      ],
      'an unknown workflow directive': [
        '.github/workflows/ci.yml',
        `%FOO ${MARKER}\n---\nname: CI\n`,
      ],
      'a second workflow document': [
        '.github/workflows/ci.yml',
        `name: CI\n---\nname: ${MARKER}\n`,
      ],
      'an unsupported front matter tag': [
        '.claude/skills/tdd/SKILL.md',
        `---\ndescription: !unsupported ${MARKER}\n---\n`,
      ],
      'a duplicate front matter key': [
        '.claude/skills/tdd/SKILL.md',
        `---\ndescription: ${MARKER}\ndescription: Again.\n---\n`,
      ],
      'a check runner that does not load': [
        'scripts/check.mjs',
        `export const STEPS = [] ${MARKER};\n`,
      ],
    };
    for (const [shape, [path, contents]] of Object.entries(unreadable)) {
      const readable = readFileSync(join(root, path), 'utf8');
      put(path, contents);
      const result = inventory('--check');
      put(path, readable);
      expect(result.status, shape).not.toBe(0);
      expect(result.output.includes(path), shape).toBe(true);
    }
  });

  it('refuses a package manifest it cannot read rather than reading the README', () => {
    put('apps/web/README.md', '# The web application\n');
    put(
      'apps/web/package.json',
      String.raw`{"name":"web","description":"The web application, caf\u00E9.","keywords":[["a"],["b",["c"]]],"x":{"name":"y"}}`,
    );
    expect(inventory('--write').status, 'control').toBe(0);
    expect(rowFor('apps/web'), 'control').toContain('The web application, caf\u00E9.');
    for (const manifest of [
      '{',
      `{"description":"${MARKER}",}`,
      `{"description":"One.","description":"${MARKER}"}`,
      `{"x":{"description":"One.","description":"${MARKER}"}}`,
      'null',
    ]) {
      put('apps/web/package.json', manifest);
      expect(inventory('--write').status, manifest.length.toString()).toBe(2);
      const result = inventory('--check');
      expect(result.status, manifest.length.toString()).toBe(2);
      expect(result.output).toContain('apps/web/package.json');
    }
  });

  it('lists a symlinked script like any other', () => {
    put('docs/source.txt', '// The linked purpose.\n');
    symlinkSync('../docs/source.txt', join(root, 'scripts/linked.mjs'));
    inventory('--write');
    expect(rowFor('scripts/linked.mjs')).toBeDefined();
    expect(rowFor('scripts/linked.mjs')).toContain('The linked purpose.');
  });

  it('lists every script extension the duplicate gate reads as a script', () => {
    for (const path of [
      'scripts/runner.ts',
      'scripts/tool.mts',
      '.claude/skills/tdd/scripts/tool.ts',
    ])
      put(path, '// A typed script.\n');
    inventory('--write');
    expect(rowFor('scripts/runner.ts')).toBeDefined();
    expect(rowFor('scripts/runner.ts')).toContain('script');
    expect(rowFor('scripts/tool.mts')).toContain('A typed script.');
    expect(rowFor('.claude/skills/tdd/scripts/tool.ts')).toContain('skill script');
  });

  it('reads a YAML block scalar description and workflow name as their text', () => {
    put(
      '.claude/skills/tdd/SKILL.md',
      '---\nname: tdd\ndescription: >-\n  Folded across\n  two lines.\n---\n',
    );
    put('.github/workflows/ci.yml', 'name: |\n  Literal name\non: push\n');
    inventory('--write');
    expect(rowFor('.claude/skills/tdd')).toContain('Folded across two lines.');
    expect(rowFor('.github/workflows/ci.yml')).toContain('Literal name');
  });
});
