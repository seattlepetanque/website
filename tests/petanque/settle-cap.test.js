// E21: a cochonnet must always come to rest. Static friction on a slope used to leave a little spin that never
// decayed (speed 0, spin ~0.55 rad/s just over restSpin), so the world never settled; the window rest rule fixes it,
// and the hard cap forces anything still moving to rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createBody, launch, createWorld, simulate } from '../../assets/js/petanque/physics.js';
import { C } from '../../assets/js/petanque/constants.js';

function slope(grade, friction = 0.2) {
  const l = Math.hypot(grade, 1);
  return {
    sample: () => ({ h: 0, nx: 0, ny: -grade / l, nz: 1 / l, friction, loose: 0.5 }),
    stonesNear: () => [], addDivot() {}, resetDivots() {}, visibleStones: () => [],
    perceived() { return this; },
  };
}

// Seeded throws that used to hang with speed 0 and spin ~0.55 on a gravel slope (terrain seed, world seed, params)
const STUCK = [630, 189, 384, 417];
function stressThrow(i, kind) { // the same recipe the stress script used
  const rnd = mulberry32(i * 7 + 1);
  const w = createWorld(createTerrain(i % 40 + 1), mulberry32(i + 99));
  const b = w.add(createBody(kind, {}));
  const p = { speed: 2 + rnd() * 14, loft: (3 + rnd() * 70) * Math.PI / 180, yaw: (rnd() - 0.5) * (rnd() < 0.3 ? 1.6 : 0.4), backspin: rnd() * 80, sidespin: (rnd() - 0.5) * 40 };
  launch(b, p);
  return { w, b };
}

test('E21: seeded jack throws that used to stick now settle', () => {
  for (const i of STUCK) {
    const { w, b } = stressThrow(i, 'jack');
    while (!w.settled() && w.t < 20) w.step();
    assert.ok(w.settled(), `seed ${i} still ${b.state} at 20 s`);
    assert.ok(w.t < C.hardCapSeconds, `seed ${i} took ${w.t.toFixed(1)} s`);
  }
});

test('E21: a jack held by static friction on a slope with residual spin rests', () => {
  const w = createWorld(slope(0.2), mulberry32(1));
  const b = w.add(createBody('jack', { x: 1, y: 5, state: 'rolling', wx: 0.55 }));
  simulate(w, 5);
  assert.equal(b.state, 'resting');
  assert.ok(w.t < 3, `rested after ${w.t.toFixed(1)} s`);
  assert.deepEqual([b.vx, b.vy, b.wx, b.wy, b.wz], [0, 0, 0, 0, 0]);
});

test('E21 hard cap: forceRest stops everything still moving and settles the world', () => {
  const w = createWorld(slope(0, 0), mulberry32(1)); // frictionless: never stops by itself
  const a = w.add(createBody('jack', { x: 1, y: 2, state: 'rolling', vy: 0.5 }));
  const g = w.add(createBody('boule', { x: 2, y: 2, state: 'airborne', z: 0.5 }));
  while (w.t < C.hardCapSeconds) w.step();
  g.state = 'rolling'; g.vy = 0.3; g.z = g.r; // an airborne ball would have landed; keep the case simple
  assert.ok(!w.settled(), 'the frictionless jack is still rolling at the cap');
  const stopped = w.forceRest();
  assert.ok(w.settled());
  assert.ok(stopped.length >= 1 && stopped.every((s) => 'speed' in s && 'state' in s));
  assert.equal(a.vy, 0); assert.equal(a.state, 'resting');
  assert.ok(Number.isFinite(a.x + a.y + a.z));
});

test('E21: simulate() is bounded and leaves nothing moving', () => {
  const w = createWorld(slope(0, 0), mulberry32(1));
  const a = w.add(createBody('jack', { x: 1, y: 2, state: 'rolling', vy: 0.5 }));
  simulate(w, 3);
  assert.ok(w.settled());
  assert.ok(w.t < 3.1);
  assert.equal(a.state, 'resting');
});

test('E21: 100 seeded jack throws (wide yaw, timbers, gravel) all settle inside the cap', () => {
  let worst = 0;
  for (let i = 0; i < 100; i++) {
    const { w, b } = stressThrow(i * 9 + 1, 'jack');
    while (!w.settled() && w.t < 20) w.step();
    assert.ok(w.settled(), `seed ${i * 9 + 1} stuck ${b.state}`);
    worst = Math.max(worst, w.t);
  }
  assert.ok(worst < C.hardCapSeconds, `worst ${worst.toFixed(1)} s`);
});
