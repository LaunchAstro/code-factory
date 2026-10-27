#!/usr/bin/env python3
"""Risk-to-effort launch proofs, with a fake Codex and a disposable token fixture."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SHIM = Path(__file__).resolve().parents[1] / 'reviewer/codex-shim.sh'


class Launches(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='sol-effort-')
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.record = self.root / 'called.json'
        self.prompt = self.root / 'review prompt.txt'
        self.prompt.write_text('Only review this patch.\n')
        self.token = self.root / 'token-fixture'
        self.token.write_text('local-test-fixture')
        self.token.chmod(0o600)
        fake = self.root / 'codex'
        fake.write_text('#!' + sys.executable + '\n' + '''import json, os, pathlib, sys
pathlib.Path(os.environ['SOL_ARGS_RECORD']).write_text(json.dumps({
    'args': sys.argv[1:], 'stdin': sys.stdin.read()}))
''')
        fake.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(self.root) + os.pathsep + os.environ['PATH'],
                    'SOL_ARGS_RECORD': str(self.record),
                    # The Codex limiter (#352) off: these cases prove the launch
                    # itself and must never reach a real lock host.
                    'CODEX_SLOTS': 'off'}

    def launch(self, *arguments):
        return subprocess.run(['bash', '-c', 'source "$1"; REVIEWER_TOKEN_FILE="$2"; shift 2; run_sol_review "$@"',
                               'fixture', str(SHIM), str(self.token), *arguments],
                              env=self.env, capture_output=True, text=True, timeout=15)

    def test_all_ranks_pass_one_explicit_effort_and_the_prompt_on_stdin(self):
        for risk, effort in [('low', 'medium'), ('medium', 'medium'), ('high', 'high')]:
            with self.subTest(risk=risk):
                result = self.launch('3', risk, str(self.prompt))
                self.assertEqual(result.returncode, 0, result.stderr)
                record = json.loads(self.record.read_text())
                self.assertEqual(record['args'], ['exec', '--dangerously-bypass-approvals-and-sandbox',
                                                  '-m', 'gpt-6.1-sol', '-c', f'model_reasoning_effort={effort}', '-'])
                self.assertEqual(record['stdin'], self.prompt.read_text())
                self.assertNotIn('local-test-fixture', result.stdout + result.stderr)
                self.record.unlink()

    def test_unknown_risk_never_launches(self):
        for risk in ['', 'urgent', 'HIGH', 'medium; touch marker']:
            with self.subTest(risk=risk):
                result = self.launch('3', risk, str(self.prompt))
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertFalse(self.record.exists())

    def test_missing_or_extra_arguments_never_launch(self):
        for arguments in [(), ('3',), ('3', 'medium'), ('3', 'high', str(self.prompt), '-c', 'model_reasoning_effort=low')]:
            with self.subTest(arguments=arguments):
                result = self.launch(*arguments)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertFalse(self.record.exists())

    def test_missing_prompt_or_directory_never_launch(self):
        for path in [self.root / 'missing', self.root]:
            result = self.launch('3', 'medium', str(path))
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertFalse(self.record.exists())

    def test_invalid_deadline_never_launches(self):
        result = self.launch('invalid', 'medium', str(self.prompt))
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertFalse(self.record.exists())

    def test_selector_requires_one_known_rank(self):
        for arguments, expected, rc in [('low', 'medium\n', 0), ('medium', 'medium\n', 0),
                                        ('high', 'high\n', 0), ('', '', 2), ('low high', '', 2), ('urgent', '', 2)]:
            result = subprocess.run(['bash', '-c', 'source "$1"; shift; sol_review_effort "$@"',
                                     'fixture', str(SHIM), *arguments.split()],
                                    env=self.env, capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, rc, result.stderr)
            self.assertEqual(result.stdout, expected)
            self.assertFalse(self.record.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
