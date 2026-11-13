import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAnnouncement, isCarreau, isBiberon } from '../../assets/js/petanque/announce.js';

const R = 0.0375, JR = 0.015;
const boule = (id, team, x, y, extra = {}) => ({ id, kind: 'boule', team, x, y, r: R, dead: false, ghost: false, ...extra });
const jack = (x, y, extra = {}) => ({ id: 1, kind: 'jack', team: -1, x, y, r: JR, dead: false, ghost: false, ...extra });
const hit = (a, b) => ({ type: 'hit', a, b });
const before = (...bs) => new Map(bs.map((b) => [b.id, { x: b.x, y: b.y }]));

test('carreau: shooter replaces the target, which rolled away', () => {
  const t0 = boule(10, 1, 2, 6), j = jack(2, 8);
  const b0 = before(j, t0);
  const bodies = [j, boule(10, 1, 2.4, 6.9), boule(20, 0, 2.03, 6.02)];
  assert.equal(detectAnnouncement({ before: b0, bodies, shooterId: 20, events: [hit(20, 10)] }), 'carreau');
});

test('carreau: target left the court (dead), plain-object before, event ids swapped', () => {
  const b0 = { 10: { x: 2, y: 6 }, 1: { x: 2, y: 8 } };
  const bodies = [jack(2, 8), boule(10, 1, 5, 6, { dead: true }), boule(20, 0, 2.08, 6)];
  assert.equal(detectAnnouncement({ before: b0, bodies, shooterId: 20, events: [hit(10, 20)] }), 'carreau');
});

test('carreau works for an AI or human shooter alike (only ids matter)', () => {
  const b0 = before(boule(10, 0, 1, 5));
  const bodies = [jack(2, 8), boule(10, 0, 1.5, 5.5), boule(30, 1, 1, 5.05)];
  assert.ok(isCarreau({ before: b0, bodies, shooterId: 30, events: [hit(30, 10)] }));
});

test('no carreau: shooter rolled on past the spot (> 10 cm)', () => {
  const b0 = before(boule(10, 1, 2, 6));
  const bodies = [jack(2, 8), boule(10, 1, 2.5, 6.5), boule(20, 0, 2, 6.4)];
  assert.equal(isCarreau({ before: b0, bodies, shooterId: 20, events: [hit(20, 10)] }), false);
});

test('no carreau: target barely moved (a nudge)', () => {
  const b0 = before(boule(10, 1, 2, 6));
  const bodies = [jack(2, 8), boule(10, 1, 2, 6.1), boule(20, 0, 2, 5.95)];
  assert.equal(isCarreau({ before: b0, bodies, shooterId: 20, events: [hit(20, 10)] }), false);
});

test('no carreau: teammate boule, no hit event, dead shooter, ghost shooter', () => {
  const b0 = before(boule(10, 0, 2, 6));
  const moved = boule(10, 0, 2.5, 6.6);
  assert.equal(isCarreau({ before: b0, bodies: [jack(2, 8), moved, boule(20, 0, 2, 6)], shooterId: 20, events: [hit(20, 10)] }), false);
  const b1 = before(boule(10, 1, 2, 6));
  const t = boule(10, 1, 2.5, 6.6);
  assert.equal(isCarreau({ before: b1, bodies: [jack(2, 8), t, boule(20, 0, 2, 6)], shooterId: 20, events: [] }), false);
  assert.equal(isCarreau({ before: b1, bodies: [jack(2, 8), t, boule(20, 0, 2, 6, { dead: true })], shooterId: 20, events: [hit(20, 10)] }), false);
  assert.equal(isCarreau({ before: b1, bodies: [jack(2, 8), t, boule(20, 0, 2, 6, { ghost: true })], shooterId: 20, events: [hit(20, 10)] }), false);
});

test('no carreau: hitting the jack is not a carreau', () => {
  const b0 = before(jack(2, 7));
  const bodies = [jack(2, 7.5), boule(20, 0, 2, 7.0)];
  assert.equal(isCarreau({ before: b0, bodies, shooterId: 20, events: [hit(20, 1)] }), false);
});

test('biberon: thrown boule stops touching the jack (gap 0.5 cm)', () => {
  const j = jack(2, 8);
  const b0 = before(j);
  const bodies = [j, boule(20, 0, 2, 8 + JR + R + 0.005)];
  assert.equal(detectAnnouncement({ before: b0, bodies, shooterId: 20, events: [] }), 'biberon');
});

