// F81: butterflies are rare visits. Pure scheduling and path logic first (no three.js use), meshes below.
// createVisitScheduler(seed, opts) -> { step(dt, { busy }) -> events[] }: the first visit 60-150 s after the game starts, then one
// every 3-6 minutes of unpaused play (never starting while `busy`: the human's aim/throw or a boule in flight; the visit waits for
// the next quiet moment). Event: { type: 'visit', t, butterflies: [params] } with 2-4 params per visit.
// butterflyPath(params, t, out?) -> { pos: {x,y,z}, opacity, flap, amp, heading }: world metres in court coordinates (x across,
// y along, z up from the grass plane), t seconds since the visit started. Spot on the grass margin 4-14 m from the court edge
// (mostly in the shoulder camera's view, outside the throwing circle), 0.1 m up, opacity 0 -> 1 over 1.5 s while lifting off, then an
// ascending, erratic-then-steadier flight away from the court (slightly downwind) to 15-30 m, fading out over the last 3 s.
import * as THREE from '../vendor/three.module.js';
import { C } from './constants.js';
import { mulberry32 } from './rng.js';

export const BF = {
  firstMin: 60, firstMax: 150, gapMin: 180, gapMax: 360, // seconds
  countMin: 2, countMax: 4, pool: 4,
  edgeMin: 4, edgeMax: 14, // spot distance from the court rectangle
  fadeIn: 1.5, fadeOut: 3, riseMin: 14, riseMax: 20, altMin: 15, altMax: 30, startZ: [0.1, 0.3], maxDelay: 2.5,
  wind: Object.freeze({ x: 0.9, y: 0.35 }), // unit-ish downwind direction used for the slight drift
  keepOut: Object.freeze([Object.freeze({ x: C.circle.x, y: C.circle.y, r: 3.5 })]), // throwing circle / player area
  debugFirst: 0.5, debugEvery: 20,
};
export const visitDuration = (p) => p.delay + p.rise + BF.fadeOut;

const TAU = Math.PI * 2;
const rectDist = (x, y) => Math.hypot(Math.max(-x, 0, x - C.terrainW), Math.max(-y, 0, y - C.terrainL));
const inKeepOut = (x, y) => BF.keepOut.some((c) => Math.hypot(x - c.x, y - c.y) < c.r);
// within about +-32 degrees of the shoulder camera's line of sight (from the circle, looking along +y)
const seen = (x, y) => y - C.circle.y > 3 && Math.abs(x - C.circle.x) <= 0.62 * (y - C.circle.y);
const okSpot = (x, y) => { const d = rectDist(x, y); return d >= BF.edgeMin && d <= BF.edgeMax && !inKeepOut(x, y); };

function pickSpot(rand, wantSeen) {
  for (let k = 0; k < 60; k++) {
    const x = -BF.edgeMax + rand() * (C.terrainW + 2 * BF.edgeMax), y = -BF.edgeMax + rand() * (C.terrainL + 2 * BF.edgeMax);
    if (okSpot(x, y) && (!wantSeen || seen(x, y))) return { x, y };
  }
  return { x: C.terrainW + 6, y: C.terrainL * 0.6 }; // fallback: beside the court on the far side of the shoulder view
}

function makeVisit(rand, i, centre, wantSeen) {
  let x = centre.x, y = centre.y;
  for (let k = 0; k < 10; k++) { // scatter around the visit's centre
    const sx = centre.x + (rand() * 2 - 1) * 2.5, sy = centre.y + (rand() * 2 - 1) * 2.5;
    if (okSpot(sx, sy) && (!wantSeen || seen(sx, sy))) { x = sx; y = sy; break; }
  }
  // heading: away from the court's centre, bent a little downwind
  let ax = x - C.terrainW / 2, ay = y - C.terrainL / 2; const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
  const wl = Math.hypot(BF.wind.x, BF.wind.y);
  const dx = ax + 0.35 * BF.wind.x / wl, dy = ay + 0.35 * BF.wind.y / wl;
  const rise = BF.riseMin + rand() * (BF.riseMax - BF.riseMin);
  return {
    x, y, z0: BF.startZ[0] + rand() * (BF.startZ[1] - BF.startZ[0]),
    dir: Math.atan2(dy, dx), reach: 14 + rand() * 12, // horizontal metres travelled over the visit
    height: BF.altMin + rand() * (BF.altMax - BF.altMin),
    delay: i === 0 ? 0 : rand() * BF.maxDelay, rise, colour: Math.floor(rand() * 3),
    flapRate: 8 + rand() * 3, w1: 3 + rand() * 2, w2: 6.5 + rand() * 2.5, ph1: rand() * TAU, ph2: rand() * TAU, wob: 0.5 + rand() * 0.5,
  };
}

