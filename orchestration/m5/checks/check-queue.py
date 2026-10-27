#!/usr/bin/env python3
"""One first-come check queue for the M5, shared by every project (#333; owner, 27 Oct 2026).

  check-queue.py enter --project P --key SHA --pid N     queue pid N and print the mode (on or shadow)
  check-queue.py run --project P --key SHA -- CMD...     wait for a turn, then exec CMD under this same pid (on only)
  check-queue.py shadow-grant --pid N                     the old lock gave pid N its turn: log what the queue would do
  check-queue.py release --pid N
  check-queue.py set-mode on|shadow [--legacy DIR...]     refused while any queued process or old slot DIR is live
  check-queue.py repair                                   set a damaged state file aside, once no check runs
  check-queue.py status

Waiters start in arrival order, whatever their project. Up to SLOTS runs at once. A second or later run
starts only while the M5's 1-minute load is under MAX_LOAD_PER_CORE and SETTLE seconds have passed since
the last start (the load average lags a new run). The first run always starts: the old lock never read the
load, and with nothing of ours running, holding would not cool the M5. A waiter for a commit of the same
project already running waits for that run (checks.sh then reuses it if green) and lets later waiters by.

A waiter or run whose process is gone, or whose pid now belongs to a later process, loses its place: the
queue records each process's start time beside its pid. The state is one JSON file, read and rewritten
under an flock that the kernel drops when its holder dies, so no lock can go stale.
A damaged state file holds every start (it may have held live runs) until `repair` sets it aside.
Mode: <dir>/mode holds "on" once flipped; anything else is shadow, where checks-locked.sh's old lock
decides and the queue only logs SHADOW lines. `enter` queues a caller and reads the mode under the one lock,
and `set-mode` changes it under that lock only while nothing is queued or running, so no caller acts on a
mode that changed under it.
"""
import argparse
import contextlib
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time

SLOTS = 3
MAX_LOAD_PER_CORE = 0.8  # METHOD.md "Big runs by machine": the M5 starts nothing new at 0.8 load per core
SETTLE = 120
POLL = 20
DIR = Path.home() / 'Desktop/Agents/check-queue'


def m5_load():
    """The M5's own 1-minute load per core: the reading Seat Gauge shows for it, taken at the source."""
    try:
        return os.getloadavg()[0] / os.cpu_count()
    except (OSError, TypeError):
        return None


