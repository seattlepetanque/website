// F103: quality table and the Auto controller
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, LOW_LEVEL, levelSettings, initialLevel, wantAntialias, createAutoQuality, AUTO } from '../../assets/js/petanque/quality.js';

test('table: level 0 is everything on, each level removes work and never adds it back', () => {
  const h = LEVELS[0];
  assert.deepEqual([h.pixelRatioMax, h.shadows, h.tufts, h.treeShadows, h.sailboats, h.butterflies, h.cloudShadows, h.sepiaSamples, h.ambient], [2, true, true, true, true, true, true, 4, 1]);
  for (let i = 1; i < LEVELS.length; i++) {
    const a = LEVELS[i - 1], b = LEVELS[i];
    assert.ok(b.pixelRatioMax <= a.pixelRatioMax && b.shadowScale <= a.shadowScale && b.shadowHalfScale <= a.shadowHalfScale && b.sepiaSamples <= a.sepiaSamples && b.ambient <= a.ambient);
    for (const k of ['shadows', 'tufts', 'treeShadows', 'sailboats', 'butterflies', 'cloudShadows', 'divots']) assert.ok(!b[k] || a[k], k);
  }
  const low = LEVELS[LOW_LEVEL];
  assert.deepEqual([low.pixelRatioMax, low.tufts, low.treeShadows, low.sailboats, low.butterflies, low.cloudShadows, low.divots, low.sepiaSamples], [1, false, false, false, false, false, false, 0]);
  assert.equal(low.shadows, false); // no shadows at all at Low
  for (let i = 0; i < LOW_LEVEL; i++) assert.equal(LEVELS[i].shadows, true, 'shadows go only at the last level');
  assert.equal(levelSettings(-3), LEVELS[0]); assert.equal(levelSettings(99), low);
});
test('starting level: High 0, Low lowest, Auto 0 unless the device looks weak', () => {
  assert.equal(initialLevel('high', true), 0);
  assert.equal(initialLevel('low', false), LOW_LEVEL);
  assert.equal(initialLevel('auto', false), 0);
  assert.equal(initialLevel('auto', true), LOW_LEVEL);
  assert.equal(wantAntialias('high', true), true);
  assert.equal(wantAntialias('low', false), false);
  assert.equal(wantAntialias('auto', true), false);
  assert.equal(wantAntialias('auto', false), true);
});
const run = (q, ms, seconds, active = () => true) => { const got = []; for (let t = 0; t < seconds * 1000; t += ms) { const r = q.frame(ms, active(t)); if (r !== null) got.push([t, r]); } return got; };

test('fast frames never step down', () => { assert.deepEqual(run(createAutoQuality(0), 16.7, 120), []); });
test('slow frames step down one level at a time, with warm-up and hysteresis between steps', () => {
  const got = run(createAutoQuality(0), 50, 60);
  assert.deepEqual(got.map((g) => g[1]), [1, 2, 3, 4]);
  assert.ok(got[0][0] >= AUTO.warmupMs + 2 * AUTO.windowMs - 100); // first second ignored, two slow windows
  for (let i = 1; i < got.length; i++) assert.ok(got[i][0] - got[i - 1][0] >= AUTO.warmupMs + 2 * AUTO.windowMs - 100);
});
test('never goes up, and stops at Low', () => {
  const q = createAutoQuality(0);
  run(q, 50, 60); assert.equal(q.level, LOW_LEVEL);
  assert.deepEqual(run(q, 5, 60), []); assert.equal(q.level, LOW_LEVEL);
});
test('a single slow window (one hiccup) does not step; a recovery resets the count', () => {
  const q = createAutoQuality(0);
  const t = (ms, s) => run(q, ms, s);
  t(16, 1.2); // warm-up
  assert.deepEqual(t(60, 2.6), []); // one slow window
  assert.deepEqual(t(16, 2.6), []); // fine again
  assert.deepEqual(t(60, 2.6), []); // slow again: still just one in a row
  assert.equal(q.level, 0);
});
test('a single long hitch is clamped and does not step; sustained very slow frames do; paused/hidden time is ignored', () => {
  const q = createAutoQuality(0);
  run(q, 16, 1.2);
  assert.deepEqual(run(q, 16, 2.0).concat([[0, q.frame(5000, true)]]).filter((g) => g[1] !== null), []);
  assert.deepEqual(run(q, 16, 20), []);
  assert.equal(q.level, 0);
  assert.deepEqual(run(createAutoQuality(0), 400, 60).map((g) => g[1]), [1, 2, 3, 4]); // 2.5 fps
  const q2 = createAutoQuality(0);
  assert.deepEqual(run(q2, 60, 60, () => false), []);
  assert.equal(q2.level, 0);
});
test('a pause in the middle restarts the window', () => {
  const q = createAutoQuality(0);
  run(q, 60, 1.5); run(q, 60, 5, () => false);
  assert.equal(q.level, 0);
});
test('a weak device starts at Low and Auto does nothing', () => {
  const q = createAutoQuality(initialLevel('auto', true));
  assert.deepEqual(run(q, 80, 60), []); assert.equal(q.level, LOW_LEVEL);
});

test('frame pacing: 60 fps, a 30 fps cap and alternating 16/33 never step; 50 ms frames do; one 400 ms hitch does not', () => {
  assert.deepEqual(run(createAutoQuality(0), 16.7, 120), []);
  assert.deepEqual(run(createAutoQuality(0), 33.3, 120), []);
  const alt = createAutoQuality(0), got = [];
  for (let i = 0; i < 6000; i++) { const r = alt.frame(i % 2 ? 33 : 16, true); if (r !== null) got.push(r); }
  assert.deepEqual(got, []);
  assert.deepEqual(run(createAutoQuality(0), 50, 30).map((g) => g[1]).slice(0, 1), [1]);
  const h = createAutoQuality(0); run(h, 16.7, 3);
  assert.equal(h.frame(400, true), null); run(h, 16.7, 30); assert.equal(h.level, 0);
});