export function createVisitScheduler(seed, { debug = false } = {}) {
  const rand = mulberry32(seed * 7919 + 13);
  let t = 0;
  let next = debug ? BF.debugFirst : BF.firstMin + rand() * (BF.firstMax - BF.firstMin);
  const gap = () => (debug ? BF.debugEvery : BF.gapMin + rand() * (BF.gapMax - BF.gapMin));
  return {
    get time() { return t; }, get next() { return next; },
    step(dt, { busy = false } = {}) {
      const ev = [];
      if (!(dt > 0)) return ev; // paused: frozen
      t += Math.min(dt, 5);
      if (t < next || busy) return ev; // wait for the next quiet moment
      const n = BF.countMin + Math.floor(rand() * (BF.countMax - BF.countMin + 1));
      const wantSeen = rand() < 0.85, centre = pickSpot(rand, wantSeen), list = [];
      for (let i = 0; i < n; i++) list.push(makeVisit(rand, i, centre, wantSeen));
      ev.push({ type: 'visit', t, butterflies: list });
      next = t + gap();
      return ev;
    },
  };
}

const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };

export function butterflyPath(p, t, out) {
  const o = out || { pos: { x: 0, y: 0, z: 0 }, opacity: 0, flap: 0, amp: 1, heading: 0 };
  const D = p.rise + BF.fadeOut, lt = t - p.delay, u = Math.min(1, Math.max(0, lt / D));
  o.opacity = lt <= 0 || lt >= D ? 0 : Math.min(smooth(lt / BF.fadeIn), smooth((D - lt) / BF.fadeOut));
  const calm = (1 - u) * (1 - u), ramp = smooth(lt / 2); // erratic flutter decays into a steady glide; it starts from the spot
  const run = p.reach * (0.25 * u + 0.75 * u * u * (3 - 2 * u)) * 1; // slow near the grass, steadier later
  const lat = p.wob * calm * ramp * (Math.sin(p.w1 * lt + p.ph1) + 0.6 * Math.sin(p.w2 * lt + p.ph2));
  const fwd = 0.25 * calm * ramp * Math.sin(p.w2 * 0.8 * lt + p.ph1);
  const c = Math.cos(p.dir), s = Math.sin(p.dir);
  o.pos.x = p.x + c * (run + fwd) - s * lat;
  o.pos.y = p.y + s * (run + fwd) + c * lat;
  const z = p.z0 + (p.height - p.z0) * Math.pow(u, 1.4);
  const bob = 0.45 * calm * ramp * Math.sin(p.w2 * 1.1 * lt + p.ph2) * Math.min(1, Math.max(0, z - 0.05) * 2);
  o.pos.z = Math.max(0.05, z + bob);
  o.heading = p.dir + 0.9 * calm * Math.cos(p.w1 * lt + p.ph1);
  const l = Math.max(0, lt);
  o.flap = TAU * (p.flapRate * l - 0.45 * p.flapRate * l * l / (2 * D)); // flapping slows as it settles into the glide
  o.amp = 1 - 0.45 * u;
  return o;
}

// ---------- meshes ----------
const COLOURS = [['#f2d230', '#2a2210'], ['#f4f1e6', '#3a3a3a'], ['#4f86d8', '#14203a']]; // yellow, white, blue (+ dark edge)

