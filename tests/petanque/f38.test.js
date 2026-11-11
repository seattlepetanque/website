import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaneCuts, PLANE_CUT } from '../../assets/js/petanque/director.js';
import { solvePlaneShot, planeShotView, easePlaneShot, PSHOT } from '../../assets/js/petanque/camera.js';
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

// HUMAN RULE: busy (main.js humanBusy: the human's turn from the walk to the circle until their boule has landed) never lets a shot
// run: no cut while busy, and a running shot ends at the very moment busy starts.
test('human rule: no plane shot while the human is busy, and a running one ends the moment their turn begins', () => {
  let seed = 4242;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let n = 0; n < 200; n++) {
    // alternating AI / human turns of random lengths; busy covers the whole human turn, eligible is false while a boule flies
    const turns = []; let t = 0;
    while (t < 60) { const human = rnd() < 0.4, len = 4 + rnd() * 8; turns.push({ human, from: t, to: t + len }); t += len; }
    const cuts = createPlaneCuts({ rand: () => 0 });
    let on = false;
    for (let tt = 0; tt <= 55; tt += 0.1) {
      const turn = turns.find((x) => tt >= x.from && tt < x.to);
      const busy = turn.human;
      const v = cuts.update({ flight: 1, kind: 'takeoff', t: tt, allowed: true, visible: true, busy, eligible: !busy });
      if (v === 'cut') on = true; else if (v === 'end') on = false;
      if (busy) assert.equal(on, false, `shot still running at ${tt} during the human's turn`);
      assert.equal(cuts.on, on);
    }
  }
});

let seed = 987654;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const ASPECT = 1.6;
// plane positions along the F47 routes: takeoff from about (30,138) toward the court then veering off; landing from far away
function planePos() {
  const W = C.terrainW, r = rnd();
  if (r < 0.4) { const s = rnd(); return { x: 30 - s * 60 + (rnd() - 0.5) * 20, y: 138 - s * 95, z: s * s * 40 }; }
  if (r < 0.7) return { x: W / 2 + (rnd() - 0.5) * 120, y: 50 + rnd() * 150, z: rnd() * 80 };
  return { x: W / 2 + (rnd() - 0.5) * 160, y: 60 + rnd() * 190, z: rnd() * 120 };
}
function scene() {
  const circleY = rnd() < 0.5 ? 1 : 14, d = circleY < 5 ? 1 : -1, jd = 6 + rnd() * 4;
  const na = Math.floor(rnd() * 3), action = [];
  for (let i = 0; i < na; i++) action.push({ x: rnd() * 4, y: rnd() * 15, z: rnd() < 0.5 ? 0.1 : rnd() * 2 });
  return { plane: planePos(), player: { x: -1 + rnd() * 6, y: rnd() * 15, z: 0 }, jack: { x: 1 + rnd() * 2, y: circleY + d * jd, z: 0 }, action, aspect: ASPECT };
}
const inBox = (v, b) => v && Math.abs(v.x) <= b.x + 1e-6 && v.y >= b.lo - 1e-6 && v.y <= b.hi + 1e-6;

test('plane shot solver: whenever it fits, plane, player, jack and action are all in the frame with the margins', () => {
  let fits = 0, nones = 0;
  for (let i = 0; i < 600; i++) {
    const sc = scene(), r = solvePlaneShot(sc);
    if (!r.fit) { nones++; continue; }
    fits++;
    assert.ok(r.fov <= PSHOT.fovMax + 1e-9 && r.fov >= PSHOT.fovMin - 1e-9, `fov ${r.fov}`);
    assert.ok(r.pos.y < 0, 'the camera is at the near end, opposite the lake');
    assert.ok(r.pos.z >= 2.5 && r.pos.z <= 4.5);
    assert.ok(inBox(planeShotView(sc.plane, r, ASPECT), PSHOT.planeBox), 'plane in the upper frame');
    const head = { ...sc.player, z: PSHOT.playerH };
    for (const p of [sc.player, head, { ...sc.jack, z: 0.05 }, ...sc.action.map((a) => ({ ...a, z: Math.max(0.05, a.z) }))]) assert.ok(inBox(planeShotView(p, r, ASPECT), PSHOT.subjBox), `subject ${JSON.stringify(p)} in frame`);
    const t = Math.tan(r.fov * Math.PI / 360), a = planeShotView(sc.player, r, ASPECT), b = planeShotView(head, r, ASPECT);
    assert.ok((b.y - a.y) / 2 >= PSHOT.minPlayer - 1e-6, 'the player is not tiny');
    assert.ok(t > 0);
  }
  assert.ok(fits > 200, `fits often enough (${fits}/600, ${nones} no fit)`);
});

