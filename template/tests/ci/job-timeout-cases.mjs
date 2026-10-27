// SPDX-License-Identifier: AGPL-3.0-only
// Cases for the job timeout gate: a step timeout is not a job timeout, and strict mode fails on a
// job that declares none.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { jobs } from '../../scripts/job-timeout-check.mjs';

const checker = resolve(import.meta.dirname, '../../scripts/job-timeout-check.mjs');

const workflow = [
  'name: sample',
  'on:',
  '  pull_request:',
  'jobs:',
  '  first:',
  '    name: the first one',
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 10',
  '    steps:',
  '      - run: echo one',
  '  second:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: echo two',
  '',
].join('\n');

test('a job that declares a timeout is told apart from one that does not', () => {
  assert.deepEqual(jobs(workflow), [
    { name: 'first', timeout: true },
    { name: 'second', timeout: false },
  ]);
});

test('a step timeout is not the timeout of the job', () => {
  const stepLevel = [
    'jobs:',
    '  only:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: slow',
    '        timeout-minutes: 5',
    '        run: echo slow',
    '',
  ].join('\n');
  assert.deepEqual(jobs(stepLevel), [{ name: 'only', timeout: false }]);
});

test('the scan stops at the next top-level key', () => {
  const trailing = `${workflow}concurrency:\n  group: sample\n  third:\n`;
  assert.deepEqual(
    jobs(trailing).map((job) => job.name),
    ['first', 'second'],
  );
});

const withDirectory = (files, body) => {
  const directory = mkdtempSync(join(tmpdir(), 'foundation-timeouts-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      writeFileSync(join(directory, name), source);
    }
    return body(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('the directory scan names the workflow and the job, sorted by file', () => {
  withDirectory({ 'b.yml': workflow, 'a.yml': workflow, 'notes.txt': 'ignored' }, (directory) => {
    const run = spawnSync(process.execPath, [checker, directory], { encoding: 'utf8' });
    assert.deepEqual(
      run.stderr.split('\n').filter((line) => line.endsWith('declares no timeout-minutes')),
      [
        '  a.yml: second declares no timeout-minutes',
        '  b.yml: second declares no timeout-minutes',
      ],
    );
  });
});

test('strict mode fails on a missing timeout and passes when every job has one', () => {
  const run = (directory) =>
    spawnSync(process.execPath, [checker, directory], {
      encoding: 'utf8',
      env: { ...process.env, JOB_TIMEOUT_STRICT: '1' },
    });

  withDirectory({ 'ci.yml': workflow }, (directory) => {
    const failed = run(directory);
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stderr, /ci\.yml: second declares no timeout-minutes/u);
  });

  const complete = workflow.replace(
    '  second:\n    runs-on: ubuntu-latest\n',
    '  second:\n    runs-on: ubuntu-latest\n    timeout-minutes: 20\n',
  );
  withDirectory({ 'ci.yml': complete }, (directory) => {
    const passed = run(directory);
    assert.equal(passed.status, 0, passed.stdout + passed.stderr);
    assert.match(passed.stdout, /every job declares a timeout/u);
  });
});

test('without strict mode a missing timeout is reported and does not fail', () => {
  withDirectory({ 'ci.yml': workflow }, (directory) => {
    const run = spawnSync(process.execPath, [checker, directory], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /1 job\(s\) without a timeout, reporting/u);
  });
});

// The workflow is the only production caller of strict mode. Whatever value it
// passes has to be one the script arms on, or the step reports and never blocks.
// Sol's CF-09 sixth round: the step's own environment, read by the parser,
// so a strict setting under any other key cannot pass for it.
test('the workflow step passes a strict value the checker actually accepts', () => {
  const ci = parse(
    readFileSync(resolve(import.meta.dirname, '../../.github/workflows/ci.yml'), 'utf8'),
  );
  const steps = Object.values(ci.jobs)
    .flatMap((job) => job.steps)
    .filter((step) => step.run === 'node scripts/job-timeout-check.mjs');
  assert.ok(steps.length > 0, 'ci.yml runs the timeout check');
  for (const step of steps) {
    withDirectory({ 'ci.yml': workflow }, (directory) => {
      const run = spawnSync(process.execPath, [checker, directory], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, ...step.env },
      });
      assert.equal(run.status, 1, `env ${JSON.stringify(step.env)} did not arm strict mode`);
      assert.match(run.stdout, /strict/u);
    });
  }
});

