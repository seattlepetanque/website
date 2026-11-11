// F26: brisker walks with natural arms (a swing opposite the legs, or folded arms), held boules still riding the palm
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../assets/js/vendor/three.module.js';
import {
  createCharacter, walkPose, walkStyle, walkStride, solveSkeleton, boneLengths, BONES, heldBallAt, BALL_D,
} from '../../assets/js/petanque/character.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function checkBones(joints, H, label) {
  const L = boneLengths(H);
  for (const [a, b, key] of BONES) {
    assert.ok(Math.abs(dist(joints[a], joints[b]) - L[key]) < 1e-6, `${label}: ${a}-${b}`);
  }
  for (const v of Object.values(joints)) assert.ok(v.every(Number.isFinite), `${label}: NaN`);
}

const PHASES = Array.from({ length: 40 }, (_, i) => (i / 40) * 4 * Math.PI);
const VARIANTS = [
  { label: 'swing', opts: {} },
  { label: 'swing big', opts: { amp: 1.2 } },
  { label: 'swing small', opts: { amp: 0.5 } },
  { label: 'fold', opts: { arms: 'fold' } },
  { label: 'swing, both hands hold', opts: { held: { R: true, L: true } } },
  { label: 'swing, right holds', opts: { held: { R: true, L: false } } },
  { label: 'fold, both hold', opts: { arms: 'fold', held: { R: true, L: true } } },
  { label: 'carry', opts: { carry: true } },
  { label: 'carry, left holds', opts: { carry: true, held: { R: false, L: true } } },
  { label: 'brisk stride', opts: { stride: 1.3, arms: 'swing' } },
];

test('F26: bone lengths stay constant through the walking arms (swing, folded, held, carried), several heights', () => {
  for (const H of [1.5, 1.75, 1.95]) {
    for (const v of VARIANTS) {
      for (const ph of PHASES) checkBones(solveSkeleton(walkPose(ph, v.opts), H).joints, H, `${v.label} H=${H}`);
    }
  }
});

test('F26: a swinging arm moves opposite its leg, a folded pair stays folded, held arms swing less', () => {
  const at = (ph, o) => walkPose(ph, o);
  // a quarter cycle: the left leg is forward (footL.y > 0), so the left arm is behind and the right arm ahead
  const q = at(Math.PI / 2, {});
  assert.ok(q.footL.y > 0);
  assert.ok(q.armL.p < 0.1 && q.armR.p > 0.1, 'arms swing opposite the legs');
  const q2 = at(-Math.PI / 2, {});
  assert.ok(q2.armL.p > 0.1 && q2.armR.p < 0.1, 'and back again on the other half');
  // folded arms do not move with the stride
  const f0 = JSON.stringify(at(0, { arms: 'fold' }).armL), f1 = JSON.stringify(at(1.7, { arms: 'fold' }).armL);
  assert.equal(f0, f1, 'folded left arm is the same at every phase');
  assert.equal(JSON.stringify(at(0, { arms: 'fold' }).armR), JSON.stringify(at(1.7, { arms: 'fold' }).armR));
  // a hand holding boules swings about half as far as a free one
  const swingOf = (o) => Math.max(...PHASES.map((ph) => walkPose(ph, o).armR.p)) - Math.min(...PHASES.map((ph) => walkPose(ph, o).armR.p));
  assert.ok(swingOf({ held: { R: true, L: false } }) < 0.6 * swingOf({}), 'held swing is smaller');
  assert.ok(swingOf({}) > 0.7, 'free swing is a real swing');
});

test('F26: no stiff carry pose when walking empty-handed; the carry keeps only the right arm at the waist', () => {
  const ps = PHASES.map((ph) => walkPose(ph, {}));
  assert.ok(new Set(ps.map((p) => p.armL.p.toFixed(3))).size > 10, 'left arm moves');
  assert.ok(new Set(ps.map((p) => p.armR.p.toFixed(3))).size > 10, 'right arm moves');
  const c = PHASES.map((ph) => walkPose(ph, { carry: true }).armR.p);
  assert.ok(Math.max(...c) - Math.min(...c) < 0.3, 'carried right arm swings only a little');
  assert.ok(Math.abs(walkPose(0, { carry: true }).armR.p - 0.55) < 0.05, 'and rests at the waist');
});

