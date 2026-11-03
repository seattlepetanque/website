// Tactics (GAME-PLAN section 12): the AI's sense of the game. Pure (no physics, no DOM), so it runs in Node tests.
// The Monte Carlo in ai.js stays the source of truth about what a throw does; this module decides which throws
// are worth simulating (families, with priors and reasons), how a simulated end state is scored (evalEnd), how
// much risk to take (riskLambda), who should throw (whoThrows) and why (explain).
// Units: metres, mène points. "us" is the team of the player about to throw, "them" the other team.
import { C } from './constants.js';
import { SKILL, scaledSkill, coneFor } from './donnee.js';
import { meneResult, holdingTeam, boulesInHand } from './rules.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const SENTINEL = 3; // m: distance assumed for a side with no live boule

// Lofts and tir aims shared with ai.js (it exposes them as AI.lofts, AI.tirShort, ...)
export const DEFAULT_CFG = {
  lofts: { roulette: 14 * DEG, demi: 32 * DEG, plombee: 55 * DEG, tir: 22 * DEG, tirHigh: 42 * DEG, jackLow: 35 * DEG, jack: 55 * DEG },
  tirShort: 0.6, tirShortClose: 0.25, tirHighShort: 0.1,
  gateHit: 0.15, // analytic hit chance a shot needs to be admitted
  stylePref: {},
};

// ---------- Profiles and difficulty (12.7) ----------
// gate = minimum removal gain G to consider a shot (0.9 / appetite)
export const profiles = {
  marcel: { id: 'marcel', lambda0: 0.30, appetite: 0.5, awareness: 1.0, gate: 1.5, jackShy: 0.6, taste: { roulette: 0.22, demi: 0.06 } },
  odette: { id: 'odette', lambda0: 0.15, appetite: 1.3, awareness: 1.0, gate: 0.7, jackShy: 0, taste: { demi: 0.02 } },
  pierre: { id: 'pierre', lambda0: 0.05, appetite: 1.6, awareness: 0.5, gate: 0.5625, jackShy: 0, taste: { demi: 0.04, tir: 0.08 } },
  advice: { id: 'advice', lambda0: 0.15, appetite: 1.0, awareness: 1.0, gate: 0.9, jackShy: 0, taste: {} }, // "You": neutral
};
// Pierre's advice: half his own temperament, half neutral
export function adviceProfile(id = 'pierre') {
  const a = profiles[id] || profiles.pierre, n = profiles.advice;
  const mix = (k) => (a[k] + n[k]) / 2;
  const appetite = mix('appetite');
  return { id: 'advice-' + id, lambda0: mix('lambda0'), appetite, awareness: mix('awareness'), gate: 0.9 / appetite, jackShy: mix('jackShy'), taste: {} };
}

// eps: tactical error rate; pw: weight of priors, awareness and the game term; cap: candidates kept by the pruning;
// jackGain: gain a shot at the jack must promise (Infinity: never considered)
export const DIFFICULTY = {
  easy: { eps: 0.30, pw: 0.3, cap: 6, jackGain: Infinity, baMul: 0.5, noiseMul: 3 },
  medium: { eps: 0.08, pw: 0.8, cap: 8, jackGain: 1.5, baMul: 1, noiseMul: 1 },
  hard: { eps: 0.02, pw: 1.0, cap: 10, jackGain: 0.8, baMul: 1, noiseMul: 1 },
};

// Evaluator weights (12.4); wG is scaled by the principle weight
export function evalParams(diff) {
  return { wE: 1.0, wG: 2.5 * diff.pw, wB: 0.25 * diff.baMul, wM: 0.5, wX: 0.15, wL: 0.2, wF: 0.1 };
}

export function profileFor(player, { advice = false } = {}) {
  if (advice) return adviceProfile('pierre');
  return profiles[player && player.id] || profiles.advice;
}

// The skill a player throws with: the human is never scaled, AI players are scaled by difficulty
export function skillOfPlayer(p, difficulty = 'medium') {
  if (!p || p.isHuman || !(p.skill || SKILL[p.id])) return SKILL.human;
  // a stand-in seat (measure scripts) may carry any skill; it is scaled like an AI's
  return scaledSkill(p.skill || SKILL[p.id], difficulty);
}

// ---------- Analytic cone maths ----------
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const pAbsBelow = (a, sigma) => (sigma <= 0 ? 1 : erf(a / (sigma * Math.SQRT2))); // P(|N(0, sigma)| < a)
const CIRCLE = C.circle;
const along = (dist) => ({ x: CIRCLE.x, y: CIRCLE.y + dist });

