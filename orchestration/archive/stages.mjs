#!/usr/bin/env node
// orchestration/archive/stages.json is the one source for the README "Run a round" table.
//   node orchestration/archive/stages.mjs --render   rewrite that table from the JSON
//   node orchestration/archive/stages.mjs --check    verify, write nothing
// What --check refuses, and what each column of the table counts, are stated
// once in orchestration/README.md. Failures exit 1; usage exits 2.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BEGIN = '<!-- stages:begin -->';
export const END = '<!-- stages:end -->';

// The runner's own minutes, by the stage whose wall they must match. Its
// `plan` entry is the overnight runner's planning session, not PLAN-CHECK, so
// nothing here claims it.
const RUNNER_MINUTES = { BUILD: 'build', REVIEW: 'review', FIX: 'fix' };

// The runner's per-pull-request session counts, by the stage that spends them
// and the account they are held under.
const RUNNER_PER_PULL_REQUEST = { REVIEW: 'sol' };

// The ceilings a row carries, by the name orchestration/archive/factory.sh fills them under in a
// brief: <BUILD-WALL>, <REVIEW-REVIEWS-PER-PULL-REQUEST> and so on.
const CEILINGS = {
  context: 'CONTEXT',
  wall: 'WALL',
  pushes: 'PUSHES',
  reviews: 'REVIEWS',
  reviewsPerPullRequest: 'REVIEWS-PER-PULL-REQUEST',
  pullRequests: 'PULL-REQUESTS',
};

// The stages whose brief runs each session at a deadline, so it also carries
// the wall in seconds: <REVIEW-WALL-SECONDS>.
const DEADLINES = new Set(['PLAN-CHECK', 'REVIEW']);

// Templates no row names, and the ceilings each takes from its placeholder:
// the boot holds a pull request at the REVIEW row's per-pull-request cap, and
// the fix-head brief judges pass line 4 by that cap and stops at the run's.
const OTHERS = [
  ['boot', 'orchestration/archive/boot/ORCHESTRATOR-BOOT-TEMPLATE.md', ['<REVIEW-REVIEWS-PER-PULL-REQUEST>']],
  ['brief', 'orchestration/archive/briefs/BRIEF-REVIEW-FIXHEAD-TEMPLATE.md', ['<REVIEW-REVIEWS-PER-PULL-REQUEST>', '<REVIEW-REVIEWS>']],
];

// A count written beside the unit of a ceiling the template takes from a
// placeholder restates that ceiling, and goes stale when orchestration/archive/stages.json changes:
// "two pushes", "one `git push`", "a third session". An ordinal that ends a
// clause has only dropped its unit: "there is no third".
const UNITS = { context: 'percent', wall: 'minutes?', pushes: 'push(?:es)?', reviews: 'reviews?|sessions?',
  reviewsPerPullRequest: 'reviews?|sessions?', pullRequests: 'pull requests?' };
// Every number word, built from its parts: Sol's review of 11bb360 found a
// list of words that stopped short of "thirteen", and its review of 87a9f77
// one that stopped at "million" and took no "twenty-first". "First" counts
// before a unit only: ending a clause it is an order ("read first, then act").
const TEEN = '(?:thir|four|fif|six|seven|eigh|nine)teen';
const TY = '(?:twen|thir|for|fif|six|seven|eigh|nine)t';
const SCALE = '(?:hundred|thousand|(?:m|b|tr|quadr|quint|sext|sept|oct|non|dec)illion)';
const ORDINAL = `(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|${TEEN}th|${TY}ieth|${SCALE}th)`;
const NUMBER = `(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|${TEEN}|${TY}y|${SCALE}s?|dozens?|once|twice|${ORDINAL})`;
// Counts in any case; a unit capitalised at most, so a stage name (REVIEW) is no unit.
const either = (words, all) => words.map((w) => w.replace(all ? /[a-z]/g : /^[a-z]/, (c) => `[${c}${c.toUpperCase()}]`)).join('|');

// Markdown that renders as nothing, found by where it starts, so a ceiling can
// never sit there in place of the one a reader sees: link and image targets
// and reference definitions, each over any number of lines. HTML is the rest:
// every `<` must open a placeholder, so no comment, tag or element is left.
const HIDDEN = [
  [/\]\s*\(/, 'a link or image target'],
  [/\]\s*:/, 'a reference definition'],
];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function ceiling(stage) {
  const parts = [];
  if (stage.context !== null) parts.push(`${stage.context} percent context`);
  if (stage.wall !== null) parts.push(`${stage.wall} minutes`);
  if (stage.pushes !== null) parts.push(plural(stage.pushes, 'push', 'pushes'));
  if (stage.reviews !== null) {
    const reviews = plural(stage.reviews, 'review', 'reviews');
    const per = stage.reviewsPerPullRequest;
    parts.push(per === undefined ? reviews : `${reviews} (${per} per pull request)`);
  }
  if (stage.pullRequests !== null) {
    parts.push(plural(stage.pullRequests, 'pull request', 'pull requests'));
  }
  return parts.length > 0 ? parts.join(', ') : 'no ceiling of its own';
}

