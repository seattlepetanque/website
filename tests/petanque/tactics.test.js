// Tactics (GAME-PLAN 12.8): static checks on hand-built states, then the scenario table with a seeded Monte Carlo
// agreement threshold at Hard (20 seeds, decision class holds in >= 70%).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBody } from '../../assets/js/petanque/physics.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { apply, createMatch } from '../../assets/js/petanque/rules.js';
import { AI, chooseThrow } from '../../assets/js/petanque/ai.js';
import {
  readSituation, plan, evalEnd, deadJackPayoff, explain, whoThrows, riskLambda, removalGain, profiles, DIFFICULTY, DEFAULT_CFG, adviceProfile,
} from '../../assets/js/petanque/tactics.js';
import { LINES, createCommentary } from '../../assets/js/petanque/personalities.js';
import { scenarios, chooserScenarios, build } from './tactics-scenarios.js';

const sc = (id) => scenarios.find((s) => s.id === id);
const situation = (spec, difficulty = 'hard', who) => {
  const s = build(who ? { ...spec, thrower: who } : spec);
  return { s, sit: readSituation({ match: s.match, bodies: s.world.bodies, player: s.player, difficulty }) };
};
const SEEDS = 20;
// share of seeds (of SEEDS) whose decision satisfies `ok`
function agree(spec, ok, { difficulty = 'hard', who, seeds = SEEDS } = {}) {
  let n = 0;
  const seen = {};
  for (let i = 0; i < seeds; i++) {
    const s = build(who ? { ...spec, thrower: who } : spec, { seed: i });
    const r = chooseThrow({ world: s.world, match: s.match, player: s.player, difficulty, rand: mulberry32(1000 + i) });
    const k = `${r.family}/${r.style}/${r.why.code}`;
    seen[k] = (seen[k] || 0) + 1;
    if (ok(r)) n++;
  }
  return { rate: n / seeds, seen: JSON.stringify(seen) };
}
const atLeast = (res, p, msg) => assert.ok(res.rate >= p, `${msg}: ${(res.rate * 100).toFixed(0)}% ${res.seen}`);
const atMost = (res, p, msg) => assert.ok(res.rate <= p, `${msg}: ${(res.rate * 100).toFixed(0)}% ${res.seen}`);
const isShoot = (r) => r.intent === 'shoot';
const isPoint = (r) => r.intent === 'point';

AI.timeGuard = false; // decisions in these tests are deterministic; the guard has its own test below

// ---------- static ----------

test('readSituation: hands, boule advantage, holder, margin and jack on a hand-built court', () => {
  const { sit } = situation(sc(4), 'medium');
  assert.deepEqual(sit.hand, { us: 3, them: 1 });
  assert.deepEqual(sit.handAfter, { us: 2, them: 1 });
  assert.equal(sit.BA, 2);
  assert.equal(sit.holder, 'them');
  assert.equal(sit.pts, 2);
  assert.equal(sit.ptsSigned, -2);
  assert.ok(Math.abs(sit.margin - (0.9 - 0.1)) < 1e-9 === false && sit.margin < 0, 'margin negative: they lead');
  assert.ok(Math.abs(sit.margin - (0.1 - 0.9)) < 1e-6);
  assert.ok(Math.abs(sit.second - 0.9) < 1e-6, 'the first boule outside the holder\'s points is ours at 0.9');
  assert.equal(sit.jack.dist.toFixed(1), '7.0');
  assert.equal(sit.jack.exposure, 0);
  assert.equal(sit.toGo.us, 13);
  assert.equal(sit.laneBlocked, false);
  assert.deepEqual(sit.onGround.map((b) => b.team), ['them', 'them', 'us']);
  assert.equal(sit.left.us.length, 2);
  const j = situation(sc(9)).sit;
  assert.ok(Math.abs(j.jack.edge - 0.5) < 1e-9 && Math.abs(j.jack.exposure - 0.8) < 1e-9);
  const t = situation({ ...sc(10), thrower: 'odette' }).sit;
  assert.deepEqual(t.toGo, { us: 8, them: 2 });
  assert.equal(t.closeOut.them, true);
  // a blocked lane
  const b = situation({ thrower: 'marcel', us: { hand: [1, 1] }, them: { hand: [1, 1], boules: [[0.0, -3]] } }).sit;
  assert.equal(b.laneBlocked, true);
});

