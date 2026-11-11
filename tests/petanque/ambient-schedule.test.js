import test from 'node:test';
import assert from 'node:assert/strict';
import { createAmbientSchedule, SCHEDULE } from '../../assets/js/petanque/ambient-schedule.js';

// Simulate `hours` of 0.4 s ticks; busyFn/loudFn(t) give the state.
function run(seed, hours, st = () => ({ slow: true })) {
  const s = createAmbientSchedule(seed), evs = [];
  for (let t = 0; t < hours * 3600; t += 0.4) { const e = s.tick(t, st(t)); if (e) evs.push(e); }
  return evs;
}
const by = (evs, k) => evs.filter((e) => e.kind === k);

test('deterministic per seed, different across seeds', () => {
  assert.deepEqual(run(7, 2), run(7, 2));
  assert.notDeepEqual(run(7, 2), run(8, 2));
});

test('min gaps between events of a kind are respected over long timelines', () => {
  for (const seed of [1, 2, 3, 99]) {
    const evs = run(seed, 10);
    for (const k of ['bell', 'cicada']) {
      const l = by(evs, k);
      assert.ok(l.length > 3, k + ' occurs');
      for (let i = 1; i < l.length; i++) {
        const gap = l[i].start - (l[i - 1].start + l[i - 1].dur);
        assert.ok(gap >= SCHEDULE[k].gap[0] - 0.5, `${k} gap ${gap}`);
      }
    }
  }
});

test('bells never overlap each other', () => {
  for (const seed of [4, 5, 6]) {
    const b = by(run(seed, 12), 'bell');
    assert.ok(b.length > 3);
    for (let i = 1; i < b.length; i++) {
      const sep = b[i].start - (b[i - 1].start + b[i - 1].dur);
      assert.ok(sep >= -0.5, `overlap ${sep}`);
    }
  }
});

test('never starts a bell during a busy moment, a loud engine, or just after one', () => {
  const busy = (t) => ({ slow: true, busy: (t % 60) < 40, loud: (t % 300) > 250 }); // busy 40 of every 60 s
  for (const seed of [1, 2, 3]) {
    const evs = by(run(seed, 10, busy), 'bell');
    assert.ok(evs.length > 5);
    for (const e of evs) {
      const b = busy(e.start);
      assert.ok(!b.busy && !b.loud);
      assert.ok(e.start % 60 >= 40 + SCHEDULE.settle - 0.4, 'settled ' + (e.start % 60));
    }
  }
});

test('a permanently busy game gets no bell, only cicadas', () => {
  const evs = run(1, 6, () => ({ slow: true, busy: true }));
  assert.equal(by(evs, 'bell').length, 0);
  assert.ok(by(evs, 'cicada').length > 0);
});

test('event contents are in range', () => {
  const evs = run(11, 20);
  for (const e of by(evs, 'bell')) { assert.ok(e.strikes >= 3 && e.strikes <= 6); assert.ok(e.spacing >= 2.3 && e.spacing <= 2.7); }
  for (const e of by(evs, 'cicada')) { assert.ok(e.dur >= 10 && e.dur <= 30); assert.ok(e.hz >= 4300 && e.hz <= 5600); }
});

test('paused time does not count and quick mode is rarer; stalled timers are clamped', () => {
  const slow = run(3, 6).length, quick = run(3, 6, () => ({ slow: false })).length;
  assert.ok(quick < slow);
  const s = createAmbientSchedule(3);
  s.tick(0, {});
  assert.equal(s.tick(100000, {}), null); // a huge jump advances the clock by maxDt only
});
