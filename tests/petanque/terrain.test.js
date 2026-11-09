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

test('height within the macro clamp, normals unit length, loose in [0,1]', () => {
  const t = createTerrain(7);
  for (const [x, y] of pts(2000)) {
    const s = t.sample(x, y);
    assert.ok(Math.abs(s.h) <= C.maxHeight + C.jitterAmp, `h=${s.h}`);
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

test('pebbles barely protrude (a boule rides over them) while rocks stay real obstacles', () => {
  const t = createTerrain(8);
  let maxPebble = 0, maxRock = 0, rocks = 0;
  for (let x = 0; x < 4; x += 0.1) {
    for (let y = 0; y < 15; y += 0.1) {
      const g = t.perceived().sample(x, y).h;
      for (const s of t.stonesNear(x, y, 0.001)) {
        const top = s.h + s.r - g;
        if (s.r > C.pebbleR[1]) { maxRock = Math.max(maxRock, top); rocks++; } else maxPebble = Math.max(maxPebble, top);
      }
    }
  }
  assert.ok(maxPebble < 0.006, `pebble protrusion ${maxPebble}`);
  assert.ok(rocks > 0 && maxRock > 0.012, `rock protrusion ${maxRock}`);
});

// F05: slope field
const maxGradDeg = (t) => {
  let m = 0;
  for (let x = 0; x <= C.terrainW; x += 0.05) for (let y = 0; y <= C.terrainL; y += 0.05) {
    const s = t.perceived().sample(x, y);
    m = Math.max(m, (Math.atan(Math.hypot(s.nx, s.ny) / s.nz) * 180) / Math.PI);
  }
  return m;
};

test('max local gradient matches the configured slope, within 1 to 2 degrees', () => {
  assert.ok(C.slopeMaxDeg >= C.slopeMinDeg && C.slopeMaxDeg <= C.slopeLimitDeg);
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const m = maxGradDeg(createTerrain(seed));
    assert.ok(m <= C.slopeMaxDeg * 1.08 && m >= C.slopeMaxDeg * 0.7, `seed ${seed}: ${m}`);
  }
  for (const d of [1, 2]) assert.ok(maxGradDeg(createTerrain(3, { slopeMaxDeg: d })) <= d * 1.08);
  assert.ok(maxGradDeg(createTerrain(3, { slopeMaxDeg: 9 })) <= C.slopeLimitDeg * 1.08); // clamped to the limit
});

test('slope field is smooth: neighbouring gradients differ little', () => {
  for (const seed of [1, 2, 3]) {
    const v = createTerrain(seed).perceived();
    const g = (x, y) => { const s = v.sample(x, y); return [s.nx / s.nz, s.ny / s.nz]; };
    let worst = 0;
    for (let x = 0.1; x < 3.9; x += 0.1) for (let y = 0.1; y < 14.9; y += 0.1) {
      const a = g(x, y), b = g(x + 0.1, y), c = g(x, y + 0.1);
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1]));
    }
    assert.ok(worst < 0.025, `seed ${seed}: ${worst}`); // well under the steepest gradient (0.026) per 10 cm
  }
});

test('firm is the complement of loose', () => {
  const t = createTerrain(4);
  for (const [x, y] of pts(100)) { const s = t.sample(x, y); assert.ok(Math.abs(s.firm + s.loose - 1) < 1e-9); }
});

test('Read-the-ground overlay data matches sample()', async () => {
  const { fieldData, lookup } = await import('../../assets/js/petanque/groundview.js');
  const t = createTerrain(9), fd = fieldData(t), v = t.perceived();
  for (const [x, y] of pts(200).map(([a, b]) => [Math.min(3.9, Math.max(0, a)), Math.min(14.9, Math.max(0, b))])) {
    const s = v.sample(x, y), f = lookup(fd, x, y);
    assert.ok(Math.abs(f.dx - s.nx / s.nz) < 0.004, 'slope x');
    assert.ok(Math.abs(f.dy - s.ny / s.nz) < 0.004, 'slope y');
    assert.ok(Math.abs(f.firm - (1 - s.loose)) < 0.08, 'firmness');
  }
  for (let j = 0; j < fd.h; j += 7) for (let i = 0; i < fd.w; i += 5) {
    const s = v.sample(i * fd.step, j * fd.step), k = j * fd.w + i;
    assert.ok(Math.abs(fd.firm[k] - (1 - s.loose)) < 1e-6);
    assert.ok(Math.abs(fd.grad[k] - Math.hypot(s.nx, s.ny) / s.nz) < 1e-6);
  }
});

