#!/usr/bin/env node
// Populate orchestration/skills/<name>/ from the pins in SOURCES.json.
// Fetched directories are git-ignored: the manifest is what this repository keeps.
//   node orchestration/skills/fetch.mjs            fetch, verify, then install
//   node orchestration/skills/fetch.mjs --check    compare the installed skills with the pins, install nothing
//   --installed <dir>   the skills directory, when this copy of fetch.mjs is not
//                       in it (factory.sh runs the checked commit's copy)
// Exits non-zero on a malformed or empty manifest, a missing source, a file
// read that is not one base64 file, a file its git tree gives no regular file
// mode, a sha256 that does not match the pin, or (with --check) an installed
// skill that is absent or differs from what its pin fetches.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The orchestration copy of template/scripts/main-module.mjs `exitWith`
// (#316), kept here because this file is copied alone: each line goes to
// standard error whole before the exit, a full non-blocking pipe is waited
// on, and any other write error loses the text but never the exit code.
const pause = new Int32Array(new SharedArrayBuffer(4));
function exitWith(code, ...lines) {
  const bytes = Buffer.from(lines.map((line) => `${line}\n`).join(''));
  let written = 0;
  while (written < bytes.length) {
    try {
      written += writeSync(2, bytes, written);
    } catch (error) {
      if (error?.code !== 'EAGAIN') break;
      Atomics.wait(pause, 0, 0, 10);
    }
  }
  process.exit(code);
}

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, 'SOURCES.json'), 'utf8'));
const check = process.argv.includes('--check');
const at = process.argv.indexOf('--installed');
const root = at === -1 ? here : process.argv[at + 1];
const failures = [];
if (root === undefined || root.startsWith('-')) {
  exitWith(2, 'usage: node orchestration/skills/fetch.mjs [--check] [--installed <dir>]');
}

// A skill name is one lower-case path segment, as the skill format requires;
// anything else could name a directory outside this one.
const NAME = /^[a-z0-9][a-z0-9-]*$/;
const PIN = { repository: /^[\w.-]+\/[\w.-]+$/, commit: /^[0-9a-f]{40}$/, sha256: /^[0-9a-f]{64}$/ };

// Check the whole manifest first, so a malformed one removes and fetches nothing.
function manifestProblems(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return ['SOURCES.json pins no skills'];
  const problems = [];
  const seen = new Set();
  for (const skill of skills) {
    const label = JSON.stringify(skill?.name);
    if (typeof skill?.name !== 'string' || !NAME.test(skill.name)) {
      problems.push(`${label}: a skill name is one lower-case path segment`);
    } else if (seen.has(skill.name)) {
      problems.push(`${label}: pinned twice`);
    }
    seen.add(skill?.name);
    for (const [key, pattern] of Object.entries(PIN)) {
      if (typeof skill?.[key] !== 'string' || !pattern.test(skill[key])) problems.push(`${label}: ${key} is malformed`);
    }
    const path = skill?.path;
    if (typeof path !== 'string' || path === '' || path.split('/').some((p) => p === '' || p === '.' || p === '..')) {
      problems.push(`${label}: path is malformed`);
    }
  }
  return problems;
}

