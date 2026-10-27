#!/bin/bash
# REVIEW-R6 timeout shim, for a host with no GNU timeout (macOS has none).
# Fix over round 5: both the command and the watchdog run in their own process
# group, and the deadline kills the whole group, so no sleep child outlives the
# session.
# Sol's review of 69afe53: the deadline reaches the watchdog as an argument,
# never as shell text, and whatever the command leaves in its group when it
# returns gets TERM, three seconds' grace and KILL here, so cancelling the
# watchdog never cancels that KILL. Only the command's own process group is
# covered: a descendant that starts a group of its own (setsid, setpgrp)
# outlives the deadline, with the token if it had one; closing that needs a
# session or container boundary. `exec { $ARGV[0] } @ARGV` runs a single
# argument as one program, never as a shell command line.
# Sol's review of 7790dc6: a command that exits 0 on the deadline's TERM made
# an expired run succeed. The watchdog exits 124 once it has fired, and then
# so does this, as timeout(1) does, whatever the command returned.
# Sol's review of eba3667: a watchdog that failed to launch left the command
# running untimed. The command now waits on a pipe the watchdog holds and
# starts only when the watchdog, its trap set, writes to it; a watchdog that
# never got that far closes the pipe and the command never starts. A watchdog
# that ends any way but cancelled (0) or fired (124) fails the run.
# Sol's review of 8e3681d: any TERM read as cancelled, after any timer. The
# shim now leaves a cancel file before its TERM; a TERM without one, or a timer
# that ended other than by that TERM or its deadline, exits 125. The timer
# starts before `go`, so a command never runs ahead of it.
# Sol's review of 87a9f77: dash refused the watchdog's `kill --`, Bash as
# /bin/sh turned a quick 7 into 125 on its second wait, a timer that ran out
# while the watchdog was stopped read as cancelled, and a sleep that failed on
# the real duration still got `go`. The watchdog is Perl now: it waits for its
# timer once, a timer that finished is a deadline that fired (124), cancelled
# is a timer killed by TERM with the cancel file there, and `go` goes only to
# a timer still running 0.08 seconds after it started.
# Found on the M5 (#315): the timer was forked with the watchdog's TERM handler,
# so a cancel that reached it before it exec'd `sleep` was taken by that handler
# and lost, and a quick command read 124 after the whole deadline. The timer
# puts TERM back to its default before it unblocks it.
run_with_deadline() {
  local secs="$1"; shift
  [[ "$secs" =~ ^[0-9]+(\.[0-9]+)?$ ]] \
    || { echo "run_with_deadline: '$secs' is not a number of seconds" >&2; return 2; }
  # The watchdog's own timer must work before the command starts: a quick
  # command could otherwise finish before a failing timer is noticed.
  /bin/sh -c 'sleep 0' 2>/dev/null \
    || { echo "run_with_deadline: no working sleep, so no deadline" >&2; return 125; }
  local gate
  gate=$(mktemp -d) && mkfifo "$gate/go" \
    || { echo "run_with_deadline: no scratch directory, so no deadline" >&2; return 125; }
  perl -e 'setpgrp(0,0); my $go; open($go, "<", shift) && defined(<$go>) or die "no timer, so no run\n";
    exec { $ARGV[0] } @ARGV or die "exec: $!\n"' -- "$gate/go" "$@" &
  local cmd_pgid=$!
  # The watchdog. TERM is held until `go` is sent.
  perl -e '$0 = "codex-shim watchdog"; use POSIX qw(:signal_h WNOHANG);
    my ($secs, $pgid, $cancel) = @ARGV; setpgrp(0, 0);
    my $term = POSIX::SigSet->new(SIGTERM); sigprocmask(SIG_BLOCK, $term);
    $SIG{TERM} = sub { -e $cancel or exit 125 };
    my $t = fork // exit 125;
    if (!$t) { $SIG{TERM} = "DEFAULT"; sigprocmask(SIG_UNBLOCK, $term); open STDOUT, ">", "/dev/null"; exec "sleep", $secs; exit 125 }
    select undef, undef, undef, 0.08;
    waitpid($t, WNOHANG) == $t and exit($? ? 125 : 124);
    print "go\n"; close STDOUT; sigprocmask(SIG_UNBLOCK, $term);
    waitpid($t, 0); my $s = $?;
    ($s & 127) == SIGTERM && -e $cancel and exit 0;
    $s == 0 or exit 125;
    $SIG{TERM} = sub { exit 124 }; kill TERM => -$pgid;
    unless (-e $cancel) { sleep 3; kill KILL => -$pgid }
    exit 124' -- "$secs" "$cmd_pgid" "$gate/cancel" > "$gate/go" &
  local wd_pgid=$!
  wait "$cmd_pgid"; local rc=$?
  : > "$gate/cancel"
  # By pid as well: a watchdog still opening the pipe has no group of its own.
  kill -TERM -- -"$wd_pgid" 2>/dev/null || kill -TERM "$wd_pgid" 2>/dev/null
  wait "$wd_pgid" 2>/dev/null
  case $? in
    0) ;;
    124) rc=124 ;;
    *) echo "run_with_deadline: the watchdog failed, so no deadline held" >&2; rc=125 ;;
  esac
  rm -rf "$gate"
  if kill -0 -- -"$cmd_pgid" 2>/dev/null; then
    kill -TERM -- -"$cmd_pgid" 2>/dev/null
    local tick
    for tick in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      kill -0 -- -"$cmd_pgid" 2>/dev/null || break
      /bin/sleep 0.2
    done
    kill -KILL -- -"$cmd_pgid" 2>/dev/null
  fi
  return $rc
}

