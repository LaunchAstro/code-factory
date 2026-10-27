// SPDX-License-Identifier: AGPL-3.0-only
// Whether this module is the file node was asked to run: the kit's one guard,
// so a copy of `orchestration/` needs nothing from `template/`. The template
// keeps its own copy (template/scripts/main-module.mjs), which says why each
// rule is here: both sides are compared as real paths, so a symlinked entry
// still runs; there is no entry file under --eval, --print or a pipe; and a
// path that cannot be resolved throws rather than answering false.

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const entry = () => {
  const evaluated = process.execArgv.some(
    (flag) =>
      ["-e", "-p", "-pe", "-ep", "--eval", "--print"].includes(flag) ||
      flag.startsWith("--eval=") ||
      flag.startsWith("--print="),
  );
  const first = process.argv[1];
  if (evaluated || !first || first === "-") return undefined;
  return first;
};

const real = (path) => {
  const absolute = resolve(path);
  try {
    return pathToFileURL(realpathSync(absolute)).href;
  } catch (cause) {
    throw new Error(`the main-module guard cannot resolve ${absolute}`, { cause });
  }
};

/** True when `url` (pass `import.meta.url`) names the module node was invoked with. Throws when a path cannot be resolved. */
export const isMainModule = (url) => {
  const invoked = entry();
  return invoked !== undefined && real(fileURLToPath(url)) === real(invoked);
};
