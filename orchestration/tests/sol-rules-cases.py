#!/usr/bin/env python3
"""Stable finding ids, disputes and the fail-closed count gate, on synthetic comments."""
from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest
import unittest.mock

RULES = Path(__file__).resolve().parents[1] / 'reviewer/sol_rules.py'
HEAD1 = '1' * 40
HEAD2 = '2' * 40
CLOSING = 'Reviewer: Sol (Codex)\nModel: gpt-6.1-sol\nHead SHA: {head}\nVerdict: {verdict}\nCode review: {review}\n'


def finding(fid, criterion, where):
    return f"Finding: {fid}\nCriterion: {criterion}\n{where} The fixture breaks criterion {criterion}.\nProof: tests/proof.test.ts 'Sol proof, criterion {criterion}: fixture'\n"


def comment(*parts, head=HEAD1, verdict='changes requested', findings='0 (none)', disputes='0 (none)'):
    review = 'no findings' if verdict == 'approve' else 'changes requested'
    return ('\n'.join(parts) + f'\nOpen findings: {findings}\nOpen disputes: {disputes}\n\n'
            + CLOSING.format(head=head, verdict=verdict, review=review))


ROUND1 = comment(finding('S7-1', 2, 'src/send.ts:119'), finding('S7-2', 1, 'src/page.ts:26'),
                 findings='2 (S7-1, S7-2)')


