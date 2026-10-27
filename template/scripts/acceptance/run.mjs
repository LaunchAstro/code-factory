// SPDX-License-Identifier: AGPL-3.0-only
// Running the plan's tests at one commit, and reading what the run actually
// did. Split out of scripts/acceptance-check.mjs, which decides; this decides
// nothing and only reports, short of a report it cannot read.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { readJson, refuse } from '../main-module.mjs';

// Where vitest lives. Git runs in the current directory, which is the
// repository under test; the tooling comes from this script's own package, so
// the cases can point a real vitest at a throwaway repository in /tmp.
const packageRoot = resolve(import.meta.dirname, '../..');

// What a branch may change and still be measured: product source and the
// plan's own directory, which rule 4 holds byte-identical to the plan commit.
// Anything else the head changed (vitest's configuration, a setup file, a mock,
// a helper, a PostCSS configuration, a package manifest, a link) could make
// unchanged wrong code pass, and four rounds of Sol's review found a way past
// every list of what the test setup loads (Sol CF-05 to CF-05-FIX4). This is a
// list of what the builder may change instead, so it cannot miss a loader
// (ORCH73 78PATH). Markdown is on neither list: a test or a helper loads a file
// whatever its extension, a .md one included (Sol CF-05-FIX5).
//
// Product source is the root src/ tree and each package's, as ARCHITECTURE.md
// lays packages out under apps/ and packages/: regular files only, because a
// link's file is somewhere else, and nothing under __mocks__, which vitest
// loads by name in place of the module beside it. A fixed list here, not
// pnpm-workspace.yaml or anything else the head could widen.
const PRODUCT = /^(?:(?:apps|packages)\/[^/]+\/)?src\/./u;
const isProduct = ({ path, regular }) =>
  PRODUCT.test(path) &&
  regular &&
  !path.split('/').some((part) => part.toLowerCase() === '__mocks__');

const REGULAR = new Set(['100644', '100755', '000000']);
/**
 * Each path `git diff <range>` names, and whether it is a regular file on both
 * sides, not a link or a submodule. The one reading of file modes, which
 * acceptance-check.mjs's documentation exemption shares: a link is never
 * product source and never documentation (Sol CF-05-FIX5). Names only:
 * nothing in the range is checked out or run to answer this.
 */
export function changesBetween(range) {
  const raw = execFileSync('git', ['diff', '--raw', '-z', '--no-renames', range, '--'], {
    encoding: 'utf8',
  }).split('\0');
  const changes = [];
  // `:<old mode> <new mode> <old blob> <new blob> <status>`, then the path.
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const [from, to] = raw[i].slice(1).split(' ');
    changes.push({ path: raw[i + 1], regular: REGULAR.has(from) && REGULAR.has(to) });
  }
  return changes;
}

/**
 * How a plan's test file is named: the one rule for the files the runner runs
 * and the files the check grades, so every file that runs must be red before
 * the code (Sol's review of 03b8239 watched a .spec.ts run and go ungraded).
 */
export const PLAN_TEST = '.test.ts';

// The one vitest configuration both runs use: the runner's, written beside the
// worktree, never the repository's (ORCH75 78SEC). With no plugin, no setup
// file, no global setup and PostCSS given inline, nothing at that commit runs
// before the plan's tests do, and its only test files are the plan's (a
// directory on the command line also ran src/tests/acceptance/<ticket>/, the
// security review of 64400f0), so product source runs only where the tests
// import it. So the path rule above needs nothing of the base's layout, and
// nothing of it is read: every reading of it missed a loader (the security
// review of 633f8a3) or refused routine configurations (the same review). The
// head's configuration was how the review of record on 3aa9719 watched all six
// rules pass over a head where the plan's test never ran (issue 30). A
// repository's aliases, environment and globals do not apply either, so a
// plan's tests import what they test by relative path. Its test files are
// those PLAN_TEST names under the plan's directory, the name escaped as a glob.
const configuration = (root, directory) => {
  const tests = `${directory.replaceAll(/[\\*?[\]{}()!+@]/gu, '\\$&')}/**/*${PLAN_TEST}`;
  return `export default {
  root: ${JSON.stringify(root)},
  plugins: [],
  css: { postcss: {} },
  test: {
    include: [${JSON.stringify(tests)}],
    setupFiles: [], globalSetup: [], includeSource: [], passWithNoTests: false,
  },
};
`;
};

