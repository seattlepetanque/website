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

// ---- F28: collection zones, kicks, and the crowded-head simulation ----
import {
  assignZones, zoneCandidates, zoneSpots, kickStand, kickOk, kickMove, isCrowded, collectOrder, kickList, createCollect,
  ZONE_R, ZONE_GAP, KICK_TIMEOUT, KICK_ANIM, KICK_CONTACT_T, KICK_MIN, KICK_MAX,
} from '../../assets/js/petanque/crowd.js';
import { KICK_TIME, KICK_CONTACT } from '../../assets/js/petanque/character.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';

const DIMS = { terrainW: 4, terrainL: 15 };
const IDS = ['you', 'pierre', 'marcel', 'odette'];
const flat = { sample: () => ({ h: 0.01 }), stonesNear: () => [] };
function layout(seed, { tight = false, headAt = null } = {}) {
  const r = mulberry32(seed), head = headAt || { x: 1.2 + r() * 1.6, y: 5 + r() * 6 };
  const boules = [];
  for (let i = 0; i < 12; i++) { const a = r() * 6.283, d = Math.sqrt(r()) * (tight ? 1 : 2); boules.push({ id: 'b' + i, owner: IDS[i % 4], x: head.x + Math.sin(a) * d, y: head.y + Math.cos(a) * d }); }
  const pl = IDS.map((id, i) => { const a = r() * 6.283, d = 0.8 + r() * 1.2; return { id, team: i % 2, x: head.x + Math.sin(a) * d, y: head.y + Math.cos(a) * d, goal: { x: i < 2 ? -1 : 5, y: 12 + (i % 2) } }; });
  return { head, boules, pl, plan: { to: { x: head.x, y: head.y }, dir: -1, thrower: 'marcel' } };
}
const zonesOk = (z) => {
  const list = Object.values(z).filter(Boolean);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (list[i].shared || list[j].shared) continue;
    if (Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y) < 2 * ZONE_R + ZONE_GAP - 1e-9) return false;
  }
  return true;
};

test('F28 constants match the character animation', () => {
  assert.equal(KICK_ANIM, KICK_TIME);
  assert.ok(Math.abs(KICK_CONTACT_T - KICK_CONTACT) < 1e-9);
});

test('F28 assignZones: no overlaps, inside the lines, clear of the circle and the lane, for heads everywhere and every role seat', () => {
  const heads = [[2, 7.5], [0.4, 7.5], [3.6, 7.5], [2, 0.8], [2, 14.2], [0.3, 0.3], [3.7, 14.6], [2, 12], [2, 3]];
  for (const [hx, hy] of heads) for (const holder of [null, 'you', 'pierre', 'odette']) for (const thrower of IDS) {
    const L = layout(7, { headAt: { x: hx, y: hy } }), plan = { ...L.plan, thrower };
    const z = assignZones(L.pl, L.boules, L.head, plan, { dims: DIMS, holder });
    assert.equal(Object.keys(z).length, 4);
    assert.ok(zonesOk(z), `overlap at head ${hx},${hy}`);
    for (const id of IDS) {
      const c = z[id];
      if (!c) continue;
      assert.ok(c.x >= ZONE_R - 1e-9 && c.x <= DIMS.terrainW - ZONE_R + 1e-9 && c.y >= ZONE_R - 1e-9 && c.y <= DIMS.terrainL - ZONE_R + 1e-9, 'inside the strings');
      assert.ok(Math.hypot(c.x - plan.to.x, c.y - plan.to.y) >= 1.5, 'clear of the circle');
      const al = (c.y - plan.to.y) * plan.dir;
      assert.ok(!(al > -0.3 && al < 11 && Math.abs(c.x - plan.to.x) < 0.7), 'clear of the lane');
    }
  }
});

test('F28 assignZones: 100 seeded heads never throw, always give four entries, and never overlap', () => {
  for (let s = 1; s <= 100; s++) {
    const L = layout(s, { tight: s % 2 === 0 });
    const z = assignZones(L.pl, L.boules, L.head, L.plan, { dims: DIMS, holder: s % 3 === 0 ? 'odette' : null, obstacles: [{ x: L.head.x + 1, y: L.head.y, r: 1.2 }] });
    assert.deepEqual(Object.keys(z).sort(), [...IDS].sort());
    assert.ok(zonesOk(z), 'overlap at seed ' + s);
  }
});

