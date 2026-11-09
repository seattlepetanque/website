// Tactics (GAME-PLAN 12.8): static checks on hand-built states, then the scenario table with a seeded Monte Carlo
// agreement threshold at Hard (20 seeds, decision class holds in >= 70%).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBody } from '../../assets/js/petanque/physics.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { apply, createMatch } from '../../assets/js/petanque/rules.js';
import { AI, chooseThrow } from '../../assets/js/petanque/ai.js';
import {
  readSituation, plan, evalEnd, deadJackPayoff, explain, whoThrows, ROLE_STICK, riskLambda, removalGain, profiles, DIFFICULTY, DEFAULT_CFG, adviceProfile,
  epState, laneShield, jackCover, defenseOn, REASON_ALIAS,
} from '../../assets/js/petanque/tactics.js';
import { LINES, createCommentary, REASON_ACTION } from '../../assets/js/petanque/personalities.js';
import { scenarios, chooserScenarios, build } from './tactics-scenarios.js';
import { difficultyScale } from '../../assets/js/petanque/donnee.js';
// decisions and accuracy are asserted at the original D02 scaling; the shipped values (donnee.js difficultyScale) are balanced against
// the scripted pointer in measure-tactics.js
Object.assign(difficultyScale, { easy: 2.3, medium: 1.35, hard: 0.65 });

const sc = (id) => scenarios.find((s) => s.id === id);
const situation = (spec, difficulty = 'hard', who) => {
  const s = build(who ? { ...spec, thrower: who } : spec);
  return { s, sit: readSituation({ match: s.match, bodies: s.world.bodies, player: s.player, difficulty }) };
};
const SEEDS = 12; // seeded; the thresholds below hold with margin at 12 (the measure scripts use hundreds)
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
  assert.ok(plan(situation(sc(12)).sit).cands.some((c) => c.family === 'cover'), 'jack near the string: cover it');
  assert.ok(!plan(situation(sc(1)).sit).cands.some((c) => c.family === 'block'), 'no blocker on an empty court');
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
  assert.equal(top(sc(12)).why.code, 'cover');
  assert.equal(top(sc(11)).why.code, 'noReply');
  assert.equal(top(sc(5)).why.code, 'bringInBoules');
  assert.equal(top(sc(1)).why.code, 'takePoint');
  assert.ok(['downOnBoules', 'block', 'lastBoule'].includes(top(sc(3)).why.code));
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

test('F03 whoThrows: teams keep roles, switching only when the preferred player is out or tactics strongly favour the other', () => {
  const who = (spec, difficulty = 'hard') => {
    const s = build(spec);
    return whoThrows({ match: s.match, bodies: s.world.bodies, team: s.team, difficulty });
  };
  const shooting = { thrower: 'marcel', us: { hand: [2, 1], boules: [[0, 0.9]] }, them: { hand: [0, 1], boules: [[0.1, 0], [0, 0.3]] } };
  const pointing = { thrower: 'odette', us: { hand: [2, 1] }, them: { hand: [2, 1] } };
  for (const d of ['easy', 'medium', 'hard']) {
    assert.equal(who(pointing, d).player.id, 'marcel', 'pointing situation: the pointer throws');
    // the preferred player holds fewer boules and still throws: no alternating on boule count
    assert.equal(who({ ...pointing, us: { hand: [1, 3] } }, d).player.id, 'marcel');
  }
  // a shooting situation (at Hard the tactics clearly favour the shot; at Medium Odette's cone makes pointing the better action)
  assert.equal(who(shooting).player.id, 'odette', 'shooting situation, both hold boules: the shooter throws');
  assert.equal(who({ ...shooting, us: { ...shooting.us, hand: [3, 1] } }).player.id, 'odette', 'even when the pointer holds more boules');
  assert.equal(who({ ...shooting, us: { ...shooting.us, hand: [2, 0] } }).player.id, 'marcel', 'shooter out of boules: the pointer shoots');
  assert.equal(who({ ...pointing, us: { hand: [0, 2] } }).player.id, 'odette', 'pointer out of boules: the shooter points');
  assert.equal(who(shooting).action, 'shoot');
  assert.equal(who(pointing).action, 'point');
  // the human team: You point, Pierre shoots; the stickiness weight is per personality
  assert.equal(who({ ...pointing, thrower: 'you', humanTeam: true }).player.id, 'you');
  assert.equal(who({ ...shooting, thrower: 'you', humanTeam: true }).player.id, 'pierre');
  assert.ok(ROLE_STICK.marcel > 0 && ROLE_STICK.odette > 0 && ROLE_STICK.pierre > 0 && ROLE_STICK.advice > 0);
});