test('evalEnd is monotone in points held, in distance and in boules in hand', () => {
  const { s, sit } = situation(sc(1), 'medium');
  const jack = { kind: 'jack', x: 2, y: 8 };
  const mine = (d, n = 1) => Array.from({ length: n }, (_, i) => ({ kind: 'boule', team: s.team, x: 2 + d + i * 0.1, y: 8, dead: false }));
  const theirs = (d) => ({ kind: 'boule', team: 1 - s.team, x: 2, y: 8 + d, dead: false });
  const v = (bodies, hand) => evalEnd(bodies, { ...sit, handAfter: hand || sit.handAfter });
  assert.ok(v([jack, ...mine(0.1, 2), theirs(0.6)]) > v([jack, ...mine(0.1, 1), theirs(0.6)]), 'more points held');
  assert.ok(v([jack, ...mine(0.1), theirs(0.6)]) > v([jack, ...mine(0.4), theirs(0.6)]), 'closer is better');
  assert.ok(v([jack, ...mine(0.4), theirs(0.6)]) > v([jack, theirs(0.6)]), 'a point beats none');
  assert.ok(v([jack, theirs(0.2)]) < v([jack, theirs(0.5)]), 'their closer boule is worse for us');
  assert.ok(v([jack, ...mine(0.2), theirs(0.6)], { us: 2, them: 1 }) > v([jack, ...mine(0.2), theirs(0.6)], { us: 0, them: 1 }), 'boules in hand');
  assert.ok(v([jack, ...mine(0.2), theirs(0.6)], { us: 1, them: 0 }) > v([jack, ...mine(0.2), theirs(0.6)], { us: 1, them: 3 }), 'their boules in hand hurt');
});

test('dead-jack payoff equals rules.endMene for the four hand combinations', () => {
  const params = { wG: 2.5 };
  for (const [h0, h1] of [[2, 1], [2, 0], [0, 3], [0, 0]]) {
    let m = createMatch({});
    m = { ...m, phase: 'play', jack: { x: 2, y: 8 }, boules: [], players: m.players.map((p) => ({ ...p, boulesLeft: p.team === 0 ? (p.id === 'you' ? h0 : 0) : (p.id === 'marcel' ? h1 : 0) })) };
    m = apply(m, { type: 'throwSettled', jack: { x: 2, y: 8, dead: true }, boules: [] });
    const toGo = { us: 13, them: 13 };
    const pay = deadJackPayoff(h0, h1, toGo, params); // team 0's view
    const result = m.result;
    if (result.void) assert.ok(pay === -0.15, `void ${h0}/${h1}`);
    else if (result.team === 0) assert.ok(pay >= result.points && Math.abs(pay - result.points) < 1e-9, `we score ${h0}/${h1}`);
    else assert.ok(pay <= -result.points && Math.abs(pay + result.points) < 1e-9, `they score ${h0}/${h1}`);
  }
  // the game term: scoring enough to win counts for more
  assert.ok(deadJackPayoff(2, 0, { us: 2, them: 13 }, params) > deadJackPayoff(2, 0, { us: 13, them: 13 }, params));
});

test('A(t) ranks the closer target higher, and R3 raises the removal gain', () => {
  const spec = { thrower: 'odette', us: { hand: [1, 2] }, them: { hand: [0, 1], boules: [[0.1, 0], [0, 0.45]] } };
  const { sit } = situation(spec);
  const p = plan(sit, DEFAULT_CFG, { loose: true });
  const A = (dy) => p.cands.find((c) => c.family === 'shootBoule' && Math.abs(c.target.y - (8 + dy)) < 1e-6).info.A;
  assert.ok(A(0) > A(0.45), `A close ${A(0)} vs far ${A(0.45)}`);
  const closest = sit.onGround.find((b) => b.team === 'them');
  assert.ok(removalGain(sit, closest.id).G > 0);
});

test('admission: shot gates differ by personality; case 8 admits no shootJack, case 7 does; caps hold', () => {
  const two = situation(sc(2), 'hard', 'odette').sit, twoM = situation(sc(2), 'hard', 'marcel').sit;
  assert.ok(plan(two).cands.some((c) => c.family === 'shootBoule'), 'Odette considers the shot (G ~ 0.8 passes her gate 0.7)');
  assert.ok(!plan(twoM).cands.some((c) => c.family === 'shootBoule'), 'Marcel\'s gate of 1.8 keeps him pointing');
  assert.ok(!plan(situation(sc(8)).sit).cands.some((c) => c.family === 'shootJack'), 'dead jack hands them 3 > their 2 points');
  assert.ok(plan(situation(sc(7)).sit).cands.some((c) => c.family === 'shootJack'), 'void payoff -0.15 against about -3.3');
  assert.ok(!plan(situation(sc(7), 'easy').sit).cands.some((c) => c.family === 'shootJack'), 'Easy never considers it');
  for (const d of ['easy', 'medium', 'hard']) {
    for (const spec of scenarios) {
      const n = plan(situation(spec, d).sit).cands.length;
      assert.ok(n <= DIFFICULTY[d].cap + 1, `${d} #${spec.id}: ${n} candidates`);
    }
  }
  assert.ok(plan(situation(sc(12)).sit).cands.some((c) => c.family === 'pointBehind'), 'jack near the string: cover it');
  assert.ok(!plan(situation(sc(1)).sit).cands.some((c) => c.family === 'pointFront'), 'no blocker on an empty court');
});

