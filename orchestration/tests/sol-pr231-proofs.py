#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Independent PR 231 integration checks; no agent, network or real gh writes."""
import importlib.util
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('wrapper_cases', HERE / 'sol-rl-gate-cases.py')
cases = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cases)
REVIEWER = HERE.parent / 'reviewer'


class Proofs(unittest.TestCase):
    maxDiff = None
    setUp = cases.Wrapper.setUp
    post = cases.Wrapper.post
    calls = cases.Wrapper.calls
    repos_touched = cases.Wrapper.repos_touched
    statuses = cases.Wrapper.statuses
    run_gate = cases.Wrapper.run_gate


def caller_integration(self):
    # Exercise only the existing caller's state selection and gate invocation,
    # with the proposed merged wrapper copied into a disposable round.
    # The versioned caller only: a round copy on one machine proves nothing elsewhere.
    source = (REVIEWER / 'sol-pr-cf.sh').read_text()
    # The repository the caller defaults to, and its lower-case name, decide the state folder and the gate's --repo.
    repo_line = next(line for line in source.splitlines() if line.startswith('REPO='))
    lower_line = next(line for line in source.splitlines() if line.startswith('L='))
    state_line = next(line for line in source.splitlines() if line.startswith('LD='))
    gate_line = next(line for line in source.splitlines() if line.startswith('g='))
    gate_line = gate_line.replace('\\$', '$').replace('\\"', '"')
    tools = self.root / 'tools-orch'
    tools.mkdir()
    for name in ('sol-rl-gate.sh', 'sol_rules.py'):
        shutil.copy2(REVIEWER / name, tools / name)
    self.post(cases.CF, 5, cases.comment())
    self.log.write_text('')
    # The background run reads the caller's values as SOL_* variables (#358), handed over as its launch line does.
    handover = 'SOL_R=$R SOL_REPO=$REPO SOL_PR=$N SOL_HEAD=$H SOL_DSNAP=$DSNAP'
    launch = next(i for i, line in enumerate(source.splitlines()) if 'nohup zsh -c' in line)
    launch = ' '.join(source.splitlines()[launch - 1:launch + 1]).split()
    for pair in handover.split():
        self.assertIn(pair, launch)
    script = ('R=$1; N=5; H=$2; u=""\n' + repo_line + '\n' + lower_line + '\n' + state_line + '\n' + handover + '\n'
              + gate_line + '\nprintf "%s\\n" "$LD" "$DS" "$g"\n')
    result = subprocess.run(['zsh', '-c', script, 'proof', str(self.root), cases.HEAD],
                            env=self.env, capture_output=True, text=True, timeout=60)
    self.assertEqual(result.returncode, 0, result.stderr)
    lines = result.stdout.splitlines()
    actual = {'ledger': lines[0], 'disputes': lines[1],
              'gate': lines[2].split()[0], 'repositories': sorted(self.repos_touched())}
    folder = self.root / 'polish/launchastro/code-factory-private'
    expected = {'ledger': str(folder / 'sol-ledger-5.json'),
                'disputes': str(folder / 'disputes-5.md'),
                'gate': 'PASS', 'repositories': [cases.CF]}
    self.assertEqual(actual, expected)


def independent_separation(self):
    # Opposite verdicts for the same PR number must retain distinct comments,
    # ledgers and earlier-id lookup domains.
    self.post(cases.OA, 5, cases.RAISED)
    self.assertTrue(self.run_gate(5).stdout.startswith('HOLD'))
    self.post(cases.CF, 5, cases.comment())
    self.assertTrue(self.run_gate(5, '--repo', cases.CF).stdout.startswith('PASS'))
    oa = self.root / 'polish'
    cf = oa / 'launchastro/code-factory-private'
    self.assertNotEqual((oa / 'sol-comment-5-aaaaaaa.md').read_text(),
                        (cf / 'sol-comment-5-aaaaaaa.md').read_text())
    self.assertIn('S5-1', json.loads((oa / 'sol-ledger-5.json').read_text())['findings'])
    self.assertEqual(json.loads((cf / 'sol-ledger-5.json').read_text())['findings'], {})
    self.post(cases.CF, 9, cases.comment('Closed: S5-1 fixed.'))
    self.assertIn('S5-1 is not open in the ledger for PR 5', self.run_gate(9, '--repo', cases.CF).stdout)


setattr(Proofs, 'Sol proof, criterion 1: Code Factory caller routes gate and review state to Code Factory', caller_integration)
setattr(Proofs, 'Sol proof, criterion 1: explicit repository isolates comments ledgers and earlier findings', independent_separation)

if __name__ == '__main__':
    loader = unittest.TestLoader()
    loader.testMethodPrefix = 'Sol proof'
    unittest.main(verbosity=2, testLoader=loader)