// Both cases end in the direction that reports success, which is why they are
// here rather than left to the reader of the regular expression.
test('a trailing comment on a quoted key does not hand its timeout to the job above', () => {
  const commented = [
    'jobs:',
    '  first:',
    '    runs-on: ubuntu-latest',
    '  "second": # second job',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 5',
    '',
  ].join('\n');
  assert.deepEqual(jobs(commented), [
    { name: 'first', timeout: false },
    { name: 'second', timeout: true },
  ]);
});

// `jobs: [` was this case's input until Sol's CF-09 third round; it is now an
// unterminated flow value, refused below with exit 2 before any job is read.
test('a workflow file no job was read from refuses, strict or not', () => {
  withDirectory({ 'ci.yml': 'jobs: {}\n' }, (directory) => {
    for (const strict of ['1', '']) {
      const run = spawnSync(process.execPath, [checker, directory], {
        encoding: 'utf8',
        env: { ...process.env, JOB_TIMEOUT_STRICT: strict },
      });
      assert.equal(run.status, 1, run.stdout + run.stderr);
      assert.match(run.stderr, /no job read from ci\.yml/u);
      assert.doesNotMatch(run.stdout, /every job declares a timeout/u);
    }
  });
});

// Sol's CF-09 review. Each of the three below ended in strict mode passing a
// workflow with an unbounded job.
test('a top-level comment between jobs does not end the scan', () => {
  const commented = workflow.replace('  second:\n', '# an ordinary comment\n  second:\n');
  assert.deepEqual(jobs(commented), [
    { name: 'first', timeout: true },
    { name: 'second', timeout: false },
  ]);
});

test('a job written as a flow mapping is not skipped beside one that was read', () => {
  const flow = `${workflow.split('  second:')[0]}  second: {runs-on: ubuntu-latest, steps: [{run: echo two}]}\n`;
  withDirectory({ 'ci.yml': flow }, (directory) => {
    const run = spawnSync(process.execPath, [checker, directory], {
      encoding: 'utf8',
      env: { ...process.env, JOB_TIMEOUT_STRICT: '1' },
    });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stderr, /ci\.yml: second/u);
  });
});

// Sol's CF-09 seventh round: `10.0` and `0x0a` are integral values in a form
// the rule forbids, and 400 nines parse to Infinity, which is no bound. The
// eighth: `-10` is not positive and `"10"` is a string, not a number.
test('a null timeout is not a timeout', () => {
  const values = [
    'null',
    '',
    '~',
    '0',
    'ten',
    '10.5',
    '10.0',
    '0x0a',
    '9'.repeat(400),
    '-10',
    '"10"',
  ];
  for (const value of values) {
    const malformed = workflow.replace('timeout-minutes: 10', `timeout-minutes: ${value}`);
    assert.equal(jobs(malformed)[0]?.timeout, false, `timeout-minutes: ${value}`);
  }
});

