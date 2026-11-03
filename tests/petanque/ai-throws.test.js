// D16: short AI throws and the tireurs' shooting. Plan vs actual rest on flat terrain, plan and launch sharing one
// release point, and tir hit rates on seeded gravel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createBody, launch, createWorld, simulate } from '../../assets/js/petanque/physics.js';
import { createMatch } from '../../assets/js/petanque/rules.js';
import { solveLaunch } from '../../assets/js/petanque/donnee.js';
import { releaseOffset } from '../../assets/js/petanque/character.js';
import { specFor } from '../../assets/js/petanque/personalities.js';
import { C } from '../../assets/js/petanque/constants.js';
import { AI, chooseThrow } from '../../assets/js/petanque/ai.js';

// the balance multipliers (DIFFICULTY.*.skillMul, D22) are measured in measure-tactics.js; this file checks accuracy at donnee.js's own scaling
import { DIFFICULTY } from '../../assets/js/petanque/tactics.js';
for (const d of Object.values(DIFFICULTY)) d.skillMul = 1;
AI.timeGuard = false;

function flat() {
  return {
    sample: () => ({ h: 0, nx: 0, ny: 0, nz: 1, friction: 0.2, loose: 0.3 }),
    stonesNear: () => [], addDivot() {}, resetDivots() {}, visibleStones: () => [],
    perceived() { return this; },
  };
}

function setup({ terrain = flat(), jack, boules = [], seed = 1 }) {
  const world = createWorld(terrain, mulberry32(seed));
  const j = world.add(createBody('jack', { x: jack.x, y: jack.y }));
  const bodies = boules.map((b) => world.add(createBody('boule', b)));
  const match = { ...createMatch({}), phase: 'play', jack: { x: j.x, y: j.y }, boules: bodies };
  return { world, match, jack: j, terrain };
}
const playerOf = (match, id) => match.players.find((p) => p.id === id);

// The browser's plan base (main.js handFrom): the character's hand at release for the stance and loft
function handBase(id, yaw) {
  const spec = specFor(id);
  const hand = (loft) => {
    const o = releaseOffset({ height: spec.height, stance: spec.stance, loft, yaw });
    return { x: C.circle.x + o.x, y: C.circle.y + o.y, z: o.z };
  };
  return { x: C.circle.x, y: C.circle.y, release: hand };
}

function restOf(world, terrain, params, from, rand) {
  const w = world.clone(terrain, rand || (() => 0.5));
  const b = launch(createBody('boule', { team: 1 }), params, from);
  w.add(b);
  simulate(w, 20);
  return b;
}

// With one style forced by a big preference, which style did the AI plan?
function forced(style) {
  const saved = AI.stylePref;
  AI.stylePref = { marcel: { [style]: 5 }, odette: { [style]: 5 }, pierre: { [style]: 5 } };
  return () => { AI.stylePref = saved; };
}

test('flat terrain: every pointing style\'s noiseless rest lands on the intended rest', () => {
  for (const style of ['roulette', 'demi', 'plombee']) {
    const restore = forced(style);
    try {
      let n = 0, errSum = 0, worst = 0;
      for (let i = 0; i < 6; i++) {
        const jack = { x: 1.7 + (i % 3) * 0.3, y: 6.5 + i * 0.5 };
        const s = setup({ jack, seed: i });
        const r = chooseThrow({ world: s.world.clone(), match: s.match, player: playerOf(s.match, 'marcel'), difficulty: 'hard', rand: mulberry32(40 + i) });
        if (r.intent !== 'point') continue;
        const tp = solveLaunch({ from: r.from, landing: r.donnee, loft: r.loft, terrain: s.terrain });
        const b = restOf(s.world, s.terrain, tp, r.from);
        const err = Math.hypot(b.x - r.info.target.x, b.y - r.info.target.y);
        n++; errSum += err; worst = Math.max(worst, err);
      }
      assert.ok(n >= 4, `${style}: planned ${n}/6 pointing throws`);
      assert.ok(errSum / n < 0.65 && worst < 1.3, `${style}: mean miss ${(errSum / n).toFixed(2)} m, worst ${worst.toFixed(2)} m`);
    } finally { restore(); }
  }
});

