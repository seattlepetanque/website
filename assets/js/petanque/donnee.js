// The donnée throw model: pick a landing spot and a loft, solve the launch, add execution error.
// Pure (no DOM, no three.js), shared by the human's toss and the AI.
// Axes: x across, y along, z up. yaw 0 = +y, positive yaw toward +x (same as physics launch).
import { C } from './constants.js';
import { court } from './court.js';
import { gauss } from './rng.js';
import { createBody, launch } from './physics.js';

export const LOFT_MIN = 8 * Math.PI / 180;
export const LOFT_MAX = 75 * Math.PI / 180;
const DEG = Math.PI / 180;

// Style names by loft: below 20 deg roulette, 20-45 demi-portée, above 45 plombée. `snapped` is ignored (F35: the throw is
// always named by its loft; the AI's internal 'tir' label for shots at a boule is set in ai.js).
export function styleForLoft(loft, snapped = false) {
  void snapped;
  if (loft < 20 * DEG) return 'roulette';
  if (loft <= 45 * DEG) return 'demi-portee';
  return 'plombee';
}

// Release height by loft until the character's hand supplies it (C09): a pointer's low throw is released from
// a crouch (about 0.5 m), a standing lob from about 0.9 m, smoothly in between (18 to 30 degrees).
export const RELEASE_LOW = 0.5, RELEASE_HIGH = 0.9;
export function releaseHeight(loft) {
  const t = Math.max(0, Math.min(1, (loft / DEG - 18) / 12));
  return RELEASE_LOW + (RELEASE_HIGH - RELEASE_LOW) * t * t * (3 - 2 * t);
}
// base may carry release(loft) (the thrower's predicted hand position, C09); otherwise the height follows the loft
export const releaseFrom = (base, loft) => (base.release ? base.release(loft) : { x: base.x, y: base.y, z: releaseHeight(loft) });

