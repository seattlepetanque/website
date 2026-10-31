// Monte Carlo AI: picks the five throw numbers by simulating candidates on a perceived clone of the world.
// A flat-terrain launch table gives first guesses, a noiseless refine sim corrects for slope and friction,
// then each candidate is scored over several noisy sims. The chosen throw gets noise too (the AI is human).
import { C } from './constants.js';
import { mulberry32, gauss } from './rng.js';
import { createBody, launch, createWorld, simulate } from './physics.js';
import { meneResult, boulesInHand, jackValid } from './rules.js';

// Tuning. Noise sigmas are for a 'medium' player at their best style; scaled by role and difficulty.
export const AI = {
  sims: { easy: 8, medium: 12, hard: 16 },
  noiseScale: { easy: 1.8, medium: 0.9, hard: 0.5 },
  // yaw (rad), speed (fraction), loft (rad), spin (fraction)
  noise: {
    roulette: { yaw: 0.008, speed: 0.02, loft: 0.02, spin: 0.15 },
    demi: { yaw: 0.009, speed: 0.022, loft: 0.025, spin: 0.15 },
    plombee: { yaw: 0.01, speed: 0.026, loft: 0.025, spin: 0.15 },
    tir: { yaw: 0.007, speed: 0.025, loft: 0.025, spin: 0.12 },
    jack: { yaw: 0.02, speed: 0.04, loft: 0.03, spin: 0.2 },
    jackLow: { yaw: 0.02, speed: 0.04, loft: 0.03, spin: 0.2 },
  },
  roleMult: { // [pointing styles, tir]
    pointeur: [1, 1.8],
    tireur: [1.5, 1],
  },
  shootBonus: { pointeur: 0, tireur: 0.15 }, // tireurs like a shot: added to the score of tir candidates
  maxSimSeconds: 14,
  refineSims: 4,
  refineIters: 2,
  riskAversion: 0.1,
  shootRange: 1, // shoot opponent boules this close to the jack
  tirShort: 0.08, // aim the landing this far short of the target (hit in the air or on the first hop: carreau)
  jackTarget: 8, // m from circle for the jack throw
};

export const STYLES = {
  roulette: { loft: 0.21, backspin: 15 },
  demi: { loft: 0.6, backspin: 55 },
  plombee: { loft: 1.25, backspin: 80 },
  tir: { loft: 0.55, backspin: 80 },
  jack: { loft: 1.1, backspin: 40 },
  jackLow: { loft: 0.6, backspin: 20 },
};
const FRENCH = { roulette: 'roule', demi: 'points a demi-portée', plombee: 'points a la plombée' };

const FROM = C.throwFrom;
const TABLE_D = [];
for (let d = 2; d <= 14.001; d += 0.5) TABLE_D.push(d);

// --- Launch table -------------------------------------------------------------------------

function flatStub() {
  const mu = (C.rollResistPacked + C.rollResistLoose) / 2;
  const s = { h: 0, nx: 0, ny: 0, nz: 1, friction: mu, loose: 0.5 };
  return {
    sample: () => s, stonesNear: () => [], addDivot() {}, resetDivots() {},
    visibleStones: () => [], perceived() { return this; },
  };
}

// Where a noiseless throw ends up: first landing point (landing=true) or resting spot
function flightEnd(world, kind, p, landing, maxSeconds) {
  const b = launch(createBody(kind, { team: -1 }), p);
  world.bodies.length = 0;
  world.events.length = 0;
  world.t = 0;
  world.add(b);
  if (landing) {
    let n = Math.ceil(maxSeconds / C.dt);
    while (n-- > 0 && !world.events.some((e) => e.type === 'land')) world.step();
    const e = world.events.find((ev) => ev.type === 'land');
    return e ? { x: e.x, y: e.y } : { x: b.x, y: b.y };
  }
  simulate(world, maxSeconds);
  return { x: b.x, y: b.y };
}

