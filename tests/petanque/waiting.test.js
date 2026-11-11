import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../../assets/js/petanque/constants.js';
import { waitingSlots, pickWaitingSlot, WAIT_GAP } from '../../assets/js/petanque/waiting.js';
import { zoneOf, planRoute, outsideWaypoints } from '../../assets/js/petanque/fetch.js';

const jack = { x: 2, y: 8 };

test('waiting slots: both sides, both zones, outside the timbers, never overlapping', () => {
  const slots = waitingSlots(jack);
  assert.ok(slots.some((s) => s.side < 0 && s.zone === 'jack') && slots.some((s) => s.side > 0 && s.zone === 'circle'));
  for (const s of slots) assert.equal(zoneOf(s.x, s.y), 0);
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    assert.ok(Math.hypot(slots[i].x - slots[j].x, slots[i].y - slots[j].y) >= 0.79, 'slots overlap');
  }
  // beyond the cochonnet means further out than it; behind the circle means behind the circle
  assert.ok(slots.filter((s) => s.zone === 'jack').every((s) => s.y > jack.y));
  assert.ok(slots.filter((s) => s.zone === 'circle').every((s) => s.y < C.circle.y));
});

test('slots follow the cochonnet', () => {
  const near = waitingSlots({ x: 2, y: 6.5 }).filter((s) => s.zone === 'jack');
  const far = waitingSlots({ x: 2, y: 10 }).filter((s) => s.zone === 'jack');
  assert.ok(Math.min(...far.map((s) => s.y)) > Math.max(...near.map((s) => s.y)) - 1);
  assert.ok(Math.min(...far.map((s) => s.y)) > 10);
});

test('a returning player takes the nearest free slot on the nearer side', () => {
  const left = pickWaitingSlot({ x: 1, y: 8.5 }, jack);
  assert.equal(left.side, -1);
  assert.equal(left.zone, 'jack'); // nearer than the slots behind the circle
  const right = pickWaitingSlot({ x: 3.5, y: 0.5 }, jack);
  assert.equal(right.side, 1);
  assert.equal(right.zone, 'circle');
});

test('people never share a slot; a full side sends the next person to the other', () => {
  const taken = [];
  for (let n = 0; n < 4; n++) {
    const s = pickWaitingSlot({ x: -2, y: 4 }, jack, taken);
    assert.ok(s);
    for (const o of taken) assert.ok(Math.hypot(o.x - s.x, o.y - s.y) >= WAIT_GAP);
    taken.push(s);
  }
  const all = waitingSlots(jack).filter((s) => s.side < 0);
  assert.ok(pickWaitingSlot({ x: -2, y: 4 }, jack, all).side > 0);
  assert.equal(pickWaitingSlot({ x: -2, y: 4 }, jack, waitingSlots(jack)), null);
});

test('outside route: a ball beyond the side timber is reached round the end, never across the court', () => {
  const from = { x: -1, y: 0.2 }, to = { x: 4.9, y: 9.2 };
  const path = planRoute(from, to, [], { outside: true });
  let p = from;
  for (const q of path) {
    for (let i = 0; i <= 50; i++) {
      const x = p.x + (q.x - p.x) * i / 50, y = p.y + (q.y - p.y) * i / 50;
      assert.ok(!(x > 0 && x < C.terrainW && y > 0 && y < C.terrainL), 'walked across the court');
    }
    p = q;
  }
  assert.ok(path.every((q) => !(q.lift > 1)), 'no timber crossed');
  assert.deepEqual([path.at(-1).x, path.at(-1).y], [to.x, to.y]);
});

test('outside route: carrying to the far row goes round and steps over the far timber once', () => {
  const path = planRoute({ x: 4.9, y: 9.2 }, { x: 2, y: C.terrainL + 0.15 }, [], { outside: true });
  assert.equal(path.filter((q) => q.lift > 1).length, 1);
  assert.equal(outsideWaypoints({ x: -1, y: 3 }, { x: -1, y: 9 }).length, 0);
});
