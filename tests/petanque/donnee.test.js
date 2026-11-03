import test from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../../assets/js/petanque/constants.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createBody, launch, createWorld, simulate } from '../../assets/js/petanque/physics.js';
import {
  LOFT_MIN, LOFT_MAX, styleForLoft, backspinForLoft, solveLaunch, SKILL, difficultyScale, coneFor,
  executeThrow, arcPath, coneEnvelope, predictRoll, releaseHeight, releaseFrom, snapAim, SNAP_SHORT,
  fitToBudget, effortFor, energyFor, energyPenalty, roughness,
} from '../../assets/js/petanque/donnee.js';

const DEG = Math.PI / 180;
const flat = {
  sample: () => ({ h: 0, nx: 0, ny: 0, nz: 1, friction: 0.14, loose: 0 }),
  stonesNear: () => [], addDivot() {}, resetDivots() {}, visibleStones: () => [], perceived() { return this; },
};
const from = C.throwFrom;

// Throw a boule with the given params; returns { w, b, land }
function run(terrain, p, seed = 1) {
  const w = createWorld(terrain, mulberry32(seed));
  const b = launch(createBody('boule', { team: 0 }), p);
  w.add(b);
  b.state = 'airborne';
  simulate(w);
  return { w, b, land: w.events.find((e) => e.type === 'land') };
}

test('styleForLoft names the styles', () => {
  assert.equal(styleForLoft(12 * DEG), 'roulette');
  assert.equal(styleForLoft(35 * DEG), 'demi-portee');
  assert.equal(styleForLoft(60 * DEG), 'plombee');
  assert.equal(styleForLoft(60 * DEG, true), 'tir');
  assert.ok(LOFT_MIN < LOFT_MAX);
});

test('solveLaunch lands on the donnée within 2 cm (flat and seeded terrain)', () => {
  // Height only (stones hidden): every throw lands within 2 cm. With stones, a pebble or rock right at the
  // donnée can deflect the real ball, so most (not all) throws land within 2 cm.
  const bare = (t) => ({ ...t, sample: (x, y) => t.sample(x, y), stonesNear: () => [] });
  let n = 0, ok = 0;
  for (const base of [flat, createTerrain(3), createTerrain(11)]) {
    for (const terrain of [bare(base), base]) {
      for (const dist of [3, 5, 7.5, 10, 12]) {
        for (const deg of [8, 12, 20, 35, 50, 60, 75]) {
          const landing = { x: 2 + dist * 0.05, y: 1 + dist };
          const p = solveLaunch({ from, landing, loft: deg * DEG, terrain });
          const w = createWorld(terrain, mulberry32(1));
          const b = launch(createBody('boule', { team: 0 }), p);
          w.add(b);
          b.state = 'airborne';
          while (b.state === 'airborne' && !w.events.length && w.t < 5) w.step();
          const err = Math.hypot(b.x - landing.x, b.y - landing.y);
          if (terrain === base) { n++; if (err < 0.02) ok++; } else {
            assert.ok(err < 0.02, `dist ${dist} loft ${deg}: error ${err}`);
          }
        }
      }
    }
  }
  assert.ok(ok / n > 0.9, `${ok}/${n} within 2 cm with stones`);
});

test('solveLaunch yaw: 0 along +y, positive toward +x', () => {
  const a = solveLaunch({ from, landing: { x: 2, y: 8 }, loft: 40 * DEG, terrain: flat });
  const b = solveLaunch({ from, landing: { x: 3, y: 8 }, loft: 40 * DEG, terrain: flat });
  const c = solveLaunch({ from, landing: { x: 1, y: 8 }, loft: 40 * DEG, terrain: flat });
  assert.ok(Math.abs(a.yaw) < 1e-9 && b.yaw > 0 && c.yaw < 0);
  assert.equal(a.sidespin, 0);
});

test('solveLaunch is fast', () => {
  const t0 = performance.now();
  const n = 100;
  for (let i = 0; i < n; i++) solveLaunch({ from, landing: { x: 2, y: 4 + i * 0.07 }, loft: (10 + i * 0.6) * DEG, terrain: flat });
  assert.ok((performance.now() - t0) / n < 5, 'solve under 5 ms');
});