test('flat terrain: no AI throw ends more than 2 m short of its intended rest (noise at Hard)', () => {
  let n = 0, worst = -9;
  for (const id of ['marcel', 'odette', 'pierre']) {
    for (let i = 0; i < 10; i++) {
      const jack = { x: 1.5 + (i % 4) * 0.3, y: 6.2 + (i % 5) * 0.8 };
      const s = setup({ jack, seed: i });
      const player = playerOf(s.match, id);
      const jy = Math.atan2(jack.x - C.circle.x, jack.y - C.circle.y);
      const r = chooseThrow({ world: s.world.clone(), match: s.match, player, difficulty: 'hard', rand: mulberry32(7 * i + 1), from: handBase(id, jy) });
      if (r.intent !== 'point') continue;
      const b = restOf(s.world, s.terrain, r.throwParams, r.from, mulberry32(i));
      const ux = r.donnee.x - r.from.x, uy = r.donnee.y - r.from.y, ul = Math.hypot(ux, uy);
      const short = ((r.info.target.x - b.x) * ux + (r.info.target.y - b.y) * uy) / ul;
      n++; worst = Math.max(worst, short);
      assert.ok(!b.dead && short < 2, `${id} ${r.style} jack ${jack.y.toFixed(1)}: ${short.toFixed(2)} m short`);
    }
  }
  assert.ok(n >= 20, `${n} pointing throws checked`);
});

test('plan and launch use the same release point (the character\'s hand, not a default)', () => {
  const s = setup({ jack: { x: 2, y: 8 }, boules: [{ x: 2.03, y: 8.05, team: 0 }] });
  const yaw = Math.atan2(2 - C.circle.x, 8 - C.circle.y);
  const seen = new Set();
  for (const id of ['marcel', 'odette', 'pierre']) {
    const base = handBase(id, yaw);
    for (const d of ['easy', 'hard']) {
      const r = chooseThrow({ world: s.world.clone(), match: s.match, player: playerOf(s.match, id), difficulty: d, rand: mulberry32(5), from: base });
      const hand = base.release(r.loft);
      assert.deepEqual(r.from, hand, `${id} plans from the hand at its chosen loft`);
      assert.equal(r.throwParams.from, r.from);
      // the boule launched with default arguments appears at that point
      const b = launch(createBody('boule', {}), r.throwParams);
      assert.equal(b.x, hand.x); assert.equal(b.y, hand.y); assert.equal(b.z, hand.z);
      // and a noiseless throw from there lands on the planned donnée
      const tp = solveLaunch({ from: r.from, landing: r.donnee, loft: r.loft, terrain: s.terrain });
      const w = createWorld(flat(), () => 0.5);
      const nb = launch(createBody('boule', {}), tp, r.from);
      w.add(nb);
      simulate(w, 20);
      const land = w.events.find((e) => e.type === 'land');
      assert.ok(Math.hypot(land.x - r.donnee.x, land.y - r.donnee.y) < 0.05, `${id} lands ${Math.hypot(land.x - r.donnee.x, land.y - r.donnee.y)} m from its donnée`);
      seen.add(r.from.z.toFixed(2));
    }
  }
  assert.ok(seen.size > 1, 'release heights differ between players and lofts');
});

// Tir hit rate on seeded gravel: an opponent boule beside the jack, the shooter forced to shoot at it
function shootRate(id, difficulty, n) {
  let shots = 0, hit = 0, chose = 0;
  for (let i = 0; i < n; i++) {
    const terrain = createTerrain(100 + (i % 8));
    const jack = { x: 1.5 + ((i * 7) % 10) * 0.1, y: 7 + (i % 5) * 0.7 };
    const foe = 1 - playerOf(createMatch({}), id).team;
    const s = setup({ terrain, jack, boules: [{ x: jack.x + 0.05, y: jack.y - 0.1, team: foe }], seed: i });
    const target = s.world.bodies.find((b) => b.kind === 'boule');
    const tx = target.x, ty = target.y;
    const yaw = Math.atan2(jack.x - C.circle.x, jack.y - C.circle.y);
    const r = chooseThrow({ world: s.world.clone(), match: s.match, player: playerOf(s.match, id), difficulty, rand: mulberry32(700 + i), from: handBase(id, yaw) });
    chose++;
    if (r.intent !== 'shoot') continue;
    shots++;
    terrain.resetDivots();
    const b = launch(createBody('boule', { team: 1 }), r.throwParams);
    s.world.add(b);
    simulate(s.world, 20);
    if (target.dead || Math.hypot(target.x - tx, target.y - ty) > 0.15) hit++;
  }
  return { shots, hit, chose, rate: shots ? hit / shots : 0 };
}

