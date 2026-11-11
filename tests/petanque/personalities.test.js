import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONALITIES, specFor, pickStance, stanceFor, STAND_BEYOND } from '../../assets/js/petanque/personalities.js';
import { releaseOffset } from '../../assets/js/petanque/character.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';

const DEG = Math.PI / 180;

test('the human always stands to throw; Marcel and Odette keep their fixed stances', () => {
  assert.equal(specFor('you').stance, 'stand');
  assert.equal(specFor('marcel').stance, 'crouch');
  assert.equal(specFor('odette').stance, 'stand');
  for (const rand of [() => 0, () => 0.49, () => 0.99]) {
    assert.equal(pickStance(specFor('you'), rand), 'stand');
    assert.equal(pickStance(specFor('marcel'), rand), 'crouch');
    assert.equal(pickStance(specFor('odette'), rand), 'stand');
  }
});

test('Pierre picks crouch or stand 50/50 from the random source', () => {
  const spec = specFor('pierre');
  assert.deepEqual(spec.stances, ['crouch', 'stand']);
  assert.equal(pickStance(spec, () => 0), 'crouch');
  assert.equal(pickStance(spec, () => 0.49), 'crouch');
  assert.equal(pickStance(spec, () => 0.5), 'stand');
  assert.equal(pickStance(spec, () => 0.999), 'stand');
  const rand = mulberry32(1234);
  let crouches = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) if (pickStance(spec, rand) === 'crouch') crouches++;
  assert.ok(Math.abs(crouches / n - 0.5) < 0.05, `crouch share ${crouches / n}`);
  // deterministic for a given seed
  const a = mulberry32(99), b = mulberry32(99);
  for (let i = 0; i < 50; i++) assert.equal(pickStance(spec, a), pickStance(spec, b));
});

test('the chosen stance sets the release point: crouch and stand give different hands', () => {
  const spec = specFor('pierre');
  for (const loft of [25 * DEG, 45 * DEG, 70 * DEG]) {
    const crouch = releaseOffset({ height: spec.height, stance: 'crouch', loft, yaw: 0.3 });
    const stand = releaseOffset({ height: spec.height, stance: 'stand', loft, yaw: 0.3 });
    const d = Math.hypot(crouch.x - stand.x, crouch.y - stand.y, crouch.z - stand.z);
    assert.ok(d > 0.05, `loft ${loft}: crouch and stand releases only ${d} m apart`);
    // the pick feeds straight into the offset used for `from`
    const picked = pickStance(spec, () => 0.9);
    assert.deepEqual(releaseOffset({ height: spec.height, stance: picked, loft, yaw: 0.3 }), stand);
  }
});

test('setStance picks the throwing pose, so the launch matches the stance used for the preview', async () => {
  const THREE = await import('../../assets/js/vendor/three.module.js');
  const { createCharacter } = await import('../../assets/js/petanque/character.js');
  const spec = specFor('pierre');
  const loft = 45 * DEG;
  for (const picked of ['crouch', 'stand']) {
    // created with the other stance: the throw must still follow the stance set just before it
    const ch = createCharacter(THREE, { ...spec, stance: picked === 'stand' ? 'crouch' : 'stand' });
    ch.setStance(picked);
    ch.setPlacement(2, 1, 0.3);
    for (let i = 0; i < 70; i++) ch.update(1 / 60);
    let hand = null;
    const p = ch.playThrow({ loft, onRelease: (h) => { hand = h; } });
    let done = false;
    p.then(() => { done = true; });
    for (let t = 0; t < 10 && !done; t += 1 / 60) { ch.update(1 / 60); await Promise.resolve(); }
    assert.ok(hand, 'released');
    const off = releaseOffset({ height: spec.height, stance: picked, loft, yaw: 0.3 });
    const d = Math.hypot(hand.x - (2 + off.x), hand.y - (1 + off.y), hand.z - off.z);
    assert.ok(d < 0.03, `${picked}: release ${d} m from the preview`);
  }
});

test('F33: nobody crouches beyond 7.5 m; at 7.5 m or less the personality stance applies unchanged', () => {
  assert.equal(STAND_BEYOND, 7.5);
  for (const id of ['you', 'pierre', 'marcel', 'odette']) {
    const spec = specFor(id);
    for (const r of [0, 0.3, 0.7, 0.99]) {
      assert.equal(stanceFor(spec, 7.51, () => r), 'stand');
      assert.equal(stanceFor(spec, 12, () => r), 'stand');
      assert.equal(stanceFor(spec, 7.5, () => r), pickStance(spec, () => r)); // boundary: still the personality's
      assert.equal(stanceFor(spec, 6, () => r), pickStance(spec, () => r));
      assert.equal(stanceFor(spec, undefined, () => r), pickStance(spec, () => r)); // distance not known yet
    }
  }
  assert.equal(stanceFor(specFor('marcel'), 7.5, () => 0), 'crouch');
  assert.equal(stanceFor(specFor('marcel'), 7.6, () => 0), 'stand');
  // beyond the limit no random draw is spent; below it Pierre still crouches about half the time
  let draws = 0;
  stanceFor(specFor('pierre'), 9, () => { draws++; return 0; });
  assert.equal(draws, 0);
  const rand = mulberry32(5);
  let crouches = 0;
  for (let i = 0; i < 2000; i++) if (stanceFor(specFor('pierre'), 5, rand) === 'crouch') crouches++;
  assert.ok(Math.abs(crouches / 2000 - 0.5) < 0.05);
});
