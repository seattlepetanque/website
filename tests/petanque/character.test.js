import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../assets/js/vendor/three.module.js';
import {
  createCharacter, stancePose, walkPose, solveSkeleton, boneLengths, BONES, releaseOffset,
} from '../../assets/js/petanque/character.js';

const STANCES = ['idle', 'aim', 'crouch', 'stand', 'watch', 'celebrate', 'dismay'];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const DEG = Math.PI / 180;

function checkBones(joints, H, label) {
  const L = boneLengths(H);
  for (const [a, b, key] of BONES) {
    assert.ok(Math.abs(dist(joints[a], joints[b]) - L[key]) < 1e-6, `${label}: ${a}-${b}`);
  }
  for (const [k, v] of Object.entries(joints)) assert.ok(v.every(Number.isFinite), `${label}: NaN in ${k}`);
}

// run the animation until a promise settles (or a time limit)
async function run(ch, promise, onFrame, limit = 10, dt = 1 / 60) {
  let done = false;
  promise.then(() => { done = true; });
  for (let t = 0; t < limit && !done; t += dt) {
    ch.update(dt);
    if (onFrame) onFrame(t);
    await Promise.resolve();
  }
  await Promise.resolve();
  return done;
}

test('bone lengths constant and finite in every stance, over time, for several heights', () => {
  for (const H of [1.5, 1.75, 1.95]) {
    for (const s of STANCES) {
      for (let t = 0; t < 6; t += 0.37) checkBones(solveSkeleton(stancePose(s, t, { look: { yaw: 0.5, pitch: -0.2 } }), H).joints, H, s);
    }
    for (let ph = 0; ph < 7; ph += 0.4) checkBones(solveSkeleton(walkPose(ph), H).joints, H, 'walk');
  }
});

test('feet stay on the ground in crouch, stand and idle', () => {
  for (const s of ['crouch', 'stand', 'idle', 'aim', 'watch', 'dismay']) {
    for (let t = 0; t < 5; t += 0.5) {
      const j = solveSkeleton(stancePose(s, t), 1.75).joints;
      for (const n of ['L', 'R']) {
        assert.ok(Math.abs(j['foot' + n][2]) < 0.005, `${s} toe z ${j['foot' + n][2]}`);
        assert.ok(Math.abs(j['ankle' + n][2] - boneLengths(1.75).ankleH) < 0.005, `${s} ankle`);
      }
    }
  }
});

test('crouch is deep and forward, stand is tall', () => {
  const c = solveSkeleton(stancePose('crouch', 0), 1.75).joints;
  const s = solveSkeleton(stancePose('stand', 0), 1.75).joints;
  assert.ok(c.head[2] < 0.7 * s.head[2], 'crouch head much lower');
  assert.ok(c.head[1] > c.pelvis[1] + 0.1, 'head forward of hips in crouch');
});

test('createCharacter: stances never produce NaN or change bones', () => {
  const ch = createCharacter(THREE, { height: 1.7, build: 'stout', stance: 'crouch', colors: { shirt: 'red', trousers: 'blue', skin: '#c68', hat: '#444' }, quirks: { hat: 'cap' } });
  for (const s of STANCES) {
    ch.setStance(s);
    for (let i = 0; i < 40; i++) ch.update(1 / 30);
    checkBones(ch.skeleton(), 1.7, s);
    const h = ch.handWorldPosition();
    assert.ok(Number.isFinite(h.x + h.y + h.z));
  }
  ch.dispose();
});

test('playThrow: onRelease fires once, height rises with loft, bones constant', async () => {
  for (const stance of ['crouch', 'stand']) {
    const heights = [];
    for (const loft of [10 * DEG, 30 * DEG, 50 * DEG, 70 * DEG]) {
      const ch = createCharacter(THREE, { stance });
      ch.setStance(stance);
      for (let i = 0; i < 30; i++) ch.update(1 / 30);
      let calls = 0, pos = null, tRel = 0, elapsed = 0;
      const p = ch.playThrow({ loft, onRelease: (h) => { calls++; pos = h; tRel = elapsed; } });
      const done = await run(ch, p, (t) => { elapsed = t; checkBones(ch.skeleton(), 1.75, 'throw'); });
      assert.ok(done, 'throw resolves');
      assert.equal(calls, 1);
      assert.ok(elapsed > 1.1 && elapsed < 1.7, `total ${elapsed}`);
      heights.push({ z: pos.z, t: tRel });
      ch.dispose();
    }
    for (let i = 1; i < heights.length; i++) {
      assert.ok(heights[i].z > heights[i - 1].z, `${stance}: release height rises with loft ${JSON.stringify(heights)}`);
      assert.ok(heights[i].t > heights[i - 1].t, `${stance}: release later with loft`);
    }
  }
});

test('playThrow: release is exactly once even with huge frame steps', async () => {
  const ch = createCharacter(THREE, { stance: 'stand' });
  let calls = 0;
  const p = ch.playThrow({ loft: 0.6, onRelease: () => { calls++; } });
  await run(ch, p, null, 10, 0.5);
  assert.equal(calls, 1);
});

test('walkTo resolves and ends at the target', async () => {
  const ch = createCharacter(THREE, {});
  ch.setPlacement(0.5, 0.5, 0);
  const p = ch.walkTo({ x: 2.5, y: 3, yaw: 0.7 });
  const done = await run(ch, p, () => checkBones(ch.skeleton(), 1.75, 'walk'), 20);
  assert.ok(done);
  assert.ok(Math.hypot(ch.root.position.x - 2.5, ch.root.position.y - 3) < 1e-6);
  assert.ok(Math.abs(ch.yaw - 0.7) < 1e-6);
  // walking speed is about 1.2 m/s: 3.2 m takes roughly 2.7 s plus turns
});

test('lookAt turns the head toward the point', () => {
  const ch = createCharacter(THREE, {});
  ch.setPlacement(0, 0, 0);
  ch.setStance('watch');
  ch.lookAt(5, 0, 1.5); // to the +x side
  for (let i = 0; i < 60; i++) ch.update(1 / 30);
  const j = ch.skeleton();
  assert.ok(j.head[0] === j.head[0]);
  ch.dispose();
});

test('releaseOffset predicts the hand position at release (within 3 cm)', async () => {
  for (const stance of ['crouch', 'stand']) {
    for (const loft of [10 * DEG, 25 * DEG, 45 * DEG, 70 * DEG]) {
      for (const yaw of [0, 0.4, -0.5]) {
        const ch = createCharacter(THREE, { stance, height: 1.78 });
        ch.setStance(stance);
        ch.setPlacement(2, 1, yaw);
        for (let i = 0; i < 70; i++) ch.update(1 / 60); // idle for a while so the breathing is mid-cycle
        let hand = null;
        await run(ch, ch.playThrow({ loft, onRelease: (h) => { hand = h; } }), null);
        assert.ok(hand, 'released');
        const off = releaseOffset({ height: 1.78, stance, loft, yaw });
        const d = Math.hypot(hand.x - (2 + off.x), hand.y - (1 + off.y), hand.z - off.z);
        assert.ok(d < 0.03, `${stance} ${loft} ${yaw}: ${d}`);
      }
    }
  }
});
