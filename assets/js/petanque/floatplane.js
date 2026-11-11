// F19: a floatplane on the distant lake (scenery.js makeLake). About once per game it takes off or lands.
// Everything is deterministic kinematics on keyframe tables (speed, heading, climb rate, engine revs), stepped on
// the game clock by update(dt) (dt is 0 while paused), so it freezes with the game. No per-frame allocation: one tiny
// model, one pooled Points object for spray and wake foam, scratch vectors reused.
//   createFloatplane({ cx, z }) -> { group, update(dt, camera, reduced), schedule(dt, key, reduced), trigger(kind, mirror),
//                                    advance(seconds), engine, active, kind, t, pos, debugFrame }
//   engine = { on, level 0..1 (by distance), pan -1..1 (from the camera), rev 0..1, dist 0..1 } for ambient.js.
import * as THREE from '../vendor/three.module.js';

export const PLANE = {
  expectedGame: 900, // s of game time in a typical full game; the plane comes at a random 25-75% of it
  window: [0.25, 0.75],
  maxSpray: 150,
  // Keyframes [t s, speed m/s, heading deg (0 = +x, 90 = +y, away from the court), climb m/s, revs 0..1]. Mirrored in x at random.
  // Speeds are a little cinematic (it is far away and seen for under a minute).
  // F47: both flights are ambient entrances and exits. A takeoff starts already visible and opaque, idling on the far
  // side of the lake, runs toward the court along the water, lifts off before the near shore, veers away to the side and
  // fades out only while receding in the air; a landing fades in from the haze, touches down, turns away from the court,
  // taxis back out over the water and fades into the background. `fade` = [seconds to fade in, when the fade-out starts].
  takeoff: {
    start: { x: 30, y: 138, z: 0 },
    liftT: 15, // the floats leave the water here (alt > 0.35 a moment later); the fade-out starts well after this
    fade: [0, 24],
    keys: [
      [0, 0, -105, 0, 0.3], [4, 0, -105, 0, 0.3], [7, 2.5, -105, 0, 0.45], [10, 5.5, -105, 0, 0.8], [13, 9, -105, 0, 1.0],
      [15, 10, -105, 1.2, 1.0], [17, 13, -45, 3.5, 1.0], [21, 17, 0, 4.5, 1.0], [30, 21, 25, 4.5, 0.95], [42, 24, 40, 4.5, 0.95],
    ],
    // engine loudness by phase (smooth interpolation): idle far off, loud only on the run and lift-off, then gone
    env: [[0, 0.15], [5, 0.25], [9, 0.5], [12, 0.9], [17, 1], [23, 0.5], [30, 0.1], [38, 0]],
  },
  landing: {
    start: { x: 42, y: 225, z: 21.5 },
    fade: [4, 34],
    keys: [
      [0, 13, -115, -2.2, 0.75], [9, 13, -115, -2.2, 0.6], [10, 12.5, -115, -0.5, 0.45], [11, 8, -115, 0, 0.4],
      [13, 3, -120, 0, 0.3], [17, 1.8, -130, 0, 0.25], [20, 1.8, -135, 0, 0.3],
      [34, 2, -295, 0, 0.3], [52, 3, -295, 0, 0.3], // turns away through -x, then taxis off over the water
    ],
    env: [[0, 0], [6, 0.8], [11, 1], [15, 0.4], [22, 0.12], [30, 0]],
  },
};

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const D2R = Math.PI / 180;

// Linear keyframe lookup into `out` [speed, heading rad, climb, revs]; no allocation.
export function sampleKeys(keys, t, out) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1], k = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
  out[0] = a[1] + (b[1] - a[1]) * k;
  out[1] = (a[2] + (b[2] - a[2]) * k) * D2R;
  out[2] = a[3] + (b[3] - a[3]) * k;
  out[3] = a[4] + (b[4] - a[4]) * k;
  return out;
}

export function planeDuration(kind) { const k = PLANE[kind].keys; return k[k.length - 1][0]; }

