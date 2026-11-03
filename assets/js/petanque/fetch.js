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

// ---- E02: routes round the outside of the timbers ----
const ROUTE_MARGIN = 0.3; // m the walking ring lies outside the timbers
const crossesField = (a, b, c) => {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05));
  for (let i = 0; i <= n; i++) {
    const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
    if (x > 0 && x < c.terrainW && y > 0 && y < c.terrainL) return true;
  }
  return false;
};
// Waypoints that take a walker from `from` to `to` round the outside of the timbers when the straight line would
// cross the field of play: out to the ring that lies ROUTE_MARGIN beyond the timbers, along it by the shorter way
// (via its corners), and back in. [] when the direct line is already clear.
export function outsideWaypoints(from, to, c = C) {
  if (!crossesField(from, to, c)) return [];
  const o = c.lumberGap + c.lumberSize + ROUTE_MARGIN;
  const x0 = -o, y0 = -o, x1 = c.terrainW + o, y1 = c.terrainL + o;
  // nearest point on the ring's boundary (inside points are pushed out to the nearest edge)
  const onRing = (p) => {
    if (p.x <= x0 || p.x >= x1 || p.y <= y0 || p.y >= y1) return { x: Math.min(x1, Math.max(x0, p.x)), y: Math.min(y1, Math.max(y0, p.y)) };
    const d = [p.x - x0, x1 - p.x, p.y - y0, y1 - p.y], m = Math.min(...d), i = d.indexOf(m);
    return i === 0 ? { x: x0, y: p.y } : i === 1 ? { x: x1, y: p.y } : i === 2 ? { x: p.x, y: y0 } : { x: p.x, y: y1 };
  };
  // position along the ring perimeter, counter-clockwise from (x0, y0)
  const W = x1 - x0, H = y1 - y0, P = 2 * (W + H);
  const along = (p) => {
    if (Math.abs(p.y - y0) < 1e-6) return p.x - x0;
    if (Math.abs(p.x - x1) < 1e-6) return W + (p.y - y0);
    if (Math.abs(p.y - y1) < 1e-6) return W + H + (x1 - p.x);
    return 2 * W + H + (y1 - p.y);
  };
  const a = onRing(from), b = onRing(to), sa = along(a), sb = along(b);
  const corners = [0, W, W + H, 2 * W + H].map((s, i) => ({ s, x: [x0, x1, x1, x0][i], y: [y0, y0, y1, y1][i] }));
  const fwd = (sb - sa + P) % P; // counter-clockwise distance
  const ccw = fwd <= P / 2;
  const pts = [a];
  const between = corners.filter((k) => { const d = ccw ? (k.s - sa + P) % P : (sa - k.s + P) % P; return d > 1e-6 && d < (ccw ? fwd : P - fwd) - 1e-6; });
  between.sort((p, q) => { const f = (k) => (ccw ? (k.s - sa + P) % P : (sa - k.s + P) % P); return f(p) - f(q); });
  pts.push(...between.map((k) => ({ x: k.x, y: k.y })), b);
  return pts;
};
// planPath, optionally routed round the outside of the timbers (opts.outside)
export function planRoute(from, to, obstacles = [], opts = {}) {
  const c = opts.c || C;
  const way = opts.outside ? outsideWaypoints(from, to, c) : [];
  const out = [];
  let cur = from;
  for (const q of [...way, to]) {
    const leg = planPath(cur, q, obstacles, opts);
    out.push(...leg.filter((p, i) => i > 0 || out.length === 0 || Math.hypot(p.x - cur.x, p.y - cur.y) > 1e-3 || p.lift > 1));
    cur = q;
  }
  return out;
}