test('F28 assignZones: deterministic, and each team keeps to the side its players stand on (the cheapest pairing)', () => {
  const L = layout(11);
  const a = assignZones(L.pl, L.boules, L.head, L.plan, { dims: DIMS }), b = assignZones([...L.pl].reverse(), L.boules, L.head, L.plan, { dims: DIMS });
  assert.deepEqual(a, b);
  // a hand-made case: two players stand left, two right of a head in the middle; their zones must not be swapped across
  const head = { x: 2, y: 7.5 }, plan = { to: { x: 2, y: 7.5 }, dir: 1, thrower: 'none' };
  const pl = [{ id: 'a', team: 0, x: -1, y: 5 }, { id: 'b', team: 0, x: -1, y: 10 }, { id: 'c', team: 1, x: 5, y: 5 }, { id: 'd', team: 1, x: 5, y: 10 }];
  const z = assignZones(pl, [], head, { ...plan }, { dims: DIMS });
  assert.ok(zonesOk(z));
  const walk = (p) => Math.hypot(z[p.id].x - p.x, z[p.id].y - p.y);
  const total = pl.reduce((s, p) => s + walk(p), 0);
  // swapping a and c's zones is never cheaper
  const swapped = Math.hypot(z.c.x - pl[0].x, z.c.y - pl[0].y) + Math.hypot(z.a.x - pl[2].x, z.a.y - pl[2].y) + walk(pl[1]) + walk(pl[3]);
  assert.ok(total <= swapped + 1e-9, 'no cheaper swap');
});

test('F28 assignZones: a head jammed against a side line and an end line still gets zones; a tiny court shares or has none', () => {
  const L = layout(3, { headAt: { x: 0.5, y: 14.3 } });
  const z = assignZones(L.pl, L.boules, L.head, L.plan, { dims: DIMS });
  assert.ok(Object.values(z).every((c) => c && Number.isFinite(c.x)));
  assert.ok(zonesOk(z));
  const tiny = assignZones(L.pl, [], { x: 1, y: 1 }, null, { dims: { terrainW: 2, terrainL: 2.2 } });
  const given = Object.values(tiny).filter(Boolean);
  assert.ok(given.length === 0 || given.some((c) => c.shared) || zonesOk(tiny));
  const none = assignZones(L.pl, [], { x: 1, y: 1 }, null, { dims: { terrainW: 1, terrainL: 1 } });
  assert.ok(Object.values(none).every((c) => c === null));
  assert.deepEqual(zoneCandidates({ x: 1, y: 1 }, { dims: { terrainW: 1, terrainL: 1 } }), []);
});

test('F28 kickOk: rejects a person on the line or near the target, a boule on the line, too short, too long, toward somebody; accepts a clear line', () => {
  const from = { x: 2, y: 5 }, to = { x: 2, y: 7 }, b = { id: 'k', x: 2, y: 5 };
  assert.equal(kickOk(b, from, to, [], []), true);
  assert.equal(kickOk(b, from, to, [{ x: 2.2, y: 6, self: false }], []), false, 'person on the line');
  assert.equal(kickOk(b, from, to, [{ x: 2.2, y: 6, self: true }], []), true, 'the kicker is excepted');
  assert.equal(kickOk(b, from, to, [{ x: 2.7, y: 7.3 }], []), false, 'person near the target');
  assert.equal(kickOk(b, from, to, [{ x: 4, y: 7.4, gx: 2.2, gy: 7 }], []), false, 'goal near the target');
  assert.equal(kickOk(b, from, to, [{ x: 4, y: 5 }], [{ id: 'o', x: 2.1, y: 6 }]), false, 'boule on the line');
  assert.equal(kickOk(b, from, to, [], [{ id: 'o', x: 3.5, y: 6 }]), true, 'boule well to the side');
  assert.equal(kickOk(b, from, { x: 2, y: 5.3 }, [], []), false, 'too short');
  assert.equal(kickOk(b, from, { x: 2, y: 5 + KICK_MAX + 0.1 }, [], []), false, 'too long');
  assert.equal(kickOk(b, from, to, [{ x: 2.6, y: 8.5 }], []), false, 'toward a person within 25 degrees');
  assert.equal(kickOk(b, from, { x: 5, y: 5 }, [{ x: 4, y: 7 }], []), true, 'a person at the side, not in the way');
  assert.equal(kickOk(b, from, { x: 2, y: 5 + KICK_MIN + 0.01 }, [], []), true);
});

test('F28 isCrowded: only when somebody is close or another player\'s boule lies against it', () => {
  const b = { id: 'b', owner: 'you', x: 2, y: 8 };
  assert.equal(isCrowded(b, { x: 0, y: 8 }, [], [b]), false);
  assert.equal(isCrowded(b, { x: 0, y: 8 }, [{ x: 3, y: 8.4 }], [b]), true);
  assert.equal(isCrowded(b, { x: 0, y: 8 }, [{ x: 2, y: 11 }], [b]), false);
  assert.equal(isCrowded(b, { x: 0, y: 8 }, [{ x: 1, y: 8.5 }], [b]), true, 'near the approach');
  assert.equal(isCrowded(b, { x: 0, y: 8 }, [], [b, { id: 'c', owner: 'marcel', x: 2.5, y: 8 }]), true);
  assert.equal(isCrowded(b, { x: 0, y: 8 }, [], [b, { id: 'c', owner: 'you', x: 2.3, y: 8 }]), false, 'my own boules do not crowd me');
});

