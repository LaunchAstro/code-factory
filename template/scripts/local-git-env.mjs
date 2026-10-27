// SPDX-License-Identifier: AGPL-3.0-only
// The environment a gate's local Git reads run in: what Git needs to find
// itself, its configuration and a temporary directory, and nothing else.
//
// The list is in main-module.mjs, which every script, and every copy of
// one, already has beside it, so the run record's Git reads use it too.

import { localGitEnv } from './main-module.mjs';

/**
 * Removes every other variable from this process's environment, so every
 * child it starts afterwards inherits only these, whichever module starts it.
 * A gate calls it once it has read its own inputs.
 */
export function keepOnlyLocalGitEnv() {
  const kept = localGitEnv();
  for (const name of Object.keys(process.env)) {
    if (!Object.hasOwn(kept, name)) delete process.env[name];
  }
}
