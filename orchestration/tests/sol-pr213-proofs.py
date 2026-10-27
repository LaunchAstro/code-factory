#!/usr/bin/env python3
"""Independent PR 213 proofs; expected to fail until the gate is repaired."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

RULES = Path(__file__).resolve().parents[1] / 'reviewer/sol_rules.py'
HEAD = '8f8d613d9e6703785401a928c58ba736ab66ad4f'


def comment(parts='', verdict='approve', findings='0 (none)'):
    return (parts + f'\nOpen findings: {findings}\nOpen disputes: 0 (none)\n'
            f'Reviewer: Sol (Codex)\nModel: gpt-6.1-sol\nHead SHA: {HEAD}\n'
            f'Verdict: {verdict}\nCode review: ' + ('no findings' if verdict == 'approve' else 'changes requested') + '\n')


class Proofs(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='sol-pr213-proof-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.ledger = self.root / 'ledger.json'

    def run_rules(self, step, *extra):
        return subprocess.run([sys.executable, '-I', str(RULES), step, '--pr', '213',
                               '--ledger', str(self.ledger), *map(str, extra)],
                              capture_output=True, text=True, timeout=20)

    def gate(self, body, *extra):
        path = self.root / 'comment.md'
        path.write_text(body)
        return self.run_rules('gate', '--head', HEAD, '--comment', path, *extra)

    def test_missing_snapshot(self):
        """Sol proof, criterion 1: a supplied missing dispute snapshot must block approval"""
        first = comment('Finding: S213-1\nCriterion: 1\nsrc/a.py:1 Defect.\nProof: tests/a.py test_a\n',
                        verdict='changes requested', findings='1 (S213-1)')
        result = self.gate(first)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        snapshot = self.root / 'disputes.md'
        snapshot.write_text('Dispute: S213-1\nEvidence: tests/a.py test_a\nAlready guarded.\n')
        result = self.run_rules('prompt', '--disputes', snapshot)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Builder dispute on S213-1', result.stdout)
        before = self.ledger.read_bytes()
        snapshot.unlink()  # Snapshot disappears between prompt and gate.
        result = self.gate(comment('Closed: S213-1 fixed by tests/a.py test_a\n'), '--disputes', snapshot)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertEqual(self.ledger.read_bytes(), before)

    def test_markdown_finding(self):
        """Sol proof, criterion 1: a Markdown list finding cannot pass with zero findings"""
        for prefix in ('+ ', '1. ', '1) '):
            with self.subTest(prefix=prefix):
                body = comment(prefix + 'Criterion: 1\nsrc/a.py:1 Still broken.\n'
                               "Proof: tests/a.py 'Sol proof, criterion 1: still broken'\n")
                result = self.gate(body)
                self.assertEqual(result.returncode, 3, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
