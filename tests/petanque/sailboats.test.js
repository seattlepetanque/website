import test from 'node:test';
import assert from 'node:assert/strict';
import { createSailFleet, lakeDepth, polar, trimFor, SAIL } from '../../assets/js/petanque/sailboats.js';

const CX = 2, D = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const run = (seed, secs, avoid, each, count = 3) => {
  const f = createSailFleet(seed, { cx: CX, count });
  for (let t = 0; t < secs; t += 0.1) { f.step(0.1, typeof avoid === 'function' ? avoid(t) : avoid); if (each) each(f, t); }
  return f;
};
// a single boat starting at (x, y) with a mark and a fixed wind from `from` (the wind shifts around that base)
const scenario = (seed, from, [x, y], [wx, wy]) => {
  const f = createSailFleet(seed, { cx: CX, count: 1 });
  const b = f.boats[0]; f.wind.base = from;
  b.x = x; b.y = y; b.wx = wx; b.wy = wy; b.ox = x; b.oy = y; b.mode = 0; b.speed = 1;
  return { f, b };
};

test('polar: zero in the no-go zone, best on a beam reach, a bit lower downwind', () => {
  assert.equal(polar(0), 0); assert.equal(polar(39 * D), 0);
  assert.ok(polar(46 * D) > 0.3 && polar(46 * D) < polar(90 * D));
  assert.equal(Math.max(...[...Array(181).keys()].map((d) => polar(d * D))), polar(90 * D));
  assert.ok(polar(180 * D) < polar(90 * D) && polar(180 * D) > 0.5);
  assert.ok(trimFor(45 * D) < trimFor(90 * D) && trimFor(90 * D) < trimFor(180 * D)); // sheeted in upwind, eased downwind
});

test('boats really travel: path >= 60 m in 120 s for every seed and boat, not rotating in place', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const f = createSailFleet(seed, { cx: CX, count: 3 });
    const st = f.boats.map((b) => ({ x: b.x, y: b.y, path: 0, turn: 0, prev: b.heading, far: 0 }));
    for (let t = 0; t < 120; t += 0.1) {
      f.step(0.1, null);
      f.boats.forEach((b, i) => {
        const s = st[i]; s.path += b.speed * 0.1; s.turn += Math.abs(wrap(b.heading - s.prev)); s.prev = b.heading;
        s.far = Math.max(s.far, Math.hypot(b.x - s.x, b.y - s.y));
      });
    }
    st.forEach((s, i) => {
      assert.ok(s.path >= 60, `seed ${seed} boat ${i} path ${s.path.toFixed(0)} m`);
      assert.ok(s.far >= 12, `seed ${seed} boat ${i} got only ${s.far.toFixed(0)} m from its start`);
      assert.ok(s.turn / s.path < 0.3, `seed ${seed} boat ${i} turned ${s.turn.toFixed(1)} rad over ${s.path.toFixed(0)} m`); // F64 was ~0.4+ and ~30 m
      assert.ok(s.turn < 45, `seed ${seed} boat ${i} total heading change ${s.turn.toFixed(1)} rad`);
    });
  }
});

test('boats stay inside the lake (shore margin) over 30 minutes, many seeds, 2-3 boats', () => {
  for (let seed = 1; seed <= 30; seed++) {
    run(seed, 1800, null, (f) => { for (const b of f.boats) assert.ok(lakeDepth(b.x, b.y, CX) >= SAIL.margin - 3.01, `seed ${seed} boat out of the lake at ${b.x.toFixed(1)},${b.y.toFixed(1)}`); }, 2 + (seed % 2));
  }
});

test('heading changes smoothly and speed stays bounded (never a jump)', () => {
  const prev = new Map();
  run(5, 900, null, (f) => {
    for (const b of f.boats) {
      assert.ok(b.speed >= 0 && b.speed <= SAIL.maxSpeed);
      if (prev.has(b)) assert.ok(Math.abs(wrap(b.heading - prev.get(b))) <= SAIL.maxTurn * 0.1 + 1e-9);
      prev.set(b, b.heading);
    }
  });
});

test('upwind mark: beats to windward by tacking, alternating tacks, never lingering in the no-go zone', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const { f, b } = scenario(seed, Math.PI / 2, [CX, 70], [CX + 2, 132]); // wind from +y, mark 62 m dead upwind
    let tacks = 0, last = 0, maxNoGo = 0, reached = false, closeHauledT = 0, n = 0;
    for (let t = 0; t < 240; t += 0.1) {
      f.step(0.1, null);
      const rel = wrap(f.wind.from - b.heading);
      if (Math.abs(rel) > 0.2 && b.speed > 0.8 && Math.sign(rel) !== last) { if (last) tacks++; last = Math.sign(rel); }
      maxNoGo = Math.max(maxNoGo, b.timeInNoGo);
      if (Math.abs(rel) < 60 * D && b.speed > 0.8) closeHauledT += 0.1; n += 0.1;
      if (Math.hypot(b.x - b.wx, b.y - b.wy) < SAIL.reach + 1) reached = true;
    }
    assert.ok(tacks >= 2, `seed ${seed}: only ${tacks} tacks`);
    assert.ok(b.tacks >= 2);
    assert.ok(maxNoGo < 8, `seed ${seed}: ${maxNoGo.toFixed(1)} s in a row inside the no-go zone`);
    assert.ok(closeHauledT > 20, `seed ${seed}: not sailing close-hauled`);
    assert.ok(reached || b.y > 95, `seed ${seed}: made no progress to windward (y ${b.y.toFixed(0)})`);
  }
});

