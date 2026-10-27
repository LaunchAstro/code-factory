// SPDX-License-Identifier: AGPL-3.0-only
// A fixture with nothing in common with its neighbours.

export function describeRoom(room) {
  const parts = [];
  if (room.name) parts.push(room.name);
  if (room.floor !== undefined) parts.push(`floor ${room.floor}`);
  if (room.capacity !== undefined) parts.push(`${room.capacity} seats`);
  if (room.closed) parts.push('closed');
  return parts.join(', ');
}
