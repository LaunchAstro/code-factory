#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""The pre-check fails closed: no green on unknown input, a signal death or a
tree that is not the queue's. Offline: no network, real Docker, or product edits.

Run all cases, or pass one exact printed test name as the only argument.
The fixture is the added test's real local-git/stub-transport setup; only
its test invocations are omitted. Each assertion describes required behaviour.
"""
from pathlib import Path
import os
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / "orchestration/precheck"
SOURCE = (ROOT / "orchestration/tests/precheck-cases.sh").read_text()
FIXTURE = SOURCE[SOURCE.index("# The repository: main moved"):SOURCE.index("# Refusals: before")]


def fixture(body):
    with tempfile.TemporaryDirectory(prefix="precheck-") as scratch:
        env = dict(os.environ, T=scratch, KIT=str(KIT))
        p = subprocess.run(["bash", "-c", "set -uo pipefail\n" + FIXTURE + body],
                           env=env, text=True, capture_output=True, timeout=45)
        assert p.returncode == 0, p.stdout + p.stderr


def unknown_unit():
    fixture('''
PRECHECK_UNITS=does-not-exist pc -w 1 7 "$head"
if statuses "$head" | grep -q '^green:'; then
  echo 'FAIL: unknown unit selected zero checks, yet posted green'; cat "$T/out"; exit 1
fi
''')


def cancelled_job():
    fixture('''
cat > "$T/steps.sh" <<'STEPS'
UNITS="u1"
LIGHT=""
STEPS_VARS=""
needs_pg() { return 1; }
heavy_unit() { return 1; }
unit_limit() { echo 120; }
job() { kill -TERM $$; }
STEP_FUNCS="job"
STEPS
pc -w 1 7 "$head"
if statuses "$head" | grep -q '^green:'; then
  echo 'FAIL: signal-terminated job posted green'; cat "$M/precheck/$RUN/summary.txt"; exit 1
fi
''')


def queue_conflict():
    fixture('''
PRECHECK_BASE="8 $pr8" pc -w 1 7 "$head"
if statuses "$head" | grep -q '^green:'; then
  echo 'FAIL: conflicting queue predecessor omitted, successor posted green'; cat "$T/out"; exit 1
fi
''')


def compose_cleanup():
    # Source the actual functions verbatim, with only Docker stubbed.
    runner = (KIT / "runner.sh").read_text()
    funcs = runner[runner.index("sweep_stacks() {"):runner.index("trap cleanup EXIT")]
    with tempfile.TemporaryDirectory(prefix="precheck-clean-") as scratch:
        env = dict(os.environ, CASE_SCRATCH=scratch)
        script = '''set -uo pipefail
BASE=$CASE_SCRATCH; DIR=$BASE/run; SLOT=0; LABEL=precheck=run
mkdir -p "$BASE/slots/$SLOT" "$DIR/logs"
docker() {
  case "$1" in
    ps) echo fake-container ;;
    inspect) case "$3" in *working_dir*) echo "$DIR/w1" ;; *) echo fixture-project ;; esac ;;
    rm|network|volume) echo "$*" >> "$BASE/removed" ;;
  esac
}
''' + funcs + '''
cleanup
[ ! -d "$BASE/slots/0" ] && [ -s "$BASE/removed" ]
'''
        p = subprocess.run(["bash", "-c", script], env=env, text=True,
                           capture_output=True, timeout=10)
        assert p.returncode == 0, "compose cleanup must remove resources and free its slot: " + p.stdout + p.stderr


CASES = {
    "unknown units cannot publish green without checks": unknown_unit,
    "signal-terminated jobs cannot publish green": cancelled_job,
    "conflicting queue predecessors prevent green": queue_conflict,
    "compose cleanup removes resources and releases its slot": compose_cleanup,
}

if __name__ == "__main__":
    requested = sys.argv[1:]
    failures = 0
    for name, test in CASES.items():
        if requested and name not in requested:
            continue
        try:
            test()
            print("PASS " + name, flush=True)
        except AssertionError as exc:
            failures += 1
            print("FAIL " + name + "\n" + str(exc), flush=True)
    if requested and any(name not in CASES for name in requested):
        raise SystemExit("unknown proof name")
    raise SystemExit(1 if failures else 0)