test('every reason code has a line for each character, and the difficulty table has the agreed error rates', () => {
  const codes = ['takePoint', 'holdPoint', 'downOnBoules', 'upOnBoules', 'bringInBoules', 'removePoints', 'protectOwn', 'lastBoule', 'closeOut',
    'voidMene', 'jackScoreTrick', 'blockFront', 'safetyBehind', 'coverJack', 'noReply',
    'promote', 'block', 'cover', 'spread', 'drop', 'farJack', 'easyShot']; // F04: the new codes; the old block / cover codes stay as aliases
  for (const id of ['marcel', 'odette', 'pierre']) for (const c of codes) assert.ok(LINES[id].why[c] && LINES[id].why[c].length >= 1, `${id} why.${c}`);
  for (const c of codes) assert.ok(LINES.pierre.suggest[c] && LINES.pierre.suggest[c].length >= 1, `suggest.${c}`);
  assert.deepEqual([DIFFICULTY.easy.eps, DIFFICULTY.medium.eps, DIFFICULTY.hard.eps], [0.30, 0.08, 0.02]);
  assert.deepEqual(REASON_ALIAS, { blockFront: 'block', coverJack: 'cover', safetyBehind: 'cover' });
  // every code a decision can carry has a Pierre action, so his suggestion never drops a new reason
  for (const c of codes) assert.ok(REASON_ACTION[c], `REASON_ACTION.${c}`);
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
  atLeast(agree(sc(2), isShoot), 0.5, '#2 Odette shoots');
  atMost(agree(sc(2), isShoot, { who: 'marcel' }), 0.3, '#2 Marcel points');
  atLeast(agree(sc(3), isPoint), 0.7, '#3 Odette points');
  atMost(agree(sc(3), isShoot, { who: 'pierre' }), 0.35, '#3 Pierre shoots at most 35%');
  atMost(agree(sc(3), isShoot), 0.15, '#3 Odette shoots at most 15%');
});

test('scenarios 4-6: remove their points, bring our boules in, protect our own', { timeout: 120000 }, () => {
  atLeast(agree(sc(4), (r) => r.family === 'shootBoule'), 0.7, '#4 shoot the 0.10 boule');
  atLeast(agree(sc(4), (r) => r.family === 'shootBoule', { who: 'marcel' }), 0.5, '#4 Marcel shoots too (R2 and G both high)');
  atLeast(agree(sc(5), (r) => r.family === 'shootBoule'), 0.7, '#5 shoot the 0.20 boule');
  atLeast(agree(sc(6), isPoint), 0.7, '#6 no shot beside our own boule');
});

test('scenarios 7-9: shoot the jack to void, never when it hands them points, the score trick', { timeout: 120000 }, () => {
  atLeast(agree(sc(7), (r) => r.family === 'shootJack'), 0.7, '#7 void the mène');
  atMost(agree(sc(8), (r) => r.family === 'shootJack'), 0, '#8 no jack shot');
  atLeast(agree(sc(8), isPoint), 0.7, '#8 point at the jack');
  // D22: with four points held and no reply the score trick is right for anyone, so Marcel shoots it too (design change
  // from 12.8); with two points held he points and Odette shoots a boule.
  atLeast(agree(sc(9), (r) => r.family === 'shootJack'), 0.7, '#9 Odette goes for the jack');
  const two = { ...sc(9), jack: { x: 3.0, y: 9.0 }, them: { hand: [0, 0], boules: [[0.1, 0], [-0.2, 0]] } };
  atLeast(agree(two, (r) => r.family === 'pointJack', { who: 'marcel' }), 0.7, '#9 Marcel points when they hold two');
});