let tableCache = null;
export function resetLaunchTable() { tableCache = null; }
function getTable() {
  if (tableCache) return tableCache;
  const world = createWorld(flatStub(), () => 0.5);
  world.isClone = true;
  const table = {};
  for (const style of Object.keys(STYLES)) {
    const st = STYLES[style];
    const kind = style.startsWith('jack') ? 'jack' : 'boule';
    const landing = style === 'tir';
    const speeds = [];
    let lo = 1.5, hi = 20;
    for (const d of TABLE_D) {
      // speed is monotone in distance, so narrow the bracket as we go
      let a = Math.max(1.5, speeds.length ? speeds[speeds.length - 1] * 0.98 : lo), b = hi;
      for (let i = 0; i < 12; i++) {
        const mid = (a + b) / 2;
        const e = flightEnd(world, kind, { yaw: 0, speed: mid, loft: st.loft, backspin: st.backspin, sidespin: 0 }, landing, 12);
        if (e.y - FROM.y < d) a = mid; else b = mid;
      }
      speeds.push((a + b) / 2);
    }
    table[style] = speeds;
  }
  tableCache = table;
  return table;
}

export function launchSpeed(style, dist) {
  const sp = getTable()[style];
  if (dist <= TABLE_D[0]) return { speed: sp[0], slope: (sp[1] - sp[0]) / 0.5 };
  const f = Math.min((dist - TABLE_D[0]) / 0.5, TABLE_D.length - 1.0001);
  const i = Math.floor(f);
  const slope = (sp[i + 1] - sp[i]) / 0.5;
  return { speed: sp[i] + (f - i) * (sp[i + 1] - sp[i]), slope };
}

// --- Candidates ---------------------------------------------------------------------------

function baseThrow(style, tx, ty) {
  const dx = tx - FROM.x, dy = ty - FROM.y;
  const dist = Math.max(TABLE_D[0], Math.min(TABLE_D[TABLE_D.length - 1], Math.hypot(dx, dy)));
  const st = STYLES[style];
  const ls = launchSpeed(style, dist);
  return {
    p: { yaw: Math.atan2(dx, dy), speed: ls.speed, loft: st.loft, backspin: st.backspin, sidespin: 0 },
    slope: ls.slope, tx, ty, dist,
  };
}

// Correct yaw and speed using the mean of a few noiseless sims on a body-free copy of the perceived
// terrain (gravel makes single rolls chaotic, so a single sim would chase noise)
function refine(world, kind, style, base, rand) {
  const w = world.clone(world.terrain.perceived(), mulberry32(seedFrom(rand)));
  const landing = style === 'tir';
  const p = { ...base.p };
  for (let it = 0; it < AI.refineIters; it++) {
    let mx = 0, my = 0;
    for (let s = 0; s < AI.refineSims; s++) {
      const e = flightEnd(w, kind, p, landing, AI.maxSimSeconds);
      mx += e.x / AI.refineSims; my += e.y / AI.refineSims;
    }
    const ex = mx - base.tx, ey = my - base.ty;
    const ux = Math.sin(p.yaw), uy = Math.cos(p.yaw);
    const along = ex * ux + ey * uy;
    const lat = ex * uy - ey * ux;
    p.yaw -= lat / base.dist;
    const dv = along / Math.max(base.slope, 0.2);
    p.speed -= Math.max(-0.25 * p.speed, Math.min(0.25 * p.speed, dv));
  }
  return p;
}

function scaleFor(style, role, difficulty) {
  const rm = AI.roleMult[role] || AI.roleMult.pointeur;
  return (AI.noiseScale[difficulty] ?? AI.noiseScale.medium) * (style === 'tir' ? rm[1] : rm[0]);
}

function applyNoise(p, style, role, difficulty, rand) {
  const n = AI.noise[style], k = scaleFor(style, role, difficulty);
  return {
    yaw: p.yaw + gauss(rand) * n.yaw * k,
    speed: p.speed * (1 + gauss(rand) * n.speed * k),
    loft: Math.max(0.08, p.loft + gauss(rand) * n.loft * k),
    backspin: Math.max(0, p.backspin * (1 + gauss(rand) * n.spin * k)),
    sidespin: gauss(rand) * 2 * k,
  };
}

function seedFrom(rand) { return (rand() * 4294967296) >>> 0; }
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function liveBoules(world) { return world.bodies.filter((b) => b.kind === 'boule'); }
function theJack(world) { return world.bodies.find((b) => b.kind === 'jack'); }

