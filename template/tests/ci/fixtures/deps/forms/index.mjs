// SPDX-License-Identifier: AGPL-3.0-only
// A fixture holding every shape an import takes, and two that only look like
// one. This line is a comment: import pad from 'not-a-package';

import pad from 'left-pad';
import 'side-effect-only';
import { readFileSync } from 'node:fs';
import { local } from './local.mjs';

const lazy = require('lazy-dep');
const note = 'the phrase taken from left-pad is prose, and this is not an import';

export const label = (text) => [pad(text, 8), lazy, local, readFileSync, note].join('');
