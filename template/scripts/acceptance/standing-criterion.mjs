// SPDX-License-Identifier: AGPL-3.0-only
// The one criterion every plan carries, because round 3 merged a fail-open
// fallback no numbered criterion covered. CONTRIBUTING.md step 3 has the words.

import { visibleText } from '../markdown.mjs';

// A plan.md directly inside an acceptance directory, not a fixture or a doc.
const PLAN_FILE = /^tests\/acceptance\/[^/]+\/plan\.md$/u;
const HEADING = /^#{2,6}\s+Acceptance criteria\s*$/iu;
// CommonMark still renders an ATX heading indented one to three spaces, so it
// ends the section too; anchored at column 0 an item under one still counted.
const ANY_HEADING = /^ {0,3}#{1,6}\s/u;
// A setext heading is text with `=` or `-` ruled under it, so the rule is what
// ends the section; with ATX alone an item below one counted. Under a blank
// line or a list item a rule heads nothing.
const SETEXT = /^(?:=+|-+)\s*$/u;
const LIST = /^\s*(?:\d+[.)]|[-*+])\s/u;
// A top-level numbered item: a nested list or a paragraph is not one to cite.
// A nested item is indented to its parent's content, three columns in, so two
// is the last column a top-level item begins at. At three it counted a nested
// one, which the line above always said was not one to cite.
const ITEM = /^ {0,2}\d+[.)]\s+Fails closed:/u;
const say = (why) => `${why}. CONTRIBUTING.md step 3 carries the words`;

/** The plan files in a list of changed paths, and nothing else. */
export const plansIn = (paths) => paths.filter((path) => PLAN_FILE.test(path));

/**
 * The lines under the plan's `## Acceptance criteria` heading, or `null` when
 * there is none. The one reader of the section: `scripts/plan-check.mjs`
 * imports it rather than keeping a second copy of these rules, so a fix to one
 * cannot leave the two counting different sections.
 */
export function criteriaSection(text) {
  const lines = visibleText(text).split('\n');
  const start = lines.findIndex((line) => HEADING.test(line));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(
    (line, i) =>
      ANY_HEADING.test(line) ||
      (SETEXT.test(line) && (rest[i - 1] ?? '').trim() !== '' && !LIST.test(rest[i - 1] ?? '')),
  );
  return end === -1 ? rest : rest.slice(0, end);
}

/** Why this plan lacks the criterion, in one line, or `''`. Unshown text goes. */
export function missingStandingCriterion(text) {
  const section = criteriaSection(text);
  if (section === null) return say('it carries no `## Acceptance criteria` heading');
  return section.some((line) => ITEM.test(line))
    ? ''
    : say('its acceptance criteria carry no numbered item beginning `Fails closed:`');
}
