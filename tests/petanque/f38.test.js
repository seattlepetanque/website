import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaneCuts, PLANE_CUT } from '../../assets/js/petanque/director.js';
import { solvePlaneFraming, applyPlaneFraming, easePlaneFraming, PBG } from '../../assets/js/petanque/camera.js';
import { C } from '../../assets/js/petanque/constants.js';

const OK = { allowed: true, eligible: true, visible: true };
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

// run a flight half a second at a time, returns [[t, verdict], ...]
function run(cuts, kind, flight, mut = () => ({}), end = 50) {
  const log = [];
  for (let t = 0; t <= end; t += 0.5) {
    const v = cuts.update({ flight, kind, t, ...OK, busy: false, ...mut(t) });
    if (v) log.push([t, v]);
  }
  return log;
}

test('a flight gets a shot of 4-7 s as soon as it is quiet and visible, at most two', () => {
  for (const kind of ['takeoff', 'landing']) {
    const log = run(createPlaneCuts({ rand: () => 0.1 }), kind, 1);
    assert.deepEqual(log.map((l) => l[1]), ['cut', 'end', 'cut', 'end']);
    assert.equal(log[0][0], 0, 'right away');
    const len = log[1][0] - log[0][0];
    assert.ok(len >= PLANE_CUT.hold[0] - 0.01 && len <= PLANE_CUT.hold[1] + 0.5, `length ${len}`);
    assert.ok(log[2][0] - log[1][0] >= PLANE_CUT.gap);
  }
});

test('the chance rolls: first shot 90%, second 50%, planned afresh per flight', () => {
  assert.deepEqual(run(createPlaneCuts({ rand: seq(0.95) }), 'takeoff', 1), [], 'declined');
  const c = createPlaneCuts({ rand: seq(0.89, 0.5, 0.6, 0.5) });
  assert.equal(run(c, 'takeoff', 1).length, 2, 'second roll 0.6 declines');
  assert.equal(run(c, 'takeoff', 1).length, 0, 'the same flight is done');
  assert.ok(run(c, 'landing', 2).length > 0, 'a new flight is planned afresh');
});

test('waits for a quiet moment, and a shot ends at once when the human becomes busy', () => {
  assert.deepEqual(run(createPlaneCuts({ rand: () => 0 }), 'takeoff', 1, () => ({ eligible: false })), [], 'never quiet, never started');
  const log = run(createPlaneCuts({ rand: () => 0 }), 'takeoff', 1, (t) => ({ eligible: t >= 12 }));
  assert.equal(log[0][1], 'cut'); assert.ok(log[0][0] >= 12);
  const l3 = run(createPlaneCuts({ rand: () => 0 }), 'takeoff', 1, (t) => ({ busy: t >= 2 && t < 20 }));
  assert.equal(l3[1][1], 'end'); assert.equal(l3[1][0], 2);
  // not eligible any more (an AI boule flies) does NOT end a running shot
  const l4 = run(createPlaneCuts({ rand: () => 0 }), 'takeoff', 1, (t) => ({ eligible: t < 1 }));
  assert.ok(l4[1][0] >= PLANE_CUT.hold[0]);
});

test('quick mode / reduced motion (allowed false) and an invisible plane give no shot; fading ends it', () => {
  assert.deepEqual(run(createPlaneCuts({ rand: () => 0 }), 'landing', 1, () => ({ allowed: false })), []);
  assert.deepEqual(run(createPlaneCuts({ rand: () => 0 }), 'landing', 1, () => ({ visible: false })), []);
  const l = run(createPlaneCuts({ rand: () => 0 }), 'landing', 1, (t) => ({ visible: t < 3 }));
  assert.deepEqual(l, [[0, 'cut'], [3, 'end']]);
});

test('a click ends a running shot once (no more this flight); the flight finishing ends it too', () => {
  const cuts = createPlaneCuts({ rand: () => 0 });
  const v = cuts.update({ flight: 1, kind: 'takeoff', t: 0, ...OK, busy: false });
  assert.equal(v, 'cut'); assert.ok(cuts.on);
  assert.equal(cuts.skip(), true); assert.equal(cuts.skip(), false);
  assert.equal(cuts.update({ flight: 1, kind: 'takeoff', t: 20, ...OK, busy: false }), null, 'does not restart');
  const c2 = createPlaneCuts({ rand: () => 0 });
  for (let t = 0; t < 3; t += 0.5) c2.update({ flight: 1, kind: 'takeoff', t, ...OK, busy: false });
  assert.equal(c2.update({ flight: 0, kind: 'takeoff', t: 0, ...OK, busy: false }), 'end');
});

