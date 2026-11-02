import test from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../../assets/js/petanque/constants.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createBody, launch, createWorld, simulate } from '../../assets/js/petanque/physics.js';
import { spread, tir, reverse, plombee } from './measure-physics.js';

// Flat terrain stub; optional slope (h = -slope * y) and stones
function stub({ slope = 0, friction = 0.1, loose = 0, stones = [] } = {}) {
  const inv = 1 / Math.sqrt(slope * slope + 1);
  return {
    sample: (x, y) => ({ h: -slope * y, nx: 0, ny: slope * inv, nz: inv, friction, loose }),
    stonesNear: (x, y, r) => stones.filter((s) => (s.x - x) ** 2 + (s.y - y) ** 2 <= (r + s.r) ** 2),
    addDivot() {}, resetDivots() {}, visibleStones: () => [], perceived() { return this; },
  };
}

const rand = () => mulberry32(5);
const boule = (x, y, extra = {}) => createBody('boule', { x, y, team: 0, ...extra });
const finite = (b) => ['x', 'y', 'z', 'vx', 'vy', 'vz', 'wx', 'wy', 'wz'].every((k) => Number.isFinite(b[k]));

function throwBall(terrain, p, seed = 1) {
  const w = createWorld(terrain, mulberry32(seed));
  const b = launch(createBody('boule', { team: 0 }), p);
  w.add(b);
  b.state = 'airborne';
  return { w, b };
}

function firstLand(w) { return w.events.find((e) => e.type === 'land'); }

test('lob with strong backspin stops near its landing point', () => {
  for (const terrain of [stub(), createTerrain(3)]) {
    const { w, b } = throwBall(terrain, { yaw: 0, speed: 8, loft: 1.3, backspin: 120, sidespin: 0 });
    simulate(w);
    const land = firstLand(w);
    assert.ok(land && land.y > 4);
    assert.ok(Math.abs(b.y - land.y) < 0.5, `moved ${b.y - land.y}`);
    assert.equal(b.state, 'resting');
  }
});

test('roulette rolls further than it flew', () => {
  for (const terrain of [stub(), createTerrain(3)]) {
    const { w, b } = throwBall(terrain, { yaw: 0, speed: 7.5, loft: 0.1, backspin: 0, sidespin: 0 });
    simulate(w);
    const land = firstLand(w);
    const flown = land.y - C.throwFrom.y, rolled = b.y - land.y;
    assert.ok(rolled > flown, `flew ${flown} rolled ${rolled}`);
  }
});

test('backspin shortens the run versus none', () => {
  const run = (backspin) => {
    const { w, b } = throwBall(stub(), { yaw: 0, speed: 8, loft: 0.9, backspin, sidespin: 0 });
    simulate(w);
    return b.y - firstLand(w).y;
  };
  assert.ok(run(100) < run(0) - 1);
});

test('a ball on a slope drifts downhill', () => {
  const w = createWorld(stub({ slope: 0.15, friction: 0.05 }), rand());
  const b = w.add(boule(2, 8));
  b.state = 'rolling';
  for (let i = 0; i < 240; i++) w.step();
  assert.ok(b.y > 8.2, `y=${b.y}`); // h = -slope*y, so downhill is +y
});

test('a ball on a gentle slope stays put when resistance holds it', () => {
  const w = createWorld(stub({ slope: 0.02, friction: 0.1 }), rand());
  const b = w.add(boule(2, 8));
  for (let i = 0; i < 240; i++) w.step();
  assert.equal(b.y, 8);
});

test('a pebble in the path changes the trajectory', () => {
  const run = (stones) => {
    const w = createWorld(stub({ stones }), rand());
    const b = w.add(boule(2, 3));
    b.state = 'rolling'; b.vy = 3; b.wx = -3 / b.r;
    simulate(w);
    return { b, w };
  };
  const clear = run([]);
  const pebble = run([{ x: 2.012, y: 4, r: 0.0075, h: -0.003 }]);
  assert.ok(Math.abs(pebble.b.x - clear.b.x) > 0.005 || Math.abs(pebble.b.y - clear.b.y) > 0.02);
});

test('a pebble nudges a heavy boule modestly but the light jack a lot more', () => {
  const dev = (kind) => {
    const run = (stones) => {
      const w = createWorld(stub({ stones }), rand());
      const b = w.add(createBody(kind, { x: 2, y: 3, team: 0 }));
      b.state = 'rolling'; b.vy = 3; b.wx = -3 / b.r;
      simulate(w);
      return b;
    };
    const clear = run([]);
    const hit = run([{ x: 2.012, y: 4, r: 0.0075, h: -0.003 }]);
    return Math.hypot(hit.x - clear.x, hit.y - clear.y);
  };
  assert.ok(dev('boule') < 0.8, `boule moved ${dev('boule')}`);
  assert.ok(dev('jack') > dev('boule'), `jack ${dev('jack')} boule ${dev('boule')}`);
});