test('F28 kickStand and zoneSpots: the kicker stands behind the boule on the line; three boules rest about 0.25 m apart', () => {
  const s = kickStand({ x: 2, y: 5 }, { x: 2, y: 7 });
  assert.ok(Math.abs(s.x - 2) < 1e-9 && Math.abs(s.y - 4.62) < 1e-9 && Math.abs(s.yaw) < 1e-9);
  const z = { x: 1, y: 1 }, sp = zoneSpots(z, 3);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(sp[i].x - sp[j].x, sp[i].y - sp[j].y) > 0.2);
  assert.ok(sp.every((p) => Math.hypot(p.x - z.x, p.y - z.y) < 0.2));
  assert.deepEqual(zoneSpots(z, 1), [z]);
});

test('F28 kickMove: ends exactly at the target, distance monotonic, speed never negative, follows the terrain, a stone pulls the end back inside the zone', () => {
  const hill = { sample: (x, y) => ({ h: 0.02 * x + 0.01 * y }), stonesNear: () => [] };
  const from = { x: 1, y: 2 }, to = { x: 2.5, y: 4 };
  const m = kickMove(from, to, hill);
  assert.deepEqual(m.end, to);
  const e = m.at(m.T + 1);
  assert.ok(e.x === to.x && e.y === to.y && Math.abs(e.z - (hill.sample(to.x, to.y).h + 0.0375)) < 1e-12 && e.v === 0);
  let prev = -1;
  for (let t = 0; t <= m.T; t += m.T / 200) {
    const p = m.at(t);
    assert.ok(p.s >= prev - 1e-12 && p.v >= 0);
    prev = p.s;
    assert.ok(p.z >= hill.sample(p.x, p.y).h + 0.0375 - 1e-12 && p.z <= hill.sample(p.x, p.y).h + 0.0375 + 0.0101, 'on the ground (the hop is 1 cm)');
  }
  assert.ok(Math.abs(m.T - 2 * m.d / (1.6 + 0.9 * m.d)) < 1e-12);
  assert.deepEqual(m.at(0), { x: 1, y: 2, z: hill.sample(1, 2).h + 0.0375, s: 0, v: 1.6 + 0.9 * m.d });
  // a stone on the line near the zone's near edge: the end is pulled back but stays in the zone; a stone far from the zone is ignored
  const zone = { x: to.x, y: to.y, r: ZONE_R };
  const stone = (sx, sy) => ({ sample: () => ({ h: 0 }), stonesNear: (x, y, r) => (Math.hypot(x - sx, y - sy) < r + 0.03 ? [{ x: sx, y: sy, r: 0.03 }] : []) });
  const dirx = (to.x - from.x) / m.d, diry = (to.y - from.y) / m.d;
  const near = kickMove(from, to, stone(to.x - dirx * 0.3, to.y - diry * 0.3), { zone });
  assert.ok(near.pulled && Math.hypot(near.end.x - zone.x, near.end.y - zone.y) <= ZONE_R && near.d < m.d);
  const far = kickMove(from, to, stone(from.x + dirx * 0.6, from.y + diry * 0.6), { zone });
  assert.ok(!far.pulled && far.end.x === to.x);
});

test('F28 kicked boules end within their zones: 200 random kicks', () => {
  const r = mulberry32(5);
  for (let i = 0; i < 200; i++) {
    const L = layout(100 + i), z = assignZones(L.pl, L.boules, L.head, L.plan, { dims: DIMS });
    const id = IDS[i % 4], zone = z[id];
    if (!zone) continue;
    for (const k of kickList(L.boules.filter((b) => b.owner === id), zone)) {
      const mv = kickMove(k.boule, k.target, flat, { zone: { ...zone, r: ZONE_R } });
      assert.ok(Math.hypot(mv.at(mv.T).x - zone.x, mv.at(mv.T).y - zone.y) <= ZONE_R, 'within the zone');
    }
    void r;
  }
});

test('F28 collectOrder: the scoring team first, nearer the head first within a team', () => {
  const pl = [{ id: 'a', team: 0, x: 0, y: 0 }, { id: 'b', team: 0, x: 3, y: 3 }, { id: 'c', team: 1, x: 1, y: 1 }, { id: 'd', team: 1, x: 9, y: 9 }];
  assert.deepEqual(collectOrder(pl, { x: 3, y: 3 }, 1), ['c', 'd', 'b', 'a']);
  assert.deepEqual(collectOrder(pl, { x: 3, y: 3 }, 0), ['b', 'a', 'c', 'd']);
});

