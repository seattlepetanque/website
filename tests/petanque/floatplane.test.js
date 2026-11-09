import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANE, pathSamples, startOf, envAt, fadeOpacity, engineLevel, planeDuration } from '../../assets/js/petanque/floatplane.js';
import { AMBIENT, engineGain } from '../../assets/js/petanque/ambient.js';

// F46 lake: centre (0, 98) relative to the court centre line, semi-axes 65 x 55 m; keep the water tracks inside 0.97 of it.
const inLake = (x, y) => (x / 65) ** 2 + ((y - 98) / 55) ** 2 <= 0.97 ** 2;

test('takeoff: opaque on the far side of the lake, runs toward the court, lifts off on the water, veers away', () => {
  const p = pathSamples('takeoff', 0.25), s0 = startOf('takeoff');
  assert.ok(s0.y > 125 && inLake(s0.x, s0.y), 'starts at the far side, on the lake');
  assert.equal(fadeOpacity('takeoff', 0), 1);
  const lift = p.find((r) => r[3] > 0.35), L = PLANE.takeoff.liftT;
  assert.ok(Math.abs(lift[0] - L) < 2, `liftoff near liftT (${lift[0]})`);
  for (const [t, x, y, alt] of p) {
    if (alt < 0.5) assert.ok(inLake(x, y), `takeoff on water at t=${t}: ${x.toFixed(1)},${y.toFixed(1)}`);
    if (t <= lift[0]) assert.equal(fadeOpacity('takeoff', t), 1, 'fully opaque until lift-off');
    if (t >= lift[0]) assert.ok(y > 38, 'never nearer than the lake shore after lift-off (stays off the court)');
  }
  const run = p.filter((r) => r[0] <= lift[0]);
  assert.ok(run[run.length - 1][2] < s0.y - 40, 'the run comes toward the court');
  const end = p[p.length - 1];
  assert.ok(Math.hypot(end[1], end[2] - 98) > 250 && end[3] > 50, 'flies away into the distance');
  assert.ok(PLANE.takeoff.fade[1] > L + 5, 'fade-out begins only well after lift-off');
});

test('landing taxi, turn away and exit stay on the lake and head away from the court', () => {
  const p = pathSamples('landing', 0.5);
  for (const [t, x, y, alt] of p) if (alt < 0.5) assert.ok(inLake(x, y), `landing on water at t=${t}: ${x.toFixed(1)},${y.toFixed(1)}`);
  const end = p[p.length - 1], mid = p.find((r) => r[0] >= 20);
  assert.ok(end[2] > mid[2] + 10, 'moving away (down-court) after the turn');
});

test('fades: in from nothing, full in the middle, gone at the end', () => {
  for (const k of ['takeoff', 'landing']) {
    const d = planeDuration(k);
    assert.equal(fadeOpacity(k, 0), k === 'takeoff' ? 1 : 0);
    assert.equal(fadeOpacity(k, PLANE[k].fade[0]), 1);
    assert.equal(fadeOpacity(k, (PLANE[k].fade[0] + PLANE[k].fade[1]) / 2), 1);
    assert.ok(Math.abs(fadeOpacity(k, d)) < 1e-9);
    let prev = 1;
    for (let t = PLANE[k].fade[1]; t <= d; t += 0.5) { const o = fadeOpacity(k, t); assert.ok(o <= prev + 1e-9); prev = o; }
  }
});

test('engine envelope: silent at both ends, loud window short, smooth', () => {
  for (const k of ['takeoff', 'landing']) {
    const d = planeDuration(k);
    assert.ok(envAt(PLANE[k].env, 0) <= 0.15);
    assert.equal(envAt(PLANE[k].env, d), 0);
    let loud = 0, prev = envAt(PLANE[k].env, 0), maxStep = 0;
    for (let t = 0; t <= d; t += 0.1) {
      const e = envAt(PLANE[k].env, t);
      if (e >= 0.5) loud += 0.1;
      maxStep = Math.max(maxStep, Math.abs(e - prev)); prev = e;
    }
    assert.ok(loud <= 20, `${k} loud for ${loud.toFixed(1)} s`);
    assert.ok(maxStep < 0.05, 'no jumps');
  }
});

test('engine level falls off with distance and is silent far away', () => {
  const t = 20;
  assert.ok(engineLevel('takeoff', t, 60) > engineLevel('takeoff', t, 120));
  assert.ok(engineLevel('takeoff', t, 120) > engineLevel('takeoff', t, 180));
  assert.equal(engineLevel('takeoff', t, 220), 0);
  assert.ok(engineLevel('takeoff', t, 100) < 0.4);
});

test('engineGain scales with level and revs, clamped', () => {
  assert.equal(engineGain(0, 1, AMBIENT.engine), 0);
  assert.ok(engineGain(1, 1, AMBIENT.engine) > engineGain(1, 0, AMBIENT.engine));
  assert.ok(engineGain(5, 5, AMBIENT.engine) <= AMBIENT.engine.gain + 1e-9);
});
