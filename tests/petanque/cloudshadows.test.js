import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudAt, cloudParams } from '../../assets/js/petanque/cloudshadows.js';

const p = cloudParams(3);

test('values in [0,1]', () => {
  for (let i = 0; i < 5000; i++) {
    const v = cloudAt((i * 37.1) % 900 - 300, (i * 91.7) % 900 - 300, i * 0.7, p);
    assert.ok(v >= 0 && v <= 1);
  }
});
test('drifts with the wind', () => {
  for (const [x, y, t, dt] of [[0, 0, 0, 10], [12, -40, 5, 33], [100, 70, 200, 1.5]]) {
    assert.ok(Math.abs(cloudAt(x + p.vx * dt, y + p.vy * dt, t + dt, p) - cloudAt(x, y, t, p)) < 1e-9);
  }
  const sp = Math.hypot(p.vx, p.vy);
  assert.ok(sp > 1.5 && sp < 3);
});
test('deterministic per seed, differs between seeds', () => {
  assert.deepEqual(cloudParams(3), cloudParams(3));
  assert.notDeepEqual(cloudParams(3), cloudParams(4));
  assert.equal(cloudAt(5, 6, 7, cloudParams(9)), cloudAt(5, 6, 7, cloudParams(9)));
});
test('coverage 25-60% of a large area, for several seeds', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const q = cloudParams(seed);
    let n = 0, dark = 0;
    for (let x = -1500; x < 1500; x += 15) for (let y = -1500; y < 1500; y += 15) { n++; if (cloudAt(x, y, 0, q) > 0.05) dark++; }
    const f = dark / n;
    assert.ok(f > 0.25 && f < 0.6, `seed ${seed} coverage ${f}`);
  }
});
test('smooth: neighbours 0.5 m apart differ by a bounded amount', () => {
  let max = 0;
  for (let x = -200; x < 200; x += 3.1) for (let y = -200; y < 200; y += 3.3) {
    max = Math.max(max, Math.abs(cloudAt(x + 0.5, y, 0, p) - cloudAt(x, y, 0, p)), Math.abs(cloudAt(x, y + 0.5, 0, p) - cloudAt(x, y, 0, p)));
  }
  assert.ok(max < 0.12, `max step ${max}`);
});