function buildCandidates(world, match, player) {
  const jack = theJack(world);
  if (!jack || jack.dead) return [];
  const team = player.team, opp = 1 - team;
  const c = [];
  const pt = (style, dx, dy, tag) => c.push({ style, tx: jack.x + dx, ty: jack.y + dy, intent: 'point', tag });
  // pointing at the jack, plus offsets to get round blockers
  pt('roulette', 0, 0); pt('demi', 0, 0); pt('plombee', 0, 0);
  pt('roulette', 0.22, 0); pt('roulette', -0.22, 0);
  pt('demi', 0, -0.25); pt('plombee', 0, 0.25);
  // shots at opponent boules near the jack (closest first)
  const targets = liveBoules(world)
    .filter((b) => !b.dead && b.team === opp && dist2(b, jack) <= AI.shootRange)
    .sort((a, b) => dist2(a, jack) - dist2(b, jack)).slice(0, 2);
  for (const b of targets) c.push({ style: 'tir', tx: b.x, ty: b.y - AI.tirShort, intent: 'shoot', target: b, tag: 'boule' });
  // shoot the jack when the opponent holds 2+ points and we have boules after this one
  const res = meneResult(jack, liveBoules(world));
  if (!res.void && res.team === opp && res.points >= 2 && boulesInHand(match, team) > 1) {
    c.push({ style: 'tir', tx: jack.x, ty: jack.y, intent: 'shoot', target: jack, tag: 'jack' });
  }
  // keep within the field and the cap
  return c.filter((k) => k.ty < C.terrainL - 0.5 && k.ty > 2 && k.tx > 0.3 && k.tx < C.terrainW - 0.3).slice(0, 10);
}

// --- Evaluation ---------------------------------------------------------------------------

// Value of a settled state for `team`; handT/handO are boules still in hand after this throw
function evaluate(world, team, handT, handO, deadBefore) {
  const jack = theJack(world);
  const boules = liveBoules(world);
  if (!jack || jack.dead) {
    if (handT > 0 && handO > 0) return -1; // void mène: wasteful, not a disaster
    if (handT > 0) return handT * 0.8;
    if (handO > 0) return -4 - handO * 1.5; // opponent scores their boules
    return -1;
  }
  const res = meneResult(jack, boules);
  const near = (t) => Math.min(3, ...boules.filter((b) => !b.dead && b.team === t).map((b) => dist2(b, jack)));
  const dT = near(team), dO = near(1 - team);
  let v = 0;
  // A point is only worth what survives the other side's remaining boules: the further it is from
  // the jack and the more boules they hold, the likelier it is to be beaten
  const keep = (d, hand) => Math.max(0.05, 1 - hand * (0.08 + 0.18 * Math.min(d, 2)));
  if (!res.void) {
    if (res.team === team) v = res.points * keep(dT, handO) + (handO === 0 ? 0.3 : 0);
    else v = -res.points * keep(dO, handT) - (handT === 0 ? 0.3 : 0);
  }
  v += 0.5 * Math.max(-1, Math.min(1, dO - dT)); // margin
  v -= 0.3 * Math.min(dT, 2); // closeness of our best boule to the jack
  const deadNow = boules.filter((b) => b.dead && b.team === team).length;
  v -= 0.4 * Math.max(0, deadNow - deadBefore);
  v += 0.15 * boules.filter((b) => b.dead && b.team === 1 - team).length;
  return v;
}

// --- Decision (generator so the async variant can yield between candidates) ----------------

