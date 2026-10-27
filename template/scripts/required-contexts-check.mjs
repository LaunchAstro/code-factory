// SPDX-License-Identifier: AGPL-3.0-only
// The check contexts the branch ruleset requires, recorded in the tree.
//
// Before ticket 1 a requirement dropped from the ruleset still left a red run
// on every pull request for somebody to notice. After it, the context simply
// stops being reported, which looks exactly like the ordinary state of a head
// nobody has reviewed yet. No repository can prove what a ruleset requires.
// What it can do is refuse when its own record and the workflow that reports
// the context disagree, which is what catches the job renamed, or the record
// left behind, while the requirement stays where it is.
//
// The manifest and the workflow are arguments rather than constants so that a
// case can run this over a mutation instead of over the repository it is
// checking.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { validateCheckContexts } from './check-context-manifest.mjs';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, process.argv[2] ?? '.github/required-contexts.json');
const workflowPath = resolve(root, process.argv[3] ?? '.github/workflows/review-evidence.yml');

const problems = [];
const read = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    problems.push(`${path} could not be read`);
    return '';
  }
};

let contexts = [];
const manifest = read(manifestPath);
if (manifest !== '') {
  try {
    contexts = JSON.parse(manifest).requiredChecks;
  } catch {
    problems.push(`${manifestPath} is not valid JSON`);
  }
}
problems.push(...(manifest === '' ? [] : validateCheckContexts(contexts)));

// The job's own name is the context it reports, so it is read off the file
// rather than written here twice. One job, and its name. The file is parsed:
// Sol's review of 69afe53 found a line pattern taking malformed YAML, and a
// name inside a string, as a job.
const jobName = (text) => {
  let workflow;
  try {
    workflow = parse(text);
  } catch (error) {
    problems.push(`${workflowPath} is not valid YAML: ${String(error.message).split('\n')[0]}`);
    return undefined;
  }
  const jobs = workflow?.jobs;
  if (
    jobs === null ||
    typeof jobs !== 'object' ||
    Array.isArray(jobs) ||
    Object.keys(jobs).length !== 1
  ) {
    problems.push(
      `${workflowPath} does not declare exactly one job, so which context it reports is unclear`,
    );
    return undefined;
  }
  const job = Object.values(jobs)[0];
  if (typeof job?.name !== 'string' || job.name === '') {
    problems.push(`${workflowPath} declares no job name, so it reports no context`);
    return undefined;
  }
  // GitHub counts a skipped job as a passing required check, and a workflow
  // no review starts never reports at all. The security review of 65dbe59.
  if ('if' in job) {
    problems.push(
      `${workflowPath} lets its job be skipped, and a skipped job passes a required check`,
    );
  }
  const types = workflow?.on?.pull_request_review?.types;
  const wanted = ['submitted', 'edited', 'dismissed'];
  if (
    !Array.isArray(types) ||
    types.length !== wanted.length ||
    wanted.some((t) => !types.includes(t))
  ) {
    problems.push(`${workflowPath} does not run on a review submitted, edited and dismissed`);
  }
  return job.name;
};
const workflowText = read(workflowPath);
const reported = workflowText === '' ? undefined : jobName(workflowText);
if (reported === undefined) {
  if (workflowText === '') problems.push(`${workflowPath} reports no context`);
} else if (Array.isArray(contexts) && !contexts.includes(reported)) {
  problems.push(
    `the manifest does not list '${reported}', the context ${workflowPath} reports, so nothing in the tree records that it is required`,
  );
}

for (const problem of problems) console.error(`required-contexts: ${problem}`);
if (problems.length > 0) process.exitCode = 1;
else console.log(`required-contexts: ${contexts.length} recorded, '${reported}' among them.`);