test('scenarios 10-13: desperation, no reply, cover the jack, block in front', { timeout: 120000 }, () => {
  atLeast(agree(sc(10), isShoot), 0.7, '#10 never a plain safe point');
  atLeast(agree(sc(11), (r) => isPoint(r)), 0.9, '#11 point, no shot');
  atLeast(agree(sc(12), (r) => r.family === 'cover'), 0.7, '#12 cover the jack');
  atLeast(agree(sc(13), (r) => (r.family === 'block' || r.family === 'pointJack') && r.style !== 'roulette'), 0.7, '#13 block or plombée, no roulette');
});

test('scenario 17: tactical errors give Easy visible shots when down on boules; Hard almost none', { timeout: 120000 }, () => {
  const easy = agree(sc(3), isShoot, { difficulty: 'easy', seeds: 60 });
  atLeast(easy, 0.25, '#17 Easy shoots');
  atMost(agree(sc(3), isShoot, { difficulty: 'hard', seeds: 20 }), 0.05, '#17 Hard');
});

// D22: the principle works on a fixed court. Same ground (they hold a point at 0.15 m, we have nothing out), only the
// hands change: Odette's shoot rate must fall clearly when down on boules and rise when up (GAME-PLAN 12.3).
test('shoot rate by boule advantage: falls when down, rises when up (same court, seeded)', { timeout: 60000 }, () => {
  const split = (n) => [Math.ceil(n / 2), Math.floor(n / 2)];
  const rate = (ba, seeds = 16) => {
    const u = split(3 + ba), t = split(3);
    let n = 0;
    for (let i = 0; i < seeds; i++) {
      const s = build({ thrower: 'odette', us: { hand: [u[1], u[0]] }, them: { hand: t, boules: [[0.15, 0]] } }, { seed: i });
      const r = chooseThrow({ world: s.world, match: s.match, player: s.player, difficulty: 'medium', rand: mulberry32(500 + i) });
      if (r.intent === 'shoot') n++;
    }
    return n / seeds;
  };
  const down = rate(-2), even = rate(0), up = rate(2);
  assert.ok(down <= 0.25, `down on boules ${down}`);
  assert.ok(up >= 0.5, `up on boules ${up}`);
  assert.ok(down < even && even <= up + 0.1, `monotone: ${down} ${even} ${up}`);
  assert.ok(up - down >= 0.35, `clear gap: ${down} ${up}`);
});

// ---------- F04 (GAME-PLAN 12.12): promote, block / cover, drop, point versus shoot ----------

const fams = (sit, cfg) => plan(sit, cfg).cands.map((c) => c.family);
const has = (spec, fam, difficulty = 'hard', who) => fams(situation(spec, difficulty, who).sit).includes(fam);

test('12.12 profiles carry promote, defend and dropOK; the difficulty table has the agreed rules', () => {
  const f = (id) => [profiles[id].promote, profiles[id].defend, profiles[id].dropOK];
  assert.deepEqual(f('marcel'), [0.8, 1.4, 1.0]);
  assert.deepEqual(f('odette'), [0.6, 0.8, 1.0]);
  assert.deepEqual(f('pierre'), [1.5, 0.4, 0.5]);
  assert.deepEqual(f('advice'), [1.0, 1.0, 1.0]);
  const adv = adviceProfile('pierre');
  assert.ok(adv.promote > 1 && adv.promote < 1.5 && adv.defend < 1 && adv.dropOK < 1, 'the advice blend sits between Pierre and neutral');
  assert.deepEqual([DIFFICULTY.easy.promoteAlign, DIFFICULTY.medium.promoteAlign, DIFFICULTY.hard.promoteAlign], [25, 15, 20]);
  assert.deepEqual([DIFFICULTY.easy.promote, DIFFICULTY.medium.promote, DIFFICULTY.hard.promote], ['draw', 'on', 'on']);
  assert.deepEqual([DIFFICULTY.easy.drop, DIFFICULTY.medium.drop, DIFFICULTY.hard.drop], ['', '', 'AB']);
  assert.equal(DIFFICULTY.easy.defense, false);
  assert.deepEqual([DIFFICULTY.easy.spread, DIFFICULTY.medium.spread, DIFFICULTY.hard.spread], [0, 0.5, 1]);
});

