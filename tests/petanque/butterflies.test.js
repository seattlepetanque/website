import test from 'node:test';
import assert from 'node:assert/strict';
import { createButterflyField, BF } from '../../assets/js/petanque/butterflies.js';
import { C } from '../../assets/js/petanque/constants.js';

const rectDist = (x, y) => Math.hypot(Math.max(-x, 0, x - C.terrainW), Math.max(-y, 0, y - C.terrainL));
const run = (seed, secs, opts, each) => {
  const f = createButterflyField(seed, opts);
  for (let t = 0; t < secs; t += 0.05) { f.step(0.05); if (each) each(f); }
  return f;
};

test('counts: 3-6 butterflies, 10-20 seeds', () => {
  for (let s = 1; s < 40; s++) {
    const f = createButterflyField(s);
    assert.ok(f.flies.length >= 3 && f.flies.length <= 6);
    assert.ok(f.seeds.length >= 10 && f.seeds.length <= 20);
  }
});

test('bounded region, heights and speeds', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    run(seed, 300, {}, (f) => {
      for (const b of f.flies) {
        assert.ok(rectDist(b.x, b.y) <= BF.radius + 1e-6, 'within range of the court');
        assert.ok(b.z >= BF.zMin - 1e-9 && b.z <= BF.zMax + 1e-9);
        assert.ok(Math.hypot(b.vx, b.vy) <= BF.maxSpeed + 1e-6);
      }
      for (const s of f.seeds) { assert.ok(rectDist(s.x, s.y) <= BF.radius); assert.ok(s.z >= BF.seedZMin - 1e-9 && s.z <= BF.seedZMax + 1e-9); }
    });
  }
});

test('butterflies use the margins and sometimes cross the court edge', () => {
  let inside = 0, outside = 0;
  run(3, 600, {}, (f) => { for (const b of f.flies) (rectDist(b.x, b.y) === 0 ? inside++ : outside++); });
  assert.ok(outside > 0 && inside > 0 && outside > inside);
});

test('deterministic per seed, different between seeds', () => {
  const snap = (f) => JSON.stringify([f.flies.map((b) => [b.x, b.y, b.z]), f.seeds.map((s) => [s.x, s.y, s.z])]);
  assert.equal(snap(run(7, 60)), snap(run(7, 60)));
  assert.notEqual(snap(run(7, 60)), snap(run(8, 60)));
});

test('never inside a keep-out circle', () => {
  const keepOut = [{ x: 2, y: 1, r: 3.5 }, { x: -3, y: 8, r: 4 }, { x: 6, y: 12, r: 2 }];
  for (const seed of [1, 2, 3]) {
    run(seed, 300, { keepOut }, (f) => {
      for (const p of [...f.flies, ...f.seeds]) for (const c of keepOut) assert.ok(Math.hypot(p.x - c.x, p.y - c.y) >= c.r - 1e-6);
    });
  }
});

test('dt 0 freezes everything', () => {
  const f = run(5, 20);
  const a = JSON.stringify([f.flies, f.seeds]);
  for (let i = 0; i < 10; i++) f.step(0);
  assert.equal(JSON.stringify([f.flies, f.seeds]), a);
});

test('seeds drift downwind and respawn when they leave', () => {
  const f = createButterflyField(2);
  const s = f.seeds[0]; s.x = 0; s.y = 0;
  f.step(0.05, { x: 1, y: 0 });
  const x0 = s.x;
  f.step(1, { x: 1, y: 0 }); // dt clamp is 0.1 s
  assert.ok(s.x > x0);
  let respawned = 0, last = s.x;
  for (let i = 0; i < 2000; i++) { f.step(0.1, { x: 1, y: 0 }); if (s.x < last - 5) respawned++; last = s.x; }
  assert.ok(respawned >= 1);
});