test('F26: held boules stay attached to the hand (the palm holds each boule BALL_D away, every walk arm)', () => {
  for (const v of VARIANTS) {
    for (const ph of PHASES) {
      const p = walkPose(ph, v.opts), s = solveSkeleton(p, 1.75);
      for (const key of ['L', 'R']) {
        const hand = s.joints['hand' + key];
        const ball = heldBallAt(p, s, key, hand);
        assert.ok(Math.abs(dist(ball, hand) - BALL_D) < 1e-9, `${v.label} ${key} ${ph}: ${dist(ball, hand)}`);
      }
    }
  }
});

test('F26: a brisk walk carries a held boule with the hand, and the walk itself is brisk', async () => {
  const ch = createCharacter(THREE, { name: 'Pierre', personality: 'pierre', height: 1.75 });
  ch.setPlacement(0, 0, 0);
  ch.setHeldBoules({ dominant: 1, other: 2 });
  let worst = 0, frames = 0;
  const done = ch.walkTo({ x: 0, y: 4.8, speed: 2.4 });
  let finished = false;
  done.then(() => { finished = true; });
  for (let t = 0; t < 6 && !finished; t += 1 / 60) {
    ch.update(1 / 60);
    await Promise.resolve();
    frames++;
    const b = ch.ballWorldPosition(), h = ch.handWorldPosition();
    worst = Math.max(worst, Math.abs(dist([b.x, b.y, b.z], [h.x, h.y, h.z]) - BALL_D));
  }
  await Promise.resolve();
  assert.ok(finished, 'walk finishes');
  assert.ok(worst < 1e-6, `boule off the palm by ${worst}`);
  const secs = frames / 60;
  assert.ok(secs > 1.9 && secs < 2.5, `4.8 m at 2.4 m/s took ${secs} s`);
  assert.ok(Math.abs(ch.root.position.y - 4.8) < 1e-6);
  ch.dispose();
});

test('F26: arm styles vary by personality (Odette folds most, Pierre swings biggest, Marcel small) and from walk to walk', () => {
  const count = (who) => {
    let folds = 0, amp = 0;
    for (let n = 0; n < 400; n++) { const s = walkStyle(who, 3.1, n); if (s.arms === 'fold') folds++; amp += s.amp; }
    return { folds: folds / 400, amp: amp / 400 };
  };
  const o = count('odette'), m = count('marcel'), pi = count('pierre');
  assert.ok(o.folds > 0.6 && o.folds < 0.8, `odette folds ${o.folds}`);
  assert.ok(m.folds < 0.35 && m.folds > 0.15, `marcel folds ${m.folds}`);
  assert.ok(pi.folds < 0.12, `pierre folds ${pi.folds}`);
  assert.ok(m.amp < 0.7 && pi.amp > 1.0 && pi.amp > m.amp * 1.5, 'Pierre swings bigger than Marcel');
  assert.deepEqual(walkStyle('odette', 3.1, 5), walkStyle('odette', 3.1, 5), 'a walk style is deterministic');
  const seen = new Set(Array.from({ length: 30 }, (_, n) => walkStyle('odette', 3.1, n).arms));
  assert.equal(seen.size, 2, 'Odette both folds and swings over walks');
});

test('F26: the stride stretch only grows with speed, and is capped', () => {
  assert.ok(Math.abs(walkStride(1.2) - 1) < 1e-9);
  assert.ok(walkStride(1.35) > 1 && walkStride(1.35) < walkStride(2.4));
  assert.ok(walkStride(2.4) <= 1.3 + 1e-9);
  assert.ok(walkStride(8) <= 1.3 + 1e-9);
});