test('F28 crowded-head simulation: ten seeded layouts (incl. all twelve within 1 m of the jack) finish, keep apart, never kick toward anybody, and are not slower than walking to each boule', () => {
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const tc = [], tg = [];
  let kicksSeen = 0;
  for (let s = 1; s <= 10; s++) {
    const L = layout(s, { tight: s > 5 });
    for (const force of [false, true]) {
      const c = createCollect(L.pl, L.boules, { head: L.head, plan: L.plan, dims: DIMS, terrain: flat, force });
      let low = Infinity;
      for (let i = 0; i < 60 * 60 && !c.finished; i++) {
        c.step(1 / 60);
        if (i > 60 && i % 6 === 0) low = Math.min(low, minPair(c.agents.filter((a) => a.phase !== 'faded' && a.phase !== 'done')));
      }
      assert.ok(c.finished, `layout ${s} (force ${force}) finishes`);
      assert.ok(c.t <= KICK_TIMEOUT + 12, `layout ${s}: ${c.t.toFixed(1)} s`);
      assert.ok(low >= 0.1, `layout ${s}: closest ${low.toFixed(2)} m`);
      for (const k of c.kicks) {
        kicksSeen++;
        const dx = k.to.x - k.from.x, dy = k.to.y - k.from.y, d = Math.hypot(dx, dy);
        for (const p of [...k.people, k.kicker]) {
          const pd = Math.hypot(p.x - k.from.x, p.y - k.from.y);
          if (pd > 0.5 && pd < 5 && k.people.includes(p)) assert.ok(((p.x - k.from.x) * dx + (p.y - k.from.y) * dy) / (pd * d) < Math.cos(25 * Math.PI / 180), 'not toward a person');
        }
      }
      if (!force) tc.push(c.t);
    }
    const g = createGather(L.pl.map((a) => ({ ...a, boules: L.boules.filter((b) => b.owner === a.id) })));
    for (let i = 0; i < 60 * 60 && !g.finished; i++) g.step(1 / 60);
    tg.push(g.t);
  }
  assert.ok(kicksSeen > 0, 'the forced runs do kick');
  assert.ok(med(tc) <= med(tg) + 3, `median ${med(tc).toFixed(1)} s vs walking to every boule ${med(tg).toFixed(1)} s`);
});

// ---- F51: ring and collection in parallel ----
import { ringBlockers, ringGate, meneEndReady, RING_R, RING_WAIT_MAX } from '../../assets/js/petanque/crowd.js';
import { CIRCLE_R } from '../../assets/js/petanque/court.js';

test('F51: ring radius matches the court circle and the wait outlasts the collect fallback', () => {
  assert.equal(RING_R, CIRCLE_R);
  assert.ok(RING_WAIT_MAX > KICK_TIMEOUT);
});

test('F51: ringBlockers finds boules in the ring and people on it, not the holder or far things', () => {
  const spot = { x: 3, y: 10 };
  const clear = ringBlockers(spot, [{ id: 'a', x: 3.8, y: 10 }], [{ id: 'p', x: 4, y: 10 }, { id: 'h', x: 3, y: 10.1 }], 'h');
  assert.deepEqual(clear, { boules: [], people: [], clear: true });
  const bad = ringBlockers(spot, [{ id: 'in', x: 3.1, y: 10.1 }, { id: 'edge', x: 3.4, y: 10 }, { id: 'far', x: 3.9, y: 10 }], [{ id: 'p', x: 3.3, y: 10.2 }], 'h');
  assert.deepEqual(bad.boules, ['in', 'edge']);
  assert.deepEqual(bad.people, ['p']);
  assert.equal(bad.clear, false);
});

test('F51: ringGate waits while blocked, goes when clear, forces after the wait or a skip', () => {
  const blocked = { boules: ['x'], people: [], clear: false }, clear = { boules: [], people: [], clear: true };
  assert.equal(ringGate(clear, 0), 'go');
  assert.equal(ringGate(blocked, 0), 'wait');
  assert.equal(ringGate(blocked, RING_WAIT_MAX - 0.1), 'wait');
  assert.equal(ringGate(blocked, RING_WAIT_MAX), 'force');
  assert.equal(ringGate(blocked, 0, { skipped: true }), 'force');
});

test('F51: the next mène needs both the ring down and the collecting over', () => {
  assert.equal(meneEndReady({ ringDown: true, collectDone: false }), false);
  assert.equal(meneEndReady({ ringDown: false, collectDone: true }), false);
  assert.equal(meneEndReady({ ringDown: true, collectDone: true }), true);
  assert.equal(meneEndReady({}), false);
});
