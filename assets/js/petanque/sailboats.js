// F65: a very simple sailing simulation for the lake sailboats. Pure logic (no three.js):
// createSailFleet(seed, { cx, count }) -> { boats, wind, step(dt, avoid) }. World metres (x includes the court centre cx).
// Angles are maths angles in the x/y plane (heading = atan2(dy, dx)). Wind is described by `wind.from`, the direction the
// wind blows FROM. rel = wrap(wind.from - heading): 0 is head to wind, sign(rel) > 0 means the wind comes over the boat's
// left (port) side, so the boom is out to the right and the boat heels right (leeward).
// Model: slowly shifting wind (+-25 deg, gusts +-30 %), a polar speed curve (zero in the ~40 deg no-go zone, best on a
// beam reach, a bit lower dead downwind) with a first-order speed lag (so a tack through the wind costs speed), a smooth
// heading controller, and a course helmsman: reach straight to the mark; beat to windward by tacking (close-hauled legs
// alternating either side of the rhumb line); run downwind in jibing zig-zags; turn away from the shore by tacking or
// bearing away. Boats keep clear of each other and of an optional avoid circle (the floatplane).
//
// Per boat outputs: x, y, heading, speed, turnRate, heel (rad, + = heel to the right; leeward), sail (rad, boom/main
// angle from the centreline, + = out to the right), jib (jib sheet angle), tacks, jibes.
import { mulberry32 } from './rng.js';

export const LAKE_SHAPE = { cy: 98, ax: 65, ay: 55 };

// Metres inside the irregular elliptical shore (negative outside). Same formula as the lake shader.
export function lakeDepth(x, y, cx) {
  const qx = (x - cx) / LAKE_SHAPE.ax, qy = (y - LAKE_SHAPE.cy) / LAKE_SHAPE.ay;
  const r = Math.sqrt(qx * qx + qy * qy) + 0.035 * Math.sin(x * 0.06 + 1.0) + 0.03 * Math.sin(y * 0.11 + 2.3) + 0.015 * Math.sin(x * 0.23 + y * 0.17);
  return (1 - r) * 45;
}

const D = Math.PI / 180;
export const SAIL = {
  margin: 9, waypointMargin: 16, reach: 8, avoidR: 40, spacing: 5.5, hardSpacing: 3.5,
  noGo: 40 * D, closeHaul: 46 * D, runAngle: 148 * D, // no-go half angle; close-hauled and running zig-zag angles to the wind
  maxSpeed: 4.2, maxTurn: 0.55, maxHeel: 20 * D, windSwing: 25 * D, gust: 0.3,
};

const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const sgn = (v) => (v < 0 ? -1 : 1);

// Polar: fraction of the boat's top speed by true wind angle a (0..PI). Table lookup, linear between rows.
const POLAR_A = [0, 40, 46, 60, 90, 120, 150, 180].map((v) => v * D);
const POLAR_V = [0, 0, 0.5, 0.75, 1.0, 0.98, 0.86, 0.7];
export function polar(a) {
  a = Math.abs(a);
  for (let i = 1; i < POLAR_A.length; i++) {
    if (a <= POLAR_A[i]) return POLAR_V[i - 1] + (POLAR_V[i] - POLAR_V[i - 1]) * (a - POLAR_A[i - 1]) / (POLAR_A[i] - POLAR_A[i - 1]);
  }
  return POLAR_V[POLAR_V.length - 1];
}
// Sail trim (boom angle from centreline, radians) for a true wind angle: sheeted in close-hauled, eased to ~85 deg running.
export function trimFor(a) {
  a = Math.abs(a);
  return a <= SAIL.noGo ? 6 * D : (6 + (a - SAIL.noGo) / (Math.PI - SAIL.noGo) * 79) * D;
}