function* decide({ world, match, player, difficulty = 'medium', rand }) {
  const role = player.role;
  const nSims = AI.sims[difficulty] ?? AI.sims.medium;
  const team = player.team;
  const handT = boulesInHand(match, team) - 1, handO = boulesInHand(match, 1 - team);
  const perceived = world.terrain.perceived();
  const deadBefore = liveBoules(world).filter((b) => b.dead && b.team === team).length;
  const cands = buildCandidates(world, match, player);
  if (!cands.length) {
    // no jack to aim at: just lob towards the middle of the lane
    const base = baseThrow('demi', C.circle.x, 8);
    return { throwParams: applyNoise(base.p, 'demi', role, difficulty, rand), intent: 'point', label: `${player.name} points a demi-portée` };
  }
  const seeds = cands.map(() => seedFrom(rand));
  let best = null;
  for (let i = 0; i < cands.length; i++) {
    const k = cands[i];
    const srand = mulberry32(seeds[i]);
    const base = baseThrow(k.style, k.tx, k.ty);
    const p = refine(world, 'boule', k.style, base, srand);
    let sum = 0, sum2 = 0;
    for (let s = 0; s < nSims; s++) {
      const w = world.clone(perceived, mulberry32(seedFrom(srand)));
      const b = launch(createBody('boule', { team, owner: player.id }), applyNoise(p, k.style, role, difficulty, srand));
      w.add(b);
      simulate(w, AI.maxSimSeconds);
      const v = evaluate(w, team, handT, handO, deadBefore);
      sum += v; sum2 += v * v;
    }
    const mean = sum / nSims;
    const sd = Math.sqrt(Math.max(0, sum2 / nSims - mean * mean));
    const score = mean - AI.riskAversion * sd + (k.intent === 'shoot' ? (AI.shootBonus[role] || 0) : 0);
    if (!best || score > best.score) best = { k, p, score };
    yield;
  }
  const { k, p } = best;
  const throwParams = applyNoise(p, k.style, role, difficulty, rand);
  return { throwParams, intent: k.intent, label: makeLabel(player, k), score: best.score };
}

function makeLabel(player, k) {
  const n = player.name;
  if (k.intent === 'point') return `${n} ${FRENCH[k.style]}`;
  if (k.tag === 'jack') return `${n} goes for the cochonnet!`;
  return `${n} shoots at ${player.team === 1 ? 'your' : 'their'} boule`;
}

export function chooseThrow(args) {
  const g = decide(args);
  let r;
  while (!(r = g.next()).done);
  return r.value;
}

export async function chooseThrowAsync(args) {
  const g = decide(args);
  let r;
  while (!(r = g.next()).done) await new Promise((res) => setTimeout(res, 0));
  return r.value;
}

// --- Jack throw ---------------------------------------------------------------------------

// Tries a few styles and distances, simulates each on the perceived terrain and keeps the one
// that most often lands a legal jack (6-10 m, inside the lines), then adds skill noise.
export function chooseJackThrow({ world, difficulty = 'medium', rand, player } = {}) {
  const role = player ? player.role : 'pointeur';
  const nSims = AI.sims[difficulty] ?? AI.sims.medium;
  const perceived = world.terrain.perceived();
  const cands = [];
  for (const style of ['jack', 'jackLow']) {
    for (const d of [AI.jackTarget - 1, AI.jackTarget, AI.jackTarget + 1]) {
      cands.push({ style, tx: C.circle.x + (rand() - 0.5) * 0.4, ty: C.circle.y + d });
    }
  }
  let best = null;
  for (const k of cands) {
    const srand = mulberry32(seedFrom(rand));
    const p = planShot(world, k.style, k.tx, k.ty, srand);
    let ok = 0;
    for (let s = 0; s < nSims; s++) {
      const w = world.clone(perceived, mulberry32(seedFrom(srand)));
      w.bodies.length = 0;
      const b = launch(createBody('jack', {}), applyNoise(p, k.style, role, difficulty, srand));
      w.add(b);
      simulate(w, AI.maxSimSeconds);
      if (jackValid(b)) ok++;
    }
    const score = ok - 0.1 * Math.abs(k.ty - C.circle.y - AI.jackTarget);
    if (!best || score > best.score) best = { p, k, score };
  }
  const throwParams = applyNoise(best.p, best.k.style, role, difficulty, rand);
  return { throwParams, intent: 'jack', label: `${player ? player.name : 'The AI'} throws the cochonnet` };
}

// Noiseless refined throw for a style aimed at (tx, ty); exported for tests and tuning
export function planShot(world, style, tx, ty, rand) {
  const base = baseThrow(style, tx, ty);
  return refine(world, style.startsWith('jack') ? 'jack' : 'boule', style, base, rand);
}
