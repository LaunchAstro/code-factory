// SPDX-License-Identifier: AGPL-3.0-only
// What a reader of Markdown sees: the text with fenced blocks and HTML
// comments taken out, by the fence rule every reader here shares.
//
// The review of record, the plan check, the acceptance check's ticket line,
// the standing criterion and the documentation and ADR readers all ask this
// question. The rules came from Sol's rounds on the review parser, so they
// lived in review-of-record.mjs and six checks imported a safety file for
// them; here they are one module that each of them imports.

/**
 * A fenced block is an example, not a statement. GitHub shows what is inside
 * one literally, so `<!--` in a fence opens no comment and `Verdict: approve`
 * in a fence states no verdict. Sol's review of f695941 found both readings
 * wrong at once: the comment stripper deleted a real refusal that followed a
 * fenced `<!--`, and the field parser took its verdict from a fenced example
 * while the visible text refused. Fences come out first, and what is left is
 * what was said.
 *
 * The reverse holds too: inside a comment a fence marker opens nothing. Sol's
 * review of 69afe53 found a fence opener hidden in a comment swallowing the
 * visible refusal after the comment closed. So comment lines are kept here,
 * untouched, for `withoutHtmlComments` to remove, and no fence opens in them.
 * Only a line that starts with `<!--` opens such a comment, as Markdown has
 * it: the security review of 65dbe59 found a `<!--` quoted in code, or in the
 * middle of a paragraph, treated as one, which hid the fence after it.
 */
export function withoutFencedBlocks(text) {
  const kept = [];
  let fence = '';
  let inComment = false;
  for (const line of String(text).split(/\r\n|\r|\n/u)) {
    if (inComment) {
      kept.push(line);
      inComment = !line.includes('-->');
      continue;
    }
    const inside = fence !== '';
    fence = fenceAfter(fence, line);
    if (inside || fence !== '') continue;
    kept.push(line);
    inComment = /^ {0,3}<!--/u.test(line) && !line.slice(line.indexOf('<!--') + 4).includes('-->');
  }
  return kept.join('\n');
}

/**
 * The fence open after `line`: '' for none, else its opening marker. The one
 * fence rule the plan, review and documentation readers share, as CommonMark
 * has it: a fence opens on three or more backticks or tildes indented at most
 * three spaces, where a backtick fence's info string holds no backtick, and
 * closes only on the same character, at least as long, with nothing after it
 * but spaces or tabs. Sol's review of b830375 found a shorter example closing
 * a longer block; its review of cf31893 found ````js closing one; its CF-11
 * review found `~~~` closing a backtick fence; its CF-11-FIX2 review found
 * this reader and the documentation reader disagreeing on ``` a`b, which
 * Markdown shows as text.
 */
export function fenceAfter(fence, line) {
  if (fence === '') return /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/u.exec(line)?.[1] ?? '';
  return new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \t]*$`, 'u').test(line) ? '' : fence;
}

/**
 * What a person sees. GitHub renders an HTML comment as nothing, and it treats
 * an unterminated `<!--` as a comment running to the end of the text. Sol's
 * review of 008c965 found the closing form stripped and the unterminated form
 * left in place, which hid a whole body behind four characters. One function,
 * used for the review body and the pull request body, so the two cannot drift.
 */
export function withoutHtmlComments(text) {
  return String(text).replaceAll(/<!--[\s\S]*?(?:-->|$)/gu, '');
}

/**
 * The text a person sees: fenced blocks out first, then HTML comments, so a
 * fence marker inside a comment opens nothing and `<!--` inside a fence hides
 * nothing. A missing text reads as empty.
 */
export function visibleText(text) {
  return withoutHtmlComments(withoutFencedBlocks(String(text ?? '')));
}
