// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isMainModule, refuse } from './main-module.mjs';
import { checkCandidate, indexFiles, localEnv, options } from './candidate-snapshot.mjs';

// This small public-foundation policy supplements the existing contamination
// and secret scanners. Hashes avoid publishing excluded names and identities.
const excludedTokenHashes = new Set([
  '51a638da30b84b53774abb2c4a6e12645daad279f51354016452d3719b1eeca7',
  '56fe43f748e258de06b4955e2b8978bbc1c28ff9ba53917387d6dca8fb920018',
  // Synthetic tokens exercise this rule without carrying real identities.
  '675b6b1683ab1f3597ab19f6d5a7cd0900452d8f205a0cb0471fa7abdd3eb98d',
  '0921cc4b2766b9acdc1751926c2c3b8ac06f0fd5c545974176e971196abfe4e4',
]);
const rules = [
  ['project-finance-context', /\b(?:project|launch|seed|client)[-\s]+funding\b/iu],
  ['private-pitch-url', /\bhttps?:\/\/(?:[a-z0-9-]+\.)*pitch(?:es)?\.[a-z0-9.-]+/iu],
  [
    'commercial-proposal',
    /\b(?:sponsor(?:ship)?|funding|private[-\s]+client|client[-\s]+commercial)[-\s]+(?:proposal|round|agreement|arrangement|money|commitment|pitch|funding)\b/iu,
  ],
  [
    'personal-path',
    /(?:\/(?:Users|home)\/[a-z0-9._-]+|[a-z]:\\Users\\[a-z0-9._-]+|~\/(?:Desktop|Documents|Vaults)\/)/iu,
  ],
];

// A failure this module states in fixed words. Any other caught error is
// reported in fixed words too: a parser's or Git's message can quote its input.
class Refusal extends Error {}

