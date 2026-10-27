#!/usr/bin/env python3
"""Independent PR 190 proofs. Run in a disposable, offline container; fake Codex only."""
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
SHIM = ROOT / 'orchestration/reviewer/codex-shim.sh'


class Proofs(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sol-pr190-')
        self.addCleanup(self.temp.cleanup)
        self.p = Path(self.temp.name)
        self.bin = self.p / 'bin'
        self.bin.mkdir()
        self.token = self.p / 'disposable-token'
        self.token.write_text('synthetic-pr190-not-a-credential\n')
        self.token.chmod(0o600)
        self.prompt = self.p / 'prompt "; touch NEVER; $.txt'
        self.prompt.write_bytes(b'Review only.\x00\n$(touch NEVER)\n\n')
        self.record = self.p / 'codex.json'
        self.env = {k: v for k, v in os.environ.items()
                    if k not in ('GH_TOKEN', 'GITHUB_TOKEN', 'SHELLOPTS', 'BASH_ENV', 'ENV')}
        self.env.update(PATH=str(self.bin) + os.pathsep + self.env['PATH'],
                        SOL_RECORD=str(self.record), SOL_TOKEN_FIXTURE=str(self.token),
                        SOL_TIMER_RECORD=str(self.p / 'timer.jsonl'),
                        CODEX_SLOTS='off')  # the Codex limiter (#352): never a real lock host
        self.fake('codex', '''import json, os, pathlib, sys
token_ok = os.environ.get('GH_TOKEN') == pathlib.Path(os.environ['SOL_TOKEN_FIXTURE']).read_text().strip()
pathlib.Path(os.environ['SOL_RECORD']).write_text(json.dumps({
    'argv': sys.argv[1:], 'stdin': sys.stdin.buffer.read().hex(), 'token_ok': token_ok}))
''')

    def fake(self, name, source, interpreter=sys.executable):
        target = self.bin / name
        target.write_text('#!' + interpreter + '\n' + source)
        target.chmod(0o755)

    def shell(self, command, *args):
        return subprocess.run(['bash', '-c',
            'source "$1"; REVIEWER_TOKEN_FILE="$2"; shift 2; ' + command,
            'proof', str(SHIM), str(self.token), *args],
            env=self.env, capture_output=True, timeout=12, cwd=self.p)

    def fleet_launch(self):
        stages = json.loads((ROOT / 'orchestration/archive/stages.json').read_text())
        stage = next(s for s in stages if s['stage'] == 'REVIEW')
        brief = (ROOT / stage['brief']).read_text()
        # Execute the launch actually prescribed by the registered fleet brief,
        # rather than constructing a new call to the helper under review.
        match = re.search(r'`(run_(?:reviewer|sol_review) <REVIEW-WALL-SECONDS>[^`]+)`', brief)
        self.assertIsNotNone(match, 'registered fleet brief has no explicit reviewer launch')
        return match.group(1)

    def fleet_effort(self):
        launch = self.fleet_launch()
        for risk, effort in [('low', 'medium'), ('medium', 'medium'), ('high', 'high')]:
            with self.subTest(risk=risk):
                command = launch.replace('<REVIEW-WALL-SECONDS>', '3')
                command = command.replace('<prompt-file>', shlex.quote(str(self.prompt)))
                for placeholder in ('<risk>', '<RISK>', '<low|medium|high>'):
                    command = command.replace(placeholder, risk)
                result = self.shell(command)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                record = json.loads(self.record.read_text())
                args = record['argv']
                selected = [args[i + 1] for i, a in enumerate(args[:-1])
                            if a in ('-c', '--config') and args[i + 1].startswith('model_reasoning_effort=')]
                self.assertEqual(selected, [f'model_reasoning_effort={effort}'],
                    f'active fleet launch for {risk} inherited local effort instead of pinning it: {args}')

    def stdin_and_token(self):
        self.fake('sleep', '''import json, os, pathlib, sys
with pathlib.Path(os.environ['SOL_TIMER_RECORD']).open('a') as f:
    f.write(json.dumps({'token_present': 'GH_TOKEN' in os.environ}) + '\\n')
os.execv('/bin/sleep', ['sleep', *sys.argv[1:]])
''')
        result = self.shell('set -x; export SHELLOPTS; run_sol_review 3 high "$1"; rc=$?; '
                            '[ -z "${GH_TOKEN+x}" ] || exit 91; exit "$rc"', str(self.prompt))
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        record = json.loads(self.record.read_text())
        self.assertTrue(record['token_ok'])
        self.assertEqual(bytes.fromhex(record['stdin']), self.prompt.read_bytes())
        self.assertNotIn(self.token.read_bytes().strip(), result.stdout + result.stderr)
        timers = [json.loads(line) for line in (self.p / 'timer.jsonl').read_text().splitlines()]
        self.assertTrue(timers)
        self.assertTrue(all(not t['token_present'] for t in timers))
        self.assertFalse((self.p / 'NEVER').exists())

    def overrides(self):
        for args in [
            ('3', 'high -c model_reasoning_effort=low', str(self.prompt)),
            ('3', 'high\nmedium', str(self.prompt)),
            ('3', '--model=gpt-6-astra', str(self.prompt)),
            ('3', 'high', str(self.prompt), '--model=gpt-6-astra'),
            ('3', 'high', str(self.prompt), '--profile', 'cheap'),
        ]:
            with self.subTest(args=args):
                result = self.shell('run_sol_review "$@"', *args)
                self.assertEqual(result.returncode, 2)
                self.assertFalse(self.record.exists())

    def wrapper_deadline(self):
        # The fake survives TERM, noting when it came, so only KILL ends it.
        # Its record (pid, time up) appears only once its TERM handler is set.
        self.fake('codex', '''import os, pathlib, signal, time
record = os.environ['SOL_RECORD']
signal.signal(signal.SIGTERM, lambda *_: pathlib.Path(record + '.term').write_text(repr(time.time())))
pathlib.Path(record + '.tmp').write_text(f'{os.getpid()} {time.time()!r}')
os.replace(record + '.tmp', record)
end = time.time() + 20
while time.time() < end:
    time.sleep(0.1)
''')
        # The watchdog's timer is the real sleep, held until the fake is up:
        # under M5 load Python's start-up outlasted the 2 s deadline (#368).
        self.fake('sleep', '''n=0
while [ "$1" != 0 ] && [ ! -e "$SOL_RECORD" ] && [ $n -lt 100 ]; do /bin/sleep 0.05; n=$((n+1)); done
exec /bin/sleep "$@"
''', '/bin/sh')
        # Deadline 2 s: TERM at 2 s, then the watchdog's 3 s grace, then KILL.
        # From the fake's start, TERM's time catches an early watchdog and the
        # total catches a late one.
        result = self.shell('run_sol_review 2 high "$1"', str(self.prompt))
        finished = time.time()
        self.assertEqual(result.returncode, 124, result.stderr.decode())
        self.assertTrue(self.record.exists(), 'fake Codex never started')
        pid, up = self.record.read_text().split()
        term = Path(str(self.record) + '.term')
        self.assertTrue(term.exists(), 'the watchdog never sent TERM')
        self.assertGreaterEqual(float(term.read_text()) - float(up), 2, 'the watchdog fired before its deadline')
        self.assertLess(finished - float(up), 7, 'the watchdog fired seconds after its deadline')
        pid = int(pid)
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)


NAMES = [
    ('fleet_effort', 'Sol proof, criterion 2: registered fleet launch pins effort for every risk'),
    ('stdin_and_token', 'Sol proof, criterion 3: hostile prompt bytes survive and token stays inside reviewer'),
    ('overrides', 'Sol proof, criterion 3: injected risk and model or profile overrides never launch'),
    ('wrapper_deadline', 'Sol proof, criterion 3: Sol wrapper kills TERM-resistant fake Codex at deadline'),
]
for method, name in NAMES:
    setattr(Proofs, name, getattr(Proofs, method))

if __name__ == '__main__':
    names = sys.argv[1:] or [name for _, name in NAMES]
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(Proofs(n) for n in names))
    raise SystemExit(not result.wasSuccessful())
