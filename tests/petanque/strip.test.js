import test from 'node:test';
import assert from 'node:assert/strict';
import { stripGeometry } from '../../assets/js/petanque/strip.js';

const normalZ = (pos, i, j, k) => {
  const a = pos.slice(3 * i, 3 * i + 3), b = pos.slice(3 * j, 3 * j + 3), c = pos.slice(3 * k, 3 * k + 3);
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
};

test('strip faces up for every direction', () => {
  for (const [x0, y0, x1, y1] of [[0, 0, 5, 0], [5, 0, 5, 8], [5, 8, 0, 8], [0, 8, 0, 0]]) {
    const { pos, idx } = stripGeometry(x0, y0, x1, y1, 0.016, 0.004, () => 0);
    for (let t = 0; t < idx.length; t += 3) assert.ok(normalZ(pos, idx[t], idx[t + 1], idx[t + 2]) > 0);
  }
});

test('strip drapes on the height function, lifted, with finite values', () => {
  const h = (x, y) => 0.1 * Math.sin(x) + 0.05 * y;
  const { pos } = stripGeometry(0, 0, 4, 0, 0.016, 0.004, h);
  assert.ok(pos.every(Number.isFinite));
  for (let i = 0; i < pos.length; i += 3) assert.ok(Math.abs(pos[i + 2] - (h(pos[i], pos[i + 1]) + 0.004)) < 1e-12);
  assert.ok(pos.length / 6 > 40);
});
