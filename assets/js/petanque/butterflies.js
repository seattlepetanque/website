// F67: low-poly butterflies and drifting dandelion seeds. Part 1 is pure motion logic (no three.js use):
// createButterflyField(seed, opts) -> { flies, seeds, wind, step(dt, wind?) }. World metres, court coordinates (x across,
// y along, z up, relative to the grass plane). Butterflies flutter erratically between waypoints along the grass margins and
// court edges (now and then crossing an edge), 0.3-2 m high, within R metres of the court, never inside a keep-out circle
// (the throwing circle / player area). Seeds drift slowly downwind with a slow bob and respawn upwind when they leave.
// step(0, ...) changes nothing (paused). Part 2 (makeButterflies) builds the meshes.
import * as THREE from '../vendor/three.module.js';
import { C } from './constants.js';
import { mulberry32 } from './rng.js';

export const BF = {
  radius: 25, // max distance from the court rectangle
  zMin: 0.3, zMax: 2, maxSpeed: 2.2, glideSpeed: 0.7,
  seedZMin: 0.25, seedZMax: 3.2, seedCount: 14,
  keepOut: Object.freeze([Object.freeze({ x: C.circle.x, y: C.circle.y, r: 3.5 })]), // throwing circle / player area
};

const TAU = Math.PI * 2;
// distance outside the court rectangle (0 inside)
const rectDist = (x, y) => Math.hypot(Math.max(-x, 0, x - C.terrainW), Math.max(-y, 0, y - C.terrainL));

