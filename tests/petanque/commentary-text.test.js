import test from 'node:test';
import assert from 'node:assert/strict';
import { describe, quip, faultText, spotText, ownerName, gapText, meneWinNote } from '../../assets/js/petanque/commentary-text.js';

const R = 0.0375, JR = 0.015;
const boule = (id, team, x, y, extra = {}) => ({ id, kind: 'boule', team, owner: team === 0 ? 'you' : 'odette', x, y, r: R, dead: false, ...extra });
const jack = (x, y, extra = {}) => ({ id: 1, kind: 'jack', team: -1, x, y, r: JR, dead: false, ...extra });
const players = [{ id: 'you', team: 0, isHuman: true, name: 'You' }, { id: 'odette', team: 1, isHuman: false, name: 'Odette' }];
const match = { players, jack: null, boules: [], geometry: undefined };
const ctx = (j, bodies = [], preThrow = new Map()) => ({ jack: j, match, bodies, preThrow });

test('ownerName: human, AI, unknown', () => {
  assert.equal(ownerName({ owner: 'you' }, players), 'Your');
  assert.equal(ownerName({ owner: 'odette' }, players), "Odette's");
  assert.equal(ownerName({ owner: 'zz' }, players), 'The');
  assert.equal(ownerName({ owner: 'you' }, null), 'The');
});

test('gapText: edge to edge in cm', () => {
  assert.equal(gapText(boule(2, 0, 2, 7), jack(2, 7 + R + JR + 0.1)), '10.0 cm');
});

test('describe: dead boule, plain gap, biberon, carreau', () => {
  const j = jack(2, 8);
  let r = describe(boule(2, 0, 2, 7, { dead: true }), [], ctx(j));
  assert.deepEqual(r, { text: 'Your boule is out: dead boule.', kind: 'dead' });
  r = describe(boule(2, 1, 2, 7.5), [], ctx(j));
  assert.match(r.text, /^Odette's boule is .* from the jack\.$/);
  assert.equal(r.kind, null);
  r = describe(boule(2, 0, 2, 8 - R - JR), [], ctx(j));
  assert.equal(r.kind, 'great');
  assert.match(r.text, /^Biberon!/);
  const target = boule(3, 1, 2.6, 7);
  const shooter = boule(2, 0, 2, 7);
  r = describe(shooter, [{ type: 'hit', a: 2, b: 3 }], ctx(j, [shooter, target], new Map([[3, { x: 2, y: 7 }]])));
  assert.deepEqual(r, { text: 'Carreau! Your boule replaces the target.', kind: 'carreau' });
});

test('describe: dead jack', () => {
  assert.equal(describe(boule(2, 0, 2, 7), [], ctx(jack(2, 8, { dead: true }))).text, 'The jack is out: dead jack.');
});

test('describe is null-jack safe', () => {
  assert.doesNotThrow(() => describe(boule(2, 0, 2, 7), [], ctx(null)));
  assert.doesNotThrow(() => describe(boule(2, 0, 2, 7, { dead: true }), [], ctx(null)));
});

test('quip is null-jack safe and honours the kind', () => {
  const talk = { say: (id, ev) => `${id}:${ev}`, line: (id, ev) => `${id}-line:${ev}` };
  const m = { ...match, jack: null, boules: [] };
  const base = { jack: null, match: m, kind: null, talk, partner: 'pierre', chance: () => 0.9 };
  assert.doesNotThrow(() => quip(boule(2, 1, 2, 7), null, base));
  assert.equal(quip(boule(2, 1, 2, 7), null, { ...base, kind: 'dead' }), 'odette:dead');
  assert.equal(quip(boule(2, 0, 2, 7), null, { ...base, kind: 'carreau' }), 'pierre:ownScores');
  assert.equal(quip(boule(2, 9, 2, 7, { owner: 'nobody' }), null, base), '');
});

test('faultText', () => {
  assert.equal(faultText(null), '');
  assert.equal(faultText({ reason: 'short', dist: 5.04 }), 'Too short: 5.0 m.');
  assert.equal(faultText({ reason: 'far', dist: 10.46 }), 'Too far: 10.5 m.');
  assert.equal(faultText({ reason: 'line', side: 'left', dist: 7 }), 'Out over the left line.');
  assert.equal(faultText({ reason: 'end', gap: 0.5, margin: 1, dist: 7 }), 'Too close to the end string: 0.5 m, it needs 1 m.');
  assert.equal(faultText({ reason: 'x', back: true, dist: 7 }), 'Went over a line and came back.');
  assert.equal(faultText({ reason: 'x', dist: 7 }), 'Out of bounds.');
});

test('spotText: facts plus the quip', () => {
  const talk = { say: (id, ev) => (ev === 'spotJack' ? 'Here.' : '') };
  const p = { id: 'odette', team: 1, name: 'Odette' };
  assert.equal(spotText(p, { label: 'Odette aims' }, 'jack', talk), 'Odette aims. Here.');
  assert.equal(spotText(p, {}, 'boule', talk), 'Odette picks her spot.');
});

test('meneWinNote', () => {
  const j = jack(2, 8), win = boule(2, 0, 2, 8 - R - JR - 0.1);
  assert.equal(meneWinNote({ note: 'x', closeCall: true, win, jack: j, players }), 'Close call! Closest: Your boule, 10.0 cm from the jack.');
  assert.equal(meneWinNote({ note: 'Biberon! y', closeCall: false, win, jack: j, players }), 'Biberon! y Closest: Your boule, 10.0 cm from the jack.');
  assert.equal(meneWinNote({ note: 'keep', win: null, jack: j, players }), 'keep');
  assert.equal(meneWinNote({ note: 'keep', win, jack: null, players }), 'keep');
});