// gh api reads private and public repositories alike with the machine's own
// login, so no token and no credentialled URL enters the tree.
function ghApi(path) {
  const out = execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

// Each path segment is encoded, so a `?` or `#` in a pin or a listing names a
// file and never replaces the pinned ref.
function contents(repository, path, commit) {
  return ghApi(`repos/${repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`);
}

// A contents read carries no file mode, so the directory's git tree, read by
// the sha its parent's pinned listing gives, says which files are executable.
function treeSha(repository, path, commit) {
  const cut = path.lastIndexOf('/');
  const listing = contents(repository, cut === -1 ? '' : path.slice(0, cut), commit);
  return Array.isArray(listing) ? listing.find((e) => e.type === 'dir' && e.name === path.slice(cut + 1))?.sha : undefined;
}

function treeModes(repository, path, sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${path} has no git tree in its parent's listing`);
  const tree = ghApi(`repos/${repository}/git/trees/${sha}`);
  if (!Array.isArray(tree?.tree) || tree.truncated) throw new Error(`${path}'s git tree came back incomplete`);
  return new Map(tree.tree.map((e) => [e.path, e.mode]));
}

function fetchDir(repository, path, commit, dest, tree) {
  const entries = contents(repository, path, commit);
  if (!Array.isArray(entries)) throw new Error(`${path} is not a directory`);
  const modes = treeModes(repository, path, tree ?? treeSha(repository, path, commit));
  mkdirSync(dest, { recursive: true });
  for (const entry of entries) {
    if (typeof entry.name !== 'string' || !/^[^/\\]+$/.test(entry.name) || entry.name === '.' || entry.name === '..') {
      throw new Error(`${path} lists an entry named ${JSON.stringify(entry.name)}, which is not one file name`);
    }
    if (entry.type === 'dir') {
      fetchDir(repository, entry.path, commit, join(dest, entry.name), entry.sha);
    } else if (entry.type === 'file') {
      const mode = { 100644: 0o644, 100755: 0o755 }[modes.get(entry.name)];
      if (mode === undefined) throw new Error(`${entry.path} has mode ${modes.get(entry.name)} in its git tree, not a regular file's`);
      writeFileSync(join(dest, entry.name), decoded(entry.path, contents(repository, entry.path, commit)), { mode });
    } else {
      throw new Error(`${entry.path} is a ${entry.type}, which this fetcher does not follow`);
    }
  }
}

// A file read is one base64 file, broken over lines as the API sends it.
// Node decodes anything, "!" to no bytes, so the bytes must encode back to
// the text, and to the size the response states when it states one.
function decoded(path, file) {
  const text = typeof file?.content === 'string' ? file.content.replaceAll('\n', '') : null;
  const bytes = Buffer.from(text ?? '', 'base64');
  if (text === null || (file.encoding ?? 'base64') !== 'base64' || bytes.toString('base64') !== text || (file.size ?? bytes.length) !== bytes.length) {
    throw new Error(`${path} came back as no base64 file of its stated size`);
  }
  return bytes;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// A skill counts as installed if it sits in a user or project skills directory,
// or inside an installed plugin's skills directory.
function skillPresent(name) {
  const direct = [
    join(homedir(), '.claude', 'skills', name, 'SKILL.md'),
    join(process.cwd(), '.claude', 'skills', name, 'SKILL.md'),
  ];
  if (direct.some((p) => existsSync(p))) return true;
  const pluginRoots = [
    join(homedir(), '.claude', 'plugins', 'cache'),
    join(homedir(), '.claude', 'plugins', 'marketplaces'),
  ];
  return pluginRoots.some((root) => walkForSkill(root, name, 6));
}

function walkForSkill(dir, name, depth) {
  if (depth < 0 || !existsSync(dir)) return false;
  if (basename(dir) === 'skills' && existsSync(join(dir, name, 'SKILL.md'))) return true;
  let children;
  try {
    children = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return children.some((c) => c.isDirectory() && walkForSkill(join(dir, c.name), name, depth - 1));
}

// Every file under dir, by its path relative to dir, with its bytes and
// whether its owner may run it; a symlink or other non-file maps to null, so
// it never matches a fetched file.
function files(dir) {
  const out = new Map();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const path = join(entry.parentPath, entry.name);
    out.set(relative(dir, path), entry.isFile() ? { bytes: readFileSync(path), runs: (statSync(path).mode & 0o100) !== 0 } : null);
  }
  return out;
}

function differences(installed, fetched) {
  if (!existsSync(installed)) return ['not installed; run node orchestration/skills/fetch.mjs'];
  const have = files(installed);
  const want = files(fetched);
  const names = [...new Set([...have.keys(), ...want.keys()])].sort();
  const same = (a, b) => a && b && a.bytes.equals(b.bytes);
  return names
    .filter((name) => !(same(have.get(name), want.get(name)) && have.get(name).runs === want.get(name).runs))
    .map((name) => `${name} ${!have.has(name) ? 'missing' : !want.has(name) ? 'not in the pin' : same(have.get(name), want.get(name)) ? 'mode differs from the pin' : 'differs from the pin'}`);
}

const problems = manifestProblems(manifest.skills);
if (problems.length > 0) {
  exitWith(1, 'refused: SOURCES.json is malformed, nothing fetched or removed:', ...problems.map((problem) => `  ${problem}`));
}

// Each skill is fetched into a staging directory and verified there. Only a
// verified fetch replaces the installed copy; --check compares and replaces nothing.
const staging = mkdtempSync(join(check ? tmpdir() : root, '.fetch-'));
try {
  for (const skill of manifest.skills) {
    const fetched = join(staging, skill.name);
    const installed = join(root, skill.name);
    try {
      fetchDir(skill.repository, skill.path, skill.commit, fetched);
      const entry = join(fetched, 'SKILL.md');
      if (!existsSync(entry)) throw new Error('no SKILL.md in the fetched directory');
      const got = sha256(entry);
      if (got !== skill.sha256) {
        throw new Error(`SKILL.md sha256 ${got} does not match the pin ${skill.sha256}`);
      }
      if (check) {
        const drift = differences(installed, fetched);
        if (drift.length > 0) throw new Error(`installed copy: ${drift.join(', ')}`);
      } else {
        rmSync(installed, { recursive: true, force: true });
        renameSync(fetched, installed);
      }
      console.log(`ok       ${skill.name}  ${skill.repository}@${skill.commit.slice(0, 7)}`);
    } catch (error) {
      failures.push(`${skill.name}: ${error.message}`);
      console.log(`FAIL     ${skill.name}  ${error.message}`);
    }
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

// Prerequisites are installed by whoever runs the kit, not fetched by it.
// Missing ones are reported with their install command; they do not fail the run.
console.log('');
for (const prerequisite of manifest.prerequisites) {
  const missing = prerequisite.skills.filter((name) => !skillPresent(name));
  if (missing.length === 0) {
    console.log(`present  ${prerequisite.name}  (${prerequisite.skills.join(', ')})`);
  } else {
    console.log(`MISSING  ${prerequisite.name}  not found: ${missing.join(', ')}`);
    for (const command of prerequisite.install) console.log(`         ${command}`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} skill(s) failed:\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
} else {
  console.log(check ? '\nskills:pinned clean' : `\nfetched ${manifest.skills.length} skills into ${root}`);
}
