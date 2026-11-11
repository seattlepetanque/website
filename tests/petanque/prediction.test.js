import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TUBE_N, TUBE_SIDES, PYR_ROWS, PYR_CAP, PYR_COLS, PYR_VERTS,
  lateralFade, tubeAlong, silhouetteFade, throwTube, rollPyramid, tubeIndices, pyramidIndices,
} from '../../assets/js/petanque/prediction.js';

const arc = (n = 41) => Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return { x: 0, y: 8 * t, z: 1.5 + 2 * Math.sin(Math.PI * t) * 0.8 - 1.5 * t }; });
const edgesFor = (c) => [
  c.map((p) => ({ x: p.x + 0.05 + 0.2 * p.y / 8, y: p.y, z: p.z })), c.map((p) => ({ x: p.x - 0.05 - 0.2 * p.y / 8, y: p.y, z: p.z })),
  c.map((p) => ({ x: p.x, y: p.y, z: p.z + 0.1 })), c.map((p) => ({ x: p.x, y: p.y, z: p.z - 0.1 })),
];

test('fade profiles are smooth: 1 in the middle, 0 at the edges', () => {
  assert.equal(lateralFade(0), 1);
  assert.equal(lateralFade(1), 0); assert.equal(lateralFade(-1), 0);
  assert.ok(lateralFade(0.9) < 0.05); // zero slope at the edge
  assert.ok(lateralFade(0.3) > lateralFade(0.6));
  assert.ok(tubeAlong(0) === 0 && tubeAlong(1) === 0 && tubeAlong(0.6) > 0.1);
  assert.ok(silhouetteFade(0) > 0 && silhouetteFade(0) < 0.2); assert.ok(Math.abs(silhouetteFade(1) - 1) < 1e-9);
  assert.ok(silhouetteFade(0.5) < 0.6 && silhouetteFade(0.5) > silhouetteFade(0.2));
});

test('throw tube fills finite buffers with alpha in [0, 0.5] and unit radial directions', () => {
  const c = arc(), pos = new Float32Array(TUBE_N * TUBE_SIDES * 3), a = new Float32Array(TUBE_N * TUBE_SIDES), r = new Float32Array(pos.length);
  assert.ok(throwTube(c, edgesFor(c), pos, a, r));
  assert.ok([...pos, ...a, ...r].every(Number.isFinite));
  assert.ok(a.every((v) => v >= 0 && v <= 0.7));
  for (let i = 0; i < r.length; i += 3) assert.ok(Math.abs(Math.hypot(r[i], r[i + 1], r[i + 2]) - 1) < 0.35);
  assert.ok(a[0] === 0 && a[a.length - 1] === 0); // both ends fade out
  assert.ok(Math.max(...a) > 0.1);
  const ix = tubeIndices(); assert.ok(Math.max(...ix) < TUBE_N * TUBE_SIDES);
});

test('throw tube section grows toward the landing and refuses empty input', () => {
  const c = arc(), pos = new Float32Array(TUBE_N * TUBE_SIDES * 3), a = new Float32Array(TUBE_N * TUBE_SIDES), r = new Float32Array(pos.length);
  throwTube(c, edgesFor(c), pos, a, r);
  const width = (i) => { let lo = 1e9, hi = -1e9; for (let j = 0; j < TUBE_SIDES; j++) { const x = pos[(i * TUBE_SIDES + j) * 3]; lo = Math.min(lo, x); hi = Math.max(hi, x); } return hi - lo; };
  assert.ok(width(TUBE_N - 2) > 2 * width(2));
  assert.equal(throwTube([], null, pos, a, r), false);
});

const band = () => {
  const center = Array.from({ length: 40 }, (_, i) => ({ x: 0.1 * i / 39, y: 8 + 3 * i / 39, z: 0 }));
  return { center, halfWidths: center.map((_, i) => 0.05 + 0.15 * i / 39), restMean: center[39], restCov: { xx: 0.04, xy: 0, yy: 0.16 } };
};

test('roll pyramid: apex at the first contact, widening, alpha zero on every edge', () => {
  const xy = new Float32Array(PYR_VERTS * 2), al = new Float32Array(PYR_VERTS), b = band();
  const res = rollPyramid(b, xy, al);
  assert.ok(res && [...xy, ...al].every(Number.isFinite));
  const row = (i) => { const o = i * PYR_COLS; return { w: Math.hypot(xy[2 * (o + PYR_COLS - 1)] - xy[2 * o], xy[2 * (o + PYR_COLS - 1) + 1] - xy[2 * o + 1]) }; };
  assert.ok(Math.abs(xy[2 * 4] - b.center[0].x) < 0.01 && Math.abs(xy[2 * 4 + 1] - b.center[0].y) < 0.01); // middle of row 0
  assert.ok(row(0).w < 0.15); assert.ok(row(PYR_ROWS - 1).w > 0.6); assert.ok(row(12).w > row(2).w);
  for (let i = 0; i < PYR_ROWS + PYR_CAP; i++) { assert.equal(al[i * PYR_COLS], 0); assert.equal(al[i * PYR_COLS + PYR_COLS - 1], 0); }
  for (let j = 0; j < PYR_COLS; j++) assert.ok(al[(PYR_ROWS + PYR_CAP - 1) * PYR_COLS + j] < 1e-9); // the cap closes to a point
  assert.ok(Math.max(...al) <= 0.5 && Math.max(...al) > 0.2);
  assert.ok(Math.max(...pyramidIndices()) < PYR_VERTS && PYR_CAP > 0 && PYR_ROWS > 0);
});

test('roll pyramid base follows the rest spread and the cap extends past the rest point', () => {
  const xy = new Float32Array(PYR_VERTS * 2), al = new Float32Array(PYR_VERTS), b = band();
  const narrow = rollPyramid(b, xy, al).base;
  b.restCov = { xx: 0.4, xy: 0, yy: 0.16 };
  const wide = rollPyramid(b, xy, al).base;
  assert.ok(wide > narrow);
  const capMid = (PYR_ROWS + PYR_CAP / 2) * PYR_COLS + 4;
  assert.ok(xy[2 * capMid + 1] > b.restMean.y);
  assert.equal(rollPyramid({ center: [{ x: 0, y: 0 }] }, xy, al), null);
  assert.equal(rollPyramid(null, xy, al), null);
});
