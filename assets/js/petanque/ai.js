// Monte Carlo AI on the donnée model: plans candidates as (donnée, loft), throws through donnee.js with the
// player's own skill cone (like the human), and scores each candidate over several noisy sims on a perceived
// clone of the world. A per-style roll-out table (flat terrain) gives first guesses for pointing données,
// noiseless sims on the perceived terrain refine them.
import { C } from './constants.js';
import { mulberry32 } from './rng.js';
import { createBody, launch, createWorld, simulate } from './physics.js';
import { meneResult, boulesInHand, jackValid } from './rules.js';
import { SKILL, scaledSkill, coneFor, executeThrow, solveLaunch, styleForLoft, releaseFrom } from './donnee.js';

const DEG = Math.PI / 180;

// Tuning
export const AI = {
  sims: { easy: 8, medium: 12, hard: 16 },
  lofts: { roulette: 14 * DEG, demi: 32 * DEG, plombee: 55 * DEG, tir: 32 * DEG, tirHigh: 42 * DEG, jackLow: 35 * DEG, jack: 55 * DEG },
  shootBonus: { pointeur: 0, tireur: 0.6 }, // tireurs like a shot: added to the score of tir candidates
  // personality: added to the score of pointing candidates of that style (Marcel the pointeur likes to roll)
  stylePref: {
    marcel: { roulette: 0.22, demi: 0.06 },
    odette: { demi: 0.02 },
    pierre: { demi: 0.04 },
  },
  styleNoise: 0.08, // random +- added to every candidate so equal-looking choices vary between turns
  maxSimSeconds: 14,
  refineSims: 3,
  refineIters: 2,
  riskAversion: 0.1,
  shootRange: 1, // shoot opponent boules this close to the jack
  tirHighShort: 0.1, // the higher shot lands almost on the target and stops there
  tirShort: 0.45, // aim the donnée this far short of the target: lands, then rolls or hops into it (measured ~60% move it, ~20% carreau)
  jackTarget: 8, // m from circle for the jack throw
  minDonnee: 1.5, // m from the thrower
};

const FRENCH = { roulette: 'roule', 'demi-portee': 'points a demi-portée', plombee: 'points a la plombée' };
const FROM = C.throwFrom;

// --- Roll-out table -----------------------------------------------------------------------

// Where a body ends up after being thrown to land at `landing` (flat terrain): rest distance by donnée distance
const rollCache = new Map();
function rollTable(kind, loft, from) {
  const key = kind + ':' + Math.round(loft * 1000) + ':' + Math.round((from.z ?? 0.9) * 20);
  if (rollCache.has(key)) return rollCache.get(key);
  const terrain = flatStub();
  const world = createWorld(terrain, () => 0.5);
  world.isClone = true;
  const ds = [], rest = [];
  for (let d = AI.minDonnee; d <= 13.001; d += 0.5) {
    const tp = solveLaunch({ from, landing: { x: from.x, y: from.y + d }, loft, terrain });
    const b = launch(createBody(kind, { team: -1 }), tp, from);
    world.bodies.length = 0;
    world.events.length = 0;
    world.t = 0;
    world.add(b);
    simulate(world, 12);
    ds.push(d);
    rest.push(b.dead ? 99 : b.y - from.y);
  }
  const t = { ds, rest };
  rollCache.set(key, t);
  return t;
}
export function resetLaunchTable() { rollCache.clear(); }

// Donnée distance whose flat-terrain rest distance is `want`; null if it would run past by > 0.6 m
export function donneeDistFor(kind, loft, from, want) {
  const { ds, rest } = rollTable(kind, loft, from);
  if (want < rest[0]) return want < rest[0] - 0.6 ? null : ds[0];
  for (let i = 1; i < ds.length; i++) {
    if (rest[i] >= want && rest[i - 1] < want) {
      return ds[i - 1] + (want - rest[i - 1]) / (rest[i] - rest[i - 1]) * (ds[i] - ds[i - 1]);
    }
  }
  return ds[ds.length - 1];
}

function seedFrom(rand) { return (rand() * 4294967296) >>> 0; }
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function liveBoules(world) { return world.bodies.filter((b) => b.kind === 'boule'); }
function theJack(world) { return world.bodies.find((b) => b.kind === 'jack'); }

// Noiseless landing of a donnée on `terrain` then the mean of a few settle sims
function meanEnd(world, kind, from, donnee, loft, terrain, rand) {
  const tp = solveLaunch({ from, landing: donnee, loft, terrain });
  let mx = 0, my = 0;
  const n = AI.refineSims;
  for (let s = 0; s < n; s++) {
    const w = world.clone(terrain, mulberry32(seedFrom(rand)));
    const b = launch(createBody(kind, { team: -1 }), tp, from);
    w.add(b);
    simulate(w, AI.maxSimSeconds);
    mx += b.x / n; my += b.y / n;
  }
  return { x: mx, y: my };
}

