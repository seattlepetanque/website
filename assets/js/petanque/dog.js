// F70: a napping dog by the sideline. Pure placement and animation schedule (testable in node), plus the low-poly mesh.
// Placement: a seeded spot on the grass 2.5-3 m outside the left-hand timbers, 6.5-10.5 m along the court, inside the shadow of
// the left fir (the sun offset points to -x/-y, so shadows run toward +x/+y). Waiting slots sit 1 m outside the string lines
// (waiting.js), so the dog stays 2 m+ from every slot and from the lines people walk (DOG_KEEPOUT).
import * as THREE from '../vendor/three.module.js';
import { C } from './constants.js';
import { mulberry32 } from './rng.js';

export const DOG_KEEPOUT = 2; // m: never nearer than this to a waiting slot / walking route
export const DOG_SUN = Object.freeze({ x: -5, y: -7, z: 6 }); // same as render.js sunOffset
export const DOG_SHADE_TREE = Object.freeze({ x: -7.0, y: 3.5, height: 11.2, halfWidth: 1.6 }); // the left fir (scenery.js TREES)
const OUT_MIN = 2.5, OUT_MAX = 3.0, Y_MIN = 6.5, Y_MAX = 10.5;

// Is (x, y) inside the shadow strip of a tree under the sun offset?
export function inTreeShade(x, y, tree = DOG_SHADE_TREE, sun = DOG_SUN) {
  const hl = Math.hypot(sun.x, sun.y), ux = -sun.x / hl, uy = -sun.y / hl;
  const len = Math.min(18, tree.height / (sun.z / hl));
  const dx = x - tree.x, dy = y - tree.y;
  const s = dx * ux + dy * uy, c = dx * uy - dy * ux;
  return s > 2 && s < len && Math.abs(c) <= tree.halfWidth;
}

// -> { x, y, yaw, side: -1, shaded }. Deterministic per seed.
export function placeDog(seed) {
  const rand = mulberry32((seed >>> 0) * 53 + 11);
  const lumberOut = C.lumberGap + C.lumberSize;
  let best = null;
  for (let i = 0; i < 40; i++) {
    const x = -lumberOut - (OUT_MIN + rand() * (OUT_MAX - OUT_MIN));
    const y = Y_MIN + rand() * (Y_MAX - Y_MIN);
    if (inTreeShade(x, y)) { best = { x, y, shaded: true }; break; }
    if (!best) best = { x, y, shaded: false };
  }
  if (!best.shaded) { // no luck: slide onto the shadow's centre line at this x
    const hl = Math.hypot(DOG_SUN.x, DOG_SUN.y), ux = -DOG_SUN.x / hl, uy = -DOG_SUN.y / hl;
    best = { x: best.x, y: DOG_SHADE_TREE.y + (best.x - DOG_SHADE_TREE.x) * uy / ux, shaded: true };
  }
  return { x: best.x, y: best.y, yaw: rand() * Math.PI * 2, side: -1, shaded: best.shaded };
}

// ---- Animation schedule ------------------------------------------------------------------------------------------------
export const DOG_ANIM = Object.freeze({
  breathHz: 0.25, chestRise: 0.025, // m peak (chest rises 0..2.5 cm)
  ear: { gap: [6, 15], dur: 0.35, amp: 0.45 }, // rad
  tail: { gap: [10, 25], beats: [2, 3], beat: 0.4, amp: 0.4 },
  head: { gap: [60, 120], up: 1.2, hold: 3, down: 2.5, amp: 0.55 },
  horizon: 7200, // s of pre-generated schedule; time wraps after that
});

function gen(rand, [lo, hi], horizon, first) {
  const out = [];
  for (let t = first ?? lo + rand() * (hi - lo); t < horizon; t += lo + rand() * (hi - lo)) out.push(t);
  return out;
}