export function createSailFleet(seed, { cx = 0, count = 3, margin = SAIL.margin } = {}) {
  const rand = mulberry32(seed * 7919 + 13);
  const inside = (x, y, m) => lakeDepth(x, y, cx) >= m;
  const pickPoint = (out, m, fx, fy) => {
    for (let i = 0; i < 200; i++) {
      const x = cx + (rand() * 2 - 1) * LAKE_SHAPE.ax, y = LAKE_SHAPE.cy + (rand() * 2 - 1) * LAKE_SHAPE.ay;
      if (inside(x, y, m) && (fx === undefined || Math.hypot(x - fx, y - fy) > 30)) { out.x = x; out.y = y; return; }
    }
    out.x = cx; out.y = LAKE_SHAPE.cy;
  };
  // next mark: often upwind (to beat) or downwind (to run), otherwise anywhere in the lake
  const pickMark = (b) => {
    const r = rand();
    if (r < 0.7) {
      const want = r < 0.4 ? 0 : Math.PI; // bearing offset from the wind's origin: 0 = upwind (beat), PI = downwind (run)
      for (let k = 0; k < 40; k++) {
        pickPoint(tmp, SAIL.waypointMargin, b.x, b.y);
        if (Math.abs(wrap(Math.atan2(tmp.y - b.y, tmp.x - b.x) - wind.from - want)) < 0.5 && Math.hypot(tmp.x - b.x, tmp.y - b.y) > 35) { b.wx = tmp.x; b.wy = tmp.y; return; }
      }
    }
    pickPoint(tmp, SAIL.waypointMargin, b.x, b.y); b.wx = tmp.x; b.wy = tmp.y;
  };
  // wind: a base direction plus slow shifts (+-25 deg) and gusts (+-30 % of the speed factor, periods 20-60 s)
  const wind = { from: 0, speed: 1, base: rand() * TAU, t: 0 };
  const wp = [rand() * TAU, rand() * TAU, rand() * TAU, rand() * TAU];
  const windAt = (t) => {
    wind.from = wind.base + SAIL.windSwing * (0.6 * Math.sin(TAU * t / 83 + wp[0]) + 0.4 * Math.sin(TAU * t / 47 + wp[1]));
    wind.speed = 1 + SAIL.gust * (0.6 * Math.sin(TAU * t / 41 + wp[2]) + 0.4 * Math.sin(TAU * t / 23 + wp[3]));
  };
  windAt(0);

  const boats = [];
  const tmp = { x: 0, y: 0 };
  for (let i = 0; i < count; i++) {
    const b = {
      x: 0, y: 0, heading: rand() * TAU - Math.PI, speed: 0, turnRate: 0, heel: 0, sail: 0, jib: 0, tacks: 0, jibes: 0, kind: i, phase: rand() * 6.28,
      top: 3.2 + rand() * 0.6, // top speed (m/s) at wind factor 1
      wx: 0, wy: 0, ox: 0, oy: 0, mode: 0, s: 1, legT: 0, jibeT: 0, heelS: 0, timeInNoGo: 0,
    };
    for (let k = 0; k < 100; k++) { // spread out
      pickPoint(tmp, SAIL.waypointMargin);
      if (boats.every((o) => Math.hypot(o.x - tmp.x, o.y - tmp.y) > 25)) break;
    }
    b.x = tmp.x; b.y = tmp.y; pickPoint(tmp, SAIL.waypointMargin, b.x, b.y); b.wx = tmp.x; b.wy = tmp.y; b.ox = b.x; b.oy = b.y;
    const rel0 = wrap(wind.from - b.heading);
    b.s = sgn(rel0); b.speed = b.top * polar(rel0) * 0.7; b.sail = b.s * trimFor(rel0); b.jib = b.sail * 0.85;
    boats.push(b);
  }

  // avoid: null, or { x, y, r } (a zone to keep clear of, e.g. the floatplane on the water)
  function step(dt, avoid) {
    if (!(dt > 0)) return;
    if (dt > 0.25) { const n = Math.ceil(dt / 0.25); for (let i = 0; i < n; i++) step(dt / n, avoid); return; }
    wind.t += dt; windAt(wind.t);
    for (let i = 0; i < boats.length; i++) {
      const b = boats[i];
      b.legT += dt;
      if (Math.hypot(b.wx - b.x, b.wy - b.y) < SAIL.reach) { pickMark(b); b.mode = 0; }
      const brg = Math.atan2(b.wy - b.y, b.wx - b.x), dist = Math.hypot(b.wx - b.x, b.wy - b.y);
      const rb = wrap(wind.from - brg), arb = Math.abs(rb);
      // point of sail for the course to the mark, with hysteresis: 0 reach, 1 beat (mark upwind), 2 run (mark downwind)
      let mode = b.mode;
      if (mode === 0) mode = arb < SAIL.closeHaul + 0.05 ? 1 : arb > SAIL.runAngle - 0.1 ? 2 : 0;
      else if (mode === 1 && arb > SAIL.closeHaul + 0.25) mode = 0;
      else if (mode === 2 && arb < SAIL.runAngle - 0.4) mode = 0;
      if (mode !== b.mode) { b.mode = mode; b.legT = 0; b.ox = b.x; b.oy = b.y; b.s = sgn(rb); b.jibeT = 12 + rand() * 25; }
      const zig = mode === 0 ? 0 : mode === 1 ? SAIL.closeHaul : SAIL.runAngle;
      const flip = (isShore) => { b.s = -b.s; b.legT = 0; if (mode === 1) b.tacks++; else b.jibes++; if (!isShore) b.jibeT = 12 + rand() * 25; };
      let want;
      if (zig) {
        // cross-track offset from the leg's rhumb line (origin -> mark); tack/jibe once wide of it and heading away
        const lx = b.wx - b.ox, ly = b.wy - b.oy, L = Math.max(1, Math.hypot(lx, ly));
        const cross = ((b.x - b.ox) * ly - (b.y - b.oy) * lx) / L;
        const away = (Math.cos(b.heading) * ly - Math.sin(b.heading) * lx) / L * cross > 0;
        const width = 0.2 * L + 6;
        if (b.legT > 9 && Math.abs(cross) > width && away) flip(false);
        else if (mode === 2 && b.legT > b.jibeT) flip(false); // downwind: an occasional jibe
        want = wind.from - b.s * zig;
      } else want = brg;
      // keep clear of other boats: turn away from one that is close and ahead
      for (let j = 0; j < boats.length; j++) {
        if (j === i) continue;
        const o = boats[j], dx = o.x - b.x, dy = o.y - b.y, d = Math.hypot(dx, dy);
        if (d < SAIL.spacing * 1.8) {
          const to = Math.atan2(dy, dx), side = wrap(to - b.heading);
          if (d < SAIL.hardSpacing * 1.6) want = to + Math.PI; // very close: head straight away
          else if (Math.abs(side) < 1.0) want = to - sgn(side) * 1.1; // close and ahead: turn away from it
        }
      }
      // shore: if the water ahead along `want` is too close to the shore, tack/bear away to the lake centre
      const la = Math.min(Math.max(10, b.speed * 4), dist + 2); // never probe past the mark (marks are well inside)
      const ok = (h) => inside(b.x + Math.cos(h) * la, b.y + Math.sin(h) * la, margin + 3);
      if (!ok(want)) {
        const centre = Math.atan2(LAKE_SHAPE.cy - b.y, cx - b.x);
        if (zig && b.legT > 3) { // take the other tack/jibe if that heads for safer water
          const alt = wind.from + b.s * zig;
          if (ok(alt) || Math.abs(wrap(alt - centre)) < Math.abs(wrap(want - centre))) { flip(true); want = alt; }
        }
        if (!ok(want) || !inside(b.x, b.y, margin + 3)) want = centre;
      }
      // floatplane circle: flee when inside, turn away when heading for it
      if (avoid) {
        const dx = b.x - avoid.x, dy = b.y - avoid.y, d = Math.hypot(dx, dy);
        if (d < avoid.r + 12) {
          const awayA = Math.atan2(dy, dx);
          if (d < avoid.r || Math.abs(wrap(Math.atan2(-dy, -dx) - b.heading)) < 1.4) want = awayA;
        }
      }
      // the helmsman cannot point into the no-go zone: a wanted heading inside it becomes close-hauled on the nearer tack
      // (sticky tack while zig-zagging)
      const rw = wrap(wind.from - want);
      if (Math.abs(rw) < SAIL.closeHaul) want = wind.from - (zig && mode === 1 ? b.s : sgn(rw)) * SAIL.closeHaul;
      // steer smoothly: a turn-rate that follows the heading error, limited and low-passed
      const dh = wrap(want - b.heading);
      const tr = Math.max(-SAIL.maxTurn, Math.min(SAIL.maxTurn, dh * 1.4));
      b.turnRate += (tr - b.turnRate) * Math.min(1, dt * 2.5);
      b.heading = wrap(b.heading + b.turnRate * dt);
      // speed from the polar for the actual heading; lag so luffing through the wind (a tack) costs speed
      const rel = wrap(wind.from - b.heading), a = Math.abs(rel), side = sgn(rel);
      if (a < SAIL.noGo) b.timeInNoGo += dt; else b.timeInNoGo = 0;
      const vt = b.top * Math.sqrt(wind.speed) * polar(a) * (1 - 0.3 * Math.min(1, Math.abs(b.turnRate) / 0.4));
      b.speed += (vt - b.speed) * Math.min(1, dt * (vt > b.speed ? 0.45 : 0.7));
      if (b.speed < 0) b.speed = 0;
      // heel to leeward from the wind force on the sails; sail trim by point of sail and tack
      const F = wind.speed * wind.speed * (0.2 + 0.8 * Math.sin(Math.min(a, Math.PI)));
      b.heelS += (side * Math.min(1, F / 1.2) * SAIL.maxHeel - b.heelS) * Math.min(1, dt * 1.5);
      b.heel = b.heelS * Math.min(1, b.speed / 1.2);
      b.sail += (side * trimFor(a) - b.sail) * Math.min(1, dt * 2.2);
      b.jib += (side * trimFor(a) * 0.85 - b.jib) * Math.min(1, dt * 2.8);
      // move (hard guards: never into the shore, the avoid circle, or another boat)
      const nx = b.x + Math.cos(b.heading) * b.speed * dt, ny = b.y + Math.sin(b.heading) * b.speed * dt;
      let go = lakeDepth(nx, ny, cx) >= margin - 3;
      if (go && avoid) { const dn = Math.hypot(nx - avoid.x, ny - avoid.y); if (dn < avoid.r && dn < Math.hypot(b.x - avoid.x, b.y - avoid.y)) go = false; }
      if (go) { b.x = nx; b.y = ny; } else b.speed *= 0.5;
      // soft collision: boats never overlap; push apart along the line between them (so no mutual gridlock)
      for (let j = 0; j < boats.length; j++) {
        if (j === i) continue;
        const dx = b.x - boats[j].x, dy = b.y - boats[j].y, d = Math.hypot(dx, dy);
        if (d < SAIL.hardSpacing && d > 1e-6) {
          const px = b.x + dx / d * (SAIL.hardSpacing - d) * 0.5, py = b.y + dy / d * (SAIL.hardSpacing - d) * 0.5;
          if (lakeDepth(px, py, cx) >= margin - 3 && (!avoid || Math.hypot(px - avoid.x, py - avoid.y) >= Math.min(avoid.r, Math.hypot(b.x - avoid.x, b.y - avoid.y)))) { b.x = px; b.y = py; }
        }
      }
    }
  }
  return { boats, wind, step };
}