export function createButterflyField(seed, { count, seedCount = BF.seedCount, keepOut = BF.keepOut } = {}) {
  const rand = mulberry32(seed * 104729 + 7);
  const W = C.terrainW, L = C.terrainL;
  const n = count || 3 + Math.floor(rand() * 4);
  const wind = { x: 0.3, y: 0.1, speed: 0.3, t: 0, base: rand() * TAU };
  const out = { x: 0, y: 0 };
  // push (x, y) out of every keep-out circle (writes into `out`)
  const clearOf = (x, y, pad = 0) => {
    for (let k = 0; k < keepOut.length; k++) {
      const c = keepOut[k], dx = x - c.x, dy = y - c.y, d = Math.hypot(dx, dy), r = c.r + pad;
      if (d < r) { if (d < 1e-6) { x = c.x; y = c.y + r; } else { x = c.x + dx / d * r; y = c.y + dy / d * r; } }
    }
    out.x = x; out.y = y;
  };
  // a waypoint on the margins: 0.5-7 m outside a random court edge (or 15 % just inside it), clear of the keep-out circles
  const pickTarget = (f) => {
    const side = Math.floor(rand() * 4), off = rand() < 0.15 ? -0.2 - rand() * 0.8 : 0.5 + rand() * 6.5;
    let x, y;
    if (side < 2) { x = side ? W + off : -off; y = rand() * L; } else { y = side === 3 ? L + off : -off; x = rand() * W; }
    // sometimes wander further out along the grass
    if (rand() < 0.3) { x += (rand() * 2 - 1) * 8; y += (rand() * 2 - 1) * 8; }
    clearOf(x, y, 0.5);
    f.tx = out.x; f.ty = out.y; f.tz = BF.zMin + rand() * 1.4; f.hold = 4 + rand() * 8;
  };
  const flies = [];
  for (let i = 0; i < n; i++) {
    const f = { x: 0, y: 0, z: 1, vx: 0, vy: 0, heading: rand() * TAU, tx: 0, ty: 0, tz: 1, hold: 0, glide: 0, flap: rand() * TAU, flapRate: 0, amp: 1, colour: i % 3, turn: 0, kick: 0 };
    pickTarget(f); f.x = f.tx; f.y = f.ty; f.z = f.tz; pickTarget(f);
    f.flapRate = 7 + rand() * 4; f.glide = rand() * 3;
    flies.push(f);
  }
  const seedsArr = [];
  const respawn = (s, anywhere) => {
    // upwind side of the area (or anywhere at the start); clear of the keep-out circles
    const cx = W / 2, cy = L / 2, wl = Math.hypot(wind.x, wind.y) || 1, ux = wind.x / wl, uy = wind.y / wl;
    for (let tries = 0; tries < 20; tries++) {
      let x, y;
      if (anywhere) { x = (rand() * 2 - 1) * 20 + cx; y = (rand() * 2 - 1) * 20 + cy; }
      else { const along = -(14 + rand() * 6), lat = (rand() * 2 - 1) * 18; x = cx + ux * along - uy * lat; y = cy + uy * along + ux * lat; }
      if (rectDist(x, y) <= BF.radius - 2) { s.x = x; s.y = y; break; }
    }
    clearOf(s.x, s.y, 0.3); s.x = out.x; s.y = out.y;
    s.z = BF.seedZMin + rand() * (BF.seedZMax - BF.seedZMin); s.phase = rand() * TAU; s.rate = 0.5 + rand() * 0.6; s.amp = 0.12 + rand() * 0.2;
    s.base = s.z; s.speedK = 0.7 + rand() * 0.6;
  };
  for (let i = 0; i < seedCount; i++) { const s = { x: W / 2, y: L / 2, z: 1, phase: 0, rate: 1, amp: 0.2, base: 1, speedK: 1, vx: 0, vy: 0 }; respawn(s, true); seedsArr.push(s); }

  const stepFly = (f, dt) => {
    f.hold -= dt; f.glide -= dt;
    if (f.glide < -(0.6 + (f.flapRate % 1) * 1.5)) f.glide = 1 + rand() * 2.5; // alternate flutter bursts and gentle glides
    const gliding = f.glide > 0;
    f.amp = gliding ? 0.25 : 1;
    const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy);
    if (d < 0.8 || f.hold <= 0) pickTarget(f);
    // erratic turning (smooth noise) while fluttering, a steady heading while gliding
    f.kick -= dt;
    if (f.kick <= 0) { f.turn = (rand() * 2 - 1) * (gliding ? 0.4 : 3.2); f.kick = (gliding ? 0.6 : 0.15) + rand() * 0.3; }
    const want = Math.atan2(dy, dx);
    let da = want - f.heading; da = Math.atan2(Math.sin(da), Math.cos(da));
    f.heading += (da * 1.1 + f.turn) * dt;
    const sp = gliding ? BF.glideSpeed : BF.glideSpeed + 0.6 + 0.6 * Math.abs(Math.sin(f.flap * 0.13));
    const tvx = Math.cos(f.heading) * Math.min(sp, BF.maxSpeed) + wind.x * 0.5, tvy = Math.sin(f.heading) * Math.min(sp, BF.maxSpeed) + wind.y * 0.5;
    const k = Math.min(1, dt * 3);
    f.vx += (tvx - f.vx) * k; f.vy += (tvy - f.vy) * k;
    const v = Math.hypot(f.vx, f.vy); if (v > BF.maxSpeed) { f.vx *= BF.maxSpeed / v; f.vy *= BF.maxSpeed / v; }
    f.x += f.vx * dt; f.y += f.vy * dt;
    f.z += (f.tz - f.z) * Math.min(1, dt * 0.8) + Math.sin(f.flap * 0.5) * 0.35 * dt;
    f.z = Math.min(BF.zMax, Math.max(BF.zMin, f.z));
    // keep-out circles: slide out along the boundary and turn away
    clearOf(f.x, f.y);
    if (out.x !== f.x || out.y !== f.y) { f.x = out.x; f.y = out.y; f.heading += 0.8; pickTarget(f); }
    // region bound: stay within radius of the court
    const rd = rectDist(f.x, f.y);
    if (rd > BF.radius) {
      const cx = Math.min(Math.max(f.x, 0), W), cy = Math.min(Math.max(f.y, 0), L), s = BF.radius / rd;
      f.x = cx + (f.x - cx) * s; f.y = cy + (f.y - cy) * s; pickTarget(f);
    }
    if (!gliding || f.amp > 0.9) f.flap += TAU * f.flapRate * dt;
    else f.flap += TAU * f.flapRate * 0.15 * dt;
  };

  function step(dt, w) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    wind.t += dt;
    if (w && typeof w.x === 'number') { wind.x = w.x; wind.y = w.y; }
    else { // slow varying breeze
      const a = wind.base + 0.6 * Math.sin(wind.t / 41) + 0.4 * Math.sin(wind.t / 17 + 1), sp = 0.45 + 0.2 * Math.sin(wind.t / 29 + 2);
      wind.x = Math.cos(a) * sp; wind.y = Math.sin(a) * sp;
    }
    for (let i = 0; i < flies.length; i++) stepFly(flies[i], dt);
    for (let i = 0; i < seedsArr.length; i++) {
      const s = seedsArr[i];
      s.x += wind.x * s.speedK * dt; s.y += wind.y * s.speedK * dt;
      s.phase += TAU * s.rate / 4 * dt;
      s.z = Math.min(BF.seedZMax, Math.max(BF.seedZMin, s.base + Math.sin(s.phase) * s.amp * 2));
      s.base += (0.05 * Math.sin(s.phase * 0.37 + i)) * dt;
      clearOf(s.x, s.y, 0.3); s.x = out.x; s.y = out.y;
      if (rectDist(s.x, s.y) > BF.radius - 1) respawn(s, false);
    }
  }
  return { flies, seeds: seedsArr, wind, step };
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

function dotSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c); return t;
}

export function makeButterflies(z, seed) {
  if (seed === undefined) seed = (typeof location !== 'undefined' && +new URLSearchParams(location.search).get('seed')) || (Date.now() % 100000);
  const field = createButterflyField(seed);
  const group = new THREE.Group(); group.position.z = z;
  const body = new THREE.BoxGeometry(0.1, 0.014, 0.014);
  const bodyMat = new THREE.MeshBasicMaterial({ color: '#1e1a14' });
  const wingMats = COLOURS.map(() => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }));
  const geos = COLOURS.map(([a, b]) => [wingGeometry(1, a, b), wingGeometry(-1, a, b)]);
  const rigs = field.flies.map((f) => {
    const g = new THREE.Group();
    const left = new THREE.Mesh(geos[f.colour][0], wingMats[f.colour]), right = new THREE.Mesh(geos[f.colour][1], wingMats[f.colour]);
    const b = new THREE.Mesh(body, bodyMat); b.position.x = 0.04;
    left.frustumCulled = right.frustumCulled = b.frustumCulled = false;
    g.add(left, right, b); group.add(g);
    return { g, left, right };
  });
  const N = field.seeds.length, pos = new Float32Array(N * 3);
  const pg = new THREE.BufferGeometry(); const attr = new THREE.BufferAttribute(pos, 3); pg.setAttribute('position', attr);
  const pm = new THREE.PointsMaterial({ color: '#ffffff', size: 0.09, map: dotSprite(), transparent: true, depthWrite: false, sizeAttenuation: true, opacity: 0.9 });
  const points = new THREE.Points(pg, pm); points.frustumCulled = false; group.add(points);
  const sync = (still) => {
    for (let i = 0; i < rigs.length; i++) {
      const f = field.flies[i], r = rigs[i];
      r.g.position.set(f.x, f.y, f.z); r.g.rotation.z = f.heading;
      const a = still ? 0.55 : 0.35 + 0.75 * f.amp * Math.sin(f.flap) * (0.5 + 0.5 * Math.min(1, f.amp)) + (1 - f.amp) * 0.4;
      r.left.rotation.x = a; r.right.rotation.x = -a;
    }
    for (let i = 0; i < N; i++) { const s = field.seeds[i]; pos[i * 3] = s.x; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z; }
    attr.needsUpdate = true;
  };
  sync(true);
  // dt 0 (paused) or reduced motion: nothing moves, wings held still
  return { group, field, update(dt, reduced) { if (reduced) { if (!sync.done) { sync(true); sync.done = true; } return; } sync.done = false; field.step(dt); if (dt > 0) sync(false); } };
}