test('promote: admitted from alignment and a clear path, refused off line, beside a neighbour, or at Easy without the draw', () => {
  // case 18: ours in line at 0.65, theirs 0.36 beside the jack; a demi and a roulette aimed just past our boule
  const c18 = plan(situation(sc(18), 'hard').sit).cands.filter((c) => c.family === 'promote');
  assert.deepEqual(c18.map((c) => c.style).sort(), ['demi', 'roulette']);
  assert.ok(c18.every((c) => c.intent === 'point' && Math.abs(c.restAt.x - 2) < 1e-9 && c.restAt.y > 7.35), 'aimed past our boule on the line');
  assert.ok(c18.every((c) => c.credit.promote > 0), 'a reason');
  // off alignment: our boule far to the side, the jack not behind it
  const side = { ...sc(18), us: { hand: [1, 1], boules: [[0.9, -0.65]] }, them: { hand: [2, 1], boules: [[0.0, 0.0]] } };
  assert.ok(!has({ ...side, them: { hand: [2, 1], boules: [[0.35, 0.1]] } }, 'promote'), 'jack not in line behind our boule');
  // 18 degrees: refused at Medium (15), admitted at Hard (20)
  const slanted = { thrower: 'pierre', us: { hand: [1, 1], boules: [[0.19, -0.65]] }, them: { hand: [2, 1], boules: [[-0.35, 0.1]] } };
  const angleOf = () => { const B = { x: 2.19, y: 7.35 }, cb = Math.atan2(B.x - 2, B.y - 1), bj = Math.atan2(2 - B.x, 8 - B.y); return Math.abs(cb - bj) * 180 / Math.PI; };
  assert.ok(angleOf() > 15 && angleOf() < 20, `test geometry: ${angleOf()}`);
  assert.ok(!has(slanted, 'promote', 'medium') && has(slanted, 'promote', 'hard'), 'alignment 15 (Medium) against 20 (Hard)');
  // 19: their boule beside the path of the push: no promotion (admission 2), a point or a shot instead
  assert.ok(!has(sc(19), 'promote'), 'a neighbour on the path');
  assert.ok(has(sc(19), 'pointSlot') || has(sc(19), 'pointJack'));
  // 20: 1.2 m short with nothing of theirs: a push of 0.5 m gains nothing against three reply boules at this scale, so the gain gate
  // (12.12.2 item 3) keeps it out and the point stays
  assert.ok(!has(sc(20), 'promote') && !has(sc(20), 'shootBoule'), 'case 20: the gate refuses, nothing to shoot');
  // 21: a carom (our boule past the jack on the line) is allowed, flagged
  const c21 = plan(situation(sc(21), 'hard').sit).cands.filter((c) => c.family === 'promote');
  assert.ok(c21.length && c21.every((c) => c.carom), 'case 21 carom');
  // Easy only with the draw; Medium and Hard always (when it applies)
  const easy = situation(sc(18), 'easy').sit;
  assert.ok(!fams(easy).includes('promote'), 'no draw, no promotion');
  easy.promoteDraw = true;
  assert.ok(fams(easy).includes('promote'), 'the draw lets it in');
  // not when we hold the point with nobody left to reply (R8's business)
  const quiet = { thrower: 'pierre', us: { hand: [1, 1], boules: [[0, -0.5]] }, them: { hand: [0, 0] } };
  assert.ok(!has(quiet, 'promote'), 'no reply: add points, do not push');
});

test('promote: A(promote) ranks the closer boule higher', () => {
  const val = (dy) => {
    const spec = { thrower: 'pierre', us: { hand: [1, 1], boules: [[0, dy]] }, them: { hand: [2, 1], boules: [[0.35, 0.1]] } };
    const c = plan(situation(spec, 'hard').sit).cands.filter((k) => k.family === 'promote');
    return c.length ? Math.max(...c.map((k) => k.a)) : null;
  };
  const near = val(-0.45), far = val(-0.65);
  assert.ok(near !== null && far !== null && near > far, `closer ${near} against farther ${far}`);
});

