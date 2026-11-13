import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMatch, apply, nextTeam, meneResult, holdingTeam, jackValid, jackFault, jackPlaceValid, jackPlaceFault, playersWithBoules, deadJackText,
  jackGap, jackTooClose, jackCentreRange, fmtCm, sameGap, canonicalGaps, clusterUm, gapUm, JACK_END_MARGIN, JACK_R, JACK_DEAD_DIST, JACK_CENTRE_SHIFT,
} from '../../assets/js/petanque/rules.js';
import { FRONT_MIN, FRONT_WANT, nextCircle, CIRCLE_R, SIDE_MARGIN } from '../../assets/js/petanque/court.js';
import { C } from '../../assets/js/petanque/constants.js';

const K = JACK_CENTRE_SHIFT; // centre distance = edge gap + K (circle radius 0.25 + jack radius 0.015)

const jackAt = { x: 2, y: 8 };
const b = (id, team, x, y, dead = false) => ({ id, team, owner: team ? 'm' : 'y', x, y, dead });

function started(opts) {
  return apply(createMatch(opts), { type: 'jackThrown', team: 0, jack: jackAt });
}
function throwBoule(m, playerId, jack, boules) {
  m = apply(m, { type: 'bouleThrown', playerId });
  return apply(m, { type: 'throwSettled', jack, boules });
}

test('createMatch sets up doublette', () => {
  const m = createMatch({});
  assert.equal(m.target, 13);
  assert.equal(m.players.length, 4);
  assert.deepEqual(m.players.map((p) => p.team), [0, 0, 1, 1]);
  assert.ok(m.players.every((p) => p.boulesLeft === 3));
  assert.equal(m.players[0].isHuman, true);
  assert.equal(m.players[1].role, 'tireur');
  assert.equal(m.phase, 'jack');
});

test('jack validity', () => {
  assert.ok(jackValid({ x: 2, y: 8 }));
  assert.ok(!jackValid({ x: 2, y: 5 })); // 4 m
  assert.ok(!jackValid({ x: 2, y: 12 })); // 11 m
  assert.ok(jackValid({ x: 2, y: 1 + 6 + K })); // F75: exactly 6 m from the circle's inner edge to the jack's near edge
  assert.ok(jackValid({ x: 2, y: 1 + 10 + K })); // exactly 10 m
  assert.ok(jackValid({ x: 0.5, y: 8 })); // E20: no side margin
  assert.ok(jackValid({ x: 3.5, y: 8 }));
  assert.ok(!jackValid({ x: -0.5, y: 8 }));
  assert.ok(jackValid({ x: 1, y: 8 }));
  assert.ok(!jackValid({ x: 2, y: 8, dead: true }));
});

test('invalid jack goes to the other team to place; the thrower still plays first', () => {
  let m = apply(createMatch({}), { type: 'jackThrown', team: 0, jack: { x: 2, y: 3 } });
  assert.equal(m.phase, 'jackPlace');
  assert.equal(m.placingTeam, 1);
  assert.equal(m.jackTeam, 0);
  assert.equal(m.jack, null);
  // wrong team, invalid spot and a dead jack are ignored
  assert.equal(apply(m, { type: 'jackPlaceSettled', team: 0, jack: jackAt }), m);
  assert.equal(apply(m, { type: 'jackPlaceSettled', team: 1, jack: { x: 2, y: 4 } }).phase, 'jackPlace');
  assert.equal(apply(m, { type: 'jackPlaceSettled', team: 1, jack: { x: -0.5, y: 8 } }).phase, 'jackPlace');
  assert.equal(apply(m, { type: 'jackThrown', team: 1, jack: jackAt }), m); // not a throw phase any more
  m = apply(m, { type: 'jackPlaceSettled', team: 1, jack: jackAt });
  assert.equal(m.phase, 'play');
  assert.equal(m.jackTeam, 0);
  assert.equal(m.placingTeam, null);
  assert.deepEqual(m.jack, { x: 2, y: 8, dead: false });
  assert.equal(nextTeam(m), 0); // the team that threw plays the first boule
  assert.equal(apply(m, { type: 'jackPlaceSettled', team: 1, jack: jackAt }), m); // only in jackPlace
});

test('jackFault explains invalid jacks', () => {
  assert.equal(jackFault({ x: 2, y: 8 }), null);
  assert.equal(jackFault({ x: 2, y: 5 }).reason, 'short');
  assert.equal(jackFault({ x: 2, y: 12 }).reason, 'far');
  assert.equal(jackFault({ x: -0.5, y: 8 }).reason, 'line');
  assert.equal(jackFault({ x: 2, y: 8, dead: true }).reason, 'out');
  assert.ok(Math.abs(jackFault({ x: 2, y: 5 }).dist - (4 - K)) < 1e-9);
});

test('reducer does not mutate input', () => {
  const m = started({});
  const snap = JSON.stringify(m);
  apply(m, { type: 'bouleThrown', playerId: 'you' });
  assert.equal(JSON.stringify(m), snap);
});

