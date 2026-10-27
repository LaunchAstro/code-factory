#!/usr/bin/env python3
"""The M5 check queue (#333): first-come order across projects, 3 slots, held while the M5 is busy,
a killed waiter's place freed, reuse of an all-green run, and the shadow lines beside the old lock.
The queue cases drive one poll at a time with a fake clock, fake load and fake processes: no real waits."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

sys.dont_write_bytecode = True  # no __pycache__ beside the kit's scripts
CHECKS = Path(__file__).resolve().parents[1] / 'm5/checks'
spec = importlib.util.spec_from_file_location('check_queue', CHECKS / 'check-queue.py')
check_queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_queue)


class Fakes:
    def __init__(self):
        self.now = 1_000_000.0
        self.load = 0.1
        self.procs = {}  # pid -> start stamp; a missing pid is a dead process

    def spawn(self, pid):
        self.procs[pid] = f'start-{pid}'
        return pid

    def kill(self, pid):
        del self.procs[pid]


class QueueCase(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='check-queue-')
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        self.fake = Fakes()
        self.queue = self.make()

    def make(self, **kw):
        return check_queue.Queue(self.root, clock=lambda: self.fake.now, load=lambda: self.fake.load,
                                 identity=self.fake.procs.get, **kw)

    def enqueue(self, pid, project='code-factory', key=None):
        self.fake.spawn(pid)
        return self.queue.enqueue(project, key or f'sha{pid}', pid)

    def log(self):
        return (self.root / 'queue.log').read_text()


class Order(QueueCase):
    def test_first_come_first_served_across_projects(self):
        for pid, project in [(11, 'code-factory'), (12, 'work-map'), (13, 'code-factory'), (14, 'ops-astro')]:
            self.enqueue(pid, project)
        self.queue.slots = 1
        self.assertEqual(self.queue.poll(11), ('start', 1))
        for later in (14, 13, 12):
            with self.subTest(pid=later):
                self.assertEqual(self.queue.poll(later)[0], 'wait')
        self.fake.kill(11)
        self.assertEqual(self.queue.poll(13)[0], 'wait')
        self.assertEqual(self.queue.poll(14)[0], 'wait')
        self.assertEqual(self.queue.poll(12), ('start', 1))

    def test_a_later_waiter_never_passes_the_head_even_with_a_free_slot(self):
        self.enqueue(21)
        self.enqueue(22)
        # 21 is the head; 22 polling first must not take the slot 21 is owed.
        self.assertEqual(self.queue.poll(22), ('wait', 'behind seq 1'))
        self.assertEqual(self.queue.poll(21), ('start', 1))

    def test_seq_survives_a_new_queue_object(self):
        self.assertEqual(self.enqueue(31), 1)
        self.queue = self.make()
        self.assertEqual(self.enqueue(32), 2)


class Slots(QueueCase):
    def test_three_slots_then_the_fourth_waits(self):
        for pid in (41, 42, 43, 44):
            self.enqueue(pid)
        for pid, slot in [(41, 1), (42, 2), (43, 3)]:
            self.fake.now += check_queue.SETTLE
            self.assertEqual(self.queue.poll(pid), ('start', slot))
        self.fake.now += check_queue.SETTLE
        self.assertEqual(self.queue.poll(44), ('wait', 'slots full (3)'))
        self.fake.kill(42)
        self.assertEqual(self.queue.poll(44), ('start', 2))

    def test_the_slot_count_defaults_to_three(self):
        self.assertEqual(check_queue.SLOTS, 3)
        self.assertEqual(self.queue.slots, 3)


class Load(QueueCase):
    def start_one(self):
        self.enqueue(51)
        self.assertEqual(self.queue.poll(51), ('start', 1))
        self.enqueue(52)
        self.fake.now += check_queue.SETTLE

    def test_holds_while_load_per_core_is_over_the_line_then_starts(self):
        self.start_one()
        self.fake.load = check_queue.MAX_LOAD_PER_CORE
        self.assertEqual(self.queue.poll(52), ('wait', 'load 0.80 per core, line 0.80'))
        self.fake.load = 0.79
        self.assertEqual(self.queue.poll(52), ('start', 2))

    def test_an_unreadable_load_holds_a_second_run(self):
        self.start_one()
        self.fake.load = None
        self.assertEqual(self.queue.poll(52), ('wait', 'load unreadable'))

    def test_a_new_start_waits_for_the_last_one_to_show_in_the_load(self):
        self.start_one()
        self.fake.now -= 1
        self.assertEqual(self.queue.poll(52), ('wait', 'settling after the last start'))
        self.fake.now += 1
        self.assertEqual(self.queue.poll(52), ('start', 2))

    def test_the_first_run_starts_whatever_the_load(self):
        # The old lock never read the load; with nothing of ours running, holding would not cool the M5.
        self.fake.load = 9.0
        self.enqueue(53)
        self.assertEqual(self.queue.poll(53), ('start', 1))


class Gone(QueueCase):
    def test_a_killed_waiter_frees_its_place(self):
        self.enqueue(61)
        self.enqueue(62)
        self.enqueue(63)
        self.queue.slots = 1
        self.assertEqual(self.queue.poll(61), ('start', 1))
        self.fake.kill(62)
        self.fake.kill(61)
        self.assertEqual(self.queue.poll(63), ('start', 1))
        self.assertIn('GONE seq=2 pid=62', self.log())
        self.assertNotIn('"pid": 62', (self.root / 'state.json').read_text())

    def test_a_reused_pid_is_not_the_waiter_that_held_the_place(self):
        self.enqueue(71)
        self.enqueue(72)
        self.fake.procs[71] = 'a-later-process'
        self.assertEqual(self.queue.poll(72), ('start', 1))

    def test_a_process_reads_the_same_start_time_whatever_the_caller_s_time_zone(self):
        # Every project shares the queue; a caller in another zone must not see a live waiter as gone.
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(600)'])
        self.addCleanup(child.wait)
        self.addCleanup(child.kill)
        stamps, zone = set(), os.environ.get('TZ')
        try:
            for caller_zone in ('UTC0', 'AEST-10', 'PST8PDT'):
                os.environ['TZ'] = caller_zone
                time.tzset()
                stamps.add(check_queue.process_start(child.pid))
        finally:
            os.environ.pop('TZ') if zone is None else os.environ.update(TZ=zone)
            time.tzset()
        self.assertEqual(len(stamps), 1, stamps)
        self.assertNotIn(None, stamps)

    def test_a_dead_holder_of_the_state_lock_never_blocks_the_queue(self):
        holder = subprocess.Popen([sys.executable, '-c', '''import fcntl, sys, time
f = open(sys.argv[1], "a"); fcntl.flock(f, fcntl.LOCK_EX); print("held", flush=True); time.sleep(600)''',
                                   str(self.root / 'queue.lock')], stdout=subprocess.PIPE, text=True)
        self.addCleanup(holder.stdout.close)
        self.addCleanup(holder.kill)
        self.assertEqual(holder.stdout.readline().strip(), 'held')
        holder.send_signal(signal.SIGKILL)
        holder.wait(timeout=10)
        self.enqueue(81)
        self.assertEqual(self.queue.poll(81), ('start', 1))

    def test_a_damaged_state_file_holds_every_start_until_repaired(self):
        # Sol r1: setting the file aside forgot three live runs and started a fourth.
        for pid in (91, 92, 93):
            self.enqueue(pid)
            self.fake.now += check_queue.SETTLE
            self.assertEqual(self.queue.poll(pid)[0], 'start')
        self.enqueue(94)
        (self.root / 'state.json').write_text('{"waiting": [')
        self.fake.now += check_queue.SETTLE
        self.assertEqual(self.queue.poll(94), ('wait', 'state damaged'))
        self.assertEqual(self.queue.poll(94), ('wait', 'state damaged'))
        with self.assertRaises(check_queue.Damaged):
            self.queue.enqueue('code-factory', 'sha95', self.fake.spawn(95))
        self.assertEqual(self.log().count('DAMAGED'), 1, self.log())
        self.assertEqual((self.root / 'state.json').read_text(), '{"waiting": [')
        self.queue.repair()
        self.assertEqual(len(list(self.root.glob('state.json.bad-*'))), 1)
        self.enqueue(96)
        self.assertEqual(self.queue.poll(96), ('start', 1))
        self.assertIn('REPAIRED', self.log())


class Mode(QueueCase):
    def test_rollback_is_refused_while_a_queue_run_is_live(self):
        # Sol r1: removing mode while three queue runs ran let the old slots start a fourth.
        self.assertTrue(self.queue.set_mode('on')[0])
        for pid in (151, 152, 153):
            self.enqueue(pid)
            self.fake.now += check_queue.SETTLE
            self.queue.poll(pid)
        self.assertEqual(self.queue.set_mode('shadow'), (False, 'live: seq 1, seq 2, seq 3'))
        self.assertEqual(self.queue.read_mode(), 'on')
        for pid in (151, 152, 153):
            self.fake.kill(pid)
        self.assertEqual(self.queue.set_mode('shadow'), (True, 'shadow'))
        self.assertEqual(self.queue.read_mode(), 'shadow')

    def test_flip_is_refused_while_an_old_slot_is_held(self):
        slot = self.root / 'checks.lock2'
        slot.mkdir()
        self.assertEqual(self.queue.set_mode('on', [slot]), (False, f'live: {slot}'))  # no pid written yet
        (slot / 'pid').write_text(f'{self.fake.spawn(161)}\n')
        self.assertEqual(self.queue.set_mode('on', [slot]), (False, f'live: {slot}'))
        self.fake.kill(161)
        self.assertEqual(self.queue.set_mode('on', [slot]), (True, 'on'))

    def test_a_caller_registers_and_reads_the_mode_in_one_step(self):
        self.fake.spawn(171)
        self.assertEqual(self.queue.enter('code-factory', 'abc', 171), 'shadow')
        self.assertEqual(self.queue.set_mode('on'), (False, 'live: seq 1'))
        self.assertEqual(self.queue.enqueue('code-factory', 'abc', 171), 1)  # run after enter: no second place
        self.assertEqual(len(json.loads((self.root / 'state.json').read_text())['waiting']), 1)

    def test_a_flip_that_races_a_new_old_slot_puts_the_mode_back(self):
        # Sol r3: a caller that read shadow took an old slot between set-mode's check and its write.
        slot = self.root / 'checks.lock'
        fake = self.fake

        class Racing(check_queue.Queue):
            def write_mode(self, mode):
                super().write_mode(mode)
                if mode == 'on' and not slot.exists():
                    slot.mkdir()
                    (slot / 'pid').write_text(f'{fake.spawn(181)}\n')

        q = Racing(self.root, clock=lambda: fake.now, load=lambda: fake.load, identity=fake.procs.get)
        self.assertEqual(q.set_mode('on', [slot]), (False, f'live: {slot}'))
        self.assertEqual(q.read_mode(), 'shadow')
        self.assertIn('MODE on refused', self.log())

    def test_an_unknown_mode_is_refused(self):
        self.assertEqual(self.queue.set_mode('off'), (False, 'mode must be on or shadow'))


class Twins(QueueCase):
    def test_a_waiter_for_a_commit_already_running_waits_for_it_and_lets_others_by(self):
        self.enqueue(101, key='abc')
        self.assertEqual(self.queue.poll(101), ('start', 1))
        self.enqueue(102, key='abc')
        self.enqueue(103, key='def')
        self.fake.now += check_queue.SETTLE
        self.assertEqual(self.queue.poll(102), ('wait', 'same commit running (seq 1)'))
        self.assertEqual(self.queue.poll(103), ('start', 2))
        self.fake.kill(101)
        self.fake.now += check_queue.SETTLE
        self.assertEqual(self.queue.poll(102), ('start', 1))

    def test_the_same_commit_of_another_project_is_not_a_twin(self):
        self.enqueue(111, project='code-factory', key='abc')
        self.assertEqual(self.queue.poll(111), ('start', 1))
        self.enqueue(112, project='work-map', key='abc')
        self.fake.now += check_queue.SETTLE
        self.assertEqual(self.queue.poll(112), ('start', 2))


class Shadow(QueueCase):
    def test_the_old_lock_decides_and_the_line_says_what_the_queue_would_do(self):
        self.enqueue(121)
        self.enqueue(122)
        self.queue.shadow_grant(122)
        self.fake.now += 300
        self.fake.kill(122)
        self.queue.shadow_grant(121)
        lines = [line for line in self.log().splitlines() if ' SHADOW ' in line]
        self.assertEqual(len(lines), 2, self.log())
        self.assertIn('seq=2 project=code-factory key=sha122 order=jump:head=seq1 would=hold:behind seq 1', lines[0])
        self.assertIn('seq=1 project=code-factory key=sha121 order=agree would=start:slot=1', lines[1])
        self.assertRegex(lines[1], r'waited=300s load=0\.10 running=0$')

    def test_a_grant_for_an_unregistered_run_is_logged_not_fatal(self):
        self.fake.spawn(131)
        self.queue.shadow_grant(131)
        self.assertIn('SHADOW pid=131 unregistered', self.log())

    def test_release_clears_the_entry(self):
        self.enqueue(141)
        self.queue.shadow_grant(141)
        self.queue.release(141)
        self.assertEqual(json.loads((self.root / 'state.json').read_text())['running'], [])


def sh(*args, env=None, check=True):
    result = subprocess.run(list(args), env=env, capture_output=True, text=True, timeout=60)
    if check and result.returncode != 0:
        raise AssertionError(f'{args} exited {result.returncode}: {result.stderr}')
    return result


class Scripts(unittest.TestCase):
    """checks-locked.sh and green-run.sh against a fixture clone: a fake checks.sh stands in for the 20-minute run."""

    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='check-scripts-')
        self.addCleanup(scratch.cleanup)
        self.r = Path(scratch.name) / 'code-factory'
        self.q = Path(scratch.name) / 'check-queue'
        self.r.mkdir()
        for name in ('checks-locked.sh', 'green-run.sh', 'check-queue.py'):
            shutil.copy2(CHECKS / name, self.r / name)
        (self.r / 'checks.sh').write_text('''#!/bin/bash
mkdir -p "$2"; echo "$1" > "$2/ran-in"; echo $$ > "$2/pid"; printf 'node-test\\t%s\\t1s\\nDONE\\n' "${FAKE_RC:-0}" > "$2/summary.tsv"
exit "${FAKE_RC:-0}"
''')
        main = self.r / 'main'
        sh('git', 'init', '-q', str(main))
        sh('git', '-C', str(main), '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false',
           'commit', '-q', '--allow-empty', '-m', 'fixture')
        self.sha = sh('git', '-C', str(main), 'rev-parse', 'HEAD').stdout.strip()
        self.env = {**os.environ, 'CHECKS_ROOT': str(self.r), 'CHECK_QUEUE_DIR': str(self.q)}

    def locked(self, out, rc=0):
        return sh('bash', str(self.r / 'checks-locked.sh'), str(self.r / 'main'), str(out),
                  env={**self.env, 'FAKE_RC': str(rc)}, check=False)

    def green(self, name, rows='node-test\t0\t1s\nDONE\n'):
        d = self.r / f'out-{self.sha}-{name}'
        d.mkdir()
        (d / 'summary.tsv').write_text(rows)
        return d

    def test_green_run_picks_the_newest_all_green_finished_run_only(self):
        self.green('red', 'node-test\t1\t1s\nDONE\n')
        self.green('unfinished', 'node-test\t0\t1s\n')
        old = self.green('old')
        os.utime(old, (1, 1))
        self.assertEqual(sh('bash', str(self.r / 'green-run.sh'), self.sha, env=self.env).stdout.strip(), str(old))
        newer = self.green('newer')
        self.assertEqual(sh('bash', str(self.r / 'green-run.sh'), self.sha, env=self.env).stdout.strip(), str(newer))

    def test_shadow_by_default_the_old_lock_runs_it_and_the_queue_logs_beside_it(self):
        out = self.r / 'out-a'
        result = self.locked(out, rc=3)
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertEqual((out / 'ran-in').read_text().strip(), str(self.r / 'main'))
        self.assertFalse((self.r / '.checks.lock').exists())
        log = (self.q / 'queue.log').read_text()
        self.assertRegex(log, rf'SHADOW seq=1 project=code-factory key={self.sha} order=agree would=start:slot=1 ')
        state = json.loads((self.q / 'state.json').read_text())
        self.assertEqual((state['waiting'], state['running']), ([], []))

    def test_shadow_keeps_the_interim_second_slot_beside_a_held_first_one(self):
        # The M5 runs the interim 3-slot script; installing the kit must not take it back to one slot.
        (self.r / '.checks.lock').mkdir()
        (self.r / '.checks.lock/pid').write_text(f'{os.getpid()}\n')
        out = self.r / 'out-e'
        result = sh('bash', str(self.r / 'checks-locked.sh'), str(self.r / 'main'), str(out),
                    env={**self.env, 'CHECKS_MAXLOAD': '100000'}, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((out / 'ran-in').exists())
        self.assertEqual((self.r / '.checks.lock/pid').read_text(), f'{os.getpid()}\n')
        self.assertFalse((self.r / '.checks.lock2').exists())

    def test_a_broken_queue_never_stops_the_old_path(self):
        (self.r / 'check-queue.py').write_text('raise SystemExit(9)\n')
        out = self.r / 'out-b'
        self.assertEqual(self.locked(out).returncode, 0)
        self.assertTrue((out / 'ran-in').exists())

    def test_on_the_queue_runs_it_under_its_own_pid_and_passes_the_exit_code(self):
        self.q.mkdir()
        (self.q / 'mode').write_text('on\n')
        out = self.r / 'out-c'
        result = self.locked(out, rc=4)
        self.assertEqual(result.returncode, 4, result.stderr)
        self.assertTrue((out / 'ran-in').exists())
        self.assertFalse((self.r / '.checks.lock').exists())
        log = (self.q / 'queue.log').read_text()
        pid = (out / 'pid').read_text().strip()
        # The run is the waiter's own process (exec), so its slot stays held until the run itself ends.
        self.assertIn(f'ENQUEUE seq=1 project=code-factory key={self.sha} pid={pid}\n', log)
        self.assertRegex(log, rf'START seq=1 slot=1 project=code-factory key={self.sha} pid={pid} ')

    def test_on_a_broken_queue_never_falls_back_to_the_old_slots(self):
        self.q.mkdir()
        (self.q / 'mode').write_text('on\n')
        (self.r / 'check-queue.py').write_text('raise SystemExit(9)\n')
        out = self.r / 'out-f'
        self.assertEqual(self.locked(out).returncode, 9)
        self.assertFalse((out / 'ran-in').exists())
        self.assertFalse((self.r / '.checks.lock').exists())

    def test_a_direct_run_is_refused_in_shadow_so_it_never_overlaps_the_old_slots(self):
        # Sol r2: another project's `run` started beside the three old slots while the mode was shadow.
        marker = self.r / 'ran'
        cli = [sys.executable, str(self.r / 'check-queue.py'), 'run', '--project', 'example-project', '--key', 'sha-a',
               '--', 'touch', str(marker)]
        refused = sh(*cli, env=self.env, check=False)
        self.assertEqual(refused.returncode, 3, refused.stderr)
        self.assertIn('shadow', refused.stderr)
        self.assertFalse(marker.exists())
        state = json.loads((self.q / 'state.json').read_text())
        self.assertEqual((state['waiting'], state['running']), ([], []))
        (self.q / 'mode').write_text('on\n')
        self.assertEqual(sh(*cli, env=self.env).returncode, 0)
        self.assertTrue(marker.exists())

    def test_a_caller_that_read_shadow_backs_off_its_old_slot_once_the_mode_is_on(self):
        # Sol r3: enter fails, the caller falls back to shadow, set-mode on lands before it takes an old slot.
        real = self.r / 'real-check-queue.py'
        shutil.move(str(self.r / 'check-queue.py'), real)
        (self.r / 'check-queue.py').write_text(f'''import os, sys
if sys.argv[1] == 'enter' and not os.path.exists({str(self.r / 'entered')!r}):
    open({str(self.r / 'entered')!r}, 'w').close()
    sys.exit(1)  # the helper fails once, before registering
os.execv(sys.executable, [sys.executable, {str(real)!r}] + sys.argv[1:])
''')
        bin_dir = self.r / 'bin'
        bin_dir.mkdir()
        # The first old slot is held, so the caller reads the load for slot 2; the flip lands right then.
        (bin_dir / 'sysctl').write_text(f'''#!/bin/bash
"{sys.executable}" "{real}" set-mode on >/dev/null
echo "{{ 0.10 0.10 0.10 }}"
''')
        (bin_dir / 'sysctl').chmod(0o755)
        held = self.r / '.checks.lock'
        held.mkdir()
        (held / 'pid').write_text(f'{os.getpid()}\n')
        out = self.r / 'out-g'
        result = sh('bash', str(self.r / 'checks-locked.sh'), str(self.r / 'main'), str(out),
                    env={**self.env, 'PATH': f'{bin_dir}:{os.environ["PATH"]}'}, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        log = (self.q / 'queue.log').read_text()
        self.assertIn('MODE on', log)
        self.assertRegex(log, rf'START seq=\d+ slot=1 project=code-factory key={self.sha} ')
        self.assertNotIn('SHADOW', log)
        self.assertFalse((self.r / '.checks.lock2').exists())
        self.assertEqual((held / 'pid').read_text(), f'{os.getpid()}\n')

    def test_on_a_green_run_of_the_same_commit_is_reused_without_queueing(self):
        self.q.mkdir()
        (self.q / 'mode').write_text('on\n')
        done = self.green('done')
        out = self.r / 'out-d'
        self.assertEqual(self.locked(out).returncode, 0)
        self.assertEqual((out / 'reused-from.txt').read_text().strip(), str(done))
        self.assertFalse((out / 'ran-in').exists())
        self.assertNotIn('START', (self.q / 'queue.log').read_text())
        self.assertEqual(json.loads((self.q / 'state.json').read_text())['waiting'], [])  # its place given back

    def test_set_mode_from_the_command_line_refuses_while_an_old_slot_is_held(self):
        held = self.r / '.checks.lock'
        held.mkdir()
        (held / 'pid').write_text(f'{os.getpid()}\n')
        cli = [sys.executable, str(self.r / 'check-queue.py'), 'set-mode', 'on', '--legacy', str(held)]
        refused = sh(*cli, env=self.env, check=False)
        self.assertEqual((refused.returncode, refused.stdout.strip()), (1, f'live: {held}'))
        self.assertFalse((self.q / 'mode').exists())
        shutil.rmtree(held)
        self.assertEqual(sh(*cli, env=self.env).stdout.strip(), 'on')
        self.assertEqual((self.q / 'mode').read_text(), 'on\n')

    def test_install_replaces_each_file_by_rename_so_a_running_script_keeps_its_copy(self):
        target = Path(self.r.parent) / 'installed'
        target.mkdir()
        (target / 'checks-locked.sh').write_text('old\n')
        before = (target / 'checks-locked.sh').stat().st_ino
        held = open(target / 'checks-locked.sh')
        self.addCleanup(held.close)
        sh('bash', str(CHECKS / 'install.sh'), str(target))
        self.assertEqual(held.read(), 'old\n')
        self.assertNotEqual((target / 'checks-locked.sh').stat().st_ino, before)
        for name in ('checks-locked.sh', 'green-run.sh', 'checks.sh', 'check-queue.py'):
            with self.subTest(name=name):
                self.assertEqual((target / name).read_bytes(), (CHECKS / name).read_bytes())
        self.assertEqual(sorted(p.name for p in target.iterdir()),
                         ['check-queue.py', 'checks-locked.sh', 'checks.sh', 'green-run.sh'])


if __name__ == '__main__':
    unittest.main()
