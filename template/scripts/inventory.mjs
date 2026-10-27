// SPDX-License-Identifier: AGPL-3.0-only
// docs/INVENTORY.md: the page a build lane reads before it builds anything.
//
// Agents rebuild what already exists because nothing tells them it exists.
// Six pixel generators on one home page is what that costs. A hand-kept list
// would answer it for a week and then quietly stop being true, so this file
// generates the list from the tree and `inventory:fresh` fails the check run
// when the committed copy and the tree disagree.
//
// Nine areas, each its own table: applications, packages, scripts, check
// steps, workflows, skills, brief templates, skill scripts, tests. A row is a
// path, a kind and a one-line purpose. The kinds are fixed (package, module,
// script, check step, workflow, skill, brief template, skill script, test
// suite), so a data file under `scripts/` is not a script and
// `tests/gate/canary.txt` is not a test suite.
//
// A purpose is whatever the file already says about itself: a package
// description, a Markdown front matter `description`, a workflow `name:`, or
// the comment block at the head of the file. A package directory with no
// manifest falls back to its `README.md`. Head means head: the block has to
// start within the first few non-blank lines once a shebang, an SPDX marker,
// `use strict`, front matter and the import block are out of the way, because
// a comment sitting beside line 200 describes line 200 and not the file. A
// wrapped paragraph is joined back into one line; a Python docstring counts,
// and its first paragraph is the purpose. Nothing found is `(no description)`,
// which is the honest answer and the nudge to write one. One line: whitespace
// collapsed, `|` escaped, cut at a word boundary past 100 characters.
//
// Output is a function of the tree alone. No timestamps, every list sorted, so
// two runs on the same tree produce identical bytes and a diff means the tree
// moved.
//
// Usage:
//   node scripts/inventory.mjs [--check | --write] [repository-root]

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';
import { SCRIPT } from './dup-check.mjs';
import { exitWith, isMainModule, readJson, refuse } from './main-module.mjs';

export const OUTPUT = 'docs/INVENTORY.md';
export const NO_DESCRIPTION = '(no description)';

// Longer than this and the table stops being scannable, which is the only
// thing the table is for.
const PURPOSE_LIMIT = 100;

// A purpose sits at the head of the file. Past this many non-blank lines, a
// comment is describing the code beside it.
const HEAD_LINES = 5;

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git']);

// What a script is comes from scripts/dup-check.mjs, so the page lists every
// script the duplicate gate compares. A module is a script a shell does not run.
const WORKFLOW_EXTENSIONS = new Set(['.yml', '.yaml']);
const MODULE_EXTENSIONS = new Set([...SCRIPT].filter((ext) => !['.sh', '.py'].includes(ext)));