export function renderTable(stages) {
  const rows = stages.map((stage) => [
    stage.stage,
    stage.actor,
    stage.model === null ? 'none' : stage.model,
    ceiling(stage),
    stage.brief === null ? 'none' : `\`${stage.brief}\``,
  ]);
  const lines = ['| Stage | Actor | Model | Ceiling | Brief |', '| --- | --- | --- | --- | --- |'];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

// The placeholders a template may carry: every one orchestration/README.md
// lists, and each row's ceilings.
function placeholders(root, stages) {
  const readme = join(root, 'orchestration', 'README.md');
  const listed = existsSync(readme) ? readFileSync(readme, 'utf8').match(/`<[^<>`\n]+>`/g) ?? [] : [];
  const known = new Set(listed.map((p) => p.slice(1, -1)));
  for (const stage of stages) {
    for (const name of [...Object.values(CEILINGS), 'WALL-SECONDS']) known.add(`<${stage.stage.toUpperCase()}-${name}>`);
  }
  return known;
}

function restatements(text, stages) {
  const units = new Set();
  for (const stage of stages) {
    for (const [field, name] of Object.entries(CEILINGS)) {
      if (text.includes(`<${stage.stage.toUpperCase()}-${name}>`)) units.add(UNITS[field]);
    }
  }
  const unit = either([...units].flatMap((u) => u.split('|')), false) || '(?!)';
  const gap = '[\\s`*_~()]+';     // spaces and the inline Markdown that renders as none
  const word = either([NUMBER], true);
  const first = either(['first'], true);
  const words = `(?:${word}|${first})(?:(?:-|\\s+)(?:and(?:-|\\s+))?(?:${word}|${first}))*`;
  const count = `(?<![\\w-])(?:\\d+(?:st|nd|rd|th)?|${words})${gap}(?:[\\w-]+${gap})?(?:${unit})\\b`;
  const ordinal = `(?<![\\w-])(?:[\\w-]*-)?(?:\\d+(?:nd|rd|th)|${either([ORDINAL], true)}|${word}-${first})(?=[*_~]*[.,;:!?)])`;
  return text.match(new RegExp(`${count}|${ordinal}`, 'g')) ?? [];
}

// What a template fails on: a part that renders as nothing, a ceiling it
// must take from its placeholder and does not, or one it restates.
function templateFailures(label, path, text, wanted, known, stages) {
  const failures = [];
  for (const words of restatements(text, stages)) {
    failures.push({ label, message: `${path} restates a ceiling as ${JSON.stringify(words)}; take it from its placeholder` });
  }
  for (const [pattern, what] of HIDDEN) {
    if (pattern.test(text)) failures.push({ label, message: `${path} carries ${what}, which renders as nothing` });
  }
  for (const token of new Set(text.match(/<[^<>\n]*>?/g) ?? [])) {
    if (!known.has(token)) failures.push({ label, message: `${path} carries ${JSON.stringify(token)}, which is no placeholder, and HTML can render as nothing` });
  }
  for (const placeholder of wanted.filter((p) => !text.includes(p))) {
    failures.push({ label, message: `${path} does not carry ${placeholder}` });
  }
  return failures;
}

function readStages(root) {
  return JSON.parse(readFileSync(join(root, 'orchestration', 'archive', 'stages.json'), 'utf8'));
}

// The block is what sits between the markers, blank line padded so the table
// renders. Returns null when either marker is missing or they are out of order.
function block(readme) {
  const start = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) return null;
  return readme.slice(start + BEGIN.length, end);
}

export function render(root = repoRoot) {
  const readmePath = join(root, 'README.md');
  const readme = readFileSync(readmePath, 'utf8');
  const current = block(readme);
  if (current === null) throw new Error(`README.md carries no ${BEGIN} and ${END} pair`);
  const wanted = `\n\n${renderTable(readStages(root))}\n\n`;
  if (current === wanted) return false;
  writeFileSync(readmePath, readme.replace(BEGIN + current + END, BEGIN + wanted + END));
  return true;
}

