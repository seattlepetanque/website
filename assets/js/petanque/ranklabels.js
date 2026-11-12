// F91: rank labels for the overhead view. Pure: ordering of the live boules by surface gap to the jack, and
// a badge layout (beside each boule, radially away from the jack, turned aside when taken). No three.js here.
import { gapM } from './rules.js';

// bodies: world bodies. Returns [{ id, team, x, y, z, r, rank, gap }] closest first (dead boules and the jack are skipped).
export function rankBoules(bodies) {
  const jack = (bodies || []).find((b) => b.kind === 'jack' && !b.dead);
  if (!jack) return [];
  return bodies
    .filter((b) => b.kind === 'boule' && !b.dead)
    .map((b) => ({ id: b.id, team: b.team, x: b.x, y: b.y, z: b.z || 0, r: b.r ?? 0.037, gap: gapM(jack, b) }))
    .sort((a, b) => a.gap - b.gap)
    .map((b, i) => ({ ...b, rank: i + 1 }));
}

// Badge centres of radius br (m): for each ranked item the first free spot on the ring round its boule, starting
// straight away from the jack; the roomiest spot when none is free. Returns [{ id, x, y }] in the item order.
export function layoutBadges(items, jack, br) {
  const taken = [];
  if (jack) taken.push({ x: jack.x, y: jack.y, r: (jack.r ?? 0.015) + 0.01 });
  for (const q of items) taken.push({ x: q.x, y: q.y, r: q.r + 0.005, id: q.id });
  const out = [];
  for (const it of items) {
    const away = jack ? Math.atan2(it.y - jack.y, it.x - jack.x) : Math.PI / 2;
    let best = null, bm = -Infinity;
    // two rings: snug first, then further out for crowded clusters
    for (const d of [it.r + br + 0.008, it.r + 2.2 * br]) {
      for (let k = 0; k < 12; k++) {
        const ang = away + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 6;
        const x = it.x + Math.cos(ang) * d, y = it.y + Math.sin(ang) * d;
        let m = Infinity;
        for (const q of taken) if (q.id !== it.id) m = Math.min(m, Math.hypot(x - q.x, y - q.y) - q.r - br);
        for (const q of out) m = Math.min(m, Math.hypot(x - q.x, y - q.y) - 2 * br);
        const s = m - k * 0.004 - (d > it.r + br + 0.01 ? 0.01 : 0);
        if (s > bm) { bm = s; best = { id: it.id, x, y, free: m >= 0 }; }
        if (m >= 0 && k === 0) break;
      }
      if (best && best.free) break;
    }
    out.push({ id: best.id, x: best.x, y: best.y });
  }
  return out;
}
