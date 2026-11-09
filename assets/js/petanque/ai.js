// Monte Carlo AI on the donnée model: tactics.js reads the situation and proposes candidate families
// (donnée, loft, prior, reason); this module throws each through donnee.js with the player's own skill cone (like
// the human), scores them over noisy sims on a perceived clone of the world (successive halving, with a
// wall-clock guard), and returns the best with its tactical reason. A per-style roll-out table (flat terrain)
// gives first guesses for pointing données, noiseless sims on the perceived terrain refine them.
import { C } from './constants.js';
import { court, ahead } from './court.js';
import { mulberry32 } from './rng.js';
import { createBody, launch, createWorld, simulate } from './physics.js';
import { jackValid, jackPlaceValid, DEFAULT_GEOMETRY, JACK_END_MARGIN } from './rules.js';
import { coneFor, executeThrow, solveLaunch, styleForLoft, releaseFrom, fitToBudget, feltTerrain, roughness as roughnessOf, ROUGH_LOFT_FULL, ROUGH_LOFT_NONE } from './donnee.js';
import { DEFAULT_CFG, DIFFICULTY, PROMOTE_DRAW, readSituation, plan, evalEnd, explain, skillOfPlayer, whoThrows, dropMargin } from './tactics.js';
export { ROUGH_LOFT_FULL, ROUGH_LOFT_NONE };
export { whoThrows };

const DEG = Math.PI / 180;

// Tuning
export const AI = {
  sims: { easy: 8, medium: 12, hard: 16 },
  lofts: { ...DEFAULT_CFG.lofts },
  // (personality now lives in tactics.js profiles; stylePref is only a test hook: extra prior per player and style)
  stylePref: {},
  ablate: {}, // measure-tactics.js ablations: { noPromote, noDefense, noDrop, noMargin }
  noise: 0.08, // total width of the random +- added to a candidate's score (x3 on Easy) so equal-looking choices vary
  timeGuard: true, // stop simulating at timeGuardMs of compute (yields between candidates do not count) and return the best so far
  timeGuardMs: { easy: 40, medium: 40, hard: 90 },
  firstSims: 4, // sims every candidate gets before the halving
  keepTop: 3, // candidates that get the rest of the budget (plus any within 2 standard errors of the best)
  maxSimSeconds: 14,
  refineSims: 3,
  refineTol: 0.1, // m: the refine search stops when the mean rest is this close to the target
  refineIters: 4, // evaluations of the refine search (each is refineSims noiseless sims)
  minHit: 0.4, // a shot needs at least this fraction of the sims to move its target (> hitMove)
  hitMove: 0.15, // m: a target that moves more than this counts as hit
  minHitJack: 0.25, // a shot at the jack needs this fraction of sims to move it
  gateHit: DEFAULT_CFG.gateHit,
  tirHighShort: DEFAULT_CFG.tirHighShort, // the higher shot lands almost on the target and stops there
  tirShortClose: DEFAULT_CFG.tirShortClose, // a second, closer aim: the sims prefer it when the thrower is accurate (Hard)
  tirShort: DEFAULT_CFG.tirShort, // aim the donnée this far short of the target: lands, then rolls or hops into it (D16 sweep: 22 degrees, 0.5-0.7 m short moved the target most often)
  roughK: 1.0, // extra rolling resistance fraction the planner assumes for a roulette (see roughness())
  jackTarget: 8, // m from circle for the jack throw
  minDonnee: 1.5, // m from the thrower
};

const FRENCH = { roulette: 'roule', 'demi-portee': 'points a demi-portée', plombee: 'points a la plombée' };
const FROM = court.throwFrom; // E10: live: follows the current circle

// --- Roll-out table -----------------------------------------------------------------------

// Where a body ends up after being thrown to land at `landing` (flat terrain): rest distance by donnée distance
const rollCache = new Map();
function rollTable(kind, loft, from0) {
  const from = { x: 2, y: 1, z: from0.z ?? 0.9 }; // canonical: the flat table does not depend on where the circle is (E10)
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
    // a dead (ghost) body may have stopped anywhere outside: aim by where it went out
    mx += (b.dead ? b.outX : b.x) / n; my += (b.dead ? b.outY : b.y) / n;
  }
  return { x: mx, y: my };
}

