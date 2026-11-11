import test from 'node:test';
import assert from 'node:assert/strict';
import { createAmbientSchedule, SCHEDULE, PHRASES, PHRASE_PASSES, phraseBars, phraseDuration, accordionEnvelope } from '../../assets/js/petanque/ambient-schedule.js';

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
    for (const k of ['accordion', 'bell', 'cicada']) {
      const l = by(evs, k);
      assert.ok(l.length > 3, k + ' occurs');
      for (let i = 1; i < l.length; i++) {
        const gap = l[i].start - (l[i - 1].start + l[i - 1].dur);
        assert.ok(gap >= SCHEDULE[k].gap[0] - 0.5, `${k} gap ${gap}`);
      }
    }
    // accordion every 4-8 min of play (start to start, end-to-start gap above plus phrase length)
    const a = by(evs, 'accordion');
    for (let i = 1; i < a.length; i++) assert.ok(a[i].start - a[i - 1].start >= 240);
  }
});

test('accordion and bell never overlap and keep their separation', () => {
  for (const seed of [4, 5, 6]) {
    const t = run(seed, 12).filter((e) => e.kind !== 'cicada');
    for (let i = 1; i < t.length; i++) {
      const sep = t[i].start - (t[i - 1].start + t[i - 1].dur);
      assert.ok(sep >= (t[i].kind === t[i - 1].kind ? 0 : SCHEDULE.tonalSeparation) - 0.5, `sep ${sep}`);
    }
  }
});

test('never starts an accordion/bell during a busy moment, a loud engine, or just after one', () => {
  const busy = (t) => ({ slow: true, busy: (t % 60) < 40, loud: (t % 300) > 250 }); // busy 40 of every 60 s
  for (const seed of [1, 2, 3]) {
    const evs = run(seed, 10, busy).filter((e) => e.kind !== 'cicada');
    assert.ok(evs.length > 5);
    for (const e of evs) {
      const b = busy(e.start);
      assert.ok(!b.busy && !b.loud);
      assert.ok(e.start % 60 >= 40 + SCHEDULE.settle - 0.4, 'settled ' + (e.start % 60));
    }
  }
});

test('a permanently busy game gets no accordion or bell, only cicadas', () => {
  const evs = run(1, 6, () => ({ slow: true, busy: true }));
  assert.equal(evs.filter((e) => e.kind !== 'cicada').length, 0);
  assert.ok(by(evs, 'cicada').length > 0);
});

test('event contents are in range', () => {
  const evs = run(11, 20);
  for (const e of by(evs, 'accordion')) { assert.ok(e.variant >= 0 && e.variant < PHRASES.length); assert.ok(e.dur >= 20 && e.dur <= 29); } // ~14-21 s phrase + 7 s fade-out
  for (const e of by(evs, 'bell')) { assert.ok(e.strikes >= 3 && e.strikes <= 6); assert.ok(e.spacing >= 2.3 && e.spacing <= 2.7); }
  for (const e of by(evs, 'cicada')) { assert.ok(e.dur >= 10 && e.dur <= 30); assert.ok(e.hz >= 4300 && e.hz <= 5600); }
});

test('phrases are well formed: 3 beats per bar, played twice, 13-22 s', () => {
  PHRASES.forEach((p, i) => {
    for (const [, mel] of p.bars) assert.equal(mel.reduce((a, [, b]) => a + b, 0), 3);
    assert.equal(phraseBars(i).length, PHRASE_PASSES * p.bars.length);
    const d = phraseDuration(i); assert.ok(d >= 13 && d <= 22, p.name + ' ' + d);
  });
});

const ENV = { duration: 20, fadeIn: 6, fadeOut: 7, swellPeriod: 6, swellDepth: 0.45 };
const samples = (env, n = 4000) => Array.from({ length: n }, (_, i) => accordionEnvelope(i * env.duration / n, env)); // [0, duration)

test('accordion envelope starts at 0, never exceeds 1, ends at 0', () => {
  const v = samples(ENV);
  assert.equal(accordionEnvelope(0, ENV), 0);
  assert.equal(accordionEnvelope(ENV.duration, ENV), 0);
  assert.equal(accordionEnvelope(-1, ENV), 0);
  for (const x of v) { assert.ok(x >= 0 && x <= 1, 'bounded ' + x); }
  assert.ok(Math.max(...v) > 0.5);
});

test('accordion fade in rises monotonically over fadeIn, and fade out falls monotonically to 0', () => {
  const flat = { ...ENV, swellDepth: 0 }; // no swell: the pure ramps
  const rise = Array.from({ length: 601 }, (_, i) => accordionEnvelope(i * ENV.fadeIn / 600, flat));
  for (let i = 1; i < rise.length; i++) assert.ok(rise[i] >= rise[i - 1] - 1e-12, 'rise at ' + i);
  assert.ok(Math.abs(rise[rise.length - 1] - 1) < 1e-9);
  const fall = Array.from({ length: 601 }, (_, i) => accordionEnvelope(ENV.duration - ENV.fadeOut + i * ENV.fadeOut / 600, flat));
  for (let i = 1; i < fall.length; i++) assert.ok(fall[i] <= fall[i - 1] + 1e-12, 'fall at ' + i);
  assert.ok(fall[fall.length - 1] < 1e-9);
});

test('accordion swell stays between the depth floor and 1, and actually breathes', () => {
  const env = { duration: 60, fadeIn: 0, fadeOut: 0, swellPeriod: 6, swellDepth: 0.45 };
  const v = samples(env, 6000);
  assert.ok(Math.min(...v) >= 0.55 - 1e-9, 'floor ' + Math.min(...v));
  assert.ok(Math.max(...v) <= 1 + 1e-12, 'ceiling ' + Math.max(...v));
  assert.ok(Math.min(...v) <= 0.56 && Math.max(...v) >= 0.999, 'reaches both ends of the swell');
});

test('paused time does not count and quick mode is rarer; stalled timers are clamped', () => {
  const slow = run(3, 6).length, quick = run(3, 6, () => ({ slow: false })).length;
  assert.ok(quick < slow);
  const s = createAmbientSchedule(3);
  s.tick(0, {});
  assert.equal(s.tick(100000, {}), null); // a huge jump advances the clock by maxDt only
});