const smooth = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };

// Smooth (smoothstep) interpolation in a [[t, v], ...] table, clamped at the ends.
export function envAt(tab, t) {
  if (t <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (t <= tab[i][0]) { const a = tab[i - 1], b = tab[i]; return a[1] + (b[1] - a[1]) * smooth((t - a[0]) / (b[0] - a[0])); }
  }
  return tab[tab.length - 1][1];
}

// Plane opacity 0..1 over a flight: fades in from the haze at the start, back out near the end.
export function fadeOpacity(kind, t) {
  const P = PLANE[kind], end = planeDuration(kind);
  return (P.fade[0] > 0 ? smooth(t / P.fade[0]) : 1) * (1 - smooth((t - P.fade[1]) / (end - P.fade[1])));
}

// Engine loudness 0..1 from the flight phase and the distance to the listener (m): near-field falloff, silent past ~210 m.
export function engineLevel(kind, t, dist) {
  return envAt(PLANE[kind].env, t) * Math.pow(clamp(1 - dist / 210, 0, 1), 1.8);
}

// Where a flight starts (unmirrored; x is an offset from the court centre). A takeoff's lead-in is integrated backwards
// from its anchor so the run always starts at the F46 spot.
const STEP = 1 / 30;
export function startOf(kind) {
  const P = PLANE[kind];
  if (!P.anchor) return P.start;
  const K = [0, 0, 0, 0];
  let x = 0, y = 0;
  for (let t = 0; t < P.anchor.t - 1e-9; t += STEP) { sampleKeys(P.keys, t, K); x += Math.cos(K[1]) * K[0] * STEP; y += Math.sin(K[1]) * K[0] * STEP; }
  return { x: P.anchor.x - x, y: P.anchor.y - y, z: 0 };
}

// The whole ground track as [t, x, y, alt] samples every `every` s (unmirrored, court-centre offsets). Pure; for tests.
export function pathSamples(kind, every = 1) {
  const P = PLANE[kind], s = startOf(kind), K = [0, 0, 0, 0], out = [];
  let x = s.x, y = s.y, alt = s.z || 0, next = 0;
  const end = planeDuration(kind);
  for (let t = 0; t <= end + 1e-9; t += STEP) {
    sampleKeys(P.keys, Math.min(t, end), K);
    if (t >= next - 1e-9) { out.push([t, x, y, alt]); next += every; }
    x += Math.cos(K[1]) * K[0] * STEP; y += Math.sin(K[1]) * K[0] * STEP;
    if (alt > 0 || K[2] > 0) alt = Math.max(0, alt + K[2] * STEP);
  }
  return out;
}

