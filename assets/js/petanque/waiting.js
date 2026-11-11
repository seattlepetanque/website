// Waiting spots (E02, pure geometry): where the players who are not throwing stand. Each side of the court, outside
// the timbers, has two zones: just beyond the cochonnet and just behind the circle, a few slots each, WAIT_SPACING
// apart. A returning player takes the nearest free slot on the nearer side. Slots follow the cochonnet, but people
// only move when they next return, so occupied spots are judged by where people stand (or are heading).
import { courtGeo } from './court.js';

export const WAIT_SPACING = 0.8; // m between slots in a zone
export const WAIT_PER_ZONE = 3;
export const WAIT_GAP = 0.6; // a slot with somebody this close is taken
const SIDE_OUT = 1.0; // m outside the string line (clear of the timbers)

// Every slot for a jack at { x, y } (or none: a mid-court default): [{ x, y, side: -1 | 1, zone: 'jack' | 'circle' }]
export function waitingSlots(jack, c = courtGeo()) {
  const dir = c.dir ?? 1; // E10: the circle moves, and play runs toward y = 0 or y = terrainL
  const jy = jack && Number.isFinite(jack.y) ? jack.y : c.circle.y + dir * (c.jackMinDist + c.jackMaxDist) / 2;
  const out = [];
  for (const side of [-1, 1]) {
    const x = side < 0 ? -SIDE_OUT : c.terrainW + SIDE_OUT;
    for (let k = 0; k < WAIT_PER_ZONE; k++) {
      out.push({ x, y: dir > 0 ? Math.min(jy + 0.8 + k * WAIT_SPACING, c.terrainL + 0.5) : Math.max(jy - 0.8 - k * WAIT_SPACING, -0.5), side, zone: 'jack' });
      out.push({ x, y: c.circle.y - dir * (0.6 + k * WAIT_SPACING), side, zone: 'circle' });
    }
  }
  return out;
}

// The slot a person at `pos` takes: nearest free slot on the nearer side (the other side when that one is full).
// `occupied` is a list of { x, y } (other people's spots); null when everything is taken.
export function pickWaitingSlot(pos, jack, occupied = [], c = courtGeo()) {
  const free = waitingSlots(jack, c).filter((s) => !occupied.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < WAIT_GAP));
  const nearer = pos.x < c.terrainW / 2 ? -1 : 1;
  const d = (s) => Math.hypot(s.x - pos.x, s.y - pos.y);
  const best = (list) => list.reduce((a, s) => (!a || d(s) < d(a) ? s : a), null);
  return best(free.filter((s) => s.side === nearer)) || best(free);
}