// Move the donnée so the noiseless mean rest spot lands on `target` (corrects for slope and friction).
// Secant search along the throw line: rest distance rises 1 to 3 m per metre of donnée (a low roulette is the
// steepest), so a fixed-gain step (the old +1 m clamp) overshot and oscillated; D16. Keeps the best iterate seen.
function refineDonnee(world, kind, from, target, loft, donnee, perceived, rand) {
  const dx = target.x - from.x, dy = target.y - from.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const along = (p) => (p.x - from.x) * ux + (p.y - from.y) * uy;
  const side = (p) => (p.x - from.x) * uy - (p.y - from.y) * ux;
  let d = { ...donnee }, best = null, prev = null;
  let slope = loft < 20 * DEG ? 2.2 : loft < 45 * DEG ? 1.6 : 1.2;
  for (let it = 0; it < AI.refineIters; it++) {
    const e = meanEnd(world, kind, from, d, loft, perceived, rand);
    const err = len - along(e), lat = -side(e);
    if (!best || Math.abs(err) < best.abs) best = { d: { ...d }, abs: Math.abs(err) };
    if (best.abs < AI.refineTol) break;
    const sNow = along(d);
    if (prev && Math.abs(sNow - prev.s) > 0.05) {
      slope = Math.max(0.6, Math.min(4, (along(e) - prev.r) / (sNow - prev.s)));
    }
    prev = { s: sNow, r: along(e) };
    const step = Math.max(-2, Math.min(2, err / slope));
    d = { x: d.x + ux * step + uy * Math.max(-0.5, Math.min(0.5, lat)), y: d.y + uy * step - ux * Math.max(-0.5, Math.min(0.5, lat)) };
  }
  return best ? best.d : d;
}

// Low-loft roughness allowance (D16, shared with the roll guide in donnee.js, D19)
export const roughness = (loft) => roughnessOf(loft, AI.roughK);
const felt = (view, loft, rough) => feltTerrain(view, loft, rough, AI.roughK);

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

// A refined pointing donnée for `target`, as a human using the roll guide would find it (measure scripts' scripted pointer)
export function planPoint({ world, from, target, loft, rand }) {
  const perceived = world.terrain.perceived();
  const view = felt(perceived, loft, perceived !== world.terrain);
  return pointDonnee(world, 'boule', from, target, loft, view, rand);
}

// --- Decision (generator so the async variant can yield between candidates) ----------------

const skillFor = skillOfPlayer;
const clampDonnee = (d) => ({
  x: Math.max(0.2, Math.min(C.terrainW - 0.2, d.x)),
  y: court.dir > 0 ? Math.max(0.5, Math.min(C.terrainL - 0.2, d.y)) : Math.max(0.2, Math.min(C.terrainL - 0.5, d.y)), // 0.5 m behind the circle end, 0.2 m at the far one
});

