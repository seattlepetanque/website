import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMatch, apply, nextTeam, meneResult, jackValid, playersWithBoules,
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
  assert.ok(!jackValid({ x: 0.5, y: 8 })); // too near side
  assert.ok(!jackValid({ x: 3.5, y: 8 }));
  assert.ok(jackValid({ x: 1, y: 8 }));
  assert.ok(!jackValid({ x: 2, y: 8, dead: true }));
});

test('invalid jack hands over to the other team, valid starts play', () => {
  let m = apply(createMatch({}), { type: 'jackThrown', team: 0, jack: { x: 2, y: 3 } });
  assert.equal(m.phase, 'jack');
  assert.equal(m.jackTeam, 1);
  m = apply(m, { type: 'jackThrown', team: 1, jack: jackAt });
  assert.equal(m.phase, 'play');
  assert.equal(m.jackTeam, 1);
  assert.equal(nextTeam(m), 1); // jack thrower plays first boule
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

test('nobody on the ground: last thrower throws again', () => {
  let m = started({});
  m = throwBoule(m, 'you', jackAt, [b('a', 0, 9, 9, true)]);
  assert.equal(nextTeam(m), 0);
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
  assert.deepEqual(m.scores, [5, 8]);
});