test('a rock directly in the path still deflects a boule strongly', () => {
  const run = (stones) => {
    const w = createWorld(stub({ stones }), rand());
    const b = w.add(boule(2, 3));
    b.state = 'rolling'; b.vy = 4; b.wx = -4 / b.r;
    simulate(w);
    return b;
  };
  const clear = run([]);
  const rock = run([{ x: 2.02, y: 5, r: 0.02, h: 0.008 }]);
  assert.ok(Math.hypot(rock.x - clear.x, rock.y - clear.y) > 0.8, `moved ${rock.x - clear.x}, ${rock.y - clear.y}`);
});

test('identical throws on seeded gravel spread 0.3-0.6 m (boule) and more for the jack', () => {
  const demi = spread('boule', { yaw: 0, loft: 0.6, backspin: 55, sidespin: 0 }, 8, 3, 25);
  const jack = spread('jack', { yaw: 0, loft: 0.6, backspin: 20, sidespin: 0 }, 8, 3, 25);
  assert.ok(demi > 0.25 && demi < 0.65, `demi spread ${demi}`);
  assert.ok(jack > demi * 1.3, `jack ${jack} vs demi ${demi}`);
});

test('a direct in-air hit sends the target away and the shooter drops near the impact (carreau)', () => {
  for (const bs of [40, 60, 80]) {
    for (const dz of [0.03, 0.04]) {
      const r = tir(bs, 1, stub(), dz);
      assert.ok(r.targetMove > 1, `target moved ${r.targetMove}`);
      assert.ok(r.shooterFromImpact < 0.5 && !r.shooterDead, `bs ${bs} dz ${dz}: shooter ${r.shooterFromImpact}`);
    }
  }
});

test('backspin never rolls a boule back more than 0.3 m', () => {
  let worst = -9;
  for (const bs of [0, 60, 100, 150]) {
    for (const [sp, lf] of [[5, 1.3], [7, 1.0], [9, 1.0], [11, 1.3]]) {
      worst = Math.max(worst, reverse(bs, stub(), 1, sp, lf));
      for (let t = 1; t <= 3; t++) for (let sd = 1; sd <= 3; sd++) worst = Math.max(worst, reverse(bs, createTerrain(t), sd, sp, lf));
    }
  }
  assert.ok(worst <= 0.3, `reverse roll ${worst}`);
});

test('a plombee with 60 rad/s backspin ends close to where it landed', () => {
  assert.ok(plombee(60, stub()) < 0.5);
  const d = [];
  for (let t = 1; t <= 4; t++) for (let sd = 1; sd <= 5; sd++) d.push(plombee(60, createTerrain(t), sd));
  d.sort((a, b) => a - b);
  assert.ok(d[Math.floor(d.length / 2)] < 0.5, `median ${d[Math.floor(d.length / 2)]}`);
});

test('a shot landing on a resting boule moves it and the shooter nearly stops (carreau)', () => {
  const w = createWorld(stub(), rand());
  const target = w.add(boule(2, 8));
  const shooter = w.add(boule(2, 7.2));
  // flat shot with some backspin: lands just short, then strikes the target
  shooter.state = 'airborne'; shooter.z = 0.12;
  shooter.vy = 7; shooter.vz = -1.5; shooter.wx = 120;
  simulate(w);
  assert.ok(target.dead || target.y - 8 > 0.5, `target moved ${target.y - 8}`);
  assert.ok(shooter.y < 8.5 && !shooter.dead, `shooter at ${shooter.y}`);
  assert.ok(w.events.some((e) => e.type === 'hit'));
});

test('boule hitting a jack sends the jack away faster', () => {
  const w = createWorld(stub(), rand());
  const jack = w.add(createBody('jack', { x: 2, y: 8, team: -1 }));
  const b = w.add(boule(2, 7.5));
  b.state = 'rolling'; b.vy = 3; b.wx = -3 / b.r;
  for (let i = 0; i < 240; i++) w.step();
  assert.ok(jack.y > 8.1);
});

test('out of bounds marks dead and stops simulating', () => {
  const w = createWorld(stub(), rand());
  const b = w.add(boule(2, 14.9));
  b.state = 'rolling'; b.vy = 4; b.wx = -4 / b.r;
  simulate(w);
  assert.equal(b.dead, true);
  assert.ok(w.events.some((e) => e.type === 'dead' && e.a === b.id));
  const y = b.y;
  for (let i = 0; i < 100; i++) w.step();
  assert.equal(b.y, y);
  assert.ok(w.settled());
  // side lines too
  const w2 = createWorld(stub(), rand());
  const c = w2.add(boule(0.1, 5));
  c.state = 'rolling'; c.vx = -3; c.wy = 3 / c.r;
  simulate(w2);
  assert.equal(c.dead, true);
});

