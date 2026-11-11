import test from 'node:test';
import assert from 'node:assert/strict';
import { frameMoving, cameraFromFrame, CAM, frameObserver, walkSubject, OBS, cameraStyle, frameTV, tvGoal, TV, TV_VARIANTS, broadcastGoal, frameBroadcast, BC, freeViewRect, scoringTargetBox, fitScoringView, SCORING_FIT } from '../../assets/js/petanque/camera.js';
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

// ---- E11: the observer camera ----
{
  const W = 4, L = 17, ground = (x, y) => 0.05 * Math.sin(y);
  const run = (subjectAt, secs, o = {}) => {
    let f = null; const log = [];
    for (let i = 0; i < secs * 60; i++) {
      const s = subjectAt(i / 60);
      f = frameObserver(s, { dt: 1 / 60, aspect: 1.6, fov: 50, groundAt: ground, width: W, length: L, ...o }, f);
      log.push(f);
    }
    return log;
  };
  const angleTo = (f, p) => {
    const d = [f.tgt.x - f.pos.x, f.tgt.y - f.pos.y, f.tgt.z - f.pos.z], e = [p.x - f.pos.x, p.y - f.pos.y, (p.z || 0) - f.pos.z];
    const dot = d[0] * e[0] + d[1] * e[1] + d[2] * e[2];
    return Math.acos(dot / (Math.hypot(...d) * Math.hypot(...e)));
  };

  test('observer stands outside the timbers, above the ground, at eye height', () => {
    for (const dir of [1, -1]) {
      const head = { x: 1.5 + dir, y: dir > 0 ? 12 : 5 };
      const log = run((t) => [head, { x: 2, y: dir > 0 ? 1 : 16 }], 20, { dir });
      for (const f of log) {
        assert.ok(f.pos.x <= -OBS.side + 1e-9 || f.pos.x >= W + OBS.side - 1e-9, 'outside the court');
        assert.ok(Math.abs(f.pos.z - ground(f.pos.x, f.pos.y) - OBS.eye) < 1e-9);
        assert.ok(f.pos.y > 0 && f.pos.y < L);
      }
    }
  });

  test('observer pans slowly: angular speed is capped, and it never cuts', () => {
    // the subject jumps from one end of the court to the other
    const log = run((t) => [t < 3 ? { x: 2, y: 3 } : { x: 2.5, y: 14 }], 25);
    let worst = 0, moveMax = 0;
    for (let i = 1; i < log.length; i++) {
      worst = Math.max(worst, Math.abs(log[i].yaw - log[i - 1].yaw) * 60, Math.abs(log[i].pitch - log[i - 1].pitch) * 60);
      moveMax = Math.max(moveMax, Math.hypot(log[i].pos.x - log[i - 1].pos.x, log[i].pos.y - log[i - 1].pos.y) * 60);
    }
    assert.ok(worst <= OBS.pan.boost + 1e-6, 'angular speed ' + worst);
    assert.ok(moveMax <= OBS.dolly.max + 1e-6, 'dolly at walking speed ' + moveMax);
    assert.ok(Math.abs(log.at(-1).pos.y - 14) < 3, 'the spectator walked along the side to keep up');
  });

  test('observer keeps the head in view, and a small shift needs no dolly', () => {
    const head = { x: 2, y: 9 };
    const log = run(() => [head, { x: 2.8, y: 8.6 }], 15);
    assert.ok(angleTo(log.at(-1), { ...head, z: 0.6 }) < 0.05);
    const steady = run((t) => [{ x: 2, y: 9 + 0.3 * Math.sin(t) }], 10);
    assert.equal(steady.at(-1).pos.y, steady[0].pos.y, 'inside the deadband the spectator stands still');
    // while it pans toward a far subject the head stays within the picture
    const half = Math.atan(Math.tan(25 * Math.PI / 180) * 1.6);
    const far = run((t) => [{ x: 2, y: t < 2 ? 3 : 6 }], 12);
    for (const f of far.slice(3 * 60)) assert.ok(angleTo(f, { x: 2, y: 6, z: 0.6 }) < half, 'subject in view');
  });

  test('observer under reduced motion pans slower and does not dolly', () => {
    const log = run((t) => [{ x: 2, y: t < 2 ? 3 : 14 }], 15, { reduced: true });
    let worst = 0;
    for (let i = 1; i < log.length; i++) worst = Math.max(worst, Math.abs(log[i].yaw - log[i - 1].yaw) * 60);
    assert.ok(worst <= OBS.reducedPan + 1e-6);
    assert.equal(log.at(-1).pos.y, log[0].pos.y);
    assert.equal(log.at(-1).fovK, 1);
  });

  test('paused-style zero dt leaves the camera frozen', () => {
    const f1 = frameObserver([{ x: 2, y: 5 }], { dt: 1 / 60, groundAt: ground }, null);
    const f2 = frameObserver([{ x: 2, y: 12 }], { dt: 0, groundAt: ground }, f1);
    assert.deepEqual(f2.pos, f1.pos);
    assert.equal(f2.yaw, f1.yaw);
  });

  test('cameraStyle is the single switch: observer in slow mode except on the human turn', () => {
    assert.equal(cameraStyle({ slow: true }), 'observer');
    assert.equal(cameraStyle({ slow: true, human: true }), 'game');
    assert.equal(cameraStyle({ slow: false }), 'game');
    assert.equal(cameraStyle({ slow: true, override: 'tv' }), 'tv');
    assert.equal(cameraStyle({ slow: true, override: 'bogus' }), 'observer');
  });
}