class Gate(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='sol-rules-cases-')
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        self.ledger = self.root / 'ledger.json'
        self.disputes = self.root / 'disputes.md'

    def run_rules(self, *args):
        return subprocess.run([sys.executable, str(RULES), *args, '--pr', '7', '--ledger', str(self.ledger)],
                              capture_output=True, text=True, timeout=60)

    def gate(self, body, head=HEAD1, disputes=False):
        path = self.root / 'comment.md'
        path.write_text(body)
        extra = ['--disputes', str(self.disputes)] if disputes else []
        return self.run_rules('gate', '--head', head, '--comment', str(path), *extra)

    def state(self):
        return json.loads(self.ledger.read_text())

    def round1(self):
        result = self.gate(ROUND1)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        return result

    def assert_fail(self, result, reason):
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertTrue(result.stdout.startswith('FAIL'), result.stdout)
        self.assertIn(reason, result.stdout)

    def test_first_round_records_open_ids(self):
        self.assertTrue(self.round1().stdout.startswith('HOLD'))
        found = self.state()['findings']
        self.assertEqual({k: v['state'] for k, v in found.items()}, {'S7-1': 'open', 'S7-2': 'open'})
        self.assertEqual(found['S7-1']['where'], 'src/send.ts:119')

    def test_ids_carry_into_the_next_round_and_close(self):
        self.round1()
        before = self.state()['findings']
        body = comment('Closed: S7-1 proof fails on the old head, passes here.',
                       'Closed: S7-2 proof fails on the old head, passes here.',
                       head=HEAD2, verdict='approve')
        result = self.gate(body, head=HEAD2)
        self.assertEqual(result.returncode, 0, result.stdout)
        after = self.state()['findings']
        self.assertEqual(set(after), set(before))
        self.assertEqual({v['state'] for v in after.values()}, {'closed'})
        self.assertEqual([r['head'] for r in self.state()['rounds']], [HEAD1, HEAD2])

    def test_still_open_finding_keeps_its_id(self):
        self.round1()
        body = comment('Closed: S7-1 fixed.', finding('S7-2', 1, 'src/page.ts:30'),
                       head=HEAD2, findings='1 (S7-2)')
        self.assertEqual(self.gate(body, head=HEAD2).returncode, 1)
        self.assertEqual(self.state()['findings']['S7-2']['state'], 'open')

    def test_doctored_count_fails_closed_and_keeps_the_ledger(self):
        self.round1()
        saved = self.ledger.read_text()
        body = comment('Closed: S7-1 fixed.', finding('S7-2', 1, 'src/page.ts:30'),
                       head=HEAD2, findings='0 (none)')
        self.assert_fail(self.gate(body, head=HEAD2), 'stated open findings 0')
        self.assertEqual(self.ledger.read_text(), saved)

    def test_listed_ids_must_match_the_blocks(self):
        body = comment(finding('S7-1', 2, 'src/send.ts:119'), findings='1 (S7-9)')
        self.assert_fail(self.gate(body), 'listed open findings')

    def test_vanished_id_fails_closed(self):
        self.round1()
        body = comment('Closed: S7-1 fixed.', head=HEAD2, verdict='approve')
        self.assert_fail(self.gate(body, head=HEAD2), 'S7-2 vanished')

    def test_approve_with_an_open_finding_fails(self):
        body = comment(finding('S7-1', 2, 'src/send.ts:119'), verdict='approve', findings='1 (S7-1)')
        self.assert_fail(self.gate(body), 'approve with 1 open finding')

    def test_finding_without_an_id_fails(self):
        body = comment("Criterion: 2\nsrc/send.ts:119 Broken.\nProof: tests/p.test.ts 'Sol proof, criterion 2: x'\n")
        self.assert_fail(self.gate(body), 'finding without an id')

    def test_disguised_finding_without_an_id_fails(self):
        for prefix in ('  ', '> ', '- ', '**', '`', '\t'):
            body = comment(f"{prefix}Criterion: 2\nsrc/send.ts:119 Broken.\nProof: tests/p.test.ts 'x'\n", verdict='approve')
            self.assert_fail(self.gate(body), 'finding without an id')

    def test_any_criterion_outside_a_block_fails(self):
        for line in ('CRITERION: 2', 'Criterion : 2', '3.  **Criterion:** 2', '| Criterion: 2 |', 'Criterion\u00a0: 2',
                     '__Criterion:__ 2', '_Criterion_: 2', '__Criterion__: 2', '*_Criterion_*: 2'):
            body = comment(f"{line}\nsrc/send.ts:119 Broken.\n", verdict='approve')
            self.assert_fail(self.gate(body), 'finding without an id')
        prose = comment('Earlier finding, criterion 2: closed by its proof.', verdict='approve')
        self.assertEqual(self.gate(prose).returncode, 0)

    def test_missing_snapshot_is_refused_by_the_prompt(self):
        self.round1()
        result = self.run_rules('prompt', '--disputes', str(self.root / 'gone.md'))
        self.assertEqual(result.returncode, 2, result.stdout)

    def test_concurrent_gates_lose_no_round(self):
        procs = []
        for n in range(4):
            path = self.root / f'c{n}.md'
            path.write_text(comment(head=str(n) * 40, verdict='approve'))
            procs.append(subprocess.Popen([sys.executable, str(RULES), 'gate', '--head', str(n) * 40,
                                           '--comment', str(path), '--pr', '7', '--ledger', str(self.ledger)],
                                          stdout=subprocess.DEVNULL))
        self.assertEqual([p.wait(timeout=60) for p in procs], [0] * 4)
        self.assertEqual(sorted(r['round'] for r in self.state()['rounds']), [1, 2, 3, 4])

    def test_a_stuck_gate_fails_the_concurrency_case_within_its_bound(self):
        waits = []

        class Stuck(subprocess.Popen):
            def __init__(self, args, **kwargs):
                self.args, self.stdin, self.stdout, self.stderr = args, None, None, None
                self.returncode, self._child_created = None, False

            def wait(self, timeout=None):
                waits.append(timeout)
                if timeout is None:
                    raise AssertionError('an unbounded wait on a gate that never exits')
                raise subprocess.TimeoutExpired(self.args, timeout)

        with unittest.mock.patch.object(subprocess, 'Popen', Stuck):
            with self.assertRaises(subprocess.TimeoutExpired):
                self.test_concurrent_gates_lose_no_round()
        self.assertEqual(waits, [60])

    def test_new_ids_follow_the_ledger(self):
        self.round1()
        body = comment('Closed: S7-1 fixed.', 'Closed: S7-2 fixed.', finding('S7-1', 3, 'src/x.ts:1'),
                       head=HEAD2, findings='1 (S7-1)')
        self.assert_fail(self.gate(body, head=HEAD2), 'S7-1')
        body = comment('Closed: S7-1 fixed.', 'Closed: S7-2 fixed.', finding('S7-5', 3, 'src/x.ts:1'),
                       head=HEAD2, findings='1 (S7-5)')
        self.assert_fail(self.gate(body, head=HEAD2), 'expected S7-3')

    def test_other_pr_prefix_fails(self):
        body = comment(finding('S8-1', 2, 'src/send.ts:119'), findings='1 (S8-1)')
        self.assert_fail(self.gate(body), 'S8-1')

    def test_wrong_head_fails(self):
        self.assert_fail(self.gate(ROUND1, head=HEAD2), 'head')

    def test_missing_count_line_fails(self):
        body = ROUND1.replace('Open disputes: 0 (none)\n', '')
        self.assert_fail(self.gate(body), 'Open disputes')

    def write_dispute(self, fid='S7-2', evidence='src/page.ts:26 already refuses /board; see tests/page.test.ts'):
        self.disputes.write_text(f'Dispute: {fid}\nEvidence: {evidence}\nThe page is never unsupported here.\n')

    def test_dispute_upheld_withdraws_the_finding(self):
        self.round1()
        self.write_dispute()
        body = comment('Closed: S7-1 fixed.', 'Dispute: S7-2 upheld the evidence holds.',
                       'Withdrawn: S7-2 dispute upheld.', head=HEAD2, verdict='approve')
        self.assertEqual(self.gate(body, head=HEAD2, disputes=True).returncode, 0)
        self.assertEqual(self.state()['findings']['S7-2']['state'], 'withdrawn')
        self.assertEqual(self.state()['disputes']['S7-2']['state'], 'upheld')

    def test_dispute_without_a_ruling_fails_closed(self):
        self.round1()
        self.write_dispute()
        body = comment('Closed: S7-1 fixed.', finding('S7-2', 1, 'src/page.ts:26'),
                       head=HEAD2, findings='1 (S7-2)')
        self.assert_fail(self.gate(body, head=HEAD2, disputes=True), 'stated open disputes 0')

    def test_open_dispute_counts_and_carries(self):
        self.round1()
        self.write_dispute()
        body = comment('Closed: S7-1 fixed.', finding('S7-2', 1, 'src/page.ts:26'),
                       'Dispute: S7-2 open a run of the page suite would decide it.',
                       head=HEAD2, findings='1 (S7-2)', disputes='1 (S7-2)')
        self.assertEqual(self.gate(body, head=HEAD2, disputes=True).returncode, 1)
        self.disputes.unlink()
        prompt = self.run_rules('prompt')
        self.assertEqual(prompt.returncode, 0, prompt.stderr)
        self.assertIn('Dispute: S7-2', prompt.stdout)

    def test_upheld_dispute_must_withdraw(self):
        self.round1()
        self.write_dispute()
        body = comment('Closed: S7-1 fixed.', finding('S7-2', 1, 'src/page.ts:26'), 'Dispute: S7-2 upheld fine.',
                       head=HEAD2, findings='1 (S7-2)')
        self.assert_fail(self.gate(body, head=HEAD2, disputes=True), 'upheld')

    def test_prompt_names_open_ids_and_the_next_id(self):
        self.round1()
        prompt = self.run_rules('prompt')
        self.assertEqual(prompt.returncode, 0, prompt.stderr)
        self.assertIn('S7-1 (criterion 2, src/send.ts:119)', prompt.stdout)
        self.assertIn('S7-3', prompt.stdout)
        self.assertIn('Open findings: <n>', prompt.stdout)

    def test_first_prompt_starts_at_one(self):
        prompt = self.run_rules('prompt')
        self.assertEqual(prompt.returncode, 0, prompt.stderr)
        self.assertIn('S7-1', prompt.stdout)
        self.assertIn('none yet', prompt.stdout)

    def test_bad_dispute_files_are_refused(self):
        self.round1()
        for fid, evidence in (('S7-9', 'src/a.ts:1'), ('S7-2', '')):
            self.write_dispute(fid, evidence)
            result = self.run_rules('prompt', '--disputes', str(self.disputes))
            self.assertEqual(result.returncode, 2, result.stdout)

    def test_dispute_made_in_a_reply_comment_is_ruled_on_an_approval(self):
        # ops-astro #1897 at a850194: the lane disputed in a PR reply, not the disputes file.
        self.round1()
        body = comment('Dispute: S7-1 upheld the PR body names that limit.', 'Withdrawn: S7-1 deferred to #1827.',
                       'Closed: S7-2 proof fails before the fix and passes here.', head=HEAD2, verdict='approve')
        result = self.gate(body, head=HEAD2)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(self.state()['findings']['S7-1']['state'], 'withdrawn')
        self.assertEqual(self.state()['disputes']['S7-1']['state'], 'upheld')

    def test_disputes_made_in_reply_comments_are_ruled_on_a_hold(self):
        # ops-astro #1900 at fafafb0: two reply disputes upheld, approval still held on coverage.
        self.gate(comment(*(finding(f'S7-{n}', n, f'src/f{n}.ts:1') for n in (1, 2, 3, 4)),
                          findings='4 (S7-1, S7-2, S7-3, S7-4)'))
        body = comment('Closed: S7-1 fixed.', 'Closed: S7-2 fixed.',
                       'Dispute: S7-3 upheld red by construction.', 'Withdrawn: S7-3 the test defect is repaired.',
                       'Dispute: S7-4 upheld red by construction.', 'Withdrawn: S7-4 the limit suite passes.',
                       head=HEAD2)
        result = self.gate(body, head=HEAD2)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual({f: d['state'] for f, d in self.state()['disputes'].items()},
                         {'S7-3': 'upheld', 'S7-4': 'upheld'})

    def test_reply_dispute_left_open_counts_and_carries(self):
        self.round1()
        body = comment('Closed: S7-1 fixed.', finding('S7-2', 1, 'src/page.ts:26'),
                       'Dispute: S7-2 open a run of the page suite would decide it.',
                       head=HEAD2, findings='1 (S7-2)', disputes='1 (S7-2)')
        self.assertEqual(self.gate(body, head=HEAD2).returncode, 1)
        prompt = self.run_rules('prompt')
        self.assertEqual(prompt.returncode, 0, prompt.stderr)
        self.assertIn('Builder dispute on S7-2', prompt.stdout)
        uncounted = comment(finding('S7-2', 1, 'src/page.ts:26'), 'Dispute: S7-2 open still undecided.',
                            head=HEAD1, findings='1 (S7-2)')
        self.assert_fail(self.gate(uncounted), 'stated open disputes 0')

    def test_ruling_on_an_id_that_is_not_an_open_earlier_finding_fails_closed(self):
        self.round1()
        cases = (
            ('Closed: S7-1 fixed.', 'Closed: S7-2 fixed.', finding('S7-3', 1, 'src/x.ts:1'),
             'Dispute: S7-3 rejected new this round.', {'findings': '1 (S7-3)'}, 'S7-3'),
            ('Closed: S7-1 fixed.', 'Closed: S7-2 fixed.', '', 'Dispute: S7-9 upheld never raised.', {}, 'S7-9'),
            ('Closed: S7-1 fixed.', 'Closed: S7-2 fixed.', '', 'Dispute: S8-1 upheld another PR.', {}, 'S8-1'),
        )
        for *parts, counts, fid in cases:
            with self.subTest(fid=fid):
                result = self.gate(comment(*parts, head=HEAD2, **counts), head=HEAD2)
                self.assert_fail(result, f'dispute ruling on {fid}, which was not disputed')
        self.gate(comment('Closed: S7-1 fixed.', finding('S7-2', 1, 'src/page.ts:26'),
                          head=HEAD2, findings='1 (S7-2)'), head=HEAD2)
        again = comment('Dispute: S7-1 upheld closed already.', 'Closed: S7-2 fixed.', head='3' * 40)
        self.assert_fail(self.gate(again, head='3' * 40), 'dispute ruling on S7-1, which was not disputed')

    def test_closed_and_withdrawn_for_one_id_fails_closed(self):
        self.round1()
        saved = self.ledger.read_text()
        body = comment('Closed: S7-1 fixed.', 'Withdrawn: S7-1 invalid.', 'Closed: S7-2 fixed.',
                       head=HEAD2, verdict='approve')
        self.assert_fail(self.gate(body, head=HEAD2), 'S7-1 is both closed and withdrawn')
        self.assertEqual(self.ledger.read_text(), saved)

    def test_comment_with_no_head_line_still_fails_closed(self):
        # ops-astro #1865 at d3c33a2: no head, verdict or count lines; that refusal was right.
        result = self.gate('Reviewed the diff. No findings.\n')
        self.assert_fail(result, 'Head SHA line is not the reviewed head')
        self.assertIn('no single Verdict line', result.stdout)
        self.assertFalse(self.ledger.exists())


