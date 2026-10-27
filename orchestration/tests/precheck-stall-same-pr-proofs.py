#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Sol's PR 222 round 2 same-PR proofs, unchanged but for the repository-root depth (parents[2] here).
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import sys

SCRIPT = Path(__file__).resolve().parents[2] / 'orchestration/precheck-stall.sh'
NAMES = [
 'Sol proof, criterion 1: previous head runner cannot hide current same-PR batch',
 'Sol proof, criterion 1: previous head END cannot close current same-PR batch',
]

def check(index):
 with tempfile.TemporaryDirectory(prefix='sol222-same-pr-') as tmp:
  root = Path(tmp)
  env = dict(os.environ, ROUND=tmp, PRECHECK_NOW='2026-10-19T06:00:00Z', PRECHECK_PIDS_A='', PRECHECK_PIDS_B='')
  proc = None
  logs = '2026-10-19T02:00:00Z LANE-OA-Precheck-3 START batch #2001 bbbbbbb #2002 ccccccc\n'
  if index == 0:
   pids = root / 'pids'; pids.mkdir()
   runner = root / 'm5-run.sh'
   runner.write_text('#!/bin/sh\nsleep 60 &\nwait\n')
   proc = subprocess.Popen(['sh', str(runner), 'b-2001-aaaaaaa-on-1900'], start_new_session=True)
   (pids / 'b-2001-aaaaaaa-on-1900.pid').write_text(str(proc.pid))
   env['PRECHECK_PIDS_A'] = str(pids)
   expected = '[precheck-gone A 2026-10-19T02:00:00Z]'
  else:
   logs += '2026-10-19T02:10:00Z LANE-OA-Precheck-3 END b-2001-aaaaaaa-on-1900\n'
   expected = '[precheck-stall A 2026-10-19T02:00:00Z]'
  (root / 'events.log').write_text(logs)
  try:
   result = subprocess.run(['bash', str(SCRIPT)], env=env, text=True, capture_output=True)
   assert result.returncode == 0, result.stderr
   actual = (root / 'RELAY-LOG.md').read_text() if (root / 'RELAY-LOG.md').exists() else '<no alerts>'
   assert expected in actual, f'Expected {expected}; actual: {actual}'
  finally:
   if proc:
    os.killpg(proc.pid, signal.SIGTERM); proc.wait()

failed = 0
for index, name in enumerate(NAMES):
 if len(sys.argv) > 1 and sys.argv[1] != name: continue
 try:
  check(index); print('PASS:', name)
 except AssertionError as error:
  failed += 1; print('FAIL:', name, '\n ', error)
sys.exit(bool(failed))
