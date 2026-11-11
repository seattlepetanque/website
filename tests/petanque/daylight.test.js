import test from 'node:test';
import assert from 'node:assert/strict';
import { daylightAt, matchProgress, createDrift } from '../../assets/js/petanque/daylight.js';

const grid = Array.from({ length: 101 }, (_, i) => i / 100);

test('progress is clamped to 0..1', () => {
  assert.deepEqual(daylightAt(-3).sunDir, daylightAt(0).sunDir);
  assert.deepEqual(daylightAt(7).sunDir, daylightAt(1).sunDir);
  assert.equal(daylightAt(NaN).progress, 0);
});

test('sun direction is a unit vector, elevation falls monotonically from about 50 to about 22 degrees', () => {
  let prev = Infinity;
  for (const p of grid) {
    const d = daylightAt(p), len = Math.hypot(...d.sunDir);
    assert.ok(Math.abs(len - 1) < 1e-9);
    assert.ok(d.elevation <= prev + 1e-9);
    assert.ok(Math.abs(Math.asin(d.sunDir[2]) * 180 / Math.PI - d.elevation) < 1e-9);
    prev = d.elevation;
  }
  assert.ok(Math.abs(daylightAt(0).elevation - 50) < 1);
  assert.ok(Math.abs(daylightAt(1).elevation - 22) < 1);
});

test('colours stay between the endpoints and warm monotonically (red up relative to blue)', () => {
  const a = daylightAt(0), b = daylightAt(1);
  let prevWarm = -Infinity;
  for (const p of grid) {
    const d = daylightAt(p);
    for (const k of ['sunColor', 'skyHaze', 'hemiSky', 'hemiGround', 'fogColor']) {
      d[k].forEach((v, i) => {
        const lo = Math.min(a[k][i], b[k][i]) - 1e-9, hi = Math.max(a[k][i], b[k][i]) + 1e-9;
        assert.ok(v >= lo && v <= hi, `${k}[${i}] at ${p}`);
      });
    }
    assert.ok(d.sunIntensity >= a.sunIntensity - 1e-9 && d.sunIntensity <= b.sunIntensity + 1e-9);
    const warm = d.sunColor[0] - d.sunColor[2];
    assert.ok(warm >= prevWarm - 1e-9);
    prevWarm = warm;
  }
  assert.ok(b.sunColor[2] < a.sunColor[2] && b.skyHaze[2] < a.skyHaze[2]);
});

test('continuity: small steps give small changes', () => {
  for (let i = 0; i < 1000; i++) {
    const a = daylightAt(i / 1000), b = daylightAt((i + 1) / 1000);
    const dot = a.sunDir.reduce((s, v, k) => s + v * b.sunDir[k], 0);
    assert.ok(Math.acos(Math.min(1, dot)) < 0.002);
    assert.ok(Math.abs(a.sunIntensity - b.sunIntensity) < 0.005);
    a.skyHaze.forEach((v, k) => assert.ok(Math.abs(v - b.skyHaze[k]) < 0.002));
    assert.ok(Math.abs(a.alpenglow - b.alpenglow) < 0.02);
  }
});

test('alpenglow is 0 until about 0.7, then rises monotonically to 1', () => {
  assert.equal(daylightAt(0).alpenglow, 0);
  assert.equal(daylightAt(0.7).alpenglow, 0);
  assert.equal(daylightAt(1).alpenglow, 1);
  let prev = 0;
  for (const p of grid) { const g = daylightAt(p).alpenglow; assert.ok(g >= prev); prev = g; }
  assert.ok(daylightAt(0.85).alpenglow > 0.2);
});

test('panorama tint lands the haze on the horizon colour', () => {
  const d = daylightAt(0.6), z = daylightAt(0);
  d.panoTint.forEach((t, i) => assert.ok(Math.abs(t * z.skyHaze[i] - d.skyHaze[i]) < 1e-9));
});

test('matchProgress: 0 at the start, 1 at the target, never decreases as inputs grow', () => {
  assert.equal(matchProgress({ scores: [0, 0], target: 13, mene: 1, elapsed: 0 }), 0);
  assert.equal(matchProgress({ scores: [13, 4], target: 13, mene: 6, elapsed: 600 }), 1);
  let prev = 0;
  for (let i = 0; i <= 40; i++) {
    const p = matchProgress({ scores: [Math.min(13, i >> 1), Math.min(13, i >> 2)], target: 13, mene: 1 + (i >> 2), elapsed: i * 30 });
    assert.ok(p >= prev && p <= 1);
    prev = p;
  }
  assert.ok(matchProgress({ scores: [0, 0], target: 13, mene: 1, elapsed: 600 }) > 0);
});

test('drift never goes backwards, eases towards the target and resets', () => {
  const d = createDrift();
  const m = { scores: [0, 0], target: 13, mene: 1 };
  let prev = 0;
  for (let i = 0; i < 60; i++) { const v = d.step(m, 1); assert.ok(v >= prev); prev = v; }
  m.scores = [9, 3]; m.mene = 5;
  const first = d.step(m, 1 / 60);
  assert.ok(first - prev < 0.01, 'no jump');
  for (let i = 0; i < 600; i++) { const v = d.step(m, 1 / 10); assert.ok(v >= prev - 1e-12); prev = v; }
  assert.ok(prev > 0.6 && prev <= d.target + 1e-9);
  m.scores = [0, 0]; m.mene = 1; // a score cannot fall, but even if the input did, the value holds
  assert.ok(d.step(m, 1) >= prev);
  assert.equal(d.step(m, 0), d.value);
  d.reset();
  assert.equal(d.value, 0);
  assert.equal(d.step(null, 1), 0);
  const paused = d.step(m, 0);
  assert.equal(paused, 0);
});