// ---- E27: TV cameras ----
const inFrame = (pos, tgt, p, fovDeg, aspect) => {
  const f = [tgt.x - pos.x, tgt.y - pos.y, tgt.z - pos.z], n = Math.hypot(...f);
  const fw = f.map((v) => v / n);
  const r = [fw[1], -fw[0], 0], rn = Math.hypot(r[0], r[1]) || 1; // right (horizontal)
  const right = [r[0] / rn, r[1] / rn, 0];
  const d = [p.x - pos.x, p.y - pos.y, p.z - pos.z];
  const z = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
  const x = d[0] * right[0] + d[1] * right[1];
  // up = right x forward
  const u = [right[1] * fw[2] - 0, 0 - right[0] * fw[2], right[0] * fw[1] - right[1] * fw[0]];
  const y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
  const vt = Math.tan(fovDeg * Math.PI / 360);
  return z > 0.1 && Math.abs(x / z) <= vt * aspect && Math.abs(y / z) <= vt;
};

test('cameraStyle: quick mode uses the TV camera only when a variant is chosen', () => {
  assert.equal(cameraStyle({ slow: false, tv: 'b' }), 'tv');
  assert.equal(cameraStyle({ slow: false, tv: '' }), 'game');
  assert.equal(cameraStyle({ slow: false, tv: 'b', human: true }), 'game');
  assert.equal(cameraStyle({ slow: true, tv: 'b' }), 'observer');
});

for (const dir of [1, -1]) {
  for (const variant of TV_VARIANTS) {
    test(`TV ${variant} dir ${dir}: above ground, boule and head in frame, smooth`, () => {
      const throwY = dir > 0 ? 3 : 14, jy = dir > 0 ? 11 : 6;
      const jack = body('jack', 1.8, jy, 0, 0, { state: 'resting' });
      const ground = (x, y) => 0.05 * Math.sin(x + y);
      const b = body('boule', 2.1, throwY, 0, 8 * dir, { z: 1.5, state: 'airborne' });
      let prev = null;
      for (let i = 0; i < 400; i++) {
        const settled = i > 300;
        if (!settled) { b.y += dir * 0.035; b.z = Math.max(b.r, 1.5 - 0.004 * i); if (Math.abs(b.y - jy) < 0.4) b.y = jy - dir * 0.4; }
        else b.state = 'resting';
        const s = { body: b, jack, dir, dt: 1 / 60, groundAt: ground, aspect: 1.6, fov: 50 };
        prev = frameTV(variant, s, prev);
        assert.ok(prev.pos.z >= ground(prev.pos.x, prev.pos.y) + TV.minZ - 1e-9, 'camera above the ground');
        // the un-damped goal keeps the boule (a: only the boule; b, c: boule and jack) in view
        const g = tvGoal(prev, s), tops = variant === 'a' ? [b] : [b, jack];
        for (const p of tops) assert.ok(inFrame(g.pos, g.tgt, { x: p.x, y: p.y, z: p.z }, 50, 1.6), `${variant} ${i}`);
      }
      assert.ok(prev.restT > 0.5);
    });
  }
}

