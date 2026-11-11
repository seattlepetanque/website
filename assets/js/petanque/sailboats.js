// F65: a very simple sailing simulation for the lake sailboats. Pure logic (no three.js):
// createSailFleet(seed, { cx, count }) -> { boats, wind, step(dt, avoid) }. World metres (x includes the court centre cx).
// Angles are maths angles in the x/y plane (heading = atan2(dy, dx)). Wind is described by `wind.from`, the direction the
// wind blows FROM. rel = wrap(wind.from - heading): 0 is head to wind, sign(rel) > 0 means the wind comes over the boat's
// left (port) side, so the boom is out to the right and the boat heels right (leeward).
// Model: slowly shifting wind (+-25 deg, gusts +-30 %), a polar speed curve (zero in the ~40 deg no-go zone, best on a
// beam reach, a bit lower dead downwind) with a first-order speed lag (so a tack through the wind costs speed), a smooth
// heading controller, and a course helmsman that sails LONG STRAIGHT LEGS (marks 65-115 m apart): a reach holds the bearing
// to the mark; a beat is a few close-hauled legs (40-85 m each, alternating tacks); a run is a few long jibing legs; the boat
// turns only at the end of a leg (tack, jibe, new mark) or when the shore / floatplane look-ahead needs a new course.
// There is no boat-to-boat avoidance at all (boats are far apart on screen and may pass through each other).
// Marks (65-115 m, usually 80+) prefer the far side of the lake (away from the court).
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
  margin: 9, waypointMargin: 14, reach: 8, avoidR: 40,
  noGo: 40 * D, closeHaul: 46 * D, runAngle: 148 * D, // no-go half angle; close-hauled and running zig-zag angles to the wind
  farY: 104, anyY: 70, nearY: 80, homeY: 100, farShare: 0.85, // far-side preference (lake y): far zone, loosest mark limit, near third, start zone
  speedScale: 1 / 3, // all boat speeds are a third of the polar speed (F65 look: slow, gliding)
  maxSpeed: 1.6, maxTurn: 0.27, maxHeel: 20 * D, windSwing: 25 * D, gust: 0.3,
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
  // random point in the lake (inside by m, y >= ymin) that satisfies pred; tries a bounded number of times
  const pickPoint = (out, m, ymin, pred, tries = 200) => {
    for (let i = 0; i < tries; i++) {
      const x = cx + (rand() * 2 - 1) * LAKE_SHAPE.ax, y = LAKE_SHAPE.cy + (rand() * 2 - 1) * LAKE_SHAPE.ay;
      if (y >= ymin && inside(x, y, m) && (!pred || pred(x, y))) { out.x = x; out.y = y; return true; }
    }
    return false;
  };
  // Next mark, 65-115 m away: soft preference for the far side of the lake (most marks in the far zone, the rest anywhere but
  // never near the near shore; a boat that drifted into the near third always picks a far mark), often upwind (to beat) or
  // downwind (to run), preferably not behind the boat (fewer big turns), clear of the floatplane circle. Relaxes if nothing fits.
  const pickMark = (b, avoid) => {
    const r = rand();
    const far = b.y < SAIL.nearY || rand() < SAIL.farShare;
    const want = r < 0.7 ? (r < 0.4 ? 0 : Math.PI) : null; // bearing offset from the wind's origin: 0 upwind, PI downwind
    const rungs = [[75, true, true], [75, false, true], [65, false, true], [65, false, false], [45, false, false], [25, false, false]];
    for (const ymin of far ? [SAIL.farY, SAIL.anyY, -Infinity] : [SAIL.anyY, -Infinity]) {
      for (const [minD, useWind, useHead] of rungs) {
        if (useWind && want === null) continue;
        const ok = pickPoint(tmp, SAIL.waypointMargin, ymin, (x, y) => {
          const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy), brg = Math.atan2(dy, dx);
          return d >= minD && d <= 115 && (!avoid || Math.hypot(x - avoid.x, y - avoid.y) > avoid.r + 8)
            && (!useWind || Math.abs(wrap(brg - wind.from - want)) < 0.5) && (!useHead || Math.abs(wrap(brg - b.heading)) < 1.3);
        }, 150);
        if (ok) { b.wx = tmp.x; b.wy = tmp.y; return; }
      }
    }
    b.wx = cx; b.wy = LAKE_SHAPE.cy + 20;
  };
  // wind: a base direction plus slow shifts (+-25 deg) and gusts (+-30 % of the speed factor, periods 20-60 s)
  const wind = { from: 0, speed: 1, base: rand() * TAU, t: 0 };
  const wp = [rand() * TAU, rand() * TAU, rand() * TAU, rand() * TAU];
  const windAt = (t) => {
    wind.from = wind.base + SAIL.windSwing * (0.6 * Math.sin(TAU * t / 83 + wp[0]) + 0.4 * Math.sin(TAU * t / 47 + wp[1]));
    wind.speed = 1 + SAIL.gust * (0.6 * Math.sin(TAU * t / 41 + wp[2]) + 0.4 * Math.sin(TAU * t / 23 + wp[3]));
  };
  windAt(0);

  // A new leg: (optionally pick a mark) choose the point of sail for the bearing to it and the heading to hold.
  // mode 0 reach (hold the bearing), 1 beat (close-hauled legs), 2 run (jibing legs). legLen: how far to sail before tacking.
  const startLeg = (b, remark, avoid) => {
    if (remark) pickMark(b, avoid);
    const brg = Math.atan2(b.wy - b.y, b.wx - b.x), rb = wrap(wind.from - brg), arb = Math.abs(rb);
    b.mode = arb < SAIL.closeHaul + 0.05 ? 1 : arb > SAIL.runAngle - 0.1 ? 2 : 0;
    b.s = sgn(rb); b.legT = 0; b.legD = 0;
    b.legLen = (40 + rand() * 45) * (b.mode === 0 ? 1 : 0.55); // the first leg stops short so a beat or run zig-zags about the rhumb line
    b.legH = b.mode === 0 ? brg : wind.from - b.s * (b.mode === 1 ? SAIL.closeHaul : SAIL.runAngle);
  };

  const boats = [];
  const tmp = { x: 0, y: 0 };
  for (let i = 0; i < count; i++) {
    const b = {
      x: 0, y: 0, heading: 0, speed: 0, turnRate: 0, heel: 0, sail: 0, jib: 0, tacks: 0, jibes: 0, kind: i, phase: rand() * 6.28,
      top: 3.2 + rand() * 0.6, // top speed (m/s) at wind factor 1
      wx: 0, wy: 0, mode: 0, s: 1, legT: 0, legD: 0, legLen: 60, legH: 0, cool: 0, heelS: 0, timeInNoGo: 0,
    };
    for (let k = 0; k < 100; k++) { // start in the far half, spread out
      pickPoint(tmp, SAIL.waypointMargin, SAIL.homeY);
      if (boats.every((o) => Math.hypot(o.x - tmp.x, o.y - tmp.y) > 25)) break;
    }
    b.x = tmp.x; b.y = tmp.y; startLeg(b, true);
    b.heading = b.legH;
    const rel0 = wrap(wind.from - b.heading);
    b.speed = SAIL.speedScale * b.top * polar(rel0) * 0.7; b.sail = sgn(rel0) * trimFor(rel0); b.jib = b.sail * 0.85;
    boats.push(b);
  }

  // avoid: null, or { x, y, r } (a zone to keep clear of, e.g. the floatplane on the water)
  function step(dt, avoid) {
    if (!(dt > 0)) return;
    if (dt > 0.25) { const n = Math.ceil(dt / 0.25); for (let i = 0; i < n; i++) step(dt / n, avoid); return; }
    wind.t += dt; windAt(wind.t);
    for (let i = 0; i < boats.length; i++) {
      const b = boats[i];
      b.legT += dt; b.cool -= dt;
      if (Math.hypot(b.wx - b.x, b.wy - b.y) < SAIL.reach) startLeg(b, true, avoid);
      const brg = Math.atan2(b.wy - b.y, b.wx - b.x), dist = Math.hypot(b.wx - b.x, b.wy - b.y);
      const arb = Math.abs(wrap(wind.from - brg));
      // lay line: once the mark can be reached on one tack, bear away / head up for it and hold that bearing
      if ((b.mode === 1 && arb > SAIL.closeHaul + 0.2) || (b.mode === 2 && arb < SAIL.runAngle - 0.3)) { b.mode = 0; b.legT = 0; b.legH = brg; }
      if (b.mode === 0 && Math.abs(wrap(brg - b.legH)) > 0.25) b.legH = brg; // rare re-aim after a wind shift
      if (b.mode === 0 && (arb < SAIL.closeHaul - 0.05 || arb > SAIL.runAngle + 0.05)) { startLeg(b, false); } // mark now in the no-go zone / dead astern
      const zig = b.mode === 0 ? 0 : b.mode === 1 ? SAIL.closeHaul : SAIL.runAngle;
      const flip = () => { b.s = -b.s; b.legT = 0; b.legD = 0; b.legLen = 40 + rand() * 45; if (b.mode === 1) b.tacks++; else b.jibes++; b.legH = wind.from - b.s * zig; };
      if (zig) {
        if (b.legD > b.legLen && b.legT > 6) flip(); // end of a long leg: tack / jibe
        else if (Math.abs(wrap(wind.from - b.legH - b.s * zig)) > 0.17) b.legH = wind.from - b.s * zig; // small trim for a wind shift
      }
      let want = b.legH;
      // look-ahead: shore (and the floatplane circle) along `want`; a blocked leg ends with a tack/jibe or a new mark
      const la = Math.min(Math.max(10, b.speed * 4 / SAIL.speedScale), dist + 2); // never probe past the mark (marks are well inside)
      const dPlane = avoid ? Math.hypot(b.x - avoid.x, b.y - avoid.y) : Infinity;
      const ok = (h) => {
        for (const f of [1, 1.8]) {
          const d = Math.min(la * f, dist + 2), x = b.x + Math.cos(h) * d, y = b.y + Math.sin(h) * d;
          if (!inside(x, y, margin + 3)) return false;
          if (avoid && dPlane >= avoid.r && Math.hypot(x - avoid.x, y - avoid.y) < avoid.r + 2) return false;
        }
        return true;
      };
      if (!ok(want)) {
        if (zig && b.legT > 3 && ok(wind.from + b.s * zig)) { flip(); want = b.legH; }
        else if (b.cool <= 0) { startLeg(b, true, avoid); b.cool = 3; want = b.legH; }
        if (!ok(want)) { // still blocked: steer for the lake centre (rare)
          const centre = Math.atan2(LAKE_SHAPE.cy - b.y, cx - b.x);
          if (!inside(b.x, b.y, margin + 3) || !ok(wind.from + sgn(wrap(wind.from - want)) * SAIL.closeHaul)) want = centre;
        }
      }
      // inside the floatplane circle: leave it
      if (avoid && dPlane < avoid.r) want = Math.atan2(b.y - avoid.y, b.x - avoid.x);
      // the helmsman cannot point into the no-go zone: a wanted heading inside it becomes close-hauled on the nearer tack
      // (sticky tack while beating)
      const rw = wrap(wind.from - want);
      if (Math.abs(rw) < SAIL.closeHaul) want = wind.from - (zig && b.mode === 1 ? b.s : sgn(rw)) * SAIL.closeHaul;
      // steer smoothly: a turn-rate that follows the heading error, limited and low-passed
      const dh = wrap(want - b.heading);
      const tr = Math.max(-SAIL.maxTurn, Math.min(SAIL.maxTurn, dh * 0.7));
      b.turnRate += (tr - b.turnRate) * Math.min(1, dt * 2.5);
      b.heading = wrap(b.heading + b.turnRate * dt);
      // speed from the polar for the actual heading; lag so luffing through the wind (a tack) costs speed
      const rel = wrap(wind.from - b.heading), a = Math.abs(rel), side = sgn(rel);
      if (a < SAIL.noGo) b.timeInNoGo += dt; else b.timeInNoGo = 0;
      const vt = SAIL.speedScale * b.top * Math.sqrt(wind.speed) * polar(a) * (1 - 0.3 * Math.min(1, Math.abs(b.turnRate) / 0.2));
      b.speed += (vt - b.speed) * Math.min(1, dt * (vt > b.speed ? 0.45 : 0.7));
      if (b.speed < 0) b.speed = 0;
      // heel to leeward from the wind force on the sails; sail trim by point of sail and tack
      const F = wind.speed * wind.speed * (0.2 + 0.8 * Math.sin(Math.min(a, Math.PI)));
      b.heelS += (side * Math.min(1, F / 1.2) * SAIL.maxHeel - b.heelS) * Math.min(1, dt * 1.5);
      b.heel = b.heelS * Math.min(1, b.speed / (1.2 * SAIL.speedScale)); // heel follows the wind force, not the (scaled) speed
      b.sail += (side * trimFor(a) - b.sail) * Math.min(1, dt * 2.2);
      b.jib += (side * trimFor(a) * 0.85 - b.jib) * Math.min(1, dt * 2.8);
      // move (hard guards: never into the shore or the avoid circle)
      const nx = b.x + Math.cos(b.heading) * b.speed * dt, ny = b.y + Math.sin(b.heading) * b.speed * dt;
      let go = lakeDepth(nx, ny, cx) >= margin - 3;
      if (go && avoid) { const dn = Math.hypot(nx - avoid.x, ny - avoid.y); if (dn < avoid.r && dn < dPlane) go = false; }
      if (go) { b.x = nx; b.y = ny; b.legD += b.speed * dt; } else b.speed *= 0.5;
    }
  }
  return { boats, wind, step };
}
