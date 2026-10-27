// SPDX-License-Identifier: AGPL-3.0-only
// A fixture, not a module anything runs. The twelve lines below are the
// block copy.mjs carries a second time.

export function rankSeats(seats, capacity) {
  const ranked = [];
  for (const seat of seats) {
    if (seat.rows < 1) continue;
    const width = seat.rows * seat.columns;
    const spare = capacity - width;
    if (spare < 0) continue;
    ranked.push({ id: seat.id, width, spare });
  }
  ranked.sort((a, b) => a.spare - b.spare);
  return ranked;
}