test('TV: dt 0 freezes the shot; reduced motion keeps the crane static', () => {
  const jack = body('jack', 2, 11, 0, 0, { state: 'resting' });
  const b = body('boule', 2, 4, 0, 8, { z: 1, state: 'airborne' });
  const s = { body: b, jack, dir: 1, groundAt: () => 0, aspect: 1.6, fov: 50, dt: 1 / 60 };
  let f = frameTV('c', s, null);
  const g = frameTV('c', { ...s, dt: 0 }, f);
  assert.equal(g, f);
  const z0 = tvGoal({ ...f, t: 0 }, { ...s, reduced: true }).pos.z, z1 = tvGoal({ ...f, t: 5 }, { ...s, reduced: true }).pos.z;
  assert.equal(z0, z1);
  assert.ok(tvGoal({ ...f, t: 5 }, s).pos.z > tvGoal({ ...f, t: 0 }, s).pos.z + 1, 'the crane rises');
});

// ---- F01: sports-broadcast shots ----
import { reactionChoice, afterStop, hoverMs, DIRECTOR, createDirector } from '../../assets/js/petanque/director.js';

function inViewPts(g, p, o) {
  const { pos, tgt } = g;
  const fx = tgt.x - pos.x, fy = tgt.y - pos.y, fz = tgt.z - pos.z, fl = Math.hypot(fx, fy, fz);
  const F = [fx / fl, fy / fl, fz / fl];
  let R = [F[1], -F[0], 0]; const rl = Math.hypot(R[0], R[1]); R = [R[0] / rl, R[1] / rl, 0];
  const U = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
  const d = [p.x - pos.x, p.y - pos.y, p.z - pos.z];
  const dep = d[0] * F[0] + d[1] * F[1] + d[2] * F[2];
  if (dep <= 0) return false;
  const vT = Math.tan(o.fov * Math.PI / 360);
  return Math.abs((d[0] * R[0] + d[1] * R[1]) / (dep * vT * o.aspect)) <= 1 && Math.abs((d[0] * U[0] + d[1] * U[1] + d[2] * U[2]) / (dep * vT)) <= 1;
}
const hills = (x, y) => 0.03 * Math.sin(x) + 0.05 * Math.cos(y / 2);

for (const dir of [1, -1]) for (const [aspect, fov] of [[1.6, 50], [0.5, 62]]) {
  test(`broadcast person shots keep the whole person in frame, above ground (dir ${dir}, aspect ${aspect})`, () => {
    const o = { aspect, fov };
    for (const kind of ['prep', 'throw', 'reaction']) for (const t of [0, 2, 10]) {
      const sub = { x: 2, y: dir > 0 ? 1 : 14 }, face = dir > 0 ? 0 : Math.PI;
      const g = broadcastGoal(kind, { t, side: 1 }, { subject: sub, face, dir, groundAt: hills, ...o });
      for (const z of [0.05, 0.9, 1.7]) assert.ok(inViewPts(g, { ...sub, z: hills(sub.x, sub.y) + z }, o), `${kind} t=${t} z=${z}`);
      assert.ok(g.pos.z >= hills(g.pos.x, g.pos.y) + BC.minZ - 1e-9);
      assert.ok((g.pos.y - sub.y) * dir > 0, 'the camera is in front of the player, toward the court');
    }
  });
}