test('static reasons: removePoints, protectOwn, coverJack, noReply, downOnBoules', () => {
  const top = (spec, who, difficulty) => {
    const { sit } = situation(spec, difficulty || 'hard', who);
    const p = plan(sit).cands.slice().sort((a, b) => b.a - a.a);
    const run = p.find((c) => c.family !== p[0].family) || p[1];
    return { why: explain(p[0], run, sit), top: p[0], p };
  };
  assert.equal(top(sc(4)).why.code, 'removePoints');
  assert.equal(top(sc(6)).why.code, 'protectOwn');
  assert.equal(top(sc(12)).why.code, 'coverJack');
  assert.equal(top(sc(11)).why.code, 'noReply');
  assert.equal(top(sc(5)).why.code, 'bringInBoules');
  assert.equal(top(sc(1)).why.code, 'takePoint');
  assert.ok(['downOnBoules', 'blockFront', 'lastBoule'].includes(top(sc(3)).why.code));
  assert.equal(top(sc(7)).top.family, 'shootJack');
});

test('risk lambda: careful when down on boules, free when losing big, zero with no reply, careful near the win', () => {
  const lam = (spec, who) => situation(spec, 'hard', who).sit.lambda;
  assert.ok(lam(sc(3)) > lam(sc(4)), 'down on boules is more careful than up');
  assert.equal(lam(sc(11)), 0);
  const calm = lam({ ...sc(2) });
  const losing = lam({ ...sc(7) });
  assert.ok(losing < calm, 'losing big takes the gamble');
  assert.ok(lam(sc(1), 'marcel') > lam(sc(1), 'odette') && lam(sc(1), 'odette') > lam(sc(1), 'pierre'), 'Marcel > Odette > Pierre');
  assert.ok(lam({ ...sc(1), score: [12, 3] }) > lam(sc(1)), 'about to win: more careful');
});

test('whoThrows: Pierre shoots (14), You point (15), only Pierre (16); the suggestion reads removePoints', () => {
  const ch = (id) => {
    const spec = chooserScenarios.find((c) => c.id === id);
    const s = build(spec);
    return { s, w: whoThrows({ match: s.match, bodies: s.world.bodies, team: s.team, difficulty: 'hard' }) }; // at Hard Pierre's cone beats the human's; at Medium the unscaled human is the better shot
  };
  assert.equal(ch(14).w.player.id, 'pierre');
  assert.equal(ch(15).w.player.id, 'you');
  const sixteen = ch(16).w;
  assert.equal(sixteen.player.id, 'pierre');
  assert.equal(sixteen.only, true);
  // the advice for case 14: Pierre's blend at Hard rationality
  const s = build(chooserScenarios.find((c) => c.id === 14));
  const r = chooseThrow({ world: s.world, match: s.match, player: s.match.players.find((p) => p.id === 'pierre'), difficulty: 'medium', rand: mulberry32(3), advice: true });
  assert.ok(['removePoints', 'upOnBoules'].includes(r.why.code), r.why.code);
  assert.equal(r.intent, 'shoot');
  const talk = createCommentary(mulberry32(1));
  assert.match(talk.say('pierre', 'suggest.removePoints', { n: 2 }), /Pierre/);
  assert.match(talk.say('pierre', 'who.youPoint'), /You point/);
  // the blend sits between Pierre and neutral
  const adv = adviceProfile('pierre');
  assert.ok(adv.appetite > profiles.advice.appetite && adv.appetite < profiles.pierre.appetite);
});