// Move the donnée so the noiseless mean rest spot lands on `target` (corrects for slope and friction)
function refineDonnee(world, kind, from, target, loft, donnee, perceived, rand) {
  const d = { ...donnee };
  for (let it = 0; it < AI.refineIters; it++) {
    const e = meanEnd(world, kind, from, d, loft, perceived, rand);
    d.x += Math.max(-1, Math.min(1, target.x - e.x));
    d.y += Math.max(-1, Math.min(1, target.y - e.y));
  }
  return d;
}

// --- Candidates ---------------------------------------------------------------------------

// Pointing donnée: short of `target` so the roll carries to it, refined on the perceived terrain
function pointDonnee(world, kind, from, target, loft, perceived, rand) {
  const dx = target.x - from.x, dy = target.y - from.y, dist = Math.hypot(dx, dy);
  const dd = donneeDistFor(kind, loft, from, dist);
  if (dd === null) return null;
  const k = Math.min(dd, dist) / dist;
  const d0 = { x: from.x + dx * k, y: from.y + dy * k };
  return refineDonnee(world, kind, from, target, loft, d0, perceived, rand);
}

function buildCandidates(world, match, player) {
  const jack = theJack(world);
  if (!jack || jack.dead) return [];
  const team = player.team, opp = 1 - team;
  const c = [];
  const pt = (style, dx, dy) => c.push({ style, loft: AI.lofts[style], target: { x: jack.x + dx, y: jack.y + dy }, intent: 'point', tag: style });
  // pointing at the jack, plus offsets to get round blockers
  pt('roulette', 0, 0); pt('demi', 0, 0); pt('plombee', 0, 0);
  pt('roulette', 0.22, 0); pt('roulette', -0.22, 0);
  pt('demi', 0, -0.25); pt('plombee', 0, 0.25);
  // shots at opponent boules near the jack (closest first)
  const targets = liveBoules(world)
    .filter((b) => !b.dead && b.team === opp && dist2(b, jack) <= AI.shootRange)
    .sort((a, b) => dist2(a, jack) - dist2(b, jack)).slice(0, 2);
  for (const b of targets) {
    c.push({ style: 'tir', loft: AI.lofts.tir, target: { x: b.x, y: b.y }, shortBy: AI.tirShort, intent: 'shoot', tag: 'boule' });
    c.push({ style: 'tir', loft: AI.lofts.tirHigh, target: { x: b.x, y: b.y }, shortBy: AI.tirHighShort, intent: 'shoot', tag: 'boule' });
  }
  // shoot the jack when the opponent holds 2+ points and we have boules after this one
  const res = meneResult(jack, liveBoules(world));
  if (!res.void && res.team === opp && res.points >= 2 && boulesInHand(match, team) > 1) {
    c.push({ style: 'tir', loft: AI.lofts.tir, target: { x: jack.x, y: jack.y }, shortBy: AI.tirShort, intent: 'shoot', tag: 'jack' });
  }
  // keep within the field and the cap
  return c.filter((k) => k.target.y < C.terrainL - 0.5 && k.target.y > 2 && k.target.x > 0.3 && k.target.x < C.terrainW - 0.3).slice(0, 12);
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

const skillFor = (player, difficulty) => scaledSkill(SKILL[player && player.id] ?? SKILL.human, difficulty);
const clampDonnee = (d) => ({
  x: Math.max(0.2, Math.min(C.terrainW - 0.2, d.x)),
  y: Math.max(0.5, Math.min(C.terrainL - 0.2, d.y)),
});

// One noisy throw through the same model as the human's: the player's cone, on the given terrain
function throwThrough({ from, donnee, loft, skill, terrain, rand }) {
  const cone = coneFor({ skill, from, landing: donnee, loft });
  const tp = executeThrow({ from, landing: donnee, loft, cone, terrain, rand }).throwParams;
  tp.from = from; // launch() uses it, so the boule leaves from the same release point the solver assumed
  return tp;
}

function* decide({ world, match, player, difficulty = 'medium', rand, from = FROM }) {
  const nSims = AI.sims[difficulty] ?? AI.sims.medium;
  const team = player.team;
  const skill = skillFor(player, difficulty);
  const handT = boulesInHand(match, team) - 1, handO = boulesInHand(match, 1 - team);
  const perceived = world.terrain.perceived();
  const deadBefore = liveBoules(world).filter((b) => b.dead && b.team === team).length;
  const cands = buildCandidates(world, match, player);
  const finish = (donnee, loft, intent, label, score, snapped) => {
    const rel = releaseFrom(from, loft);
    const throwParams = throwThrough({ from: rel, donnee, loft, skill, terrain: world.terrain, rand });
    return { throwParams, from: rel, intent, label, score, donnee, loft, style: styleForLoft(loft, snapped) };
  };
  if (!cands.length) {
    // no jack to aim at: just lob towards the middle of the lane
    return finish({ x: C.circle.x, y: 8 }, AI.lofts.demi, 'point', `${player.name} points a demi-portée`, 0, false);
  }
  const seeds = cands.map(() => seedFrom(rand));
  let best = null;
  for (let i = 0; i < cands.length; i++) {
    const k = cands[i];
    const fk = releaseFrom(from, k.loft);
    const srand = mulberry32(seeds[i]);
    let donnee;
    if (k.intent === 'shoot') {
      const dx = k.target.x - from.x, dy = k.target.y - from.y, d = Math.hypot(dx, dy) || 1;
      donnee = { x: k.target.x - dx / d * k.shortBy, y: k.target.y - dy / d * k.shortBy };
    } else {
      donnee = pointDonnee(world, 'boule', fk, k.target, k.loft, perceived, srand);
      if (!donnee) continue;
    }
    donnee = clampDonnee(donnee);
    let sum = 0, sum2 = 0;
    for (let s = 0; s < nSims; s++) {
      const w = world.clone(perceived, mulberry32(seedFrom(srand)));
      const tp = throwThrough({ from: fk, donnee, loft: k.loft, skill, terrain: perceived, rand: srand });
      const b = launch(createBody('boule', { team, owner: player.id }), tp, fk);
      w.add(b);
      simulate(w, AI.maxSimSeconds);
      const v = evaluate(w, team, handT, handO, deadBefore);
      sum += v; sum2 += v * v;
    }
    const mean = sum / nSims;
    const sd = Math.sqrt(Math.max(0, sum2 / nSims - mean * mean));
    const pref = (AI.stylePref[player.id] || {})[k.style] || 0;
    const score = mean - AI.riskAversion * sd + (k.intent === 'shoot' ? (AI.shootBonus[player.role] || 0) : 0) +
      pref + (srand() - 0.5) * AI.styleNoise;
    if (!best || score > best.score) best = { k, donnee, score };
    yield;
  }
  const { k, donnee } = best;
  return finish(donnee, k.loft, k.intent, makeLabel(player, k), best.score, k.intent === 'shoot');
}

function makeLabel(player, k) {
  const n = player.name;
  if (k.intent === 'point') return `${n} ${FRENCH[styleForLoft(k.loft)]}`;
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

// Tries a few lofts and distances, simulates each on the perceived terrain (with the player's cone) and keeps
// the one that most often lands a legal jack (6-10 m, inside the lines).
export function chooseJackThrow({ world, difficulty = 'medium', rand, player, from: base = FROM } = {}) {
  const nSims = Math.max(16, AI.sims[difficulty] ?? AI.sims.medium); // a legal jack matters on every level
  const skill = skillFor(player, difficulty);
  const perceived = world.terrain.perceived();
  const cands = [];
  for (const style of ['jackLow', 'jack']) {
    const from = releaseFrom(base, AI.lofts[style]);
    for (const d of [AI.jackTarget - 1, AI.jackTarget, AI.jackTarget + 1]) {
      const want = { x: C.circle.x + (rand() - 0.5) * 0.4, y: C.circle.y + d };
      const dd = donneeDistFor('jack', AI.lofts[style], from, Math.hypot(want.x - from.x, want.y - from.y));
      if (dd === null) continue;
      const len = Math.hypot(want.x - from.x, want.y - from.y);
      const k = Math.min(dd, len) / len;
      cands.push({ loft: AI.lofts[style], want, donnee: clampDonnee({ x: from.x + (want.x - from.x) * k, y: from.y + (want.y - from.y) * k }) });
    }
  }
  let best = null;
  for (const k of cands) {
    const srand = mulberry32(seedFrom(rand));
    const from = releaseFrom(base, k.loft);
    const donnee = refineDonnee(world, 'jack', from, k.want, k.loft, k.donnee, perceived, srand);
    let ok = 0;
    for (let s = 0; s < nSims; s++) {
      const w = world.clone(perceived, mulberry32(seedFrom(srand)));
      w.bodies.length = 0;
      const tp = throwThrough({ from, donnee, loft: k.loft, skill, terrain: perceived, rand: srand });
      const b = launch(createBody('jack', {}), tp, from);
      w.add(b);
      simulate(w, AI.maxSimSeconds);
      if (jackValid(b)) ok++;
    }
    const score = ok - 0.1 * Math.abs(k.want.y - C.circle.y - AI.jackTarget);
    if (!best || score > best.score) best = { k, donnee, score };
  }
  const { k, donnee } = best;
  const from = releaseFrom(base, k.loft);
  const throwParams = throwThrough({ from, donnee, loft: k.loft, skill, terrain: world.terrain, rand });
  return {
    throwParams, from, intent: 'jack', label: `${player ? player.name : 'The AI'} throws the cochonnet`,
    donnee, loft: k.loft, style: styleForLoft(k.loft),
  };
}

function flatStub() {
  const mu = (C.rollResistPacked + C.rollResistLoose) / 2;
  const s = { h: 0, nx: 0, ny: 0, nz: 1, friction: mu, loose: 0.5 };
  return {
    sample: () => s, stonesNear: () => [], addDivot() {}, resetDivots() {},
    visibleStones: () => [], perceived() { return this; },
  };
}
