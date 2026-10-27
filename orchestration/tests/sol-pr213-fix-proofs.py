#!/usr/bin/env python3
"""Independent fix-range regression proof; no network or product mutations."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

RULES = Path(__file__).resolve().parents[1] / 'reviewer/sol_rules.py'
HEAD = '3621b7e892a1320568bf3d97fcb3da32395a2506'

class Proofs(unittest.TestCase):
    def test_underscore_emphasis_cannot_hide_finding(self):
        """Sol proof, criterion 1: underscore emphasis cannot hide an open finding from the count gate"""
        with tempfile.TemporaryDirectory(prefix='sol-pr213-fix-proof-') as temp:
            root = Path(temp)
            ledger = root / 'ledger.json'
            comment = root / 'comment.md'
            comment.write_text(
                '__Criterion:__ 1\nsrc/a.py:1 Still broken.\n'
                "Proof: tests/a.py 'Sol proof, criterion 1: still broken'\n"
                'Open findings: 0 (none)\nOpen disputes: 0 (none)\n'
                'Reviewer: Sol (Codex)\nModel: gpt-6.1-sol\n'
                f'Head SHA: {HEAD}\nVerdict: approve\nCode review: no findings\n')
            result = subprocess.run(
                [sys.executable, '-I', str(RULES), 'gate', '--pr', '213',
                 '--ledger', str(ledger), '--head', HEAD, '--comment', str(comment)],
                capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
            self.assertIn('finding without an id', result.stdout)
            self.assertFalse(ledger.exists(), 'Refusal must not create the ledger')

if __name__ == '__main__':
    unittest.main(verbosity=2)