test('who throws next in a typical sequence', () => {
  let m = started({});
  assert.equal(nextTeam(m), 0);
  m = throwBoule(m, 'you', jackAt, [b('a', 0, 2, 8.5)]);
  assert.equal(nextTeam(m), 1); // team 1 has nothing on the ground
  m = throwBoule(m, 'marcel', jackAt, [b('a', 0, 2, 8.5), b('c', 1, 2, 9.5)]);
  assert.equal(nextTeam(m), 1); // team 0 holds the point, team 1 plays
  m = throwBoule(m, 'odette', jackAt, [b('a', 0, 2, 8.5), b('c', 1, 2, 9.5), b('d', 1, 2.1, 8.2)]);
  assert.equal(nextTeam(m), 0); // team 1 now holds
});

test('team with no live boule on ground throws; dead boules do not count', () => {
  let m = started({});
  m = throwBoule(m, 'you', jackAt, [b('a', 0, 2, 8.5)]);
  m = throwBoule(m, 'marcel', jackAt, [b('a', 0, 2, 8.5), b('c', 1, 9, 9, true)]);
  assert.equal(nextTeam(m), 1);
});

test('first boule dead: the opponent throws next (Art. 16)', () => {
  let m = started({});
  m = throwBoule(m, 'you', jackAt, [b('a', 0, 9, 9, true)]);
  assert.equal(nextTeam(m), 1);
});

test('all boules dead: strict alternation 0,1,0,1 until one stays', () => {
  let m = started({});
  const dead = [];
  const order = [];
  const who = { 0: ['you', 'pierre'], 1: ['marcel', 'odette'] };
  const used = { 0: 0, 1: 0 };
  let team = 0;
  for (let i = 0; i < 4; i++) {
    const id = who[team][used[team]++ % 2];
    dead.push(b('d' + i, team, 9, 9, true));
    m = throwBoule(m, id, jackAt, dead.slice());
    team = nextTeam(m);
    order.push(team);
  }
  assert.deepEqual(order, [1, 0, 1, 0]);
  // a boule stays in play: normal rules resume (team 1 has no boule on the ground, so it plays)
  m = throwBoule(m, 'you', jackAt, [...dead, b('s', 0, 2, 8.5)]);
  assert.equal(m.stayed, true);
  assert.equal(nextTeam(m), 1);
});

test('a shot that clears the ground after boules stayed: the last thrower plays again (Art. 29)', () => {
  let m = started({});
  m = throwBoule(m, 'you', jackAt, [b('a', 0, 2, 8.5)]);
  assert.equal(nextTeam(m), 1);
  m = throwBoule(m, 'marcel', jackAt, [b('a', 0, 9, 9, true), b('c', 1, 9, 9, true)]);
  assert.equal(m.stayed, true);
  assert.equal(nextTeam(m), 1);
});

test('first boule dead, second live: the other team of the live boule plays', () => {
  let m = started({});
  m = throwBoule(m, 'you', jackAt, [b('a', 0, 9, 9, true)]);
  m = throwBoule(m, 'marcel', jackAt, [b('a', 0, 9, 9, true), b('c', 1, 2, 8.5)]);
  assert.equal(nextTeam(m), 0);
});

test('every boule dead: the mène is void and the same jack team throws next', () => {
  let m = started({});
  const dead = [];
  const ids = [['you', 'you', 'you', 'pierre', 'pierre', 'pierre'], ['marcel', 'marcel', 'marcel', 'odette', 'odette', 'odette']];
  const used = [0, 0];
  let team = 0;
  while (m.phase === 'play' && dead.length < 12) {
    dead.push(b('d' + dead.length, team, 9, 9, true));
    m = throwBoule(m, ids[team][used[team]++], jackAt, dead.slice());
    team = nextTeam(m) ?? team;
  }
  assert.equal(dead.length, 12);
  assert.equal(m.phase, 'meneEnd');
  assert.equal(m.result.void, true);
  m = apply(m, { type: 'nextMene' });
  assert.equal(m.jackTeam, 0);
  assert.equal(m.stayed, false);
});

test('one team out of boules: the other plays its remaining boules', () => {
  let m = started({});
  m = { ...m, players: m.players.map((p) => (p.team === 1 ? { ...p, boulesLeft: 0 } : p)) };
  m = { ...m, boules: [b('c', 1, 2, 8.1)], lastThrower: 0 };
  assert.equal(nextTeam(m), 0);
  assert.equal(playersWithBoules(m, 1).length, 0);
  assert.equal(playersWithBoules(m, 0).length, 2);
});

test('equidistant tie: team that threw last plays again', () => {
  let m = started({});
  m = throwBoule(m, 'you', jackAt, [b('a', 0, 2, 8.5)]);
  m = throwBoule(m, 'marcel', jackAt, [b('a', 0, 2, 8.5), b('c', 1, 2.5, 8)]);
  assert.equal(nextTeam(m), 1);
});

test('scoring counts closer boules of the winning team', () => {
  const r = meneResult({ x: 2, y: 8 }, [
    b('a', 0, 2, 8.1), b('b', 0, 2, 8.3), b('c', 1, 2, 8.5), b('d', 0, 2, 8.9),
  ]);
  assert.equal(r.team, 0);
  assert.equal(r.points, 2);
  assert.equal(r.measured[0].id, 'a');
  assert.ok(Math.abs(r.measured[0].dist - 0.1) < 1e-9);
});

