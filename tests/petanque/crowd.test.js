import { test } from 'node:test';
import assert from 'node:assert/strict';
import { steer, stepAgents, planGoals, MIN_GAP } from '../../assets/js/petanque/crowd.js';
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

import { ringBlockers, ringGate, meneEndReady, RING_R, RING_WAIT_MAX, COLLECT_TIMEOUT } from '../../assets/js/petanque/crowd.js';
import { CIRCLE_R } from '../../assets/js/petanque/court.js';

test('F51: ring radius matches the court circle and the wait outlasts the collect fallback', () => {
  assert.equal(RING_R, CIRCLE_R);
  assert.ok(RING_WAIT_MAX > COLLECT_TIMEOUT);
});

test('F51/F53: ringBlockers finds boules in the ring, never people, not far things', () => {
  const spot = { x: 3, y: 10 };
  const clear = ringBlockers(spot, [{ id: 'a', x: 3.8, y: 10 }], [{ id: 'p', x: 4, y: 10 }, { id: 'h', x: 3, y: 10.1 }], 'h');
  assert.deepEqual(clear, { boules: [], people: [], clear: true });
  const bad = ringBlockers(spot, [{ id: 'in', x: 3.1, y: 10.1 }, { id: 'edge', x: 3.4, y: 10 }, { id: 'far', x: 3.9, y: 10 }], [{ id: 'p', x: 3.3, y: 10.2 }], 'h');
  assert.deepEqual(bad.boules, ['in', 'edge']);
  assert.deepEqual(bad.people, [], 'F53: the ring never waits for people');
  assert.equal(bad.clear, false);
  const onlyPeople = ringBlockers(spot, [], [{ id: 'p', x: 3, y: 10 }, { id: 'q', x: 3.05, y: 10.05 }], 'h');
  assert.equal(onlyPeople.clear, true, 'people standing on the spot do not hold the ring');
});

test('F51: ringGate waits while blocked, goes when clear, forces after the wait or a skip', () => {
  const blocked = { boules: ['x'], people: [], clear: false }, clear = { boules: [], people: [], clear: true };
  assert.equal(ringGate(clear, 0), 'go');
  assert.equal(ringGate(blocked, 0), 'wait');
  assert.equal(ringGate(blocked, RING_WAIT_MAX - 0.1), 'wait');
  assert.equal(ringGate(blocked, RING_WAIT_MAX), 'force');
  assert.equal(ringGate(blocked, 0, { skipped: true }), 'force');
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

// ---- F59: boules into hands, places, the next-mene gate ----
import { handTargets, carryAt, atPlaces, CARRY_T, CARRY_STAGGER, CARRY_LIFT, HAND_H, BOULE_R } from '../../assets/js/petanque/crowd.js';
const PEOPLE = [{ id: 'you', x: 1, y: 8, h: 1.8 }, { id: 'pierre', x: 3, y: 9 }, { id: 'marcel', x: 2, y: 11, h: 1.7 }, { id: 'odette', x: 0.5, y: 10, h: 1.6 }];

test('F59 handTargets: every boule with an owner gets that owner\'s hand (hip height at their position), staggered in order', () => {
  const bs = [];
  for (const [i, id] of PEOPLE.map((p) => p.id).entries()) for (let k = 0; k < 3; k++) bs.push({ id: `${id}${k}`, owner: id, x: 2 + i * 0.1, y: 9 + k * 0.1 });
  const out = handTargets(bs, PEOPLE);
  assert.equal(out.length, 12);
  for (const [i, h] of out.entries()) {
    const p = PEOPLE.find((q) => q.id === h.owner), b = bs[i];
    assert.deepEqual(h.from, { x: b.x, y: b.y });
    assert.ok(h.to.x === p.x && h.to.y === p.y && Math.abs(h.to.z - (p.h ?? 1.75) * HAND_H) < 1e-9);
    assert.ok(Math.abs(h.delay - i * CARRY_STAGGER) < 1e-9);
  }
  assert.equal(handTargets([{ id: 'x', owner: 'ghost', x: 0, y: 0 }, { id: 'y', x: 0, y: 0 }], PEOPLE).length, 0, 'no owner, no target');
});

test('F59 carryAt: starts on the ground at the boule, ends exactly in the hand, rises above the line in between, never below the ground', () => {
  const from = { x: 2, y: 9 }, to = { x: 1, y: 8, z: 0.9 };
  const a = carryAt(from, to, 0), z = carryAt(from, to, CARRY_T), over = carryAt(from, to, 99);
  assert.ok(Math.abs(a.x - 2) < 1e-9 && Math.abs(a.z - BOULE_R) < 1e-9 && !a.done);
  assert.ok(z.done && over.done && Math.abs(z.x - 1) < 1e-9 && Math.abs(z.y - 8) < 1e-9 && Math.abs(z.z - 0.9) < 1e-9);
  assert.ok(carryAt(from, to, -1).z === a.z, 'before the start it waits on the ground');
  let top = 0, prevD = 1e9;
  for (let t = 0; t <= CARRY_T + 1e-9; t += 0.01) {
    const p = carryAt(from, to, t), line = BOULE_R + (0.9 - BOULE_R) * (t / CARRY_T);
    top = Math.max(top, p.z - line);
    assert.ok(p.z >= BOULE_R - 1e-9);
    const d = Math.hypot(p.x - to.x, p.y - to.y); assert.ok(d <= prevD + 1e-9, 'moves steadily toward the hand'); prevD = d;
  }
  assert.ok(top > CARRY_LIFT * 0.4, 'an arc, not a straight line');
});

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