test('backspin is monotonic in loft, finite and non-negative', () => {
  let prev = -1;
  for (let d = 8; d <= 75; d += 0.5) {
    const s = backspinForLoft(d * DEG);
    assert.ok(Number.isFinite(s) && s >= 0);
    assert.ok(s >= prev, `loft ${d}`);
    prev = s;
  }
  assert.ok(backspinForLoft(75 * DEG) > backspinForLoft(8 * DEG));
});

test('roll-out by style on flat terrain: roulette runs, demi moderate, plombée checks', () => {
  for (const dist of [4, 5]) {
    const landing = { x: 2, y: 1 + dist };
    const roll = (deg) => {
      const { b, land } = run(flat, solveLaunch({ from, landing, loft: deg * DEG, terrain: flat }));
      return { rolled: b.y - land.y, fromDonnee: b.y - landing.y };
    };
    const rou = roll(12), demi = roll(35), plo = roll(60);
    assert.ok(rou.rolled > 1.5 * dist, `roulette rolled ${rou.rolled} from ${dist} m`);
    assert.ok(demi.rolled > 0.5 && demi.rolled < rou.rolled, `demi rolled ${demi.rolled}`);
    assert.ok(Math.abs(plo.fromDonnee) < 0.4, `plombée ended ${plo.fromDonnee} from the donnée`);
  }
  // plombée and steeper at 8 m stay tame; no loft rolls backward more than the reverse cap
  const landing = { x: 2, y: 9 };
  for (const deg of [60, 75]) {
    const { b } = run(flat, solveLaunch({ from, landing, loft: deg * DEG, terrain: flat }));
    assert.ok(b.y - landing.y > -0.25 && b.y - landing.y < 0.7, `loft ${deg} ended ${b.y - landing.y}`);
  }
});

test('coneFor grows with distance and loft; skills and difficulty', () => {
  const near = coneFor({ skill: SKILL.human, from, landing: { x: 2, y: 5 }, loft: 20 * DEG });
  const far = coneFor({ skill: SKILL.human, from, landing: { x: 2, y: 11 }, loft: 20 * DEG });
  const high = coneFor({ skill: SKILL.human, from, landing: { x: 2, y: 11 }, loft: 75 * DEG });
  assert.ok(far.sigmaLat > near.sigmaLat && far.sigmaLong > near.sigmaLong);
  assert.ok(high.sigmaLong > far.sigmaLong);
  // human at 10 m: lateral 1.2%, longitudinal 3% rising to 5% at 75 degrees
  const h8 = coneFor({ skill: SKILL.human, from, landing: { x: 2, y: 11 }, loft: LOFT_MIN });
  assert.ok(Math.abs(h8.sigmaLat - 0.12) < 1e-9 && Math.abs(h8.sigmaLong - 0.3) < 1e-9);
  assert.ok(Math.abs(high.sigmaLong - 0.3 * 1.85) < 1e-9);
  assert.ok(Math.abs(h8.sigmaLoft - 1.5 * DEG) < 1e-9);
  assert.ok(SKILL.marcel.long < SKILL.human.long && SKILL.odette.lat < SKILL.human.lat);
  assert.ok(SKILL.pierre.lat > SKILL.odette.lat);
  assert.ok(difficultyScale.easy > difficultyScale.medium && difficultyScale.hard < difficultyScale.medium);
});