for (const dir of [1, -1]) test(`broadcast flight shot frames the cochonnet, then the boule as it lands (dir ${dir})`, () => {
  const o = { aspect: 1.6, fov: 50 };
  const jy = dir > 0 ? 9 : 6, jack = body('jack', 2, jy, 0, 0, { state: 'resting' });
  const st = { t: 0, anchor: { x: jack.x, y: jack.y } };
  for (const dd of [12, 8, 5, 2, 0.5]) {
    const b = body('boule', 2.2, jy - dir * dd, 0, dir * 4, { state: 'airborne', z: dd > 3 ? 1.5 : 0.2 });
    const g = broadcastGoal('flight', st, { body: b, jack, dir, groundAt: hills, ...o });
    assert.ok(inViewPts(g, { x: jack.x, y: jack.y, z: 0.1 }, o), `jack in frame, boule ${dd} m out`);
    if (dd <= BC.flight.pullIn) assert.ok(inViewPts(g, { x: b.x, y: b.y, z: b.z }, o), `boule in frame at ${dd} m`);
    assert.ok((g.pos.y - jack.y) * dir > 0, 'camera beyond the jack, away from the thrower');
    assert.ok(g.pos.z >= hills(g.pos.x, g.pos.y) + BC.minZ - 1e-9);
  }
});

test('frameBroadcast: a cut snaps, moves are smooth and capped, pause holds, reduced motion pans slower', () => {
  const sub = { x: 2, y: 1 }, s = { subject: sub, face: 0, dir: 1, groundAt: hills, aspect: 1.6, fov: 50 };
  const a = frameBroadcast('prep', { ...s, dt: 1 / 60 }, null);
  assert.deepEqual(frameBroadcast('prep', { ...s, dt: 0 }, a), a);
  const moved = { ...s, subject: { x: 2, y: 3 } };
  let n = a, r = a, maxStep = 0, maxR = 0;
  for (let i = 0; i < 30; i++) {
    const n2 = frameBroadcast('prep', { ...moved, dt: 1 / 60 }, n);
    maxStep = Math.max(maxStep, Math.hypot(n2.tgt.x - n.tgt.x, n2.tgt.y - n.tgt.y)); n = n2;
    const r2 = frameBroadcast('prep', { ...moved, dt: 1 / 60, reduced: true }, r);
    maxR = Math.max(maxR, Math.hypot(r2.tgt.x - r.tgt.x, r2.tgt.y - r.tgt.y)); r = r2;
  }
  assert.ok(maxStep <= BC.person.tgt.max / 60 + 1e-9);
  assert.ok(maxR < maxStep, 'reduced motion pans slower');
  const red = frameBroadcast('prep', { ...s, dt: 1 / 60, reduced: true }, null);
  assert.equal(broadcastGoal('prep', { t: 0 }, { ...s, reduced: true }).pos.x, broadcastGoal('prep', { t: 9 }, { ...s, reduced: true }).pos.x, 'no push-in when reduced');
  assert.ok(red.pos);
});

test('cameraStyle: broadcast works in both modes, the human turn keeps the game cameras', () => {
  assert.equal(cameraStyle({ slow: true, override: 'broadcast' }), 'broadcast');
  assert.equal(cameraStyle({ slow: false, override: 'broadcast' }), 'broadcast');
  assert.equal(cameraStyle({ slow: true, human: true, override: 'broadcast' }), 'game');
  assert.equal(cameraStyle({ slow: true }), 'observer', 'the default is unchanged');
});

const PL = [{ id: 'you', team: 0 }, { id: 'pierre', team: 0 }, { id: 'marcel', team: 1 }, { id: 'odette', team: 1 }];
test('director: the reaction follows the outcome', () => {
  const was = { owner: 'you', team: 0 };
  assert.equal(reactionChoice({ mood: 'watch', was, prevHold: null, players: PL, pick: 0.3 }), null);
  assert.equal(reactionChoice({ mood: 'dismay', was, prevHold: 1, players: PL, pick: 0.9 }).id, 'you');
  assert.equal(reactionChoice({ mood: 'celebrate', was, prevHold: null, players: PL, pick: 0.2 }).role, 'thrower');
  assert.equal(reactionChoice({ mood: 'celebrate', was, prevHold: null, players: PL, pick: 0.8 }).id, 'pierre');
  const taken = reactionChoice({ mood: 'celebrate', was, prevHold: 1, players: PL, pick: 0.2 });
  assert.equal(taken.role, 'opponent'); assert.equal(taken.mood, 'dismay');
  assert.ok(['marcel', 'odette'].includes(taken.id));
});

