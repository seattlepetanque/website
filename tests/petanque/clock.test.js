import test from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../../assets/js/petanque/clock.js';

test('timers fire after their delay of unpaused time', () => {
  const c = createClock(); let n = 0;
  c.later(() => n++, 100);
  c.tick(60); assert.equal(n, 0);
  c.tick(60); assert.equal(n, 1);
});

test('nothing fires or advances while paused; the remaining delay runs after resume', () => {
  const c = createClock(); let n = 0;
  c.later(() => n++, 100);
  c.tick(70);
  c.pause();
  c.tick(10000);
  assert.equal(n, 0); assert.equal(c.now(), 70);
  c.resume();
  c.tick(20); assert.equal(n, 0); // 30 ms still to go
  c.tick(10); assert.equal(n, 1);
});

test('sleep resolves only after resume plus remaining delay', async () => {
  const c = createClock(); let done = false;
  c.sleep(50).then(() => { done = true; });
  c.tick(20); c.pause(); c.tick(1000);
  await Promise.resolve(); assert.equal(done, false);
  c.resume(); c.tick(30);
  await Promise.resolve(); assert.equal(done, true);
});

test('cancel and cancelAll drop timers', () => {
  const c = createClock(); let n = 0;
  const cancel = c.later(() => n++, 10);
  c.later(() => n++, 10);
  cancel();
  c.tick(10); assert.equal(n, 1);
  c.later(() => n++, 10); c.cancelAll();
  c.tick(100); assert.equal(n, 1);
});

test('resumed() waits while paused', async () => {
  const c = createClock(); c.pause(); let ok = false;
  c.resumed().then(() => { ok = true; });
  await Promise.resolve(); assert.equal(ok, false);
  c.resume(); await Promise.resolve(); assert.equal(ok, true);
});

test('zero-delay timers run without ticks, but not while paused', async () => {
  const c = createClock(); let n = 0;
  c.later(() => n++, 0);
  await new Promise((r) => setTimeout(r, 5)); assert.equal(n, 1);
  c.pause(); c.later(() => n++, 0);
  await new Promise((r) => setTimeout(r, 5)); assert.equal(n, 1);
  c.resume(); await new Promise((r) => setTimeout(r, 5)); assert.equal(n, 2);
});
