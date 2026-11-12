import test from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../../assets/js/petanque/constants.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createBody, launch, createWorld, simulate, deadRowSlot, deadJackSpot } from '../../assets/js/petanque/physics.js';
import { createMatch, apply, jackValid, jackPlaceValid, jackFault, DEFAULT_GEOMETRY } from '../../assets/js/petanque/rules.js';
import { court, setCourt, resetCourt, nextCircle, ahead, farLine, farGap, toLocal, toWorld, baseYaw, forward, JACK_TOL, FRONT_MIN, FRONT_WANT } from '../../assets/js/petanque/court.js';
import { AI, chooseThrow, chooseJackThrow, chooseJackPlacement } from '../../assets/js/petanque/ai.js';
import { waitingSlots } from '../../assets/js/petanque/waiting.js';
import { difficultyScale } from '../../assets/js/petanque/donnee.js';

Object.assign(difficultyScale, { easy: 2.3, medium: 1.35, hard: 0.65 });
AI.timeGuard = false;
const flat = () => ({
  sample: () => ({ h: 0, nx: 0, ny: 0, nz: 1, friction: 0.1, loose: 0.2 }),
  stonesNear: () => [], addDivot() {}, resetDivots() {}, visibleStones: () => [], perceived() { return this; },
});

test('nextCircle: placed around the jack, legal, direction flips, front of the ring has room', () => {
  for (const dir of [1, -1]) {
    for (let y = 1; y <= 14; y += 0.37) {
      for (const x of [0.2, 1, 1.9, 3.2, 3.9]) {
        const n = nextCircle({ x, y }, dir);
        const p = n.placed, c = n.circle;
        assert.equal(n.dir, -dir);
        assert.ok(p.x >= 0 && p.x <= 4 && p.y >= 1 && p.y <= 14, `placed legal ${JSON.stringify(p)}`);
        if (x >= 0 && x <= 4) assert.ok(Math.hypot(p.x - x, p.y - y) <= JACK_TOL + 1e-9, 'placed around the jack');
        assert.ok(c.x >= 0 && c.x <= 4 && c.y >= 1 && c.y <= 14, `final legal ${JSON.stringify(c)}`);
        assert.ok(n.front >= FRONT_MIN - 1e-9, `front ${n.front}`);
        assert.equal(n.moved, c.y !== p.y);
        if (n.moved) {
          assert.ok(Math.abs(n.front - FRONT_WANT) < 1e-9, 'corrected to FRONT_WANT');
          assert.ok((c.y - p.y) * n.dir < 0, 'moved backwards, away from the far string');
        }
      }
    }
  }
});

test('nextCircle: a jack that finished 4 m from an end gets a ring with FRONT_WANT to the far string; plenty of room is left alone', () => {
  const a = nextCircle({ x: 2.1, y: 4 }, 1); // the jack is 4 m from y = 0 and the next mène plays toward y = 0
  assert.equal(a.dir, -1);
  assert.ok(a.moved);
  assert.ok(Math.abs(a.front - FRONT_WANT) < 1e-9);
  assert.ok(a.circle.y > a.placed.y, 'moved back, away from y = 0');
  const a2 = nextCircle({ x: 2.1, y: 11 }, -1); // 4 m from y = 15, toward y = 15
  assert.equal(a2.dir, 1);
  assert.ok(a2.moved && Math.abs(a2.front - FRONT_WANT) < 1e-9 && a2.circle.y < a2.placed.y);
  const b = nextCircle({ x: 2.3, y: 11 }, 1); // toward y = 0 with 10.75 m from the front of the ring
  assert.equal(b.dir, -1);
  assert.ok(!b.moved);
  assert.deepEqual(b.circle, b.placed);
  assert.ok(Math.hypot(b.circle.x - 2.3, b.circle.y - 11) <= JACK_TOL);
  const c = nextCircle({ x: 2, y: 10.2 }, 1); // 9.95 m: just short, so moved back to FRONT_WANT
  assert.ok(c.moved && Math.abs(c.front - FRONT_WANT) < 1e-9);
});