test('block and cover: spots on the throwing line, the old families are gone, defense mode follows the profile', () => {
  const J = { x: 2, y: 8 }, len = 7;
  const spots = (spec, fam, who, d = 'hard') => plan(situation(spec, d, who).sit).cands.filter((c) => c.family === fam).map((c) => c.target);
  const b = spots(sc(22), 'block');
  assert.ok(b.length >= 2, `block spots ${b.length}`);
  assert.ok(b.some((t) => Math.abs(t.x - 2) < 0.02 && Math.abs(t.y - 7.7) < 0.02), 'block 0.3 m short on the line');
  assert.ok(b.some((t) => Math.abs(t.y - 7.55) < 0.02 && Math.abs(Math.abs(t.x - 2) - 0.25) < 0.02), 'and 0.45 m short, 0.25 m to the side (defense)');
  const cv = spots(sc(23), 'cover');
  assert.ok(cv.length >= 3, 'Hard has the third cover spot');
  assert.ok(spots(sc(23), 'cover', undefined, 'medium').length === 2 * 2 - 2 + 2 || spots(sc(23), 'cover', undefined, 'medium').length <= 4);
  assert.ok(!fams(situation(sc(22), 'hard').sit).some((f) => f === 'pointFront' || f === 'pointBehind'), 'old names retired');
  // defense mode: Marcel on, Odette needs BA <= -1 or a reply to come, Pierre only at BA <= -2, never at Easy
  const dm = (spec, who, d) => defenseOn(situation(spec, d || 'hard', who).sit);
  assert.equal(dm(sc(22), 'marcel'), true, 'BA -2');
  assert.equal(dm(sc(22), 'odette'), true);
  assert.equal(dm(sc(22), 'pierre'), true, 'BA -2 is enough even for Pierre');
  assert.equal(dm(sc(22), 'marcel', 'easy'), false);
  assert.equal(dm(sc(1), 'odette'), false, 'even hands, nobody holds');
  assert.equal(dm(sc(1), 'marcel'), true, 'Marcel: they will hold more boules than us after the throw');
  // the spread credit: the jack spot sits beside our own boule, a clear spot is credited
  const tight = plan(situation(sc(24), 'hard').sit);
  assert.ok(tight.cands.some((c) => c.family === 'cover'));
});

test('evaluator: laneShield raises what a point is worth on the line and does nothing off it; coverJack lowers the exposure term', () => {
  const { s, sit } = situation({ thrower: 'odette', us: { hand: [1, 1] }, them: { hand: [1, 2] } }, 'hard');
  const jack = { kind: 'jack', x: 2, y: 8 };
  const ours = (dx, dy) => ({ kind: 'boule', team: s.team, x: 2 + dx, y: 8 + dy, dead: false });
  // a blocker 0.5 m short on the line against the same distance beside the jack
  const on = [jack, ours(0, -0.5)], off = [jack, ours(0.5, 0)];
  assert.equal(laneShield(sit, [on[1]]), 1);
  assert.equal(laneShield(sit, [off[1]]), 0);
  assert.equal(laneShield(sit, [ours(0.4, -0.5)]), 0.5, 'within 0.5 m of the line');
  assert.equal(laneShield(sit, [ours(0, -0.1)]), 0, 'too close to the jack to block a lane');
  const v = (bodies) => evalEnd(bodies, sit);
  assert.ok(v(on) > v(off), `on the line ${v(on)} against off ${v(off)}`);
  const ep = (mul) => epState(sit, [0.5], [], 1, 2, 0, { sigmaMul: mul }).ep;
  assert.ok(ep(1.35) > ep(1), 'EPhold uses the inflated sigma');
  assert.equal(v(on), evalEnd(on, { ...sit, params: { ...sit.params, shield: false } }, { ...sit.params, shield: false }) + (v(on) - evalEnd(on, sit, { ...sit.params, shield: false })), 'consistent');
  assert.ok(Math.abs(evalEnd(off, sit) - evalEnd(off, sit, { ...sit.params, shield: false })) < 1e-9, 'off the line nothing changes');
  // jack cover: the jack 0.5 m from the string, a boule of ours 0.3 m past it on the line against 0.3 m beside it
  const near = situation({ thrower: 'odette', jack: { x: 3.5, y: 8 }, us: { hand: [1, 1] }, them: { hand: [1, 2] } }, 'hard');
  const J = { x: 3.5, y: 8 }, d = Math.hypot(J.x - 2, J.y - 1), ux = (J.x - 2) / d, uy = (J.y - 1) / d;
  const past = { kind: 'boule', team: near.s.team, x: J.x + 0.3 * ux, y: J.y + 0.3 * uy, dead: false };
  const beside = { kind: 'boule', team: near.s.team, x: J.x - 0.3 * uy, y: J.y + 0.3 * ux, dead: false };
  const jk = { kind: 'jack', x: J.x, y: J.y };
  assert.equal(jackCover(near.sit, [past]), 1);
  assert.equal(jackCover(near.sit, [beside]), 0);
  assert.ok(evalEnd([jk, past], near.sit) > evalEnd([jk, beside], near.sit), 'a cover keeps more of the point');
});

