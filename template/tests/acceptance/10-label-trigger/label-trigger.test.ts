// SPDX-License-Identifier: AGPL-3.0-only
// Ticket 10, committed before the code.
//
// The workflows are read as workflows: which actions wake them, which job
// reports which context, and which of those jobs a condition can skip. The
// last of those is the one worth a rule. A job skipped by an `if:` still
// reports its context, and a skipped required check is not a red one, so a
// guard written by label name on a job that reports a required context hands
// every label the power to clear that context. Criterion 4 refuses it for
// every workflow in the repository, not only for the two this change touches.
//
// The size count is read off a real repository and a real run of the script,
// because the figure a fix lane argues about before a push is the one the
// script prints.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const workflowDir = resolve(root, '.github/workflows');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const workflowNames = (): string[] =>
  readdirSync(workflowDir).filter((file) => /\.ya?ml$/u.test(file));

interface Job {
  id: string;
  name: string;
  guard: string;
}

/** The actions in a workflow's `pull_request` types list. */
function pullRequestTypes(text: string): string[] {
  const rows = text.split('\n');
  const start = rows.findIndex((row) => /^ {2}pull_request:\s*$/u.test(row));
  if (start === -1) return [];
  for (const row of rows.slice(start + 1)) {
    if (/^ {0,2}\S/u.test(row) && !/^ {4}/u.test(row)) break;
    const types = /^ {4}types:\s*\[(?<list>.*)\]\s*$/u.exec(row);
    if (types?.groups?.['list'] !== undefined)
      return types.groups['list'].split(',').map((one) => one.trim());
  }
  return [];
}

/** Every job in a workflow, with its display name and its condition. */
function jobsIn(text: string): Job[] {
  const rows = text.split('\n');
  const start = rows.indexOf('jobs:');
  const jobs: Job[] = [];
  let current: Job | undefined;
  let folding = false;
  for (const row of rows.slice(start + 1)) {
    const header = /^ {2}(?<id>[A-Za-z0-9_-]+):\s*$/u.exec(row);
    if (header?.groups?.['id'] !== undefined) {
      current = { guard: '', id: header.groups['id'], name: '' };
      jobs.push(current);
      folding = false;
      continue;
    }
    if (row.trim() !== '' && /^\S/u.test(row)) break;
    if (current === undefined) continue;
    if (folding) {
      if (/^ {6}\S/u.test(row)) {
        current.guard = `${current.guard} ${row.trim()}`;
        continue;
      }
      folding = false;
    }
    const name = /^ {4}name:\s*(?<value>.+?)\s*$/u.exec(row);
    if (name?.groups?.['value'] !== undefined) current.name = name.groups['value'];
    const guard = /^ {4}if:\s*(?<value>.*?)\s*$/u.exec(row);
    if (guard?.groups?.['value'] !== undefined) {
      const value = guard.groups['value'];
      if (['>', '>-', '|', '|-'].includes(value)) folding = true;
      else current.guard = value;
    }
  }
  return jobs;
}

const required = new Set<string>(
  (JSON.parse(read('.github/required-contexts.json')) as { requiredChecks: string[] })
    .requiredChecks,
);