class EarlierPr(unittest.TestCase):
    """Ids raised on an earlier PR and closed on this one (ops-astro #1902 closing #1573's)."""

    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='sol-rules-earlier-')
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)

    def ledger(self, pr):
        return self.root / f'sol-ledger-{pr}.json'

    def gate(self, pr, body, head=HEAD1):
        path = self.root / f'comment-{pr}.md'
        path.write_text(body)
        return subprocess.run([sys.executable, str(RULES), 'gate', '--pr', str(pr), '--ledger', str(self.ledger(pr)),
                               '--head', head, '--comment', str(path)], capture_output=True, text=True, timeout=60)

    def raise_on_5(self):
        result = self.gate(5, comment(finding('S5-1', 2, 'src/take.ts:113'), finding('S5-2', 2, 'src/take.ts:215'),
                                      findings='2 (S5-1, S5-2)'))
        self.assertEqual(result.returncode, 1, result.stdout)

    def assert_fail(self, result, reason):
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertIn(reason, result.stdout)
        self.assertFalse(self.ledger(9).exists(), 'a refusal writes no ledger')

    def test_earlier_pr_ids_closed_here_are_accepted(self):
        self.raise_on_5()
        source = self.ledger(5).read_text()
        body = comment('Closed: S5-1 already fixed on main by #1591; the replay proof fails on base, passes here.',
                       'Closed: S5-2 the expiry proof fails on base and passes here.', verdict='approve')
        result = self.gate(9, body)
        self.assertEqual(result.returncode, 0, result.stdout)
        carried = json.loads(self.ledger(9).read_text())['carried']
        self.assertEqual({f: (c['state'], c['from'], c['where']) for f, c in carried.items()},
                         {'S5-1': ('closed', 'sol-ledger-5.json', 'src/take.ts:113'),
                          'S5-2': ('closed', 'sol-ledger-5.json', 'src/take.ts:215')})
        self.assertEqual(self.ledger(5).read_text(), source, 'the earlier PR ledger is never written')

    def test_earlier_pr_id_fails_closed_unless_open_in_its_own_ledger(self):
        self.assert_fail(self.gate(9, comment('Closed: S5-1 fixed.', verdict='approve')), 'no ledger for PR 5')
        self.raise_on_5()
        self.assert_fail(self.gate(9, comment('Closed: S5-7 fixed.', verdict='approve')), 'S5-7 is not open')
        self.ledger(6).write_text(self.ledger(5).read_text())
        self.assert_fail(self.gate(9, comment('Withdrawn: S6-1 fixed.', verdict='approve')), 'not 6')
        self.ledger(4).write_text('{not json')
        self.assert_fail(self.gate(9, comment('Closed: S4-1 fixed.', verdict='approve')), 'PR 4')

    def test_earlier_pr_id_cannot_be_raised_or_disputed_here(self):
        self.raise_on_5()
        raised = comment(finding('S5-1', 2, 'src/take.ts:113'), findings='1 (S5-1)')
        self.assert_fail(self.gate(9, raised), 'S5-1 is not an id of PR 9')
        ruled = comment('Dispute: S5-1 upheld fine.', 'Withdrawn: S5-1 upheld.', verdict='approve')
        self.assert_fail(self.gate(9, ruled), 'dispute ruling on S5-1, which was not disputed')

    def test_earlier_pr_id_ends_once_here(self):
        self.raise_on_5()
        self.assertEqual(self.gate(9, comment('Closed: S5-1 fixed.')).returncode, 1)
        saved = self.ledger(9).read_text()
        result = self.gate(9, comment('Withdrawn: S5-1 again.', head=HEAD2, verdict='approve'), head=HEAD2)
        self.assertEqual(result.returncode, 3, result.stdout)
        self.assertIn('S5-1 was already closed on PR 9', result.stdout)
        self.assertEqual(self.ledger(9).read_text(), saved)


if __name__ == '__main__':
    unittest.main()