test('evaluator: the easy-target term penalises a tight pair when they have a tireur, by weight per difficulty', () => {
  const mk = (d) => situation({ thrower: 'odette', us: { hand: [1, 1] }, them: { hand: [0, 2] } }, d);
  const jack = { kind: 'jack', x: 2, y: 8 };
  const b = (s, x, y) => ({ kind: 'boule', team: s.team, x, y, dead: false });
  for (const [d, w] of [['hard', 0.12], ['medium', 0.06], ['easy', 0]]) assert.ok(Math.abs(mk(d).sit.params.wS - w) < 1e-9, `${d} weight`);
  const { s, sit } = mk('hard');
  const tight = [jack, b(s, 2, 8.1), b(s, 2.05, 8.15)];
  const noSpread = { ...sit.params, wS: 0, wS2: 0 };
  assert.ok(evalEnd(tight, sit) < evalEnd(tight, sit, noSpread) - 0.2, 'two close boules count twice');
  const none = situation({ thrower: 'odette', us: { hand: [1, 1] }, them: { hand: [0, 0] } }, 'hard');
  assert.ok(Math.abs(evalEnd(tight, none.sit) - evalEnd(tight, none.sit, noSpread)) < 1e-9, 'no shooter, no penalty');
});

test('drop: only at Hard, only when we hold with a real point and either case A (no reply) or case B (our last boule)', () => {
  const kind = (spec, d = 'hard', who) => { const p = plan(situation(spec, d, who).sit); return p.drop ? p.drop.kind : null; };
  assert.equal(kind(sc(25)), 'A');
  assert.equal(kind(sc(25), 'hard', 'marcel'), 'A');
  assert.equal(kind(sc(25), 'medium'), null, 'never at Medium');
  assert.equal(kind(sc(25), 'easy'), null, 'never at Easy');
  assert.equal(kind(sc(26)), 'B', 'they have boules, our last one');
  // elsewhere: not holding, a far best boule, or a throw to spare while they can reply
  assert.equal(kind(sc(18)), null);
  assert.equal(kind(sc(1)), null);
  assert.equal(kind({ ...sc(25), us: { hand: [1, 1], boules: sc(25).us.boules } , them: { hand: [1, 1] } }), null, 'case B needs our last boule');
  assert.equal(kind({ thrower: 'odette', us: { hand: [0, 1], boules: [[0.7, 0]] }, them: { hand: [0, 0] } }), null, 'no real point to protect (0.7 m)');
  const c = plan(situation(sc(25), 'hard').sit).drop.cand;
  assert.equal(c.family, 'drop');
  assert.ok(Math.abs(Math.hypot(c.landing.x - 2, c.landing.y - 1) - 1.5) < 0.2, '1.5 m from the circle');
  assert.ok(Math.abs(c.landing.x - 2) >= 0.55, 'off the circle-to-jack line');
  assert.ok(!plan(situation(sc(25), 'hard').sit, DEFAULT_CFG, { loose: true }).drop, 'a tactical error never drops');
});

test('point versus shoot: a long jack turns a passing shot into farJack, the margin keeps a shot that beats the point', () => {
  const { sit } = situation(sc(27), 'hard');
  const p = plan(sit);
  assert.ok(!p.cands.some((c) => c.family === 'shootBoule'), 'case 27: no shot at 12 m');
  assert.ok(p.dropped.some((d) => d.code === 'farJack' && d.G > 0.5), 'the shot passes G and is reported farJack');
  assert.ok(p.cands.filter((c) => c.intent === 'point').every((c) => c.credit.farJack > 0), 'the point carries the reason');
  // case 28: the same court at 6.5 m admits the shot and calls it easy
  const q = plan(situation(sc(28), 'hard').sit);
  const sh = q.cands.find((c) => c.family === 'shootBoule');
  assert.ok(sh && sh.credit.easyShot > 0, 'easyShot at 6.5 m');
  assert.ok(!plan(situation(sc(28), 'hard', 'marcel').sit).cands.some((c) => c.family === 'shootBoule'), 'Marcel\'s gate keeps him pointing');
  // the margin: their boule 0.8 m out gives the point the better chance
  const far = { thrower: 'pierre', us: { hand: [1, 1] }, them: { hand: [1, 1], boules: [[0.8, 0]] } };
  assert.ok(!has(far, 'shootBoule'), 'a decent point beats a boule at 0.8 m');
});