// A tir (donnée snapped onto a boule) lands this far short of the target's centre along the throw: the boule
// then hops or rolls into it. Measured with the human cone at 32-40 degrees: about +8 points of hits over
// aiming dead on (27% to 36% at 32 degrees), and carreaus 3% to 6%.
export const SNAP_SHORT = 0.2;
export function snapAim(from, target) {
  const dx = target.x - from.x, dy = target.y - from.y, d = Math.hypot(dx, dy) || 1;
  const k = Math.min(SNAP_SHORT, d * 0.5);
  return { x: target.x - dx / d * k, y: target.y - dy / d * k };
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
export function solveLaunch({ from = court.throwFrom, landing, loft, terrain }) {
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

// Base sigmas: lat and long are fractions of throw distance (long is the low-loft value), loft in radians.
// maxSpeed is the throw "effort" (m/s, see effortFor) the player can deliver with good control (D02).
export const SKILL = Object.freeze({
  human: Object.freeze({ lat: 0.012, long: 0.03, loft: 1.5 * DEG, maxSpeed: 11.6 }),
  marcel: Object.freeze({ lat: 0.011, long: 0.022, loft: 1.2 * DEG, maxSpeed: 11.3 }), // pointeur: tight long, weaker arm
  odette: Object.freeze({ lat: 0.008, long: 0.028, loft: 1.4 * DEG, maxSpeed: 12.4 }), // tireur: tight lateral, strong; F23: clearly weaker pointer than Marcel
  pierre: Object.freeze({ lat: 0.0088, long: 0.0255, loft: 1.4 * DEG, maxSpeed: 12.2 }), // F23: well-rounded, shoots a touch below Odette and points a touch below Marcel
});
// The one difficulty scaling: multiplies an AI's lat/long/loft sigmas. D02 set 2.3 / 1.35 / 0.65; D22's balance runs
// against the scripted pointer added x0.85 / x1.4 / x2.0 on top (tactics.js), folded in here: 1.955 / 1.89 / 1.3.
// F23 re-measured with a stronger Pierre (win rate of the scripted pointer + Pierre): 3.0 / 1.6 / 1.3.
export const difficultyScale = { easy: 3.4, medium: 1.6, hard: 1.3 }; // F23 (was 1.95 / 1.9 / 1.3; easy 3.0 -> 3.4) // plain object: tests pin the D02 values (see ai.test.js)
const LONG_GROWTH = 1.85; // longitudinal sigma at LOFT_MAX relative to LOFT_MIN
const LAT_GROWTH = 1.25; // lateral sigma at LOFT_MAX relative to LOFT_MIN
// Near-max throws are less accurate: both sigmas are multiplied by 1 + ENERGY_K * max(0, energyFrac - ENERGY_KNEE)^2
export const ENERGY_KNEE = 0.7, ENERGY_K = 9;
export const energyPenalty = (energyFrac) => 1 + ENERGY_K * Math.max(0, energyFrac - ENERGY_KNEE) ** 2;

// Scale an AI skill by difficulty (the human is never scaled); strength is not scaled
export function scaledSkill(skill, difficulty = 'medium') {
  const s = typeof skill === 'string' ? SKILL[skill] : skill;
  const f = difficultyScale[difficulty] || 1;
  return { lat: s.lat * f, long: s.long * f, loft: s.loft * f, maxSpeed: s.maxSpeed };
}

// Sigmas in metres, metres, radians; grow with distance, with loft, and with the fraction of the throw budget used.
// `skill` is a { lat, long, loft } object or a SKILL name; energyFrac defaults to no penalty.
export function coneFor({ skill, from = court.throwFrom, landing, loft, energyFrac = 0 }) {
  const s = typeof skill === 'string' ? SKILL[skill] : skill;
  const dist = Math.hypot(landing.x - from.x, landing.y - from.y);
  const t = Math.max(0, Math.min(1, (loft - LOFT_MIN) / (LOFT_MAX - LOFT_MIN)));
  const pen = energyPenalty(energyFrac);
  return {
    sigmaLat: dist * s.lat * (1 + (LAT_GROWTH - 1) * t) * pen,
    sigmaLong: dist * s.long * (1 + (LONG_GROWTH - 1) * t) * pen,
    sigmaLoft: s.loft * pen,
  };
}

// --- Throw energy budget (D02) -------------------------------------------------------------
// Effort is launch speed weighted by how hard the loft is to deliver: a low roulette is cheap for its speed, a
// high lob costs more (more of the throw goes into height). Knots [loft deg, weight].
const EFFORT_KNOTS = [[8, 0.76], [20, 0.86], [32, 1], [45, 1.05], [55, 1.14], [60, 1.21], [70, 1.42], [75, 1.55]];
export function effortFor(speed, loft) {
  const d = loft / DEG, k = EFFORT_KNOTS;
  let w = k[k.length - 1][1];
  if (d <= k[0][0]) w = k[0][1];
  else for (let i = 1; i < k.length; i++) {
    if (d <= k[i][0]) { w = k[i - 1][1] + (d - k[i - 1][0]) / (k[i][0] - k[i - 1][0]) * (k[i][1] - k[i - 1][1]); break; }
  }
  return speed * w;
}
export const maxEffortOf = (skill) => (typeof skill === 'string' ? SKILL[skill] : skill).maxSpeed || SKILL.human.maxSpeed;

// Fraction of the budget the throw needs (may exceed 1)
export function energyFor({ from = court.throwFrom, landing, loft, skill, terrain }) {
  const sl = solveLaunch({ from, landing, loft, terrain });
  return effortFor(sl.speed, sl.loft) / maxEffortOf(skill);
}

// Pull the donnée toward the thrower along the aim line until the throw fits the budget.
// Returns { landing, clamped, energyFrac } where energyFrac is for the final throw (<= 1 when it fits).
export function fitToBudget({ from = court.throwFrom, landing, loft, skill, terrain }) {
  const e0 = energyFor({ from, landing, loft, skill, terrain });
  if (e0 <= 1) return { landing, clamped: false, energyFrac: e0 };
  const dx = landing.x - from.x, dy = landing.y - from.y;
  const at = (k) => ({ x: from.x + dx * k, y: from.y + dy * k });
  let lo = 0, hi = 1; // lo fits (or is the thrower), hi does not
  const minK = Math.min(1, 0.5 / (Math.hypot(dx, dy) || 1));
  if (energyFor({ from, landing: at(minK), loft, skill, terrain }) > 1) return { landing: at(minK), clamped: true, energyFrac: 1 };
  lo = minK;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (energyFor({ from, landing: at(mid), loft, skill, terrain }) <= 1) lo = mid; else hi = mid;
  }
  const out = at(lo);
  return { landing: out, clamped: true, energyFrac: Math.min(1, energyFor({ from, landing: out, loft, skill, terrain })) };
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
export function executeThrow({ from = court.throwFrom, landing, loft, cone, terrain, rand }) {
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
  throwParams.from = from;
  throwParams.sidespin = Math.max(-SIDESPIN_MAX, Math.min(SIDESPIN_MAX, z * SIDESPIN_PER_SIGMA));
  return { throwParams, actualLanding, lateralError };
}

// Flight path as n+1 points, resampled evenly in time (no collisions). Terrain optional (flat if omitted).
export function arcPath(from, throwParams, n = 40, terrain = null) {
  const t = terrain || { sample: () => ({ h: 0 }) };
  const rec = [];
  flight(from || court.throwFrom, throwParams.yaw, throwParams.speed, throwParams.loft, t, rec);
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
export function coneEnvelope({ from = court.throwFrom, landing, loft, cone, terrain }) {
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

// --- Roughness allowance (D16 for the AI, D19 for the roll guide) -----------------------------
// The perceived terrain has no micro-roughness (the ground jitter), which slows a low throw's roll: on real gravel a
// 14 degree roulette rests 1 to 3 m short of where the smooth model says (D16: perceived 9.0 m vs real 6.3 m).
// A planner (the AI, or the human's roll guide) therefore assumes extra rolling resistance for low throws.
// Calibrated with tests/petanque/measure-throws.js: planned rest vs target over AI-vs-AI mènes (mean shortfall
// 1.1 m roulette / 0.75 m demi before, about 0.1 m after). Full effect at 14 degrees, fading to nothing by 45.
export const ROUGH_K = 1.0;
export const ROUGH_LOFT_FULL = 14 * DEG, ROUGH_LOFT_NONE = 45 * DEG;
export function roughness(loft, k = ROUGH_K) {
  return 1 + k * Math.max(0, Math.min(1, (ROUGH_LOFT_NONE - loft) / (ROUGH_LOFT_NONE - ROUGH_LOFT_FULL)));
}
// `view` with its rolling resistance scaled by roughness(loft). Pass the perceived terrain; `rough` is false when
// there is no unseen roughness (a stub terrain's view is the terrain itself).
export function feltTerrain(view, loft, rough = true, k = ROUGH_K, factor) {
  const f = rough ? (factor || roughness(loft, k)) : 1;
  if (f === 1) return view;
  return { ...view, sample(x, y) { const s = view.sample(x, y); return { ...s, friction: s.friction * f }; }, perceived() { return this; } };
}

// Noiseless sim on the perceived terrain (with the low-loft roughness allowance, D19); returns the thrown body's
// path (every ~1/30 s) until it settles
export function predictRoll({ world, terrain, throwParams, from = court.throwFrom, kind = 'boule', rand, maxSeconds = 12, seed: seed0 = 12345, factor }) {
  let seed = seed0; // fixed local rng so the guide never flickers
  const r = rand || (() => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; });
  const view = terrain.perceived();
  const w = world.clone(feltTerrain(view, throwParams.loft, view !== terrain, ROUGH_K, factor), r);
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

// --- Roll band (D21) -----------------------------------------------------------------------
// The roll guide as a gist: a smooth mean roll-out from touchdown to rest, a half-width that grows with the spread
// of the jittered rolls, and the covariance of the rest points. Built from 17 noiseless sims (the centre plus two rings
// of 8, with the cone's variance) on the perceived terrain with the D19 roughness allowance.
// The paths are resampled by arc length to a few control points, averaged and smoothed (no pebble wiggles).
const BAND_K = 7, BAND_OUT = 4; // control points; output points per control span
const BAND_OFFSETS = [[0, 0]]; // centre, plus two rings of 8 (1.85 and 0.9 sigma: the set has unit variance)
for (const r of [1.85, 0.9]) for (let k = 0; k < 8; k++) BAND_OFFSETS.push([Math.cos(k * Math.PI / 4 + (r < 1 ? Math.PI / 8 : 0)) * r, Math.sin(k * Math.PI / 4 + (r < 1 ? Math.PI / 8 : 0)) * r]);
// The band predicts the mean of many real rolls, so it needs a slightly different allowance than a single planned
// roll: longer at 14 degrees, shorter at 30 (fitted over seeds 1-13 with the test in donnee.test.js).
const BAND_ROUGH = [[14, 2.45], [30, 1.7], [45, 1.15], [60, 0.9]];
export function bandRoughness(loft) {
  const d = loft / DEG, k = BAND_ROUGH;
  if (d <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (d <= k[i][0]) return k[i - 1][1] + (d - k[i - 1][0]) / (k[i][0] - k[i - 1][0]) * (k[i][1] - k[i - 1][1]);
  return k[k.length - 1][1];
}
const bandCaches = new WeakMap(); // terrain -> Map (cached by quantised donnée and loft)

function resampleByLength(pts, K) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const L = cum[cum.length - 1], out = [];
  for (let k = 0; k < K; k++) {
    const s = L * k / (K - 1);
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1], t = seg > 1e-9 ? (s - cum[i - 1]) / seg : 0;
    out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t });
  }
  return out;
}
const catmull = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);