// One noisy throw through the same model as the human's: the player's cone, on the given terrain
function throwThrough({ from, donnee, loft, skill, terrain, rand, energyFrac = 0 }) {
  const cone = coneFor({ skill, from, landing: donnee, loft, energyFrac });
  const tp = executeThrow({ from, landing: donnee, loft, cone, terrain, rand }).throwParams;
  tp.from = from; // launch() uses it, so the boule leaves from the same release point the solver assumed
  return tp;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
// Compute-time clock: time spent between yields only, so the UI breathing room does not count against the guard
function makeClock(limit) {
  let busy = 0, t0 = now();
  return {
    pause() { busy += now() - t0; },
    resume() { t0 = now(); },
    ms() { return busy + now() - t0; },
    over() { return AI.timeGuard && busy + now() - t0 > limit; },
  };
}

const cfgOf = () => ({
  lofts: AI.lofts, tirShort: AI.tirShort, tirShortClose: AI.tirShortClose, tirHighShort: AI.tirHighShort,
  gateHit: AI.gateHit, stylePref: AI.stylePref, ...AI.ablate,
});

function* decide({ world, match, player, difficulty = 'medium', rand, from = FROM, advice = false }) {
  const dk = DIFFICULTY[difficulty] ? difficulty : 'medium';
  const nSims = AI.sims[dk] ?? AI.sims.medium;
  const team = player.team;
  const skill = skillFor(player, difficulty);
  const perceived = world.terrain.perceived();
  const rough = perceived !== world.terrain;
  const sit = readSituation({ match, bodies: world.bodies, player, difficulty, advice });
  if (AI.ablate.noDefense) sit.params = { ...sit.params, shield: false, wS: 0, wS2: 0 };
  const errRoll = rand(); // the tactical-error draw (below); also the source of Easy's promotion draw, so the random stream is unchanged
  if (sit.diff.promote === 'draw' && !advice) sit.promoteDraw = (errRoll * 977.31) % 1 < PROMOTE_DRAW; // Easy: promotion is admitted in a quarter of the decisions
  const clock = makeClock(AI.timeGuardMs[dk] ?? 40);
  const finish = (donnee, loft, intent, label, score, snapped, labelKey, fallback = false) => {
    const rel = releaseFrom(from, loft);
    const fit = fitToBudget({ from: rel, landing: donnee, loft, skill, terrain: world.terrain });
    const throwParams = throwThrough({ from: rel, donnee: fit.landing, loft, skill, terrain: world.terrain, rand, energyFrac: fit.energyFrac });
    // info: for ?debug&ailog and the measure scripts (what the plan wanted, how far the budget pulled it in, a fallback pick)
    return {
      throwParams, from: rel, intent, label, labelKey, score, donnee: fit.landing, loft, style: snapped ? 'tir' : styleForLoft(loft), energyFrac: fit.energyFrac,
      who: player.id,
      info: { wanted: donnee, clampedBy: dist2(donnee, fit.landing), fallback, budgetClamped: fit.clamped },
    };
  };
  const lob = (fallback = false) => {
    const out = finish(ahead(7), AI.lofts.demi, 'point', `${player.name} points a demi-portée`, 0, false, { event: 'spotPoint', style: 'demi-portee' }, fallback);
    out.why = { code: 'takePoint' };
    out.family = 'pointJack';
    return out;
  };
  const planned = plan(sit, cfgOf());
  let bareWorld = null; // the court emptied: promotions are aimed as if the boule they push were not there
  const bare = { clone: (t, r) => { if (!bareWorld) { bareWorld = world.clone(t, r); bareWorld.bodies.length = 0; } return bareWorld.clone(t, r); } };
  if (!planned.cands.length) return lob(); // no jack to aim at: just lob towards the middle of the lane

  // The donnée a candidate aims at: short of the jack so the roll carries to it (refined), or just short of a target boule
  const donneeFor = (k, view, fk, srand) => {
    if (k.landing) return { ...k.landing }; // drop: the donnée is the landing spot itself (a dead drop)
    if (k.restAt) return pointDonnee(bare, 'boule', fk, k.restAt, k.loft, view, srand); // promote: a point aimed just past the boule, refined with nothing in the way
    if (k.intent === 'shoot') {
      const dx = k.target.x - from.x, dy = k.target.y - from.y, d = Math.hypot(dx, dy) || 1;
      return { x: k.target.x - dx / d * k.shortBy, y: k.target.y - dy / d * k.shortBy };
    }
    return pointDonnee(world, 'boule', fk, k.target, k.loft, view, srand);
  };
  const finishCand = (k, donnee, score, isFallback, why, extra) => {
    const out = finish(donnee, k.loft, k.intent, makeLabel(player, k), score, k.intent === 'shoot', labelKeyFor(k), isFallback);
    out.info.target = k.target; out.info.tag = k.tag; out.info.cands = planned.cands.length;
    out.info.promoteAdmitted = planned.cands.some((c) => c.family === 'promote'); // 12.12.7 case 29: how often Easy's draw lets a promotion in
    out.family = k.family;
    out.why = why;
    out.reason = why;
    Object.assign(out, extra);
    return out;
  };

  // A tactical error (12.7): with probability eps the AI drops its principles and plays the other kind of throw
  if (errRoll < sit.diff.eps) {
    const loose = plan(sit, cfgOf(), { loose: true }).cands.filter((c) => c.family !== 'shootJack');
    const normal = planned.cands[0].intent;
    let pool = loose.filter((c) => c.intent !== normal);
    if (!pool.length) pool = loose.length ? loose : planned.cands;
    const w = pool.map((c) => Math.exp(Math.max(-4, Math.min(2, c.a))));
    let r = rand() * w.reduce((x, y) => x + y, 0), pick = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) { pick = pool[i]; break; } }
    const srand = mulberry32(seedFrom(rand));
    const fk = releaseFrom(from, pick.loft);
    const view = felt(perceived, pick.loft, rough);
    const d = donneeFor(pick, view, fk, srand) || { x: pick.target.x, y: pick.target.y - 0.5 };
    const out = finishCand(pick, clampDonnee(d), 0, false, { code: 'mistake' }, { mistake: true });
    out.info.sit = { BA: sit.BA };
    return out;
  }

  // Successive halving (12.6): every candidate gets a few sims, the best get the rest of the budget
  const lambda = sit.lambda;
  const n1 = Math.min(AI.firstSims, nSims);
  const states = [];
  let fallback = null;
  const runSims = (st, n) => {
    for (let s = 0; s < n; s++) {
      const w = world.clone(st.view, mulberry32(seedFrom(st.srand)));
      const tp = throwThrough({ from: st.fk, donnee: st.donnee, loft: st.k.loft, skill, terrain: st.view, rand: st.srand, energyFrac: st.energyFrac });
      const b = launch(createBody('boule', { team, owner: player.id }), tp, st.fk);
      // a shot's target, to count how often the sims move it (D16: don't shoot when a hit is unlikely)
      const victim = st.k.intent === 'shoot'
        ? w.bodies.find((x) => x.kind === (st.k.tag === 'jack' ? 'jack' : 'boule') && !x.dead && Math.hypot(x.x - st.k.target.x, x.y - st.k.target.y) < 0.02)
        : null;
      const vx = victim ? victim.x : 0, vy = victim ? victim.y : 0;
      const promoted = st.k.family === 'promote' ? w.bodies.find((x) => x.kind === 'boule' && !x.dead && Math.hypot(x.x - st.k.target.x, x.y - st.k.target.y) < 0.02) : null;
      const jackBody = promoted ? w.bodies.find((x) => x.kind === 'jack') : null;
      const jx0 = jackBody ? jackBody.x : 0, jy0 = jackBody ? jackBody.y : 0;
      w.add(b);
      simulate(w, AI.maxSimSeconds);
      if (b.dead) st.dead++;
      if (promoted) {
        // 12.12.2 early cut-offs: the jack moved, the shooter ended far from the boule
        if (jackBody.dead || Math.hypot(jackBody.x - jx0, jackBody.y - jy0) > 0.15) st.jackMoved++;
        if (b.dead || Math.hypot(b.x - st.k.target.x, b.y - st.k.target.y) > 0.4) st.farFromB++;
      }
      if (victim && (victim.dead || Math.hypot(victim.x - vx, victim.y - vy) > AI.hitMove)) st.hits++;
      const v = evalEnd(w.bodies, sit);
      st.vs.push(v);
    }
  };
  const stat = (st) => {
    const n = st.vs.length;
    let sum = 0, sum2 = 0;
    for (const v of st.vs) { sum += v; sum2 += v * v; }
    const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    return { mean, sd, se: sd / Math.sqrt(n), n };
  };
  const scoreOf = (st) => { const m = stat(st); return m.mean - lambda * m.sd + st.k.prior; };

  for (const k of planned.cands) {
    if (states.length && clock.over()) break;
    const fk = releaseFrom(from, k.loft);
    const view = felt(perceived, k.loft, rough);
    const srand = mulberry32(seedFrom(rand));
    let donnee = donneeFor(k, view, fk, srand);
    if (!donnee) continue;
    donnee = clampDonnee(donnee);
    // candidates beyond the throw budget are dropped (the first one is kept, pulled in, in case nothing fits)
    const fit = fitToBudget({ from: fk, landing: donnee, loft: k.loft, skill, terrain: view });
    if (fit.clamped) {
      if (!fallback) fallback = { k, donnee: fit.landing, score: -9 };
      continue;
    }
    const st = { k, donnee, fk, view, srand, energyFrac: fit.energyFrac, vs: [], hits: 0, dead: 0, jackMoved: 0, farFromB: 0 };
    runSims(st, n1);
    // early cut: a shot whose first sims never move the target
    if (k.intent === 'shoot' && st.hits === 0) continue;
    // early cut: a promotion that moves the jack in all of its first sims (unless a carom was meant) or never ends near the boule
    if (k.family === 'promote' && ((st.jackMoved === st.vs.length && !k.carom) || st.farFromB === st.vs.length)) continue;
    states.push(st);
    clock.pause(); yield; clock.resume();
  }
  // early cut: a pointing candidate whose sims are all worse than the best candidate's worst
  if (states.length > 1) {
    const top = states.reduce((a, b) => (scoreOf(b) > scoreOf(a) ? b : a));
    const floor = Math.min(...top.vs);
    for (let i = states.length - 1; i >= 0; i--) {
      const st = states[i];
      if (st !== top && st.k.intent === 'point' && Math.max(...st.vs) < floor) states.splice(i, 1);
    }
  }
  let finalists = states;
  if (states.length) {
    const ranked = states.slice().sort((a, b) => scoreOf(b) - scoreOf(a));
    const bestStat = stat(ranked[0]);
    const bestScore = scoreOf(ranked[0]);
    finalists = ranked.filter((st, i) => i < AI.keepTop || scoreOf(st) >= bestScore - 2 * Math.max(bestStat.se, stat(st).se));
    for (const st of finalists) {
      if (nSims > st.vs.length) {
        if (clock.over()) break;
        runSims(st, nSims - st.vs.length);
        clock.pause(); yield; clock.resume();
      }
    }
  }
  const minHit = (st) => (st.k.tag === 'jack' ? AI.minHitJack : AI.minHit);
  const ok = (st) => st.k.intent !== 'shoot' || st.hits / st.vs.length >= minHit(st);
  const scored = finalists.filter(ok).map((st) => ({ st, score: scoreOf(st) + (st.srand() - 0.5) * AI.noise * sit.diff.noiseMul }));
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) {
    // no finalist is good enough: take the best candidate that is, among everything simulated, else the fallback
    const rest = states.filter(ok).map((st) => ({ st, score: scoreOf(st) })).sort((a, b) => b.score - a.score);
    if (rest.length) scored.push(...rest);
  }
  if (!scored.length) {
    if (!fallback) return lob(true);
    const out = finishCand(fallback.k, fallback.donnee, fallback.score, true, { code: 'takePoint' }, {});
    return out;
  }
  // the drop (12.12.4, Hard): a dead drop wins when the best real throw is not worth the risk to the head
  if (planned.drop) {
    const dr = planned.drop, k = dr.cand;
    const fk = releaseFrom(from, k.loft), view = felt(perceived, k.loft, rough), srand = mulberry32(seedFrom(rand));
    const donnee = clampDonnee(donneeFor(k, view, fk, srand));
    const fit = fitToBudget({ from: fk, landing: donnee, loft: k.loft, skill, terrain: view });
    if (!fit.clamped) {
      const st = { k, donnee, fk, view, srand, energyFrac: fit.energyFrac, vs: [], hits: 0, dead: 0, jackMoved: 0, farFromB: 0 };
      runSims(st, 2);
      const vDrop = (st.vs[0] + st.vs[1]) / 2;
      const bestReal = scored.length ? Math.max(...scored.map((x) => scoreOf(x.st) - x.st.k.prior)) : -Infinity;
      if (st.dead === 0 && bestReal < vDrop + dropMargin(dr.kind, sit)) {
        const run = scored[0] ? scored[0].st.k : null;
        const out = finishCand(k, donnee, vDrop, false, explain(k, run, sit), { dropCase: dr.kind });
        out.info.sims = states.reduce((n, x) => n + x.vs.length, 0) + 2;
        return out;
      }
    }
  }
  const win = scored[0], run = scored.find((s) => s.st.k.family !== scored[0].st.k.family) || scored[1];
  const why = explain(win.st.k, run ? run.st.k : null, sit);
  const other = scored.find((s) => s.st.k.intent !== win.st.k.intent);
  const alt = other ? { intent: other.st.k.intent, family: other.st.k.family, gap: win.score - other.score } : null;
  const out = finishCand(win.st.k, win.st.donnee, win.score, false, why, { alt });
  Object.defineProperty(out.info, 'ms', { value: clock.ms(), enumerable: false }); // compute time; hidden so equal decisions compare equal
  out.info.sims = states.reduce((n, st) => n + st.vs.length, 0);
  out.info.finalists = finalists.length;
  // per-candidate table for ?debug&ailog and the scenario tools
  out.info.table = states.map((st) => { const m = stat(st); return { family: st.k.family, style: st.k.style, prior: st.k.prior, mean: m.mean, sd: m.sd, n: m.n, hits: st.hits, final: finalists.includes(st) }; });
  out.info.hitRate = win.st.k.intent === 'shoot' ? win.st.hits / win.st.vs.length : null;
  return out;
}

