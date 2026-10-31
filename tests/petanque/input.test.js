import test from 'node:test';
import assert from 'node:assert/strict';
import { swingToThrow, SWING } from '../../assets/js/petanque/input.js';

const H = 600;

// Synthetic stroke: backswing down, then upstroke to `rise` px above the start, optional hold.
function stroke({ back = 120, rise = 300, dur = 300, hold = 0, drift = 0, curve = 0, ease = (u) => u, backMs = 250 } = {}) {
  const x0 = 200, y0 = 500, out = [];
  let t = 0;
  for (let t0 = 0; t0 <= backMs; t0 += 10, t = t0) out.push({ t, x: x0, y: y0 + back * (t0 / backMs) });
  const yLow = y0 + back, yEnd = y0 - rise, up = yLow - yEnd;
  const tStart = t;
  for (let dt = 10; dt <= dur; dt += 10) {
    const s = ease(dt / dur), f = s;
    out.push({ t: tStart + dt, x: x0 + drift * up * f + curve * up * Math.sin(Math.PI * f), y: yLow - up * s });
  }
  const last = out[out.length - 1];
  for (let dt = 10; dt <= hold; dt += 10) out.push({ ...last, t: last.t + dt });
  return out;
}
const run = (o, yaw = 0) => swingToThrow(stroke(o), yaw, { height: H });

test('smooth follow-through gives near-zero backspin', () => {
  const r = run({ ease: (u) => u * u });
  assert.ok(r.backspin < 10, `backspin ${r.backspin}`);
});

test('sharp stop before release gives high backspin', () => {
  const r = run({ ease: (u) => 1 - (1 - u) ** 3, hold: 80 });
  assert.ok(r.backspin > 100, `backspin ${r.backspin}`);
  assert.ok(r.backspin > run({ ease: (u) => u * u }).backspin + 80);
});

test('higher release gives higher loft', () => {
  const lo = run({ rise: 80 }), mid = run({ rise: 250 }), hi = run({ rise: 400 });
  assert.ok(lo.loft < mid.loft && mid.loft < hi.loft);
  assert.ok(lo.loft < 25 * Math.PI / 180);
  assert.ok(hi.loft > 55 * Math.PI / 180);
});

test('faster stroke gives more speed', () => {
  const slow = run({ dur: 900 }), fast = run({ dur: 450 });
  assert.ok(fast.speed > slow.speed, `${fast.speed} vs ${slow.speed}`);
});

test('longer backswing raises the power ceiling', () => {
  const short = run({ back: 0, rise: 300, dur: 150 }), long = run({ back: 150, rise: 300, dur: 150 });
  assert.ok(long.speed > short.speed);
  assert.ok(short.speed <= SWING.minCeiling + 1e-9);
});

test('lateral drift sets yaw offset and sidespin sign', () => {
  const right = run({ drift: 0.15 }, 0.3), left = run({ drift: -0.15 }, 0.3), straight = run({}, 0.3);
  assert.ok(right.yaw > 0.3 && left.yaw < 0.3);
  assert.ok(Math.abs(straight.yaw - 0.3) < 1e-9);
  assert.ok(Math.abs(right.yaw - 0.3) <= SWING.maxYawOffset + 1e-9);
  assert.ok(run({ curve: 0.1 }).sidespin > 0 && run({ curve: -0.1 }).sidespin < 0);
  assert.ok(straight.quality > right.quality);
});

test('values stay finite and in range for wild strokes', () => {
  for (const back of [0, 40, 400]) for (const rise of [80, 300, 900]) for (const dur of [20, 150, 2000]) {
    for (const drift of [-3, 0, 3]) {
      const r = run({ back, rise, dur, drift, curve: drift / 3, hold: 30 });
      assert.ok(r, 'throw');
      for (const k of ['yaw', 'speed', 'loft', 'backspin', 'sidespin', 'quality']) assert.ok(Number.isFinite(r[k]), k);
      assert.ok(r.speed >= 2 && r.speed <= 12);
      assert.ok(r.loft >= SWING.loftMin - 1e-9 && r.loft <= SWING.loftMax + 1e-9);
      assert.ok(r.backspin >= 0 && r.backspin <= 150);
      assert.ok(Math.abs(r.sidespin) <= 40);
      assert.ok(r.quality >= 0 && r.quality <= 1);
    }
  }
});

test('taps, tiny and downward strokes return null', () => {
  assert.equal(swingToThrow([], 0), null);
  assert.equal(swingToThrow([{ t: 0, x: 1, y: 1 }], 0), null);
  assert.equal(swingToThrow([{ t: 0, x: 5, y: 500 }, { t: 40, x: 5, y: 500 }, { t: 80, x: 6, y: 499 }], 0, { height: H }), null);
  assert.equal(run({ rise: -50 }), null); // ends below start, only a backswing
  assert.equal(run({ back: 0, rise: 20 }), null);
});