test('clone is independent and never writes divots', () => {
  let divots = 0;
  const t = stub();
  t.addDivot = () => { divots++; };
  const w = createWorld(t, mulberry32(5));
  const b = launch(w.add(boule(2, 1)), { yaw: 0, speed: 6, loft: 0.6, backspin: 0, sidespin: 0 });
  b.state = 'airborne';
  const c = w.clone(undefined, mulberry32(5));
  simulate(c);
  assert.equal(divots, 0);
  assert.equal(w.bodies[0].y, 1);
  assert.notEqual(c.bodies[0], w.bodies[0]);
  assert.ok(c.bodies[0].y > 3);
  simulate(w);
  assert.ok(divots > 0);
  assert.equal(w.bodies[0].y.toFixed(6), c.bodies[0].y.toFixed(6));
});

test('simulate settles within 20 s on seeded terrain', () => {
  const terrain = createTerrain(11);
  const w = createWorld(terrain, mulberry32(2));
  for (let i = 0; i < 4; i++) w.add(boule(1.5 + i * 0.3, 8 + i * 0.2));
  const b = w.add(boule(0, 0));
  launch(b, { yaw: 0, speed: 7, loft: 0.5, backspin: 20, sidespin: 5 });
  const t0 = w.t;
  simulate(w, 20);
  assert.ok(w.settled());
  assert.ok(w.t - t0 < 20);
});

test('100 random throws never produce NaN', () => {
  const terrain = createTerrain(21);
  const rnd = mulberry32(99);
  for (let i = 0; i < 100; i++) {
    const w = createWorld(terrain.perceived(), mulberry32(i));
    w.add(boule(1 + rnd() * 2, 7 + rnd() * 2));
    w.add(createBody('jack', { x: 2, y: 8 }));
    const b = w.add(boule(2, 1));
    launch(b, {
      yaw: (rnd() - 0.5) * 0.4, speed: 2 + rnd() * 12, loft: rnd() * 1.3,
      backspin: rnd() * 200 - 20, sidespin: (rnd() - 0.5) * 60,
    });
    simulate(w, 20);
    assert.ok(w.bodies.every(finite), `throw ${i}`);
  }
});

// --- D06: out of bounds on every side, dead balls relocated beyond the far line ---
const rolling = (b, vx, vy) => {
  b.state = 'rolling'; b.vx = vx; b.vy = vy; b.wx = -vy / b.r; b.wy = vx / b.r;
  return b;
};

test('out on each side only once the whole ball is across the line', () => {
  const W = C.terrainW, L = C.terrainL, r = C.boule.r;
  const cases = [
    ['left', 0.3, 5, -1, 0], ['right', W - 0.3, 5, 1, 0],
    ['far', 2, L - 0.3, 0, 1], ['back', 2, 0.3, 0, -1],
  ];
  for (const [name, x, y, dx, dy] of cases) {
    const w = createWorld(stub(), rand());
    const b = rolling(w.add(boule(x, y)), dx * 2, dy * 2);
    let deadAt = null;
    for (let i = 0; i < 4000 && !b.dead; i++) {
      w.step();
      if (b.dead) deadAt = w.events.find((e) => e.type === 'dead');
    }
    assert.ok(b.dead, `${name} side goes dead`);
    // position at the moment it went out: just past the line by r (not earlier)
    const d = name === 'left' ? -deadAt.x : name === 'right' ? deadAt.x - W : name === 'far' ? deadAt.y - L : -deadAt.y;
    assert.ok(d > r && d < r + 0.02, `${name}: out at ${d.toFixed(4)} m past the line`);
    assert.ok(finite(b));
  }
  // straddling the line is still in play
  const w = createWorld(stub(), rand());
  const s = w.add(boule(-r + 0.001, 5));
  w.step();
  assert.equal(s.dead, false);
});

test('a ball rolling back past the line behind the circle goes dead', () => {
  const w = createWorld(stub(), rand());
  const b = w.add(boule(2, 0.4));
  b.state = 'rolling'; b.vy = -1.5; b.wx = 1.5 / b.r;
  simulate(w, 5);
  assert.ok(b.dead, `y=${b.y}`);
});

