#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""The rules-gate wrapper reads and posts only in the repository it is given; a stand-in gh, no network."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

GATE = Path(__file__).resolve().parents[1] / 'reviewer/sol-rl-gate.sh'
CF, OA = 'LaunchAstro/code-factory-private', 'LaunchAstro/ops-astro'
HEAD = 'a' * 40
LOGIN = 'sol-bot'

# Answers the four calls the wrapper makes. Comments live in $GH_DATA/<owner>__<name>__<pr>.md (lower case), posted by
# LOGIN; a comment's id is only valid under its own repository's path, and names match in any case, as on GitHub.
# Every call is logged.
STUB = r'''#!/usr/bin/env python3
import json, os, re, sys, zlib
from pathlib import Path
args = sys.argv[1:]
with open(os.environ['GH_LOG'], 'a') as log:
    log.write(json.dumps(args) + '\n')
data = Path(os.environ['GH_DATA'])
def cid(path):
    return str(zlib.crc32(path.name.encode()))
if args[:2] == ['api', 'user']:
    print('sol-bot'); sys.exit(0)
path = args[1].split('?')[0].lower()
m = re.fullmatch(r'repos/([^/]+)/([^/]+)/issues/(\d+)/comments', path)
if m:
    f = data / f'{m[1]}__{m[2]}__{m[3]}.md'
    head = re.search(r'Head SHA: ([0-9a-f]{40})', ' '.join(args[2:]))
    if f.exists() and head and f'Head SHA: {head[1]}' in f.read_text():
        print(cid(f))
    sys.exit(0)
m = re.fullmatch(r'repos/([^/]+)/([^/]+)/issues/comments/(\d+)', path)
if m:
    for f in data.glob(f'{m[1]}__{m[2]}__*.md'):
        if cid(f) == m[3]:
            sys.stdout.write(f.read_text()); sys.exit(0)
    print('{"message":"Not Found"}', file=sys.stderr); sys.exit(1)
if re.fullmatch(r'repos/[^/]+/[^/]+/statuses/[0-9a-f]{40}', path):
    sys.exit(0)
sys.exit(1)
'''


def comment(*parts, verdict='approve', findings='0 (none)'):
    review = 'no findings' if verdict == 'approve' else 'changes requested'
    return ('\n'.join(parts) + f'\nOpen findings: {findings}\nOpen disputes: 0 (none)\n'
            f'Reviewer: Sol (Codex)\nModel: gpt-6.1-sol\nHead SHA: {HEAD}\nVerdict: {verdict}\nCode review: {review}\n')


RAISED = comment('Finding: S5-1\nCriterion: 1\nsrc/a.ts:1 Broken.\nProof: tests/a.test.ts x\n',
                 verdict='changes requested', findings='1 (S5-1)')


class Wrapper(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='sol-rl-gate-cases-')
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        (self.root / 'polish').mkdir()
        self.data = self.root / 'data'
        self.data.mkdir()
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'gh').write_text(STUB)
        (bin_dir / 'gh').chmod(0o755)
        self.log = self.root / 'gh.log'
        self.env = dict(os.environ, PATH=f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', SOL_RL_ROOT=str(self.root),
                        GH_LOG=str(self.log), GH_DATA=str(self.data))

    def post(self, repo, pr, body):
        (self.data / f'{repo.lower().replace("/", "__")}__{pr}.md').write_text(body)

    def run_gate(self, pr, *repo):
        self.log.write_text('')
        return subprocess.run(['zsh', str(GATE), *repo, str(pr), HEAD], capture_output=True, text=True,
                              env=self.env, timeout=60)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def repos_touched(self):
        return {c[1].split('/')[1] + '/' + c[1].split('/')[2] for c in self.calls() if c[1].startswith('repos/')}

    def statuses(self):
        return [c[1] for c in self.calls() if '/statuses/' in c[1]]

    def test_a_code_factory_pr_reads_only_code_factory_comments(self):
        self.post(CF, 5, comment())
        result = self.run_gate(5, '--repo', CF)
        self.assertTrue(result.stdout.startswith('PASS'), result.stdout + result.stderr)
        self.assertEqual(self.repos_touched(), {CF})
        self.assertTrue((self.root / 'polish/launchastro/code-factory-private/sol-ledger-5.json').is_file())
        self.assertFalse((self.root / 'polish/sol-ledger-5.json').exists())

    def test_a_code_factory_refusal_posts_status_only_to_code_factory(self):
        self.post(OA, 5, comment())  # A valid comment on the other repository's PR 5 must not count.
        result = self.run_gate(5, '--repo', CF)
        self.assertTrue(result.stdout.startswith('FAIL-CLOSED'), result.stdout + result.stderr)
        self.assertEqual(self.repos_touched(), {CF})
        self.assertEqual(self.statuses(), [f'repos/{CF}/statuses/{HEAD}'])
        self.assertIn('SOL-RULES launchastro/code-factory-private#5', (self.root / 'events.log').read_text())

    def test_an_ops_astro_run_is_unchanged(self):
        self.post(OA, 5, comment())
        result = self.run_gate(5)
        self.assertTrue(result.stdout.startswith('PASS'), result.stdout + result.stderr)
        self.assertEqual(self.repos_touched(), {OA})
        self.assertTrue((self.root / 'polish/sol-ledger-5.json').is_file())
        self.assertIn('SOL-RULES 5 ', (self.root / 'events.log').read_text())

    def test_a_repository_named_in_other_case_keeps_its_one_ledger(self):
        self.post(OA, 5, RAISED)
        self.assertTrue(self.run_gate(5).stdout.startswith('HOLD'))
        self.post(OA, 5, comment())  # Drops S5-1, still open: only a fresh ledger would let this pass.
        result = self.run_gate(5, '--repo', 'launchastro/OPS-ASTRO')
        self.assertTrue(result.stdout.startswith('FAIL-CLOSED'), result.stdout)
        self.assertIn('S5-1 vanished', result.stdout)
        self.assertFalse((self.root / 'polish/launchastro').exists())

    def test_one_number_in_two_repositories_keeps_two_ledgers(self):
        self.post(OA, 5, RAISED)
        self.assertTrue(self.run_gate(5).stdout.startswith('HOLD'))
        ops = (self.root / 'polish/sol-ledger-5.json').read_text()
        self.post(CF, 5, comment())
        self.assertTrue(self.run_gate(5, '--repo', CF).stdout.startswith('PASS'))
        self.assertEqual((self.root / 'polish/sol-ledger-5.json').read_text(), ops)
        self.assertEqual(json.loads((self.root / 'polish/launchastro/code-factory-private/sol-ledger-5.json').read_text())['findings'], {})

    def test_an_earlier_pr_lookup_stays_in_its_repository(self):
        self.post(OA, 5, RAISED)
        self.assertTrue(self.run_gate(5).stdout.startswith('HOLD'))
        self.post(CF, 9, comment('Closed: S5-1 fixed.'))  # S5-1 is open only in ops-astro's ledger.
        result = self.run_gate(9, '--repo', CF)
        self.assertTrue(result.stdout.startswith('FAIL-CLOSED'), result.stdout)
        self.assertIn('no ledger for PR 5', result.stdout)

    def test_a_malformed_repository_is_refused_before_any_call(self):
        for repo in ('code-factory', 'LaunchAstro/', 'a/b/c', '../x/y', 'x/..', 'x/.git', 'LaunchAstro/code factory'):
            with self.subTest(repo=repo):
                result = self.run_gate(5, '--repo', repo)
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertEqual(self.calls(), [])


if __name__ == '__main__':
    unittest.main()
