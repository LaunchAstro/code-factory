#!/usr/bin/env python3
"""Uncommitted review proofs for PR #183; uses fakes, never a real agent."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
HANDOFF = ROOT / 'orchestration/single/handoff.sh'
SUITE = ROOT / 'orchestration/tests/single-handoff-cases.sh'
# A hang cap only: no case waits for it to fire, so a passing run takes no
# longer. The mutant suite runs in about 3 s on a quiet M5 and took 29-32 s
# at load 50 against the old 15 s cap (#326).
DEADLINE = 300

class SolProofs(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sol-pr183-')
        self.addCleanup(self.temp.cleanup)
        self.p = Path(self.temp.name)
        self.env = os.environ.copy()
        for key in ('HERDR_PANE_ID', 'CTX_SH', 'HERDR_DISPATCH'):
            self.env.pop(key, None)
        self.env.update(HOME=str(self.p / 'home'), TMPDIR=str(self.p / 'tmp'), HERDR_ENV='1')
        (self.p / 'home/bin').mkdir(parents=True)
        (self.p / 'tmp').mkdir()
        self.executable(self.p / 'home/bin/claude-alpha', '#!/bin/sh\nexit 99\n')
        self.a = self.p / 'a.md'
        self.b = self.p / 'b.md'
        self.a.write_text('Client A private task\nHANDOFF-END\n')
        self.b.write_text('Client B different task\nHANDOFF-END\n')
        self.out = self.p / 'captured.json'

    def executable(self, path, body):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)
        path.chmod(0o755)
        return str(path)

    def dispatch(self, note, *args):
        return [str(HANDOFF), 'dispatch', str(note), '--cwd', str(self.p), '--label', 'Next', *args]

    def run_cmd(self, args, **kw):
        return subprocess.run(args, env=self.env, text=True, capture_output=True, timeout=DEADLINE, **kw)

    def same_label_isolation(self):
        ready = self.p / 'ready'
        release = self.p / 'release'
        dispatcher = self.executable(self.p / 'dispatcher', '''#!/usr/bin/env python3
import json, os, pathlib, sys, time
root = pathlib.Path(os.environ['SOL_SCRATCH'])
(root / 'ready').touch()
limit = time.monotonic() + 8
while not (root / 'release').exists():
    if time.monotonic() > limit: sys.exit(91)
    time.sleep(0.01)
(root / 'captured.json').write_text(pathlib.Path(sys.argv[1]).read_text())
''')
        self.env.update(HERDR_DISPATCH=dispatcher, SOL_SCRATCH=str(self.p))
        first = subprocess.Popen(self.dispatch(self.a, '--seat', 'alpha'), env=self.env,
                                 text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while not ready.exists() and first.poll() is None and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(ready.exists(), 'first fake dispatcher did not reach the barrier')
            second = self.run_cmd(self.dispatch(self.b, '--seat', 'alpha', '--dry-run'))
            self.assertEqual(second.returncode, 0, second.stderr)
            release.touch()
            stdout, stderr = first.communicate(timeout=5)
            self.assertEqual(first.returncode, 0, stderr)
            got = json.loads(self.out.read_text())
            self.assertEqual(got['prompt'], self.a.read_text(),
                             'first hand-off received the second (dry-run) client brief')
        finally:
            if first.poll() is None:
                first.terminate()
                first.communicate(timeout=5)

    def fetched_reader_is_usable(self):
        isolated = self.p / 'checkout'
        script = isolated / 'orchestration/single/handoff.sh'
        script.parent.mkdir(parents=True)
        shutil.copy2(HANDOFF, script)
        installed = isolated / 'orchestration/skills/orchestrator'
        # Execute the dependency's actual fetchDir/decoded functions with an
        # in-memory API fixture; no real fetch, skill file, or pane is read.
        node = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.argv[1], 'utf8');
const code = source.slice(source.indexOf('function fetchDir('), source.indexOf('function sha256('));
const bytes = Buffer.from('#!/bin/sh\necho "CTX 45 GO"\n');
const scope = {mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync, Buffer, join: require('node:path').join,
 treeSha: () => 'f'.repeat(40), treeModes: () => new Map([['ctx.sh', '100644']]),
 contents: (_repo, path, _commit) => path === 'fixture'
   ? [{type: 'file', name: 'ctx.sh', path: 'fixture/ctx.sh'}]
   : {content: bytes.toString('base64'), encoding: 'base64', size: bytes.length}};
vm.runInNewContext(code + '\nfetchDir("fixture/repo", "fixture", "fixture-head", ' +
 JSON.stringify(process.argv[2]) + ')', scope);
"""
        fetched = self.run_cmd(['node', '-e', node, str(ROOT / 'orchestration/skills/fetch.mjs'), str(installed)])
        self.assertEqual(fetched.returncode, 0, fetched.stderr)
        reader = installed / 'ctx.sh'
        self.assertTrue(reader.is_file())
        self.assertFalse(reader.stat().st_mode & 0o111, 'fixture must match fetch.mjs file mode')
        self.env['HERDR_PANE_ID'] = 'fixture:pane'
        result = self.run_cmd([str(script), 'ctx'])
        self.assertEqual((result.returncode, result.stdout.strip()), (10, 'CTX 45 WRAP'),
                         'the advertised fetched-reader fallback is rejected as NO-READER')

    def named_seat_is_required(self):
        dispatcher = self.executable(self.p / 'dispatcher', '#!/bin/sh\ncp "$1" "$SOL_CAPTURE"\n')
        self.env.update(HERDR_DISPATCH=dispatcher, SOL_CAPTURE=str(self.out))
        result = self.run_cmd(self.dispatch(self.a))
        agent = json.loads(self.out.read_text())['agent'] if self.out.exists() else 'none'
        self.assertTrue(result.returncode != 0 and not self.out.exists(),
                        f'no named seat supplied, but dispatcher invoked with {agent!r}; exit={result.returncode}')

    def remote_host_is_part_of_repository_identity(self):
        clone = self.p / 'clone'
        def git(*args):
            result = self.run_cmd(['git', *args])
            self.assertEqual(result.returncode, 0, result.stderr)
            return result.stdout.strip()
        git('init', '-q', str(clone))
        git('-C', str(clone), '-c', 'user.name=Sol', '-c', 'user.email=sol@example.invalid',
            'commit', '-q', '--allow-empty', '-m', 'fixture')
        git('-C', str(clone), 'checkout', '-q', '-b', 'lane/seven')
        git('-C', str(clone), 'remote', 'add', 'origin', 'https://gitlab.com/acme/widgets.git')
        head = git('-C', str(clone), 'rev-parse', 'HEAD')
        payload = json.dumps(dict(number=7, state='OPEN', headRefName='lane/seven',
                                  headRefOid=head, labels=[], comments=[]))
        self.executable(self.p / 'bin/gh', '#!/bin/sh\n[ "$1" = api ] && { echo none; exit 0; }\ncat <<\'JSON\'\n' + payload + '\nJSON\n')
        self.env['PATH'] = str(self.p / 'bin') + ':' + self.env['PATH']
        note = self.p / 'note.md'
        result = self.run_cmd([str(HANDOFF), 'note', 'acme/widgets', '--clone', str(clone),
                               '--out', str(note), '7'])
        self.assertEqual(result.returncode, 0, result.stderr)
        line = next(l for l in note.read_text().splitlines() if l.startswith('- #7 '))
        self.assertIn('worktree=<fill:', line,
                      'a GitLab clone is presented as the GitHub PR worktree without a warning')

    def mutant_suite(self, mutate, spy=False):
        mutant = self.p / 'mutant'
        script = mutant / 'orchestration/single/handoff.sh'
        script.parent.mkdir(parents=True)
        script.write_text(mutate(HANDOFF.read_text()))
        script.chmod(0o755)
        suite = mutant / 'orchestration/tests/single-handoff-cases.sh'
        suite.parent.mkdir(parents=True)
        shutil.copy2(SUITE, suite)
        if spy:
            dispatcher = self.executable(self.p / 'dispatcher', '#!/bin/sh\nprintf "called\\n" >> "$SOL_SPY"\n')
            self.env.update(HERDR_DISPATCH=dispatcher, SOL_SPY=str(self.p / 'spy'))
        result = self.run_cmd(['bash', str(suite)])
        if spy and result.returncode == 0:
            self.assertTrue((self.p / 'spy').exists(), 'mutation did not invoke the dispatcher')
        self.assertNotEqual(result.returncode, 0,
                            'the supplied suite passed despite the injected criterion violation')

    def suite_rejects_single_read(self):
        self.mutant_suite(lambda source: source.replace('for try in 1 2; do', 'for try in 1; do'))

    def suite_rejects_dry_run_launch(self):
        self.mutant_suite(lambda source: source.replace('  if [ $dry = 1 ]; then\n',
            '  if [ $dry = 1 ]; then\n    "$dispatcher" "$spec" >/dev/null 2>&1\n'), spy=True)

for method, name in [
    ('same_label_isolation', 'Sol proof, criterion 3: a dry run cannot replace an in-flight hand-off brief'),
    ('fetched_reader_is_usable', 'Sol proof, criterion 1: the fetch-installed reader can be used'),
    ('named_seat_is_required', 'Sol proof, criterion 3: dispatch requires a named seat'),
    ('remote_host_is_part_of_repository_identity', 'Sol proof, criterion 2: another host is another repository'),
    ('suite_rejects_single_read', 'Sol proof, criterion 5: the missing-reading test detects a deleted retry'),
    ('suite_rejects_dry_run_launch', 'Sol proof, criterion 5: the dry-run tests detect a dispatcher invocation'),
]:
    setattr(SolProofs, name, getattr(SolProofs, method))

if __name__ == '__main__':
    selected = [n for n in vars(SolProofs) if n.startswith('Sol proof,')]
    if len(os.sys.argv) > 1:
        selected = os.sys.argv[1:]
    tests = unittest.TestSuite(SolProofs(n) for n in selected)
    result = unittest.TextTestRunner(verbosity=2).run(tests)
    raise SystemExit(not result.wasSuccessful())