test('plane shot solver: deterministic, and a typical AI moment fits', () => {
  const sc = { plane: { x: 20, y: 110, z: 20 }, player: { x: 2, y: 1, z: 0 }, jack: { x: 2.5, y: 9, z: 0 }, action: [{ x: 2, y: 6, z: 0.4 }], aspect: ASPECT };
  const a = solvePlaneShot(sc), b = solvePlaneShot(JSON.parse(JSON.stringify(sc)));
  assert.equal(a.fit, true); assert.deepEqual(a, b);
});

test('plane shot solver: no fit when it cannot be done (plane too high for the maximum fov, plane behind the camera)', () => {
  const base = { player: { x: 2, y: 1, z: 0 }, jack: { x: 2.5, y: 9, z: 0 }, action: [], aspect: ASPECT };
  assert.equal(solvePlaneShot({ ...base, plane: { x: 2, y: 20, z: 300 } }).fit, false, 'straight overhead');
  assert.equal(solvePlaneShot({ ...base, plane: { x: 2, y: -300, z: 20 } }).fit, false, 'behind the camera');
  assert.equal(solvePlaneShot({ ...base, action: [{ x: 60, y: 10, z: 0.1 }], plane: { x: -3000, y: 10, z: 10 } }).fit, false, 'points spread wider than the maximum fov');
  assert.equal(solvePlaneShot({ ...base, plane: null }).fit, false);
});

test('plane shot solver: smooth. A slowly moving scene changes the solution a little per step and mostly keeps the anchor', () => {
  let sol = null, moves = 0, steps = 0, maxAim = 0, maxFov = 0;
  for (let i = 0; i < 400; i++) { // ~ 40 s at 0.1 s: a plane crossing, a player walking, a boule rolling
    const k = i / 400;
    const sc = { plane: { x: 30 - 50 * k, y: 138 - 70 * k, z: 5 + 25 * k }, player: { x: 2 + Math.sin(k * 6) * 1.5, y: 1 + 3 * k, z: 0 },
      jack: { x: 2.4, y: 8, z: 0 }, action: [{ x: 2, y: 2 + 5 * k, z: 0.1 }], aspect: ASPECT, prev: sol };
    const r = solvePlaneShot(sc);
    if (!r.fit) { sol = null; continue; }
    if (sol) {
      steps++;
      if (Math.hypot(r.pos.x - sol.pos.x, r.pos.y - sol.pos.y, r.pos.z - sol.pos.z) > 1e-6) moves++;
      else { maxAim = Math.max(maxAim, Math.abs(r.yaw - sol.yaw), Math.abs(r.pitch - sol.pitch)); maxFov = Math.max(maxFov, Math.abs(r.fov - sol.fov)); }
    }
    sol = r;
  }
  assert.ok(steps > 300);
  assert.ok(moves <= steps * 0.1, `the camera hops between anchors ${moves}/${steps} steps`);
  assert.ok(maxAim < 0.1 && maxFov < 6, `aim step ${maxAim}, fov step ${maxFov}`);
});

test('plane shot easing: moves smoothly toward the solution, a missing current starts at it', () => {
  const sc = { plane: { x: 20, y: 110, z: 20 }, player: { x: 2, y: 1, z: 0 }, jack: { x: 2.5, y: 9, z: 0 }, action: [], aspect: ASPECT };
  const want = solvePlaneShot(sc);
  assert.equal(easePlaneShot(null, want, 0.016), want);
  let cur = { ...want, pos: { ...want.pos, x: want.pos.x + 4 }, yaw: want.yaw + 0.3, fov: want.fov + 10 }, last = Infinity;
  for (let i = 0; i < 600; i++) { cur = easePlaneShot(cur, want, 1 / 60); const d = Math.abs(cur.pos.x - want.pos.x); assert.ok(d <= last + 1e-12); last = d; }
  assert.ok(last < 1e-2 && Math.abs(cur.yaw - want.yaw) < 1e-2 && Math.abs(cur.fov - want.fov) < 0.1);
});
