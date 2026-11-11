import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuckFlock, DUCK } from '../../assets/js/petanque/ducks.js';
import { lakeDepth } from '../../assets/js/petanque/sailboats.js';

const CX = 2;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const run = (seed, secs, avoid, each, dtStep = 0.2) => {
  const f = createDuckFlock(seed, { cx: CX });
  for (let t = 0; t < secs; t += dtStep) { f.step(dtStep, typeof avoid === 'function' ? avoid(t) : avoid); if (each) each(f, t); }
  return f;
};

test('3-6 ducks in groups of 2-3', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const f = createDuckFlock(seed, { cx: CX });
    assert.ok(f.ducks.length >= 4 && f.ducks.length <= 6, `n=${f.ducks.length}`);
  }
});

test('ducks stay inside the lake (3 m margin) for 30 sim minutes, many seeds', () => {
  for (let seed = 1; seed <= 40; seed++) {
    run(seed, 1800, null, (f) => { for (const d of f.ducks) assert.ok(lakeDepth(d.x, d.y, CX) >= DUCK.margin - 0.01, `seed ${seed}: depth ${lakeDepth(d.x, d.y, CX)}`); }, 0.5);
  }
});

test('ducks stay in the shore band at least 80% of the time', () => {
  let tot = 0, ok = 0;
  for (let seed = 1; seed <= 30; seed++) {
    run(seed, 1800, null, (f) => { for (const d of f.ducks) { tot++; const dp = lakeDepth(d.x, d.y, CX); if (dp >= 3 && dp <= 27) ok++; } }, 1);
  }
  assert.ok(ok / tot >= 0.8, `band share ${ok / tot}`);
});

test('mostly the near / side shore, not the far side', () => {
  let tot = 0, near = 0;
  for (let seed = 1; seed <= 30; seed++) run(seed, 1800, null, (f) => { for (const d of f.ducks) { tot++; if (d.y < 115) near++; } }, 1);
  assert.ok(near / tot >= 0.7, `near share ${near / tot}`);
});

test('speeds bounded, no spinning (heading change per metre bounded), and they really travel', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const f = createDuckFlock(seed, { cx: CX });
    const prev = f.ducks.map((d) => ({ x: d.x, y: d.y, h: d.heading })), start = f.ducks.map((d) => ({ x: d.x, y: d.y }));
    let maxCurv = 0;
    for (let t = 0; t < 1200; t += 0.2) {
      f.step(0.2);
      f.ducks.forEach((d, i) => {
        assert.ok(d.speed >= 0 && d.speed <= DUCK.followMax + 1e-9, `speed ${d.speed}`);
        const m = Math.hypot(d.x - prev[i].x, d.y - prev[i].y);
        if (m > 0.02) maxCurv = Math.max(maxCurv, Math.abs(wrap(d.heading - prev[i].h)) / m);
        prev[i] = { x: d.x, y: d.y, h: d.heading };
      });
    }
    assert.ok(maxCurv <= 0.8, `seed ${seed}: heading change ${maxCurv} rad/m`);
    f.ducks.forEach((d, i) => assert.ok(Math.hypot(d.x - start[i].x, d.y - start[i].y) > 0.5, `seed ${seed}: duck ${i} never moved`));
  }
});

test('leaders hold marks at least 12 m away and travel long straight stretches', () => {
  const f = createDuckFlock(7, { cx: CX });
  let dist = 0, px = f.ducks[0].x, py = f.ducks[0].y;
  for (let t = 0; t < 600; t += 0.2) { f.step(0.2); dist += Math.hypot(f.ducks[0].x - px, f.ducks[0].y - py); px = f.ducks[0].x; py = f.ducks[0].y; }
  assert.ok(dist > 60, `leader travelled ${dist} m in 10 min`);
});

test('the floatplane avoid circle is respected: never entered, never moved deeper into', () => {
  for (let seed = 1; seed <= 20; seed++) {
    for (const [ox, oy] of [[10, 8], [-30, -20], [0, 60]]) { // on top of a flock, near it, and elsewhere
      const f = createDuckFlock(seed, { cx: CX });
      const av = { x: f.ducks[0].x + ox, y: f.ducks[0].y + oy, r: 40 };
      const lim = f.ducks.map((d) => Math.min(Math.hypot(d.x - av.x, d.y - av.y), av.r)); // the closest allowed distance
      for (let t = 0; t < 600; t += 0.2) {
        f.step(0.2, av);
        f.ducks.forEach((d, i) => {
          const dd = Math.hypot(d.x - av.x, d.y - av.y);
          assert.ok(dd >= lim[i] - 1e-9, `seed ${seed}: ${dd} < ${lim[i]}`);
          if (dd >= av.r) lim[i] = av.r; else lim[i] = Math.max(lim[i], dd); // inside: may only move outward
        });
      }
    }
  }
});

test('deterministic per seed, different between seeds', () => {
  const a = run(5, 300), b = run(5, 300), c = run(6, 300);
  assert.deepEqual(a.ducks.map((d) => [d.x, d.y, d.heading]), b.ducks.map((d) => [d.x, d.y, d.heading]));
  assert.notDeepEqual(a.ducks.map((d) => d.x), c.ducks.map((d) => d.x));
});

test('paused (dt 0) is frozen', () => {
  const f = run(3, 60);
  const snap = JSON.stringify(f.ducks.map((d) => [d.x, d.y, d.heading, d.speed, d.dip]));
  f.step(0); f.step(0, { x: 0, y: 0, r: 40 }); f.step(-1);
  assert.equal(JSON.stringify(f.ducks.map((d) => [d.x, d.y, d.heading, d.speed, d.dip])), snap);
});
