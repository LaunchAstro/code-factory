#!/bin/bash
# usage: install.sh [dir]  (on the M5): puts the check scripts in dir (default ~/Desktop/Agents/repos/code-factory).
# Each file is written beside its target and renamed over it: bash reads a script as it runs, so editing one in
# place killed a run on 26 Oct 2026; a rename leaves a running script its own copy.
set -euo pipefail
src=$(cd "$(dirname "$0")" && pwd)
dst=${1:-$HOME/Desktop/Agents/repos/code-factory}
for f in checks-locked.sh green-run.sh checks.sh check-queue.py; do
  cp -p "$src/$f" "$dst/.$f.new"
  mv -f "$dst/.$f.new" "$dst/$f"
done