test('scoring ignores dead boules; no boules or tie is void', () => {
  const r = meneResult(jackAt, [b('a', 0, 2, 8.1, true), b('c', 1, 2, 8.5)]);
  assert.equal(r.team, 1);
  assert.equal(r.points, 1);
  assert.deepEqual(meneResult(jackAt, []), { void: true });
  assert.deepEqual(meneResult(jackAt, [b('a', 0, 2, 8.5), b('c', 1, 2.5, 8)]), { void: true });
});

function playOut(m, boules) {
  // Throw all 12 boules without changing positions; final ground state = boules.
  const ids = ['you', 'pierre', 'marcel', 'odette'];
  for (let i = 0; i < 12; i++) m = throwBoule(m, ids[i % 4], jackAt, boules);
  return m;
}

test('mène ends when no boules remain; winner throws next jack; scores accumulate', () => {
  let m = playOut(started({}), [b('a', 1, 2, 8.1), b('b', 1, 2, 8.2), b('c', 0, 2, 8.5)]);
  assert.equal(m.phase, 'meneEnd');
  assert.deepEqual(m.scores, [0, 2]);
  assert.equal(nextTeam(m), null);
  m = apply(m, { type: 'nextMene' });
  assert.equal(m.phase, 'jack');
  assert.equal(m.mene, 2);
  assert.equal(m.jackTeam, 1);
  assert.ok(m.players.every((p) => p.boulesLeft === 3));
  assert.deepEqual(m.boules, []);
});

test('void mène keeps the same jack team', () => {
  let m = playOut(started({}), []);
  assert.equal(m.phase, 'meneEnd');
  assert.ok(m.result.void);
  m = apply(m, { type: 'nextMene' });
  assert.equal(m.jackTeam, 0);
  assert.deepEqual(m.scores, [0, 0]);
});

test('dead jack: void if both have boules, else holder scores its boules', () => {
  let m = started({});
  m = apply(m, { type: 'bouleThrown', playerId: 'you' });
  const dead = apply(m, { type: 'throwSettled', jack: { x: 9, y: 9, dead: true }, boules: [] });
  assert.equal(dead.phase, 'meneEnd');
  assert.ok(dead.result.void);

  let m2 = started({});
  m2 = { ...m2, players: m2.players.map((p) => (p.team === 1 ? { ...p, boulesLeft: 0 } : p)) };
  m2 = apply(m2, { type: 'bouleThrown', playerId: 'you' });
  const dead2 = apply(m2, { type: 'throwSettled', jack: { x: 9, y: 9, dead: true }, boules: [] });
  assert.deepEqual(dead2.scores, [5, 0]); // 6 minus the one just thrown... in hand: 5
  assert.equal(dead2.result.team, 0);
});

test('deadJackText names the case from the boules in hand when the jack went dead', () => {
  const names = ['You & Pierre', 'Marcel & Odette'];
  assert.equal(deadJackText([5, 6], names), 'The cochonnet went out: both teams still have boules, so the mène is void.');
  assert.equal(deadJackText([0, 0], names), 'The cochonnet went out and neither team has boules left, so the mène is void.');
  assert.equal(deadJackText([0, 2], names), 'The cochonnet went out with only Marcel & Odette holding boules: they score 2.');
  assert.equal(deadJackText([3, 0], names), 'The cochonnet went out with only You & Pierre holding boules: they score 3.');
});

test('dead jack records the boules in hand at the moment it died', () => {
  // only team 0 has boules: the holder scores its 5 in hand, and the result keeps that count
  let m = started({});
  m = apply(m, { type: 'bouleThrown', playerId: 'you' });
  m = { ...m, players: m.players.map((p) => (p.team === 1 ? { ...p, boulesLeft: 0 } : p)) };
  const dead = apply(m, { type: 'throwSettled', jack: { x: 9, y: 9, dead: true }, boules: [] });
  assert.deepEqual(dead.result.inHand, [5, 0]);
  assert.equal(dead.result.points, 5);
  assert.equal(deadJackText(dead.result.inHand, ['You & Pierre', 'Marcel & Odette']),
    'The cochonnet went out with only You & Pierre holding boules: they score 5.');

  // both teams hold boules: void, counts kept
  let both = apply(started({}), { type: 'bouleThrown', playerId: 'you' });
  both = apply(both, { type: 'throwSettled', jack: { x: 9, y: 9, dead: true }, boules: [] });
  assert.ok(both.result.void);
  assert.deepEqual(both.result.inHand, [5, 6]);

  // the last boule in play went dead: neither team has boules, void, counts kept as zero
  let last = started({});
  last = { ...last, players: last.players.map((p) => ({ ...p, boulesLeft: p.id === 'you' ? 1 : 0 })) };
  last = apply(last, { type: 'bouleThrown', playerId: 'you' });
  last = apply(last, { type: 'throwSettled', jack: { x: 9, y: 9, dead: true }, boules: [] });
  assert.ok(last.result.void);
  assert.deepEqual(last.result.inHand, [0, 0]);
});