// Synthetic AI play: a throw (boule in the air + rolling) 4-6 s, a walk to the circle 4-6 s, thinking 1 s; one plane flight of 40 s
// starting at a random moment of that cycle. Eligible = nothing flying (and 1 s after), busy never (all AI).
test('during AI play a shot starts in at least 90% of flights (random cycle phases, both kinds)', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let started = 0; const n = 400;
  for (let i = 0; i < n; i++) {
    let calls = 0; // the first roll is stratified so the 90% chance shows as exactly 90% of flights, the rest is random
    const cuts = createPlaneCuts({ rand: () => (calls++ === 0 ? (i + 0.5) / n : rnd()) });
    const throwS = 3 + rnd() * 2, walkS = 4 + rnd() * 2, cycle = throwS + walkS + 1, phase = rnd() * cycle;
    const kind = i % 2 ? 'takeoff' : 'landing';
    let cut = false;
    for (let t = 0; t <= 40; t += 0.1) {
      const c = (t + phase) % cycle, flying = c < throwS;
      const visible = kind === 'takeoff' ? t < 26 : t > 4 && t < 30;
      if (cuts.update({ flight: 1, kind, t, visible, allowed: true, busy: false, eligible: !flying && c >= throwS + 1 }) === 'cut') cut = true;
    }
    if (cut) started++;
  }
  assert.ok(started / n >= 0.9, `${started}/${n} flights got a shot`);
});

// ---- the plane as a background element (solver) ----
let seed = 987654;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const ASPECT = 1.6, FOV = 50;
function project(p, cam, dev) { // independent check: build the camera basis from vectors
  const a = applyPlaneFraming(cam, dev), f = { x: a.tgt.x - cam.pos.x, y: a.tgt.y - cam.pos.y, z: a.tgt.z - cam.pos.z };
  const fl = Math.hypot(f.x, f.y, f.z); f.x /= fl; f.y /= fl; f.z /= fl;
  let r = { x: f.y, y: -f.x, z: 0 }; const rl = Math.hypot(r.x, r.y); r.x /= rl; r.y /= rl;
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const d = { x: p.x - cam.pos.x, y: p.y - cam.pos.y, z: p.z - cam.pos.z };
  const fw = d.x * f.x + d.y * f.y + d.z * f.z; if (fw <= 0) return null;
  const t = Math.tan(FOV * Math.PI / 360) * a.fovK;
  return { x: (d.x * r.x + d.y * r.y) / fw / (t * ASPECT), y: (d.x * u.x + d.y * u.y + d.z * u.z) / fw / t, fovK: a.fovK };
}
// plane positions along the F47 routes: takeoff from about (30,138) toward the court then veering off; landing from far away
function planePos() {
  const W = C.terrainW, r = rnd();
  if (r < 0.4) { const s = rnd(); return { x: 30 - s * 60 + (rnd() - 0.5) * 20, y: 138 - s * 110, z: s * s * 40 }; }
  if (r < 0.7) return { x: W / 2 + (rnd() - 0.5) * 220, y: 40 + rnd() * 200, z: rnd() * 80 };
  return { x: W / 2 + (rnd() - 0.5) * 300, y: 60 + rnd() * 250, z: rnd() * 120 };
}
function randomCamera() { // a camera on the court side looking at a subject near the court, any of the usual heights
  const sub = { x: -1 + rnd() * 6, y: rnd() * 16, z: rnd() * 1.5 };
  const yaw = (rnd() - 0.5) * 1.0, dist = 3 + rnd() * 12, el = 0.15 + rnd() * 0.7;
  const pos = { x: sub.x - Math.sin(yaw) * Math.cos(el) * dist, y: sub.y - Math.cos(yaw) * Math.cos(el) * dist, z: sub.z + Math.sin(el) * dist };
  return { cam: { pos, tgt: sub, fov: FOV, aspect: ASPECT }, sub };
}