const SHEBANG = /^#!/u;
const SPDX = /^\s*(?:\/\/|#|--)\s*SPDX-License-Identifier:/u;
const USE_STRICT = /^['"]use strict['"];?$/u;
const IMPORT = /^(?:import\b|from\s+\S+\s+import\b|(?:const|let|var)\s+.*=\s*require\()/u;
const LINE_COMMENT = /^(?:\/\/+|#+|--)\s?(.*)$/u;
const BLOCK_OPEN = /^\/\*+\s?(.*)$/u;
const BLOCK_LINE = /^\*+\s?(.*)$/u;
const BLOCK_CLOSE = /\*\//u;
const DOCSTRING = /^(?:[rubfRUBF]{1,2})?("""|''')(.*)$/u;
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

// A row of dashes or equals signs under a title is an RST or Markdown
// underline. It opens with `--`, so a comment scanner reads it as a comment
// unless it is named.
const UNDERLINE = /^(?:-{2,}|={2,})$/u;

/** Whether a line is only an underline, with or without a comment marker. */
const underline = (text) => UNDERLINE.test((LINE_COMMENT.exec(text)?.[1] ?? text).trim());

/** One table cell: one line, no pipe, no run past the limit. */
export function oneLine(text) {
  const collapsed = text.replaceAll(/\s+/gu, ' ').trim();
  if (collapsed === '') return undefined;
  const space = collapsed.lastIndexOf(' ', PURPOSE_LIMIT);
  const cut =
    collapsed.length <= PURPOSE_LIMIT
      ? collapsed
      : `${collapsed.slice(0, space > 0 ? space + 1 : PURPOSE_LIMIT).trimEnd()}...`;
  return cut.replaceAll('|', '\\|');
}

const brace = (text) => [...text].reduce((depth, c) => depth + (c === '{') - (c === '}'), 0);

/**
 * The index of the first line that could be a purpose: past a shebang, SPDX
 * markers, `use strict` and the import block, all of which name an
 * interpreter, a licence or a dependency rather than a purpose.
 */
function afterPrologue(lines) {
  let index = 0;
  while (index < lines.length) {
    const text = lines[index].trim();
    const prologue =
      text === '' ||
      SPDX.test(text) ||
      USE_STRICT.test(text) ||
      (index === 0 && SHEBANG.test(text));
    if (prologue) {
      index += 1;
      continue;
    }
    if (!IMPORT.test(text)) return index;
    let depth = brace(text);
    index += 1;
    while (index < lines.length && depth > 0) {
      depth += brace(lines[index]);
      index += 1;
    }
  }
  return index;
}

/** A Python module docstring, first paragraph only. */
function docstringAt(lines, index) {
  const opened = DOCSTRING.exec(lines[index].trim());
  if (!opened) return undefined;
  const [, quote, rest] = opened;
  const closes = rest.indexOf(quote);
  if (closes >= 0) return rest.slice(0, closes);
  const paragraph = [rest];
  for (let at = index + 1; at < lines.length; at += 1) {
    const text = lines[at].trim();
    const ends = text.indexOf(quote);
    if (ends >= 0) {
      paragraph.push(text.slice(0, ends));
      break;
    }
    if (text === '' || UNDERLINE.test(text)) break;
    paragraph.push(text);
  }
  return paragraph.join(' ');
}

/**
 * The comment paragraph starting at `index`, joined into one line. A wrapped
 * sentence is one purpose, not one purpose per physical line, so continuation
 * lines are taken until the first blank comment line or the end of the block.
 */
function commentBlockAt(lines, index) {
  const first = lines[index].trim();
  if (underline(first)) return undefined;

  const docstring = docstringAt(lines, index);
  if (docstring !== undefined) return docstring;

  const block = BLOCK_OPEN.exec(first);
  if (block) {
    const paragraph = [block[1].replace(BLOCK_CLOSE, '').trim()];
    if (!BLOCK_CLOSE.test(first)) {
      for (let at = index + 1; at < lines.length; at += 1) {
        const text = lines[at].trim();
        const closes = BLOCK_CLOSE.test(text);
        const body = (BLOCK_LINE.exec(text)?.[1] ?? text).replace(BLOCK_CLOSE, '').trim();
        if (body === '' || UNDERLINE.test(body)) break;
        paragraph.push(body);
        if (closes) break;
      }
    }
    return paragraph.join(' ');
  }

  const comment = LINE_COMMENT.exec(first);
  if (!comment) return undefined;
  const paragraph = [comment[1]];
  for (let at = index + 1; at < lines.length; at += 1) {
    const next = LINE_COMMENT.exec(lines[at].trim());
    if (!next || next[1].trim() === '' || underline(next[1])) break;
    paragraph.push(next[1]);
  }
  return paragraph.join(' ');
}

/**
 * What the head of the file says it is for. The comment block has to start
 * within the first `HEAD_LINES` non-blank lines after the prologue; a comment
 * found further down belongs to the code beside it, not to the file.
 */
export function purposeFromHead(source) {
  const matter = FRONT_MATTER.exec(source);
  const lines = (matter ? source.slice(matter[0].length) : source).split(/\r?\n/u);
  const start = afterPrologue(lines);
  let seen = 0;
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].trim() === '') continue;
    seen += 1;
    if (seen > HEAD_LINES) return undefined;
    const paragraph = commentBlockAt(lines, index);
    if (paragraph === undefined) continue;
    const purpose = oneLine(paragraph);
    if (purpose !== undefined) return purpose;
  }
  return undefined;
}

/**
 * The string under `key` in a YAML document, read by a parser so `>-` and `|`
 * give their text. The parser's own warnings print an excerpt of the file, so
 * they are kept quiet, and a warning refuses the same as an error does.
 */
const yamlString = (text, key, path) => {
  const document = parseDocument(text, { logLevel: 'error' });
  if (document.errors.length + document.warnings.length > 0)
    refuse('inventory', path, 'is not YAML it reads cleanly, so its purpose cannot be read');
  const value = document.get(key);
  return typeof value === 'string' ? oneLine(value) : undefined;
};

/** A Markdown file's front matter `description`, which is how skills declare theirs. */
export function purposeFromFrontMatter(source, path) {
  const block = FRONT_MATTER.exec(source);
  return block ? yamlString(block[1], 'description', path) : undefined;
}

/** A workflow says what it is in its `name:`, which is what its checks report. */
export const purposeFromWorkflowName = (source, path) => yamlString(source, 'name', path);

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

/** What a file says about itself, or `(no description)`. */
export function purposeOf(path) {
  const source = read(path);
  if (source === undefined) return NO_DESCRIPTION;
  const purpose =
    extname(path) === '.md'
      ? (purposeFromFrontMatter(source, path) ?? purposeFromHead(source))
      : purposeFromHead(source);
  return purpose ?? NO_DESCRIPTION;
}

/**
 * A package directory describes itself in its `package.json`, when it has one.
 * A directory that holds no package yet has no manifest to describe it, so its
 * `README.md` answers instead, the same way any other Markdown file does. A
 * manifest that cannot be read is refused, not answered for by the README.
 */
function purposeOfPackage(directory) {
  const path = join(directory, 'package.json');
  const manifest = read(path);
  let description;
  try {
    description = manifest === undefined ? undefined : readJson(manifest).description;
  } catch {
    refuse('inventory', path, 'is not a JSON object, or repeats a key');
  }
  return oneLine(String(description ?? '')) ?? purposeOf(join(directory, 'README.md'));
}

const entries = (directory) =>
  existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).toSorted(byName) : [];

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Every file under `directory`, as paths relative to `root`, sorted. A link to
 * a file is a file, listed under its own path; a link to a directory, or to
 * nothing, is refused, because following it can loop and skipping it hides it.
 */
function walk(root, directory) {
  const found = [];
  for (const entry of entries(join(root, directory))) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) found.push(...walk(root, path));
    } else if (entry.isFile()) found.push(path);
    else if (entry.isSymbolicLink()) {
      if (!statSync(join(root, path), { throwIfNoEntry: false })?.isFile())
        refuse('inventory', path, 'links to a directory or to nothing; list its target');
      found.push(path);
    }
  }
  return found.toSorted();
}

/** Immediate subdirectories of a workspace root are its packages. */
function packageRows(root, area) {
  return entries(join(root, area))
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      path: `${area}/${entry.name}`,
      kind: 'package',
      purpose: purposeOfPackage(join(root, area, entry.name)),
    }));
}

/** Every file under `area` whose extension puts it in `kind`. */
function fileRows(root, area, kind, extensions) {
  return walk(root, area)
    .filter((path) => extensions.has(extname(path)))
    .map((path) => ({ path, kind, purpose: purposeOf(join(root, path)) }));
}

/** A skill is a directory holding a SKILL.md. */
function skillRows(root) {
  const area = '.claude/skills';
  return entries(join(root, area))
    .filter((entry) => entry.isDirectory() && existsSync(join(root, area, entry.name, 'SKILL.md')))
    .map((entry) => ({
      path: `${area}/${entry.name}`,
      kind: 'skill',
      purpose: purposeOf(join(root, area, entry.name, 'SKILL.md')),
    }));
}

/**
 * Every file inside a skill directory. Walking the whole area, rather than
 * each directory found in it, is what lets walk refuse a linked skill
 * directory instead of passing over it.
 */
const skillFiles = (root) =>
  walk(root, '.claude/skills').filter((path) => path.split('/').length > 3);

/**
 * The Markdown a skill carries beside its SKILL.md: agent briefs, formats,
 * references. A lane is handed one of these to write from, so a page that
 * lists what exists and leaves them out sends it to write one again.
 */
function briefRows(root) {
  return skillFiles(root)
    .filter((path) => extname(path) === '.md' && !path.endsWith('/SKILL.md'))
    .map((path) => ({ path, kind: 'brief template', purpose: purposeOf(join(root, path)) }));
}

/**
 * The scripts a skill carries beside its SKILL.md: shell, Python and JavaScript
 * a lane is told to run or to copy. They are code that already exists, so the
 * page that exists to stop a lane writing code twice has to list them.
 */
function skillScriptRows(root) {
  return skillFiles(root)
    .filter((path) => SCRIPT.has(extname(path)))
    .map((path) => ({ path, kind: 'skill script', purpose: purposeOf(join(root, path)) }));
}

/**
 * A workflow is what actually runs on a hosted runner, and its `name:` is the
 * name the check reports under, so that is its purpose.
 */
function workflowRows(root) {
  const area = '.github/workflows';
  return walk(root, area)
    .filter((path) => WORKFLOW_EXTENSIONS.has(extname(path)))
    .map((path) => ({
      path,
      kind: 'workflow',
      purpose: purposeFromWorkflowName(read(join(root, path)) ?? '', path) ?? NO_DESCRIPTION,
    }));
}

/**
 * One `STEPS` entry as scripts/check.mjs reads it: a script name and its label,
 * each with something in it. Read by index, because `every` skips a hole.
 */
const isStep = (entry) =>
  Array.isArray(entry) &&
  entry.length === 2 &&
  [0, 1].every((at) => typeof entry[at] === 'string' && entry[at].trim() !== '');

/**
 * The blocking gates, read from the one list `scripts/check.mjs` exports, so
 * a step added there appears here without anybody being told to add it. No
 * runner, one that does not load, no `STEPS` or an empty one is a problem, not
 * an empty table: every repository built from this template has gates, so an
 * empty list means the page cannot see them. So is an entry that is not what
 * the runner reads, a script name and its label, because a row read from it
 * would be invented.
 */
async function stepRows(root, problems) {
  const path = resolve(root, 'scripts/check.mjs');
  const { STEPS } = existsSync(path)
    ? await import(pathToFileURL(path).href).catch(() => ({}))
    : {};
  if (
    !Array.isArray(STEPS) ||
    STEPS.length === 0 ||
    !Array.from(STEPS).every((entry) => isStep(entry))
  ) {
    problems.push(
      'scripts/check.mjs is missing, does not load, or its STEPS are not [script, label] pairs, so the check steps are unknown',
    );
    return [];
  }
  return STEPS.map(([script, label]) => ({
    path: `package.json#scripts.${script}`,
    kind: 'check step',
    purpose: oneLine(label) ?? NO_DESCRIPTION,
  }));
}

/** The nine areas, in reading order, each with its rows already sorted. */
export async function collect(root, problems = []) {
  return [
    {
      title: 'Applications (`apps/`)',
      rows: [...packageRows(root, 'apps'), ...fileRows(root, 'apps', 'module', MODULE_EXTENSIONS)],
    },
    {
      title: 'Packages (`packages/`)',
      rows: [
        ...packageRows(root, 'packages'),
        ...fileRows(root, 'packages', 'module', MODULE_EXTENSIONS),
      ],
    },
    { title: 'Scripts (`scripts/`)', rows: fileRows(root, 'scripts', 'script', SCRIPT) },
    { title: 'Check steps (`pnpm check`)', rows: await stepRows(root, problems) },
    { title: 'Workflows (`.github/workflows/`)', rows: workflowRows(root) },
    { title: 'Skills (`.claude/skills/`)', rows: skillRows(root) },
    { title: 'Brief templates (`.claude/skills/*/`)', rows: briefRows(root) },
    { title: 'Skill scripts (`.claude/skills/*/`)', rows: skillScriptRows(root) },
    { title: 'Tests (`tests/`)', rows: fileRows(root, 'tests', 'test suite', SCRIPT) },
  ];
}

// Cells are padded to the widest in their column because that is what
// Prettier does to a Markdown table, and `format:check` is a blocking gate.
function table(rows) {
  const header = ['Path', 'Kind', 'Purpose'];
  const cells = [header, ...rows.map((row) => [`\`${row.path}\``, row.kind, row.purpose])];
  const widths = header.map((_, column) => Math.max(...cells.map((row) => row[column].length)));
  const line = (row) => `| ${row.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;
  return [
    line(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map((row, index) => line(cells[index + 1])),
  ].join('\n');
}

export function render(areas) {
  const lines = [
    '# Inventory',
    '',
    'What this repository already has. Read it before you build, and name what you',
    'build on in the pull request body. A capability that is already here is',
    'extended, not written a second time.',
    '',
    'Generated by `scripts/inventory.mjs` from the tree itself. Do not edit it by',
    'hand: run `corepack pnpm inventory` and commit the result. The `inventory:fresh`',
    'check step fails when this file and the tree disagree.',
    '',
    'A purpose is what the file says about itself: a package description or `README.md`,',
    'a Markdown front matter `description`, a workflow `name:`, or the comment at the head',
    `of the file. \`${NO_DESCRIPTION}\` means it says nothing, which is worth fixing in the`,
    'file rather than here.',
  ];
  for (const area of areas)
    lines.push(
      '',
      `## ${area.title}`,
      '',
      area.rows.length === 0 ? 'Nothing here yet.' : table(area.rows),
    );
  return `${lines.join('\n')}\n`;
}

/** The page, and what stopped it from being complete. */
export async function buildInventory(root) {
  const problems = [];
  return { page: render(await collect(root, problems)), problems };
}

/** The `git diff` between what is committed and what the tree says it should be. */
function diff(current, generated) {
  try {
    execFileSync('git', ['diff', '--no-index', '--unified=3', '--', current, generated], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return '';
  } catch (error) {
    return error.stdout ?? '';
  }
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const modes = args.filter((arg) => arg.startsWith('--'));
  const roots = args.filter((arg) => !arg.startsWith('--'));
  if (
    roots.length > 1 ||
    modes.length > 1 ||
    (modes[0] !== undefined && !['--check', '--write'].includes(modes[0]))
  ) {
    exitWith(2, 'usage: node scripts/inventory.mjs [--check | --write] [repository-root]');
  }

  const root = resolve(roots[0] ?? resolve(import.meta.dirname, '..'));
  const target = resolve(root, OUTPUT);
  let generated;
  let problems;
  try {
    ({ page: generated, problems } = await buildInventory(root));
  } catch {
    // Never the error's message: a parser's quotes the file it failed on.
    refuse('inventory', root, 'cannot be read');
  }
  for (const problem of problems) console.error(`inventory: ${problem}`);

  if (modes[0] === '--write') {
    writeFileSync(target, generated);
    console.log(`inventory: wrote ${OUTPUT}`);
  } else {
    if (problems.length > 0) process.exitCode = 1;
    const temporary = join(mkdtempSync(join(tmpdir(), 'inventory-')), 'INVENTORY.md');
    writeFileSync(temporary, generated);
    const current = read(target);
    if (current === generated) {
      console.log(`inventory: ${OUTPUT} is what the tree says it is.`);
    } else {
      console.error(
        `inventory: ${OUTPUT} is stale. Run \`corepack pnpm inventory\` and commit it.`,
      );
      const printed = diff(existsSync(target) ? target : '/dev/null', temporary);
      if (printed !== '') console.error(printed);
      process.exitCode = 1;
    }
  }
}