test('match ends at target', () => {
  let m = started({ target: 2 });
  m = playOut(m, [b('a', 0, 2, 8.1), b('b', 0, 2, 8.2), b('c', 1, 2, 8.5)]);
  assert.equal(m.phase, 'gameOver');
  assert.equal(m.winner, 0);
  assert.equal(apply(m, { type: 'nextMene' }), m);
});

test('7-point game ends at 7', () => {
  let m = started({ target: 7 });
  m = { ...m, scores: [5, 6] };
  m = playOut(m, [b('a', 1, 2, 8.1), b('b', 1, 2, 8.2), b('c', 0, 2, 8.5)]);
  assert.equal(m.phase, 'gameOver');
  assert.equal(m.winner, 1);
  assert.deepEqual(m.scores, [5, 7]); // F31: capped at the target
});

test('dead boules relocated beyond the far line are not counted or measured', () => {
  const jack = { x: 2, y: 8, dead: false };
  // a dead boule sitting at its relocated spot, right beside the jack's mirror, must not score or hold
  const boules = [b(1, 0, 2, 8.5), b(2, 1, 0.3, 15.25, true), b(3, 1, 1.2, 15.25, true)];
  assert.equal(holdingTeam(jack, boules), 0);
  assert.equal(meneResult(jack, boules).team, 0);
  assert.equal(meneResult(jack, boules).points, 1);
});

test('E20: a jack is in while any part is inside a side string, out only when wholly past it', () => {
  const side = (x, y) => jackPlaceValid({ x, y });
  // 8.6 m out near the left string: y = 1 + sqrt(8.6^2 - (2-x)^2)
  const yAt = (x, d) => 1 + Math.sqrt(d * d - (2 - x) ** 2);
  assert.ok(side(0.02, yAt(0.02, 8.6)));
  assert.ok(side(-0.01, yAt(-0.01, 8.6)), 'centre 1 cm outside, still overlapping the string: in');
  assert.ok(side(-0.014, yAt(-0.014, 8.6)));
  assert.ok(!side(-0.02, yAt(-0.02, 8.6)), 'whole jack past the left string');
  assert.ok(side(4.01, yAt(4.01, 8.6)));
  assert.ok(!side(4.02, yAt(4.02, 8.6)), 'whole jack past the right string');
  assert.ok(jackValid({ x: -0.01, y: yAt(-0.01, 8.6) }) && !jackValid({ x: -0.02, y: yAt(-0.02, 8.6) }), 'thrown = placed');
  // distance still enforced out at the strings
  assert.ok(!side(0.02, yAt(0.02, 6 + K - 0.1)) && !side(0.02, yAt(0.02, 10 + K + 0.1)));
  assert.ok(side(0.02, yAt(0.02, 6 + K + 0.001)) && side(0.02, yAt(0.02, 10 + K - 0.001)));
});

test('E20/F75: the jack EDGE must be more than 0.5 m before the end string (centre more than 0.515 m)', () => {
  const g = { length: 11.2 }; // a short court so the end string is reachable inside 6-10 m of the circle
  assert.ok(jackValid({ x: 2, y: 10.68 }, g), 'edge 0.505 m from the end string');
  assert.ok(!jackValid({ x: 2, y: 10.69 }, g), 'edge 0.495 m (centre 0.51 m, the old rule would accept)');
  assert.ok(!jackValid({ x: 2, y: 11.2 - JACK_END_MARGIN - JACK_R }, g), 'edge exactly 0.5 m is not more than 0.5 m');
  assert.ok(jackValid({ x: 2, y: 11.2 - JACK_END_MARGIN - JACK_R - 0.001 }, g), 'edge 0.501 m');
  const f = jackFault({ x: 2, y: 10.9 }, g);
  assert.equal(f.reason, 'end');
  assert.ok(Math.abs(f.gap - 0.285) < 1e-9 && f.margin === 0.5, 'gap is edge to string');
  // flipped direction: the end string is at y = 0
  const flip = { circle: { x: 2, y: 12 }, dir: -1 };
  assert.ok(jackValid({ x: 2, y: 4.0 }, flip) && jackFault({ x: 2, y: 4.0 }, flip) === null);
  assert.ok(!jackValid({ x: 2, y: 0.5 + JACK_R }, { ...flip, jackMax: 12 }));
  assert.ok(!jackValid({ x: 2, y: 0.4 }, { ...flip, jackMax: 12 }));
  assert.ok(jackValid({ x: 2, y: 0.52 + JACK_R }, { ...flip, jackMax: 12 }));
});

test('E20: placed-jack faults', () => {
  assert.ok(!jackPlaceValid({ x: 2, y: 7, dead: true }));
  assert.equal(jackPlaceFault({ x: 2, y: 8 }), null);
  assert.equal(jackPlaceFault({ x: -0.5, y: 8 }).reason, 'line');
  assert.equal(jackPlaceFault({ x: 2, y: 5 }).reason, 'short');
});

