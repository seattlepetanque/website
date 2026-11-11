// Walking paths for fetching (D11): pure geometry, no three.js. A path is a list of waypoints { x, y, lift } where
// lift > 1 marks a leg that steps over a timber of the lumber surround. Live boules in the way are stepped around.
import { C } from './constants.js';

const STEP_LIFT = 2.6; // foot lift multiplier of a step-over leg (character.walkPose)
const STEP_MARGIN = 0.38; // m before and after the timber where the high step begins and ends

// Lumber ring: the inner face is lumberGap outside the string lines, the outer face one timber width further
export function lumberRects(c = C) {
  const g = c.lumberGap, o = g + c.lumberSize;
  return {
    inner: { x0: -g, y0: -g, x1: c.terrainW + g, y1: c.terrainL + g },
    outer: { x0: -o, y0: -o, x1: c.terrainW + o, y1: c.terrainL + o },
  };
}
const inRect = (r, x, y) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
// 0 outside the timbers, 1 on them (between the faces), 2 inside the surround
export function zoneOf(x, y, c = C) {
  const { inner, outer } = lumberRects(c);
  return inRect(inner, x, y) ? 2 : inRect(outer, x, y) ? 1 : 0;
}

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

// Route from `from` to `to` around obstacles [{ x, y }] (keep `clearance` metres from each; an obstacle already within
// clearance of the end point is ignored), then add step-over legs where the route crosses the timbers.
export function planPath(from, to, obstacles = [], { clearance = 0.32, c = C } = {}) {
  let pts = [{ x: from.x, y: from.y }, { x: to.x, y: to.y }];
  const used = new Set();
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (let i = 0; i < pts.length - 1 && !changed; i++) {
      const a = pts[i], b = pts[i + 1];
      for (let k = 0; k < obstacles.length; k++) {
        const o = obstacles[k];
        if (used.has(k)) continue;
        if (Math.hypot(o.x - to.x, o.y - to.y) < clearance + 0.05 || Math.hypot(o.x - from.x, o.y - from.y) < clearance * 0.8) { used.add(k); continue; }
        if (distToSegment(o.x, o.y, a, b) >= clearance) continue;
        // go round on the side away from the ball: perpendicular to the leg, clearance + margin from the ball
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        const sgn = (dx * (o.y - a.y) - dy * (o.x - a.x)) > 0 ? 1 : -1; // ball left of the leg: pass on its right
        const r = clearance + 0.12;
        pts.splice(i + 1, 0, { x: o.x + sgn * (dy / l) * r, y: o.y - sgn * (dx / l) * r });
        used.add(k); changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  // timbers: sample each leg; a run of samples on the timber becomes a lifted leg with a margin either side
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(L / 0.02));
    let run = null;
    const runs = [];
    for (let s = 0; s <= n; s++) {
      const t = s / n, on = zoneOf(a.x + dx * t, a.y + dy * t, c) === 1;
      if (on && !run) run = { s0: t * L, s1: t * L };
      if (on) run.s1 = t * L;
      if (!on && run) { runs.push(run); run = null; }
    }
    if (run) runs.push(run);
    const at = (d) => ({ x: a.x + dx / (L || 1) * d, y: a.y + dy / (L || 1) * d });
    let cursor = 0;
    for (const r of runs) {
      const s0 = Math.max(cursor, r.s0 - STEP_MARGIN), s1 = Math.min(L, r.s1 + STEP_MARGIN);
      if (s0 > cursor + 0.05) out.push({ ...at(s0), lift: 1 });
      out.push({ ...at(s1), lift: STEP_LIFT });
      cursor = s1;
    }
    out.push({ x: b.x, y: b.y, lift: 1 });
  }
  return out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1].x, p.y - out[i - 1].y) > 1e-3 || p.lift > 1);
}

export const pathLength = (from, path) => {
  let d = 0, p = from;
  for (const q of path) { d += Math.hypot(q.x - p.x, q.y - p.y); p = q; }
  return d;
};

// Where a fetcher stands to pick a ball up: `reach` (the bent right hand's offset in the character's frame) lands on
// the ball. Approaching from `from`, so the character faces along the final leg.
export function standPoint(ball, from, reach) {
  const yaw = Math.atan2(ball.x - from.x, ball.y - from.y);
  // hand offset (reach.x right, reach.y ahead) rotated by yaw; stand where hand = ball
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const hx = reach.x * c + reach.y * s, hy = -reach.x * s + reach.y * c;
  return { x: ball.x - hx, y: ball.y - hy, yaw };
}
