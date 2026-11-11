import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaneCuts, PLANE_CUT } from '../../assets/js/petanque/director.js';
import { framePlane, PSHOT } from '../../assets/js/petanque/camera.js';
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

test('framePlane: plane in view with the lake below, from the side away from it, on the ground eye line', () => {
  const W = C.terrainW, opts = { aspect: 1.6, fov: 50, dt: 1 / 60 };
  for (const [x, y, z] of [[W / 2 + 30, 138, 0], [W / 2 - 30, 100, 8], [W / 2 + 25, 200, 20], [W / 2 - 60, 60, 60]]) {
    const f = framePlane({ x, y, z }, opts, null);
    assert.equal(f.side, x >= W / 2 ? -1 : 1);
    assert.ok(f.pos.x < 0 || f.pos.x > W, 'outside the timbers');
    const fx = f.tgt.x - f.pos.x, fy = f.tgt.y - f.pos.y, fz = f.tgt.z - f.pos.z, fl = Math.hypot(fx, fy, fz);
    const dx = x - f.pos.x, dy = y - f.pos.y, dz = z - f.pos.z, dl = Math.hypot(dx, dy, dz);
    const ang = Math.acos((fx * dx + fy * dy + fz * dz) / (fl * dl));
    const half = (opts.fov * Math.PI / 360) * f.fovK;
    assert.ok(ang < half * 0.8, `plane at ${x},${y},${z} inside the view (${ang.toFixed(3)} < ${half.toFixed(3)})`);
    assert.ok(f.fovK >= PSHOT.minFovK && f.fovK <= PSHOT.maxFovK);
    assert.ok(f.tgt.z - f.pos.z < dz / dl * fl + 1e-6, 'aimed at or below the plane, so the lake shows');
  }
});

test('framePlane follows the plane smoothly and keeps its side', () => {
  const opts = { aspect: 1.6, fov: 50, dt: 1 / 60 };
  let f = framePlane({ x: 30, y: 138, z: 0 }, opts, null);
  const first = f.yaw;
  for (let i = 0; i < 60; i++) f = framePlane({ x: 30 + i, y: 138 - i, z: i * 0.1 }, opts, f);
  assert.equal(f.side, -1);
  assert.ok(Math.abs(f.yaw - first) > 0.01 && Math.abs(f.yaw - first) < 1, 'turned a bit');
  assert.ok(Number.isFinite(f.pos.z) && Number.isFinite(f.tgt.z));
});