// Spread of a pointed boule around its aim (m): the cone of a demi-portée plus the terrain
export function pointSigma(skill, dist, loft = 32 * DEG) {
  const cone = coneFor({ skill, from: CIRCLE, landing: along(Math.max(1, dist)), loft });
  return Math.hypot(cone.sigmaLat, cone.sigmaLong) + 0.15;
}
// Chance a tir moves a boule-sized target: lateral window boule + target radius, longitudinal 25 cm, 0.7 for roll and pebbles
export function analyticHit(skill, dist, { loft = 22 * DEG, rLat = 0.075 } = {}) {
  const cone = coneFor({ skill, from: CIRCLE, landing: along(Math.max(1, dist)), loft });
  return pAbsBelow(rLat, cone.sigmaLat) * pAbsBelow(0.25, cone.sigmaLong) * 0.7;
}

// Jack exposure: 0 beyond 1.3 m of a string or end line, 1 on the line
export function jackExposure(x, y) {
  const edge = Math.min(x, C.terrainW - x, C.terrainL - y);
  return clamp((1.3 - edge) / 1.0, 0, 1);
}
const jackEdge = (x, y) => Math.min(x, C.terrainW - x, C.terrainL - y);

// ---------- The situation model (12.1) ----------
const gapText = (g) => (g < 1 ? `${Math.max(1, Math.round(g * 100))} cm` : `${g.toFixed(1)} m`);

export function readSituation({ match, bodies, player, difficulty = 'medium', advice = false, profile }) {
  const team = player.team, opp = 1 - team;
  const rational = DIFFICULTY[advice ? 'hard' : difficulty] || DIFFICULTY.medium;
  const params = evalParams(rational);
  const jackB = bodies.find((b) => b.kind === 'jack');
  const sit = { team, opp, player, difficulty, advice, diff: rational, params, void: !jackB || !!jackB.dead };
  sit.profile = profile || profileFor(player, { advice });
  sit.skill = skillOfPlayer(player, difficulty);
  const score = match.scores || [0, 0], target = match.target || 13;
  sit.score = { us: score[team], them: score[opp] };
  sit.target = target;
  sit.toGo = { us: Math.max(0, target - score[team]), them: Math.max(0, target - score[opp]) };
  sit.mene = match.mene || 1;
  const hUs = boulesInHand(match, team), hThem = boulesInHand(match, opp);
  sit.hand = { us: hUs, them: hThem };
  sit.handAfter = { us: Math.max(0, hUs - 1), them: hThem };
  sit.BA = hUs - hThem; // boule advantage before the throw: who has more ammunition (12.1 measures it after; this keeps even hands at 0)
  const boules = bodies.filter((b) => b.kind === 'boule');
  sit.deadBefore = { us: boules.filter((b) => b.dead && b.team === team).length, them: boules.filter((b) => b.dead && b.team === opp).length };
  sit.closeOut = { us: sit.toGo.us <= 2, them: sit.toGo.them <= 4 };
  sit.needBig = sit.toGo.us <= 2;
  // players left on each side, with role and skill
  const left = (t) => match.players.filter((p) => p.team === t && p.boulesLeft > 0)
    .map((p) => ({ id: p.id, role: p.role, boules: p.boulesLeft, isHuman: !!p.isHuman, skill: skillOfPlayer(p, difficulty) }));
  sit.left = { us: left(team), them: left(opp) };
  if (sit.void) return sit;
  const jack = { x: jackB.x, y: jackB.y };
  sit.jackPos = jack;
  const dj = dist2(jack, CIRCLE);
  sit.jack = { x: jack.x, y: jack.y, dist: dj, edge: jackEdge(jack.x, jack.y), exposure: jackExposure(jack.x, jack.y) };
  sit.onGround = boules.filter((b) => !b.dead)
    .map((b) => ({ team: b.team === team ? 'us' : 'them', teamIdx: b.team, dist: dist2(b, jack), id: b.id, owner: b.owner, x: b.x, y: b.y }))
    .sort((a, b) => a.dist - b.dist);
  const dOf = (side) => sit.onGround.filter((b) => b.team === side).map((b) => b.dist);
  sit.d = { us: dOf('us'), them: dOf('them') };
  const jk = { x: jack.x, y: jack.y, dead: false };
  const live = boules.filter((b) => !b.dead);
  const hold = holdingTeam(jk, live);
  sit.holder = hold === team ? 'us' : hold === opp ? 'them' : null;
  const res = meneResult(jk, live);
  sit.pts = res.void ? 0 : res.points;
  sit.ptsSigned = sit.holder === 'us' ? sit.pts : sit.holder === 'them' ? -sit.pts : 0;
  sit.margin = (sit.d.them[0] ?? SENTINEL) - (sit.d.us[0] ?? SENTINEL);
  sit.second = sit.onGround[sit.pts] ? sit.onGround[sit.pts].dist : SENTINEL;
  sit.spread = sit.d.us.slice(0, 4);
  sit.laneBlocked = laneBlocked(sit, jack);
  sit.noReply = sit.hand.them === 0 && sit.holder === 'us';
  sit.next = sit.holder === 'us' && sit.hand.them > 0 ? 'them' : 'us';
  // the other side's skill, for the evaluator (12.4): point spread and shot chance at the jack's distance
  const side = (list) => {
    if (!list.length) return { sigma: 0.5, pHit: 0, tireur: false };
    const sigma = Math.min(...list.map((p) => pointSigma(p.skill, dj)));
    const tireur = list.some((p) => p.role === 'tireur');
    const pHit = Math.max(...list.map((p) => analyticHit(p.skill, dj))) * (tireur ? 1 : 0.4);
    return { sigma, pHit, tireur };
  };
  const su = side(sit.left.us), st = side(sit.left.them);
  sit.sigma = { us: su.sigma, them: st.sigma };
  sit.pHitX = { us: su.pHit, them: st.pHit };
  sit.tireur = { us: su.tireur, them: st.tireur };
  sit.pointeur = { us: sit.left.us.some((p) => p.role === 'pointeur'), them: sit.left.them.some((p) => p.role === 'pointeur') };
  const ep = epState(sit, sit.d.us, sit.d.them, sit.handAfter.us, sit.handAfter.them, sit.jack.exposure);
  sit.EPnow = ep.ep;
  sit.V0 = evalEnd(bodies, sit);
  sit.Vpoints = sit.params.wE * ep.ep + sit.params.wG * gameTerm(sit, ep); // points and the game term only: what a dead jack replaces
  sit.lambda = riskLambda(sit);
  return sit;
}