// ---------- F04 Monte Carlo (Hard, seeded) ----------

test('scenarios 18-21: promote is planned where it pays and not beside a neighbour; points and no shot meanwhile', { timeout: 120000 }, () => {
  atLeast(agree(sc(18), isPoint), 0.7, '#18 a point (promote, slot or jack), no gamble on a shot');
  atMost(agree(sc(19), (r) => r.family === 'promote'), 0.1, '#19 no promote beside a neighbour');
  atLeast(agree(sc(20), isPoint), 0.9, '#20 nothing to shoot: point or promote');
  atMost(agree(sc(21), (r) => r.family === 'drop'), 0, '#21 never drops');
});

test('scenarios 22-24: block when down on boules, cover a jack near the string', { timeout: 120000 }, () => {
  atLeast(agree(sc(22), (r) => r.family === 'block'), 0.7, '#22 Marcel blocks');
  atLeast(agree(sc(22), (r) => r.why.code === 'block' || r.why.code === 'downOnBoules'), 0.9, '#22 reason');
  const c23 = agree(sc(23), (r) => r.family === 'cover');
  atLeast(c23, 0.4, '#23 cover');
  atMost(agree(sc(23), (r) => r.family === 'cover' && r.style === 'roulette'), 0, '#23 never a roulette past the jack');
  atMost(agree(sc(24), isShoot), 0.1, '#24 nothing to shoot at');
});

test('scenarios 25-26: the drop (Hard only, no reply), never with a reply to come; Pierre points', { timeout: 120000 }, () => {
  const drop = (r) => r.family === 'drop';
  atLeast(agree(sc(25), drop), 0.7, '#25 Odette drops');
  atLeast(agree(sc(25), drop, { who: 'marcel' }), 0.7, '#25 Marcel drops');
  atMost(agree(sc(25), drop, { who: 'pierre' }), 0.3, '#25 Pierre points (reluctant)');
  atMost(agree(sc(25), drop, { difficulty: 'medium' }), 0, '#25 never at Medium');
  atMost(agree(sc(25), drop, { difficulty: 'easy' }), 0, '#25 never at Easy');
  atMost(agree(sc(26), drop), 0.1, '#26 they can reply: no drop');
  assert.notEqual(agree(sc(25), (r) => r.why.code === 'jackScoreTrick').rate, 1, 'the score trick does not fire');
  atMost(agree(sc(25), (r) => r.family === 'shootJack'), 0, '#25 no jack shot');
});

test('scenarios 27-28: a long jack is pointed (farJack), a short clear one is shot (easyShot)', { timeout: 120000 }, () => {
  atLeast(agree(sc(27), isPoint), 0.7, '#27 point');
  atLeast(agree(sc(27), (r) => r.why.code === 'farJack'), 0.5, '#27 farJack');
  atLeast(agree(sc(28), (r) => r.family === 'shootBoule'), 0.5, '#28 Pierre shoots');
  atLeast(agree(sc(28), (r) => r.why.code === 'easyShot'), 0.4, '#28 easyShot');
  atMost(agree(sc(28), isShoot, { who: 'marcel' }), 0.1, '#28 Marcel points');
});

test('scenario 29: case 18 at Easy, 120 seeds: promotion is let in by a quarter draw; never a drop', { timeout: 120000 }, () => {
  let admitted = 0, drops = 0;
  for (let i = 0; i < 120; i++) {
    const s = build(sc(18), { seed: i });
    const r = chooseThrow({ world: s.world, match: s.match, player: s.player, difficulty: 'easy', rand: mulberry32(1000 + i) });
    if (r.info.promoteAdmitted) admitted++;
    if (r.family === 'drop') drops++;
  }
  assert.ok(admitted >= 18 && admitted <= 42, `admitted in ${admitted} of 120 seeds (15 to 35%)`);
  assert.equal(drops, 0);
});