test('jackPlaceSettled accepts a rest beside the string and yellow-cards one outside', () => {
  let m = apply(createMatch(), { type: 'jackThrown', team: 0, jack: { x: 2, y: 3 } });
  assert.equal(m.phase, 'jackPlace');
  const bad = apply(m, { type: 'jackPlaceSettled', team: 1, jack: { x: -0.1, y: 8.5 } });
  assert.equal(bad.phase, 'jackPlace');
  assert.equal(bad.placingTeam, 1);
  assert.equal(bad.yellowCards, 1);
  const bad2 = apply(bad, { type: 'jackPlaceSettled', team: 1, jack: { x: 2, y: 8, dead: true } }); // rolled out of play
  assert.equal(bad2.phase, 'jackPlace');
  assert.equal(bad2.yellowCards, 2);
  const ok = apply(m, { type: 'jackPlaceSettled', team: 1, jack: { x: 0.03, y: 1 + Math.sqrt(75 - 1.9 ** 2) } });
  assert.equal(ok.phase, 'play');
});

// E15: game ends at the target on the ground once the opponent is out of boules
function e15Setup(scores, team1Left) {
  let m = started({});
  m = { ...m, scores, players: m.players.map((p) => (p.team === 1 ? { ...p, boulesLeft: team1Left } : p)) };
  return m;
}

test('E15: 12 + 1 on the ground with the opponent out of boules wins at once', () => {
  const m = e15Setup([12, 0], 0);
  const r = throwBoule(m, 'you', jackAt, [b('a', 0, 2, 8.1), b('o', 1, 2, 9)]);
  assert.equal(r.phase, 'gameOver');
  assert.equal(r.winner, 0);
  assert.deepEqual(r.scores, [13, 0]);
  assert.ok(playersWithBoules(r, 0).length > 0); // leftover boules were not played
});

test('E15: below the target on the ground the mène continues', () => {
  const m = e15Setup([10, 0], 0);
  const r = throwBoule(m, 'you', jackAt, [b('a', 0, 2, 8.1), b('o', 1, 2, 9)]);
  assert.equal(r.phase, 'play'); // 10 + 1 = 11
  assert.equal(nextTeam(r), 0);
});

test('E15: opponent with boules left means no early end', () => {
  const m = e15Setup([12, 0], 1);
  const r = throwBoule(m, 'you', jackAt, [b('a', 0, 2, 8.1)]);
  assert.equal(r.phase, 'play');
});

test('E15: the team that is out of boules does not end it by holding the point', () => {
  let m = e15Setup([12, 0], 3);
  m = { ...m, players: m.players.map((p) => (p.team === 0 ? { ...p, boulesLeft: p.id === 'you' ? 1 : 0 } : p)) };
  m = { ...m, players: m.players.map((p) => (p.team === 1 ? { ...p, boulesLeft: 1 } : p)) };
  // team 0 throws its last boule and holds the point; team 1 still has one: continues
  const r = throwBoule(m, 'you', jackAt, [b('a', 0, 2, 8.1)]);
  assert.equal(r.phase, 'play');
});

// --- E08: why a jack was judged invalid is reported precisely (reason, measured distance, which line) ---
test('E08/E20: the old x = 3.17 case (0.83 m from the right string) is now valid; faults name the line', () => {
  assert.equal(jackValid({ x: 3.17, y: 10.13 }), true);
  assert.equal(jackFault({ x: 3.17, y: 10.13 }), null);
  const right = jackFault({ x: 4.5, y: 8 });
  assert.equal(right.reason, 'line');
  assert.equal(right.side, 'right');
  assert.ok(Math.abs(right.gap - 0.485) < 1e-9);
  assert.equal(jackFault({ x: -0.96, y: 9.21 }).side, 'left');
  assert.equal(jackFault({ x: 2, y: 7.27 }), null);
  assert.equal(jackFault({ x: 0.96, y: 9.21 }), null);
});

test('E08: far and short faults carry the measured distance; a dead jack that rolled back is flagged', () => {
  assert.equal(jackFault({ x: 2, y: 11.4 }).reason, 'far');
  assert.ok(Math.abs(jackFault({ x: 2, y: 11.4 }).dist - (10.4 - K)) < 1e-9, 'dist is the edge gap');
  assert.equal(jackFault({ x: 2, y: 6.2 }).reason, 'short');
  const back = jackFault({ x: 1.13, y: 10.9, dead: true });
  assert.equal(back.reason, 'out');
  assert.equal(back.back, true);
  assert.equal(jackFault({ x: 2, y: 15.3, dead: true }).back, undefined);
});

// --- F31: stored scores are capped at the target; the winner is still the team that reaches it ---

test('F31: 12 + 3 is stored as 13, and the team that reached the target wins', () => {
  let m = started({});
  m = { ...m, scores: [12, 0] };
  m = playOut(m, [b('a', 0, 2, 8.1), b('b', 0, 2, 8.2), b('c', 0, 2, 8.3), b('o', 1, 2, 9)]);
  assert.equal(m.phase, 'gameOver');
  assert.equal(m.winner, 0);
  assert.deepEqual(m.scores, [13, 0]);
  assert.equal(m.result.points, 3);
});

