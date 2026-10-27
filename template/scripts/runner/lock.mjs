// SPDX-License-Identifier: AGPL-3.0-only
// One runner at a time on each file it decides from.
//
// Every decision here is a read and then a write: count the launches, then
// append one; read the budget, then take one off it. Two runners that both
// read before either writes both get the last slot, and Sol's review CF-03
// found exactly that on the budget and on the per-pull-request count. The
// lock is a file created with O_EXCL, which one process wins and every other
// waits on.
//
// A lock left by a runner that died is not broken here. Breaking one safely
// needs knowing the holder is gone, and guessing wrong is the race again, so
// the wait ends in a refusal that names the file for a person to remove.

import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const WAIT_MS = 60_000;
const nap = new Int32Array(new SharedArrayBuffer(4));
// What the check under the lock saw of each file whose lock this process holds.
const held = new Map();

/**
 * A refusal this runner wrote: the file, and why in its own words. The runner
 * prints these and no other caught message, which can quote what was read
 * (CF-08-F3).
 */
export class Refusal extends Error {
  constructor(file, reason) {
    super(`${file}: ${reason}`);
    this.file = file;
    this.reason = reason;
  }
}

/**
 * Refuse a file the runner could reach by a second name: a symlink at it, or
 * at any directory between the config root and it, or a second hard link. A
 * second name took a second lock, and resolving the name once at the lock was
 * not enough: the action read through the name it was given, and a symlink
 * retargeted after the lock pointed it at another file (Sol, CF-03-FIX1 and
 * CF-03-FIX2). A file with one name has one lock. Directories above what the
 * path shares with the root are the machine's (on macOS `/var` is a symlink),
 * and a lock made there by any of their spellings is the same file. Gives back
 * what it saw of the file, or nothing when there is no file yet.
 */
export function assertPlain(root, path) {
  let base = root;
  while (relative(base, path).split(sep)[0] === '..') base = dirname(base);
  let at = base;
  let stat;
  for (const part of relative(base, path).split(sep)) {
    at = join(at, part);
    stat = lstatSync(at, { throwIfNoEntry: false });
    if (stat === undefined) return stat;
    if (stat.isSymbolicLink()) throw new Refusal(path, `is reached through the symlink ${at}`);
    if (stat.isFile() && stat.nlink > 1)
      throw new Refusal(path, 'has another name (a hard link); one file takes one lock');
  }
  return stat;
}

const changed = (path) => new Refusal(path, 'changed while it was used; one file takes one lock');

// `path`, whose lock this process holds, opened without following a link and
// only as the file the check under the lock saw (device, inode, a file, one
// name). Used by name, a file replaced by a symlink after the check let two
// runners spend one budget's last slot (Sol, CF-03-FIX3), and one pull
// request's through its status table (security review, 75146a0).
function openLocked(path, flags) {
  if (!held.has(path)) throw new Refusal(path, 'is used only under its lock');
  const seen = held.get(path);
  let fd;
  try {
    fd = openSync(path, flags | constants.O_NOFOLLOW);
  } catch {
    throw changed(path);
  }
  const open = fstatSync(fd);
  const same = seen?.isFile() && open.isFile() && open.dev === seen.dev && open.ino === seen.ino;
  if (same && open.nlink === 1) return fd;
  closeSync(fd);
  throw changed(path);
}

/** The text of `path`, read by name and through `openLocked`, the same bytes or refused. */
export function readLocked(path) {
  const byName = readFileSync(path);
  const fd = openLocked(path, constants.O_RDONLY);
  try {
    if (!readFileSync(fd).equals(byName)) throw changed(path);
    return byName.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** Append `text` to `path`, whose lock this process holds, through `openLocked`. */
export function appendLocked(path, text) {
  const fd = openLocked(path, constants.O_WRONLY | constants.O_APPEND);
  try {
    appendFileSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

/**
 * Run `action` holding the lock on `path`, and give back what it returns. The
 * caller has passed `path` through `assertPlain`; it is checked again once the
 * lock is held, because a name can change while a lock is waited for, and
 * `readLocked` and `appendLocked` use the file that check saw.
 */
export function withLock(root, path, action) {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      writeFileSync(lock, `${process.pid}\n`, { flag: 'wx' });
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() > deadline)
        throw new Refusal(
          lock,
          `has been held for ${WAIT_MS / 1000}s; if no runner is running, remove it`,
        );
      Atomics.wait(nap, 0, 0, 20);
    }
  }
  try {
    held.set(path, assertPlain(root, path));
    return action();
  } finally {
    held.delete(path);
    rmSync(lock, { force: true });
  }
}