function wingGeometry(side, wingCol, edgeCol) {
  // forewing and hindwing triangles in the body frame (x forward, y out to the side, z up); mirrored for the other side
  const s = side;
  const p = [0.0, 0, 0, 0.05, 0.12 * s, 0, 0.14, 0.01 * s, 0, // forewing: root, tip back, front
    0.0, 0, 0, -0.1, 0.06 * s, 0, 0.0, 0.1 * s, 0.001]; // hindwing
  const w = new THREE.Color(wingCol), e = new THREE.Color(edgeCol), col = [];
  const mix = (a, b, t) => a.clone().lerp(b, t);
  const cs = [w, mix(w, e, 0.7), mix(w, e, 0.4), w, mix(w, e, 0.55), mix(w, e, 0.2)];
  for (const c of cs) col.push(c.r, c.g, c.b);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function makeButterflies(z, seed) {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  if (seed === undefined) seed = +q.get('seed') || (Date.now() % 100000);
  const dbg = globalThis.__DEBUG__ !== false && q.has('debug') && q.has('butterflies'); // ?debug&butterflies: a visit right at the start, and every 20 s
  const sched = createVisitScheduler(seed, { debug: dbg });
  const group = new THREE.Group(); group.position.z = z; group.visible = false;
  const body = new THREE.BoxGeometry(0.1, 0.014, 0.014);
  const geos = COLOURS.map(([a, b]) => [wingGeometry(1, a, b), wingGeometry(-1, a, b)]);
  const SCALE = 1.6;
  const slots = [];
  for (let i = 0; i < BF.pool; i++) { // a small pool, reused each visit; own materials so opacity is per butterfly
    const mats = COLOURS.map(() => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true, transparent: true, depthWrite: false, opacity: 0 }));
    const bodyMat = new THREE.MeshBasicMaterial({ color: '#1e1a14', transparent: true, opacity: 0 });
    const g = new THREE.Group(); g.visible = false; g.scale.setScalar(SCALE);
    const left = new THREE.Mesh(geos[0][0], mats[0]), right = new THREE.Mesh(geos[0][1], mats[0]);
    const b = new THREE.Mesh(body, bodyMat); b.position.x = 0.04;
    left.frustumCulled = right.frustumCulled = b.frustumCulled = false;
    g.add(left, right, b); group.add(g);
    slots.push({ g, left, right, mats, bodyMat, geos, p: null, t: 0, out: { pos: { x: 0, y: 0, z: 0 }, opacity: 0, flap: 0, amp: 1, heading: 0 } });
  }
  const start = (s, p) => {
    s.p = p; s.t = 0;
    s.left.geometry = geos[p.colour][0]; s.right.geometry = geos[p.colour][1];
    s.left.material = s.right.material = s.mats[p.colour];
  };
  const hideAll = () => { for (const s of slots) { s.p = null; s.g.visible = false; } group.visible = false; };
  const show = (s) => {
    const o = butterflyPath(s.p, s.t, s.out);
    if (o.opacity <= 0) { s.g.visible = false; return; }
    s.g.visible = true; s.g.position.set(o.pos.x, o.pos.y, o.pos.z); s.g.rotation.z = o.heading;
    const a = 0.35 + 0.75 * o.amp * Math.sin(o.flap) + (1 - o.amp) * 0.4;
    s.left.rotation.x = a; s.right.rotation.x = -a;
    s.mats[s.p.colour].opacity = o.opacity; s.bodyMat.opacity = o.opacity;
  };
  let active = 0;
  // dt 0 (paused): frozen; reduced motion: no visits at all
  return {
    group, sched, get active() { return active; },
    update(dt, reduced, busy) {
      if (reduced) { if (active) { hideAll(); active = 0; } return; }
      if (!(dt > 0)) return;
      if (dt > 0.25) dt = 0.25;
      const ev = sched.step(dt, { busy: !!busy });
      for (let e = 0; e < ev.length; e++) for (const p of ev[e].butterflies) { const s = slots.find((x) => !x.p); if (s) start(s, p); }
      active = 0;
      for (const s of slots) {
        if (!s.p) continue;
        s.t += dt;
        if (s.t >= visitDuration(s.p)) { s.p = null; s.g.visible = false; continue; }
        active++; show(s);
      }
      group.visible = active > 0;
    },
  };
}