test('director: hover is 1 to 2 s, no reaction cut under reduced motion, pause freezes the schedule', () => {
  for (const p of [0, 0.5, 1]) { const h = hoverMs(p); assert.ok(h >= 1000 && h <= 2000); }
  const out = { mood: 'dismay', was: { owner: 'you', team: 0 }, prevHold: 1, players: PL };
  assert.equal(afterStop({ reduced: true, ...out }).reaction, null);
  assert.equal(afterStop({ reduced: true, ...out }).nextTurn, DIRECTOR.baseDelay);
  assert.ok(afterStop({ reduced: false, ...out }).nextTurn > DIRECTOR.baseDelay);
  const q = []; const shots = [];
  const d = createDirector({ later: (fn, ms) => q.push([fn, ms]), show: (s) => shots.push(s.kind), reduced: () => false });
  d.prep('you', 0); d.throwShot('you', 0); d.release({}); const next = d.afterStop(out);
  assert.deepEqual(shots, ['prep', 'throw', 'flight']);
  assert.equal(q.length, 1, 'the reaction waits on the game clock (nothing runs until the clock ticks)');
  q[0][0](); assert.equal(shots[3], 'reaction'); assert.ok(next > 2000);
  const d2 = createDirector({ later: (fn) => q.push([fn]), show: (s) => shots.push(s.kind) });
  d2.afterStop(out); d2.cancel(); const n = shots.length; q[q.length - 1][0](); assert.equal(shots.length, n, 'a cancelled shot never fires');
});

test('F48: view offsets are clamped to the allowed pan region, never wrapped', async () => {
  const { clampViewOffset, panViewOffset, VIEW_PAN } = await import('../../assets/js/petanque/camera.js');
  assert.deepEqual(clampViewOffset(0.2, 0.1), { yaw: 0.2, pitch: 0.1 });
  assert.equal(clampViewOffset(10, 0).yaw, VIEW_PAN.maxYaw);
  assert.equal(clampViewOffset(-10, 0).yaw, -VIEW_PAN.maxYaw);
  assert.equal(clampViewOffset(0, 5).pitch, VIEW_PAN.maxPitch);
  assert.equal(clampViewOffset(0, -5).pitch, -VIEW_PAN.maxPitch);
  assert.deepEqual(clampViewOffset(NaN, undefined), { yaw: 0, pitch: 0 });
});

test('F48: holding a direction pans at a steady rate and stops at the edge', async () => {
  const { panViewOffset, VIEW_PAN } = await import('../../assets/js/petanque/camera.js');
  let v = { yaw: 0, pitch: 0 };
  v = panViewOffset(v, 1, 0, 0.1);
  assert.ok(Math.abs(v.yaw - VIEW_PAN.yawRate * 0.1) < 1e-9 && v.pitch === 0);
  v = panViewOffset(v, -1, 0, 0.1);
  assert.ok(Math.abs(v.yaw) < 1e-9);
  for (let i = 0; i < 400; i++) v = panViewOffset(v, 1, 1, 1 / 60); // right and down for 6+ s
  assert.equal(v.yaw, VIEW_PAN.maxYaw);
  assert.equal(v.pitch, VIEW_PAN.maxPitch); // down looks down: positive pitch
});