test('a ball rolling diagonally out a corner goes dead and is relocated', () => {
  for (const [x, y, vx, vy] of [[0.2, 0.2, -2, -2], [3.8, 14.8, 2, 2], [0.2, 14.8, -2, 2], [3.8, 0.2, 2, -2]]) {
    const w = createWorld(stub(), rand());
    const b = rolling(w.add(boule(x, y)), vx, vy);
    simulate(w, 5);
    assert.ok(b.dead && finite(b), `corner ${x},${y}`);
    assert.ok(b.y > C.terrainL, 'moved beyond the far line');
  }
});

test('nothing on the real terrain stops a ball crossing a line and going well beyond', () => {
  const t = createTerrain(7);
  const W = C.terrainW, L = C.terrainL;
  const dirs = [[-1, 0, 0.2, 7], [1, 0, W - 0.2, 7], [0, 1, 2, L - 0.2], [0, -1, 2, 0.2]];
  for (const [dx, dy, x, y] of dirs) {
    for (const seed of [1, 2, 3]) {
      const w = createWorld(t, mulberry32(seed));
      w.isClone = true;
      const b = rolling(w.add(boule(x, y)), dx * 3, dy * 3);
      // without the dead check, the ball must keep rolling out to 0.45 m past the line
      let crossed = 0;
      for (let i = 0; i < 2000 && !b.dead; i++) {
        w.step();
        if (!b.dead) crossed = Math.max(crossed, dx < 0 ? -b.x : dx > 0 ? b.x - W : dy > 0 ? b.y - L : -b.y);
      }
      assert.ok(b.dead, `dir ${dx},${dy} seed ${seed}`);
      assert.ok(crossed > 0, 'crossed the line before being marked');
    }
  }
  // sampling just beyond the padded grid is finite and stays continuous with the edge
  for (const [x, y] of [[-0.45, 5], [W + 0.45, 5], [2, L + 0.45], [2, -0.45], [-1, -1], [W + 1, L + 1]]) {
    const s = t.sample(x, y);
    assert.ok(Number.isFinite(s.h) && Number.isFinite(s.nx) && Math.abs(s.h) < 0.06 && s.nz > 0.99, `${x},${y}`);
  }
});

test('dead boules line up beyond the far line, spaced apart, in the order they died', () => {
  const w = createWorld(stub(), rand());
  const bs = [];
  for (let i = 0; i < 6; i++) {
    const b = w.add(boule(0.3, 3 + i * 0.5));
    rolling(b, -2, 0);
    bs.push(b);
    simulate(w, 3);
  }
  const jack = w.add(createBody('jack', { x: 3.7, y: 6 }));
  rolling(jack, 2, 0);
  simulate(w, 3);
  for (const b of bs) {
    assert.ok(b.dead && b.state === 'resting' && b.vx === 0 && b.wx === 0);
    assert.ok(b.y > C.terrainL && b.y < C.terrainL + 0.4 && b.x >= 0 && b.x <= C.terrainW);
    assert.equal(b.z, b.r); // resting on the (flat) ground
  }
  for (let i = 1; i < bs.length; i++) assert.ok(bs[i].x - bs[i - 1].x >= 0.0999, 'in order of death, ~0.1 m apart');
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) assert.ok(Math.hypot(bs[i].x - bs[j].x, bs[i].y - bs[j].y) > 2 * C.boule.r, 'no overlap');
  }
  assert.ok(jack.dead && jack.y === C.terrainL + 0.4 && jack.x === C.terrainW / 2);
  for (const b of bs) assert.ok(Math.hypot(b.x - jack.x, b.y - jack.y) > b.r + jack.r, 'jack spot is separate');
  const ev = w.events.filter((e) => e.type === 'dead');
  assert.equal(ev.length, 7);
  assert.ok(ev[0].x < 0 && Number.isFinite(ev[0].toX) && ev[0].toY > C.terrainL, 'event x/y is where it went out, plus the new spot');
});

test('dead bodies are skipped by collisions and clones keep slots', () => {
  const w = createWorld(stub(), rand());
  const dead = w.add(boule(0.3, 3));
  rolling(dead, -2, 0);
  simulate(w, 3);
  assert.ok(dead.dead);
  const live = w.add(boule(dead.x - 0.05, dead.y - 0.02)); // overlapping the dead one
  rolling(live, 0, 0.1);
  const before = { x: dead.x, y: dead.y };
  const hits = w.events.length;
  for (let i = 0; i < 60; i++) w.step();
  assert.deepEqual({ x: dead.x, y: dead.y }, before);
  assert.ok(!w.events.slice(hits).some((e) => e.type === 'hit'));
  const c = w.clone();
  const n = c.add(boule(0.3, 5));
  rolling(n, -2, 0);
  simulate(c, 3);
  assert.ok(n.dead && n.x > dead.x + 0.0999, 'clone continues the line');
});