test('biberon: a nudge of the jack that ends touching counts; the jack movement does not matter', () => {
  const b0 = before(jack(2, 8), boule(20, 0, 2, 8.2));
  const bodies = [jack(2, 8.1), boule(20, 0, 2, 8.1 + JR + R)];
  assert.equal(isBiberon({ before: b0, bodies, shooterId: 20 }), true);
});

test('biberon: an already touching, undisturbed boule is not announced again', () => {
  const j = jack(2, 8), t = boule(10, 1, 2, 8 + JR + R), far = boule(20, 0, 3, 5);
  const b0 = before(j, t);
  assert.equal(detectAnnouncement({ before: b0, bodies: [j, t, far], shooterId: 20, events: [] }), null);
});

test('no biberon: gap 2 cm, dead/ghost boule, dead jack, two boules touching each other', () => {
  const j = jack(2, 8);
  assert.equal(isBiberon({ before: before(j), bodies: [j, boule(20, 0, 2, 8 + JR + R + 0.02)], shooterId: 20 }), false);
  assert.equal(isBiberon({ before: before(j), bodies: [j, boule(20, 0, 2, 8 + JR + R, { dead: true })], shooterId: 20 }), false);
  assert.equal(isBiberon({ before: before(j), bodies: [j, boule(20, 0, 2, 8 + JR + R, { ghost: true })], shooterId: 20 }), false);
  const dj = jack(2, 8, { dead: true });
  assert.equal(isBiberon({ before: before(dj), bodies: [dj, boule(20, 0, 2, 8 + JR + R)], shooterId: 20 }), false);
  const a = boule(10, 1, 3, 5), c = boule(20, 0, 3 + 2 * R, 5);
  assert.equal(detectAnnouncement({ before: before(j, a), bodies: [j, a, c], shooterId: 20, events: [hit(20, 10)] }), null);
});

test('carreau wins over biberon when both hold', () => {
  const t0 = boule(10, 1, 2, 8 + JR + R), j = jack(2, 8);
  const b0 = before(j, t0);
  const bodies = [j, boule(10, 1, 2.6, 8.6), boule(20, 0, 2, 8 + JR + R + 0.003)];
  assert.equal(detectAnnouncement({ before: b0, bodies, shooterId: 20, events: [hit(20, 10)] }), 'carreau');
});

test('a jack throw (no shooter) with no boules announces nothing', () => {
  assert.equal(detectAnnouncement({ before: before(), bodies: [jack(2, 8)], shooterId: null, events: [] }), null);
});

test('F101 no biberon: a displaced boule stops next to the jack (thrown boule far away)', () => {
  const j = jack(2, 8), t = boule(10, 1, 2.3, 7.5);
  const bodies = [j, boule(10, 1, 2, 8 + JR + R + 0.004), boule(20, 0, 3, 6)];
  assert.equal(detectAnnouncement({ before: before(j, t), bodies, shooterId: 20, events: [hit(20, 10)] }), null);
});

test('F101 biberon: the thrown boule stops next to the jack', () => {
  const j = jack(2, 8);
  const bodies = [j, boule(20, 0, 2, 8 + JR + R + 0.004)];
  assert.equal(detectAnnouncement({ before: before(j), bodies, shooterId: 20, events: [] }), 'biberon');
});

test('F101 biberon: thrown boule bounced off another and still stops next to the jack', () => {
  const j = jack(2, 8), t = boule(10, 1, 2.5, 7);
  const bodies = [j, boule(10, 1, 2.9, 6.6), boule(20, 0, 2, 8 + JR + R + 0.002)];
  assert.equal(detectAnnouncement({ before: before(j, t), bodies, shooterId: 20, events: [hit(20, 10), hit(20, 10)] }), 'biberon');
});

test('F101 no biberon: displaced boule next to the jack even when the thrown one also touches nothing', () => {
  const j = jack(2, 8), t = boule(10, 1, 2, 8.4);
  const bodies = [j, boule(10, 1, 2, 8 + JR + R), boule(20, 0, 2.5, 7.2)];
  assert.equal(isBiberon({ before: before(j, t), bodies, shooterId: 20 }), false);
  assert.equal(isBiberon({ before: before(j, t), bodies }), false); // no shooter id: never
});

test('F101 no biberon: pre-existing touching boule unchanged, thrown boule elsewhere', () => {
  const j = jack(2, 8), t = boule(10, 1, 2, 8 + JR + R);
  const bodies = [j, t, boule(20, 0, 4, 5)];
  assert.equal(detectAnnouncement({ before: before(j, t), bodies, shooterId: 20, events: [] }), null);
});
