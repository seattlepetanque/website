import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisibility, isPageHidden } from '../../assets/js/petanque/visibility.js';

test('visible frames pass through, clamped', () => {
  const v = createVisibility(0);
  assert.equal(v.dt(16), 16);
  assert.equal(v.dt(40), 24);
  assert.equal(v.dt(540), 100);
  assert.equal(v.rawMs, 500);
});
test('hidden time is never simulated', () => {
  const v = createVisibility(0);
  v.dt(16);
  v.set(true, 20);
  assert.equal(v.dt(1000), 0);
  assert.equal(v.dt(30020), 0);
  v.set(false, 30020);
  assert.equal(v.dt(30036), 16);
  assert.equal(v.rawMs, 16);
});
test('a frame timestamp earlier than the event never goes negative', () => {
  const v = createVisibility(0);
  v.set(true, 100); v.set(false, 30100);
  assert.equal(v.dt(30090), 0);
  assert.equal(v.dt(30106), 6);
});
test('repeated events are harmless', () => {
  const v = createVisibility(0);
  v.set(true, 10); v.set(true, 5000); v.set(false, 6000); v.set(false, 9000);
  assert.equal(v.dt(6016), 16);
  assert.equal(v.hidden, false);
});
test('isPageHidden', () => {
  assert.equal(isPageHidden({ hidden: true }), true);
  assert.equal(isPageHidden({ visibilityState: 'hidden' }), true);
  assert.equal(isPageHidden({ hidden: false, visibilityState: 'visible' }), false);
  assert.equal(isPageHidden(null), false);
});