test('nextCircle: jack in the margin or beyond the string clamps to legal ground', () => {
  const n = nextCircle({ x: -0.4, y: 14.8 }, 1);
  assert.deepEqual([n.placed.x, n.placed.y], [0, 14]);
  assert.equal(n.dir, -1);
  const m = nextCircle({ x: 5, y: 0.2 }, -1);
  assert.deepEqual([m.placed.x, m.placed.y], [4, 1]);
  assert.equal(m.dir, 1);
  assert.ok(nextCircle(null, 1).circle);
});

test('court helpers follow the circle and direction', () => {
  setCourt({ x: 1.5, y: 12 }, -1);
  try {
    assert.equal(court.throwFrom.y, 12);
    assert.ok(Math.abs(baseYaw() - Math.PI) < 1e-9);
    assert.ok(forward().y < -0.99);
    assert.deepEqual(ahead(8), { x: 1.5, y: 4 });
    assert.equal(ahead(8, 1).x, 0.5); // to the thrower's right is -x
    assert.equal(farLine(), 0);
    assert.equal(farGap(2), 2);
    const l = toLocal({ x: 0.5, y: 4 });
    assert.ok(Math.abs(l.along - 8) < 1e-9 && Math.abs(l.across - 1) < 1e-9);
    const w = toWorld(l);
    assert.ok(Math.abs(w.x - 0.5) < 1e-9 && Math.abs(w.y - 4) < 1e-9);
    assert.ok(deadRowSlot(0).y < 0 && deadJackSpot().y < 0, 'dead row past the string being played toward');
    const slots = waitingSlots(null);
    assert.ok(slots.filter((s) => s.zone === 'circle').every((s) => s.y > 12), 'behind the circle is +y now');
    assert.ok(slots.filter((s) => s.zone === 'jack').every((s) => s.y < 12));
  } finally { resetCourt(); }
  assert.equal(court.dir, 1);
  assert.ok(deadRowSlot(0).y > 15);
});

test('rules: the next mène has the new circle and direction in the geometry', () => {
  let m = createMatch({});
  m = apply(m, { type: 'jackThrown', team: 0, jack: { x: 2.2, y: 9.5 } });
  assert.equal(m.phase, 'play');
  m = { ...m, phase: 'meneEnd', result: { void: true } };
  const next = apply(m, { type: 'nextMene' });
  assert.equal(next.geometry.dir, -1);
  assert.ok(next.geometry.circle.y >= 10.75 - 1e-9 && Math.abs(next.geometry.circle.x - 2.2) < 1e-9, 'the corrected ring: 11 m from its front to y = 0');
  assert.equal(m.geometry.dir, 1, 'the old match is untouched');
});

test('rules geometry with a moved circle: jack distance and the end rule use the new circle and direction', () => {
  const geometry = { ...DEFAULT_GEOMETRY, circle: { x: 2, y: 12 }, dir: -1 };
  assert.ok(jackValid({ x: 2, y: 5 }, geometry)); // 7 m toward y = 0
  assert.ok(!jackValid({ x: 2, y: 8 }, geometry)); // only 4 m
  assert.ok(!jackValid({ x: 2, y: 16 }, geometry)); // 4 m behind, out
  assert.ok(jackValid({ x: 2, y: 2 }, geometry)); // 10 m, 2 m from the end string
  assert.ok(!jackValid({ x: 2, y: 0.4 }, geometry), 'within 0.5 m of the end string at y = 0');
  assert.ok(jackValid({ x: 2, y: 0.6 }, { ...geometry, circle: { x: 2, y: 6.9 } }));
  assert.equal(jackFault({ x: 2, y: 8 }, geometry).reason, 'short');
  assert.ok(jackPlaceValid({ x: 2, y: 5 }, geometry));
  // the same spot read with the default geometry (circle at y = 1, +y) is a different answer
  assert.ok(jackValid({ x: 2, y: 8 }) && !jackValid({ x: 2, y: 5 }));
});

