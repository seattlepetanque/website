// The donnée throw model: pick a landing spot and a loft, solve the launch, add execution error.
// Pure (no DOM, no three.js), shared by the human's toss and the AI.
// Axes: x across, y along, z up. yaw 0 = +y, positive yaw toward +x (same as physics launch).
import { C } from './constants.js';
import { gauss } from './rng.js';
import { createBody, launch } from './physics.js';

export const LOFT_MIN = 8 * Math.PI / 180;
export const LOFT_MAX = 75 * Math.PI / 180;
const DEG = Math.PI / 180;

// Style names: below 20 deg roulette, 20-45 demi-portée, above 45 plombée, tir when snapped to a target
export function styleForLoft(loft, snapped = false) {
  if (snapped) return 'tir';
  if (loft < 20 * DEG) return 'roulette';
  if (loft <= 45 * DEG) return 'demi-portee';
  return 'plombee';
}

// Backspin (rad/s) by loft: a roulette keeps almost none, a plombée bites hard.
// Piecewise-linear knots tuned against physics.js on flat terrain (see tests/petanque/donnee.test.js).
const SPIN_KNOTS = [
  [8, 0], [12, 4], [20, 30], [35, 75], [45, 120], [60, 170], [75, 172],
];
export function backspinForLoft(loft) {
  const d = loft / DEG;
  const k = SPIN_KNOTS;
  if (d <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (d <= k[i][0]) {
      const t = (d - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
      return k[i - 1][1] + t * (k[i][1] - k[i - 1][1]);
    }
  }
  return k[k.length - 1][1];
}

// Exact copy of physics.js stepAirborne motion (drag, gravity, semi-implicit Euler), flight only.
// Ends at the first step where the ball bottom meets the terrain, as the world does.
// Returns { x, y, z, t }; fills `rec` with every step's position when given.
function flight(from, yaw, speed, loft, terrain, rec) {
  const dt = C.dt, k = 1 - C.airDrag * dt, r = C.boule.r;
  const cl = Math.cos(loft);
  let vx = speed * cl * Math.sin(yaw), vy = speed * cl * Math.cos(yaw), vz = speed * Math.sin(loft);
  let x = from.x, y = from.y, z = from.z !== undefined ? from.z : C.throwFrom.z;
  if (rec) rec.push({ x, y, z });
  let t = 0;
  for (let i = 0; i < 20000; i++) {
    vx *= k; vy *= k; vz = vz * k - C.gravity * dt;
    x += vx * dt; y += vy * dt; z += vz * dt;
    t += dt;
    if (rec) rec.push({ x, y, z });
    if (z - r > C.lowAirZ + C.maxHeight) continue;
    // fixed stones deflect the ball exactly as physics.js stoneContacts does (deterministic)
    let hit = false;
    const list = terrain.stonesNear ? terrain.stonesNear(x, y, r) : null;
    if (list) {
      for (let j = 0; j < list.length; j++) {
        const st = list[j];
        let dx = x - st.x, dy = y - st.y, dz = z - st.h;
        const R = r + st.r, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2) || 1e-9;
        dx /= d; dy /= d; dz /= d;
        const pen = R - d;
        x += dx * pen; y += dy * pen; z += dz * pen;
        const vn = vx * dx + vy * dy + vz * dz;
        hit = true;
        if (vn < 0) {
          const rock = st.r > C.pebbleR[1];
          const e = vn < -0.05 ? (rock ? C.stoneRestitution : C.pebbleRestitution) : 0;
          const f = rock ? 1 : Math.min(1, C.stoneMassRef / C.boule.m);
          const kk = -(1 + e) * vn * f;
          vx += kk * dx; vy += kk * dy; vz += kk * dz;
        }
      }
    }
    const s = terrain.sample(x, y);
    if (z - r <= s.h) break;
    if (hit && z - r - s.h < 0.03 && Math.abs(vx * s.nx + vy * s.ny + vz * s.nz) < C.bounceMin) break; // rolls on
  }
  return { x, y, z, t };
}