// createDogAnim(seed) -> { pose(t, out), schedule }; pose fills out { rise (m), earL, earR (rad), tail (rad), head (rad) } without allocating.
export function createDogAnim(seed) {
  const A = DOG_ANIM, rand = mulberry32((seed >>> 0) * 97 + 3);
  const ears = gen(rand, A.ear.gap, A.horizon), earSide = ears.map(() => (rand() < 0.5 ? 0 : 1));
  const tails = gen(rand, A.tail.gap, A.horizon), tailBeats = tails.map(() => A.tail.beats[0] + Math.floor(rand() * (A.tail.beats[1] - A.tail.beats[0] + 1)));
  const heads = gen(rand, A.head.gap, A.horizon);
  const phase = rand();
  const lastBefore = (arr, t) => { // index of the last event <= t, or -1 (binary search)
    let lo = 0, hi = arr.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  };
  const pose = (t, out) => {
    t = ((t % A.horizon) + A.horizon) % A.horizon;
    out.rise = A.chestRise * 0.5 * (1 - Math.cos(2 * Math.PI * (A.breathHz * t + phase)));
    out.earL = 0; out.earR = 0;
    let i = lastBefore(ears, t);
    if (i >= 0 && t - ears[i] < A.ear.dur) {
      const u = (t - ears[i]) / A.ear.dur, v = A.ear.amp * Math.sin(Math.PI * u) * Math.cos(u * Math.PI * 3);
      if (earSide[i]) out.earR = v; else out.earL = v;
    }
    out.tail = 0;
    i = lastBefore(tails, t);
    if (i >= 0) {
      const u = t - tails[i], n = tailBeats[i];
      if (u < n * A.tail.beat) out.tail = A.tail.amp * Math.sin(Math.PI * ((u / A.tail.beat) % 1));
    }
    out.head = 0;
    i = lastBefore(heads, t);
    if (i >= 0) {
      const u = t - heads[i], { up, hold, down, amp } = A.head, sm = (x) => x * x * (3 - 2 * x);
      if (u < up) out.head = amp * sm(u / up);
      else if (u < up + hold) out.head = amp;
      else if (u < up + hold + down) out.head = amp * (1 - sm((u - up - hold) / down));
    }
    return out;
  };
  return { pose, schedule: { ears, earSide, tails, tailBeats, heads } };
}

// ---- Mesh --------------------------------------------------------------------------------------------------------------
const TAN = new THREE.Color('#c8995f'), BROWN = new THREE.Color('#6f4426'), WHITE = new THREE.Color('#eee6d6'), DARK = new THREE.Color('#2b1c14');
const SCALE = 1.2; // slight exaggeration so it reads at distance

