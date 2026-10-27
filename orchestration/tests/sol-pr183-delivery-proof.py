#!/usr/bin/env python3
"""Review-only timing proof: actual dispatcher, fake pane and fake seat."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'orchestration/tests/fixtures/herdr-dispatch'


def dispatcher():
    """The dispatcher to prove against, and which one it is.

    SOL_REAL_DISPATCH names one explicitly, and a missing one then fails the
    proof. Otherwise the installed herdr-dispatch (PATH, then the dispatch
    skill's ~/.local/bin) is used when it exists, and the fixture, which keeps
    the part of its contract this proof exercises, when it does not.
    """
    named = os.environ.get('SOL_REAL_DISPATCH')
    if named:
        return named, 'real, from SOL_REAL_DISPATCH'
    for found in (shutil.which('herdr-dispatch'), Path.home() / '.local/bin/herdr-dispatch'):
        if found and os.access(found, os.X_OK):
            return str(found), 'real, installed'
    return str(FIXTURE), 'fixture'

class DeliveryProof(unittest.TestCase):
    def delivery(self):
        with tempfile.TemporaryDirectory(prefix='sol-delivery-') as scratch:
            p = Path(scratch)
            home = p / 'home'
            (home / 'bin').mkdir(parents=True)
            (p / 'bin').mkdir()
            (p / 'tmp').mkdir()
            env = os.environ.copy()
            env.update(HOME=str(home), TMPDIR=str(p / 'tmp'), HERDR_ENV='1',
                       HERDR_WORKSPACE_ID='1', SOL_SCRATCH=str(p),
                       HERDR_DISPATCH=DISPATCH,
                       PATH=str(p / 'bin') + ':' + env['PATH'])
            fake = p / 'bin/herdr'
            fake.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
p = pathlib.Path(os.environ['SOL_SCRATCH'])
if sys.argv[1:3] == ['pane', 'list']:
    print(json.dumps({'workspace_id': '1', 'focused': True}))
elif sys.argv[1:3] == ['workspace', 'list']:  # herdr-dispatch reads its caller's label (team-vault#15)
    print(json.dumps({'result': {'workspaces': [{'workspace_id': '1', 'label': 'Job-Work'}]}}))
elif sys.argv[1:3] == ['tab', 'create']:
    print(json.dumps({'result': {'tab': {'tab_id': 't1'}, 'root_pane': {'pane_id': 'p1'}}}))
elif sys.argv[1:3] == ['pane', 'run']:
    (p / 'queued-command').write_text(sys.argv[4])
elif sys.argv[1:3] != ['tab', 'focus']:
    sys.exit(99)
''')
            fake.chmod(0o755)
            seat = home / 'bin/claude-alpha'
            seat.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
(pathlib.Path(os.environ['SOL_SCRATCH']) / 'argv.json').write_text(json.dumps(sys.argv[1:]))
''')
            seat.chmod(0o755)
            note = p / 'note.md'
            note.write_text('Client A complete relay note\nHANDOFF-END\n')
            result = subprocess.run([str(ROOT / 'orchestration/single/handoff.sh'),
                                     'dispatch', str(note), '--cwd', str(p),
                                     '--label', 'Next', '--seat', 'alpha'],
                                    env=env, text=True, capture_output=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            # A pane may consume its queued command after the CLI returns.
            # Run only the recorded command, whose launcher and herdr are fakes.
            queued = subprocess.run(['bash', '-c', (p / 'queued-command').read_text()],
                                    env=env, text=True, capture_output=True, timeout=15)
            self.assertEqual(queued.returncode, 0, queued.stderr)
            args = json.loads((p / 'argv.json').read_text())
            self.assertEqual(args[-1].rstrip('\n'), note.read_text().rstrip('\n'),
                             'dispatcher reported launched, but deleted prompt.txt before the pane read it; ' + queued.stderr)

DISPATCH, WHICH = dispatcher()
NAME = 'Sol proof, criterion 3: a queued pane receives the whole relay note'
setattr(DeliveryProof, NAME, DeliveryProof.delivery)
if __name__ == '__main__':
    print(f'dispatcher: {WHICH}: {DISPATCH}', file=sys.stderr)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite([DeliveryProof(NAME)]))
    raise SystemExit(not result.wasSuccessful())