// What tested code may see of this process's environment. Everything else,
// GH_TOKEN and every other credential included, stays with the checker, and
// any value of it the run prints anyway is withheld from the transcript. Not
// HOME: a credential stored there (gh's hosts.yml, say) is a file, not a
// variable, so tested code gets a fresh empty home, and the configuration
// directories point inside it (Sol CF-05-FIX5). The caller's environment is
// read as it was when this module loaded: acceptance-check.mjs then cuts
// process.env down to what its Git reads need.
const caller = { ...process.env };
const PASSED_ENVIRONMENT = [
  'PATH',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
  'USER',
  'LOGNAME',
  'SHELL',
];

function testEnvironment(home) {
  const env = { CI: '1', HOME: home, XDG_CONFIG_HOME: join(home, '.config') };
  for (const [name, path] of [
    ['DATA', 'share'],
    ['STATE', 'state'],
    ['CACHE', 'cache'],
  ])
    env[`XDG_${name}_HOME`] = join(home, '.local', path);
  for (const name of PASSED_ENVIRONMENT) if (caller[name] !== undefined) env[name] = caller[name];
  return env;
}

// The variables whose values may be printed: what tested code sees, and the
// check's own inputs. Every other value is withheld whatever its length, a
// seven-character password included (Sol's review of f555b81), longest first
// and in one pass, so a short value cannot split a longer one or a marker.
const SHOWN = new Set([
  ...PASSED_ENVIRONMENT,
  ...'HOME CI PWD OLDPWD SHLVL BASE_SHA HEAD_SHA PR_BODY PR_HEAD_REF PR_NUMBER'.split(' '),
]);
const secrets = Object.entries(caller)
  .filter(([name, value]) => !SHOWN.has(name) && value)
  .map(([, value]) => value.replaceAll(/[$()*+.?[\\\]^{|}]/gu, '\\$&'))
  .toSorted((a, b) => b.length - a.length);
const secret = secrets.length === 0 ? null : new RegExp(secrets.join('|'), 'gu');
const withheld = (text) => (secret === null ? text : text.replaceAll(secret, '<withheld>'));

function notRun(sha, directory, outside) {
  const named = outside.slice(0, 5).map((path) => JSON.stringify(path));
  if (outside.length > 5) named.push(`and ${outside.length - 5} more`);
  return {
    started: false,
    status: 1,
    ran: new Map(),
    output: withheld(
      `not run: at ${sha.slice(0, 7)}, the branch changed ${named.join(', ')}, outside product source ` +
        `(src/, apps/<name>/src/ and packages/<name>/src/, regular files, no __mocks__) and ${directory}/. ` +
        'A configuration, setup, mock or helper that changed with the code could pass wrong code, so the run ' +
        'would prove nothing. Change them in a pull request of their own, or ask the owner to waive acceptance.',
    ),
  };
}