// Is the straight ground path from the circle to `target` blocked by a boule near the line?
function laneBlocked(sit, target) {
  const dx = target.x - CIRCLE.x, dy = target.y - CIRCLE.y, len = Math.hypot(dx, dy) || 1;
  for (const b of sit.onGround) {
    const t = ((b.x - CIRCLE.x) * dx + (b.y - CIRCLE.y) * dy) / len;
    if (t < 1.5 || t > len - 0.1) continue;
    const lat = Math.abs((b.x - CIRCLE.x) * dy - (b.y - CIRCLE.y) * dx) / len;
    if (lat < 0.2) return true;
  }
  return false;
}

// ---------- Evaluation (12.4) ----------
const HOLDER_BONUS = 0.25; // a holder with boules left may add points (plan: 0.2; raised to 0.25 against the scenario table)
// Expected points from the thrower's view for sorted distance lists (us, them), boules in hand after the throw.
// A holder's boule k survives the other side's hX remaining boules with exp(-hX d^2 / 2 sigmaX^2), the first one
// also the chance of being shot out.
export function epState(sit, usD, themD, hT, hO, exposure = 0) {
  const bu = usD[0] ?? Infinity, bt = themD[0] ?? Infinity;
  if (bu === Infinity && bt === Infinity) return { ep: 0, holder: null, n: 0, keeps: [], exposureTerm: 0 };
  if (Math.abs(bu - bt) <= 0.001) return { ep: 0, holder: 'tie', n: 0, keeps: [], exposureTerm: 0 };
  const us = bu < bt;
  const mine = us ? usD : themD, otherBest = us ? bt : bu;
  const hX = us ? hO : hT, hH = us ? hT : hO;
  const sigma = us ? sit.sigma.them : sit.sigma.us;
  const pHit = us ? sit.pHitX.them : sit.pHitX.us;
  const keeps = [];
  let sum = 0;
  for (let k = 0; k < mine.length && mine[k] < otherBest - 0.0005; k++) {
    const risk = k === 0 && hX > 0 ? Math.min(0.6, 0.5 * pHit) : 0;
    const keep = Math.exp(-hX * mine[k] * mine[k] / (2 * sigma * sigma)) * (1 - risk);
    keeps.push(keep);
    sum += keep;
  }
  const hold = sum - (1 - keeps[0]) * 1.2 + HOLDER_BONUS * hH;
  return {
    ep: us ? hold : -hold, holder: us ? 'us' : 'them', n: keeps.length, keeps,
    exposureTerm: us ? exposure * hO * Math.max(0, hold) : 0,
  };
}

// P(we reach the target this mène) - P(they do), from an epState
function gameTerm(sit, st) {
  if (st.holder === 'us' && st.n >= sit.toGo.us && sit.toGo.us > 0) return st.keeps[sit.toGo.us - 1];
  if (st.holder === 'them' && st.n >= sit.toGo.them && sit.toGo.them > 0) return -st.keeps[sit.toGo.them - 1];
  return 0;
}