test('AI planning toward y = 0 from a circle at y = 13', () => {
  setCourt({ x: 2, y: 13 }, -1);
  try {
    const geometry = { ...DEFAULT_GEOMETRY, circle: { x: 2, y: 13 }, dir: -1 };
    // the jack throw lands a legal jack most of the time and aims toward y = 0
    let ok = 0;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const world = createWorld(flat(), mulberry32(i));
      const r = chooseJackThrow({ world, difficulty: 'medium', rand: mulberry32(i + 50), geometry });
      assert.ok(Math.cos(r.throwParams.yaw) < -0.9, 'throws toward y = 0');
      const j = launch(createBody('jack', {}), r.throwParams);
      world.add(j);
      simulate(world);
      if (jackValid({ x: j.x, y: j.y, dead: j.dead }, geometry)) ok++;
    }
    assert.ok(ok >= 0.7 * n, `${ok}/${n} valid`);
    // a boule throw at a jack near y = 5 points toward it and ends near it
    let near = 0, total = 0;
    for (let i = 0; i < 6; i++) {
      const world = createWorld(flat(), mulberry32(i));
      const jack = world.add(createBody('jack', { x: 1.8 + 0.1 * i, y: 5 + 0.3 * i }));
      const match = { ...createMatch({ geometry }), phase: 'play', jack: { x: jack.x, y: jack.y }, boules: [] };
      const player = match.players.find((p) => p.id === 'marcel');
      const r = chooseThrow({ world: world.clone(), match, player, difficulty: 'medium', rand: mulberry32(100 + i) });
      assert.ok(Math.cos(r.throwParams.yaw) < -0.9, 'faces y = 0');
      assert.ok(r.donnee.y < 12 && r.donnee.y > jack.y - 3, `donnée ${r.donnee.y} near the jack`);
      const b = launch(createBody('boule', { team: 1 }), r.throwParams);
      world.add(b);
      simulate(world);
      total++;
      if (!b.dead && Math.hypot(b.x - jack.x, b.y - jack.y) < 3) near++;
    }
    assert.ok(near >= total - 1, `${near}/${total} within 3 m`);
  } finally { resetCourt(); }
});

test('chooseJackPlacement and jackValid read the same moved circle and flipped direction', () => {
  for (const [circle, dir] of [[{ x: 2.3, y: 10.5 }, -1], [{ x: 1.2, y: 13 }, -1], [{ x: 2.8, y: 3 }, 1], [{ x: 2, y: 1 }, 1]]) {
    setCourt(circle, dir);
    try {
      const geometry = { ...DEFAULT_GEOMETRY, circle, dir };
      const match = { ...createMatch({ geometry }), phase: 'jackPlace' };
      for (let attempt = 0; attempt < 3; attempt++) {
        for (const id of ['marcel', 'odette', 'pierre']) {
          const player = match.players.find((p) => p.id === id);
          const spot = chooseJackPlacement({ match, player, difficulty: 'medium', rand: mulberry32(attempt * 7 + id.length), terrain: flat(), attempt });
          const d = Math.hypot(spot.x - circle.x, spot.y - circle.y);
          assert.ok(d - 0.265 >= 6 - 1e-9 && d - 0.265 <= 10 + 1e-9, `${id}: ${d} m (edge ${d - 0.265}) from the circle ${JSON.stringify(circle)} dir ${dir}`);
          assert.ok(Math.abs(d - 0.265 - spot.distance) < 1e-6, 'the reported distance is the edge gap');
          assert.ok((spot.y - circle.y) * dir > 0, 'in the playing direction');
          assert.ok(jackValid(spot, geometry) && jackPlaceValid(spot, geometry));
        }
      }
      // jackValid measures from the current circle, not (2, 1)
      const probe = { x: circle.x, y: circle.y + 8 * dir };
      assert.ok(jackValid(probe, geometry));
      assert.equal(jackFault({ x: circle.x, y: circle.y + 3 * dir }, geometry).reason, 'short');
    } finally { resetCourt(); }
  }
});