test('executeThrow samples match the cone sigmas and are deterministic', () => {
  const landing = { x: 2, y: 9 }, loft = 40 * DEG;
  const cone = coneFor({ skill: SKILL.human, from, landing, loft });
  const rand = mulberry32(42);
  const N = 1500;
  let sl = 0, sg = 0, ml = 0, mg = 0;
  for (let i = 0; i < N; i++) {
    const r = executeThrow({ from, landing, loft, cone, terrain: flat, rand });
    const dx = r.actualLanding.x - landing.x, dy = r.actualLanding.y - landing.y;
    // throw along +y: lateral is x, longitudinal is y
    assert.ok(Math.abs(r.lateralError - dx) < 1e-9);
    sl += dx * dx; sg += dy * dy; ml += dx; mg += dy;
  }
  assert.ok(Math.abs(Math.sqrt(sl / N) / cone.sigmaLat - 1) < 0.1);
  assert.ok(Math.abs(Math.sqrt(sg / N) / cone.sigmaLong - 1) < 0.1);
  assert.ok(Math.abs(ml / N) < 0.15 * cone.sigmaLat && Math.abs(mg / N) < 0.15 * cone.sigmaLong);
  const a = executeThrow({ from, landing, loft, cone, terrain: flat, rand: mulberry32(7) });
  const b = executeThrow({ from, landing, loft, cone, terrain: flat, rand: mulberry32(7) });
  assert.deepEqual(a, b);
});

test('executeThrow lands on the sampled spot and curls with sidespin toward the error side', () => {
  const landing = { x: 2, y: 8 }, loft = 35 * DEG;
  const cone = coneFor({ skill: SKILL.human, from, landing, loft });
  const rand = mulberry32(9);
  for (let i = 0; i < 20; i++) {
    const r = executeThrow({ from, landing, loft, cone, terrain: flat, rand });
    const { land } = run(flat, r.throwParams);
    assert.ok(Math.hypot(land.x - r.actualLanding.x, land.y - r.actualLanding.y) < 0.02);
    assert.ok(Math.abs(r.throwParams.sidespin) <= 40);
    // off to the right (+x) means positive sidespin
    assert.ok(r.lateralError === 0 || Math.sign(r.throwParams.sidespin) === Math.sign(r.lateralError));
  }
  // physics: positive sidespin kicks the rolling ball toward +x when throwing along +y
  const base = solveLaunch({ from, landing, loft, terrain: flat });
  const xs = [-20, 0, 20].map((s) => { const { b, land } = run(flat, { ...base, sidespin: s }); return b.x - land.x; });
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], `sidespin drift ${xs}`);
});

test('arcPath and coneEnvelope are finite and shaped right', () => {
  for (const terrain of [flat, createTerrain(5)]) {
    const landing = { x: 2.5, y: 9 }, loft = 45 * DEG;
    const cone = coneFor({ skill: SKILL.human, from, landing, loft });
    const p = solveLaunch({ from, landing, loft, terrain });
    const arc = arcPath(from, p, 40, terrain);
    assert.equal(arc.length, 41);
    assert.ok(Math.abs(arc[0].z - from.z) < 1e-9);
    assert.ok(Math.hypot(arc[40].x - landing.x, arc[40].y - landing.y) < 0.02);
    assert.ok(arc.some((q) => q.z > 2));
    const env = coneEnvelope({ from, landing, loft, cone, terrain });
    assert.equal(env.edges.length, 4);
    for (const path of [env.center, ...env.edges, env.ellipse1, env.ellipse2]) {
      assert.ok(path.length > 10);
      for (const q of path) assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z));
    }
    // ellipses sit 1 cm above the ground and 2 sigma is twice the size of 1 sigma
    for (const q of env.ellipse1) assert.ok(Math.abs(q.z - terrain.sample(q.x, q.y).h - 0.01) < 1e-9);
    const span = (e) => Math.max(...e.map((q) => q.y)) - Math.min(...e.map((q) => q.y));
    assert.ok(Math.abs(span(env.ellipse2) / span(env.ellipse1) - 2) < 0.05);
    // lateral edges end sigmaLat to either side of the centre
    const e0 = env.edges[0][40], e1 = env.edges[1][40];
    assert.ok(Math.abs((e0.x - e1.x) - 2 * cone.sigmaLat * Math.cos(Math.atan2(0.5, 8))) < 0.02);
  }
});