// Best speed for a fixed yaw and loft: { speed, err } (err = distance miss in metres).
// Bisection on speed (flight is monotonic in speed at fixed loft), then a scan for the sawtooth below.
function solveSpeed(from, yaw, dist, loft, terrain) {
  const reach = (v) => {
    const f = flight(from, yaw, v, loft, terrain);
    return Math.hypot(f.x - from.x, f.y - from.y);
  };
  // vacuum range guess brackets the answer tightly
  const g = C.gravity, h0 = from.z !== undefined ? from.z : C.throwFrom.z;
  const sl = Math.sin(loft), cl = Math.cos(loft);
  const v0 = Math.sqrt(g * dist / Math.max(0.05, 2 * sl * cl)) || 5;
  let lo = Math.max(0.3, v0 * 0.6), hi = v0 * 1.6 + 2 + Math.sqrt(2 * g * Math.max(0, h0));
  while (reach(lo) > dist && lo > 0.05) lo *= 0.5;
  while (reach(hi) < dist && hi < C.maxSpeed) hi *= 1.5;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (reach(mid) < dist) lo = mid; else hi = mid;
  }
  let best = (lo + hi) / 2, bestErr = Math.abs(reach(best) - dist);
  if (bestErr > 0.003) {
    // The world detects landing only at step ends, so reach(v) is a sawtooth (jumps of v*dt at low loft):
    // scan around the bisection result for a speed on a ramp that really hits the distance
    const N = 40, span = 0.012, sp = [], re = [];
    for (let i = 0; i <= N; i++) {
      sp.push(best * (1 - span + 2 * span * i / N));
      re.push(reach(sp[i]));
      const e = Math.abs(re[i] - dist);
      if (e < bestErr) { bestErr = e; best = sp[i]; }
    }
    for (let i = 0; i < N; i++) {
      if (re[i] <= dist && re[i + 1] >= dist && re[i + 1] - re[i] < 0.03) {
        let a = sp[i], b = sp[i + 1];
        for (let j = 0; j < 14; j++) {
          const m = (a + b) / 2, rm = reach(m), e = Math.abs(rm - dist);
          if (e < bestErr) { bestErr = e; best = m; }
          if (rm < dist) a = m; else b = m;
        }
      }
    }
  }
  return { speed: best, err: bestErr };
}

// Solve yaw and speed so the first ground contact is the landing point, matching the physics' own discrete
// flight. At low loft the world's step-end landing test leaves unreachable gaps of a few cm; if the miss
// is over 1 cm the loft is nudged by a few hundredths of a degree (invisible) to move the gap.
export function solveLaunch({ from = C.throwFrom, landing, loft, terrain }) {
  const dx = landing.x - from.x, dy = landing.y - from.y;
  const yaw = Math.atan2(dx, dy);
  const dist = Math.hypot(dx, dy);
  let r = solveSpeed(from, yaw, dist, loft, terrain), useLoft = loft;
  for (let i = 1; i <= 8 && r.err > 0.01; i++) {
    const l2 = loft + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.0006;
    const r2 = solveSpeed(from, yaw, dist, l2, terrain);
    if (r2.err < r.err) { r = r2; useLoft = l2; }
  }
  if (r.err > 0.02 && terrain.stonesNear) {
    // a stone sits in the way of the flight's end: aim as if the ground were bare (the stone then
    // deflects the ball for real, which is the game's own randomness)
    const bare = { sample: (x, y) => terrain.sample(x, y) };
    const rb = solveSpeed(from, yaw, dist, loft, bare);
    if (rb.err < r.err) { r = rb; useLoft = loft; }
  }
  return { yaw, speed: r.speed, loft: useLoft, backspin: backspinForLoft(loft), sidespin: 0 };
}

// Base sigmas: lat and long are fractions of throw distance (long is the low-loft value), loft in radians
export const SKILL = Object.freeze({
  human: Object.freeze({ lat: 0.012, long: 0.03, loft: 1.5 * DEG }),
  marcel: Object.freeze({ lat: 0.011, long: 0.022, loft: 1.2 * DEG }), // pointeur: tight long
  odette: Object.freeze({ lat: 0.008, long: 0.03, loft: 1.4 * DEG }), // tireur: tight lateral
  pierre: Object.freeze({ lat: 0.01, long: 0.033, loft: 1.6 * DEG }), // tireur-ish, a bit looser
});
export const difficultyScale = Object.freeze({ easy: 1.6, medium: 1.0, hard: 0.65 });
const LONG_GROWTH = 5 / 3; // longitudinal sigma at LOFT_MAX relative to LOFT_MIN

// Scale an AI skill by difficulty (the human is never scaled)
export function scaledSkill(skill, difficulty = 'medium') {
  const s = typeof skill === 'string' ? SKILL[skill] : skill;
  const f = difficultyScale[difficulty] || 1;
  return { lat: s.lat * f, long: s.long * f, loft: s.loft * f };
}

// Sigmas in metres, metres, radians; grow with distance and (longitudinally) with loft.
// `skill` is a { lat, long, loft } object or a SKILL name.
export function coneFor({ skill, from = C.throwFrom, landing, loft }) {
  const s = typeof skill === 'string' ? SKILL[skill] : skill;
  const dist = Math.hypot(landing.x - from.x, landing.y - from.y);
  const t = Math.max(0, Math.min(1, (loft - LOFT_MIN) / (LOFT_MAX - LOFT_MIN)));
  return {
    sigmaLat: dist * s.lat,
    sigmaLong: dist * s.long * (1 + (LONG_GROWTH - 1) * t),
    sigmaLoft: s.loft,
  };
}

