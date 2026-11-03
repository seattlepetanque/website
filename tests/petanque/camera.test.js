import test from 'node:test';
import assert from 'node:assert/strict';
import { frameMoving, cameraFromFrame, CAM } from '../../assets/js/petanque/camera.js';
import { createBody } from '../../assets/js/petanque/physics.js';

const OPTS = { aspect: 1.6, fov: 50, dt: 1 / 60 };
function body(kind, x, y, vx, vy, extra = {}) {
  const b = createBody(kind, { x, y, vx, vy, ...extra });
  b.z = extra.z !== undefined ? extra.z : b.r;
  b.state = extra.state || 'rolling';
  return b;
}

// Is the point inside the view frustum (with the framing the camera would use)?
function inView(f, p, opts = OPTS) {
  const { pos, tgt } = cameraFromFrame(f);
  const fx = tgt.x - pos.x, fy = tgt.y - pos.y, fz = tgt.z - pos.z, fl = Math.hypot(fx, fy, fz);
  const F = [fx / fl, fy / fl, fz / fl];
  let R = [F[1], -F[0], 0]; const rl = Math.hypot(R[0], R[1]); R = [R[0] / rl, R[1] / rl, 0];
  const U = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
  const d = [p.x - pos.x, p.y - pos.y, p.z - pos.z];
  const dep = d[0] * F[0] + d[1] * F[1] + d[2] * F[2];
  if (dep <= 0) return false;
  const vT = Math.tan(opts.fov * Math.PI / 360);
  const nx = (d[0] * R[0] + d[1] * R[1]) / (dep * vT * opts.aspect);
  const ny = (d[0] * U[0] + d[1] * U[1] + d[2] * U[2]) / (dep * vT);
  return Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
}

test('one thrown boule is tracked', () => {
  const b = body('boule', 2, 4, 0, 6, { state: 'airborne', z: 1.5 });
  const f = frameMoving([b], null, { ...OPTS, thrown: b }, null);
  assert.ok(f.active);
  assert.ok(inView(f, b));
  assert.ok(f.target.y > b.y, 'looks a little ahead of the boule');
  assert.ok(Math.abs(f.yaw) < 0.05);
});

test('a resting thrown boule and resting bodies give no framing', () => {
  const r = body('boule', 2, 4, 0, 0, { state: 'resting' });
  assert.equal(frameMoving([r], null, { ...OPTS, thrown: r }, null), null);
  const prev = frameMoving([body('boule', 2, 4, 0, 5)], null, OPTS, null);
  const f = frameMoving([r], null, OPTS, prev);
  assert.equal(f.active, false);
  assert.deepEqual(f.target, prev.target);
});

test('two diverging bodies both stay in view', () => {
  const a = body('boule', 0.1, 5, -1.5, -2), b = body('boule', 3.9, 11, 1.5, 3);
  const f = frameMoving([a, b], null, OPTS, null);
  assert.ok(inView(f, a) && inView(f, b));
  const near = frameMoving([body('boule', 2, 8, 0, 2)], null, OPTS, null);
  assert.ok(f.distance > near.distance, 'zooms out to fit both');
  // portrait phone aspect needs more distance
  const phone = frameMoving([a, b], null, { aspect: 0.5, fov: 62, dt: 1 / 60 }, null);
  assert.ok(inView(phone, a, { aspect: 0.5, fov: 62 }) && inView(phone, b, { aspect: 0.5, fov: 62 }));
});

test('a fast jack becomes primary and is aimed at its look-ahead spot', () => {
  const j = body('jack', 2, 8, 0.3, 7), b = body('boule', 1.5, 7.5, 0, 1.2);
  const f = frameMoving([j, b], j, OPTS, null);
  assert.equal(f.primary, j.id);
  assert.ok(f.target.y > j.y + 1, 'target is ahead of the jack');
  assert.ok(inView(f, j));
  // a slow jack is not primary
  const slow = body('jack', 2, 8, 0, 0.5);
  assert.equal(frameMoving([slow, b], slow, OPTS, null).primary, null);
  // a slowish jack heading for a string line is
  const edge = body('jack', 2, 14.7, 0, 1.2);
  assert.equal(frameMoving([edge], edge, OPTS, null).primary, edge.id);
});

test('the jack keeps priority when everything cannot fit', () => {
  const j = body('jack', 2, 8, 0, 6), far = body('boule', 3.9, 0.2, 0, 3);
  const f = frameMoving([j, far], j, { ...OPTS, aspect: 0.5, fov: 62 }, null);
  assert.ok(inView(f, j, { aspect: 0.5, fov: 62 }));
  assert.ok(f.distance <= CAM.maxDist + 1e-6);
});