test('tireur hit rates on gravel: roughly half at Medium, better at Hard, Pierre a little below Odette', { timeout: 120000 }, () => {
  const saved = { ...AI.sims };
  AI.sims.medium = 6; AI.sims.hard = 8;
  try {
    const n = 60;
    const om = shootRate('odette', 'medium', n), pm = shootRate('pierre', 'medium', n);
    const oh = shootRate('odette', 'hard', n);
    const say = `odette M ${om.hit}/${om.shots}, pierre M ${pm.hit}/${pm.shots}, odette H ${oh.hit}/${oh.shots}`;
    assert.ok(om.shots >= 10 && pm.shots >= 10 && oh.shots >= 10, `they still shoot: ${say}`);
    assert.ok(om.rate >= 0.4 && om.rate <= 0.75, `Odette at Medium ${om.rate.toFixed(2)} (${say})`);
    assert.ok(pm.rate >= 0.25 && pm.rate <= 0.7, `Pierre at Medium ${pm.rate.toFixed(2)} (${say})`);
    assert.ok(oh.rate >= om.rate - 0.12 && oh.rate >= 0.45, `Odette at Hard ${oh.rate.toFixed(2)} (${say})`);
    assert.ok(pm.rate <= om.rate + 0.1, `Pierre does not out-shoot Odette (${say})`);
  } finally { Object.assign(AI.sims, saved); }
});

test('the AI plans at the jack where it is now: a knocked jack moves the plan with it', () => {
  const s = setup({ jack: { x: 2, y: 7.5 }, boules: [{ x: 2.05, y: 7.45, team: 0 }] });
  const yaw0 = Math.atan2(2 - C.circle.x, 7.5 - C.circle.y);
  const run = (id, difficulty) => chooseThrow({ world: s.world, match: s.match, player: playerOf(s.match, id), difficulty, rand: mulberry32(9), from: handBase(id, yaw0) });
  const jack = s.jack, boule = s.world.bodies.find((b) => b.kind === 'boule');
  for (const [id, wantIntent] of [['marcel', 'point'], ['odette', null]]) {
    jack.x = 2; jack.y = 7.5; boule.x = 2.05; boule.y = 7.45;
    const a = run(id, 'hard');
    // a knock sends the jack (and the boule beside it) 1.5 m further and 0.8 m to the side
    jack.x = 2.8; jack.y = 9.0; boule.x = 2.85; boule.y = 8.95;
    const b = run(id, 'hard');
    if (wantIntent) assert.equal(b.intent, wantIntent);
    // (the donnée itself depends on the style chosen: a roulette lands far short of the jack, a plombée near it)
    assert.ok(b.donnee.x > a.donnee.x + 0.02 || b.style !== a.style, `${id}: donnée moves sideways too`);
    assert.ok(Math.abs(b.info.target.y - 9.0) < 0.6 && Math.abs(b.info.target.x - 2.8) < 0.6, `${id}: target is at the new jack, not ${b.info.target.x.toFixed(2)},${b.info.target.y.toFixed(2)}`);
    // predicted (noiseless) rest follows the new jack, and the yaw points at it
    const tp = solveLaunch({ from: b.from, landing: b.donnee, loft: b.loft, terrain: s.terrain });
    const rest = restOf(s.world, s.terrain, tp, b.from);
    if (b.intent === 'shoot') assert.ok(Math.hypot(b.donnee.x - 2.85, b.donnee.y - 8.95) < 1.0, `${id}: shot lands near the boule's new spot`);
    else assert.ok(Math.hypot(rest.x - jack.x, rest.y - jack.y) < 1.0, `${id}: predicted rest ${rest.x.toFixed(2)},${rest.y.toFixed(2)} vs jack`);
    assert.ok(Math.abs(b.throwParams.yaw - Math.atan2(2.8 - b.from.x, 9.0 - b.from.y)) < 0.1);
  }
});