test('predictRoll ends where a real noiseless sim does', () => {
  const terrain = createTerrain(4);
  const world = createWorld(terrain, mulberry32(3));
  const other = createBody('boule', { x: 2.3, y: 9, team: 1 });
  world.add(other);
  for (const deg of [35, 60]) {
    const p = solveLaunch({ from, landing: { x: 2, y: 8 }, loft: deg * DEG, terrain: terrain.perceived() });
    const path = predictRoll({ world, terrain, throwParams: p });
    assert.ok(path.length > 5);
    for (const q of path) assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z));
    // reference: same clone, same rng seed the function uses internally is private, so compare against
    // a replay with an rng-free landing (landTilt noise is the only difference): within a loose tolerance
    const w2 = world.clone(terrain.perceived(), mulberry32(1));
    const b = launch(createBody('boule', { team: -1 }), p);
    w2.add(b); b.state = 'airborne'; simulate(w2);
    const end = path[path.length - 1];
    assert.ok(Math.hypot(end.x - b.x, end.y - b.y) < 0.6, `loft ${deg}: ${end.x},${end.y} vs ${b.x},${b.y}`);
    // the real world was not touched
    assert.equal(world.bodies.length, 1);
    assert.equal(other.state, 'resting');
  }
  // with a fixed rand the prediction is identical to a manual run
  const p = solveLaunch({ from, landing: { x: 2, y: 8 }, loft: 60 * DEG, terrain: terrain.perceived() }); // plombée: no roughness allowance
  const path = predictRoll({ world, terrain, throwParams: p, rand: mulberry32(1) });
  const w3 = world.clone(terrain.perceived(), mulberry32(1));
  const b3 = launch(createBody('boule', { team: -1 }), p);
  w3.add(b3); b3.state = 'airborne'; simulate(w3);
  const end = path[path.length - 1];
  assert.ok(Math.hypot(end.x - b3.x, end.y - b3.y) < 1e-6);
});

test('the drawn cone matches the sampled landings: ~39% inside the 1 sigma ellipse, ~86% inside 2 sigma', () => {
  const terrain = createTerrain(5), rand = mulberry32(11);
  for (const [d, deg] of [[8, 40], [6, 60], [10, 25]]) {
    const f = releaseFrom({ x: 2, y: 1 }, deg * DEG);
    const landing = { x: 2.3, y: 1 + d }, loft = deg * DEG;
    const cone = coneFor({ skill: SKILL.human, from: f, landing, loft });
    const a = Math.atan2(landing.x - f.x, landing.y - f.y);
    let in1 = 0, in2 = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const { throwParams } = executeThrow({ from: f, landing, loft, cone, terrain, rand });
      const path = arcPath(f, throwParams, 200, terrain), e = path[path.length - 1];
      const dx = e.x - landing.x, dy = e.y - landing.y;
      const lat = dx * Math.cos(a) - dy * Math.sin(a), lon = dx * Math.sin(a) + dy * Math.cos(a);
      const q = (lat / cone.sigmaLat) ** 2 + (lon / cone.sigmaLong) ** 2;
      if (q <= 1) in1++;
      if (q <= 4) in2++;
    }
    assert.ok(Math.abs(in1 / N - 0.393) < 0.07, `1 sigma ${in1 / N} at ${d} m ${deg} deg`);
    assert.ok(Math.abs(in2 / N - 0.865) < 0.06, `2 sigma ${in2 / N} at ${d} m ${deg} deg`);
  }
});

test('release height: low and crouched for low lofts, standing for lobs, smooth and monotonic', () => {
  assert.equal(releaseHeight(10 * DEG), 0.5);
  assert.equal(releaseHeight(40 * DEG), 0.9);
  let prev = 0;
  for (let d = 8; d <= 75; d += 0.5) {
    const z = releaseHeight(d * DEG);
    assert.ok(z >= prev - 1e-12 && z <= 0.9 + 1e-12);
    prev = z;
  }
  const f = releaseFrom({ x: 2, y: 1 }, 14 * DEG);
  assert.deepEqual([f.x, f.y], [2, 1]);
  // launch() follows the params' own release point, and executeThrow records it
  const rand = mulberry32(2);
  const landing = { x: 2, y: 4.5 }, loft = 14 * DEG;
  const cone = coneFor({ skill: SKILL.human, from: f, landing, loft });
  const { throwParams } = executeThrow({ from: f, landing, loft, cone, terrain: flat, rand });
  assert.equal(throwParams.from.z, f.z);
  assert.equal(launch(createBody('boule', { team: 0 }), throwParams).z, f.z);
});