function makeLabel(player, k) {
  const n = player.name;
  if (k.intent === 'point') return `${n} ${FRENCH[styleForLoft(k.loft)]}`;
  if (k.tag === 'jack') return `${n} goes for the cochonnet!`;
  return `${n} shoots at ${player.team === 1 ? 'your' : 'their'} boule`;
}

// Personality hook: main.js turns this into a line from personalities.js (`label` stays as the plain fallback)
function labelKeyFor(k) {
  if (k.intent === 'point') return { event: 'spotPoint', style: styleForLoft(k.loft) };
  return { event: 'spotShoot', target: k.tag === 'jack' ? 'jack' : 'boule' };
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
export function chooseJackThrow({ world, difficulty = 'medium', rand, player, from: base = FROM, geometry } = {}) {
  const geo = { ...DEFAULT_GEOMETRY, circle: court.circle, dir: court.dir, ...geometry };
  const cc = geo.circle;
  const endDir = (geo.dir ?? 1) < 0 ? -1 : 1;
  const endY = endDir > 0 ? geo.length : 0;
  const rollRoom = JACK_END_MARGIN + 0.8; // E20: aim this far in front of the end string (the jack rolls on)
  const nSims = Math.max(16, AI.sims[difficulty] ?? AI.sims.medium); // a legal jack matters on every level
  const skill = skillFor(player, difficulty);
  const perceived = world.terrain.perceived();
  const cands = [];
  for (const style of ['jackLow', 'jack']) {
    const from = releaseFrom(base, AI.lofts[style]);
    for (const d of [AI.jackTarget - 1, AI.jackTarget, AI.jackTarget + 1]) {
      const want = { x: cc.x + (rand() - 0.5) * 0.4, y: cc.y + d * endDir };
      if (Math.abs(endY - want.y) < rollRoom) continue;
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
    const refined = refineDonnee(world, 'jack', from, k.want, k.loft, k.donnee, perceived, srand);
    const fit = fitToBudget({ from, landing: refined, loft: k.loft, skill, terrain: perceived });
    if (fit.clamped) continue; // beyond the throw budget
    const donnee = refined, energyFrac = fit.energyFrac;
    let ok = 0;
    for (let s = 0; s < nSims; s++) {
      const w = world.clone(perceived, mulberry32(seedFrom(srand)));
      w.bodies.length = 0;
      const tp = throwThrough({ from, donnee, loft: k.loft, skill, terrain: perceived, rand: srand, energyFrac });
      const b = launch(createBody('jack', {}), tp, from);
      w.add(b);
      simulate(w, AI.maxSimSeconds);
      if (jackValid(b, geo)) ok++;
    }
    const score = ok - 0.1 * Math.abs((k.want.y - cc.y) * endDir - AI.jackTarget);
    if (!best || score > best.score) best = { k, donnee, energyFrac, score };
  }
  if (!best) { // nothing fits the budget: the low jack at the nearest distance
    const k = cands[0] || { loft: AI.lofts.jackLow, want: { x: cc.x, y: cc.y + (AI.jackTarget - 1) * endDir } };
    const from = releaseFrom(base, k.loft);
    const f = fitToBudget({ from, landing: k.want, loft: k.loft, skill, terrain: perceived });
    best = { k, donnee: f.landing, energyFrac: f.energyFrac };
  }
  const { k, donnee } = best;
  const from = releaseFrom(base, k.loft);
  const throwParams = throwThrough({ from, donnee, loft: k.loft, skill, terrain: world.terrain, rand, energyFrac: best.energyFrac });
  return {
    throwParams, from, intent: 'jack', label: `${player ? player.name : 'The AI'} throws the cochonnet`,
    labelKey: { event: 'spotJack' },
    donnee, loft: k.loft, style: styleForLoft(k.loft),
  };
}

// Placement tastes: preferred distance from the circle (m) and lateral offset (m) per player
const PLACE_TASTE = { marcel: { dist: 6.9, side: -0.35 }, odette: { dist: 8.6, side: 0.3 }, pierre: { dist: 8.0, side: 0.1 } };
const PLACE_NOISE = { easy: 1, medium: 0.5, hard: 0.2 };

// The AI places an invalid jack by hand: a valid spot (6-10 m, inside the lines) at a distance and side the
// placer likes, away from big rocks and slopes on the terrain it can see, with a little randomness.
// Pure given `rand`. Returns { x, y, distance, label }.
export function chooseJackPlacement({ match, player, difficulty = 'medium', rand = Math.random, terrain, attempt = 0 } = {}) {
  const geometry = match && match.geometry;
  const dir = geometry && geometry.dir < 0 ? -1 : 1;
  const taste = PLACE_TASTE[player && player.id] || { dist: 8, side: 0 };
  const noise = PLACE_NOISE[difficulty] ?? PLACE_NOISE.medium;
  const view = terrain && terrain.perceived ? terrain.perceived() : terrain;
  const c = (geometry && geometry.circle) || court.circle;
  const pad = 0.1; // keep clear of the legal edges
  const endPad = (geometry && geometry.dir < 0 ? -1 : 1) * pad;
  // E04: after a yellow card (`attempt` > 0) stay well inside the lines and off slopes, so the jack cannot roll out
  const margin = attempt > 0 ? 0.25 + 0.2 * attempt : 0;
  const slopeW = 6 * (1 + 2 * attempt);
  const clear = (sp) => !margin || [[margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([ox, oy]) => jackPlaceValid({ x: sp.x + ox, y: sp.y + oy }, geometry) && Math.abs(Math.hypot(sp.x + ox - c.x, sp.y + oy - c.y) - 8) <= 2);
  let best = null;
  for (let d = C.jackMinDist + pad; d <= C.jackMaxDist - pad + 1e-9; d += 0.25) {
    for (let dx = -1.9; dx <= 1.9 + 1e-9; dx += 0.2) { // full court width (D14)
      const x = c.x + dx, y = c.y + dir * Math.sqrt(Math.max(0, d * d - dx * dx));
      const spot = { x, y };
      if (!jackPlaceValid(spot, geometry) || !jackPlaceValid({ x, y: y + endPad }, geometry) || !clear(spot)) continue; // E20: keep a little clear of the 0.5 m end rule
      const dist = Math.hypot(x - c.x, y - c.y);
      let score = -Math.abs(dist - taste.dist) * 0.5 - Math.abs(dx - taste.side) * 0.4;
      if (view) {
        const s = view.sample(x, y);
        score -= slopeW * Math.hypot(s.nx || 0, s.ny || 0) + 1.5 * (s.loose || 0);
        for (const st of view.stonesNear(x, y, 0.5)) score -= st.r > C.pebbleR[1] ? 1.2 : 0.05;
      }
      score += (rand() - 0.5) * 2 * noise;
      if (!best || score > best.score) best = { x, y, score, distance: dist };
    }
  }
  if (!best) best = { x: c.x, y: c.y + 8 * dir, distance: 8 }; // unreachable with the default geometry
  const name = player ? player.name : 'The AI';
  return {
    x: best.x, y: best.y, distance: best.distance,
    label: `${name} places the cochonnet at ${best.distance.toFixed(1)} m`,
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
