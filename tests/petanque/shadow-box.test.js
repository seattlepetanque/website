import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowBoxCovers, daylightAt, SUN_DISTANCE } from '../../assets/js/petanque/daylight.js';

const half = 14;
test('F95: a player 14 m upsun of the look target keeps a shadow at every sun position', () => {
  for (let i = 0; i <= 10; i++) {
    const d = daylightAt(i / 10).sunDir, h = Math.hypot(d[0], d[1]);
    const player = [d[0] / h * 14, d[1] / h * 14, 1.7]; // head height, straight toward the sun
    assert.ok(shadowBoxCovers(player, [0, 0, 0], d, half), 'progress ' + i / 10);
    // the old near = 1 plane clipped them: this documents the bug
    assert.ok(!shadowBoxCovers(player, [0, 0, 0], d, half, 1, 60, SUN_DISTANCE), 'old near clipped ' + i / 10);
  }
});
test('players beyond the box sides or the far plane are still outside', () => {
  const d = daylightAt(0).sunDir;
  assert.ok(!shadowBoxCovers([0, 0, 0], [40, 40, 0], d, half));
  assert.ok(shadowBoxCovers([0, 0, 0], [0, 0, 0], d, half));
});