test('roulettes thrown from the crouch land on their donnée and roll on well past it', () => {
  const terrain = createTerrain(7);
  for (const [dist, loftDeg] of [[3, 12], [3.5, 14]]) {
    const f = releaseFrom({ x: 2, y: 1 }, loftDeg * DEG);
    const p = solveLaunch({ from: f, landing: { x: 2, y: 1 + dist }, loft: loftDeg * DEG, terrain });
    const end = arcPath(f, p, 100, terrain).pop();
    assert.ok(Math.abs(end.y - 1 - dist) < 0.05, `flight ends ${end.y - 1} for donnée ${dist}`);
    const { b } = run(terrain, p);
    assert.ok(!b.dead && b.y - 1 > dist + 1.5 && b.y - 1 < 10, `rested ${b.y - 1} m for donnée ${dist}`);
  }
});

test('a tir aims just short of its target along the line', () => {
  const f = { x: 2, y: 1, z: 0.9 };
  const a = snapAim(f, { x: 2.5, y: 9 });
  assert.ok(Math.abs(Math.hypot(2.5 - a.x, 9 - a.y) - SNAP_SHORT) < 1e-9);
  assert.ok(a.y < 9);
  // very close target: never aims past the thrower
  const near = snapAim(f, { x: 2, y: 1.2 });
  assert.ok(near.y > 1);
});

test('fitToBudget clamps far high lobs and leaves easy throws alone', () => {
  const f = { x: 2, y: 1, z: 0.9 };
  const easy = fitToBudget({ from: f, landing: { x: 2, y: 8 }, loft: 32 * DEG, skill: SKILL.human, terrain: flat });
  assert.equal(easy.clamped, false);
  assert.deepEqual(easy.landing, { x: 2, y: 8 });
  const demi10 = fitToBudget({ from: f, landing: { x: 2, y: 11 }, loft: 32 * DEG, skill: SKILL.human, terrain: flat });
  assert.equal(demi10.clamped, false, 'a demi-portée to 10 m is comfortable');
  const lob = fitToBudget({ from: f, landing: { x: 2.5, y: 9 }, loft: 70 * DEG, skill: SKILL.human, terrain: flat });
  assert.equal(lob.clamped, true);
  const d = Math.hypot(lob.landing.x - f.x, lob.landing.y - f.y);
  assert.ok(d < 6 && d > 3, `70 degree lob reaches ${d}`);
  // slid along the aim line toward the thrower
  const cross = (lob.landing.x - f.x) * (9 - f.y) - (lob.landing.y - f.y) * (2.5 - f.x);
  assert.ok(Math.abs(cross) < 1e-6);
  const p60 = fitToBudget({ from: f, landing: { x: 2, y: 9 }, loft: 60 * DEG, skill: SKILL.human, terrain: flat });
  assert.ok(p60.landing.y - f.y > 7 && p60.landing.y - f.y < 9.2, '60 degrees reaches about 8 m');
});

test('energyFrac is within the budget after fitting, for every skill and loft', () => {
  const f = { x: 2, y: 1, z: 0.9 };
  for (const id of ['human', 'marcel', 'odette', 'pierre']) {
    for (const deg of [10, 20, 32, 45, 55, 65, 75]) {
      for (const d of [3, 7, 11]) {
        const r = fitToBudget({ from: f, landing: { x: 2, y: 1 + d }, loft: deg * DEG, skill: SKILL[id], terrain: flat });
        assert.ok(r.energyFrac <= 1 + 1e-9, `${id} ${deg} ${d}: ${r.energyFrac}`);
        const e = energyFor({ from: f, landing: r.landing, loft: deg * DEG, skill: SKILL[id], terrain: flat });
        assert.ok(e <= 1 + 0.01, `${id} ${deg} ${d}: recomputed ${e}`);
      }
    }
  }
  assert.ok(SKILL.odette.maxSpeed > SKILL.human.maxSpeed && SKILL.pierre.maxSpeed > SKILL.human.maxSpeed);
  assert.ok(SKILL.marcel.maxSpeed < SKILL.human.maxSpeed);
  assert.ok(effortFor(10, 70 * DEG) > effortFor(10, 32 * DEG));
});