// { world, terrain, from, landing, loft, cone, kind, seed } -> { center: [{x,y,z}], halfWidths, restMean, restCov: {xx,xy,yy}, control }
export function predictRollBand({ world, terrain, from = court.throwFrom, landing, loft, cone, kind = 'boule', seed = 12345 }) {
  const view = terrain.perceived();
  let bandCache = bandCaches.get(terrain);
  if (!bandCache) bandCaches.set(terrain, bandCache = new Map());
  // quantised donnée and loft; the world's boules are part of the key
  let sig = world.bodies.length;
  for (const b of world.bodies) sig += b.x * 7.3 + b.y * 3.1;
  const q = (v, s) => Math.round(v / s);
  const key = `${q(landing.x, 0.01)},${q(landing.y, 0.01)},${q(loft, 0.0035)},${kind},${seed},${sig.toFixed(3)},${q(from.z || 0, 0.01)}`;
  if (bandCache.has(key)) return bandCache.get(key);

  const a = axes(from, landing);
  const sims = [];
  for (const [zl, zg] of BAND_OFFSETS) {
    const lat = zl * cone.sigmaLat, lon = zg * cone.sigmaLong;
    const land = { x: landing.x + a.rx * lat + a.ux * lon, y: landing.y + a.ry * lat + a.uy * lon };
    const tp = solveLaunch({ from, landing: land, loft, terrain: view });
    tp.from = from;
    tp.sidespin = Math.max(-SIDESPIN_MAX, Math.min(SIDESPIN_MAX, zl * SIDESPIN_PER_SIGMA));
    const full = predictRoll({ world, terrain, throwParams: tp, from, kind, seed, factor: bandRoughness(loft), rand: () => 0.5 }); // rand 0.5: no tilt or bounce jitter, so the roll is a smooth function of the donnée
    const hit = full.findIndex((p) => p.z <= terrain.sample(p.x, p.y).h + 0.1);
    const path = hit < 0 ? [full[full.length - 1], full[full.length - 1]] : full.slice(hit);
    if (path.length < 2) path.push(path[0]);
    sims.push(path);
  }
  const rs = sims.map((p) => resampleByLength(p, BAND_K));
  const n = rs.length;
  let ctl = [];
  for (let k = 0; k < BAND_K; k++) ctl.push({ x: rs.reduce((s, r) => s + r[k].x, 0) / n, y: rs.reduce((s, r) => s + r[k].y, 0) / n });
  const restMean = { x: ctl[BAND_K - 1].x, y: ctl[BAND_K - 1].y };
  let sxx = 0, sxy = 0, syy = 0;
  for (const r of rs) {
    const dx = r[BAND_K - 1].x - restMean.x, dy = r[BAND_K - 1].y - restMean.y;
    sxx += dx * dx / n; sxy += dx * dy / n; syy += dy * dy / n;
  }
  // smooth the mean path (endpoints fixed)
  for (let it = 0; it < 2; it++) {
    const c0 = ctl;
    ctl = c0.map((p, k) => (k === 0 || k === BAND_K - 1) ? p : { x: (c0[k - 1].x + 2 * p.x + c0[k + 1].x) / 4, y: (c0[k - 1].y + 2 * p.y + c0[k + 1].y) / 4 });
  }
  // lateral spread at each control point, across the path's local direction
  const hw = [];
  for (let k = 0; k < BAND_K; k++) {
    const pa = ctl[Math.max(0, k - 1)], pb = ctl[Math.min(BAND_K - 1, k + 1)];
    let tx = pb.x - pa.x, ty = pb.y - pa.y;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-3) { tx = a.ux; ty = a.uy; } else { tx /= tl; ty /= tl; }
    let s2 = 0;
    for (const r of rs) s2 += ((r[k].x - ctl[k].x) * -ty + (r[k].y - ctl[k].y) * tx) ** 2 / n;
    hw.push(Math.max(0.05, Math.sqrt(s2)));
  }
  const hws = hw.map((h, k) => (k === 0 || k === BAND_K - 1) ? h : (hw[k - 1] + 2 * h + hw[k + 1]) / 4);
  const g = (i) => ctl[Math.max(0, Math.min(BAND_K - 1, i))], h = (i) => hws[Math.max(0, Math.min(BAND_K - 1, i))];
  const center = [], halfWidths = [];
  for (let k = 0; k < BAND_K - 1; k++) {
    for (let j = 0; j < BAND_OUT; j++) {
      const t = j / BAND_OUT;
      const x = catmull(g(k - 1).x, g(k).x, g(k + 1).x, g(k + 2).x, t), y = catmull(g(k - 1).y, g(k).y, g(k + 1).y, g(k + 2).y, t);
      center.push({ x, y, z: terrain.sample(x, y).h });
      halfWidths.push(Math.max(0.05, catmull(h(k - 1), h(k), h(k + 1), h(k + 2), t)));
    }
  }
  const last = ctl[BAND_K - 1];
  center.push({ x: last.x, y: last.y, z: terrain.sample(last.x, last.y).h });
  halfWidths.push(hws[BAND_K - 1]);
  const out = { center, halfWidths, restMean, restCov: { xx: sxx, xy: sxy, yy: syy }, control: ctl };
  bandCache.set(key, out);
  if (bandCache.size > 40) bandCache.delete(bandCache.keys().next().value);
  return out;
}
