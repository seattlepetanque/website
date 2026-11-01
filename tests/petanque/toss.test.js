import test from 'node:test';
import assert from 'node:assert/strict';
import { LOFT_MIN, LOFT_MAX } from '../../assets/js/petanque/donnee.js';
import { pullToLoft, isCancel, snapDonnee, classifyDrag, createTossMachine } from '../../assets/js/petanque/toss.js';

const H = 600, W = 800, DEG = Math.PI / 180;

test('pullToLoft is monotonic, clamped, with exact endpoints', () => {
  assert.equal(pullToLoft(0, H), LOFT_MIN);
  assert.equal(pullToLoft(-50, H), LOFT_MIN);
  assert.ok(Math.abs(pullToLoft(0.35 * H, H) - LOFT_MAX) < 1e-12);
  assert.equal(pullToLoft(5 * H, H), LOFT_MAX);
  let prev = -Infinity;
  for (let p = -10; p <= 0.4 * H; p += 2) { const l = pullToLoft(p, H); assert.ok(l >= prev); prev = l; }
  const mid = pullToLoft(0.175 * H, H);
  assert.ok(mid > 30 * DEG && mid < 50 * DEG);
});

test('isCancel above the press point only', () => {
  assert.equal(isCancel(-21), true);
  assert.equal(isCancel(-19), false);
  assert.equal(isCancel(0), false);
  assert.equal(isCancel(100), false);
});

test('snapDonnee picks nearest within radius', () => {
  const ts = [{ id: 'a', x: 1, y: 5, r: 0.1 }, { id: 'b', x: 1.2, y: 5, r: 0.1 }];
  assert.deepEqual(snapDonnee({ x: 1.15, y: 5 }, ts, 0.25), { x: 1.2, y: 5, snappedTo: 'b' });
  assert.deepEqual(snapDonnee({ x: 1.05, y: 5 }, ts, 0.25), { x: 1, y: 5, snappedTo: 'a' });
  assert.deepEqual(snapDonnee({ x: 3, y: 5 }, ts, 0.25), { x: 3, y: 5, snappedTo: null });
  assert.equal(snapDonnee({ x: 3, y: 5 }, [], 0.25).snappedTo, null);
});

test('classifyDrag', () => {
  assert.equal(classifyDrag(2, 2, 50), 'undecided');
  assert.equal(classifyDrag(2, 2, 200), 'toss');
  assert.equal(classifyDrag(30, 5, 50), 'turn');
  assert.equal(classifyDrag(-30, -5, 50), 'turn');
  assert.equal(classifyDrag(3, 30, 50), 'toss');
  assert.equal(classifyDrag(3, -30, 50), 'undecided');
});

function setup(targets = []) {
  const log = { turns: [], previews: [], throws: [], cancels: 0 };
  let yaw = 0;
  const m = createTossMachine({
    pick: (x, y) => (y > 100 ? { x: 2, y: 7 } : null),
    getYaw: () => yaw, getOrigin: () => ({ x: 2, y: 1 }),
    onTurn: (d) => log.turns.push(d), onPreview: (p) => log.previews.push(p),
    onThrow: (t) => log.throws.push(t), onCancel: () => log.cancels++,
    targets: () => targets, size: () => ({ w: W, h: H }),
  });
  m.setPhase('aim');
  return { m, log, setYaw: (v) => { yaw = v; } };
}

test('pull down and release throws with expected loft', () => {
  const { m, log } = setup();
  m.down(1, 400, 300, 0);
  m.move(1, 401, 320, 20);
  assert.equal(m.state, 'pulling');
  m.move(1, 401, 300 + 0.35 * H, 400);
  m.up(1, 401, 300 + 0.35 * H, 420);
  assert.equal(log.throws.length, 1);
  assert.ok(Math.abs(log.throws[0].loft - LOFT_MAX) < 1e-9);
  assert.deepEqual(log.throws[0].donnee, { x: 2, y: 7 });
  assert.equal(log.cancels, 0);
  assert.equal(m.phase, 'off');
});

test('pulling back above the press point cancels', () => {
  const { m, log } = setup();
  m.down(1, 400, 300, 0);
  m.move(1, 400, 340, 20);
  m.move(1, 400, 270, 200);
  assert.equal(log.previews.at(-1).cancel, true);
  m.up(1, 400, 270, 220);
  assert.equal(log.throws.length, 0);
  assert.equal(log.cancels, 1);
  assert.equal(m.phase, 'aim');
});

test('horizontal drag turns, does not toss', () => {
  const { m, log } = setup();
  m.down(1, 100, 300, 0);
  m.move(1, 140, 302, 20);
  m.move(1, 180, 302, 40);
  m.up(1, 180, 302, 60);
  const sum = log.turns.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 80 / W * 60 * DEG) < 1e-9);
  assert.equal(log.throws.length, 0);
});

test('dwell starts a toss at minimum loft; quick tap does nothing', () => {
  const { m, log } = setup();
  m.down(1, 400, 300, 0); m.tick(100); assert.equal(m.state, 'pending');
  m.up(1, 400, 300, 120); assert.equal(log.throws.length + log.cancels, 0);
  m.down(1, 400, 300, 1000); m.tick(1160); assert.equal(m.state, 'pulling');
  m.up(1, 400, 300, 1200);
  assert.equal(log.throws[0].loft, LOFT_MIN);
});

test('second pointer cancels the toss; Esc cancels; snapping reported', () => {
  const { m, log } = setup([{ id: 'j', x: 2.1, y: 7, r: 0.04 }]);
  m.down(1, 400, 300, 0); m.move(1, 400, 330, 20);
  assert.equal(log.previews.at(-1).snappedTo, 'j');
  m.down(2, 500, 300, 40);
  assert.equal(log.cancels, 1);
  m.up(1, 400, 330, 60);
  m.down(1, 400, 300, 100); m.move(1, 400, 330, 120);
  assert.equal(m.key('Escape'), true);
  assert.equal(log.cancels, 2);
});

test('keyboard path', () => {
  const { m, log, setYaw } = setup();
  setYaw(0);
  m.key('ArrowRight'); m.key('ArrowLeft', true);
  assert.ok(Math.abs(log.turns[0] - DEG) < 1e-12 && Math.abs(log.turns[1] + 0.2 * DEG) < 1e-12);
  m.key('Enter');
  assert.deepEqual(log.previews.at(-1).donnee, { x: 2, y: 8 });
  m.key('ArrowUp', true);
  assert.ok(Math.abs(log.previews.at(-1).donnee.y - 8.05) < 1e-9);
  m.key('ArrowRight', true);
  assert.ok(Math.abs(log.previews.at(-1).donnee.x - 2.05) < 1e-9);
  const l0 = log.previews.at(-1).loft;
  m.key('w');
  assert.ok(Math.abs(log.previews.at(-1).loft - l0 - DEG) < 1e-9);
  m.key('Enter');
  assert.equal(log.throws.length, 1);
  assert.ok(Math.abs(log.throws[0].donnee.y - 8.05) < 1e-9);
});