function buildModel() {
  const white = new THREE.MeshLambertMaterial({ color: '#f3f3ee', flatShading: true });
  const red = new THREE.MeshLambertMaterial({ color: '#c42a1f', flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: '#27384a', flatShading: true });
  const steel = new THREE.MeshLambertMaterial({ color: '#3a3a3c', flatShading: true });
  const discMat = new THREE.MeshBasicMaterial({ color: '#c9cdd2', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  // fuselage: front radius .65 tapering to .22 at the tail, axis along +x
  const fus = new THREE.CylinderGeometry(0.65, 0.22, 7.2, 7); fus.rotateZ(-Math.PI / 2); fus.scale(1, 1, 1.15);
  add(fus, white, -0.1, 0, 1.95);
  const cowl = new THREE.CylinderGeometry(0.62, 0.66, 0.9, 7); cowl.rotateZ(-Math.PI / 2);
  add(cowl, red, 3.75, 0, 1.95);
  const spin = new THREE.ConeGeometry(0.2, 0.45, 6); spin.rotateZ(-Math.PI / 2);
  add(spin, red, 4.4, 0, 1.95);
  // floats and struts
  const fl = new THREE.CylinderGeometry(0.1, 0.3, 5.8, 6); fl.rotateZ(-Math.PI / 2); fl.scale(1, 1, 1.1);
  for (const s of [-1, 1]) {
    add(fl, red, 0.4, s * 1.4, 0.33);
    for (const x of [1.3, -0.9]) {
      const st = add(new THREE.BoxGeometry(0.09, 0.09, 1.2), steel, x, s * 0.95, 1.05);
      st.rotation.x = s * -0.62;
    }
  }
  // high wing with red tips, and two angled struts from the fuselage
  add(new THREE.BoxGeometry(1.6, 11, 0.16), white, 0.6, 0, 3.05);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(1.62, 1.0, 0.17), red, 0.6, s * 5.0, 3.05);
    const st = add(new THREE.BoxGeometry(0.1, 0.1, 2.9), steel, 0.7, s * 2.0, 2.35);
    st.rotation.x = s * 0.88; // leans out to the wing
  }
  add(new THREE.BoxGeometry(1.5, 1.6, 0.35), white, 0.5, 0, 2.75); // wing root
  // tail
  add(new THREE.BoxGeometry(1.1, 3.8, 0.1), white, -3.5, 0, 2.15);
  add(new THREE.BoxGeometry(1.4, 0.1, 1.7), red, -3.45, 0, 2.85).rotation.y = 0.2;
  // cabin windows
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(1.7, 0.02, 0.45), dark, 1.3, s * 0.66, 2.25);
  // propeller: blur disc and one visible blade pair that spins
  const prop = new THREE.Group(); prop.position.set(4.7, 0, 1.95); g.add(prop);
  const disc = new THREE.CircleGeometry(1.15, 18); disc.rotateY(Math.PI / 2);
  add(disc, discMat, 0, 0, 0, prop);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 2.2), steel); prop.add(blade);
  const fadeMats = [white, red, dark, steel, discMat].map((m) => ({ m, base: m.opacity }));
  return { group: g, prop, fadeMats };
}

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export function createFloatplane({ cx = 2, z = 0 } = {}) {
  const root = new THREE.Group(); // positioned by the sim; hidden unless a flight is running
  root.visible = false;
  const model = buildModel();
  root.add(model.group);
  const group = new THREE.Group();
  group.add(root);

  // pooled spray / wake foam
  const N = PLANE.maxSpray;
  const posA = new Float32Array(N * 3), colA = new Float32Array(N * 4);
  const vel = new Float32Array(N * 3), age = new Float32Array(N), life = new Float32Array(N), kindA = new Uint8Array(N);
  age.fill(1); life.fill(1); // all dead
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posA, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colA, 4));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 8, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
  pts.frustumCulled = false; pts.renderOrder = 1;
  group.add(pts);
  let head = 0;

  const eng = { on: false, level: 0, pan: 0, rev: 0, dist: 0 };
  const fp = {
    group, engine: eng, active: false, kind: '', t: 0, pos: root.position, debugFrame: false, onAir: false, flight: 0, // flight counts up per trigger (F38)
    get opacity() { return opac; },
  };
  const K = [0, 0, 0, 0]; // sampled keys
  let mirror = 1, x = 0, y = 0, alt = 0, psi = 0, psiPrev = 0, pitch = 0, roll = 0, speed = 0, climb = 0, revs = 0, spinA = 0, emitAcc = 0, foamAcc = 0, bob = 0;
  let touched = false, opac = 1;
  let gameT = 0, fireAt = 0, fired = false, matchKey = null;

  function spawn(px, py, pz, vx, vy, vz, lf, kind) {
    const i = head; head = (head + 1) % N;
    posA[i * 3] = px; posA[i * 3 + 1] = py; posA[i * 3 + 2] = pz;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    age[i] = 0; life[i] = lf; kindA[i] = kind;
  }

  function trigger(kind, mir) {
    if (!PLANE[kind]) return false;
    fp.kind = kind; fp.active = true; fp.t = 0; fp.flight++;
    mirror = mir === undefined ? (Math.random() < 0.5 ? -1 : 1) : mir;
    const s = startOf(kind);
    x = cx + mirror * s.x; y = s.y; alt = s.z;
    psi = 0; psiPrev = 0; pitch = 0; roll = 0; touched = kind === 'takeoff'; emitAcc = foamAcc = 0;
    sampleKeys(PLANE[kind].keys, 0, K);
    psi = psiPrev = mirror > 0 ? K[1] : Math.PI - K[1];
    speed = K[0]; revs = K[3];
    setOpacity(fadeOpacity(kind, 0));
    place();
    return true;
  }

  // F47: fade the whole plane (and its spray) in and out; opaque materials only turn transparent while partly faded
  function setOpacity(o) {
    opac = o;
    root.visible = o > 0.01;
    for (const f of model.fadeMats) {
      const tr = o < 0.999 || f.base < 1;
      if (f.m.transparent !== tr) { f.m.transparent = tr; f.m.needsUpdate = true; }
      f.m.opacity = f.base * o;
      f.m.depthWrite = f.base >= 1 ? o > 0.5 : false;
    }
  }

  function place() {
    bob = alt < 0.25 ? 0.05 * Math.sin(fp.t * 2.3) : 0;
    root.position.set(x, y, z + alt + bob);
    root.rotation.set(roll, -pitch, psi, 'ZYX');
    model.prop.rotation.x = spinA;
  }

  function step(dt) {
    fp.t += dt;
    const keys = PLANE[fp.kind].keys, end = keys[keys.length - 1][0];
    sampleKeys(keys, Math.min(fp.t, end), K);
    speed = K[0]; climb = K[2]; revs = K[3];
    const h = mirror > 0 ? K[1] : Math.PI - K[1];
    const dpsi = Math.atan2(Math.sin(h - psi), Math.cos(h - psi));
    psi = h;
    x += Math.cos(psi) * speed * dt; y += Math.sin(psi) * speed * dt;
    if (alt > 0 || climb > 0) alt = Math.max(0, alt + climb * dt);
    fp.onAir = alt > 0.35;
    if (fp.kind === 'landing' && !touched && alt <= 0) touched = true;
    // attitude: nose up on the climb or flare, a planing attitude on the water, banked into turns
    const wantPitch = fp.onAir ? clamp(Math.atan2(climb, Math.max(speed, 1)) + 0.07, -0.12, 0.3) : (speed > 2 ? 0.05 + 0.03 * clamp(speed / 10, 0, 1) : 0.02);
    pitch += (wantPitch - pitch) * Math.min(1, dt * 2);
    const wantRoll = clamp(-(dpsi / Math.max(dt, 1e-3)) * speed / 9.8, -0.3, 0.3);
    roll += (wantRoll - roll) * Math.min(1, dt * 3);
    spinA += (10 + 45 * revs) * dt;
    // spray and wake while it is on the water and moving
    if (!fp.onAir && speed > 2.5) {
      emitAcc += clamp((speed - 2.5) * 3.2, 0, 26) * dt * (fp.kind === 'takeoff' && speed < 9 ? 1.3 : 1);
      foamAcc += 7 * dt;
      const c = Math.cos(psi), s = Math.sin(psi);
      while (emitAcc >= 1) {
        emitAcc -= 1;
        const side = Math.random() < 0.5 ? -1 : 1, lx = rnd(-0.5, 2.0), ly = side * 1.4;
        const out = rnd(1.2, 3.2);
        spawn(x + c * lx - s * ly, y + s * lx + c * ly, z + 0.2,
          (-s * side) * out - c * speed * 0.25, (c * side) * out - s * speed * 0.25, rnd(2.2, 4.5), rnd(0.8, 1.4), 0);
      }
      while (foamAcc >= 1) {
        foamAcc -= 1;
        const side = Math.random() < 0.5 ? -1 : 1, lx = rnd(-3.2, -2.2), ly = side * 1.4;
        spawn(x + c * lx - s * ly, y + s * lx + c * ly, z + 0.08, (-s * side) * 0.5, (c * side) * 0.5, 0, rnd(2.8, 4.2), 1);
      }
    }
    setOpacity(fadeOpacity(fp.kind, fp.t));
    if (fp.t >= end) { fp.active = false; root.visible = false; eng.on = false; }
  }

  function stepParticles(dt) {
    for (let i = 0; i < N; i++) {
      if (age[i] >= life[i]) { colA[i * 4 + 3] = 0; continue; }
      age[i] += dt;
      const k = age[i] / life[i];
      if (kindA[i] === 0) {
        vel[i * 3 + 2] -= 8 * dt;
        posA[i * 3] += vel[i * 3] * dt; posA[i * 3 + 1] += vel[i * 3 + 1] * dt; posA[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (posA[i * 3 + 2] < z) age[i] = life[i];
        colA[i * 4] = 1; colA[i * 4 + 1] = 1; colA[i * 4 + 2] = 1; colA[i * 4 + 3] = 0.75 * (1 - k) * opac;
      } else {
        posA[i * 3] += vel[i * 3] * dt; posA[i * 3 + 1] += vel[i * 3 + 1] * dt;
        colA[i * 4] = 0.95; colA[i * 4 + 1] = 0.97; colA[i * 4 + 2] = 1; colA[i * 4 + 3] = 0.5 * Math.sin(Math.PI * Math.min(1, k * 1.15)) * (1 - k) * opac;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  // Engine feed for the sound: distance level, horizontal pan from the camera's right vector, revs
  function feedEngine(camera) {
    if (!fp.active) { eng.on = false; return; }
    const cp = camera.position, e = camera.matrixWorld.elements;
    const dx = x - cp.x, dy = y - cp.y, dz = z + alt - cp.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz), hd = Math.hypot(dx, dy);
    const rl = Math.hypot(e[0], e[1]) || 1;
    eng.pan = hd > 1e-3 ? clamp(((dx * e[0] + dy * e[1]) / (hd * rl)) * 1.3, -1, 1) : 0;
    eng.dist = clamp(d / 260, 0, 1);
    eng.level = engineLevel(fp.kind, fp.t, d); // F47: phase envelope x distance falloff; silent after the loud window
    eng.rev = revs;
    eng.on = eng.level > 0.003;
  }

  const FIX = 1 / 30;
  fp.update = (dt, camera, reduced) => {
    if (dt > 0) {
      if (fp.active) { let r = dt; while (r > 1e-6 && fp.active) { const s = Math.min(FIX, r); step(s); r -= s; } if (fp.active) place(); }
      stepParticles(dt);
    }
    if (camera) {
      feedEngine(camera);
      if (fp.debugFrame && fp.active) { // ?debug&floatplane: a camera that follows the plane from the shoulder position
        const px = x, py = y, pz = z + alt + 1.8;
        camera.position.set(cx + 0.5, -2, 1.7);
        camera.fov = clamp(2 * Math.atan(15 / Math.hypot(px - camera.position.x, py - camera.position.y)) / D2R, 5, 45);
        camera.updateProjectionMatrix();
        camera.lookAt(px, py, pz);
        camera.updateMatrixWorld();
        feedEngine(camera);
      }
    }
    void reduced;
  };
  // Fast-forward (debug screenshots)
  fp.advance = (sec) => { for (let t = 0; t < sec && fp.active; t += FIX) { step(FIX); stepParticles(FIX); } if (fp.active) place(); };
  fp.trigger = trigger;
  // Once per match at a random 25-75% of the expected game time (game time only: pass dt 0 while paused or between games)
  fp.schedule = (dt, key, reduced) => {
    if (key !== matchKey) { matchKey = key; gameT = 0; fired = false; fireAt = rnd(PLANE.window[0], PLANE.window[1]) * PLANE.expectedGame; }
    if (!key || fired || reduced || dt <= 0) return;
    gameT += dt;
    if (gameT >= fireAt && !fp.active) { fired = true; trigger(Math.random() < 0.5 ? 'takeoff' : 'landing'); }
  };
  fp.fireAt = () => fireAt;
  return fp;
}