// Sol's CF-09 second round. The value is a YAML plain scalar: a comment needs
// whitespace before its `#` (YAML 1.2.2 section 6.6), and a deeper line carries
// the scalar on, so each of these is a string and not a bound.
test('a timeout scalar is read whole, not up to an attached hash', () => {
  for (const value of ['10#suffix', '10 #comment', '10\t# tab']) {
    const timed = workflow.replace('timeout-minutes: 10', `timeout-minutes: ${value}`);
    assert.equal(jobs(timed)[0]?.timeout, /\s#/u.test(value), `timeout-minutes: ${value}`);
  }
  const continued = workflow.replace('timeout-minutes: 10\n', 'timeout-minutes: 1\n\n      0\n');
  assert.equal(jobs(continued)[0]?.timeout, false, 'a plain scalar over two lines is `1 0`');
});

// Sol's CF-09 third round. Whatever the parser reports an error or warning
// for refuses with exit 2 naming the file, strict or not, rather than
// reporting every job bounded.
const strictRun = (source, strict = '1') =>
  withDirectory({ 'ci.yml': source }, (directory) =>
    spawnSync(process.execPath, [checker, directory], {
      encoding: 'utf8',
      env: { ...process.env, JOB_TIMEOUT_STRICT: strict },
    }),
  );

const bothBounded = workflow.replace('  second:\n', '  second:\n    timeout-minutes: 20\n');

// Each edit of a workflow with every job bounded refuses with exit 2, strict or
// not, naming the file and never printing the pass line.
const refusesNamingTheFile = (edits) => {
  for (const [broken, replace] of edits) {
    const source = bothBounded.replace(...replace);
    assert.notEqual(source, bothBounded, broken);
    for (const strict of ['1', '']) {
      const run = strictRun(source, strict);
      assert.equal(run.status, 2, `${broken}: ${run.stdout}${run.stderr}`);
      assert.match(run.stderr, /ci\.yml/u, broken);
      assert.doesNotMatch(run.stdout, /every job declares a timeout/u, broken);
    }
  }
};

test('a workflow the parser cannot read refuses with exit 2 naming the file', () => {
  refusesNamingTheFile([
    ['an unterminated flow value', ['runs-on: ubuntu-latest', 'runs-on: [ubuntu-latest']],
    ['a mismatched bracket', ['runs-on: ubuntu-latest', 'runs-on: [ubuntu-latest}']],
    ['an unbalanced double quote', ['name: the first one', 'name: "the first one']],
    ['an unbalanced single quote', ['name: the first one', "name: 'the first one"]],
    ['text after a quoted value', ['name: the first one', 'name: "the first" one']],
    ['an unterminated quoted key', ['  second:', '  "second:']],
    [
      'a tab in the indentation',
      ['    runs-on: ubuntu-latest\n    steps', '\truns-on: ubuntu-latest\n    steps'],
    ],
    ['an unterminated jobs value', ['jobs:\n', 'jobs: [\n']],
    ['an anchor', ['runs-on: ubuntu-latest', 'runs-on: &os [ubuntu-latest']],
    [
      'an unrecognised tag, a parser warning',
      ['name: the first one', 'name: !unrecognised the first one'],
    ],
  ]);
});

// A key the parser reads at the top level is not under `jobs`, so a job
// written there was never counted: a no-break space before it, or one indent
// too few, put it outside the scan while every job read reported bounded.
// GitHub's workflow syntax names its top-level keys; any other refuses.
test('a top-level key that is not a workflow key refuses with exit 2 naming the file', () => {
  refusesNamingTheFile([
    ['a no-break space before a job key', ['\n  second:', '\n\u00A0 second:']],
    ['a job one indent too few', ['  second:\n    timeout-minutes: 20\n', 'second:\n']],
  ]);
});

// A flow value over two lines was outside the hand reader's subset and is
// ordinary YAML to the parser that replaced it (ORCH73 74YAML).
test('what the parser reads: block scalars, flow values, quoted keys, comments', () => {
  const readable = [
    'on:',
    '  push:',
    '    branches: [main, "release/*"]',
    'jobs:',
    "  'first': # a quoted key",
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 10 # minutes',
    '    steps:',
    '      - run: |',
    "          echo don't [ {",
    '          echo "unclosed',
    '        shell: bash',
    '      - name: "a # b"',
    "        run: echo 'quoted'",
    '  second:',
    '    runs-on: ${{ matrix.os }}',
    '    timeout-minutes: 20',
    '    with: {a: [1, 2], b: "c, d"}',
    '    services: [postgres,',
    '      redis]',
    '',
  ].join('\n');
  const run = strictRun(readable);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /every job declares a timeout/u);
});

// Sol's CF-09 third round and ORCH73 74SIMPLE: a timeout is a positive whole
// number of minutes. An expression is evaluated by GitHub, not here, so any
// `${{ }}` value, well formed or not, refuses with exit 2 naming the file.
test('a timeout expression refuses with exit 2 naming the file, whatever its form', () => {
  for (const value of [
    '${{ inputs.minutes }}',
    "${{ matrix.os == 'windows-latest' && 30 || 10 }}",
    '${{ ( }}',
    '${{ }}',
    '${{}}',
    '${{\t}} # empty',
    '${{ inputs.a }}#x',
    '${{ 1 }} ${{ 2 }}',
  ]) {
    const source = workflow.replace('timeout-minutes: 10', `timeout-minutes: ${value}`);
    assert.throws(() => jobs(source), /expression/u, `timeout-minutes: ${value}`);
    for (const strict of ['1', '']) {
      const run = strictRun(source, strict);
      assert.equal(run.status, 2, `${value}: ${run.stdout}${run.stderr}`);
      assert.match(run.stderr, /ci\.yml/u, value);
    }
  }
});

