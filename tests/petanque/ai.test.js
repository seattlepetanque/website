import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, gauss } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createBody, launch, createWorld, simulate } from '../../assets/js/petanque/physics.js';
import { createMatch, jackValid } from '../../assets/js/petanque/rules.js';
import { chooseThrow, chooseThrowAsync, chooseJackThrow, assistJackThrow } from '../../assets/js/petanque/ai.js';

// Flat packed terrain, no stones
function flat() {
  return {
    sample: () => ({ h: 0, nx: 0, ny: 0, nz: 1, friction: 0.1, loose: 0.2 }),
    stonesNear: () => [], addDivot() {}, resetDivots() {}, visibleStones: () => [],
    perceived() { return this; },
  };
}

function setup({ jack = { x: 2, y: 8.5 }, boules = [], seed = 1 } = {}) {
  const world = createWorld(flat(), mulberry32(seed));
  const j = world.add(createBody('jack', { x: jack.x, y: jack.y }));
  const bodies = boules.map((b) => world.add(createBody('boule', b)));
  const match = { ...createMatch({}), phase: 'play', jack: { x: j.x, y: j.y }, boules: bodies };
  return { world, match, jack: j };
}

const marcel = (match) => match.players.find((p) => p.id === 'marcel');
const odette = (match) => match.players.find((p) => p.id === 'odette');

function throwAndMeasure(world, params, jack) {
  const b = launch(createBody('boule', { team: 1 }), params);
  world.add(b);
  simulate(world);
  return b.dead ? 3 : Math.hypot(b.x - jack.x, b.y - jack.y);
}

test('AI points closer than random throws on flat terrain', () => {
  const n = 12;
  let ai = 0, rnd = 0;
  for (let i = 0; i < n; i++) {
    const s = setup({ jack: { x: 1.6 + (i % 4) * 0.3, y: 7.5 + (i % 3) }, seed: i });
    const rand = mulberry32(200 + i);
    const r = chooseThrow({ world: s.world.clone(), match: s.match, player: marcel(s.match), difficulty: 'medium', rand });
    assert.equal(r.intent, 'point');
    ai += throwAndMeasure(s.world.clone(), r.throwParams, s.jack);
    const d = Math.hypot(s.jack.x - 2, s.jack.y - 1);
    const rp = {
      yaw: Math.atan2(s.jack.x - 2, s.jack.y - 1) + gauss(rand) * 0.05,
      speed: (2 + 0.55 * d) * (0.75 + rand() * 0.5), loft: 0.6, backspin: 40, sidespin: 0,
    };
    rnd += throwAndMeasure(s.world.clone(), rp, s.jack);
  }
  assert.ok(ai / n < rnd / n, `ai ${ai / n} random ${rnd / n}`);
});

test('tireur shoots an opponent boule sitting on the jack when not holding the point', () => {
  let shoot = 0;
  const seeds = 6;
  for (let i = 0; i < seeds; i++) {
    const s = setup({ boules: [{ x: 2.03, y: 8.55, team: 0 }], seed: i });
    const r = chooseThrow({ world: s.world, match: s.match, player: odette(s.match), difficulty: 'hard', rand: mulberry32(i + 1) });
    if (r.intent === 'shoot') shoot++;
    assert.ok(typeof r.label === 'string' && r.label.length > 0);
  }
  assert.ok(shoot >= 4, `shot ${shoot}/${seeds}`);
});

test('chooseThrow is deterministic for a fixed rand', () => {
  const s = setup({ boules: [{ x: 2.2, y: 8.6, team: 0 }] });
  const run = () => chooseThrow({ world: s.world, match: s.match, player: marcel(s.match), difficulty: 'medium', rand: mulberry32(42) });
  assert.deepEqual(run(), run());
});

test('chooseThrow does not modify the world', () => {
  const s = setup({ boules: [{ x: 2.2, y: 8.6, team: 0 }] });
  const before = JSON.stringify(s.world.bodies);
  chooseThrow({ world: s.world, match: s.match, player: marcel(s.match), difficulty: 'hard', rand: mulberry32(3) });
  assert.equal(JSON.stringify(s.world.bodies), before);
});

test('a medium decision takes under 200 ms', () => {
  const s = setup({ boules: [{ x: 2.2, y: 8.6, team: 0 }, { x: 1.7, y: 8.4, team: 1 }] });
  const args = { world: s.world, match: s.match, player: odette(s.match), difficulty: 'medium', rand: mulberry32(9) };
  chooseThrow(args); // builds the launch table
  const t0 = performance.now();
  chooseThrow({ ...args, rand: mulberry32(10) });
  const ms = performance.now() - t0;
  assert.ok(ms < 200, `took ${ms.toFixed(0)} ms`);
});

test('chooseJackThrow lands a valid jack most of the time', () => {
  let ok = 0;
  const n = 20;
  for (let i = 0; i < n; i++) {
    const world = createWorld(flat(), mulberry32(i));
    const r = chooseJackThrow({ world, difficulty: 'medium', rand: mulberry32(i + 50) });
    assert.equal(r.intent, 'jack');
    const j = launch(createBody('jack', {}), r.throwParams);
    world.add(j);
    simulate(world);
    if (jackValid({ x: j.x, y: j.y, dead: j.dead })) ok++;
  }
  assert.ok(ok >= 0.7 * n, `${ok}/${n} valid`);
});

test('chooseThrowAsync matches chooseThrow for the same seed', async () => {
  const s = setup({ boules: [{ x: 2.2, y: 8.6, team: 0 }] });
  const args = (seed) => ({ world: s.world, match: s.match, player: marcel(s.match), difficulty: 'medium', rand: mulberry32(seed) });
  const sync = chooseThrow(args(77));
  const async_ = await chooseThrowAsync(args(77));
  assert.deepEqual(async_, sync);
});

test('assistJackThrow pulls a wide range of swing speeds into a legal jack most of the time', () => {
  let ok = 0, n = 0;
  for (const loft of [0.3, 0.6, 1.0]) for (const speed of [4.8, 5.6, 6.4, 7.2, 8.2]) for (let t = 1; t <= 3; t++) {
    const terrain = createTerrain(t);
    const world = createWorld(terrain, mulberry32(t * 7));
    const j = launch(createBody('jack', {}), assistJackThrow({ yaw: 0, speed, loft, backspin: 0, sidespin: 0 }));
    world.add(j);
    simulate(world);
    n++;
    if (jackValid({ x: j.x, y: j.y, dead: j.dead })) ok++;
  }
  assert.ok(ok >= 0.65 * n, `${ok}/${n} valid`);
});