// Unit vectors along the throw and to its right (toward +x at yaw 0)
function axes(from, landing) {
  const dx = landing.x - from.x, dy = landing.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  return { ux: dx / d, uy: dy / d, rx: dy / d, ry: -dx / d };
}

const SIDESPIN_PER_SIGMA = 10; // rad/s per sigma of lateral error (about 20 at 2 sigma)
const SIDESPIN_MAX = 40;

// Sample the cone, solve for the sampled donnée and loft, and curl the ball further off-axis.
export function executeThrow({ from = C.throwFrom, landing, loft, cone, terrain, rand }) {
  const a = axes(from, landing);
  const gLat = gauss(rand), gLong = gauss(rand), gLoft = gauss(rand);
  const lateralError = gLat * cone.sigmaLat;
  const longError = gLong * cone.sigmaLong;
  const actualLanding = {
    x: landing.x + a.rx * lateralError + a.ux * longError,
    y: landing.y + a.ry * lateralError + a.uy * longError,
  };
  const actualLoft = Math.max(LOFT_MIN * 0.75, Math.min(LOFT_MAX * 1.1, loft + gLoft * cone.sigmaLoft));
  const throwParams = solveLaunch({ from, landing: actualLanding, loft: actualLoft, terrain });
  // positive sidespin (about +z) kicks the ball toward the thrower's right at landing (checked against
  // physics.js), so a ball landing right of the line gets positive spin and curls further right
  const z = cone.sigmaLat > 0 ? lateralError / cone.sigmaLat : 0;
  throwParams.sidespin = Math.max(-SIDESPIN_MAX, Math.min(SIDESPIN_MAX, z * SIDESPIN_PER_SIGMA));
  return { throwParams, actualLanding, lateralError };
}

// Flight path as n+1 points, resampled evenly in time (no collisions). Terrain optional (flat if omitted).
export function arcPath(from, throwParams, n = 40, terrain = null) {
  const t = terrain || { sample: () => ({ h: 0 }) };
  const rec = [];
  flight(from || C.throwFrom, throwParams.yaw, throwParams.speed, throwParams.loft, t, rec);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const p = rec[Math.round(i * (rec.length - 1) / n)];
    out.push({ x: p.x, y: p.y, z: p.z });
  }
  return out;
}

function ellipse(center, a, sLat, sLong, terrain, n = 48) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const th = i / n * Math.PI * 2;
    const lat = Math.cos(th) * sLat, lon = Math.sin(th) * sLong;
    const x = center.x + a.rx * lat + a.ux * lon, y = center.y + a.ry * lat + a.uy * lon;
    pts.push({ x, y, z: terrain.sample(x, y).h + 0.01 });
  }
  return pts;
}

// Centre arc, four edge arcs (+-1 sigma lateral, +-1 sigma longitudinal) and 1/2 sigma ground ellipses
export function coneEnvelope({ from = C.throwFrom, landing, loft, cone, terrain }) {
  const a = axes(from, landing);
  const arc = (l) => arcPath(from, solveLaunch({ from, landing: l, loft, terrain }), 40, terrain);
  const off = (lat, lon) => ({
    x: landing.x + a.rx * lat + a.ux * lon, y: landing.y + a.ry * lat + a.uy * lon,
  });
  return {
    center: arc(landing),
    edges: [
      arc(off(cone.sigmaLat, 0)), arc(off(-cone.sigmaLat, 0)),
      arc(off(0, cone.sigmaLong)), arc(off(0, -cone.sigmaLong)),
    ],
    ellipse1: ellipse(landing, a, cone.sigmaLat, cone.sigmaLong, terrain),
    ellipse2: ellipse(landing, a, 2 * cone.sigmaLat, 2 * cone.sigmaLong, terrain),
  };
}

// Noiseless sim on the perceived terrain; returns the thrown body's path (every ~1/30 s) until it settles
export function predictRoll({ world, terrain, throwParams, from = C.throwFrom, kind = 'boule', rand, maxSeconds = 12 }) {
  let seed = 12345; // fixed local rng so the guide never flickers
  const r = rand || (() => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; });
  const w = world.clone(terrain.perceived(), r);
  const b = launch(createBody(kind, { team: -1 }), throwParams, from);
  w.add(b);
  b.state = 'airborne';
  const every = Math.round(1 / 30 / C.dt);
  const path = [{ x: b.x, y: b.y, z: b.z }];
  const end = w.t + maxSeconds;
  let i = 0;
  while (!b.dead && b.state !== 'resting' && w.t < end) {
    w.step();
    if (++i % every === 0) path.push({ x: b.x, y: b.y, z: b.z });
  }
  path.push({ x: b.x, y: b.y, z: b.z });
  return path;
}
