// Standard error as a pipe a write to it fails on, for the cases that prove a
// refusal still arrives whole, and with its exit code (#316). No test here.
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A FIFO with both ends open, so a reader exists when the writer opens.
function fifo(t) {
  const dir = mkdtempSync(join(tmpdir(), "stderr-pipe-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "stderr.fifo");
  spawnSync("mkfifo", [path]);
  const reader = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  return { dir, reader, writer: openSync(path, constants.O_WRONLY | constants.O_NONBLOCK) };
}

/** A pipe whose reader has gone: every write to it fails with EPIPE. */
export function closedPipe(t) {
  const { reader, writer } = fifo(t);
  closeSync(reader);
  t.after(() => closeSync(writer));
  return writer;
}

// Loaded into the child: the first write to fd 2 that fails tells the case on
// fd 3, then fails as it would have.
const TELL = `const fs = require("node:fs");
const write = fs.writeSync;
let told = false;
fs.writeSync = function (fd, ...rest) {
  try {
    return write.call(this, fd, ...rest);
  } catch (error) {
    if (fd === 2 && !told) { told = true; write(3, "failed\\n"); }
    throw error;
  }
};
require("node:module").syncBuiltinESMExports();
`;

// Node's spawn makes a child's stdio blocking, so python3 makes fd 2
// non-blocking again, as Node makes its own stdio pipes, then runs node.
const NONBLOCK = "import os, sys; os.set_blocking(2, False); os.execv(sys.argv[1], sys.argv[1:])";

/**
 * Run `node args` with standard error a full, non-blocking pipe. The pipe is
 * drained only once the child's first write to it has failed, and again when
 * the child exits. Resolves to the exit status and the bytes the child wrote
 * to standard error.
 */
export function fullPipe(t, args, options = {}) {
  const { dir, reader, writer } = fifo(t);
  const chunk = Buffer.alloc(4096, "x");
  let filled = 0;
  for (const size of [4096, 1]) {
    for (;;) {
      try {
        filled += writeSync(writer, chunk, 0, size);
      } catch (error) {
        if (error.code !== "EAGAIN") throw error;
        break;
      }
    }
  }
  const tell = join(dir, "tell.cjs");
  writeFileSync(tell, TELL);
  const child = spawn("python3", ["-I", "-c", NONBLOCK, process.execPath, "--require", tell, ...args], {
    ...options,
    stdio: ["ignore", "ignore", writer, "pipe"],
  });
  closeSync(writer);
  const read = [];
  const drain = () => {
    const buffer = Buffer.alloc(65536);
    for (;;) {
      let n;
      try {
        n = readSync(reader, buffer);
      } catch (error) {
        if (error.code === "EAGAIN") return;
        throw error;
      }
      if (n === 0) return;
      read.push(Buffer.from(buffer.subarray(0, n)));
    }
  };
  child.stdio[3].on("data", drain);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status) => {
      drain();
      closeSync(reader);
      resolve({ status, stderr: Buffer.concat(read).subarray(filled).toString() });
    });
  });
}
