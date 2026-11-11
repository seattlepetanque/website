// F64: sailboats wandering the lake. Pure logic (no three.js): createSailFleet(seed, { cx, count }) -> { boats, step(dt, avoid) }.
// Coordinates are world metres (x includes the court centre cx). lakeDepth mirrors the shore in scenery.js's shader.
import { mulberry32 } from './rng.js';

export const LAKE_SHAPE = { cy: 98, ax: 65, ay: 55 };

// Metres inside the irregular elliptical shore (negative outside). Same formula as the lake shader.
export function lakeDepth(x, y, cx) {
  const qx = (x - cx) / LAKE_SHAPE.ax, qy = (y - LAKE_SHAPE.cy) / LAKE_SHAPE.ay;
  const r = Math.sqrt(qx * qx + qy * qy) + 0.035 * Math.sin(x * 0.06 + 1.0) + 0.03 * Math.sin(y * 0.11 + 2.3) + 0.015 * Math.sin(x * 0.23 + y * 0.17);
  return (1 - r) * 45;
}

export const SAIL = { margin: 9, waypointMargin: 16, minSpeed: 1, maxSpeed: 3, maxTurn: 0.4, reach: 7, avoidR: 40, spacing: 14 };

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function createSailFleet(seed, { cx = 0, count = 4, margin = SAIL.margin } = {}) {
  const rand = mulberry32(seed * 7919 + 13);
  const inside = (x, y, m) => lakeDepth(x, y, cx) >= m;
  const pickPoint = (out, m) => {
    for (let i = 0; i < 200; i++) {
      const x = cx + (rand() * 2 - 1) * LAKE_SHAPE.ax, y = LAKE_SHAPE.cy + (rand() * 2 - 1) * LAKE_SHAPE.ay;
      if (inside(x, y, m)) { out.x = x; out.y = y; return; }
    }
    out.x = cx; out.y = LAKE_SHAPE.cy;
  };
  const boats = [];
  const tmp = { x: 0, y: 0 };
  for (let i = 0; i < count; i++) {
    const b = { x: 0, y: 0, heading: rand() * Math.PI * 2, speed: 0, turnRate: 0, cruise: 1.2 + rand() * 1.6, wx: 0, wy: 0, tackT: 4 + rand() * 12, tackSide: 0, tackLeft: 0, phase: rand() * 6.28, kind: i };
    for (let k = 0; k < 100; k++) { // spread out: not within spacing of an earlier boat
      pickPoint(tmp, SAIL.waypointMargin);
      if (boats.every((o) => Math.hypot(o.x - tmp.x, o.y - tmp.y) > SAIL.spacing * 2)) break;
    }
    b.x = tmp.x; b.y = tmp.y; b.speed = b.cruise;
    pickPoint(tmp, SAIL.waypointMargin); b.wx = tmp.x; b.wy = tmp.y;
    boats.push(b);
  }

  // avoid: null, or { x, y, r } (a zone to keep clear of, e.g. the floatplane on the water)
  function step(dt, avoid) {
    if (!(dt > 0)) return;
    if (dt > 0.25) { const n = Math.ceil(dt / 0.25); for (let i = 0; i < n; i++) step(dt / n, avoid); return; }
    for (let i = 0; i < boats.length; i++) {
      const b = boats[i];
      if (Math.hypot(b.wx - b.x, b.wy - b.y) < SAIL.reach) { pickPoint(tmp, SAIL.waypointMargin); b.wx = tmp.x; b.wy = tmp.y; b.cruise = 1.2 + rand() * 1.6; }
      let want = Math.atan2(b.wy - b.y, b.wx - b.x), speedWant = b.cruise;
      // occasional tacks: for a spell, zig-zag about the bearing to the waypoint
      b.tackT -= dt;
      if (b.tackT <= 0) { if (b.tackLeft <= 0) { b.tackLeft = 5 + rand() * 6; b.tackSide = rand() < 0.5 ? -1 : 1; } b.tackT = 6 + rand() * 6; if (b.tackLeft > 0) b.tackSide = -b.tackSide; }
      if (b.tackLeft > 0) { b.tackLeft -= dt; want += b.tackSide * 0.7; }
      // look ahead: if the point ~5 s ahead leaves the safe water, head for the lake centre
      const la = Math.max(12, b.speed * 6);
      if (!inside(b.x + Math.cos(b.heading) * la, b.y + Math.sin(b.heading) * la, margin + 4) || !inside(b.x, b.y, margin + 4)) {
        want = Math.atan2(LAKE_SHAPE.cy - b.y, cx - b.x);
      }
      let hold = false;
      if (avoid) {
        const dx = b.x - avoid.x, dy = b.y - avoid.y, d = Math.hypot(dx, dy);
        if (d < avoid.r + 12) {
          const away = Math.atan2(dy, dx);
          if (d < avoid.r) { want = away; speedWant = SAIL.maxSpeed; } // flee at once
          else if (Math.abs(wrap(Math.atan2(-dy, -dx) - b.heading)) < 1.4) { want = away; hold = true; } // heading toward it: turn away, hold
        }
      }
      const dh = wrap(want - b.heading), turn = Math.max(-SAIL.maxTurn * dt, Math.min(SAIL.maxTurn * dt, dh));
      b.heading = wrap(b.heading + turn); b.turnRate = turn / dt;
      const sp = hold ? 0 : speedWant * (1 - 0.5 * Math.min(1, Math.abs(dh))) ;
      b.speed += (Math.max(hold ? 0 : SAIL.minSpeed * 0.6, sp) - b.speed) * Math.min(1, dt * 0.8);
      const nx = b.x + Math.cos(b.heading) * b.speed * dt, ny = b.y + Math.sin(b.heading) * b.speed * dt;
      let ok = lakeDepth(nx, ny, cx) >= margin - 3;
      if (ok && avoid && Math.hypot(nx - avoid.x, ny - avoid.y) < avoid.r && Math.hypot(nx - avoid.x, ny - avoid.y) < Math.hypot(b.x - avoid.x, b.y - avoid.y)) ok = false;
      if (ok) for (let j = 0; j < boats.length; j++) if (j !== i && Math.hypot(boats[j].x - nx, boats[j].y - ny) < SAIL.spacing && Math.hypot(boats[j].x - nx, boats[j].y - ny) < Math.hypot(boats[j].x - b.x, boats[j].y - b.y)) { ok = false; break; }
      if (ok) { b.x = nx; b.y = ny; } else b.speed *= 0.5;
    }
  }
  return { boats, step };
}