def process_start(pid):
    """The process's start time, or None when no process has that pid."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return None
    except PermissionError:
        pass
    try:
        # One zone and locale for every caller: ps prints the start in local time.
        out = subprocess.run(['/bin/ps', '-o', 'lstart=', '-p', str(pid)], capture_output=True, text=True, timeout=10,
                             env={'TZ': 'UTC0', 'LC_ALL': 'C'})
    except (OSError, subprocess.TimeoutExpired):
        return 'unknown'  # can't tell: keep its place rather than hand its slot to a second run
    return out.stdout.strip() or None


class Damaged(Exception):
    pass


def utc(t):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t))


class Queue:
    def __init__(self, root, clock=time.time, load=m5_load, identity=process_start,
                 slots=SLOTS, max_load=MAX_LOAD_PER_CORE, settle=SETTLE):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.clock, self.load, self.identity = clock, load, identity
        self.slots, self.max_load, self.settle = slots, max_load, settle

    def log(self, line):
        with open(self.root / 'queue.log', 'a') as f:
            f.write(f'{utc(self.clock())} {line}\n')

    @contextlib.contextmanager
    def state(self):
        with open(self.root / 'queue.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            path = self.root / 'state.json'
            try:
                s = json.loads(path.read_text())
                for k in ('seq', 'last_start', 'waiting', 'running'):
                    s[k]  # a file missing any of these is damaged too
            except FileNotFoundError:
                s = {'seq': 0, 'last_start': 0, 'waiting': [], 'running': []}
            except (ValueError, KeyError, TypeError):
                marker = self.root / 'damaged'
                if not marker.exists():
                    marker.touch()
                    self.log('DAMAGED state.json: every start holds until check-queue.py repair')
                raise Damaged()
            self.reap(s)
            yield s
            tmp = path.with_name(f'state.json.{os.getpid()}')
            tmp.write_text(json.dumps(s, indent=1))
            tmp.rename(path)

    def reap(self, s):
        for where in ('waiting', 'running'):
            for e in [e for e in s[where] if self.gone(e)]:
                s[where].remove(e)
                self.log(f'GONE seq={e["seq"]} pid={e["pid"]} project={e["project"]} key={e["key"]} '
                         f'{where} {int(self.clock() - e["since"])}s')

    def gone(self, e):
        now = self.identity(e['pid'])
        return now is None or 'unknown' not in (now, e['started']) and now != e['started']

    def add(self, s, project, key, pid):
        mine = next((e for e in s['waiting'] if e['pid'] == pid), None)
        if mine:  # `run` after `enter` from the same process keeps its place
            return mine['seq']
        s['seq'] += 1
        s['waiting'].append({'seq': s['seq'], 'pid': pid, 'started': self.identity(pid),
                             'project': project, 'key': key, 'since': self.clock()})
        self.log(f'ENQUEUE seq={s["seq"]} project={project} key={key} pid={pid}')
        return s['seq']

    def enqueue(self, project, key, pid):
        with self.state() as s:
            return self.add(s, project, key, pid)

    def read_mode(self):
        try:
            return 'on' if (self.root / 'mode').read_text().strip() == 'on' else 'shadow'
        except OSError:
            return 'shadow'

    def enter(self, project, key, pid):
        with self.state() as s:
            self.add(s, project, key, pid)
            return self.read_mode()

    def live(self, s, legacy):
        """What would stop a mode change: queued or running processes, and old slot directories whose owner
        lives. A slot directory with no readable pid is counted live: its owner may not have written it yet."""
        live = [f'seq {e["seq"]}' for e in sorted(s['waiting'] + s['running'], key=lambda e: e['seq'])]
        for d in map(Path, legacy):
            try:
                pid = int((d / 'pid').read_text())
            except (OSError, ValueError):
                pid = None
            if d.exists() and (pid is None or self.identity(pid) is not None):
                live.append(str(d))
        return live

    def write_mode(self, mode):
        tmp = self.root / 'mode.new'
        tmp.write_text(mode + '\n')
        tmp.rename(self.root / 'mode')

    def set_mode(self, mode, legacy=()):
        """Write mode only while nothing is live: (True, mode) or (False, why). An old-slot caller reads the
        mode outside this lock, so the slots are checked again after the write, and a slot taken meanwhile puts
        the old mode back: either that caller's read after its slot sees the new mode, or this check sees its slot."""
        if mode not in ('on', 'shadow'):
            return (False, 'mode must be on or shadow')
        with self.state() as s:
            live = self.live(s, legacy)
            if not live:
                was = self.read_mode()
                self.write_mode(mode)
                live = self.live(s, legacy)
                if live:
                    self.write_mode(was)
                    self.log(f'MODE {mode} refused: live {", ".join(live)}')
            if live:
                return (False, 'live: ' + ', '.join(live))
            self.log(f'MODE {mode}')
            return (True, mode)

    def repair(self):
        with open(self.root / 'queue.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            path = self.root / 'state.json'
            if path.exists():
                path.rename(path.with_name(f'state.json.bad-{int(self.clock())}'))
            (self.root / 'damaged').unlink(missing_ok=True)
            self.log('REPAIRED state.json set aside; the queue starts empty')

    def decide(self, s, me):
        """('start', slot) or ('wait', reason) for waiter `me`, without changing anything."""
        def twin(e):
            return next((r for r in s['running'] if (r['project'], r['key']) == (e['project'], e['key'])), None)
        if twin(me):
            return ('wait', f'same commit running (seq {twin(me)["seq"]})')
        ahead = [e for e in s['waiting'] if e['seq'] < me['seq'] and not twin(e)]
        if ahead:
            return ('wait', f'behind seq {min(e["seq"] for e in ahead)}')
        if len(s['running']) >= self.slots:
            return ('wait', f'slots full ({self.slots})')
        if s['running']:
            load = self.load()
            if load is None:
                return ('wait', 'load unreadable')
            if load >= self.max_load:
                return ('wait', f'load {load:.2f} per core, line {self.max_load:.2f}')
            if self.clock() - s['last_start'] < self.settle:
                return ('wait', 'settling after the last start')
        used = {r['slot'] for r in s['running']}
        return ('start', min(n for n in range(1, self.slots + 1) if n not in used))

    def take(self, s, me, slot):
        s['waiting'].remove(me)
        s['running'].append({**me, 'slot': slot, 'since': self.clock()})
        s['last_start'] = self.clock()

    def poll(self, pid):
        try:
            return self.poll_once(pid)
        except Damaged:
            return ('wait', 'state damaged')

    def poll_once(self, pid):
        with self.state() as s:
            me = next((e for e in s['waiting'] if e['pid'] == pid), None)
            if me is None:
                return ('wait', 'not queued')
            verdict = self.decide(s, me)
            if verdict[0] == 'start':
                self.take(s, me, verdict[1])
                load = self.load()
                self.log(f'START seq={me["seq"]} slot={verdict[1]} project={me["project"]} key={me["key"]} '
                         f'pid={pid} waited={int(self.clock() - me["since"])}s '
                         f'load={"-" if load is None else f"{load:.2f}"}')
            return verdict

    def shadow_grant(self, pid):
        """The old lock just gave pid its turn: log the order and slot the queue would have given, then
        record the run as running, since the old lock decided."""
        with self.state() as s:
            me = next((e for e in s['waiting'] if e['pid'] == pid), None)
            if me is None:
                self.log(f'SHADOW pid={pid} unregistered')
                return
            head = min(s['waiting'], key=lambda e: e['seq'])
            order = 'agree' if head is me else f'jump:head=seq{head["seq"]}'
            verdict = self.decide(s, me)
            would = f'start:slot={verdict[1]}' if verdict[0] == 'start' else f'hold:{verdict[1]}'
            load = self.load()
            self.log(f'SHADOW seq={me["seq"]} project={me["project"]} key={me["key"]} order={order} '
                     f'would={would} waited={int(self.clock() - me["since"])}s '
                     f'load={"-" if load is None else f"{load:.2f}"} running={len(s["running"])}')
            used = {r['slot'] for r in s['running']}
            self.take(s, me, min((n for n in range(1, self.slots + 1) if n not in used), default=0))

    def release(self, pid):
        with self.state() as s:
            s['running'] = [r for r in s['running'] if r['pid'] != pid]
            s['waiting'] = [e for e in s['waiting'] if e['pid'] != pid]


def main(argv):
    p = argparse.ArgumentParser(prog='check-queue.py')
    sub = p.add_subparsers(dest='cmd', required=True)
    run = sub.add_parser('run')
    for a in (run, sub.add_parser('enter')):
        a.add_argument('--project', required=True)
        a.add_argument('--key', required=True)
    sub.choices['enter'].add_argument('--pid', type=int, required=True)
    for name in ('shadow-grant', 'release'):
        sub.add_parser(name).add_argument('--pid', type=int, required=True)
    mode = sub.add_parser('set-mode')
    mode.add_argument('mode')
    mode.add_argument('--legacy', nargs='*', default=[])
    sub.add_parser('repair')
    sub.add_parser('status')
    run.add_argument('command', nargs=argparse.REMAINDER)
    args = p.parse_args(argv)
    q = Queue(Path(os.environ.get('CHECK_QUEUE_DIR') or DIR))

    if args.cmd == 'run':
        command = args.command[1:] if args.command[:1] == ['--'] else args.command
        if not command:
            p.error('run needs -- CMD...')
        while True:
            try:
                # Place and mode in one step (keeping any place `enter` gave this pid). In shadow the old slots
                # decide and know nothing of queue runs, so a run started here could make a fourth (Sol r2).
                if q.enter(args.project, args.key, os.getpid()) != 'on':
                    q.release(os.getpid())
                    print('check-queue.py: the queue is in shadow until set-mode on; nothing was run', file=sys.stderr)
                    sys.exit(3)
                if q.poll(os.getpid())[0] == 'start':
                    break
            except Damaged:
                pass
            time.sleep(POLL)
        # exec keeps this pid and its start time, so the slot is held until the run itself ends.
        os.execvp(command[0], command)
    elif args.cmd == 'enter':
        try:
            print(q.enter(args.project, args.key, args.pid))
        except Damaged:
            print(q.read_mode())  # on: `run` then holds until the repair; shadow: the old slots carry on
    elif args.cmd in ('shadow-grant', 'release'):
        try:
            (q.shadow_grant if args.cmd == 'shadow-grant' else q.release)(args.pid)
        except Damaged:
            pass
    elif args.cmd == 'set-mode':
        done, why = q.set_mode(args.mode, args.legacy)
        print(why)
        sys.exit(0 if done else 1)
    elif args.cmd == 'repair':
        q.repair()
    else:
        with q.state() as s:
            print(json.dumps({k: s[k] for k in ('running', 'waiting')}, indent=1))


if __name__ == '__main__':
    main(sys.argv[1:])