test('F31: in a 7-point game 6 + 6 is stored as 7', () => {
  let m = started({ target: 7 });
  m = { ...m, scores: [6, 2] };
  m = playOut(m, [b('a', 0, 2, 8.1), b('b', 0, 2, 8.2), b('c', 0, 2, 8.3), b('o', 1, 2, 9)]);
  assert.equal(m.phase, 'gameOver');
  assert.equal(m.winner, 0);
  assert.deepEqual(m.scores, [7, 2]);
});

test('F31: ordinary scoring below the target is unchanged', () => {
  let m = started({});
  m = { ...m, scores: [4, 5] };
  m = playOut(m, [b('a', 1, 2, 8.1), b('b', 1, 2, 8.2), b('c', 0, 2, 8.5)]);
  assert.equal(m.phase, 'meneEnd');
  assert.deepEqual(m.scores, [4, 7]);
  assert.equal(m.winner, null);
});

test('F31: E15 early end still fires with a capped score', () => {
  const m = e15Setup([12, 0], 0);
  const r = throwBoule(m, 'you', jackAt, [b('a', 0, 2, 8.1), b('a2', 0, 2, 8.2), b('a3', 0, 2, 8.3), b('o', 1, 2, 9)]);
  assert.equal(r.phase, 'gameOver');
  assert.equal(r.winner, 0);
  assert.deepEqual(r.scores, [13, 0]);
});

// --- F75: the 6-10 m throw limits are edge to edge ---
test('F75: jack gap is the circle inner edge to the jack near edge; 6.00 and 10.00 valid, 5.99 and 10.01 not', () => {
  assert.ok(Math.abs(K - 0.265) < 1e-12);
  const at = (gap) => ({ x: 2, y: 1 + gap + K });
  assert.ok(Math.abs(jackGap(at(7)) - 7) < 1e-9);
  for (const g of [6, 6.01, 10]) assert.ok(jackValid(at(g)), `gap ${g}`);
  for (const g of [5.99, 10.01, 5.74]) assert.ok(!jackValid(at(g)), `gap ${g}`);
  assert.equal(jackFault(at(5.99)).reason, 'short');
  assert.equal(jackFault(at(10.01)).reason, 'far');
  assert.ok(Math.abs(jackFault(at(5.99)).dist - 5.99) < 1e-9, 'fault distance is the edge gap');
  // diagonal and a circle with its own radius
  assert.ok(jackValid({ x: 2 + 3, y: 1 + Math.sqrt((6 + K) ** 2 - 9) }, { width: 8 }));
  assert.ok(!jackValid({ x: 2, y: 1 + 6.4 + 0.1 }, { circle: { x: 2, y: 1, r: 0.5 } }), 'a bigger ring pushes the limit out');
  const r = jackCentreRange();
  assert.ok(Math.abs(r.min - 6.265) < 1e-9 && Math.abs(r.max - 10.265) < 1e-9);
});

test('F75: end margin is tested at the jack edge: centre exactly 0.515 m from the string is not valid, 0.516 m is', () => {
  const g = { length: 11.5 };
  assert.ok(!jackValid({ x: 2, y: 11.5 - (JACK_END_MARGIN + JACK_R) }, g));
  assert.ok(jackValid({ x: 2, y: 11.5 - (JACK_END_MARGIN + JACK_R) - 0.001 }, g));
  assert.equal(jackFault({ x: 2, y: 11.5 - 0.51 }, g).reason, 'end');
});

// --- F76: Art. 9.3, a jack closer than 3 m to the circle is dead ---
test('F76: a settled live jack with an edge gap under 3 m is dead; 3.01 m stays live', () => {
  const play = (gap, boulesFor = []) => {
    let m = started({}); // jack (2, 8): 6.735 m
    m = apply(m, { type: 'bouleThrown', playerId: m.players.find((p) => p.team === 0).id });
    return apply(m, { type: 'throwSettled', jack: { x: 2, y: 1 + gap + K }, boules: boulesFor });
  };
  const near = play(2.99), edge = play(3.01);
  assert.equal(JACK_DEAD_DIST, 3);
  assert.equal(near.phase, 'meneEnd');
  assert.ok(near.jack.dead && near.jack.reason === 'close');
  assert.deepEqual(near.jack.spot, { x: 2, y: 8 }, 'F88b: the ring goes at the pre-throw spot');
  assert.ok(near.jack.replaced);
  assert.equal(near.result.jackReason, 'close');
  assert.ok(near.result.void, 'both teams hold boules: void mène');
  assert.equal(edge.phase, 'play');
  assert.ok(!edge.jack.dead);
  assert.ok(jackTooClose({ x: 2, y: 1 + 2.99 + K }) && !jackTooClose({ x: 2, y: 1 + 3.01 + K }) && !jackTooClose({ x: 2, y: 1 + 3 + K }));
  // the message names the rule
  const t = deadJackText(near.result.inHand, ['A', 'B'], near.result.jackReason);
  assert.match(t, /too close to the circle \(less than 3 m\)/);
  assert.match(t, /both teams still have boules, so the mène is void/);
  assert.equal(deadJackText([5, 6], ['A', 'B'], 'out'), 'The cochonnet went out: both teams still have boules, so the mène is void.');
});

