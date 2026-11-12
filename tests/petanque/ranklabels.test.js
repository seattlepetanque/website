import test from 'node:test';
import assert from 'node:assert/strict';
import { rankBoules, layoutBadges } from '../../assets/js/petanque/ranklabels.js';

const jack = { id: 'j', kind: 'jack', x: 0, y: 0, z: 0, r: 0.015 };
const b = (id, x, y, team = 0, extra = {}) => ({ id, kind: 'boule', team, x, y, z: 0.037, r: 0.037, ...extra });

test('F91: ranks closest first, both teams, dead and jack skipped', () => {
  const r = rankBoules([b('a', 1, 0), jack, b('b', 0, 0.3, 1), b('c', 0.1, 0.1, 0, { dead: true }), b('d', -2, 0, 1)]);
  assert.deepEqual(r.map((q) => [q.id, q.rank]), [['b', 1], ['a', 2], ['d', 3]]);
});
test('F91: no jack (or a dead jack) gives no labels', () => {
  assert.deepEqual(rankBoules([b('a', 1, 0)]), []);
  assert.deepEqual(rankBoules([{ ...jack, dead: true }, b('a', 1, 0)]), []);
});
test('F91: a lone badge sits straight away from the jack', () => {
  const it = rankBoules([jack, b('a', 1, 0)]);
  const [p] = layoutBadges(it, jack, 0.1);
  assert.ok(p.x > 1 && Math.abs(p.y) < 1e-9);
});
test('F91: badges of touching boules do not overlap each other or any boule or the jack', () => {
  const bodies = [jack, b('a', 0.08, 0), b('b', 0.08, 0.075, 1), b('c', 0.155, 0.04), b('d', 0.0, 0.08, 1), b('e', -0.07, 0.01)];
  const it = rankBoules(bodies), br = 0.05, L = layoutBadges(it, jack, br);
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) assert.ok(Math.hypot(L[i].x - L[j].x, L[i].y - L[j].y) >= 2 * br - 1e-9, `badges ${i},${j}`);
    assert.ok(Math.hypot(L[i].x - jack.x, L[i].y - jack.y) >= br + jack.r, 'jack ' + i);
  }
});