test('ghosts count only while rolling, with low weight', () => {
  const g = body('boule', 3.9, 10, 0, 0, { ghost: true, dead: true, state: 'rolling' });
  assert.equal(frameMoving([g], null, OPTS, null), null);
  const r = body('boule', 2, 8, 0, 3);
  const f = frameMoving([r, { ...g, vx: 1, id: 99 }], null, OPTS, null);
  assert.ok(f.ids.includes(99));
});

test('smoothing bounds the per-frame change and never jumps when a body appears', () => {
  const dt = 1 / 60;
  let b = body('boule', 2, 1, 0, 8, { state: 'airborne', z: 1 });
  let f = frameMoving([b], null, { ...OPTS, thrown: b }, null);
  const jack = body('jack', 2, 8, 0, 0, { state: 'resting' });
  const lim = (x, name) => x;
  void lim;
  for (let i = 0; i < 400; i++) {
    b = { ...b, y: b.y + 8 * dt };
    const bodies = [b, jack];
    if (i === 100) { jack.state = 'rolling'; jack.vx = 1; jack.vy = 6; } // the jack is hit
    if (i > 100) { jack.x += jack.vx * dt; jack.y += jack.vy * dt; jack.vy *= 0.99; }
    const g = frameMoving(bodies, jack, { ...OPTS, thrown: b }, f);
    assert.ok(Math.hypot(g.target.x - f.target.x, g.target.y - f.target.y) <= CAM.target.max * dt + 1e-9);
    assert.ok(Math.abs(g.distance - f.distance) <= CAM.dist.max * dt + 1e-9);
    assert.ok(Math.abs(g.yaw - f.yaw) <= CAM.yaw.max * dt + 1e-9);
    assert.ok(Math.abs(g.pitch - f.pitch) <= CAM.pitchSpring.max * dt + 1e-9);
    f = g;
  }
});

test('reduced motion moves more gently', () => {
  const a = body('boule', 2, 4, 0, 6);
  const start = frameMoving([a], null, OPTS, null);
  const far = { ...a, y: 9 };
  const norm = frameMoving([far], null, OPTS, start), calm = frameMoving([far], null, { ...OPTS, reduced: true }, start);
  assert.ok(Math.abs(calm.target.y - start.target.y) < Math.abs(norm.target.y - start.target.y));
});

test('pitch, yaw and camera height stay in range', () => {
  for (const [x, y, vx, vy, z] of [[2, 3, 0, 8, 3], [0.1, 14.9, -6, 9, 0.04], [3.9, 0.1, 9, -9, 0.04], [2, 8, 0, 0.2, 0.04]]) {
    const b = body('boule', x, y, vx, vy, { z });
    let f = frameMoving([b], null, { ...OPTS, thrown: b }, null);
    for (let i = 0; i < 120; i++) f = frameMoving([b], null, { ...OPTS, thrown: b }, f);
    assert.ok(f.pitch >= CAM.minPitch && f.pitch <= CAM.maxPitch);
    assert.ok(Math.abs(f.yaw) <= CAM.maxYaw + 1e-9, 'never flips behind the play');
    const { pos } = cameraFromFrame(f);
    assert.ok(pos.z >= CAM.minCamZ - 1e-9, 'above the ground');
    assert.ok(Number.isFinite(f.distance) && f.distance >= CAM.minDist * 0.9 && f.distance <= CAM.maxDist);
  }
});

test('E10: toward y = 0 the camera stays behind the play (never flips to face the thrower)', () => {
  const o = { ...OPTS, dir: -1 };
  // a boule thrown from y = 13 toward y = 5: it flies and rolls along -y, with small sideways drift
  let prev = null;
  const b = body('boule', 2, 13, 0.4, -9, { z: 1, state: 'airborne' });
  for (let i = 0; i < 240; i++) {
    b.y += b.vy / 60; b.x += b.vx / 60;
    if (i === 100) { b.state = 'rolling'; b.z = b.r; b.vy = -2; b.vx = 0.1; }
    prev = frameMoving([b], null, { ...o, thrown: b }, prev);
    assert.ok(Math.abs(Math.abs(prev.yaw) - Math.PI) <= CAM.maxYaw + 1e-9, `yaw ${prev.yaw} stays within ${CAM.maxYaw} of facing -y`);
    const { pos, tgt } = cameraFromFrame(prev);
    assert.ok(pos.y > tgt.y, 'the camera sits on the circle side (higher y) of the target');
  }
  // dir +1 is unchanged: behind means lower y
  const f = frameMoving([body('boule', 2, 3, 0, 9)], null, { ...OPTS, thrown: null }, null);
  const c = cameraFromFrame(f);
  assert.ok(c.pos.y < c.tgt.y);
  // a jack skittering sideways does not turn the view around
  const j = body('jack', 2, 6, 5, 0.5);
  const g = frameMoving([j], j, { ...o, thrown: j }, null);
  assert.ok(Math.abs(Math.abs(g.yaw) - Math.PI) <= CAM.maxYaw + 1e-9);
});
