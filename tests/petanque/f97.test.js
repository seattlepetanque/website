import test from 'node:test';
import assert from 'node:assert/strict';
import { pickJackCarrier, ringStagePoint, ringMayDrop, planGoals, atPlaces, meneEndReady } from '../../assets/js/petanque/crowd.js';

const players = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const pos = new Map([['a', { x: 0, y: 0 }], ['b', { x: 5, y: 5 }], ['c', { x: 5, y: 5 }], ['d', { x: 9, y: 9 }]]);

test('F97: the jack carrier is the nearest player other than the ring carrier', () => {
  assert.equal(pickJackCarrier(players, pos, { x: 0.5, y: 0.5 }, { ringHolder: 'b', ringCarrier: 'b' }), 'a');
  assert.equal(pickJackCarrier(players, pos, { x: 0.5, y: 0.5 }, { ringHolder: 'a', ringCarrier: 'a' }), 'b'); // 'a' is nearest but carries the ring
});
test('F97: ties are broken by id, and never the ring carrier', () => {
  const p = pickJackCarrier(players, pos, { x: 5, y: 5 }, { ringHolder: 'b', ringCarrier: 'b' });
  assert.equal(p, 'c');
  for (const ring of ['a', 'b', 'c', 'd']) for (const j of [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 20, y: -3 }]) assert.notEqual(pickJackCarrier(players, pos, j, { ringHolder: ring, ringCarrier: ring }), ring);
});
test('F97: positions may be a plain object; a lone player gets nobody', () => {
  assert.equal(pickJackCarrier(players, { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } }, { x: 0, y: 0 }, { ringCarrier: 'a' }), 'b');
  assert.equal(pickJackCarrier([{ id: 'a' }], pos, { x: 0, y: 0 }, { ringHolder: 'a', ringCarrier: 'a' }), null);
});
test('F97: the ring waits short of the spot, on the side it came from', () => {
  const s = ringStagePoint({ x: 0, y: 10 }, { x: 0, y: 5 }, 1.6);
  assert.ok(Math.abs(s.x) < 1e-9 && Math.abs(s.y - 6.6) < 1e-9);
  assert.deepEqual(ringStagePoint({ x: 0.5, y: 5 }, { x: 0, y: 5 }, 1.6), { x: 0.5, y: 5 }); // already close: stays
});
test('F97: the ring may be dropped only once the jack is down', () => {
  assert.equal(ringMayDrop({ jackTask: null, jackDone: true }), true); // no dead jack
  assert.equal(ringMayDrop({ jackTask: {}, jackDone: false }), false);
  assert.equal(ringMayDrop({ jackTask: {}, jackDone: true }), true);
});
test('F97: the mène end is ready only with the ring down and everybody in place', () => {
  const places = new Map([['a', { x: 1, y: 1 }]]);
  assert.equal(meneEndReady({ ringDown: true, collectDone: atPlaces(new Map([['a', { x: 3, y: 3 }]]), places) }), false);
  assert.equal(meneEndReady({ ringDown: true, collectDone: atPlaces(new Map([['a', { x: 1.1, y: 1 }]]), places) }), true);
  assert.equal(meneEndReady({ ringDown: false, collectDone: true }), false);
  const g = planGoals({ geometry: { circle: { x: 2, y: 3 }, dir: 1 }, jackTeam: 0, players: [{ id: 'a', team: 0, isHuman: true }] }, { terrainW: 4, terrainL: 15, jackMinDist: 6, jackMaxDist: 10 });
  assert.deepEqual(g.to, { x: 2, y: 3 });
});
