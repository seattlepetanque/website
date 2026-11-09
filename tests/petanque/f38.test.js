import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaneCuts, PLANE_CUT } from '../../assets/js/petanque/director.js';
import { framePlane, PSHOT } from '../../assets/js/petanque/camera.js';
import { C } from '../../assets/js/petanque/constants.js';

const OK = { allowed: true, eligible: true, visible: true };
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

// run a flight second by second, returns [[t, verdict], ...]
function run(cuts, kind, flight, mut = () => ({}), end = 50) {
  const log = [];
  for (let t = 0; t <= end; t += 0.5) {
    const v = cuts.update({ flight, kind, t, ...OK, ...mut(t) });
    if (v) log.push([t, v]);
  }
  return log;
}

test('a flight gets one shot of a few seconds, inside the start window', () => {
  for (const kind of ['takeoff', 'landing']) {
    const log = run(createPlaneCuts({ rand: () => 0.1 }), kind, 1);
    assert.equal(log.length, 2);
    assert.equal(log[0][1], 'cut'); assert.equal(log[1][1], 'end');
    const cfg = PLANE_CUT[kind];
    assert.ok(log[0][0] >= cfg.from[0] && log[0][0] <= cfg.from[1] + 0.5);
    const len = log[1][0] - log[0][0];
    assert.ok(len >= PLANE_CUT.hold[0] - 0.01 && len <= PLANE_CUT.hold[1] + 0.5, `length ${len}`);
  }
});

test('not every flight: the chance roll can decline, and a second flight is planned afresh', () => {
  const cuts = createPlaneCuts({ rand: seq(0.99) });
  assert.deepEqual(run(cuts, 'takeoff', 1), []);
  const c2 = createPlaneCuts({ rand: seq(0.1) });
  assert.equal(run(c2, 'takeoff', 1).length, 2);
  assert.equal(run(c2, 'takeoff', 1).length, 0, 'the same flight never gets a second shot');
  assert.equal(run(c2, 'landing', 2).length, 2, 'a new flight does');
});

test('never while the human is busy: waits, and ends at once when they become busy', () => {
  const cuts = createPlaneCuts({ rand: () => 0 });
  assert.deepEqual(run(cuts, 'takeoff', 1, () => ({ eligible: false })), [], 'never started');
  const c2 = createPlaneCuts({ rand: () => 0 });
  const log = run(c2, 'takeoff', 1, (t) => ({ eligible: t >= 12 }));
  assert.equal(log[0][1], 'cut'); assert.ok(log[0][0] >= 12, 'waited for the human to be free');
  const c3 = createPlaneCuts({ rand: () => 0 });
  const l3 = run(c3, 'takeoff', 1, (t) => ({ eligible: t < 9.5 }));
  assert.equal(l3.length, 2); assert.equal(l3[1][0], 9.5, 'cut short when the human starts their turn');
});

test('quick mode / reduced motion (allowed false) and an invisible plane give no shot; the window closes', () => {
  assert.deepEqual(run(createPlaneCuts({ rand: () => 0 }), 'landing', 1, () => ({ allowed: false })), []);
  assert.deepEqual(run(createPlaneCuts({ rand: () => 0 }), 'landing', 1, () => ({ visible: false })), []);
  assert.deepEqual(run(createPlaneCuts({ rand: () => 0 }), 'landing', 1, (t) => ({ eligible: t > PLANE_CUT.landing.until })), []);
});

test('a click ends a running shot once; the flight finishing ends it too', () => {
  const cuts = createPlaneCuts({ rand: () => 0 });
  let v; for (let t = 0; !v && t < 30; t += 0.5) v = cuts.update({ flight: 1, kind: 'takeoff', t, ...OK });
  assert.equal(v, 'cut'); assert.ok(cuts.on);
  assert.equal(cuts.skip(), true); assert.equal(cuts.skip(), false);
  assert.equal(cuts.update({ flight: 1, kind: 'takeoff', t: 20, ...OK }), null, 'does not restart');
  const c2 = createPlaneCuts({ rand: () => 0 });
  for (let t = 0; t < 8; t += 0.5) c2.update({ flight: 1, kind: 'takeoff', t, ...OK });
  assert.equal(c2.update({ flight: 0, kind: 'takeoff', t: 0, ...OK }), 'end');
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