test('F39: walkSubject leads the walker toward the goal and settles on the goal', () => {
  const far = walkSubject({ x: 0, y: 0 }, { x: 0, y: 10 }, 3);
  assert.deepEqual(far, [{ x: 0, y: 0 }, { x: 0, y: 3 }]);
  const near = walkSubject({ x: 1, y: 9 }, { x: 0, y: 10 }, 3);
  assert.deepEqual(near[1], { x: 0, y: 10 });
  const out = [{ x: 9, y: 9 }, { x: 9, y: 9 }];
  assert.equal(walkSubject({ x: 2, y: 2 }, { x: 2, y: 2 }, 3, out), out);
  assert.deepEqual(out, [{ x: 2, y: 2 }, { x: 2, y: 2 }]);
});

test('F39: the observer follows a walker smoothly (no jumps) toward the circle', () => {
  const ground = () => 0, goal = { x: 6, y: 20 };
  let pos = { x: 1, y: 2 }, f = null, prev = null, maxStep = 0;
  for (let i = 0; i < 60 * 9; i++) {
    pos = { x: pos.x + (goal.x - pos.x) * 0.004, y: Math.min(goal.y, pos.y + 2.4 / 60) };
    f = frameObserver(walkSubject(pos, goal), { dt: 1 / 60, aspect: 1.6, fov: 50, groundAt: ground }, f);
    if (prev) maxStep = Math.max(maxStep, Math.hypot(f.pos.x - prev.pos.x, f.pos.y - prev.pos.y, f.pos.z - prev.pos.z));
    prev = f;
  }
  assert.ok(maxStep < OBS.dolly.max / 60 + 1e-6, 'camera moves at most walking pace: ' + maxStep);
  assert.ok(Math.abs(f.center.y - 20) < 3, 'ends framing the circle area');
});

// ---- F57: the wide court shot ----
import { frameCourtWide, viewPoint, WIDE } from '../../assets/js/petanque/camera.js';
import { C as CC } from '../../assets/js/petanque/constants.js';
for (const [name, aspect, fov] of [['landscape', 1.78, 50], ['square', 1, 50], ['portrait', 0.5, 62]]) {
  test(`F57 wide shot (${name}): the whole court is in frame and Rainier is above the horizon line in view`, () => {
    const f = frameCourtWide({ width: CC.terrainW, length: CC.terrainL, aspect, fov });
    assert.ok(f.pos.y < 0 && f.pos.z > 1.5, 'behind the near end and raised');
    for (const [x, y] of [[0, 0], [CC.terrainW, 0], [0, CC.terrainL], [CC.terrainW, CC.terrainL]]) {
      const v = viewPoint({ x, y, z: 0 }, f, { aspect, fov });
      assert.ok(v && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1, `corner ${x},${y} in frame ${JSON.stringify(v)}`);
    }
    assert.ok(f.topEl > WIDE.rainierEl + 1, 'the 9 degree summit is inside the top of the picture');
    const horizon = viewPoint({ x: f.pos.x, y: f.pos.y + 1e5, z: f.pos.z }, f, { aspect, fov });
    assert.ok(horizon.y > -1 && horizon.y < 1, 'the horizon is in view');
    const summit = viewPoint({ x: f.pos.x, y: f.pos.y + 1e5, z: f.pos.z + 1e5 * Math.tan(WIDE.rainierEl * Math.PI / 180) }, f, { aspect, fov });
    assert.ok(summit.y < 1 && summit.y > horizon.y, 'Rainier summit visible above the horizon');
  });
}
test('F57 wide shot follows the ground height', () => {
  const f = frameCourtWide({ aspect: 1.5, fov: 50, groundAt: () => 2 });
  assert.ok(f.pos.z > 2 + 1.5);
});