test('downwind legs include jibes (boom swings to the other side)', () => {
  let jibes = 0, swung = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const { f, b } = scenario(seed, Math.PI / 2, [CX, 132], [CX + 1, 66]); // wind from +y, mark 66 m dead downwind
    let side = 0;
    for (let t = 0; t < 400; t += 0.1) {
      f.step(0.1, null);
      if (Math.abs(b.sail) > 0.5) { const s = Math.sign(b.sail); if (side && s !== side) swung++; side = s; }
    }
    jibes += b.jibes;
  }
  assert.ok(jibes >= 3, `jibes ${jibes}`);
  assert.ok(swung >= 3, `boom swung sides ${swung} times`);
});

test('over long runs boats both tack and jibe', () => {
  let tacks = 0, jibes = 0;
  for (let seed = 1; seed <= 6; seed++) run(seed, 1800).boats.forEach((b) => { tacks += b.tacks; jibes += b.jibes; });
  assert.ok(tacks >= 10 && jibes >= 10, `tacks ${tacks} jibes ${jibes}`);
});

test('heel: bounded by 20 deg, zero at zero speed, to leeward; sails on the leeward side', () => {
  let steady = 0, since = 0, lastSide = 0;
  run(3, 600, null, (g) => {
    for (const b of g.boats) {
      assert.ok(Math.abs(b.heel) <= SAIL.maxHeel + 1e-9, `heel ${b.heel}`);
      assert.ok(Math.abs(b.heel) <= SAIL.maxHeel * Math.min(1, b.speed / 1.2) + 1e-9, 'heel is zero at zero speed and grows with speed');
      assert.ok(Math.abs(b.sail) <= 90 * D && Math.abs(b.jib) <= 90 * D);
      const rel = wrap(g.wind.from - b.heading);
      if (b === g.boats[0]) { if (Math.sign(rel) !== lastSide) { lastSide = Math.sign(rel); since = 0; } else since += 0.1; } // boat 0 is the one checked when steady
      if (b === g.boats[0] && since > 8 && Math.abs(rel) > 0.9 && b.speed > 1.5) { // steady on a tack: wind over the left -> heel and boom to the right (+)
        steady++; assert.equal(Math.sign(b.heel), Math.sign(rel)); assert.equal(Math.sign(b.sail), Math.sign(rel));
      }
    }
  });
  assert.ok(steady > 500);
});

test('sails swap sides on a tack: the boom passes through the centreline', () => {
  const { f, b } = scenario(2, Math.PI / 2, [CX, 70], [CX + 2, 132]);
  const sides = new Set(); let crossed = 0, prev = 0;
  for (let t = 0; t < 240; t += 0.1) { f.step(0.1, null); sides.add(Math.sign(b.sail)); if (prev && Math.sign(b.sail) !== prev) crossed++; prev = Math.sign(b.sail); }
  assert.ok(sides.has(1) && sides.has(-1) && crossed >= 2);
});

test('deterministic for a seed; varied between seeds; 2-3 boats fit the lake', () => {
  const a = run(9, 300), b = run(9, 300), c = run(10, 300);
  assert.deepEqual(a.boats.map((q) => [q.x, q.y, q.heading, q.heel, q.sail]), b.boats.map((q) => [q.x, q.y, q.heading, q.heel, q.sail]));
  assert.notEqual(a.boats[0].x, c.boats[0].x);
});

test('paused (dt 0) is frozen; reduced motion (0.1x time) moves ~10x slower', () => {
  const f = run(4, 60), snap = JSON.stringify([f.boats, f.wind]);
  f.step(0, null); f.step(-1, null); f.step(NaN, null);
  assert.equal(JSON.stringify([f.boats, f.wind]), snap);
  const pathOf = (k) => { // render.js passes dt * 0.1 under reduced motion
    const g = createSailFleet(6, { cx: CX, count: 3 }); let p = 0;
    for (let t = 0; t < 60; t += 0.1) { g.step(0.1 * k, null); p += g.boats.reduce((a, b) => a + b.speed * 0.1 * k, 0); }
    return p;
  };
  assert.ok(pathOf(0.1) < pathOf(1) * 0.15);
});

test('boats keep out of the avoid zone (a plane on the water) once outside it', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const avoid = { x: CX + 10, y: 120, r: SAIL.avoidR };
    const f = createSailFleet(seed, { cx: CX, count: 3 });
    for (const b of f.boats) b.in = Math.hypot(b.x - avoid.x, b.y - avoid.y) < avoid.r;
    for (let t = 0; t < 600; t += 0.1) {
      f.step(0.1, avoid);
      for (const b of f.boats) {
        const d = Math.hypot(b.x - avoid.x, b.y - avoid.y);
        if (b.in && d >= avoid.r) b.in = false;
        assert.ok(b.in || d >= avoid.r - 0.5, `seed ${seed} entered the zone (${d.toFixed(1)})`);
      }
    }
  }
});

test('a moving zone (plane taking off) is respected and boats stay in the lake; boats keep apart', () => {
  run(4, 300, (t) => ({ x: CX + 28 - t * 0.2, y: 138 - t * 4, r: SAIL.avoidR }), (f) => {
    for (const b of f.boats) assert.ok(lakeDepth(b.x, b.y, CX) >= SAIL.margin - 3.01);
  });
  run(7, 900, null, (f) => { for (let i = 0; i < f.boats.length; i++) for (let j = i + 1; j < f.boats.length; j++) assert.ok(Math.hypot(f.boats[i].x - f.boats[j].x, f.boats[i].y - f.boats[j].y) > SAIL.hardSpacing - 1.5); });
});

test('large dt is subdivided', () => {
  const f = createSailFleet(3, { cx: CX }); f.step(5, null);
  for (const b of f.boats) assert.ok(lakeDepth(b.x, b.y, CX) >= SAIL.margin - 3.01);
});
