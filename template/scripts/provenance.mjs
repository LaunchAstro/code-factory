// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';

const agentKeys = ['Assisted-by', 'Agent-model', 'Agent-tool'];
const humanKey = 'Signed-off-by';
const placeholder =
  /<[^>]*>|\[[^\]]*\]|\{[^}]*\}|^(?:todo|tbd|unknown|placeholder|n\/a|none|null|actual[- ](?:model(?:[- ]id)?|tool)|the model|the tool)$/iu;

// Git owns footer parsing in both the local hook and the range checker.
export function messageProvenanceErrors(message) {
  const trailers = execFileSync('git', ['interpret-trailers', '--parse'], {
    input: message,
    encoding: 'utf8',
  });
  return validateProvenance(trailers);
}

// Pure validation of Git's parsed trailers. Values are declarations, not proof
// of the model used or of who typed a human sign-off.
export function validateProvenance(trailerText) {
  const trailers = new Map();
  for (const line of trailerText.split('\n')) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    const values = trailers.get(key) ?? [];
    values.push(line.slice(at + 1).trim());
    trailers.set(key, values);
  }
  const values = (key) => trailers.get(key.toLowerCase()) ?? [];
  const errors = [];
  for (const key of agentKeys) {
    if (values(key).some((value) => value === '' || placeholder.test(value))) {
      errors.push(`${key} contains an empty value or template placeholder.`);
    }
    if (new Set(values(key)).size > 1) {
      errors.push(`${key} contains conflicting declarations.`);
    }
  }
  if (values('Assisted-by').some((value) => value !== 'LLM')) {
    errors.push('Every Assisted-by value must equal LLM.');
  }
  const human = values(humanKey);
  if (
    human.some((value) => {
      const declaration = /^(.+)\s<[^<>@\s]+@[^<>@\s]+>$/u.exec(value);
      return !declaration || placeholder.test(declaration[1].trim());
    })
  ) {
    errors.push(`${humanKey} requires a person's name and email address.`);
  }
  const missing = agentKeys.filter((key) => values(key).length === 0);
  const anyAgent = missing.length !== agentKeys.length;
  if ((anyAgent || human.length === 0) && missing.length > 0) {
    errors.push(
      `Provenance requires all agent trailers; missing: ${missing.join(', ')}. A human may supply their own sign-off instead.`,
    );
  }
  return errors;
}

// GitHub writes the merge commits its own ruleset requires, and it writes them
// as "Merge pull request #N from ..." with no trailers and no conventional
// type. Both rules can only hold at once if the platform's own merge commit is
// exempt. Three things must hold at once, and the wording is not one of them:
//
//   exactly two parents. GitHub's pull-request merge has two. An ordinary
//     commit is never exempt, including the ones the web editor writes, and
//     neither is an octopus merge, which GitHub does not write;
//   the web-flow identity on the committer, which is the identity GitHub puts
//     on a commit it wrote itself. All twelve merges on this repository have a
//     person as author and GitHub as committer;
//   already on the base's own history. The identity is a claim anyone can
//     type, so a commit that a branch introduces is never exempt. Only a commit
//     already on the protected branch can be, and the ruleset lets nothing but
//     GitHub's own merge put one there.
//
// It exempts commits of that kind and no others: every commit a merge brings
// in is still checked on its own.
const webFlowEmail = 'noreply@github.com';
const webFlowNames = new Set(['github', 'web-flow']);

const isWebFlow = (identity) =>
  String(identity?.email ?? '')
    .trim()
    .toLowerCase() === webFlowEmail &&
  webFlowNames.has(
    String(identity?.name ?? '')
      .trim()
      .toLowerCase(),
  );

export function isPlatformMergeCommit(commit) {
  if ((commit?.parents ?? []).length !== 2) return false;
  if (commit?.onBaseHistory !== true) return false;
  return isWebFlow(commit?.committer);
}