// ---- F62: scoring view fit ----
const SCORE_VIEWPORTS = [
  { name: '1712x1474', W: 1712, H: 1474, bar: 70, card: 62, icons: [[1672, 70, 1708, 106], [1672, 118, 1708, 154], [1594, 1380, 1710, 1412]] },
  { name: '1200x800', W: 1200, H: 800, bar: 70, card: 62, icons: [[1158, 70, 1194, 106], [1158, 118, 1194, 154], [1082, 706, 1118, 740]] },
  { name: '500x900', W: 500, H: 900, bar: 85, card: 130, icons: [[458, 85, 496, 121], [458, 133, 496, 169], [382, 780, 418, 812]] },
  { name: '844x390', W: 844, H: 390, bar: 50, card: 90, icons: [[800, 50, 836, 86], [800, 94, 836, 130]] },
];
const rectOf = (v) => freeViewRect({
  W: v.W, H: v.H, bars: [{ l: 8, t: 4, r: v.W - 8, b: v.bar }], card: { l: 8, t: v.H - v.card, r: v.W - 60, b: v.H - 4 },
  icons: v.icons.map(([l, t, r, b]) => ({ l, t, r, b })),
});

test('F62: the free rectangle excludes the top bar, the card and the right icon cluster', () => {
  for (const v of SCORE_VIEWPORTS) {
    const f = rectOf(v);
    assert.ok(f.t >= v.bar, v.name + ' below the score bar');
    assert.ok(f.b <= v.H - v.card, v.name + ' above the card');
    assert.ok(f.r <= v.icons[0][0], v.name + ' left of the icon column');
    assert.ok(f.r - f.l > 100 && f.b - f.t > 40, v.name + ' not degenerate');
  }
});

test('F62: ring, badges and labels are centred, inside the free rectangle with a margin, and fill it', () => {
  // ring r 0.5 m round the jack plus two labels hanging outside the ring edge on the right and below
  const jack = { x: 2.3, y: 9.2 };
  const sets = [
    [{ x: jack.x - 0.5, y: jack.y - 0.5 }, { x: jack.x + 0.5, y: jack.y + 0.5 }, { x: jack.x + 0.9, y: jack.y - 0.2 }, { x: jack.x - 0.2, y: jack.y - 0.75 }],
    [{ x: jack.x - 0.12, y: jack.y - 0.12 }, { x: jack.x + 0.12, y: jack.y + 0.12 }, { x: jack.x + 0.4, y: jack.y }], // tiny ring, wide labels
    [{ x: jack.x - 1, y: jack.y - 0.1 }, { x: jack.x + 1, y: jack.y + 0.1 }], // wide and flat
  ];
  for (const v of SCORE_VIEWPORTS) for (const pts of sets) {
    const f = rectOf(v), fit = fitScoringView(pts, f, { cardH: v.card, H: v.H });
    const sx = (p) => fit.screen.x + (p.x - fit.centre.x) * fit.scale, sy = (p) => fit.screen.y - (p.y - fit.centre.y) * fit.scale;
    const m = SCORING_FIT.margin - 1e-6;
    for (const p of pts) {
      assert.ok(sx(p) >= f.l + m && sx(p) <= f.r - m && sy(p) >= f.t + m && sy(p) <= f.b - m, `${v.name}: point inside the free rectangle`);
    }
    const xs = pts.map(sx), ys = pts.map(sy);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const small = Math.min(f.r - f.l, f.b - f.t);
    assert.ok(Math.max(w / (f.r - f.l), h / (f.b - f.t)) >= 0.85, `${v.name}: F82 fills most of the free rectangle`);
    assert.ok(Math.max(w, h) >= 0.6 * small, `${v.name}: fills at least 60% of the smaller free dimension (${(Math.max(w, h) / small).toFixed(2)})`);
    assert.ok(w <= (f.r - f.l) * 0.95 + 1e-6 && h <= (f.b - f.t) * 0.95 + 1e-6, `${v.name}: not more than 95%`);
    // centred
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - (f.l + f.r) / 2) < 1e-6);
  }
});

test('F62: a tall card lifts the centre; a short one does not', () => {
  const f = { l: 0, t: 100, r: 500, b: 700 };
  const flat = scoringTargetBox(f, 1, { cardH: 50, H: 900 }), tall = scoringTargetBox(f, 1, { cardH: 300, H: 900 });
  assert.ok(tall.t < flat.t && tall.b < flat.b);
  assert.ok(Math.abs((flat.t + flat.b) / 2 - 400) < 1e-6);
});
