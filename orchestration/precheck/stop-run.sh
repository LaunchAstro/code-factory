#!/usr/bin/env bash
# Stop one pre-check run on the test machine: only its own processes, walked
# down from its runner.sh by PID (never by name), then its labelled containers.
# The runner's exit trap sweeps any compose stack its tests were building.
#   stop-run.sh <run>   (the run name, as in the logs folder: b-<pr>-<head7>-...)
set -uo pipefail
RUN=${1:?run}
HOST=${PRECHECK_HOST:?set PRECHECK_HOST}
case $RUN in */*|.*|*' '*) echo "stop-run: bad run name" >&2; exit 2 ;; esac
ssh "$HOST" "python3 - $RUN" <<'PY'
import subprocess, os, signal, sys
run = sys.argv[1]
rows = [l.split(None, 3) for l in subprocess.run(["ps", "-axo", "pid,ppid,pgid,command"], capture_output=True, text=True).stdout.splitlines()[1:]]
roots = [r[0] for r in rows if r[3].startswith(f"bash bin/runner.sh {run} ")]
kids = {}
for r in rows: kids.setdefault(r[1], []).append(r[0])
out, st = [], list(roots)
while st:
    p = st.pop(); out.append(p); st += kids.get(p, [])
for p in out:
    try: os.kill(int(p), signal.SIGTERM)
    except Exception: pass
print(f"stop-run: {run}: {len(roots)} runner processes, {len(out)} in all, sent TERM")
PY
sleep 8
ssh "$HOST" "bash -s" <<EOF2
ids=\$(docker ps -aq --filter label=precheck=$RUN)
[ -n "\$ids" ] && docker rm -f \$ids >/dev/null && echo "stop-run: removed \$(echo \$ids | wc -w) labelled containers"
true
EOF2