# The reviewer account's GitHub token, read from one file and given to the codex
# process alone. Round 7 posted all six reviews this way: `author_association`
# COLLABORATOR on the review, the active `gh` account unchanged, and no lane
# running `gh auth switch`. The token is never written to a repository, a log or
# a prompt. Fill the path below; `README.md` beside this file says how.
REVIEWER_TOKEN_FILE="<REVIEWER-TOKEN-FILE>"

# run_reviewer <seconds> <command...>
# The token never enters this shell. A small sh started inside the command's
# process group reads the file, exports GH_TOKEN and execs the command, so the
# command and its children hold it and nothing else does: not the calling
# shell, not the watchdog (Sol's review of 69afe53 found it inherited there),
# and not a `set -x` trace, which here shows the file's path only. The inner
# sh turns tracing off first, since an exported SHELLOPTS hands it xtrace.
run_reviewer() {
  local secs="$1"; shift
  # Sol's review of eba3667: no command meant an empty exec that succeeded.
  [ $# -gt 0 ] || { echo "run_reviewer: no command to run" >&2; return 2; }
  [ -r "$REVIEWER_TOKEN_FILE" ] \
    || { echo "reviewer token file unreadable: $REVIEWER_TOKEN_FILE" >&2; return 1; }
  run_with_deadline "$secs" /bin/sh -c '
    set +x
    GH_TOKEN="$(tr -d "\r\n" < "$0")" || { echo "reviewer token file unreadable: $0" >&2; exit 1; }
    [ -n "$GH_TOKEN" ] || { echo "reviewer token file empty: $0" >&2; exit 1; }
    export GH_TOKEN
    exec "$@"' "$REVIEWER_TOKEN_FILE" "$@"
}

# Owner, 17 October 2026: the same rule in fleet and single mode.
# Unknown or absent risk never silently downgrades a protected review.
sol_review_effort() {
  [ "$#" -eq 1 ] || { echo 'sol_review_effort: need low, medium or high risk' >&2; return 2; }
  case "$1" in
    high) echo high ;;
    low|medium) echo medium ;;
    *) echo 'sol_review_effort: need low, medium or high risk' >&2; return 2 ;;
  esac
}

