// F81: butterflies are rare visits (pure scheduling and path logic)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisitScheduler, butterflyPath, visitDuration, BF } from '../../assets/js/petanque/butterflies.js';
import { C } from '../../assets/js/petanque/constants.js';

const rectDist = (x, y) => Math.hypot(Math.max(-x, 0, x - C.terrainW), Math.max(-y, 0, y - C.terrainL));
const timeline = (seed, secs, busyAt = () => false, opts) => {
  const s = createVisitScheduler(seed, opts), visits = [];
  for (let t = 0; t < secs; t += 0.5) for (const e of s.step(0.5, { busy: busyAt(t) })) visits.push(e);
  return visits;
};

test('first visit 60-150 s, then gaps of 3-6 minutes', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const v = timeline(seed, 4 * 3600);
    assert.ok(v.length > 20);
    assert.ok(v[0].t >= 60 && v[0].t <= 150.6, `first ${v[0].t}`);
    for (let i = 1; i < v.length; i++) {
      const g = v[i].t - v[i - 1].t;
      assert.ok(g >= 180 && g <= 360.6, `gap ${g}`);
    }
  }
});

test('never starts while busy; waits for a quiet moment', () => {
  const busyAt = (t) => t % 40 < 30; // busy most of the time
  const s = createVisitScheduler(4), starts = [];
  for (let t = 0; t < 3000; t += 0.5) { const b = busyAt(t); for (const e of s.step(0.5, { busy: b })) starts.push([e, b]); }
  assert.ok(starts.length > 3);
  for (const [, b] of starts) assert.equal(b, false);
  const allBusy = timeline(4, 3000, () => true);
  assert.equal(allBusy.length, 0);
});

test('paused (dt 0) is frozen and reduced-motion callers simply never step', () => {
  const s = createVisitScheduler(2);
  for (let i = 0; i < 1000; i++) assert.deepEqual(s.step(0, { busy: false }), []);
  assert.equal(s.time, 0);
});

test('2-4 butterflies per visit, distinct params, deterministic per seed', () => {
  const a = timeline(9, 7200), b = timeline(9, 7200), c = timeline(10, 7200);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  for (const v of a) { assert.ok(v.butterflies.length >= 2 && v.butterflies.length <= 4); }
});

test('spots: on the grass margin 4-14 m from the court, outside the keep-out, mostly in the shoulder view', () => {
  let n = 0, seen = 0;
  for (let seed = 1; seed <= 20; seed++) for (const v of timeline(seed, 3600)) for (const p of v.butterflies) {
    n++;
    const d = rectDist(p.x, p.y);
    assert.ok(d >= BF.edgeMin - 1e-9 && d <= BF.edgeMax + 1e-9, `edge distance ${d}`);
    for (const k of BF.keepOut) assert.ok(Math.hypot(p.x - k.x, p.y - k.y) >= k.r);
    assert.ok(p.z0 >= 0.1 && p.z0 <= 0.3);
    if (p.y - C.circle.y > 3 && Math.abs(p.x - C.circle.x) <= 0.62 * (p.y - C.circle.y)) seen++;
  }
  assert.ok(seen / n > 0.7, `seen ${seen}/${n}`);
});

test('opacity envelope 0 -> 1 -> 0: up then down, in [0,1]; fade-in 1.5 s; fade-out 3 s; bounded duration', () => {
  for (let seed = 1; seed <= 15; seed++) for (const v of timeline(seed, 3600)) for (const p of v.butterflies) {
    const D = visitDuration(p);
    assert.ok(p.rise >= 14 && p.rise <= 20);
    assert.ok(D <= 20 + 3 + BF.maxDelay + 1e-9 && D >= 17);
    let peaked = false, prev = 0, max = 0;
    for (let t = -1; t <= D + 1; t += 0.05) {
      const o = butterflyPath(p, t).opacity;
      assert.ok(o >= 0 && o <= 1);
      if (!peaked) { if (o < prev - 1e-9) peaked = true; } else assert.ok(o <= prev + 1e-9, 'monotone down after the peak');
      prev = o; max = Math.max(max, o);
    }
    assert.equal(max, 1);
    assert.equal(butterflyPath(p, p.delay).opacity, 0);
    assert.equal(butterflyPath(p, D).opacity, 0);
    assert.ok(butterflyPath(p, p.delay + 1.5).opacity > 0.999);
    assert.ok(butterflyPath(p, p.delay + 0.75).opacity > 0 && butterflyPath(p, p.delay + 0.75).opacity < 1);
    assert.ok(butterflyPath(p, D - 1.5).opacity < 1 && butterflyPath(p, D - 3).opacity > 0.999);
  }
});

test('path: starts 0.1-0.3 m up, climbs to 15-30 m by the end, moves away from the court, never into the keep-out', () => {
  for (let seed = 1; seed <= 15; seed++) for (const v of timeline(seed, 3600)) for (const p of v.butterflies) {
    const D = visitDuration(p);
    const s0 = butterflyPath(p, p.delay);
    assert.ok(Math.abs(s0.pos.x - p.x) < 1e-6 && Math.abs(s0.pos.y - p.y) < 1e-6);
    assert.ok(s0.pos.z >= 0.09 && s0.pos.z <= 0.31);
    const end = butterflyPath(p, D);
    assert.ok(end.pos.z >= 15 - 1e-6 && end.pos.z <= 30 + 1e-6, `alt ${end.pos.z}`);
    assert.ok(butterflyPath(p, D - 3).pos.z > 0.6 * end.pos.z, 'near the top at the start of the fade-out');
    let top = end.pos.z;
    for (let t = p.delay; t <= D; t += 0.1) {
      const o = butterflyPath(p, t); top = Math.max(top, o.pos.z);
      assert.ok(o.pos.z >= 0.05 && Number.isFinite(o.pos.x) && Number.isFinite(o.flap));
      for (const k of BF.keepOut) assert.ok(Math.hypot(o.pos.x - k.x, o.pos.y - k.y) >= k.r, 'outside the throwing circle');
    }
    assert.ok(top >= 15 && top <= 30.5);
    assert.ok(rectDist(end.pos.x, end.pos.y) > rectDist(p.x, p.y), 'drifts away from the court');
  }
});

test('flutter decays: early path is more erratic than the late glide', () => {
  const p = timeline(3, 3600)[0].butterflies[0];
  const turn = (a, b) => { let sum = 0, last = butterflyPath(p, a).heading; for (let t = a + 0.05; t < b; t += 0.05) { const h = butterflyPath(p, t).heading; sum += Math.abs(h - last); last = h; } return sum; };
  assert.ok(turn(p.delay, p.delay + 5) > 3 * turn(p.delay + p.rise - 5, p.delay + p.rise));
});

test('debug scheduler: a visit at the start and every 20 s', () => {
  const v = timeline(1, 100, () => false, { debug: true });
  assert.ok(v[0].t <= 1);
  assert.equal(v.length, 5);
  assert.ok(Math.abs(v[1].t - v[0].t - 20) < 0.6);
});