test('F76: a too-close jack follows the dead-jack scoring and the next ring goes around it', () => {
  let m = started({});
  for (const p of m.players.filter((q) => q.team === 1)) m = { ...m, players: m.players.map((q) => (q.id === p.id ? { ...q, boulesLeft: 0 } : q)) };
  m = apply(m, { type: 'bouleThrown', playerId: m.players.find((p) => p.team === 0).id });
  const left = m.players.filter((p) => p.team === 0).reduce((n, p) => n + p.boulesLeft, 0);
  m = apply(m, { type: 'throwSettled', jack: { x: 2.2, y: 1 + 2.5 + K }, boules: [] });
  assert.equal(m.phase, 'meneEnd');
  assert.equal(m.result.team, 0);
  assert.equal(m.result.points, left, 'only team 0 holds boules: it scores them');
  assert.match(deadJackText(m.result.inHand, ['A', 'B'], m.result.jackReason), /too close to the circle \(less than 3 m\), so it is dead and goes back to where it lay \(the next mène starts there\) with only A holding boules/);
  const n = apply(m, { type: 'nextMene' });
  assert.ok(Math.hypot(n.geometry.circle.x - 2.2, n.geometry.circle.y - (1 + 2.5 + K)) <= 0.25 + 1e-9 || n.geometry.circle.y !== m.geometry.circle.y);
});

test('F88b: a thrown jack that lands too close (no pre-throw spot) is not replaced', () => {
  const m = apply(started({}), { type: 'bouleThrown', playerId: 'x' });
  assert.ok(m); // jackThrown path never calls jackTooClose: thrown jacks keep their own rules
  const t = apply(started({}), { type: 'jackThrown', team: 0, jack: { x: 2, y: 1 + 2.5 + K } });
  assert.ok(!t.jack || !t.jack.replaced);
});

// --- F77 / F123: F123b: 1 mm tolerance cluster ---
const R0 = 0.0375 + 0.015; // boule radius + jack radius: centre distance = gap + R0
const atGap = (cm) => R0 + cm / 100;
const M = (nm, team, g, side = 1) => b(nm, team, 2 + side * atGap(g), 8);
const mk = (bs, last) => ({ phase: 'play', jack: { x: 2, y: 8 }, boules: bs, jackTeam: 0, lastThrower: last, stayed: true, players: [
  { team: 0, boulesLeft: 2 }, { team: 1, boulesLeft: 2 }] });
test('F123b: 13.4 vs 13.5 tie (Art. 29: last thrower plays again) and both render 13.4', () => {
  const j = { x: 2, y: 8 }, bs = [M('a', 0, 13.4), M('b', 1, 13.5, -1)];
  assert.equal(holdingTeam(j, bs), 'tie');
  assert.ok(meneResult(j, bs).void);
  assert.equal(nextTeam(mk(bs, 1)), 1);
  assert.equal(nextTeam(mk(bs, 0)), 0);
  const cg = canonicalGaps(bs, j);
  assert.equal(fmtCm(cg.get('a')), '13.4 cm');
  assert.equal(fmtCm(cg.get('b')), '13.4 cm');
});
test('F123b: 13.4, 13.5, 13.6 form {13.4,13.5} and {13.6}; no chaining', () => {
  const j = { x: 2, y: 8 };
  const cg = canonicalGaps([M('a', 0, 13.4), M('b', 1, 13.5, -1), M('c', 0, 13.6)], j);
  assert.equal(fmtCm(cg.get('a')), '13.4 cm');
  assert.equal(fmtCm(cg.get('b')), '13.4 cm');
  assert.equal(fmtCm(cg.get('c')), '13.6 cm');
});
test('F123b: exactly 1.0 mm apart ties, 1.01 mm apart does not; 13.449 vs 13.451 tie', () => {
  const j = { x: 2, y: 8 };
  assert.equal(holdingTeam(j, [M('a', 0, 13.4), M('b', 1, 13.5, -1)]), 'tie');
  assert.equal(holdingTeam(j, [M('a', 0, 13.4), M('b', 1, 13.501, -1)]), 0);
  assert.equal(holdingTeam(j, [M('a', 0, 13.449), M('b', 1, 13.451, -1)]), 'tie');
  assert.deepEqual(clusterUm([0, 1000, 1001]), [0, 0, 1001]);
});
test('F123b: when clusters differ the farther team throws', () => {
  const bs = [M('a', 0, 13.4), M('b', 1, 14.6, -1)];
  assert.equal(holdingTeam({ x: 2, y: 8 }, bs), 0);
  assert.equal(nextTeam(mk(bs, 0)), 1);
});
test('F123b: ties inside one team do not change the points', () => {
  const j = { x: 2, y: 8 };
  const r = meneResult(j, [M('a', 0, 10), M('a2', 0, 10.05, -1), M('b', 1, 15)]);
  assert.equal(r.team, 0); assert.equal(r.points, 2);
  assert.equal(meneResult(j, [M('a', 0, 10), M('b', 1, 15)]).points, 1);
});