// Git hands back a loose object's bytes without hashing them, so other bytes
// stored under an id would stand in for it. Each object is hashed as Git
// hashes it, `<type> <length>\0` and the bytes, in the object format the id is
// written in (SHA-1 or SHA-256), and refused when it does not match.
export function readObject(repo, type, oid) {
  const format = { 40: 'sha1', 64: 'sha256' }[/^[0-9a-f]+$/u.test(oid) && oid.length];
  if (!format) throw new Refusal('a Git object id is in no known format');
  const bytes = execFileSync('git', ['-C', repo, 'cat-file', type, oid], {
    env: localEnv,
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (createHash(format).update(`${type} ${bytes.length}\0`).update(bytes).digest('hex') !== oid) {
    throw new Refusal(`Git ${type} bytes do not match their object id`);
  }
  return bytes;
}

// The synthetic shape fixture's approved versions, read from the one manifest
// the contamination gate reads, so approving a fixture stays one edit there.
// Read by each scan, inside its caller's error handling: a failed read must
// never print a stack or the checkout path. The manifest is read as strictly
// as the gate reads it: printable ASCII and LF only, so both split lines alike,
// and at least one record, every record a sha256 and a path. Absent, empty,
// comment-only or malformed is refused, text unshown.
const shapeFixture = 'tests/gate/shape-canary.txt';
const approvedShapeFixtures = () => {
  const bytes = readFileSync(new URL('./gate/approved-exemptions.sha256', import.meta.url));
  const records = bytes
    .toString('latin1')
    .split('\n')
    .map((line) => line.split('#', 1)[0].trim())
    .filter(Boolean)
    .map((line) => /^([0-9a-f]{64})\s+(\S.*)$/iu.exec(line));
  if (
    records.length === 0 ||
    records.includes(null) ||
    bytes.some((byte) => byte !== 0x0a && (byte < 0x20 || byte > 0x7e))
  ) {
    throw new Refusal('the approval manifest is empty or malformed (its text is withheld)');
  }
  return new Set(
    records.filter(([, , path]) => path === shapeFixture).map(([, digest]) => digest.toLowerCase()),
  );
};

export function contentRules(text) {
  const found = rules.filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
  const words = text.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
  if (
    words.some((word) => excludedTokenHashes.has(createHash('sha256').update(word).digest('hex')))
  )
    found.push('excluded-token');
  return found;
}

export function scanPublicFiles(entries) {
  const findings = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const approved = approvedShapeFixtures();
  for (const { path, bytes, label } of entries) {
    // A filename can hold a credential or a private name that these rules do
    // not know, so no path is printed: a fingerprint tells findings apart.
    const display =
      label ??
      `<withheld-path ${createHash('sha256').update(path).digest('hex').slice(0, 8)}/${path.length}>`;
    for (const rule of contentRules(path)) findings.push({ file: display, rule });
    let text;
    try {
      text = decoder.decode(bytes);
    } catch {
      findings.push({ file: display, rule: 'non-text-foundation-file' });
      continue;
    }
    if (text.includes('\0')) {
      findings.push({ file: display, rule: 'non-text-foundation-file' });
      continue;
    }
    // The inherited synthetic shape fixture is approved by exact bytes. This
    // exception covers its path shapes only; every other rule still scans it.
    const approvedShapes =
      (path === shapeFixture || path === `template/${shapeFixture}`) &&
      approved.has(createHash('sha256').update(bytes).digest('hex'));
    for (const rule of contentRules(text)) {
      if (rule === 'personal-path' && approvedShapes) continue;
      findings.push({ file: display, rule });
    }
  }
  return findings;
}

export function publicHistory(repository, range) {
  const git = (args, env = localEnv) =>
    execFileSync('git', ['-C', repository, ...args], {
      env,
      stdio: 'pipe',
      maxBuffer: 64 * 1024 * 1024,
    });
  // Git is told to ignore any graft file, so the subject's own is looked up
  // without that setting: a graft file present at all is refused.
  const grafts = git(['rev-parse', '--path-format=absolute', '--git-path', 'info/grafts'], {
    ...localEnv,
    GIT_GRAFT_FILE: undefined,
  });
  if (
    git(['rev-parse', '--is-shallow-repository']).toString().trim() !== 'false' ||
    existsSync(grafts.toString().trim())
  ) {
    throw new Refusal('history policy requires a complete Git checkout without grafts');
  }
  let selection;
  if (range === undefined) selection = ['--branches', '--not', '--remotes'];
  else {
    const parts = range.split('..');
    if (parts.length > 2 || parts.some((part) => !part || part.startsWith('-'))) {
      throw new Refusal('range must be one commit/ref or BASE..HEAD');
    }
    const commits = parts.map((part) => {
      const oid = git(['rev-parse', '--verify', '--end-of-options', `${part}^{object}`])
        .toString()
        .trim();
      if (git(['cat-file', '-t', oid]).toString().trim() !== 'commit') {
        throw new Refusal(
          'range endpoints must be commits; annotated tag publication is not supported',
        );
      }
      return oid;
    });
    selection = [commits.join('..')];
  }
  const commits = git(['rev-list', ...selection])
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean);
  const files = [];
  const blobs = new Map();
  const seen = new Set();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  // Every commit, tree and blob is read through readObject: `ls-tree -r`
  // would not check the subtrees it lists. A tree is raw entries,
  // `<mode> <name>\0<binary id>`; each tree's files are listed once.
  const trees = new Map();
  const listTree = (oid) => {
    if (trees.has(oid)) return trees.get(oid);
    const bytes = readObject(repository, 'tree', oid);
    const entries = [];
    for (let at = 0; at < bytes.length;) {
      const space = bytes.indexOf(0x20, at);
      const end = space === -1 ? -1 : bytes.indexOf(0, space);
      const next = end + 1 + oid.length / 2;
      if (end === -1 || next > bytes.length) throw new Refusal('history contains a malformed tree');
      const mode = bytes.toString('latin1', at, space);
      const name = decoder.decode(bytes.subarray(space + 1, end));
      const child = bytes.toString('hex', end + 1, next);
      at = next;
      if (mode === '40000') {
        for (const file of listTree(child)) entries.push({ ...file, path: `${name}/${file.path}` });
      } else if (['100644', '100755', '120000'].includes(mode)) {
        entries.push({ oid: child, path: name });
      } else throw new Refusal('history contains an unsupported entry');
    }
    trees.set(oid, entries);
    return entries;
  };
  for (const sha of commits) {
    // Read the raw commit object, including author, committer and message.
    // Reporting uses the object ID only, never metadata or matched values.
    const label = `commit-${sha}-metadata`;
    const commit = readObject(repository, 'commit', sha);
    files.push({ path: label, label, bytes: commit });
    const tree = /^tree ([0-9a-f]+)\n/u.exec(commit.toString('latin1'))?.[1];
    if (!tree) throw new Refusal('history contains a commit without a tree');
    for (const { oid, path } of listTree(tree)) {
      const pair = `${oid}\0${path}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      if (!blobs.has(oid)) blobs.set(oid, readObject(repository, 'blob', oid));
      files.push({ path, bytes: blobs.get(oid) });
    }
  }
  return { files, commits: commits.length, blobPaths: seen.size };
}

if (isMainModule(import.meta.url)) {
  let subject = 'arguments';
  try {
    const args = process.argv.slice(2);
    const outgoingAt = args.indexOf('--outgoing');
    const outgoing = outgoingAt !== -1;
    if (outgoing) args.splice(outgoingAt, 1);
    const opts = options(args, ['repo', 'candidate', 'manifest', 'range']);
    if (
      (opts.range && outgoing) ||
      (opts.repo
        ? opts.candidate || opts.manifest
        : !opts.candidate || !opts.manifest || opts.range || outgoing)
    ) {
      throw new Refusal(
        'usage: public-content-check.mjs --repo DIR [--range REF_OR_BASE..HEAD | --outgoing]; or --candidate DIR --manifest EXTERNAL_JSON',
      );
    }
    subject = opts.range || outgoing ? 'history' : opts.repo ? 'index' : 'candidate';
    const history = subject === 'history' ? publicHistory(opts.repo, opts.range) : undefined;
    const files = history
      ? history.files
      : opts.repo
        ? indexFiles(opts.repo)
        : checkCandidate(opts.candidate, opts.manifest);
    // No commit, no staged file or an empty candidate is no evidence of anything.
    if (files.length === 0) throw new Refusal('nothing to check: the selection is empty');
    if (history)
      console.log(
        `public-content: ${history.commits} commit(s), ${history.blobPaths} distinct historical blob/path pair(s)`,
      );
    const findings = scanPublicFiles(files);
    for (const { file, rule } of findings) console.error(`public-content: ${file} [${rule}]`);
    console.log(
      `public-content: ${files.length} ${history ? 'history entries' : 'files'}, ${findings.length} policy finding(s). This is a bounded content check, not a security certification.`,
    );
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    refuse(
      'public-content',
      subject,
      error instanceof Refusal ? error.message : 'a file, Git or manifest check failed',
      1,
    );
  }
}