// Dead jack: the payoff mirrors rules.endMene (void if both teams have boules, else the team with boules scores them)
export function deadJackPayoff(hT, hO, toGo, params) {
  if (hT > 0 && hO > 0) return -0.15;
  if (hT > 0) return hT + params.wG * (hT >= toGo.us ? 1 : 0);
  if (hO > 0) return -hO - params.wG * (hO >= toGo.them ? 1 : 0);
  return -0.15;
}

// Value of a settled state (bodies after a simulated throw) for the thrower's team, in mène points
export function evalEnd(bodies, sit, params = sit.params) {
  const hT = sit.handAfter.us, hO = sit.handAfter.them;
  let jack = null;
  for (let i = 0; i < bodies.length; i++) if (bodies[i].kind === 'jack') { jack = bodies[i]; break; }
  if (!jack || jack.dead) return deadJackPayoff(hT, hO, sit.toGo, params);
  const us = [], them = [];
  let deadOwn = 0, deadFoe = 0;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (b.kind !== 'boule') continue;
    if (b.dead) { if (b.team === sit.team) deadOwn++; else deadFoe++; continue; }
    (b.team === sit.team ? us : them).push(Math.hypot(b.x - jack.x, b.y - jack.y));
  }
  us.sort((a, b) => a - b); them.sort((a, b) => a - b);
  const st = epState(sit, us, them, hT, hO, jackExposure(jack.x, jack.y));
  const g = gameTerm(sit, st);
  const wB = params.wB * (st.holder === 'us' && hO === 0 ? 0.5 : 1);
  const dT = us[0] ?? SENTINEL, dO = them[0] ?? SENTINEL;
  return params.wE * st.ep + params.wG * g + wB * clamp(hT - hO, -3, 3) + params.wM * clamp(dO - dT, -1, 1) -
    params.wX * st.exposureTerm - params.wL * Math.max(0, deadOwn - sit.deadBefore.us) + params.wF * Math.max(0, deadFoe - sit.deadBefore.them);
}

// Same, from sorted distance lists (static analysis in the planner)
function evalDists(sit, usD, themD, exposure = sit.jack.exposure) {
  const hT = sit.handAfter.us, hO = sit.handAfter.them, params = sit.params;
  const st = epState(sit, usD, themD, hT, hO, exposure);
  return st;
}

// ---------- Risk attitude (12.4) ----------
export function riskLambda(sit) {
  if (sit.noReply) return 0;
  const aw = sit.profile.awareness * sit.diff.pw, pw = sit.diff.pw;
  const fBA = 1 + 0.25 * clamp(-sit.BA, -2, 2) * aw;
  const fLast = sit.hand.us === 1 && sit.holder !== 'us' ? 1 + 0.3 * aw : 1;
  const fDesp = 1 - 0.6 * clamp((-sit.EPnow - 1.5) / 2.5, 0, 1) * pw;
  const fClose = sit.closeOut.us ? 1 + 0.4 * aw : sit.closeOut.them && sit.EPnow < 0 ? 1 - 0.4 * aw : 1;
  return sit.profile.lambda0 * fBA * fLast * fDesp * fClose;
}

// ---------- Removal gain and analytic scores (12.2) ----------
// Value of the ground without the boules in `skip` (a Set of ids), minus the value now
export function removalGain(sit, targetIds) {
  const skip = targetIds instanceof Set ? targetIds : new Set([targetIds]);
  const usD = sit.d.us, themD = sit.onGround.filter((b) => b.team === 'them' && !skip.has(b.id)).map((b) => b.dist);
  const after = evalDists(sit, usD, themD);
  return { G: after.ep - sit.EPnow, after };
}

// Our points now and after removing a target, their points removed
function unlockOf(sit, t) {
  const themD = sit.onGround.filter((b) => b.team === 'them' && b.id !== t.id).map((b) => b.dist);
  const after = evalDists(sit, sit.d.us, themD);
  const ours = sit.holder === 'us' ? sit.pts : 0, theirs = sit.holder === 'them' ? sit.pts : 0;
  const oursAfter = after.holder === 'us' ? after.n : 0, theirsAfter = after.holder === 'them' ? after.n : 0;
  return { unlock: Math.max(0, oursAfter - ours), removed: Math.max(0, theirs - theirsAfter) };
}