test('cone grows with loft and with energyFrac', () => {
  const landing = { x: 2, y: 8 };
  const c = (loft, energyFrac) => coneFor({ skill: SKILL.human, from, landing, loft, energyFrac });
  const lo = c(20 * DEG, 0), hi = c(65 * DEG, 0);
  assert.ok(hi.sigmaLat > lo.sigmaLat && hi.sigmaLong > lo.sigmaLong);
  const same = c(20 * DEG), knee = c(20 * DEG, 0.7), mid = c(20 * DEG, 0.85), max = c(20 * DEG, 1);
  assert.deepEqual(same, lo);
  assert.deepEqual(knee, lo);
  assert.ok(mid.sigmaLong > lo.sigmaLong && max.sigmaLong > mid.sigmaLong && max.sigmaLat > mid.sigmaLat);
  assert.ok(Math.abs(max.sigmaLong / lo.sigmaLong - energyPenalty(1)) < 1e-9 && energyPenalty(1) > 1.5);
});

// D19: the roll guide (predictRoll) plans on the perceived terrain with the low-loft roughness allowance, so its
// predicted rest matches the mean real rest on seeded gravel (before: +1.7 m at 14 degrees, +0.3 m at 30)
test('predictRoll: predicted rest matches the mean real rest at 14 and 30 degrees; plombée unchanged', () => {
  const from = { x: 2, y: 1, z: 0.9 };
  const diff = {};
  for (const deg of [14, 30, 60]) {
    let sp = 0, sr = 0, n = 0;
    for (let ts = 0; ts < 8; ts++) {
      const terrain = createTerrain(100 + ts);
      for (const d of [4, 5.5, 7, 8.5]) {
        const tp = solveLaunch({ from, landing: { x: 2, y: 1 + d }, loft: deg * DEG, terrain: terrain.perceived() });
        const world = createWorld(terrain, mulberry32(ts * 7 + d));
        const pred = predictRoll({ world, terrain, throwParams: tp, from });
        let real = 0;
        const R = 6;
        for (let r = 0; r < R; r++) {
          terrain.resetDivots();
          const w = world.clone(terrain, mulberry32(r * 13 + ts));
          const b = launch(createBody('boule', { team: 1 }), tp, from);
          w.add(b);
          simulate(w, 20);
          real += (b.dead ? b.outY : b.y) / R;
        }
        sp += pred[pred.length - 1].y; sr += real; n++;
      }
    }
    diff[deg] = (sp - sr) / n;
  }
  assert.ok(Math.abs(diff[14]) < 0.3, `14 deg: predicted minus real ${diff[14].toFixed(2)} m`);
  assert.ok(Math.abs(diff[30]) < 0.3, `30 deg: predicted minus real ${diff[30].toFixed(2)} m`);
  // plombée: the same path as the plain perceived-terrain sim
  const terrain = createTerrain(100), world = createWorld(terrain, mulberry32(1));
  const tp = solveLaunch({ from, landing: { x: 2, y: 8 }, loft: 60 * DEG, terrain: terrain.perceived() });
  const a = predictRoll({ world, terrain, throwParams: tp, from, rand: mulberry32(1) });
  const w2 = world.clone(terrain.perceived(), mulberry32(1));
  const b2 = launch(createBody('boule', { team: -1 }), tp, from);
  w2.add(b2); b2.state = 'airborne'; simulate(w2);
  assert.ok(Math.hypot(a[a.length - 1].x - b2.x, a[a.length - 1].y - b2.y) < 1e-6);
  assert.ok(roughness(60 * DEG) === 1 && roughness(14 * DEG) === 2);
});
