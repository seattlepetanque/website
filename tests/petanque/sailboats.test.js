import test from 'node:test';
import assert from 'node:assert/strict';
import { createSailFleet, lakeDepth, SAIL } from '../../assets/js/petanque/sailboats.js';

const CX = 2;
const run = (seed, secs, avoid, each) => {
  const f = createSailFleet(seed, { cx: CX, count: 5 });
  for (let t = 0; t < secs; t += 0.1) { f.step(0.1, typeof avoid === 'function' ? avoid(t) : avoid); if (each) each(f, t); }
  return f;
};

test('boats start in the lake and stay inside it (shore margin) over long runs, many seeds', () => {
  for (let seed = 1; seed <= 30; seed++) {
    run(seed, 1800, null, (f) => { for (const b of f.boats) assert.ok(lakeDepth(b.x, b.y, CX) >= SAIL.margin - 3.01, `seed ${seed} boat out of lake at ${b.x.toFixed(1)},${b.y.toFixed(1)}`); });
  }
});

test('speeds 0-3 m/s and the heading changes smoothly', () => {
  const prev = new Map();
  run(5, 900, null, (f) => {
    for (const b of f.boats) {
      assert.ok(b.speed <= SAIL.maxSpeed + 1e-6);
      if (prev.has(b)) assert.ok(Math.abs(Math.atan2(Math.sin(b.heading - prev.get(b)), Math.cos(b.heading - prev.get(b)))) <= SAIL.maxTurn * 0.1 + 1e-9);
      prev.set(b, b.heading);
    }
  });
});

test('boats move (not stuck) and are varied between seeds', () => {
  const a = run(1, 600), b = run(2, 600), start = createSailFleet(1, { cx: CX, count: 5 });
  assert.ok(a.boats.some((q, i) => Math.hypot(q.x - start.boats[i].x, q.y - start.boats[i].y) > 20));
  assert.notEqual(a.boats[0].x, b.boats[0].x);
});

test('deterministic for a seed', () => {
  const a = run(9, 300), b = run(9, 300);
  assert.deepEqual(a.boats.map((q) => [q.x, q.y, q.heading]), b.boats.map((q) => [q.x, q.y, q.heading]));
});

test('boats keep out of the avoid zone (a plane on the water) once outside it', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const avoid = { x: CX + 10, y: 120, r: SAIL.avoidR };
    const f = createSailFleet(seed, { cx: CX, count: 5 });
    for (const b of f.boats) { // push boats into the zone's rim at the start: those inside must leave, those outside must not enter
      b.in = Math.hypot(b.x - avoid.x, b.y - avoid.y) < avoid.r;
    }
    for (let t = 0; t < 600; t += 0.1) {
      f.step(0.1, avoid);
      for (const b of f.boats) {
        const d = Math.hypot(b.x - avoid.x, b.y - avoid.y);
        if (b.in && d >= avoid.r) b.in = false;
        assert.ok(b.in || d >= avoid.r - 0.5, `seed ${seed} entered the zone (${d.toFixed(1)})`);
      }
    }
  }
});

test('a moving zone (plane taking off) is also respected and boats stay in the lake', () => {
  run(4, 300, (t) => ({ x: CX + 28 - t * 0.2, y: 138 - t * 4, r: SAIL.avoidR }), (f) => { for (const b of f.boats) assert.ok(lakeDepth(b.x, b.y, CX) >= SAIL.margin - 3.01); });
});

test('large dt is subdivided', () => {
  const f = createSailFleet(3, { cx: CX }); f.step(5, null);
  for (const b of f.boats) assert.ok(lakeDepth(b.x, b.y, CX) >= SAIL.margin - 3.01);
});
