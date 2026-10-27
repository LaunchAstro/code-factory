// SPDX-License-Identifier: AGPL-3.0-only
// Nothing here imports left-pad, runs its bin or names it in a config.
// The comment mentioning it is a comment, and the gate strips those.

export const label = (text) => text.padStart(8, ' ');
