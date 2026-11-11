import test from 'node:test';
import assert from 'node:assert/strict';
import { treeShadowDecal, outsideTimbers } from '../../assets/js/petanque/scenery.js';

const sun = { x: -5, y: -7, z: 6 };

test('tree shadow runs away from the sun with length height / tan(elevation)', () => {
  const d = treeShadowDecal(30, 30, 10, 2, sun, outsideTimbers);
  const hl = Math.hypot(5, 7), want = 10 / (6 / hl);
  assert.ok(Math.abs(d.len - Math.min(want, 18)) < 1e-9);
  assert.ok(Math.abs(d.angle - Math.atan2(7, 5)) < 1e-9);
  assert.ok(d.cx > 30 && d.cy > 30);
});

test('a shadow that would reach the court is shortened to stay clear of it', () => {
  const d = treeShadowDecal(-7, 3.5, 11, 2, sun, outsideTimbers, 0.8);
  for (let t = 0; t <= d.len; t += 0.25) assert.ok(outsideTimbers(-7 + Math.cos(d.angle) * t, 3.5 + Math.sin(d.angle) * t) >= 0.8 - 1e-9);
  assert.ok(d.len > 0 && d.len < 15);
});

test('a lower sun gives a longer shadow, a higher sun a shorter one', () => {
  const lo = treeShadowDecal(30, 30, 10, 2, { x: -5, y: -7, z: 3 }, outsideTimbers);
  const hi = treeShadowDecal(30, 30, 10, 2, { x: -5, y: -7, z: 12 }, outsideTimbers);
  assert.ok(lo.len > hi.len);
});
