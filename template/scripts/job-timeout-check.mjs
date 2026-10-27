// SPDX-License-Identifier: AGPL-3.0-only
// Every workflow job declares a timeout.
//
// GitHub's default is 360 minutes. A job that hangs, a prompt nobody answers,
// a network read with no deadline, a test runner waiting on a port, burns six
// hours of the organisation's allowance before anybody sees a red tick, and on
// a private repository those minutes are billed. Six hours is also long enough
// that the person who pushed has gone home, so the run is cancelled by hand the
// next morning, or not at all.
//
// The rule is one line per job and it is easy to forget on the job that is
// added in a hurry, which is exactly the job most likely to hang.
//
// Each workflow is parsed once by `yaml`, unique keys and strict, and any
// error or warning it reports exits 2 naming the file, strict mode or not, so
// malformed or ambiguous input is never reported bounded: Sol's CF-09 third
// and fourth rounds, and the owner's ruling ORCH73 74YAML, which replaced a
// hand reader of a YAML subset that passed what it misread. A workflow's jobs
// are its top-level `jobs` mapping, and a job is bounded only if its own
// `timeout-minutes` is a positive whole number written as one.
//
// Usage:
//   node scripts/job-timeout-check.mjs [workflow-directory]
//
// Strict mode is for the hosted run: JOB_TIMEOUT_STRICT=1 makes a missing
// timeout an error. Without it the script reports and exits 0, so a local
// `pnpm check` on a branch that is halfway through a workflow edit is not
// blocked by a line the author is about to write.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMap, isScalar, parseDocument } from 'yaml';
import { exitWith, isMainModule } from './main-module.mjs';

// GitHub's workflow syntax: the only keys a workflow file has at its top.
const WORKFLOW_KEYS = new Set([
  'name',
  'run-name',
  'on',
  'permissions',
  'env',
  'defaults',
  'concurrency',
  'jobs',
]);

// A timeout is a positive whole number of minutes: an integer node whose text
// is the number, so `"10"`, `10.0` and `0x0a` are not, and whose value is
// exact, so 400 nines (Infinity) are not. `timeout-minutes: null` is the key
// with no timeout.
const bounded = (node) =>
  isScalar(node) && Number.isSafeInteger(node.value) && /^[1-9]\d*$/u.test(node.source ?? '');

/**
 * Every job in one workflow source, with whether it declares a timeout.
 * Throws on a source the parser reports anything about, or that names an
 * alias it cannot resolve.
 */
export function jobs(source) {
  const document = parseDocument(source, { uniqueKeys: true, strict: true });
  const [problem] = [...document.errors, ...document.warnings];
  if (problem !== undefined) throw new Error(problem.message.split('\n')[0].replace(/:$/u, ''));
  // Resolving the whole document is what finds an alias with no anchor.
  document.toJS();
  // A job behind a no-break space, or one indent too few, parses as a key
  // beside `jobs` and would never be counted. GitHub's workflow syntax names
  // the top-level keys; any other refuses.
  for (const { key } of isMap(document.contents) ? document.contents.items : []) {
    const name = isScalar(key) ? key.value : key;
    if (!WORKFLOW_KEYS.has(name))
      throw new Error(`top-level key ${JSON.stringify(name)} is not a workflow key`);
  }
  const all = document.get('jobs', true);
  if (!isMap(all)) return [];
  return all.items.map(({ key, value }) => {
    const timeout = isMap(value) ? value.get('timeout-minutes', true) : undefined;
    // An expression is GitHub's to evaluate, not this check's, so a `${{`
    // value refuses with the file named (ORCH73 74SIMPLE).
    if (typeof timeout?.value === 'string' && timeout.value.includes('${{')) {
      throw new Error('timeout-minutes is an expression, not a number of minutes');
    }
    return { name: String(isScalar(key) ? key.value : key), timeout: bounded(timeout) };
  });
}

/** The workflow files in a directory, sorted, each read once: `[file, source]`. */
export const workflowsIn = (directory) =>
  readdirSync(directory)
    .filter((file) => /\.ya?ml$/u.test(file))
    .toSorted()
    .map((file) => [file, readFileSync(join(directory, file), 'utf8')]);

if (isMainModule(import.meta.url)) {
  const directory = resolve(
    process.argv[2] ?? join(resolve(import.meta.dirname, '..'), '.github', 'workflows'),
  );
  if (!existsSync(directory)) {
    exitWith(2, `job-timeouts: no workflow directory at ${directory}`);
  }

  // Listed once and each file read once: every step below works on these
  // bytes. Listing and reading again at each step let a workflow removed or
  // emptied after the first listing leave a later step a clean empty scan:
  // Sol's CF-09 fourth round. A file gone between listing and reading refuses.
  let workflows;
  try {
    workflows = workflowsIn(directory);
  } catch (error) {
    exitWith(2, `job-timeouts: ${error.message}, so nothing was read.`);
  }

  // A directory that exists and holds no workflow is the same fact as one that
  // does not exist, arriving one step later. An empty list of jobs has nothing
  // missing in it, so without this the run printed that every job declares a
  // timeout over a path that was wrong by one component: issue 18. Strict mode
  // decides what to do about a workflow that was read, not about one that was
  // never there, so this refuses either way.
  if (workflows.length === 0) {
    exitWith(1, `job-timeouts: no workflow file in ${directory}, so nothing was read.`);
  }

  // A workflow the parser reports anything about is refused before anything
  // is counted.
  const read = workflows.map(([file, source]) => {
    try {
      return [file, jobs(source)];
    } catch (error) {
      return exitWith(2, `job-timeouts: ${file}: ${error.message}`);
    }
  });

  // A file that was read and yielded no job at all was not understood. An
  // empty `jobs: {}`, a `jobs` that is not a mapping, or a file that is not a
  // workflow under a workflow name all leave an empty list, and an empty list
  // has nothing missing in it, so the run printed that every job declares a
  // timeout over a file it never read. What was not read cannot be called
  // clean, in strict mode or out of it.
  const unread = read.filter(([, found]) => found.length === 0).map(([file]) => file);
  if (unread.length > 0) {
    exitWith(1, `job-timeouts: no job read from ${unread.join(', ')} in ${directory}.`);
  }

  const strict = process.env['JOB_TIMEOUT_STRICT'] === '1';
  const missing = read.flatMap(([file, found]) =>
    found.filter((job) => !job.timeout).map((job) => `${file}: ${job.name}`),
  );

  console.log(
    `job-timeouts: ${missing.length} job(s) without a timeout, ${strict ? 'strict' : 'reporting'}`,
  );

  if (missing.length > 0) {
    for (const job of missing) console.error(`  ${job} declares no timeout-minutes`);
    console.error(
      "\njob-timeouts: GitHub's default is 360 minutes. A job that hangs burns six\n" +
        'job-timeouts: hours of the allowance before anybody sees a red tick.',
    );
    if (strict) process.exitCode = 1;
  } else {
    console.log('job-timeouts: every job declares a timeout.');
  }
}