test('every reason code has a line for each character, and the difficulty table has the agreed error rates', () => {
  const codes = ['takePoint', 'holdPoint', 'downOnBoules', 'upOnBoules', 'bringInBoules', 'removePoints', 'protectOwn', 'lastBoule', 'closeOut',
    'voidMene', 'jackScoreTrick', 'blockFront', 'safetyBehind', 'coverJack', 'noReply'];
  for (const id of ['marcel', 'odette', 'pierre']) for (const c of codes) assert.ok(LINES[id].why[c] && LINES[id].why[c].length >= 1, `${id} why.${c}`);
  for (const c of codes) assert.ok(LINES.pierre.suggest[c] && LINES.pierre.suggest[c].length >= 1, `suggest.${c}`);
  assert.deepEqual([DIFFICULTY.easy.eps, DIFFICULTY.medium.eps, DIFFICULTY.hard.eps], [0.30, 0.08, 0.02]);
});

test('decisions carry a reason, a family and the player; the wall-clock guard returns a decision', () => {
  const s = build(sc(4));
  const r = chooseThrow({ world: s.world, match: s.match, player: s.player, difficulty: 'medium', rand: mulberry32(2) });
  assert.ok(r.why && typeof r.why.code === 'string' && r.family && r.who === 'odette');
  AI.timeGuard = true;
  const saved = AI.timeGuardMs.medium;
  AI.timeGuardMs.medium = 0; // out of time at once: one candidate is still simulated
  try {
    const g = chooseThrow({ world: s.world, match: s.match, player: s.player, difficulty: 'medium', rand: mulberry32(2) });
    assert.ok(g.throwParams && g.why);
    assert.ok(!g.info.sims || g.info.sims <= 12, `guard cut the work (${g.info.sims} sims)`);
  } finally { AI.timeGuard = false; AI.timeGuardMs.medium = saved; }
});

// ---------- Monte Carlo agreement (Hard, 20 seeds) ----------

test('scenarios 1-3: first point, the tireur shoots at an even court, nobody shoots when down on boules', { timeout: 120000 }, () => {
  atLeast(agree(sc(1), (r) => isPoint(r) && r.family === 'pointJack'), 0.7, '#1 pointJack');
  atLeast(agree(sc(2), isShoot), 0.6, '#2 Odette shoots');
  atMost(agree(sc(2), isShoot, { who: 'marcel' }), 0.3, '#2 Marcel points');
  atLeast(agree(sc(3), isPoint), 0.7, '#3 Odette points');
  atMost(agree(sc(3), isShoot, { who: 'pierre' }), 0.35, '#3 Pierre shoots at most 35%');
  atMost(agree(sc(3), isShoot), 0.15, '#3 Odette shoots at most 15%');
});

test('scenarios 4-6: remove their points, bring our boules in, protect our own', { timeout: 120000 }, () => {
  atLeast(agree(sc(4), (r) => r.family === 'shootBoule'), 0.7, '#4 shoot the 0.10 boule');
  atLeast(agree(sc(5), (r) => r.family === 'shootBoule'), 0.7, '#5 shoot the 0.20 boule');
  atLeast(agree(sc(6), isPoint), 0.7, '#6 no shot beside our own boule');
});

test('scenarios 7-9: shoot the jack to void, never when it hands them points, the score trick', { timeout: 120000 }, () => {
  atLeast(agree(sc(7), (r) => r.family === 'shootJack'), 0.7, '#7 void the mène');
  atMost(agree(sc(8), (r) => r.family === 'shootJack'), 0, '#8 no jack shot');
  atLeast(agree(sc(8), isPoint), 0.7, '#8 point at the jack');
  const nine = agree(sc(9), (r) => r.family === 'shootJack');
  assert.ok(nine.rate >= 0.4, `#9 Odette goes for the jack: ${nine.seen}`); // a shot at their boule is the close alternative
  atLeast(agree(sc(9), isShoot), 0.7, '#9 shoots');
});

test('scenarios 10-13: desperation, no reply, cover the jack, block in front', { timeout: 120000 }, () => {
  atLeast(agree(sc(10), isShoot), 0.7, '#10 never a plain safe point');
  atLeast(agree(sc(11), (r) => isPoint(r)), 0.9, '#11 point, no shot');
  atLeast(agree(sc(12), (r) => r.family === 'pointBehind'), 0.7, '#12 cover the jack');
  atLeast(agree(sc(13), (r) => (r.family === 'pointFront' || r.family === 'pointJack') && r.style !== 'roulette'), 0.7, '#13 block or plombée, no roulette');
});

test('scenario 17: tactical errors give Easy visible shots when down on boules; Hard almost none', { timeout: 120000 }, () => {
  const easy = agree(sc(3), isShoot, { difficulty: 'easy', seeds: 100 });
  atLeast(easy, 0.25, '#17 Easy shoots');
  atMost(agree(sc(3), isShoot, { difficulty: 'hard', seeds: 40 }), 0.05, '#17 Hard');
});