describe('a label the size gate does not read wakes nothing', () => {
  test('ci.yml does not run on a label at all', () => {
    const types = pullRequestTypes(read('.github/workflows/ci.yml'));
    expect(types).not.toHaveLength(0);
    expect(types).not.toContain('labeled');
    expect(types).not.toContain('unlabeled');
  });

  test('the size gate still reruns when a waiver is applied or removed', () => {
    const types = pullRequestTypes(read('.github/workflows/pr-size.yml'));
    expect(types).toContain('labeled');
    expect(types).toContain('unlabeled');
    expect(types).toContain('synchronize');
  });

  test('one workflow reports the size context, and it is not ci.yml', () => {
    const named = (file: string): Job[] =>
      jobsIn(read(`.github/workflows/${file}`)).filter((job) => job.name === 'pull request size');
    expect(named('pr-size.yml')).toHaveLength(1);
    expect(named('ci.yml')).toHaveLength(0);
    expect(required.has('pull request size')).toBe(true);
  });

  test('fails closed: no job reporting a required context can be skipped by a label', () => {
    const offenders: string[] = [];
    for (const file of workflowNames()) {
      for (const job of jobsIn(read(`.github/workflows/${file}`))) {
        if (!required.has(job.name)) continue;
        if (/github\.event\.(?:action|label)/u.test(job.guard)) offenders.push(`${file}:${job.id}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// --- the size count at a terminal -------------------------------------------

const temporary: string[] = [];
afterAll(() => {
  for (const dir of temporary) rmSync(dir, { force: true, recursive: true });
});

const git = (dir: string, args: string[]): void => {
  const run = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  expect(run.status, `${run.stdout ?? ''}${run.stderr ?? ''}`).toBe(0);
};

/** A repository with `main` at a seed and `feature` carrying one commit per count. */
function branchRepo(counts: number[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pr-size-'));
  temporary.push(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Size Test']);
  git(dir, ['config', 'user.email', 'size-test@example.invalid']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'seed.txt'), 'seed\n');
  git(dir, ['add', 'seed.txt']);
  git(dir, ['commit', '-qm', 'seed']);
  git(dir, ['checkout', '-q', '-b', 'feature']);
  counts.forEach((count, index) => {
    const body = Array.from({ length: count }, (_, line) => `line ${line}`).join('\n');
    writeFileSync(join(dir, `step${index}.ts`), `${body}\n`);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', `feat: step ${index}`]);
  });
  return dir;
}

/** The script, with the environment a terminal has and nothing a runner sets. */
function sizer(
  dir: string,
  args: string[],
  extra: Record<string, string> = {},
): { status: number; output: string } {
  const run = spawnSync(process.execPath, [resolve(root, 'scripts/pr-size.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', ...extra },
  });
  return { status: run.status ?? -1, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

describe('the size gate runs before the push', () => {
  test('two refs on the command line, no CI environment, the same printed line', () => {
    const answer = sizer(branchRepo([50]), ['--base', 'main', '--head', 'HEAD']);
    expect(answer.output).toMatch(/hand-written 50 of 1000/u);
    expect(answer.status).toBe(0);
  });

  test('it measures the whole pull request, not the last commit', () => {
    const answer = sizer(branchRepo([350, 350, 350]), ['--base', 'main', '--head', 'feature']);
    expect(answer.output).toMatch(/hand-written 1050 of 1000/u);
    expect(answer.status).toBe(1);
  });

  test('a ref that is not a commit names the flag and refuses', () => {
    const answer = sizer(branchRepo([50]), ['--base', 'no-such-ref', '--head', 'HEAD']);
    expect(answer.output).toContain('--base');
    expect(answer.status).not.toBe(0);
    expect(answer.output).not.toMatch(/hand-written 0 of 1000/u);
  });

  test('the environment the workflow sets still works, with no arguments', () => {
    const dir = branchRepo([50]);
    const rev = (ref: string): string =>
      spawnSync('git', ['rev-parse', ref], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    const answer = sizer(dir, [], { BASE_SHA: rev('main'), HEAD_SHA: rev('HEAD') });
    expect(answer.output).toMatch(/hand-written 50 of 1000/u);
    expect(answer.status).toBe(0);
  });
});

describe('the rule is written for people', () => {
  test('CONTRIBUTING.md carries the range and the command', () => {
    const text = read('CONTRIBUTING.md');
    expect(text).toContain('node scripts/pr-size.mjs --base origin/main --head HEAD');
    expect(text).toMatch(/whole pull request/u);
    expect(text).toMatch(/not the last commit|rather than the last commit/u);
  });
});
