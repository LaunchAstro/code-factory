// SPDX-License-Identifier: AGPL-3.0-only
// The cross-vendor review of record, read off the review rather than off the
// pull request body.
//
// The rehearsal of 17 September: Sol requested changes on ten of twelve pull
// requests and GitHub recorded every one of them as COMMENTED, because the
// reviewing account is the author's account. `CHANGES_REQUESTED` and
// `dismiss_stale_reviews_on_push` had nothing to bite on, the verdict existed
// only as text in the review body, and the builder's own typed line was what
// the evidence check believed. Three defective pull requests read CLEAN.
//
// A review of record is a review whose body carries the shape CONTRIBUTING.md
// asks for, once each: who reviewed, with which model, which revision, and
// what the verdict was. A refusal carries one thing more, the plan criterion
// it refuses on. Anything else is a comment.
//
// What this cannot do, and nothing reading these reviews can: a review body is
// editable by the account that posted it, and here that is the author's own
// account. Editing a refusal into an approval, or deleting its `Model:` line,
// takes the refusal out of what the API returns. Sol's review of 5204bb8 named
// it. Only a reviewer identity that is not the author's closes it, which is
// what adding the reviewer's account as a collaborator does. This rule raises
// the cost of a mistake, not the cost of a deliberate edit.

import { visibleText } from './markdown.mjs';

// The value runs to the end of its line, and the label appears once in the
// whole body. Sol's review of 5204bb8 found the first match winning, so
// `Verdict: approve` followed by `Verdict: changes requested` read as an
// approval; its review of f0adde7 found the same trick on one line, because
// the value was not anchored. A review that states a field twice states it
// once in nobody's reading.
// Up to three spaces of indent, which is all Markdown allows before a line
// becomes an indented code block. Sol's review of cf31893 found unlimited
// indent accepted, so a four-space example rendered as code supplied the
// verdict while the visible prose refused.
const INDENT = ' {0,3}';
const FIELDS = {
  reviewer: {
    label: 'Reviewer',
    value: new RegExp(`^${INDENT}Reviewer:[ \t]*(.+?)[ \t]*$`, 'imu'),
  },
  model: { label: 'Model', value: new RegExp(`^${INDENT}Model:[ \t]*(.+?)[ \t]*$`, 'imu') },
  headSha: {
    label: 'Head SHA',
    value: new RegExp(`^${INDENT}Head SHA:[ \t]*([0-9a-f]{7,40})[ \t]*$`, 'imu'),
  },
  verdict: { label: 'Verdict', value: new RegExp(`^${INDENT}Verdict:[ \t]*(.+?)[ \t]*$`, 'imu') },
};

const onlyLine = (field, body) => {
  // The label at the start of a line, not anywhere in the prose. Copilot's
  // review of b830375 found a finding that mentioned `Verdict:` discarding the
  // refusal it belonged to, which is a reviewer's own words being used against
  // its verdict.
  const label = new RegExp(`^${INDENT}${field.label.replace(' ', '\\s')}[ \t]*:`, 'gimu');
  if ([...body.matchAll(label)].length !== 1) return '';
  return field.value.exec(body)?.[1]?.trim() ?? '';
};

// A verdict is one of two words, matched whole. Sol's review of 1e90365 found
// substring matching authorising its own opposite: "not approved" and "do not
// accept" both contained an approving word and both passed. A verdict that
// has to be interpreted is not a verdict, so anything outside this list is
// unstated, and an unstated verdict does not authorise a merge.
const APPROVE = new Set(['approve', 'approved']);
const CHANGES = new Set([
  'changes requested',
  'change requested',
  'request changes',
  'requesting changes',
  'requested changes',
]);

