import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { mulberry32, gauss, makeNoise2D } from '../../assets/js/petanque/rng.js';
import { C } from '../../assets/js/petanque/constants.js';

const pts = (n, seed = 5) => {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => [-0.4 + r() * 4.8, -0.4 + r() * 15.8]);
};

test('rng is deterministic and in range', () => {
  const a = mulberry32(1), b = mulberry32(1);
  for (let i = 0; i < 100; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
  assert.ok(Number.isFinite(gauss(mulberry32(2))));
  const n = makeNoise2D(mulberry32(3));
  for (const [x, y] of pts(500)) assert.ok(Math.abs(n(x * 3, y * 3)) <= 1);
});

test('terrain is deterministic by seed', () => {
  const a = createTerrain(42), b = createTerrain(42), c = createTerrain(43);
  assert.deepEqual(a.visibleStones(), b.visibleStones());
  assert.notDeepEqual(a.visibleStones(), c.visibleStones());
  for (const [x, y] of pts(50)) assert.deepEqual(a.sample(x, y), b.sample(x, y));
  assert.ok(pts(50).some(([x, y]) => a.sample(x, y).h !== c.sample(x, y).h));
});

test('height within 5 cm, normals unit length, loose in [0,1]', () => {
  const t = createTerrain(7);
  for (const [x, y] of pts(2000)) {
    const s = t.sample(x, y);
    assert.ok(Math.abs(s.h) <= 0.05, `h=${s.h}`);
    assert.ok(Math.abs(Math.hypot(s.nx, s.ny, s.nz) - 1) < 1e-6);
    assert.ok(s.nz > 0.5);
    assert.ok(s.loose >= 0 && s.loose <= 1);
    assert.ok(s.friction >= C.rollResistPacked - 1e-6 && s.friction <= C.rollResistLoose + 1e-6);
  }
});

test('stone counts are sensible and bounded', () => {
  const t = createTerrain(9);
  const n = t.visibleStones().length;
  assert.ok(n > 500 && n <= C.maxStones, `stones=${n}`);
  const rocks = t.visibleStones().filter((s) => s.r >= C.rockR[0]).length;
  assert.ok(rocks >= 5 && rocks <= 30, `rocks=${rocks}`);
});

test('stonesNear matches brute force', () => {
  const t = createTerrain(11);
  const all = t.visibleStones();
  const key = (s) => `${s.x},${s.y}`;
  for (const [x, y] of pts(60, 8)) {
    for (const radius of [0.015, 0.0375, 0.2]) {
      const got = t.stonesNear(x, y, radius).map(key).sort();
      const want = all
        .filter((s) => (s.x - x) ** 2 + (s.y - y) ** 2 <= (radius + s.r) ** 2)
        .map(key).sort();
      assert.deepEqual(got, want);
    }
  }
});

test('divots change h locally and reset', () => {
  const t = createTerrain(13);
  const before = t.sample(2, 7).h, far = t.sample(3.5, 12).h;
  t.addDivot(2, 7, 0.01, 0.05);
  assert.ok(t.sample(2, 7).h < before - 0.005);
  assert.equal(t.sample(3.5, 12).h, far);
  assert.ok(t.perceived().sample(2, 7).h < before - 0.005); // shared buffer
  t.resetDivots();
  assert.equal(t.sample(2, 7).h, before);
});

test('perceived() has no jitter and same API', () => {
  const t = createTerrain(17), p = t.perceived();
  for (const m of ['sample', 'stonesNear', 'visibleStones', 'heightGrid']) assert.equal(typeof p[m], 'function');
  let diff = 0;
  for (const [x, y] of pts(200)) {
    const d = Math.abs(t.sample(x, y).h - p.sample(x, y).h);
    assert.ok(d <= C.jitterAmp + 1e-9);
    diff = Math.max(diff, d);
  }
  assert.ok(diff > 0);
  const g = t.heightGrid(0.05);
  assert.equal(g.data.length, g.w * g.h);
});

test('sample is fast', () => {
  const t = createTerrain(1);
  const t0 = performance.now();
  let s = 0;
  for (let i = 0; i < 200000; i++) s += t.sample(2 + (i % 100) * 0.01, 5 + (i % 77) * 0.1).h;
  assert.ok(Number.isFinite(s));
  assert.ok(performance.now() - t0 < 1000);
});
