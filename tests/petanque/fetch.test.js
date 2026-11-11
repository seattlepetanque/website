import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../../assets/js/petanque/constants.js';
import { planPath, zoneOf, standPoint, pathLength } from '../../assets/js/petanque/fetch.js';
import { bendReach } from '../../assets/js/petanque/character.js';

test('zones: court, timber band, outside', () => {
  assert.equal(zoneOf(2, 8), 2);
  assert.equal(zoneOf(-C.lumberGap - 0.05, 8), 1);
  assert.equal(zoneOf(-1.5, 8), 0);
});

test('a path from outside the timbers to the court has one lifted leg per timber crossed', () => {
  const path = planPath({ x: 6, y: 0 }, { x: 2, y: 8 });
  assert.equal(path.filter((p) => p.lift > 1).length, 1);
  assert.deepEqual([path.at(-1).x, path.at(-1).y].map((v) => Math.round(v * 100) / 100), [2, 8]);
  const across = planPath({ x: 6, y: 5 }, { x: 2, y: 16.5 });
  assert.equal(across.filter((p) => p.lift > 1).length, 2);
});

test('a path inside the court has no lifted leg and detours around a live boule in the way', () => {
  const clear = planPath({ x: 2, y: 2 }, { x: 2, y: 8 });
  assert.equal(clear.length, 1);
  const around = planPath({ x: 2, y: 2 }, { x: 2, y: 8 }, [{ x: 2.05, y: 5 }]);
  assert.ok(around.length > 1 && around.every((p) => !(p.lift > 1)));
  let min = Infinity; // every sample along the route stays clear of the boule
  let q = { x: 2, y: 2 };
  for (const p of around) {
    for (let t = 0; t <= 1; t += 0.02) min = Math.min(min, Math.hypot(q.x + (p.x - q.x) * t - 2.05, q.y + (p.y - q.y) * t - 5));
    q = p;
  }
  assert.ok(min > 0.3, `passes ${min.toFixed(2)} m from the boule`);
  assert.ok(pathLength({ x: 2, y: 2 }, around) < 6.6);
});

test('standPoint puts the bent hand on the ball', () => {
  const r = bendReach(1.75), ball = { x: 3, y: 9 }, from = { x: 1, y: 1 };
  const s = standPoint(ball, from, { x: r[0], y: r[1] });
  const hx = s.x + r[0] * Math.cos(s.yaw) + r[1] * Math.sin(s.yaw), hy = s.y - r[0] * Math.sin(s.yaw) + r[1] * Math.cos(s.yaw);
  assert.ok(Math.hypot(hx - ball.x, hy - ball.y) < 1e-9);
});