// The owner's decision of 20 September 2026: a hold needs a criterion. The reviewer
// may refuse only by naming the plan criterion the code breaks; every other
// finding is a note and the pull request merges. Round 2 posted twelve
// refusals out of twelve, held both clean controls twice, and every
// second-round finding was against an input no criterion mentions, so the
// question the reviewer was answering had no last answer.
//
// Read off the visible body, like the other four fields, and anchored to the
// start of a line so a finding that quotes the word does not supply one.
const CRITERION = new RegExp(`^${INDENT}Criterion:[ \t]*[0-9]+`, 'mu');

// A refusal stated anywhere wins. The security reviews of 65dbe59, cf10160
// and e9a1195 found seven shapes (comments, list items, HTML blocks, a
// backtick in an info string) where the strippers below and GitHub's renderer
// disagree about which lines show, each letting a fenced approval stand over
// a visible refusal, or a refusal the strippers lost leave an earlier
// approval standing. Rather than model more of Markdown, a `Verdict:` that
// refuses on any line, in any container, makes the review a refusal. An
// approval that quotes one is refused too: that is the cost of reading
// strictly, and the message says how to post it.
//
// A refusal is then read off the body as written, strippers aside. Sol's
// review of 7790dc6 found a visible criterion the fence stripper lost, and a
// fenced `Reviewer:` example counted as a second label, each dropping a
// refusal under an earlier approval. A refusal can only make the gate
// stricter, so its labels may repeat, any `Criterion:` binds it, fenced or
// commented included, and it counts against every head it names.
//
// The security review of 1f75c37 found labels this scan did not know:
// `**Verdict**: x`, `| Verdict | x |`, `<b>Verdict</b>: x`, `Verdict: reject`.
// So bare tags read as spaces, markup may sit between the word and its colon
// or table pipe, and reject refuses here. Neither class in a row overlaps the
// next, so no body backtracks for long.
//
// The security review of fc77d00 found `changes requested (criterion 2)` or
// `not approved` read as no refusal, so a value that starts with a refusal
// refuses, whatever follows it. A quoted key, `"verdict": "changes
// requested"`, is a label too: the review of ca12530 found that letting a
// quote mark unmake one hid a refusal written as `"Verdict": changes
// requested`. An approval quoting a JSON fixture is refused, and told why.
//
// Sol's review of eba3667 found the first label on a line taking the rest of
// it, so `Verdict: approve; Verdict: changes requested` read as one value.
// Each label's value runs to the next label or the end of its line.
const LABEL = (word, before = '(?<![\\p{L}\\p{N}])') => `${before}${word}[^\\p{L}\\p{N}\\n:|]*[:|]`;
const ANY_VERDICT = new RegExp(LABEL('Verdict'), 'giu');
// A refusal names a head however the label is marked up, as with its verdict,
// between its two words included: Sol's review of 8e3681d found
// `**Head** **SHA**:` binding nothing.
const ANY_HEAD = new RegExp(
  `${LABEL('Head[^\\p{L}\\p{N}\\n:|]*SHA')}[^\\p{L}\\p{N}\\n]*([0-9a-f]{7,40})(?![\\p{L}\\p{N}])`,
  'giu',
);
const ANY_CRITERION = new RegExp(`${LABEL('Criterion')}[^\\p{L}\\p{N}\\n]*[0-9]`, 'iu');
// Not the `m` flag: `^` there opens a line at U+2028 as well, and a run of
// them backtracks for seconds. A bare `\r` does open one, as it ends a line.
const VERDICT_LINE = new RegExp(LABEL('Verdict', '(?:^|[\\r\\n])[^\\p{L}\\p{N}\\r\\n]*'), 'iu');
const REFUSING = new RegExp(
  `^(?:(?:${[...CHANGES].join('|')})(?!\\p{L})|(?:not approved|reject(?:ed)?)$)`,
  'iu',
);
const untagged = (text) => text.replaceAll(/<\/?[a-z][a-z0-9]*>/giu, ' ');
// Sol's review of 8e3681d found a table laid out across, `Verdict` in a header
// cell, dropping the refusal in the row below. So a table is read down its
// columns too: each cell under a Verdict, Head SHA or Criterion header is also
// a line of its own, `Verdict: <cell>`, for the three scans of a refusal.
// The security review of e50b855 found a label with words after it,
// `Verdict (final)` or `[Verdict](#v)`, read as no label in a header or on a
// line. A header holding the word anywhere names its column, and a line is
// read again with the text from its last label word to each colon or pipe
// cut, once per label, and with a link's target dropped, as its colon is not
// one: `Verdict (final): x` reads as `Verdict: x`. Splitting at those marks
// keeps the cost linear.
const cells = (line) =>
  line
    .replace(/^(?:[ \t>]|[-+*][ \t]|\d{1,9}[.)][ \t])*/u, '')
    .trim()
    .replaceAll(/^\||\|$/gu, '')
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim());
const HEADER = /(?:^| )(verdict|head sha|criterion)(?= |$)/giu;
const WORDS = ['verdict', 'head[^\\p{L}\\p{N}]*sha', 'criterion'].map(
  (word) => new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'giu'),
);
const labelled = (text) =>
  text.split(/\r\n?|\n/u).flatMap((line) => {
    const parts = line.replaceAll(/\]\([^()\]\n]*\)/gu, ']').split(/([:|])/u);
    return WORDS.flatMap((word) => {
      if (line.search(word) === -1) return [];
      const cut = parts.map((part, i) => {
        const last =
          i % 2 === 0 && i < parts.length - 1 ? [...part.matchAll(word)].at(-1) : undefined;
        return last ? part.slice(0, last.index + last[0].length) : part;
      });
      return cut.join('') === line ? [] : [cut.join('')];
    });
  });
