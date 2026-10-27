#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Sol's PR 222 round 1 proofs, unchanged but for the repository-root depth (parents[2] here).
import os
from pathlib import Path
import subprocess
import sys
import tempfile

SCRIPT = Path(__file__).resolve().parents[2] / 'orchestration/precheck-stall.sh'
NAMES = [
    'Sol proof, criterion 1: queue-only demand alerts an idle line',
    'Sol proof, criterion 1: old-head green cannot clear new-head demand',
    'Sol proof, criterion 1: another batch runner cannot hide a gone batch',
    'Sol proof, criterion 1: old batch END cannot close the current batch',
]

def check(index):
    with tempfile.TemporaryDirectory(prefix='sol222-') as scratch:
        root = Path(scratch)
        env = dict(os.environ, ROUND=scratch, PRECHECK_NOW='2026-10-19T06:00:00Z',
                   PRECHECK_PIDS_A='', PRECHECK_PIDS_B='')
        end = '2026-10-19T05:00:00Z LANE-OA-Precheck-3 END b-2000-old\n'
        proc = None
        if index == 0:
            logs = end
            queue = root / 'lane-scratch/OA-Precheck/line.txt'
            queue.parent.mkdir(parents=True)
            queue.write_text('# line A queue\n2001 2002\n')
            expected = '[precheck-idle A '
        elif index == 1:
            logs = (end + '2026-10-19T05:10:00Z ORCH PRECHECK-WAIT PR 2001 head bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'
                    '2026-10-19T05:20:00Z PRECHECK-GREEN PR 2001 head aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa main ccccccc 75\n')
            expected = '[precheck-idle A '
        elif index == 2:
            logs = '2026-10-19T05:00:00Z LANE-OA-Precheck-B START B-2001-new\n'
            pids = root / 'pids'
            pids.mkdir()
            runner = root / 'mac-run.sh'
            runner.write_text('#!/bin/sh\nexec sleep 60\n')
            # Keep the shell's command visible, like the supplied live-runner fixture.
            runner.write_text('#!/bin/sh\nsleep 60 &\nwait\n')
            proc = subprocess.Popen(['sh', str(runner), 'B-1999-old'], start_new_session=True)
            (pids / 'B-1999-old.pid').write_text(str(proc.pid))
            env['PRECHECK_PIDS_B'] = str(pids)
            expected = '[precheck-gone B '
        else:
            logs = ('2026-10-19T02:00:00Z LANE-OA-Precheck-B START B-2000-old\n'
                    '2026-10-19T02:10:00Z LANE-OA-Precheck-B START B-2001-new\n'
                    '2026-10-19T02:20:00Z LANE-OA-Precheck-B END B-2000-old\n')
            expected = '[precheck-stall B 2026-10-19T02:10:00Z]'
        (root / 'events.log').write_text(logs)
        try:
            result = subprocess.run(['bash', str(SCRIPT)], env=env, capture_output=True, text=True)
            assert result.returncode == 0, result.stderr
            relay = root / 'RELAY-LOG.md'
            actual = relay.read_text() if relay.exists() else '<no alerts>'
            assert expected in actual, f'Expected {expected}; actual: {actual}'
        finally:
            if proc:
                import signal
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait()

failed = 0
for i, name in enumerate(NAMES):
    if len(sys.argv) > 1 and sys.argv[1] != name:
        continue
    try:
        check(i)
        print('PASS:', name)
    except AssertionError as error:
        failed += 1
        print('FAIL:', name, '\n ', error)
sys.exit(bool(failed))