// Sol's CF-09 fourth round, criterion 2. Each of these closes every quote and
// bracket on its line and is still not YAML, and each passed strict mode with
// every job reported bounded.
test('malformed YAML with closed delimiters refuses with exit 2 naming the file', () => {
  refusesNamingTheFile([
    ['an unknown escape in a double-quoted value', ['name: sample', 'name: "bad \\q"']],
    ['a flow mapping missing its separator', ['runs-on: ubuntu-latest', 'runs-on: {a: 1 b: 2}']],
    ['a key one space deeper than its siblings', ['    runs-on', '     runs-on']],
    [
      'an alias to an anchor that does not exist',
      ['runs-on: ubuntu-latest', 'runs-on: [*nowhere]'],
    ],
  ]);
});

// Sol's CF-09 fourth round, criterion 2. A repeated key has two values and
// nothing here can say which one GitHub keeps, so neither is read.
test('a duplicate key is ambiguous and refuses with exit 2 naming the file', () => {
  for (const [twice, source] of [
    [
      'timeout-minutes',
      bothBounded.replace('timeout-minutes: 10', 'timeout-minutes: null\n    timeout-minutes: 10'),
    ],
    ['jobs', `${bothBounded}jobs:\n  third:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n`],
  ]) {
    for (const strict of ['1', '']) {
      const run = strictRun(source, strict);
      assert.equal(run.status, 2, `${twice} twice: ${run.stdout}${run.stderr}`);
      assert.match(run.stderr, /ci\.yml/u, twice);
    }
  }
});

// Sol's CF-09 fourth round, criterion 4. The directory was listed and each
// file read again at every step, so a workflow removed after the first
// listing left later steps an empty set to call clean. A preload stands in
// for whatever changes the directory mid-run.
const preloaded = (body) =>
  withDirectory({ 'ci.yml': workflow.replace('    timeout-minutes: 10\n', '') }, (directory) => {
    const preload = join(directory, 'preload.mjs');
    writeFileSync(
      preload,
      [
        "import fs from 'node:fs';",
        "import { syncBuiltinESMExports } from 'node:module';",
        `const directory = ${JSON.stringify(directory)};`,
        `const file = ${JSON.stringify(join(directory, 'ci.yml'))};`,
        body,
        'syncBuiltinESMExports();',
        '',
      ].join('\n'),
    );
    return spawnSync(process.execPath, ['--import', preload, checker, directory], {
      encoding: 'utf8',
      env: { ...process.env, JOB_TIMEOUT_STRICT: '1' },
    });
  });

test('the directory is listed and each workflow read once, so a change mid-run cannot pass', () => {
  const removed = preloaded(
    [
      'const list = fs.readdirSync;',
      'fs.readdirSync = (path, ...rest) => {',
      '  const names = list(path, ...rest);',
      '  if (String(path) === directory && fs.existsSync(file)) fs.unlinkSync(file);',
      '  return names;',
      '};',
    ].join('\n'),
  );
  assert.notEqual(removed.status, 0, removed.stdout + removed.stderr);
  assert.match(removed.stderr, /ci\.yml/u);
  assert.doesNotMatch(removed.stdout, /every job declares a timeout/u);

  const counted = preloaded(
    [
      'const seen = { listings: 0, reads: 0 };',
      'const list = fs.readdirSync;',
      'const read = fs.readFileSync;',
      'fs.readdirSync = (path, ...rest) => {',
      '  if (String(path) === directory) seen.listings += 1;',
      '  return list(path, ...rest);',
      '};',
      'fs.readFileSync = (path, ...rest) => {',
      '  if (String(path) === file) seen.reads += 1;',
      '  return read(path, ...rest);',
      '};',
      "process.on('exit', () => console.log(`seen ${JSON.stringify(seen)}`));",
    ].join('\n'),
  );
  assert.match(
    counted.stdout,
    /^seen \{"listings":1,"reads":1\}$/mu,
    counted.stdout + counted.stderr,
  );
  assert.equal(counted.status, 1, counted.stdout + counted.stderr);
});

// Sol's CF-09 fourth round, criterion 5. With the empty-set guard removed,
// strict mode printed that every job declares a timeout over nothing.
test('an empty workflow directory refuses, strict or not', () => {
  for (const files of [{}, { 'notes.txt': 'not a workflow' }]) {
    withDirectory(files, (directory) => {
      for (const strict of ['1', '']) {
        const run = spawnSync(process.execPath, [checker, directory], {
          encoding: 'utf8',
          env: { ...process.env, JOB_TIMEOUT_STRICT: strict },
        });
        assert.equal(run.status, 1, run.stdout + run.stderr);
        assert.match(run.stderr, /no workflow file in /u);
        assert.doesNotMatch(run.stdout, /every job declares a timeout/u);
      }
    });
  }
});
