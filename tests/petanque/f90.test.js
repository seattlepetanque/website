import test from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../../assets/js/petanque/constants.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createBody, launch, createWorld, simulate } from '../../assets/js/petanque/physics.js';

// F90: a thrown boule or jack is not judged out of bounds until its first contact, so a release point beyond a
// string does not kill it; where it lands (and what happens after) decides.
const flat = () => ({
  sample: () => ({ h: 0, nx: 0, ny: 0, nz: 1, friction: 0.1, loose: 0 }),
  stonesNear: () => [], addDivot() {}, resetDivots() {}, visibleStones: () => [], perceived() { return this; },
});
const run = (kind, from, p, clone = false) => {
  let w = createWorld(flat(), mulberry32(3));
  const b = launch(createBody(kind, { team: 0 }), p, from);
  w.add(b);
  if (clone) { w = w.clone(); }
  const body = w.bodies[0];
  simulate(w);
  return { w, b: body };
};
const lands = (w) => w.events.find((e) => e.type === 'land');

for (const kind of ['boule', 'jack']) {
  for (const clone of [false, true]) {
    const tag = `${kind}${clone ? ' (clone)' : ''}`;
    test(`F90 ${tag}: released 0.2 m beyond the side string, landing in bounds, is not out`, () => {
      const { w, b } = run(kind, { x: -0.2, y: 3, z: 1 }, { yaw: 1.2, speed: 2, loft: 0.5, backspin: 0 }, clone);
      const l = lands(w);
      assert.ok(l && l.x > 0 && l.x < C.terrainW, `lands at x=${l && l.x}`);
      assert.equal(b.dead, false);
      assert.ok(!w.events.some((e) => e.type === 'dead'));
    });
    test(`F90 ${tag}: released beyond the string and landing out of bounds is still out`, () => {
      const { w, b } = run(kind, { x: -0.2, y: 3, z: 1 }, { yaw: -1.2, speed: 2, loft: 0.5, backspin: 0 }, clone);
      assert.ok(lands(w).x < 0);
      assert.equal(b.dead, true);
    });
    test(`F90 ${tag}: landing in bounds then rolling out is still out`, () => {
      const { w, b } = run(kind, { x: 2.5, y: 3, z: 0.5 }, { yaw: Math.PI / 2, speed: 3, loft: 0.1, backspin: 0 }, clone);
      const l = lands(w);
      assert.ok(l && l.x < C.terrainW, `lands at x=${l && l.x}`);
      assert.equal(b.dead, true);
    });
  }
}

test('F90: the flag is set at launch, cleared by the first landing, and absent on placed bodies', () => {
  const b = createBody('boule');
  assert.ok(!b.fresh);
  launch(b, { yaw: 0, speed: 3, loft: 0.5 }, { x: 2, y: 1, z: 1 });
  assert.equal(b.fresh, true);
  const w = createWorld(flat(), mulberry32(1));
  w.add(b);
  simulate(w);
  assert.equal(b.fresh, false);
});