test('F10: the ring after a dead jack is centred near its last in-bounds spot', () => {
  const W = C.terrainW, L = C.terrainL;
  for (const [spot, dir] of [[{ x: 2.1, y: L - 0.02 }, 1], [{ x: 2.1, y: 0.02 }, -1], [{ x: 0.02, y: 7 }, 1], [{ x: W - 0.02, y: 8 }, -1]]) {
    const n = nextCircle(spot, dir);
    assert.ok(Math.abs(n.placed.x - spot.x) <= 1.5 && Math.abs(n.placed.y - spot.y) <= 1.5, JSON.stringify(n.placed));
    assert.ok(n.circle.x >= 0 && n.circle.x <= W && Math.abs(n.circle.x - spot.x) <= 1.5);
  }
});

test('F24: after a mène the court circle and dir are exactly nextCircle of the last jack, from either mène end', () => {
  const W = C.terrainW, L = C.terrainL;
  try {
    for (const dir of [1, -1]) {
      for (const jack of [{ x: 2.3, y: 9.2 }, { x: 1.1, y: L - 2 }, { x: 3.4, y: 2.5 }, { x: 2.0, y: 7.0, dead: true, spot: { x: 2.2, y: L - 0.3 } }]) {
        const circle = dir > 0 ? { x: 2, y: 1 } : { x: 2, y: L - 1 };
        resetCourt(); setCourt(circle, dir);
        const base = createMatch({ target: 13, players: undefined });
        const m = { ...base, phase: 'meneEnd', jack, boules: [], result: { void: true }, geometry: { ...base.geometry, circle: { ...circle }, dir } };
        const spot = jack.dead && jack.spot ? jack.spot : jack;
        const want = nextCircle(spot, court.dir, { width: m.geometry.width, length: m.geometry.length });
        const next = apply(m, { type: 'nextMene' });
        assert.deepEqual(next.geometry.circle, { x: want.circle.x, y: want.circle.y });
        assert.equal(next.geometry.dir, want.dir);
        assert.equal(want.dir, -dir, 'play turns to the other end');
        setCourt(next.geometry.circle, next.geometry.dir); // what main.js applyCourt does in quick, slow and instant mode alike
        assert.equal(court.circle.x, want.circle.x); assert.equal(court.circle.y, want.circle.y);
        assert.equal(court.throwFrom.x, want.circle.x); assert.equal(court.throwFrom.y, want.circle.y);
        assert.equal(court.dir, want.dir);
      }
    }
  } finally { resetCourt(); }
});

test('F89: sweeping the jack along every string, the ring centre is on the court, may straddle a string, and keeps FRONT_MIN', () => {
  let straddled = 0;
  for (const dir of [1, -1]) {
    for (let x = -0.5; x <= 4.5; x += 0.25) {
      for (let y = -0.5; y <= 15.5; y += 0.5) {
        const n = nextCircle({ x, y }, dir);
        assert.ok(n.circle.x >= 0 && n.circle.x <= 4 && n.circle.y >= 1 && n.circle.y <= 14, `centre ${n.circle.x},${n.circle.y}`);
        assert.ok(n.front >= FRONT_MIN - 1e-9 || n.circle.y === 1 || n.circle.y === 14);
        if (n.circle.x - n.circle.r < 0 || n.circle.x + n.circle.r > 4) straddled++;
      }
    }
  }
  assert.ok(straddled > 0, 'straddling a side string is allowed (Art. 6: the circle is not an out of bounds area)');
});
