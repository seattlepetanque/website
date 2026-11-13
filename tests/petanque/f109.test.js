// F109: a human turn starts facing the jack (court.facingTo)
import test from 'node:test';
import assert from 'node:assert/strict';
import { facingTo } from '../../assets/js/petanque/court.js';

const DEG = Math.PI / 180, c = { x: 2, y: 1 };
test('F109 faces the jack bearing', () => {
  assert.ok(Math.abs(facingTo(c, { x: 5, y: 7 }, 90 * DEG, 1) - Math.atan2(3, 6)) < 1e-9);
});
test('F109 no jack or jack on the circle: straight ahead, both directions', () => {
  assert.equal(facingTo(c, null, 1, 1), 0);
  assert.equal(facingTo(c, c, 1, 1), 0);
  assert.equal(facingTo(c, null, 1, -1), Math.PI);
});
test('F109 clamps to maxOff either side', () => {
  assert.ok(Math.abs(facingTo(c, { x: 12, y: 1.5 }, 0.6, 1) - 0.6) < 1e-9);
  assert.ok(Math.abs(facingTo(c, { x: -8, y: 1.5 }, 0.6, 1) + 0.6) < 1e-9);
});
test('F109 facing the other way (dir -1): bearing to a jack behind in +y world is straight ahead', () => {
  assert.ok(Math.abs(facingTo(c, { x: 2, y: -6 }, 0.6, -1) - Math.PI) < 1e-9);
  const y = facingTo(c, { x: 3, y: -6 }, 0.6, -1); // slightly to the world +x side
  assert.ok(Math.abs(y - Math.atan2(1, -7)) < 1e-9);
});