// The report vitest wrote, `{}` when it wrote none (it never started), and
// null when what is there is not JSON: a directory, say, or a file tested code
// put there.
function reportAt(path) {
  if (!existsSync(path)) return {};
  try {
    return readJson(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// Which files ran, keyed by their path inside the worktree `tree`. Every text a
// refusal can quote is withheld like the transcript: a test's error message is
// whatever the test threw (Sol's review of 03b8239).
function ranIn(report, tree) {
  const ran = new Map();
  const text = (value) => withheld(String(value ?? ''));
  for (const result of report.testResults ?? [])
    ran.set(relative(tree, String(result.name ?? '')), {
      status: text(result.status),
      assertions: (result.assertionResults ?? []).map((a) => text(a.status)),
      // How each failed test failed, by the first line of its first error.
      failures: (result.assertionResults ?? [])
        .filter((a) => a.status === 'failed')
        .map((a) => text(a.failureMessages?.[0]).split('\n')[0]),
    });
  return ran;
}

/**
 * vitest's run of the test files under `directory` at one commit, in a
 * throwaway worktree of it, so the run sees that revision and nothing a builder
 * left in the tree, under the runner's own configuration above.
 *
 * It refuses first, with nothing checked out, when the branch changed a path
 * outside product source and `directory` by that commit. `base` is the merge
 * base, where the branch's changes are read from.
 *
 * It returns which test files ran and how each one finished, not only the exit
 * code, because the exit code is not evidence that anything ran: a run of none
 * of the plan's tests exits zero too.
 *
 * It also returns what the run printed, because the first time this job was
 * red on a hosted runner and green here, the refusal said only "vitest exited
 * 1" and there was nothing to read. A report it cannot read is refused in fixed
 * words, never the read error's, which can quote what it read (CF-08-F3).
 */
export function vitestAt(sha, directory, base) {
  // Three dots, so a branch that merged a moved main is read for its own
  // changes, not main's.
  const outside = changesBetween(`${base}...${sha}`)
    .filter(({ path }) => !path.startsWith(`${directory}/`))
    .filter((change) => !isProduct(change))
    .map(({ path }) => path);
  if (outside.length > 0) return notRun(sha, directory, outside);
  // Links resolved, as in the reporter's paths.
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'acceptance-')));
  const home = mkdtempSync(join(tmpdir(), 'acceptance-home-'));
  const tree = join(parent, 'tree');
  const modules = join(tree, 'node_modules');
  const config = join(parent, 'vitest.config.mjs');
  const report = join(parent, 'report.json');
  writeFileSync(config, configuration(tree, directory), { flag: 'wx' });
  execFileSync('git', ['worktree', 'add', '--detach', '--quiet', tree, sha], { stdio: 'pipe' });
  let run;
  let parsed;
  try {
    symlinkSync(join(packageRoot, 'node_modules'), modules);
    run = spawnSync(
      join(modules, '.bin', 'vitest'),
      [
        'run',
        `--config=${config}`,
        '--reporter=default',
        '--reporter=json',
        `--outputFile=${report}`,
      ],
      { cwd: tree, encoding: 'utf8', env: testEnvironment(home) },
    );
    parsed = reportAt(report);
  } finally {
    if (existsSync(modules)) unlinkSync(modules);
    execFileSync('git', ['worktree', 'remove', '--force', tree], { stdio: 'pipe' });
    rmSync(parent, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
  if (parsed === null)
    refuse(
      'acceptance',
      `vitest's report at ${sha.slice(0, 7)}`,
      'is not JSON, so nothing says what ran',
    );
  return {
    // Whether vitest ran at all, separately from what it concluded. A run
    // that never started exits non-zero too, and counting that as red would
    // make "the tests failed before the code" true by breaking vitest. Its
    // error's code, never its message.
    started: run.error === undefined,
    status: run.status ?? 1,
    ran: ranIn(parsed, tree),
    output: withheld(
      `${run.stdout ?? ''}${run.stderr ?? ''}${run.error === undefined ? '' : `vitest did not start: ${run.error.code ?? 'no code'}`}`,
    ),
  };
}

/**
 * What a run did with one of the plan's test files, by its repository-relative
 * path: its reported status and the status of each assertion in it. That path
 * exactly, never another file whose path ends the same way.
 */
export const inRun = (run, file) => run.ran.get(file);

/**
 * Why a file is not green, in the words a builder needs, or `''` if it is.
 *
 * The file's own status is not the answer, and round two of the review of
 * record on 4e4d0cc is why. A file in which every test was skipped is reported
 * `passed` with `numPassedTests: 0`, so one line of `testNamePattern` in the
 * head's config, which the builder is free to write because the plan commit may
 * touch only its own directory, passed every rule over code that does not
 * satisfy the plan's test. Assertions ran, and every one of them passed, is the
 * claim this check is making, so it is the claim it reads.
 */
export const notPassing = (result) => {
  if (result === undefined) return 'did not run';
  if (result.assertions.length === 0) return `was reported ${result.status} with no test in it`;
  const bad = result.assertions.filter((status) => status !== 'passed');
  if (bad.length > 0)
    return `was reported ${result.status}, and ${bad.length} of its ${result.assertions.length} test(s) ${[...new Set(bad)].join(' or ')} rather than passed`;
  return '';
};

/**
 * Why a file is not red, or `''` if it is. Red means a test ran and failed on
 * its assertion. A file that failed before any test ran, on a missing import
 * say, is reported failed with no test in it, and that is not the right reason
 * (CHECKLIST.md; Sol CF-05). Nor is a test that failed on an error thrown
 * before its assertion, the same missing import loaded inside the test, so one
 * failure must be an assertion's (Sol CF-05-FIX1).
 */
export const notFailing = (result) => {
  if (result === undefined) return 'did not run';
  if (result.status !== 'failed')
    return result.assertions.some((status) => status === 'passed')
      ? `was reported ${result.status} and already passes`
      : `was reported ${result.status}`;
  if (!result.assertions.includes('failed'))
    return 'failed before any test ran (an import or collection error), so no assertion failed';
  if (!result.failures.some((message) => ASSERTION.test(message)))
    return `failed on an error before its assertion (${result.failures[0]}), so no assertion failed`;
  return '';
};

// How an assertion failure starts: vitest's expect and node:assert both throw an
// AssertionError.
const ASSERTION = /^AssertionError\b/u;

// The last of what a run printed, indented, so a refusal carries its evidence.
export const transcript = (run) =>
  run.output
    .split('\n')
    .slice(-40)
    .map((line) => `           | ${line}`)
    .join('\n');