# run_sol_review <seconds> <low|medium|high> <prompt-file>
# No extra CLI flags: callers cannot override the model or selected effort.
# The generic run_reviewer above remains available for non-Sol commands.
run_sol_review() {
  [ "$#" -eq 3 ] || { echo 'run_sol_review: need seconds, risk and prompt file' >&2; return 2; }
  local secs="$1" risk="$2" prompt="$3" effort
  effort=$(sol_review_effort "$risk") || return 2
  [ -f "$prompt" ] && [ -r "$prompt" ] \
    || { echo 'run_sol_review: need a readable prompt file' >&2; return 2; }
  # Open stdin inside the command group: an asynchronous watchdog launch
  # otherwise receives /dev/null from a non-interactive shell. The slot comes
  # first, so time spent waiting for one never counts against the deadline.
  codex_slot run_reviewer "$secs" /bin/sh -c '
    exec codex exec --dangerously-bypass-approvals-and-sandbox \
      -m gpt-6.1-sol -c "model_reasoning_effort=$1" - < "$2"
  ' sol-review "$effort" "$prompt"
}

# Codex slots (#352): a configurable shared concurrency limiter.
# codex_slot <command...> takes one of CODEX_SLOTS (default 5) slots before it
# runs the command, and gives it back when the command ends; run_sol_review
# and the codex function below go through it, so every `codex exec` (or
# `codex e`, or `codex review`) in a shell that sourced this file does. Off: CODEX_SLOTS=off, and the command runs as
# it did before.
#
# The slots live on one lock host, CODEX_SLOT_HOST (default m5), reached over
# ssh; on the lock host itself, the one whose ~/CODEX_SLOT_DIR (default
# .codex-slots) holds a LOCK-HOST file, they are taken there directly. When the
# lock host can't be reached, or has no LOCK-HOST file, this machine's own
# fallback pool grants CODEX_SLOT_FALLBACK (default 1) slots, and the line it
# prints names this machine. That pool is apart from the lock host's, so while
# the two machines can't see each other the login can carry the lock host's 5
# plus this machine's 1; CODEX_SLOT_FALLBACK=0 makes a caller wait for the lock
# host instead. The reviewer README says why 1 is the default, and why the
# marker comes off only once the lock host's slots are drained.
#
# A caller waits for a slot, printing one line when it starts to wait, and
# polls every CODEX_SLOT_POLL seconds (15). A holder heartbeats every
# CODEX_SLOT_BEAT seconds (60). The lock host reclaims a slot whose holder's
# PID is gone (a holder on the lock host) or whose lease is CODEX_SLOT_TTL
# seconds (600) past its last heartbeat (any holder). Each grant, release and
# reclaim is a line in the pool's log file beside its slots.
#
# The holder is one Perl process per command. It reads a pipe that this
# function's subshell and the command inherit, so the slot is held until the
# last of them ends, however it ends (kill -9 included): a killed subshell
# never hands on a slot whose command still runs, and a child the command
# leaves running holds the slot until it ends (Sol r1 on 71fcd5e). Killing the
# holder process itself gives the slot back.
_codex_slot_pl=$(cat <<'PERL'
use strict; use warnings;
use Fcntl qw(:flock);
use File::Path qw(make_path);
use IPC::Open2 qw(open2);
use POSIX qw(strftime);
use Sys::Hostname qw(hostname);
use Time::HiRes qw(time);

sub me { my $n = $ENV{CODEX_SLOT_ME} // hostname(); $n =~ s/\..*//; $n =~ s/[^A-Za-z0-9_-]/-/g; $n }
sub home_path { my $d = shift; $d =~ m{^/} ? $d : "$ENV{HOME}/$d" }
sub start_of { my $p = shift; my $s = `ps -o lstart= -p $p 2>/dev/null`; $s =~ s/^\s+|\s+$//g; $s }
sub alive {
  my ($pid, $start) = @_;
  return 0 unless defined $pid && $pid =~ /^\d+$/ && (kill(0, $pid) || $!{EPERM});
  return !defined $start || $start eq "" || start_of($pid) eq $start;
}
sub note {
  my ($dir, @words) = @_;
  open my $log, ">>", "$dir/log" or return;
  print $log join(" ", strftime("%Y-%m-%dT%H:%M:%SZ", gmtime), @words), "\n";
}
sub slot_names { my $dir = shift; opendir my $d, "$dir/slots" or return (); grep { !/^\./ } readdir $d }
sub read_slot { my %r; open my $h, "<", shift or return %r; while (<$h>) { $r{$1} = $2 if /^(\w+)=(.*)$/ } %r }

# The lock host's side: lock_op <acquire|beat|release> <dir> <needs LOCK-HOST 0|1> <args>.
# acquire and beat take <slots> <ttl> <id> <host> <pid> <label>; release takes <id>.
# Returns (code, message): 0 granted or held, 3 full, 4 a beat whose slot is gone
# with none free, 5 no LOCK-HOST file, 2 anything else.
sub lock_op {
  my ($op, $dir, $marker, @a) = @_;
  $dir = home_path($dir);
  return (5, "not set up") if $marker && !-e "$dir/LOCK-HOST";
  make_path("$dir/slots");
  open my $lock, ">>", "$dir/.lock" or return (2, "no lock file: $!");
  flock($lock, LOCK_EX) or return (2, "no lock: $!");
  if ($op eq "release") {
    note($dir, "release", $a[0]) if unlink "$dir/slots/$a[0]";
    return (0, "released");
  }
  return (2, "unknown operation $op") unless $op eq "acquire" || $op eq "beat";
  my ($slots, $ttl, $id, $host, $pid, $label) = @a;
  my ($me, $now) = (me(), time);
  # This caller's own slot is its own, whatever its age: an acquire whose
  # grant landed but whose answer was lost finds it on the retry (Sol r2).
  my $f = "$dir/slots/$id";
  if (-e $f) { utime(undef, undef, $f); return (0, $op eq "beat" ? "held" : "slot held") }
  for my $name (slot_names($dir)) {
    my $f = "$dir/slots/$name";
    my @st = stat $f or next;
    my %r = read_slot($f);
    my $why = $now - $st[9] > $ttl ? "lease ran out"
      : ($r{host} // "") eq $me && !alive($r{pid}, $r{start}) ? "holder gone" : undef;
    next unless $why;
    unlink $f and note($dir, "reclaim", $name, "host=" . ($r{host} // "?"), "pid=" . ($r{pid} // "?"), "($why)");
  }
  my $n = () = slot_names($dir);
  return ($op eq "beat" ? 4 : 3, "$n/$slots held") if $n >= $slots;
  my $start = $host eq $me ? start_of($pid) : "";
  open my $t, ">", "$dir/slots/.$id" or return (2, "no slot file: $!");
  print $t "host=$host\npid=$pid\nstart=$start\nlabel=$label\n";
  close $t && rename("$dir/slots/.$id", $f) or return (2, "no slot file: $!");
  $n++;
  note($dir, $op eq "beat" ? "regrant" : "grant", $id, "host=$host", "pid=$pid", "label=$label", "$n/$slots");
  return (0, "slot $n/$slots");
}

if (($ARGV[0] // "") eq "lock") {
  shift @ARGV;
  my @r = grep({ !m{^[A-Za-z0-9._:/-]+$} } @ARGV) ? (2, "bad argument") : eval { lock_op(@ARGV) };
  @r = (2, "lock error: $@") unless @r;
  print "$r[1]\n";
  exit $r[0];
}
($ARGV[0] // "") eq "holder" or do { print STDERR "codex-slot: holder or lock\n"; exit 2 };

sub config {
  my %c = (slots => $ENV{CODEX_SLOTS} // 5, host => $ENV{CODEX_SLOT_HOST} // "m5",
    dir => $ENV{CODEX_SLOT_DIR} // ".codex-slots", fallback => $ENV{CODEX_SLOT_FALLBACK} // 1,
    poll => $ENV{CODEX_SLOT_POLL} // 15, beat => $ENV{CODEX_SLOT_BEAT} // 60,
    ttl => $ENV{CODEX_SLOT_TTL} // 600, ssh => $ENV{CODEX_SLOT_SSH} // "ssh",
    label => $ENV{CODEX_SLOT_LABEL} // "codex");
  $c{slots} =~ /^[1-9][0-9]*$/ or return "CODEX_SLOTS must be a whole number above 0, or off, not '$c{slots}'";
  $c{fallback} =~ /^[0-9]+$/ or return "CODEX_SLOT_FALLBACK must be a whole number, not '$c{fallback}'";
  for my $k (qw(poll beat ttl)) {
    $c{$k} =~ /^[0-9]+(\.[0-9]+)?$/ && $c{$k} > 0 or return "CODEX_SLOT_\U$k\E must be seconds above 0, not '$c{$k}'";
  }
  $c{ttl} > 2 * $c{beat} or return "CODEX_SLOT_TTL must be more than twice CODEX_SLOT_BEAT";
  $c{host} =~ /^[A-Za-z0-9_][A-Za-z0-9._@-]*$/ or return "CODEX_SLOT_HOST must be an ssh host name, not '$c{host}'";
  $c{dir} =~ m{^[A-Za-z0-9._/-]+$} or return "CODEX_SLOT_DIR must be a plain path, not '$c{dir}'";
  $c{label} =~ s/[^A-Za-z0-9._:-]/-/g;
  $c{label} = "codex" if $c{label} eq "";
  return \%c;
}

# The lock host over ssh: the lock code goes on ssh's stdin, so the lock host
# needs nothing installed but Perl. 255 is ssh's own failure, or no answer.
sub remote {
  my ($c, $src, @args) = @_;
  my ($out, $in, $pid);
  open my $err, ">&", \*STDERR;
  open STDERR, ">", "/dev/null";
  $pid = eval { open2($out, $in, $c->{ssh}, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
    $c->{host}, join(" ", "perl", "-", "lock", @args)) };
  open STDERR, ">&", $err;
  return (255, "ssh did not start") unless $pid;
  my @lines;
  my $ok = eval {
    local $SIG{ALRM} = sub { die "timeout\n" };
    alarm 60; print $in $src; close $in; @lines = <$out>; alarm 0; 1;
  };
  kill "KILL", $pid unless $ok;
  waitpid($pid, 0);
  my $st = $?;
  my ($msg) = reverse grep { /\S/ } @lines;
  chomp($msg //= "");
  return (255, "no answer") if !$ok || $st & 127;
  return ($st >> 8, $msg);
}
sub local_op { my @r = eval { lock_op(@_) }; @r ? @r : (2, "lock error: $@") }

# gone <seconds>: waits that long, true as soon as the caller's pipe closes.
sub gone {
  my $end = time + shift;
  while ((my $left = $end - time) > 0) {
    my $r = ""; vec($r, fileno(STDIN), 1) = 1;
    my $n = select($r, undef, undef, $left);
    next if $n < 0;
    return 0 if $n == 0;
    my $got = sysread(STDIN, my $buf, 64);
    return 1 if defined $got ? $got == 0 : !$!{EINTR};
  }
  return 0;
}

$SIG{PIPE} = "IGNORE";
my $c = config();
ref $c or do { print STDERR "codex-slot: $c\n"; exit 2 };
my $src = do { local $/; open my $f, "<", $0 or die "codex-slot: can't read $0\n"; <$f> };
my $me = me();
my $id = join "-", $me, $$, int(time), int(rand(1e6));
my $on_host = -e home_path($c->{dir}) . "/LOCK-HOST";
my $primary = sub { $on_host ? local_op($_[0], $c->{dir}, 1, @_[1 .. $#_]) : remote($c, $src, $_[0], $c->{dir}, 1, @_[1 .. $#_]) };
my $fallback = sub { local_op($_[0], "$c->{dir}/fallback", 0, @_[1 .. $#_]) };
my @tail = ($c->{ttl}, $id, $me, $$, $c->{label});
my ($use, @who, $release, $said);
for my $s (qw(INT TERM HUP)) { $SIG{$s} = sub { $release->() if $release; exit 1 } }
while (1) {
  my ($rc, $msg) = $primary->("acquire", $c->{slots}, @tail);
  if ($rc == 0) { ($use, @who) = ($primary, $c->{slots}, @tail); last }
  my $why;
  if ($rc == 3) { $why = "$msg on $c->{host}" }
  else {
    my $what = $rc == 5 ? "is not set up (no LOCK-HOST file)" : $rc == 255 ? "unreachable" : "failed ($msg)";
    if ($on_host || !$c->{fallback}) { $why = "lock host $c->{host} $what, no fallback" }
    else {
      my ($frc, $fmsg) = $fallback->("acquire", $c->{fallback}, @tail);
      if ($frc == 0) {
        print STDERR "codex-slot: lock host $c->{host} $what; fallback lock host $me granted $fmsg\n";
        ($use, @who) = ($fallback, $c->{fallback}, @tail);
        last;
      }
      $why = "lock host $c->{host} $what; fallback lock host $me: $fmsg";
    }
  }
  print STDERR "codex-slot: waiting for a Codex slot ($why)\n" unless $said++;
  exit 0 if gone($c->{poll});
}
$release = sub { my $u = $use; $release = undef; $u->("release", $id) };
# Never close fd 0, 1 or 2: a pipe opened later would take the number, and
# a child would read or write the wrong thing.
syswrite STDOUT, "go\n";
open STDOUT, ">", "/dev/null";
my $lost;
until (gone($c->{beat})) {
  my ($rc) = $use->("beat", @who);
  print STDERR "codex-slot: this run's slot was reclaimed and all are taken; the run carries on\n" if $rc == 4 && !$lost++;
}
$release->() if $release;
exit 0;
PERL
)

codex_slot() {
  [ "$#" -gt 0 ] || { echo 'codex_slot: no command to run' >&2; return 2; }
  if [ "${CODEX_SLOTS-}" = off ] || [ -n "${CODEX_SLOT_HELD-}" ]; then "$@"; return; fi
  (
    gate=$(mktemp -d) && mkfifo "$gate/hold" "$gate/go" \
      && printf '%s\n' "$_codex_slot_pl" > "$gate/slot.pl" \
      || { echo 'codex_slot: no scratch directory, so no slot' >&2; exit 125; }
    perl "$gate/slot.pl" holder < "$gate/hold" > "$gate/go" &
    holder=$!
    exec 8> "$gate/hold"
    IFS= read -r said < "$gate/go" || said=
    rm -rf "$gate"
    if [ "$said" != go ]; then
      exec 8>&-
      wait "$holder" && rc=2 || rc=$?
      exit "$rc"
    fi
    # Under a caller's set -e a failing command ends this subshell here, which
    # closes its end of the pipe, so the slot still goes back. No wait for the
    # holder: a child the command left running keeps the slot, not the caller.
    export CODEX_SLOT_HELD=1
    "$@"
    rc=$?
    exec 8>&-
    exit "$rc"
  )
}

# Every non-interactive Codex session through a slot: exec, its alias e, and
# review, wherever they sit among the arguments, so options before the
# subcommand count too (Sol r2). A stray word that matches only makes the
# command wait for a slot. Every other codex command runs as it was.
codex() {
  local arg
  for arg in "$@"; do
    case $arg in exec|e|review) codex_slot command codex "$@"; return ;; esac
  done
  command codex "$@"
}