// A faceted ellipsoid (icosahedron, flat shading) with radii r, centred c (local x forward, y left, z up), coloured by colorFn(x, y, z)
function blob(r, c, colorFn) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  g.scale(r[0], r[1], r[2]); g.translate(c[0], c[1], c[2]);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), t = new THREE.Color();
  for (let i = 0; i < p.count; i++) { colorFn(p.getX(i) - c[0], p.getY(i) - c[1], p.getZ(i) - c[2], t); col[i * 3] = t.r; col[i * 3 + 1] = t.g; col[i * 3 + 2] = t.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const solid = (k) => (x, y, z, o) => o.copy(k);
function bodyColor(x, y, z, o) {
  if (z < -0.08) o.copy(WHITE); // belly
  else if (z > 0.06 && x > -0.12 && x < 0.15) o.copy(BROWN); // saddle patch
  else if (x < -0.18 && y > 0.05) o.copy(BROWN);
  else o.copy(TAN);
}

// makeDog(terrain, seed) -> { group, update(dt, reduced), place } ; animates rotation/scale only
export function makeDog(terrain, seed, anim) {
  if (seed === undefined) seed = (typeof location !== 'undefined' && +new URLSearchParams(location.search).get('seed')) || (Date.now() % 100000);
  anim = anim || createDogAnim(seed);
  const place = placeDog(seed);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mk = (geo, parent) => { const m = new THREE.Mesh(geo, mat); parent.add(m); return m; };
  const group = new THREE.Group(); // origin on the ground
  const inner = new THREE.Group(); inner.scale.setScalar(SCALE); group.add(inner);
  const BODY_Z = 0.15;
  const bodyGrp = new THREE.Group(); bodyGrp.position.z = 0; inner.add(bodyGrp);
  const body = mk(blob([0.3, 0.2, 0.15], [0, 0, 0], bodyColor), bodyGrp); body.position.z = BODY_Z;
  mk(blob([0.14, 0.12, 0.1], [-0.17, 0.1, 0.0], bodyColor), bodyGrp).position.z = 0.1; // haunch
  // paws tucked in front, head resting on them
  const pawG = blob([0.09, 0.05, 0.04], [0, 0, 0], solid(WHITE));
  mk(pawG, bodyGrp).position.set(0.34, -0.03, 0.04);
  mk(pawG, bodyGrp).position.set(0.34, 0.12, 0.04);
  const head = new THREE.Group(); head.position.set(0.3, 0.07, 0.12); inner.add(head); // neck pivot
  const hm = (x, y, z, o) => { if (x > 0.08 && z < 0.0) o.copy(WHITE); else if (x < 0.02 && y > 0.04) o.copy(BROWN); else o.copy(TAN); };
  mk(blob([0.12, 0.09, 0.085], [0.06, 0.02, -0.03], hm), head);
  mk(blob([0.08, 0.055, 0.05], [0.17, 0.02, -0.06], (x, y, z, o) => o.copy(z < -0.01 ? WHITE : TAN)), head); // muzzle
  mk(blob([0.025, 0.02, 0.018], [0.245, 0.02, -0.04], solid(DARK)), head); // nose
  const earMesh = blob([0.06, 0.035, 0.07], [0, 0, -0.06], solid(BROWN));
  const earL = new THREE.Group(), earR = new THREE.Group();
  earL.position.set(0.03, 0.09, 0.04); earR.position.set(0.03, -0.07, 0.04);
  mk(earMesh, earL); mk(earMesh, earR); earL.rotation.x = -0.5; earR.rotation.x = 0.5;
  head.add(earL, earR);
  const tail = new THREE.Group(); tail.position.set(-0.27, 0.12, 0.09); inner.add(tail);
  mk(blob([0.14, 0.04, 0.04], [-0.1, 0.06, 0], (x, y, z, o) => o.copy(x < -0.2 ? WHITE : TAN)), tail).rotation.z = 0.5;
  tail.rotation.y = 0;
  group.rotation.z = place.yaw;
  const z0 = terrain && terrain.sample ? (() => { try { return terrain.sample(place.x, place.y).h; } catch (e) { return -0.03; } })() : -0.03;
  const inGrid = place.x > -C.terrainPad && place.x < C.terrainW + C.terrainPad && place.y > -C.terrainPad && place.y < C.terrainL + C.terrainPad;
  group.position.set(place.x, place.y, inGrid ? z0 : -0.03);

  const p = { rise: 0, earL: 0, earR: 0, tail: 0, head: 0 };
  let t = 0, applied = false;
  const apply = () => {
    const k = p.rise;
    bodyGrp.scale.set(1 + k * 0.4, 1 + k * 0.8, 1 + k / 0.3); // chest rise of `rise` m on a 0.3 m body (x SCALE on screen)
    bodyGrp.position.z = 0; body.position.z = BODY_Z;
    head.rotation.y = -p.head; head.position.z = 0.12 + k * 0.5;
    earL.rotation.x = -0.5 + p.earL; earR.rotation.x = 0.5 - p.earR;
    tail.rotation.z = p.tail; // swings about the root
  };
  return {
    group, place, anim,
    update(dt, reduced) {
      if (reduced) { if (applied === 'r') return; p.rise = 0; p.earL = p.earR = p.tail = p.head = 0; apply(); applied = 'r'; return; }
      if (!(dt > 0) && applied === true) return; // paused: frozen
      t += dt > 0 ? Math.min(dt, 0.25) : 0;
      anim.pose(t, p); apply(); applied = true;
    },
  };
}
