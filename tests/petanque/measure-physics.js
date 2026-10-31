// Measurement script for B16 physics realism: node tests/petanque/measure-physics.js
import { C } from '../../assets/js/petanque/constants.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createBody, launch, createWorld, simulate } from '../../assets/js/petanque/physics.js';

const flat = () => {
  const s = { h: 0, nx: 0, ny: 0, nz: 1, friction: 0.2, loose: 0.3 };
  return { sample: () => s, stonesNear: () => [], addDivot() {}, resetDivots() {}, visibleStones: () => [], perceived() { return this; } };
};

export function throwOnce(terrain, kind, p, seed) {
  terrain.resetDivots();
  const w = createWorld(terrain, mulberry32(seed));
  const b = launch(createBody(kind, { team: 0 }), p);
  w.add(b);
  simulate(w, 20);
  return { w, b, land: w.events.find((e) => e.type === 'land') };
}
const tune = (kind, base, d) => { // speed so a flat throw rests d m from circle
  let lo = 2, hi = 18;
  for (let i = 0; i < 25; i++) {
    const m = (lo + hi) / 2;
    const { b } = throwOnce(flat(), kind, { ...base, speed: m }, 1);
    if (b.y - C.throwFrom.y < d) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
};
export function spread(kind, base, d = 8, nT = 4, nS = 30, mod = (t) => t) {
  const sp = tune(kind, base, d);
  const pts = [];
  for (let t = 1; t <= nT; t++) {
    const terr = mod(createTerrain(t));
    for (let s = 1; s <= nS; s++) { const { b } = throwOnce(terr, kind, { ...base, speed: sp }, s); pts.push([b.x, b.y]); }
  }
  // spread per terrain, averaged
  let tot = 0;
  for (let t = 0; t < nT; t++) {
    const g = pts.slice(t * nS, (t + 1) * nS);
    const mx = g.reduce((a, p) => a + p[0], 0) / nS, my = g.reduce((a, p) => a + p[1], 0) / nS;
    tot += Math.sqrt(g.reduce((a, p) => a + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / nS);
  }
  return tot / nT;
}
// Shooter descending at ~45 deg strikes a resting boule in the air (contact `dz` above the target centre)
export function tir(backspin, seed = 1, terr = flat(), dz = 0.03, speed = 8) {
  const w = createWorld(terr, mulberry32(seed));
  const target = w.add(createBody('boule', { x: 2, y: 8, team: 1 }));
  const sh = w.add(createBody('boule', { x: 2, y: 0, team: 0 }));
  const R = 0.075, dy = Math.sqrt(R * R - dz * dz) + 0.002;
  const gz = w.terrain.sample(2, 8 - dy).h;
  sh.x = 2; sh.y = 8 - dy; sh.z = target.z + dz + 0.002; sh.state = 'airborne';
  sh.vy = speed * Math.SQRT1_2; sh.vz = -speed * Math.SQRT1_2; sh.wx = backspin;
  const ix = sh.x, iy = sh.y;
  simulate(w, 20);
  return { targetMove: target.dead ? 9 : Math.hypot(target.x - 2, target.y - 8), shooterFromImpact: Math.hypot(sh.x - ix, sh.y - (8 - 0.07)), shooterDead: sh.dead, sy: sh.y };
}
export function reverse(backspin, terr, seed = 1, speed = 8, loft = 1.0) {
  const { b, land } = throwOnce(terr, 'boule', { yaw: 0, speed, loft, backspin, sidespin: 0 }, seed);
  if (b.dead) return -9;
  if (!land) return -9;
  return land.y - b.y; // positive = rolled backwards
}
export function plombee(backspin, terr, seed = 1) {
  const { b, land } = throwOnce(terr, 'boule', { yaw: 0, speed: 9, loft: 1.25, backspin, sidespin: 0 }, seed);
  return Math.hypot(b.x - land.x, b.y - land.y);
}

export const noStones = (t) => ({ ...t, stonesNear: () => [] });
if (process.argv[1] && process.argv[1].endsWith('measure-physics.js')) {
  const f = (v) => v.toFixed(2);
  const t0 = performance.now();
  console.log('spread demi no-stones', f(spread('boule', { yaw: 0, loft: 0.6, backspin: 55, sidespin: 0 }, 8, 4, 30, noStones)));
  console.log('spread demi 8m boule', f(spread('boule', { yaw: 0, loft: 0.6, backspin: 55, sidespin: 0 })));
  console.log('spread roulette 8m boule', f(spread('boule', { yaw: 0, loft: 0.21, backspin: 15, sidespin: 0 })));
  console.log('spread jack 8m', f(spread('jack', { yaw: 0, loft: 0.6, backspin: 20, sidespin: 0 })));
  for (const bs of [0, 40, 60, 80]) {
    for (const dz of [0.0, 0.03, 0.05]) {
      const r = tir(bs, 1, flat(), dz);
      console.log('tir air-hit flat bs', bs, 'dz', dz, 'target moved', f(r.targetMove), 'shooter from impact', f(r.shooterFromImpact), 'dead', r.shooterDead);
    }
  }
  for (const bs of [40, 60, 80]) {
    const rs = [1, 2, 3, 4, 5, 6].map((s) => tir(bs, s, createTerrain(s), 0.03));
    console.log('tir air-hit gravel bs', bs, rs.map((r) => r && `${f(r.targetMove)}/${f(r.shooterFromImpact)}`).join(' '));
  }
  for (const bs of [0, 50, 100, 150]) {
    let m = -9, mf = -9;
    for (const sp of [5, 7, 9, 11]) for (const lf of [0.6, 1.0, 1.3]) {
      mf = Math.max(mf, reverse(bs, flat(), 1, sp, lf));
      for (let t = 1; t <= 4; t++) for (let s = 1; s <= 4; s++) m = Math.max(m, reverse(bs, createTerrain(t), s, sp, lf));
    }
    console.log('max reverse roll bs', bs, 'gravel', f(m), 'flat', f(mf));
  }
  for (const bs of [40, 60, 80, 120]) {
    let m = 0, mx = 0, n = 0;
    for (let t = 1; t <= 5; t++) for (let s = 1; s <= 8; s++) { const d = plombee(bs, createTerrain(t), s); m += d; mx = Math.max(mx, d); n++; }
    console.log('plombee bs', bs, 'mean', f(m / n), 'max', f(mx), 'flat', f(plombee(bs, flat())));
  }
  console.log('ms', Math.round(performance.now() - t0));
}
