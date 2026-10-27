#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Independent CLI proof for PR 226; temporary ledgers, no network."""
from pathlib import Path
import subprocess
import sys
import tempfile

RULES = Path(__file__).resolve().parents[1] / 'reviewer/sol_rules.py'
HEAD = '969e53aa44a35fe47835b16c533d8c9761082164'
NAME = 'Sol proof, criterion 2: conflicting terminal outcomes for a carried finding fail closed'


def review(parts, verdict='approve', findings='0 (none)'):
    return (parts + f'\nOpen findings: {findings}\nOpen disputes: 0 (none)\n'
            f'Reviewer: Sol (Codex)\nModel: gpt-6.1-sol\nHead SHA: {HEAD}\n'
            f'Verdict: {verdict}\nCode review: '
            + ('no findings' if verdict == 'approve' else 'changes requested') + '\n')


def proof():
    with tempfile.TemporaryDirectory(prefix='sol-pr226-proof-') as temp:
        root = Path(temp)

        def gate(pr, body):
            comment = root / f'comment-{pr}.md'
            comment.write_text(body)
            return subprocess.run(
                [sys.executable, '-I', str(RULES), 'gate', '--pr', str(pr),
                 '--ledger', str(root / f'sol-ledger-{pr}.json'),
                 '--head', HEAD, '--comment', str(comment)],
                capture_output=True, text=True, timeout=20)

        raised = review(
            'Finding: S5-1\nCriterion: 1\nsrc/a.py:1 The boundary fails.\n'
            "Proof: tests/a.py 'Sol proof, criterion 1: boundary'\n",
            verdict='changes requested', findings='1 (S5-1)')
        initial = gate(5, raised)
        assert initial.returncode == 1, initial.stdout + initial.stderr
        source = (root / 'sol-ledger-5.json').read_bytes()
        result = gate(9, review(
            'Closed: S5-1 from PR #5; the boundary proof passes after the repair.\n'
            'Withdrawn: S5-1 from PR #5; the boundary finding was invalid.\n'))
        assert result.returncode == 3, (
            f'Ambiguous approval was accepted: exit={result.returncode}, '
            f'output={result.stdout.strip()}; '
            f'ledger={(root / "sol-ledger-9.json").read_text()}')
        assert not (root / 'sol-ledger-9.json').exists(), 'Refusal must write no ledger'
        assert (root / 'sol-ledger-5.json').read_bytes() == source


if __name__ == '__main__':
    if sys.argv[1:] and sys.argv[1:] != [NAME]:
        raise SystemExit('Unknown test name')
    try:
        proof()
        print('PASS ' + NAME)
    except AssertionError as error:
        print('FAIL ' + NAME + '\n' + str(error))
        raise SystemExit(1)
