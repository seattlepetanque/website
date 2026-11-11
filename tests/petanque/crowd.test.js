import { test } from 'node:test';
import assert from 'node:assert/strict';
import { steer, stepAgents, planGoals, meneEndReady, MIN_GAP } from '../../assets/js/petanque/crowd.js';
import { createMatch, defaultPlayers, apply } from '../../assets/js/petanque/rules.js';
import { court, setCourt, resetCourt } from '../../assets/js/petanque/court.js';
import { waitingSlots } from '../../assets/js/petanque/waiting.js';
import { C } from '../../assets/js/petanque/constants.js';

const minPair = (as) => {
  let m = Infinity;
  for (let i = 0; i < as.length; i++) for (let j = i + 1; j < as.length; j++) m = Math.min(m, Math.hypot(as[i].x - as[j].x, as[i].y - as[j].y));
  return m;
};

test('steer: seeks the target in an empty scene and stops there', () => {
  const v = steer({ x: 0, y: 0 }, { x: 0, y: 2 }, []);
  assert.ok(v.vy > 0.99 && Math.abs(v.vx) < 1e-9 && v.scale === 1);
  assert.equal(steer({ x: 1, y: 1 }, { x: 1, y: 1 }, []).scale, 0);
});

test('steer: somebody directly ahead slows the walker, somebody close pushes sideways', () => {
  const ahead = steer({ x: 0, y: 0 }, { x: 0, y: 5 }, [{ x: 0, y: 0.9 }]);
  assert.ok(ahead.scale < 0.6, 'slows');
  const side = steer({ x: 0, y: 0 }, { x: 0, y: 5 }, [{ x: 0.3, y: 0.6 }]);
  assert.ok(side.vx < 0, 'pushed away from the one on the right');
  const far = steer({ x: 0, y: 0 }, { x: 0, y: 5 }, [{ x: 3, y: 0.4 }]);
  assert.equal(far.scale, 1);
});

test('crowded scene: four walkers crossing the same spot keep about half a metre apart', () => {
  const mk = (x, y, tx, ty) => ({ x, y, tx, ty, speed: 1.35 });
  const as = [mk(0, 0, 3, 3), mk(3, 3, 0, 0), mk(0, 3, 3, 0), mk(3, 0, 0, 3)];
  let low = Infinity;
  for (let i = 0; i < 60 * 25; i++) { stepAgents(as, 1 / 60); low = Math.min(low, minPair(as)); }
  assert.ok(low >= MIN_GAP * 0.85, `closest approach ${low.toFixed(2)} m`);
});

test('crowded scene: head-on pair passes without touching', () => {
  const as = [{ x: 0, y: 0, tx: 0, ty: 4, speed: 1.35 }, { x: 0, y: 4, tx: 0, ty: 0, speed: 1.35 }];
  let low = Infinity;
  for (let i = 0; i < 60 * 15; i++) { stepAgents(as, 1 / 60); low = Math.min(low, minPair(as)); }
  assert.ok(low >= MIN_GAP * 0.85, `closest approach ${low.toFixed(2)} m`);
});

test('F15: the next circle and waiting slots are known from the mène result, before nextMene runs', () => {
  resetCourt();
  let m = createMatch({ target: 13, players: defaultPlayers(), firstJackTeam: 0 });
  m = { ...m, phase: 'meneEnd', jack: { x: 2.3, y: 9.2 }, boules: [], result: { void: true } };
  const dims = { terrainW: C.terrainW, terrainL: C.terrainL, jackMinDist: C.jackMinDist, jackMaxDist: C.jackMaxDist };
  const plan = planGoals(apply(m, { type: 'nextMene' }), dims); // computed with the court still at the old circle
  assert.ok(Math.abs(court.circle.x - 2) < 1e-9 && court.dir === 1, 'court not yet moved');
  assert.ok(Math.hypot(plan.to.x - court.circle.x, plan.to.y - court.circle.y) > 3, 'the new circle is elsewhere');
  assert.equal(plan.slots.length, 6);
  const next = apply(m, { type: 'nextMene' });
  setCourt(next.geometry.circle, next.geometry.dir); // what nextMene does later
  const after = waitingSlots(null, { terrainW: C.terrainW, terrainL: C.terrainL, jackMinDist: C.jackMinDist, jackMaxDist: C.jackMaxDist, circle: court.circle, dir: court.dir }).filter((s) => s.zone === 'circle');
  assert.deepEqual(plan.slots, after, 'the same slots as after the court moves');
  assert.ok(plan.thrower && next.players.some((p) => p.id === plan.thrower && p.team === next.jackTeam));
  resetCourt();
});

test('F51: the next mène needs both the ring down and everybody at their place', () => {
  assert.equal(meneEndReady({ ringDown: true, collectDone: false }), false);
  assert.equal(meneEndReady({ ringDown: false, collectDone: true }), false);
  assert.equal(meneEndReady({ ringDown: true, collectDone: true }), true);
  assert.equal(meneEndReady({}), false);
});

test('F53 steer: push false (a thrower standing their ground) is not pushed sideways but still slows for somebody ahead', () => {
  const other = [{ x: 0.6, y: 0.2 }];
  assert.ok(steer({ x: 0, y: 0 }, { x: 0, y: 5 }, other).vx < 0);
  assert.equal(steer({ x: 0, y: 0 }, { x: 0, y: 5 }, other, { push: false }).vx, 0);
  assert.ok(steer({ x: 0, y: 0 }, { x: 0, y: 5 }, [{ x: 0, y: 0.9 }], { push: false }).scale < 0.6);
});

// ---- F59/F60: places, the next-mene gate ----
import { atPlaces } from '../../assets/js/petanque/crowd.js';
test('F59 atPlaces: everybody within the tolerance of their place (Map or object); players without a place count as there', () => {
  const places = new Map([['a', { x: 0, y: 0 }], ['b', { x: 3, y: 3 }]]);
  assert.equal(atPlaces(new Map([['a', { x: 0.2, y: 0 }], ['b', { x: 3, y: 3.1 }], ['c', { x: 9, y: 9 }]]), places), true);
  assert.equal(atPlaces(new Map([['a', { x: 0.2, y: 0 }], ['b', { x: 5, y: 3 }]]), places), false);
  assert.equal(atPlaces({ a: { x: 0, y: 0 } }, places), false, 'a player not found is not there');
  assert.equal(atPlaces({}, {}), true);
  assert.equal(atPlaces({ a: { x: 0, y: 0 } }, { a: { x: 0, y: 0 }, b: null }), true);
});

test('F59 the next mene starts only when the ring is down and everybody is at their place', () => {
  const places = { a: { x: 0, y: 0 }, b: { x: 3, y: 3 } };
  const there = { a: { x: 0, y: 0 }, b: { x: 3, y: 3 } }, notYet = { a: { x: 0, y: 0 }, b: { x: 1, y: 1 } };
  const ready = (ringDown, pos) => meneEndReady({ ringDown, collectDone: atPlaces(pos, places) });
  assert.equal(ready(true, there), true);
  assert.equal(ready(false, there), false);
  assert.equal(ready(true, notYet), false);
  assert.equal(ready(false, notYet), false);
});