export function checkStages(root = repoRoot) {
  const stages = readStages(root);
  const failures = [];

  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const current = block(readme);
  if (current === null) {
    failures.push({ label: 'readme', message: `no ${BEGIN} and ${END} pair` });
  } else if (current !== `\n\n${renderTable(stages)}\n\n`) {
    failures.push({ label: 'readme', message: 'the table differs from the render; run --render' });
  }

  // orchestration/archive/factory.sh fills a ceiling as written: "15" would be a 120-digit deadline.
  for (const stage of stages) {
    for (const field of Object.keys(CEILINGS)) {
      const value = stage[field];
      if (value !== null && value !== undefined && !(Number.isInteger(value) && value >= 0)) {
        failures.push({ label: 'stages', message: `${stage.stage}: ${field} ${JSON.stringify(value)} is not a whole number` });
      }
    }
  }

  const counts = new Map();
  // orchestration/archive/factory.sh fills <BUILD-WALL> from `build` and `BUILD` alike, so case does not part two rows.
  for (const stage of stages) {
    const name = stage.stage.toUpperCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const [name, count] of counts) {
    if (count > 1) failures.push({ label: 'stages', message: `${name}: ${count} rows; a stage has one` });
  }

  const known = placeholders(root, stages);
  for (const stage of stages) {
    if (stage.brief === null) continue;
    if (!existsSync(join(root, stage.brief))) {
      failures.push({ label: 'brief', message: `${stage.stage}: ${stage.brief} is not there` });
      continue;
    }
    const text = readFileSync(join(root, stage.brief), 'utf8');
    const upper = stage.stage.toUpperCase();
    const wanted = Object.entries(CEILINGS)
      .filter(([field]) => stage[field] !== null && stage[field] !== undefined)
      .map(([, name]) => `<${upper}-${name}>`);
    if (DEADLINES.has(upper)) wanted.push(`<${upper}-WALL-SECONDS>`);
    for (const failure of templateFailures('brief', stage.brief, text, wanted, known, stages)) {
      failures.push({ ...failure, message: `${stage.stage}: ${failure.message}` });
    }
  }
  for (const [label, path, wanted] of OTHERS) {
    if (existsSync(join(root, path))) {
      failures.push(...templateFailures(label, path, readFileSync(join(root, path), 'utf8'), wanted, known, stages));
    } else {
      failures.push({ label, message: `${path} is not there` });
    }
  }

  const runner = JSON.parse(
    readFileSync(join(root, 'template', 'scripts', 'runner', 'runner.json'), 'utf8'),
  );
  for (const [name, key] of Object.entries(RUNNER_MINUTES)) {
    const stage = stages.find((s) => s.stage === name);
    const minutes = runner.minutes[key];
    if (stage === undefined) {
      failures.push({ label: 'runner', message: `${key}: no ${name} row to check it against` });
    } else if (minutes !== stage.wall) {
      failures.push({
        label: 'runner',
        message: `${key}: runner.json ${minutes} against ${name} wall ${stage.wall}`,
      });
    }
  }

  for (const [name, account] of Object.entries(RUNNER_PER_PULL_REQUEST)) {
    const stage = stages.find((s) => s.stage === name);
    const allowed = runner.perPullRequest[account];
    if (stage === undefined) {
      failures.push({ label: 'runner', message: `${account}: no ${name} row to check it against` });
    } else if (allowed !== stage.reviewsPerPullRequest) {
      const wanted = stage.reviewsPerPullRequest;
      failures.push({
        label: 'runner',
        message: `${account}: runner.json ${allowed} against ${name} reviews per pull request ${wanted}`,
      });
    }
  }

  return failures;
}

function main(argv) {
  const wantsRender = argv.includes('--render');
  const wantsCheck = argv.includes('--check');
  if (wantsRender === wantsCheck) {
    console.error('usage: node orchestration/archive/stages.mjs --render | --check');
    return 2;
  }

  if (wantsRender) {
    const written = render();
    console.log(written ? 'rendered README.md from orchestration/archive/stages.json' : 'README.md already matches orchestration/archive/stages.json');
    return 0;
  }

  const failures = checkStages();
  for (const failure of failures) console.log(`FAIL     ${failure.label}  ${failure.message}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} disagreement(s) with orchestration/archive/stages.json`);
    return 1;
  }
  console.log('ok       readme   the table matches the render');
  console.log('ok       stages   one row per stage, each ceiling a whole number');
  console.log('ok       briefs   every brief template is there, hides nothing, and takes its ceilings from stages.json without restating them');
  console.log('ok       boot     the boot template hides nothing and takes its hold cap from the REVIEW row');
  console.log('ok       runner   runner.json minutes and per-pull-request reviews match their rows');
  console.log('\nstages:table clean');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