const scanned = (text) => {
  const plain = untagged(text);
  const lines = plain.split(/\r\n?|\n/u);
  const raw = text.split(/\r\n?|\n/u);
  // The labels of each column. The security review of e50b855 found an
  // all-dash row inside a table, a row to GitHub, renaming the columns from
  // the row above, so the refusals below it went unread. A dash row only adds
  // the labels above it, as after a heading that broke the table: reading
  // more can only refuse more.
  let names = [];
  const down = lines.flatMap((line, i) => {
    if (line.includes('|') && cells(line).every((cell) => /^:?-+:?$/u.test(cell))) {
      for (const [n, cell] of cells(lines[i - 1] ?? '').entries()) {
        for (const [, label] of cell
          .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
          .trim()
          .matchAll(HEADER)) {
          (names[n] ??= new Set()).add(label.toLowerCase());
        }
      }
      return [];
    }
    // The security review of 4d949e4 found `<b></b>` or a no-break space on a
    // line clearing them, while GitHub keeps that line as a row. Only spaces
    // and tabs, as written, make a blank line, which ends a table.
    if (/^[ \t]*$/u.test(raw[i])) names = [];
    return cells(line).flatMap((cell, n) =>
      [...(names[n] ?? [])].map((label) => `${label}: ${cell}`),
    );
  });
  return [plain, ...labelled(plain), ...down].join('\n');
};
const refusesAnywhere = (plain) => {
  const labels = [...plain.matchAll(ANY_VERDICT)];
  return labels.some((label, i) =>
    REFUSING.test(
      plain
        .slice(label.index + label[0].length, labels[i + 1]?.index)
        .split('\n')[0]
        .replaceAll(/<[^>]*>/gu, ' ')
        .replaceAll(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
        .replaceAll(/\s+/gu, ' '),
    ),
  );
};

/** 'changes requested' | 'approve' | 'unstated' */
export function classifyVerdict(text) {
  const stated = String(text)
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/u, '')
    .replace(/\s+/gu, ' ');
  if (APPROVE.has(stated)) return 'approve';
  if (CHANGES.has(stated)) return 'changes requested';
  return 'unstated';
}

const sameSha = (a, b) => a !== '' && b !== '' && (a.startsWith(b) || b.startsWith(a));

// The head being merged is a full commit. Sol's review of 69afe53 found a
// one-character head matching every review by prefix.
export const FULL_SHA = /^[0-9a-f]{40}$/u;