const pushRisk = (sit, t) => {
  // the jack nudged along the throw line (circle to target) toward one of their boules within 0.8 m
  if (dist2(t, sit.jackPos) > 0.25) return 0;
  const dx = t.x - CIRCLE.x, dy = t.y - CIRCLE.y, len = Math.hypot(dx, dy) || 1;
  for (const b of sit.onGround) {
    if (b.team !== 'them' || b.id === t.id || b.dist > 0.8) continue;
    const bx = b.x - sit.jackPos.x, by = b.y - sit.jackPos.y;
    const fwd = (bx * dx + by * dy) / len, lat = Math.abs(bx * dy - by * dx) / len;
    if (fwd > 0 && lat < 0.3) return 1;
  }
  return 0;
};

// ---------- Candidate families (12.2, 12.3) ----------
function addPart(c, code, v) { c.parts[code] = (c.parts[code] || 0) + v; }

export function plan(sit, cfg = DEFAULT_CFG, { loose = false } = {}) {
  const out = { cands: [], dropped: [], all: [] };
  if (sit.void) return out;
  const L = cfg.lofts, pw = sit.diff.pw, prof = sit.profile;
  const aw = prof.awareness * pw;
  const J = sit.jackPos, dj = sit.jack.dist;
  const ux = (J.x - CIRCLE.x) / dj, uy = (J.y - CIRCLE.y) / dj, px = uy, py = -ux; // along and to the right
  const BA = sit.BA;
  const downW = BA <= -1 ? Math.min(-BA, 2) : 0, upW = BA >= 1 ? Math.min(BA, 2) : 0;
  const themBoules = sit.onGround.filter((b) => b.team === 'them');
  const themBest = themBoules[0];
  const margin = sit.margin;
  const exposure = sit.jack.exposure;
  const themLeft = sit.left.them;
  const themPointeur = themLeft.some((p) => p.role === 'pointeur'), themTireur = themLeft.some((p) => p.role === 'tireur');
  const desperate = clamp((-sit.EPnow - 1.5) / 2.5, 0, 1);
  const stylePref = cfg.stylePref || {};
  const taste = (style) => (prof.taste[style] || 0) + ((stylePref[sit.player.id] || {})[style] || 0);

  const mk = (family, style, intent, target, extra = {}) => ({
    family, style, loft: L[style], intent, target, tag: intent === 'point' ? style : 'boule', parts: {}, credit: {}, prior: 0, a: 0, ...extra,
  });
  const pointInfo = (c) => {
    const off = dist2(c.target, J);
    c.off = off;
    const sig = pointSigma(sit.skill, dj, c.loft);
    const pClose = 1 - Math.exp(-((0.25 + 0.6 * off) ** 2) / (2 * sig * sig));
    const dd = Math.max(0.1, off);
    const after = evalDists(sit, [dd, ...sit.d.us].sort((x, y) => x - y), sit.d.them);
    c.pClose = pClose;
    c.value = pClose * (after.ep - sit.EPnow) - (1 - pClose) * 0.1;
  };
  const pointPriors = (c) => {
    if (taste(c.style)) c.parts.taste = taste(c.style);
    if (downW && c.family !== 'pointBehind') addPart(c, 'downOnBoules', 0.15 * aw);
    if (sit.noReply && (c.family === 'pointJack' || c.family === 'pointSlot')) addPart(c, 'noReply', 0.1);
    if (sit.hand.us === 1 && sit.holder !== 'us') c.credit.lastBoule = 0.12 * aw;
    if (sit.closeOut.us && !sit.noReply) c.credit.closeOut = 0.3 * pw;
    if (downW) c.credit.downOnBoules = 0.1 * downW;
  };
  const cands = [];
  // pointJack
  for (const style of ['roulette', 'demi', 'plombee']) {
    if (style === 'roulette' && sit.laneBlocked && !loose) continue;
    cands.push(mk('pointJack', style, 'point', { x: J.x, y: J.y }));
  }
  // pointSlot: beside the jack where their best boule is not
  if (themBest && sit.holder === 'them' && (margin < (sit.diff === DIFFICULTY.hard ? -0.05 : -0.1) || loose) && themBest.dist <= 0.8) {
    const r = Math.max(0.12, 0.7 * themBest.dist);
    let n = 0;
    for (const sgn of [1, -1]) {
      const t = { x: J.x + px * sgn * r, y: J.y + py * sgn * r };
      if (sit.onGround.some((b) => dist2(b, t) < 0.1)) continue;
      if (n++ >= 2) break;
      for (const style of ['demi', 'plombee']) cands.push(mk('pointSlot', style, 'point', t));
    }
  }
  // pointFront: a blocker 0.3 m short of the jack on the line
  const behindTheirs = themBest && themBest.dist < 0.4 && ((themBest.x - J.x) * ux + (themBest.y - J.y) * uy) > 0.02;
  if ((themPointeur && sit.onGround.length > 0) || behindTheirs || loose) {
    for (const style of ['plombee', 'demi']) cands.push(mk('pointFront', style, 'point', { x: J.x - ux * 0.3, y: J.y - uy * 0.3 }));
  }
  // pointBehind: cover the jack
  if ((exposure >= 0.4 && themTireur) || (sit.holder === 'us' && sit.hand.them > 0) || loose) {
    const spots = [{ x: J.x + ux * 0.4, y: J.y + uy * 0.4 }, { x: J.x + ux * 0.35 + px * 0.3, y: J.y + uy * 0.35 + py * 0.3 }, { x: J.x + ux * 0.35 - px * 0.3, y: J.y + uy * 0.35 - py * 0.3 }];
    const nSpots = sit.diff === DIFFICULTY.hard ? 3 : 2;
    for (const t of spots.slice(0, nSpots)) for (const style of ['demi', 'plombee']) cands.push(mk('pointBehind', style, 'point', t));
  }
  for (const c of cands) {
    pointPriors(c);
    if (c.family === 'pointFront') {
      if (themPointeur && sit.onGround.length > 0 && !sit.laneBlocked) { addPart(c, 'blockFront', 0.2 * pw); }
      if (downW) addPart(c, 'downOnBoules', 0); // already counted above
    }
    if (c.family === 'pointBehind' && themTireur) {
      addPart(c, exposure >= 0.6 ? 'coverJack' : 'safetyBehind', 0.4 * exposure * pw);
    }
    pointInfo(c);
  }

  // shootBoule
  const shots = [];
  const gate = Math.max(0.2, prof.gate * (1 + 0.6 * Math.max(0, -BA)) - 0.2 * upW * aw);
  for (const t of themBoules) {
    if (t.dist > 1.4) continue;
    if (t.y > C.terrainL - 1 || t.y < 2) continue;
    const { G: G0 } = removalGain(sit, t.id);
    const dT = dist2(t, CIRCLE);
    const pHit = analyticHit(sit.skill, dT);
    const { unlock, removed } = unlockOf(sit, t);
    const collateral = sit.onGround.filter((b) => b.team === 'us' && b.id !== t.id && dist2(b, t) < 0.3).length;
    const jackNear = dist2(t, J) < 0.25 ? 1 : 0;
    const unlockNet = collateral > 0 ? 0 : unlock; // our boule beside the target is likely to be knocked as well
    const G = G0 + 0.5 * unlockNet * pw + (removed >= 2 ? 0.3 * pw : 0); // R3 raises G: bringing boules in or deleting points makes the target worth a look
    const miss = 0.15 + 0.35 * collateral + 0.3 * jackNear;
    const A = pHit * G - (1 - pHit) * miss;
    const info = { t, G, pHit, unlock, removed, collateral, jackNear, A };
    if (!loose && (G < gate || pHit < cfg.gateHit)) {
      // a shot that would have passed but for the risk to our own boules and the jack: reported as protectOwn
      if (pHit >= cfg.gateHit && collateral > 0 && G + 0.35 * collateral + 0.3 * jackNear >= gate) sit.protectDropped = sit.protectDropped || { collateral };
      out.dropped.push({ code: 'gate', ...info });
      continue;
    }
    if (!loose && collateral >= 2 && G < 2) { sit.protectDropped = sit.protectDropped || { collateral }; out.dropped.push({ code: 'protectOwn', ...info }); continue; }
    shots.push(info);
  }
  shots.sort((a, b) => b.A - a.A);
  for (const s of shots.slice(0, 2)) {
    for (const [style, short] of [['tir', cfg.tirShort], ['tir', cfg.tirShortClose], ['tirHigh', cfg.tirHighShort]]) {
      const c = mk('shootBoule', style, 'shoot', { x: s.t.x, y: s.t.y }, { shortBy: short, tag: 'boule', targetId: s.t.id, info: s });
      const pos = [], neg = [];
      const add = (code, v) => { addPart(c, code, v); (v >= 0 ? pos : neg).push(v); };
      if (downW) add('downOnBoules', -0.4 * downW * aw);
      if (upW) add('upOnBoules', 0.25 * upW * aw * clamp(s.G, 0, 1)); // a free shot is only worth taking if the target is worth removing
      if (s.unlock > 0 && s.collateral === 0) add('bringInBoules', 0.3 * s.unlock * pw);
      if (s.removed >= 2) add('removePoints', 0.2 * pw);
      else if (s.removed >= 1) c.credit.removePoints = 0.4 * pw; // reason only: the closest boule of a holder goes
      if (s.collateral > 0) add('protectOwn', -0.25 * s.collateral * pw);
      if (pushRisk(sit, s.t)) add('protectOwn', -(s.removed >= 1 ? 0.2 : 0.4) * pw); // taking out their holder is worth some jack movement
      if (sit.noReply) add('noReply', -0.5);
      // appetite stretches the pull towards a shot and softens what holds it back
      // (downOnBoules is a hard fact about ammunition, not a taste: appetite does not soften it)
      for (const code of Object.keys(c.parts)) if (code !== 'downOnBoules') c.parts[code] *= c.parts[code] >= 0 ? prof.appetite : 1 / prof.appetite;
      const tot = Object.values(c.parts).reduce((x, y) => x + y, 0);
      if (Math.abs(tot) > 0.5) for (const code of Object.keys(c.parts)) c.parts[code] *= 0.5 / Math.abs(tot);
      if (taste(style === 'tirHigh' ? 'tir' : style)) c.parts.taste = taste(style === 'tirHigh' ? 'tir' : style);
      if (sit.hand.us === 1 && sit.holder !== 'us') c.credit.lastBoule = 0;
      if (sit.closeOut.them && sit.EPnow < -1) c.credit.closeOut = 0.3 * pw;
      c.a = s.A;
      cands.push(c);
    }
  }

  // shootJack: the dead-jack payoff against the status quo
  if (sit.diff.jackGain < Infinity || loose) {
    const payoff = deadJackPayoff(sit.handAfter.us, sit.handAfter.them, sit.toGo, sit.params);
    const gain = payoff - sit.Vpoints;
    const trick = sit.handAfter.us > 0 && sit.handAfter.them === 0 && payoff > 0;
    const ok = gain >= sit.diff.jackGain || (exposure >= 0.6 && trick);
    if ((ok || loose) && J.y < C.terrainL - 1 && J.y > 2) {
      const pHit = analyticHit(sit.skill, dj, { rLat: 0.0525 });
      const pOut = 0.45 + 0.3 * exposure;
      const A = pHit * pOut * gain - (1 - pHit * pOut) * 0.3;
      const code = sit.handAfter.us > 0 && sit.handAfter.them === 0 ? 'jackScoreTrick' : 'voidMene';
      for (const [style, short] of [['tir', cfg.tirShort], ['tir', cfg.tirShortClose], ['tirHigh', cfg.tirHighShort]]) {
        const c = mk('shootJack', style, 'shoot', { x: J.x, y: J.y }, { shortBy: short, tag: 'jack', info: { G: gain, pHit: pHit * pOut, A } });
        c.credit[code] = 0.5;
        // the trick is a sure score the sims undervalue (a cluster shot scatters the boules, a jack shot ends the mène); appetite stretches it
        if (code === 'jackScoreTrick') addPart(c, 'jackScoreTrick', 0.45 * pw * prof.appetite);
        else if (-sit.ptsSigned >= 3) addPart(c, 'voidMene', 0.3 * pw); // wiping out a mène we are losing by 3 or more
        if (prof.jackShy) c.parts.jackShy = -prof.jackShy * (1 - 0.6 * desperate);
        if (sit.closeOut.them && sit.EPnow < -1) c.credit.closeOut = 0.3 * pw;
        if (taste('tir')) c.parts.taste = taste('tir');
        c.a = A;
        cands.push(c);
      }
    }
  }

  if (sit.protectDropped) for (const c of cands) if (c.intent === 'point') c.credit.protectOwn = 0.3;
  for (const c of cands) {
    const tot = Object.entries(c.parts).filter(([k]) => k !== 'taste' && k !== 'jackShy').reduce((x, [, v]) => x + v, 0);
    c.prior = clamp(tot, -0.5, 0.5) + (c.parts.taste || 0) + (c.parts.jackShy || 0);
    c.a = (c.intent === 'point' ? c.value : c.a) + c.prior;
  }

  // keep within the field
  const inField = cands.filter((k) => k.target.y < C.terrainL - 0.5 && k.target.y > 2 && k.target.x > 0.3 && k.target.x < C.terrainW - 0.3);
  out.all = inField.slice();
  // prune: more than 1.5 below the best, near-duplicates, and the cap
  inField.sort((x, y) => y.a - x.a);
  const best = inField.length ? inField[0].a : 0;
  const kept = [];
  for (const c of inField) {
    if (c.a < best - 1.5 && !loose) continue;
    if (kept.some((k) => k.style === c.style && k.intent === c.intent && dist2(k.target, c.target) < 0.15 && k.family !== 'shootJack' && c.family !== 'shootJack' && k.targetId === c.targetId)) continue;
    kept.push(c);
  }
  const cap = loose ? 99 : sit.diff.cap;
  let capped = kept.slice(0, cap);
  // keep the best shot and the best jack shot in the field even if the cap would cut it
  for (const fam of ['shootBoule', 'shootJack']) {
    const first = kept.find((c) => c.family === fam);
    if (first && !capped.includes(first)) capped = capped.slice(0, cap - 1).concat(first);
  }
  out.cands = capped;
  return out;
}