// F25: court shapes
const KINDS = Object.keys(C.shapeWeights);
const gradField = (t) => { // perceived gradient on a 0.25 m lattice over the court
  const v = t.perceived(), cols = [];
  const nx = Math.round(C.terrainW / 0.25) + 1, ny = Math.round(C.terrainL / 0.25) + 1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const s = v.sample(i * 0.25, j * 0.25); cols.push([-s.nx / s.nz, -s.ny / s.nz]); }
  return { nx, ny, g: cols };
};

test('terrain.shape: kind, unit direction and text; deterministic per seed', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const a = createTerrain(seed).shape, b = createTerrain(seed).shape;
    assert.deepEqual(a, b);
    assert.ok(KINDS.includes(a.kind));
    assert.ok(Math.abs(Math.hypot(a.dir.x, a.dir.y) - 1) < 0.01);
    assert.ok(typeof a.text === 'string' && a.text.length > 10);
    assert.deepEqual(createTerrain(seed).perceived().shape, a);
  }
});

test('every archetype is reachable by seed', () => {
  const seen = new Set();
  for (let s = 1; s <= 150 && seen.size < KINDS.length; s++) seen.add(createTerrain(s).shape.kind);
  assert.deepEqual([...seen].sort(), [...KINDS].sort());
});

test('each archetype: max gradient in range, main feature carries >= 70% of slope energy, coherent gradient direction', () => {
  for (const kind of KINDS) {
    for (const seed of [1, 2, 3]) {
      const t = createTerrain(seed, { shape: kind });
      assert.equal(t.shape.kind, kind);
      const m = maxGradDeg(t);
      assert.ok(m <= C.slopeMaxDeg * 1.08 && m >= C.slopeMaxDeg * 0.85, `${kind}/${seed}: ${m}`);
      assert.ok(t.shape.share >= 0.7, `${kind}/${seed}: share ${t.shape.share}`);
      // average angular change between neighbouring cells, ignoring near-flat spots
      const { nx, ny, g } = gradField(t);
      const gmax = Math.max(...g.map((v) => Math.hypot(v[0], v[1])));
      let sum = 0, n = 0;
      const ang = (a, b) => { const d = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]); return Math.abs(d); };
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = g[j * nx + i];
        if (Math.hypot(a[0], a[1]) < 0.2 * gmax) continue;
        for (const o of [i + 1 < nx ? j * nx + i + 1 : -1, j + 1 < ny ? (j + 1) * nx + i : -1]) {
          if (o < 0 || Math.hypot(g[o][0], g[o][1]) < 0.2 * gmax) continue;
          sum += ang(a, g[o]); n++;
        }
      }
      assert.ok(sum / n < 0.12, `${kind}/${seed}: mean angular change ${(sum / n).toFixed(3)} rad`);
    }
  }
});

test('a tilt runs the way terrain.shape.dir says', () => {
  const t = createTerrain(3, { shape: 'tilt' }), { g } = gradField(t);
  let sx = 0, sy = 0;
  for (const v of g) { sx += v[0]; sy += v[1]; }
  const n = Math.hypot(sx, sy);
  assert.ok((sx / n) * t.shape.dir.x + (sy / n) * t.shape.dir.y > 0.95);
});

test('shapeText words the shape for the direction the court is played', () => {
  const t = createTerrain(3, { shape: 'tilt' });
  assert.equal(t.shapeText(1), t.shape.text);
  assert.notEqual(t.shapeText(-1), t.shape.text);
  assert.match(t.shapeText(-1), /near end/);
});
