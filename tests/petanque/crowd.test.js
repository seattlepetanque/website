import { test } from 'node:test';
import assert from 'node:assert/strict';
import { steer, stepAgents, createGather, planGoals, GATHER_TIMEOUT, MIN_GAP } from '../../assets/js/petanque/crowd.js';
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

const scene = (spread) => [
  { id: 'a', x: 0, y: 0, goal: { x: -1, y: 5 }, boules: [{ id: 'a1', x: 2, y: 2 }, { id: 'a2', x: 3, y: 2.5 }, { id: 'a3', x: 2.5, y: 3 }] },
  { id: 'b', x: 4, y: 0, goal: { x: 5, y: 5 }, boules: [{ id: 'b1', x: 2.2, y: 2.2 + spread }, { id: 'b2', x: 4, y: 3 }, { id: 'b3', x: 3.5, y: 1 }] },
  { id: 'c', x: 0, y: 4, goal: { x: -1, y: 6 }, boules: [{ id: 'c1', x: 1, y: 3 }, { id: 'c2', x: 1.5, y: 4 }, { id: 'c3', x: 0.5, y: 2 }] },
];

test('open scene: everyone collects all their boules and reaches the goal before the fallback', () => {
  const g = createGather(scene(1.5));
  for (let i = 0; i < 60 * 40 && !g.finished; i++) g.step(1 / 60);
  assert.ok(g.finished);
  assert.ok(!g.fallback, 'no fallback needed');
  for (const a of g.agents) {
    assert.equal(a.held, 3);
    assert.equal(a.phase, 'done');
    assert.ok(Math.hypot(a.x - a.goal.x, a.y - a.goal.y) < 0.06);
  }
});

test('fallback fires at 20 s: boules still on the ground go into the hands and everyone reaches the goal', () => {
  const far = scene(1).map((a) => ({ ...a, boules: a.boules.map((b) => ({ ...b, x: b.x + 30, y: b.y + 30 })) })); // far too far to walk in time
  const g = createGather(far);
  for (let i = 0; i < 60 * 19.9; i++) g.step(1 / 60);
  assert.ok(!g.fallback && g.agents.every((a) => a.held < 3));
  for (let i = 0; i < 60 * 0.2; i++) g.step(1 / 60);
  assert.ok(g.fallback, 'fires at 20 s');
  assert.equal(GATHER_TIMEOUT, 20);
  assert.ok(g.agents.every((a) => a.held === 3 && a.boules.length === 0));
  for (let i = 0; i < 60 * 30 && !g.finished; i++) g.step(1 / 60);
  assert.ok(g.finished);
});

test('blocked on the way to the goal for over 2 s after the fallback: fades to the goal', () => {
  const as = [
    { id: 'a', x: 0, y: 0, goal: { x: 0, y: 3 }, boules: [{ id: 'a1', x: 30, y: 30 }] },
    { id: 'b', x: 0, y: 2.6, goal: { x: 0, y: 2.6 }, boules: [] }, // stands on a's way and never moves
  ];
  const g = createGather(as, { timeout: 1 });
  for (let i = 0; i < 60 * 12 && !g.finished; i++) g.step(1 / 60);
  assert.ok(g.finished);
  assert.ok(['done', 'faded'].includes(g.agents[0].phase));
  assert.ok(Math.hypot(g.agents[0].x, g.agents[0].y - 3) < 0.06);
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

test('F15: a crowded gathering whose boules are all out of reach ends by the fallback, nobody overlapping at the goals', () => {
  const goals = [{ x: -1, y: 5 }, { x: -1, y: 5.8 }, { x: 5, y: 5 }, { x: 5, y: 5.8 }];
  const as = goals.map((goal, i) => ({ id: 'p' + i, x: 2 + (i % 2) * 0.3, y: 3 + Math.floor(i / 2) * 0.3, goal, boules: [{ id: 'b' + i, x: 2.1, y: 3.2 }, { id: 'c' + i, x: 2.2, y: 3.1 }, { id: 'd' + i, x: 2.1, y: 3.0 }] })); // everybody starts together, wants the same boules
  const g = createGather(as);
  for (let i = 0; i < 60 * 60 && !g.finished; i++) g.step(1 / 60);
  assert.ok(g.finished, 'completes');
  assert.ok(g.agents.every((a) => a.boules.length === 0), 'no boule left on the ground');
  assert.ok(minPair(g.agents) >= 0.6, `final spacing ${minPair(g.agents).toFixed(2)} m`);
});
