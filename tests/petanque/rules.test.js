import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMatch, apply, nextTeam, meneResult, holdingTeam, jackValid, jackFault, jackPlaceValid, jackPlaceFault, playersWithBoules, deadJackText,
} from '../../assets/js/petanque/rules.js';

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
  assert.ok(jackValid({ x: 2, y: 7 })); // exactly 6 m
  assert.ok(jackValid({ x: 2, y: 11 })); // exactly 10 m
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
  assert.ok(Math.abs(jackFault({ x: 2, y: 5 }).dist - 4) < 1e-9);
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
  assert.ok(!side(0.02, yAt(0.02, 5.9)) && !side(0.02, yAt(0.02, 10.1)));
  assert.ok(side(0.02, yAt(0.02, 6.001)) && side(0.02, yAt(0.02, 9.999)));
});

test('E20: the jack centre must be more than 0.5 m before the end string', () => {
  const g = { length: 11.2 }; // a short court so the end string is reachable inside 6-10 m of the circle
  assert.ok(jackValid({ x: 2, y: 10.69 }, g), '0.51 m from the end string');
  assert.ok(!jackValid({ x: 2, y: 10.71 }, g), '0.49 m from the end string');
  assert.ok(!jackValid({ x: 2, y: 10.7 }, g), 'exactly 0.5 m is not more than 0.5 m');
  const f = jackFault({ x: 2, y: 10.9 }, g);
  assert.equal(f.reason, 'end');
  assert.ok(Math.abs(f.gap - 0.3) < 1e-9 && f.margin === 0.5);
  // flipped direction: the end string is at y = 0
  const flip = { circle: { x: 2, y: 12 }, dir: -1 };
  assert.ok(jackValid({ x: 2, y: 4.0 }, flip) && jackFault({ x: 2, y: 4.0 }, flip) === null);
  assert.ok(!jackValid({ x: 2, y: 0.4 }, { ...flip, jackMax: 12 }));
  assert.ok(jackValid({ x: 2, y: 0.6 }, { ...flip, jackMax: 12 }));
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
  assert.equal(jackFault({ x: 2, y: 7 }), null);
  assert.equal(jackFault({ x: 0.96, y: 9.21 }), null);
});

test('E08: far and short faults carry the measured distance; a dead jack that rolled back is flagged', () => {
  assert.equal(jackFault({ x: 2, y: 11.4 }).reason, 'far');
  assert.ok(Math.abs(jackFault({ x: 2, y: 11.4 }).dist - 10.4) < 1e-9);
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