// ---------- Explanation (12.5) ----------
const SPECIFIC = new Set(['bringInBoules', 'removePoints', 'voidMene', 'jackScoreTrick', 'protectOwn', 'blockFront', 'coverJack', 'safetyBehind', 'noReply', 'closeOut', 'lastBoule']);

export function reasonParams(code, sit, win) {
  const info = (win && win.info) || {};
  switch (code) {
    case 'takePoint': { const t = sit.d.them[0]; return { gap: gapText(t === undefined ? 3 : t) }; }
    case 'holdPoint': return {};
    case 'downOnBoules': return { BA: sit.BA, n: Math.abs(sit.BA), hand: sit.hand.us };
    case 'upOnBoules': return { BA: sit.BA, n: sit.BA };
    case 'bringInBoules': return { unlock: info.unlock || 1, n: info.unlock || 1 };
    case 'removePoints': return { removed: info.removed || sit.pts, n: sit.holder === 'them' ? sit.pts : info.removed || 1 };
    case 'protectOwn': return { collateral: info.collateral || 1, n: info.collateral || 1 };
    case 'closeOut': return { toGo: sit.closeOut.us ? sit.toGo.us : sit.toGo.them, n: sit.closeOut.us ? sit.toGo.us : sit.toGo.them };
    case 'voidMene': return { losing: -sit.ptsSigned, n: Math.max(0, -sit.ptsSigned) };
    case 'jackScoreTrick': return { hT: sit.handAfter.us, n: sit.handAfter.us };
    case 'safetyBehind': case 'coverJack': return { exposure: sit.jack.exposure };
    default: return {};
  }
}