// --- F79 / F80: placement geometry ---
test('F79: the ring may sit against or across a side string, but stays on the court and clear of the timbers', () => {
  for (const x of [-0.5, 0, 0.1, 0.5, 3.9, 4, 4.4]) {
    for (const dir of [1, -1]) {
      const n = nextCircle({ x, y: 7 }, dir);
      assert.ok(n.circle.x >= 0 && n.circle.x <= 4, `x ${n.circle.x}`);
      assert.ok(n.circle.x - CIRCLE_R > -C.lumberGap && n.circle.x + CIRCLE_R < C.terrainW + C.lumberGap, 'clear of the timbers');
    }
  }
  assert.equal(nextCircle({ x: 0.3, y: 7 }, 1).circle.x, 0.3, 'no longer pushed out to 1 m');
  assert.equal(nextCircle({ x: 3.7, y: 7 }, 1).circle.x, 3.7);
  // F89b: the ring centre keeps CIRCLE_R from each side string (whole ring in bounds); the jack's own bound stays at the string
  assert.equal(nextCircle({ x: 0, y: 7 }, 1).circle.x, CIRCLE_R);
  assert.equal(nextCircle({ x: 4, y: 7 }, 1).circle.x, 4 - CIRCLE_R);
  assert.equal(SIDE_MARGIN, 0);
  assert.equal(nextCircle({ x: 2, y: 0.2 }, -1).circle.y, 1, 'end margin unchanged');
});

test('F80: the front covers a full 10 m throw: a legal jack at the maximum always fits the front', () => {
  assert.ok(Math.abs(FRONT_MIN - (10 + 0.5 + 2 * C.jack.r)) < 1e-12 && Math.abs(FRONT_MIN - 10.53) < 1e-9);
  assert.equal(FRONT_WANT, FRONT_MIN + 1);
  assert.equal(C.jack.r, JACK_R);
  assert.equal(JACK_END_MARGIN, 0.5);
  for (const dir of [1, -1]) {
    for (let y = 1; y <= 14; y += 0.05) {
      const n = nextCircle({ x: 2, y }, dir);
      const g = { circle: { x: n.circle.x, y: n.circle.y }, dir: n.dir };
      const gap = jackGap({ x: n.circle.x, y: n.circle.y + n.dir * (10 + K) }, g);
      assert.ok(Math.abs(gap - 10) < 1e-9);
      assert.ok(jackValid({ x: n.circle.x, y: n.circle.y + n.dir * (10 + K) }, g), `ring y ${n.circle.y} dir ${n.dir}: a 10 m jack is valid (front ${n.front})`);
    }
  }
  // just under the minimum front is moved back; exactly the minimum is left alone
  const keep = nextCircle({ x: 2, y: FRONT_MIN + CIRCLE_R }, 1); // toward y = 0 with exactly FRONT_MIN in front
  assert.ok(!keep.moved);
  assert.ok(nextCircle({ x: 2, y: FRONT_MIN + CIRCLE_R - 0.01 }, 1).moved);
});

test('F88: a jack knocked out of bounds returns to its pre-throw spot, and the next mène starts there', () => {
  let m = started();
  assert.equal(m.phase, 'play');
  const before = { x: m.jack.x, y: m.jack.y };
  const p = m.players.find((q) => q.team === 0);
  m = apply(m, { type: 'bouleThrown', playerId: p.id });
  m = apply(m, { type: 'throwSettled', jack: { x: -1, y: 12, dead: true, spot: { x: 0.02, y: 11 } }, boules: [] });
  assert.equal(m.phase, 'meneEnd');
  assert.deepEqual(m.jack.spot, before);
  assert.equal(m.result.jackReason, 'knocked');
  assert.match(deadJackText(m.result.inHand, undefined, m.result.jackReason), /goes back to where it lay/);
  const n = apply(m, { type: 'nextMene' });
  const want = nextCircle(before, m.geometry.dir ?? 1, { width: m.geometry.width, length: m.geometry.length });
  assert.deepEqual(n.geometry.circle, { x: want.circle.x, y: want.circle.y });
});

test('F88: with no known pre-throw spot the physics last-in-bounds spot (F10) is used', () => {
  let m = started();
  const p = m.players.find((q) => q.team === 0);
  m = apply(m, { type: 'bouleThrown', playerId: p.id });
  m = { ...m, jack: null };
  m = apply(m, { type: 'throwSettled', jack: { x: -1, y: 12, dead: true, spot: { x: 0.02, y: 11 } }, boules: [] });
  assert.deepEqual(m.jack.spot, { x: 0.02, y: 11 });
  assert.equal(m.result.jackReason, 'out');
});

test('F100: fmtCm is always centimetres with one decimal, never metres', () => {
  assert.equal(fmtCm(1.002), '100.2 cm');
  assert.equal(fmtCm(0), '0.0 cm');
  assert.equal(fmtCm(0.183), '18.3 cm');
  assert.equal(fmtCm(12.345), '1234.5 cm');
  assert.equal(fmtCm(-0.02), '0.0 cm', 'touching or overlapping shows 0.0 cm');
});