test('solver: subject and plane both in frame whenever it fits, deviation clamped, no change when it cannot', () => {
  let fits = 0, nones = 0;
  for (let i = 0; i < 4000; i++) {
    const { cam, sub } = randomCamera(), plane = planePos();
    const r = solvePlaneFraming(cam, [sub], plane);
    if (!r.fit) {
      nones++;
      assert.deepEqual([r.dyaw, r.dpitch, r.fovK], [0, 0, 1], 'no change when it cannot fit');
      continue;
    }
    fits++;
    assert.ok(Math.abs(r.dyaw) <= PBG.maxYaw + 1e-9 && r.dpitch <= PBG.maxPitch + 1e-9 && r.dpitch >= PBG.minPitch - 1e-9, 'clamped');
    assert.ok(r.fovK >= 1 && r.fovK <= PBG.maxFovK + 1e-9);
    assert.ok(1 / r.fovK >= 0.6, 'subject keeps at least 60% of its size');
    const ps = project(plane, cam, r), ss = project(sub, cam, r);
    assert.ok(ps && Math.abs(ps.x) <= PBG.planeX + 1e-6 && ps.y >= PBG.planeLo - 1e-6 && ps.y <= PBG.planeHi + 1e-6, `plane in the upper frame ${JSON.stringify(ps)}`);
    assert.ok(ss && Math.abs(ss.x) <= PBG.subjX + 1e-6 && ss.y >= PBG.subjLo - 1e-6 && ss.y <= PBG.subjHi + 1e-6, `subject in the lower/central frame ${JSON.stringify(ss)}`);
  }
  assert.ok(fits > 300, `fits often enough (${fits}); ${nones} gave no change`);
  assert.ok(nones > 0, 'some configurations cannot fit (e.g. plane behind the camera)');
});

test('solver: a plane already in the upper frame needs no change; one behind the camera gives none', () => {
  const cam = { pos: { x: 2, y: -6, z: 3 }, tgt: { x: 2, y: 8, z: 0 }, fov: FOV, aspect: ASPECT };
  const high = solvePlaneFraming(cam, [cam.tgt], { x: 3, y: 120, z: 10 });
  assert.equal(high.fit, true); assert.equal(high.dyaw, 0); assert.equal(high.dpitch, 0); assert.equal(high.fovK, 1);
  const behind = solvePlaneFraming(cam, [cam.tgt], { x: 2, y: -100, z: 20 });
  assert.deepEqual(behind, { fit: false, dyaw: 0, dpitch: 0, fovK: 1 });
  assert.equal(solvePlaneFraming({ ...cam, tgt: { x: 2, y: -40, z: 0 } }, [{ x: 2, y: 300, z: 0 }], { x: 3, y: 120, z: 10 }).fit, false, 'subject outside the picture: nothing');
});

test('solver: a lake plane low and far to the side takes a modest pan/tilt/widening', () => {
  const cam = { pos: { x: 2, y: -4, z: 2.5 }, tgt: { x: 2, y: 6, z: 0 }, fov: FOV, aspect: ASPECT };
  const r = solvePlaneFraming(cam, [cam.tgt], { x: 120, y: 60, z: 5 });
  assert.equal(r.fit, true);
  assert.ok(r.dyaw !== 0 || r.dpitch !== 0 || r.fovK !== 1);
});

test('easing moves smoothly toward the wanted deviation and back to the identity', () => {
  let d = { dyaw: 0, dpitch: 0, fovK: 1 }; const want = { dyaw: 0.3, dpitch: 0.2, fovK: 1.2 };
  let last = 0;
  for (let i = 0; i < 600; i++) { d = easePlaneFraming(d, want, 1 / 60); assert.ok(d.dyaw >= last - 1e-12 && d.dyaw <= 0.3); last = d.dyaw; }
  assert.ok(Math.abs(d.dyaw - 0.3) < 1e-3);
  for (let i = 0; i < 1200; i++) d = easePlaneFraming(d, { dyaw: 0, dpitch: 0, fovK: 1 }, 1 / 60);
  assert.ok(Math.abs(d.dyaw) < 1e-3 && Math.abs(d.fovK - 1) < 1e-3);
});