// The states GitHub gives a submitted review. DISMISSED and PENDING are
// passed over below for their own reasons; anything else did not come from
// GitHub. Sol's review of 69afe53 found an unknown state counted, and its
// review of eba3667 found one skipped, which dropped a refusal beside an
// approval. So malformed evidence refuses the check, naming the review.
const STANDING = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED']);
const PASSED_OVER = new Set(['DISMISSED', 'PENDING']);
// GitHub's own timestamp form. Sol's review of 69afe53 found any nonempty
// string accepted, `not-a-date` included.
// Its review of 7790dc6 found `Date.parse` rolling 31 February into March, so
// the date must survive the round trip unchanged.
const SUBMITTED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/u;
const submittedAt = (value) =>
  typeof value === 'string' &&
  SUBMITTED_AT.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const malformed = (review, what, value) => ({
  problem: `review ${review?.id} carries ${what}, ${JSON.stringify(value)}, so it is not evidence.`,
});

/**
 * Reads the reviews as the API returns them and answers one question: is
 * there a review of record for this head, and what did it conclude?
 * Returns `{ review }` or `{ problem }`; never both, never neither.
 */
export function reviewOfRecord(raw, rawHead) {
  const head = String(rawHead ?? '').toLowerCase();
  if (!FULL_SHA.test(head)) {
    return { problem: `the head being merged, '${rawHead}', is not a full commit SHA.` };
  }
  let reviews;
  try {
    reviews = JSON.parse(raw);
  } catch {
    return { problem: 'the reviews of this pull request are not readable JSON.' };
  }
  if (!Array.isArray(reviews)) {
    return { problem: 'the reviews of this pull request are not a list.' };
  }
  // `gh api --paginate --slurp` writes one array per page. Sol's review of
  // 1e90365 found the fetch step producing something no parser could read once
  // a pull request passed one page of reviews, which is a control that breaks
  // exactly when there has been the most review.
  if (reviews.length > 0 && reviews.every((page) => Array.isArray(page))) {
    reviews = reviews.flat();
  }

  const ofRecord = [];
  const withoutCriterion = [];
  for (const review of reviews) {
    // A review counts once it has been submitted and while it stands.
    // Dismissing is how a verdict is taken back, and Copilot's review of
    // 5204bb8 found a dismissed approval still authorising the merge; Sol's
    // review of 7bb8ffb found a PENDING one, which nobody has posted, doing
    // the same.
    if (PASSED_OVER.has(review?.state)) continue;
    if (!STANDING.has(review?.state)) {
      return malformed(review, 'a state GitHub does not give a submitted review', review?.state);
    }
    if (!submittedAt(review?.submitted_at)) {
      return malformed(review, 'a submission time GitHub does not write', review?.submitted_at);
    }
    // A review whose visible text refuses and whose approving fields are hidden
    // in a comment reads one way to a person and another to a parser, so the
    // parser reads what is shown.
    const written = String(review?.body ?? '');
    const plain = scanned(written);
    const refuses = refusesAnywhere(plain);
    const body = refuses ? written : visibleText(written);
    // A refusal never drops out for the shape of its lines. The security
    // review of 1f75c37 found a bold label, a list item or `(frozen)` after
    // the SHA dropping one under an earlier approval. It holds the commit
    // GitHub recorded it on, which the body cannot change, and every head it
    // names; a missing reviewer or model only shows in a message.
    const read = (field, standIn) =>
      refuses ? field.value.exec(body)?.[1]?.trim() || standIn : onlyLine(field, body);
    const reviewer = read(FIELDS.reviewer, 'an unnamed reviewer');
    const model = read(FIELDS.model, 'unnamed');
    const verdict = read(FIELDS.verdict, 'changes requested');
    let heads = (
      refuses
        ? [String(review?.commit_id ?? ''), ...[...plain.matchAll(ANY_HEAD)].map(([, sha]) => sha)]
        : [onlyLine(FIELDS.headSha, body)]
    ).filter((sha) => sha !== '');
    // Nor does any review with a verdict label. The security review of fc77d00
    // found `not approved` or `changes required` beside a bold label or
    // `(frozen)` after the SHA still dropping out under an earlier approval.
    // Short of a clean approval, it holds its recorded commit as unreadable.
    // Only a label that opens a line or heads a table column counts, so prose
    // that mentions one does not. Sol's review of 87a9f77 found a table of
    // Head SHA, Verdict and Criterion columns dropped, as the columns were
    // not read here.
    const shown = scanned(body);
    const incomplete = reviewer === '' || model === '' || verdict === '' || heads.length === 0;
    if (incomplete) {
      if (!VERDICT_LINE.test(shown)) continue;
      heads = [String(review?.commit_id ?? '')].filter((sha) => sha !== '');
    }
    // A comment can only make a review stricter. The security reviews of
    // 65dbe59 and cf10160 found four shapes of `<!--` (in code, mid-paragraph,
    // opening a list item, `<!-->`) that made these hand-written strippers
    // read an approval GitHub does not show, and Markdown has more. So a body
    // holding `<!--` anywhere may still refuse, but it does not approve; an
    // approval has no need of a comment.
    const commented = written.includes('<!--');
    let decided = incomplete ? 'unstated' : classifyVerdict(verdict);
    let stated = incomplete
      ? `${verdict || '(none on a line of its own)'} (in a review without one plain line each for Reviewer, Model, Head SHA and Verdict)`
      : verdict;
    // A refusal elsewhere turns an approval into a refusal. A verdict this
    // check cannot read, `reject` included, stays unreadable, which holds with
    // or without a criterion.
    if (decided === 'approve' && refuses) {
      decided = 'changes requested';
      stated = `${verdict} (and changes requested elsewhere in the same review; a refusal in any reading wins: post an approval that quotes no refusal)`;
    } else if (decided === 'approve' && commented) {
      decided = 'unstated';
      stated = `${verdict} (in a review holding <!--, which cannot approve: post the approval without a comment)`;
    } else if (decided === 'approve' && [...shown.matchAll(ANY_VERDICT)].length > 1) {
      // Sol's review of 87a9f77: an approval states its verdict once, so an
      // earlier verdict or a per-finding Verdict column or line leaves it
      // unreadable, as CONTRIBUTING step 4 says.
      decided = 'unstated';
      stated = `${verdict} (in an approval carrying another Verdict label, on a line or heading a column: write a finding's state as prose)`;
    }
    // A refusal that names no criterion is not a review of record. It is kept
    // aside rather than dropped, so the check can say which review it was and
    // why it did not count.
    const criterion = refuses ? ANY_CRITERION.test(plain) : CRITERION.test(body);
    for (const headSha of heads.map((sha) => sha.toLowerCase())) {
      if (decided === 'changes requested' && !criterion) {
        withoutCriterion.push({ id: review?.id, reviewer, headSha, quotes: stated !== verdict });
        continue;
      }
      ofRecord.push({
        id: review?.id,
        reviewer: reviewer || 'an unnamed reviewer',
        headSha,
        verdict: decided,
        refuses,
        stated,
        commitId: String(review?.commit_id ?? '').toLowerCase(),
        at: String(review?.submitted_at ?? ''),
      });
    }
  }

  // A refusal without a criterion leaves this head with no review of record,
  // unless some other review covers it. Say which one, rather than reporting
  // the absence and leaving a reviewer to work out where their refusal went.
  const uncriterioned = withoutCriterion.filter((r) => sameSha(r.headSha, head));
  const covered = ofRecord.some((r) => sameSha(r.headSha, head));
  if (!covered && uncriterioned.length > 0) {
    const first = uncriterioned[0];
    return {
      problem: first.quotes
        ? `review ${first.id} by ${first.reviewer} says approve and requests changes elsewhere in the same review; a refusal in any reading wins: post an approval that quotes no refusal.`
        : `review ${first.id} by ${first.reviewer} requests changes and names no criterion, so it is not a review of record: a refusal cites the plan criterion the code breaks as \`Criterion: <n>\`, and every other finding is a note.`,
    };
  }

  if (ofRecord.length === 0) {
    return {
      problem:
        'no cross-vendor review of record exists on this pull request. A review\n' +
        '        of record carries `Reviewer:`, `Model:`, `Head SHA:` and `Verdict:` in\n' +
        '        its body,\n' +
        '        as CONTRIBUTING.md step 4 sets out. Comments and approvals without\n' +
        '        that shape are not evidence, and neither is a line in this body.',
    };
  }

  let here = ofRecord.filter((r) => sameSha(r.headSha, head));
  if (here.length === 0) {
    const latest = ofRecord.toSorted((a, b) => a.at.localeCompare(b.at)).at(-1);
    return {
      problem:
        `the review of record covers ${latest?.headSha}, and this pull request is at\n` +
        `        ${head}. A review of one revision is not a review of another: the head\n` +
        '        moved after it was written. Ask for a review of this head.',
    };
  }

  // GitHub records the head at the moment a review is posted. When that and
  // the body disagree, the reviewer read one revision and posted against
  // another, and neither one can be trusted as the revision reviewed, so the
  // review is set aside. Copilot's review of 5204bb8 found it refusing
  // outright instead, which left one mistyped review poisoning the pull
  // request for ever: posting a correct one could not clear it.
  // GitHub records `commit_id` on every submitted review. Copilot's review of
  // b830375 found an absent one treated as agreement, which left the body's
  // own editable claim as the only thing binding the review to a revision.
  // The recorded commit must be this head, whole: Sol's review of 69afe53
  // found a seven-character body SHA binding an approval of another commit
  // that shared those characters. A refusal is the exception: Sol's review of
  // eba3667 found one posted on another commit, naming this head, filtered
  // out here, so a refusal holds every head it names wherever it was posted.
  const sound = here.filter((r) => r.refuses || r.commitId === head);
  if (sound.length === 0) {
    const mismatched = here[0];
    return {
      problem:
        `review ${mismatched?.id} says it covers ${mismatched?.headSha} and GitHub recorded it\n` +
        `        against ${mismatched?.commitId === '' ? 'nothing at all' : mismatched?.commitId}.\n` +
        '        The head moved under the reviewer, or the review was never bound to one,\n' +
        '        and no other review of record covers this head. Review this head and post\n' +
        '        again.',
    };
  }
  here = sound;

  // The strictest verdict on a head wins, not the latest. Every review here
  // is posted from the same account, so "latest" would let an approval posted
  // after a refusal erase it, on the same revision, with nothing changed. The
  // way to clear a refusal is a new head, which is what the loop asks for.
  const refused = here.find((r) => r.verdict === 'changes requested');
  if (refused !== undefined) {
    return {
      problem:
        `review ${refused.id} by ${refused.reviewer} requests changes on this head:\n` +
        `          Verdict: ${refused.stated}\n` +
        '        Nothing typed in this body overrides it, and neither does a later\n' +
        '        review of the same head. Fix what it raised, push, and have the new\n' +
        '        head reviewed.',
    };
  }
  const unreadable = here.find((r) => r.verdict === 'unstated');
  if (unreadable !== undefined) {
    return {
      problem:
        `review ${unreadable.id} by ${unreadable.reviewer} states no verdict this check can\n` +
        `        read:\n` +
        `          Verdict: ${unreadable.stated}\n` +
        '        A verdict is "approve" or "changes requested", matched whole. Anything\n' +
        '        else is a reader guessing, which is what this check exists to stop.',
    };
  }
  const review = here.toSorted((a, b) => a.at.localeCompare(b.at)).at(-1);
  if (review === undefined) {
    return { problem: 'no review of record could be selected for this head.' };
  }
  return { review };
}