// The principle that contributed most to the winner relative to the runner-up (largest prior or credit), or
// takePoint / holdPoint when nothing exceeded 0.1
export function explain(win, run, sit) {
  if (run && run.family === win.family) run = null; // a sibling with the same priors says nothing
  const codes = new Set([...Object.keys(win.parts), ...Object.keys(win.credit)]);
  let best = null;
  for (const code of codes) {
    if (code === 'taste' || code === 'jackShy') continue;
    let v = (win.parts[code] || 0) + (win.credit[code] || 0) - (run ? (run.parts[code] || 0) : 0);
    if (v < 0.1) continue;
    if (SPECIFIC.has(code)) v += 0.35; // a specific tactical reason reads better than the generic boule count
    if (!best || v > best.v) best = { code, v };
  }
  let code = best ? best.code : null;
  if (!code) {
    if (win.family === 'shootBoule') code = win.info && win.info.removed > 0 ? 'removePoints' : win.info && win.info.unlock > 0 ? 'bringInBoules' : 'takePoint';
    else if (win.family === 'shootJack') code = sit.handAfter.us > 0 && sit.handAfter.them === 0 ? 'jackScoreTrick' : 'voidMene';
    else code = sit.holder === 'us' ? 'holdPoint' : 'takePoint';
  }
  return { code, ...reasonParams(code, sit, win) };
}

// ---------- Who throws (12.2) ----------
// Per player, the best analytic family score using that player's own cone. Returns { player, scores, only }.
// `players` are the match players of the team with boules left (default: all of them).
export function whoThrows({ match, bodies, team, difficulty = 'medium', cfg = DEFAULT_CFG, players }) {
  const avail = players || match.players.filter((p) => p.team === team && p.boulesLeft > 0);
  if (avail.length <= 1) return { player: avail[0] || null, scores: {}, only: true };
  const scores = {};
  for (const p of avail) {
    const sit = readSituation({ match, bodies, player: p, difficulty }); // each with their own profile and cone
    const { cands } = plan(sit, cfg);
    scores[p.id] = cands.length ? Math.max(...cands.map((c) => c.a)) : -9;
  }
  const order = avail.slice().sort((a, b) => scores[b.id] - scores[a.id]);
  let pick = order[0];
  const tied = order.filter((p) => scores[order[0].id] - scores[p.id] <= 0.25);
  if (tied.length > 1) {
    const most = Math.max(...tied.map((p) => p.boulesLeft));
    const withMost = tied.filter((p) => p.boulesLeft === most);
    pick = withMost.find((p) => p.isHuman) || withMost[0];
  }
  return { player: pick, scores, only: false };
}
