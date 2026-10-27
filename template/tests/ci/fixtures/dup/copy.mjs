// SPDX-License-Identifier: AGPL-3.0-only
// A fixture. The same block as original.mjs, indented further and given a
// different comment, which is how a copy usually arrives.

const seating = () => {
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
};
