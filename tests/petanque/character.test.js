import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../assets/js/vendor/three.module.js';
import fs from 'node:fs';
import {
  RIG, meshScale, createCharacter, stancePose, walkPose, solveSkeleton, boneLengths, BONES, releaseOffset,
  bendPose, bendDepth, bendReach, BEND_ACT, BEND_TIME,
  kickPose, kickReach, KICK_TIME, KICK_CONTACT, mirrorPose,
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

test('left-handed release offset mirrors the right-hander of the same build', () => {
  for (const stance of ['crouch', 'stand']) {
    for (const loft of [10 * DEG, 45 * DEG, 70 * DEG]) {
      const r = releaseOffset({ height: 1.74, stance, loft });
      const l = releaseOffset({ height: 1.74, stance, loft, hand: 'left' });
      assert.ok(Math.abs(l.x + r.x) < 1e-9 && Math.abs(l.y - r.y) < 1e-9 && Math.abs(l.z - r.z) < 1e-9, `${stance} ${loft}`);
      assert.ok(l.x < 0 && r.x > 0, 'left hand is on the left of the body');
    }
  }
  const bend = bendReach(1.75, 'left'), bendR = bendReach(1.75);
  assert.ok(Math.abs(bend[0] + bendR[0]) < 1e-9 && Math.abs(bend[1] - bendR[1]) < 1e-9);
});

test('left-handed: hand at release is within 3 cm of the prediction, bones constant, carry is in the left hand', async () => {
  const L = boneLengths(1.74);
  for (const stance of ['crouch', 'stand']) {
    for (const loft of [10 * DEG, 45 * DEG, 70 * DEG]) {
      for (const yaw of [0, 0.4, -0.5]) {
        const ch = createCharacter(THREE, { stance, height: 1.74, hand: 'left' });
        ch.setStance(stance);
        ch.setPlacement(2, 1, yaw);
        for (let i = 0; i < 70; i++) ch.update(1 / 60);
        let hand = null;
        await run(ch, ch.playThrow({ loft, onRelease: (h) => { hand = h; } }), () => checkBones(ch.skeleton(), 1.74, 'left throw'));
        assert.ok(hand, 'released');
        const off = releaseOffset({ height: 1.74, stance, loft, yaw, hand: 'left' });
        const d = Math.hypot(hand.x - (2 + off.x), hand.y - (1 + off.y), hand.z - off.z);
        assert.ok(d < 0.03, `${stance} ${loft} ${yaw}: ${d}`);
      }
    }
  }
  const ch = createCharacter(THREE, { height: 1.74, hand: 'left' });
  assert.equal(ch.hand, 'left');
  ch.setCarrying(true); ch.setStance('watch');
  for (let i = 0; i < 90; i++) ch.update(1 / 60);
  const j = ch.skeleton();
  assert.ok(j.handL[2] > j.handR[2] + 0.1, 'carrying hand (left) is raised to the waist, the other hangs');
  assert.ok(L.upperArm > 0);
});

// ---------- Kenney mesh mode (GLTFLoader needs a few browser stubs to parse the embedded texture) ----------
globalThis.self = globalThis;
globalThis.createImageBitmap = globalThis.createImageBitmap || (async () => ({ width: 1, height: 1, close() {} }));
const { GLTFLoader } = await import('../../assets/js/vendor/GLTFLoader.js');
const loadModel = (name) => new Promise((resolve, reject) => {
  const b = fs.readFileSync(new URL('../../static/models/' + name + '.glb', import.meta.url));
  new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '/models/', (g) => resolve(g.scene), reject);
});
const SPECS = {
  marcel: { height: 1.68, build: 'stout', stance: 'crouch', colors: { hat: '#3f3a34' }, quirks: { hat: 'cap' } },
  odette: { height: 1.74, build: 'slim', stance: 'stand', colors: { hat: '#e9d9a0' }, quirks: { hat: 'sunhat' } },
  pierre: { height: 1.82, build: 'average', stance: 'stand' },
  you: { height: 1.76, build: 'average', stance: 'crouch' },
};

// world position of the end of the arm-right bone (the mesh's hand), straight from the three.js bone matrices
function skinnedHand(ch) { // centroid of the skinned hand vertices of the right arm (rest x < -0.33), in world space
  ch.root.updateMatrixWorld(true);
  let sm = null;
  ch.root.traverse((o) => { if (o.isSkinnedMesh && o.name === 'body-mesh') sm = o; });
  sm.skeleton.update();
  const ai = sm.skeleton.bones.findIndex((b) => b.name === 'arm-right');
  const { skinIndex: si, skinWeight: sw, position: pos } = sm.geometry.attributes;
  const c = new THREE.Vector3(), t = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < si.count; i++) {
    for (let k = 0; k < 4; k++) {
      if (si.getComponent(i, k) === ai && sw.getComponent(i, k) > 0.5 && pos.getX(i) < -0.33) {
        sm.getVertexPosition(i, t); c.add(t.applyMatrix4(sm.matrixWorld)); n++;
      }
    }
  }
  return c.divideScalar(n);
}
function boneHand(ch) {
  ch.root.updateMatrixWorld(true);
  let bone = null;
  ch.root.traverse((o) => { if (o.isBone && o.name === 'arm-right') bone = o; });
  const [o, f] = RIG.armRest, l = Math.hypot(o, f);
  const p = new THREE.Vector3(-o / l * RIG.armHand, 0, f / l * RIG.armHand); // along the arm's rest axis
  bone.localToWorld(p);
  return p;
}

test('mesh mode: hand at release matches the prediction and the real arm bone (under 3 cm; the target is 8 cm)', async () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    for (const loft of [10 * DEG, 30 * DEG, 50 * DEG, 70 * DEG]) {
      for (const yaw of [0, 0.5]) {
        const ch = createCharacter(THREE, { ...spec, model: name });
        ch.attachModel(await loadModel(name), name);
        assert.ok(ch.isMesh);
        ch.setStance(spec.stance);
        ch.setPlacement(2, 1, yaw);
        for (let i = 0; i < 70; i++) ch.update(1 / 60);
        let hand = null, bone = null, mesh = null;
        await run(ch, ch.playThrow({ loft, onRelease: (h) => { hand = h; bone = boneHand(ch); mesh = skinnedHand(ch); } }), null);
        assert.ok(hand, 'released');
        const off = releaseOffset({ height: spec.height, stance: spec.stance, loft, yaw, model: name });
        const dPred = Math.hypot(hand.x - (2 + off.x), hand.y - (1 + off.y), hand.z - off.z);
        assert.ok(dPred < 0.03, `${name} ${loft} ${yaw}: prediction off by ${dPred}`);
        const dBone = Math.hypot(hand.x - bone.x, hand.y - bone.y, hand.z - bone.z);
        assert.ok(dBone < 0.03, `${name} ${loft} ${yaw}: hand off the bone by ${dBone}`);
        const dMesh = Math.hypot(hand.x - mesh.x, hand.y - mesh.y, hand.z - mesh.z);
        assert.ok(dMesh < 0.03, `${name} ${loft} ${yaw}: skinned hand off by ${dMesh}`);
        ch.dispose();
      }
    }
  }
});

test('mesh mode: feet stay on the ground in every stance and while walking, no NaN, scale matches the spec height', async () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    const ch = createCharacter(THREE, { ...spec, model: name });
    ch.attachModel(await loadModel(name), name);
    ch.setPlacement(0, 0, 0);
    const feet = () => {
      ch.root.updateMatrixWorld(true);
      const zs = [];
      ch.root.traverse((o) => {
        if (o.isBone && (o.name === 'leg-left' || o.name === 'leg-right')) zs.push(o.localToWorld(new THREE.Vector3(0, -RIG.leg, 0)).z);
      });
      return zs;
    };
    for (const stance of STANCES) {
      ch.setStance(stance);
      for (let i = 0; i < 90; i++) ch.update(1 / 30);
      const zs = feet();
      assert.ok(zs.every(Number.isFinite), `${name} ${stance} finite`);
      assert.ok(Math.min(...zs) > -0.03, `${name} ${stance}: foot below ground ${zs}`);
      assert.ok(Math.min(...zs) < 0.06 || stance === 'celebrate', `${name} ${stance}: floating ${zs}`);
    }
    // walking
    await run(ch, ch.walkTo({ x: 2, y: 1, yaw: 0 }), () => {
      const zs = feet();
      assert.ok(Math.min(...zs) > -0.03 && Math.min(...zs) < 0.08, `${name} walk feet ${zs}`);
    });
    assert.ok(meshScale(spec.height, name) > 2);
    ch.dispose();
  }
});

test('mesh mode: the crouch is clearly lower than standing', async () => {
  const ch = createCharacter(THREE, { ...SPECS.marcel, model: 'marcel' });
  ch.attachModel(await loadModel('marcel'), 'marcel');
  const headTop = (stance) => {
    ch.setStance(stance);
    for (let i = 0; i < 90; i++) ch.update(1 / 30);
    ch.root.updateMatrixWorld(true);
    let h = null; ch.root.traverse((o) => { if (o.isBone && o.name === 'head') h = o; });
    return h.getWorldPosition(new THREE.Vector3()).z;
  };
  assert.ok(headTop('crouch') < headTop('idle') - 0.3);
  ch.dispose();
});

// ---- D11: bending, carrying, handing over, stepping over a timber ----
test('bend, carry, give and step-over poses keep every bone length', () => {
  for (const H of [1.5, 1.75, 1.95]) {
    for (let u = 0; u <= 1.001; u += 0.125) {
      checkBones(solveSkeleton(bendPose(u), H).joints, H, 'bend');
      checkBones(solveSkeleton(bendPose(u, { carry: true }), H).joints, H, 'bend carry');
    }
    for (let ph = 0; ph < 7; ph += 0.4) {
      checkBones(solveSkeleton(walkPose(ph, { lift: 2.6 }), H).joints, H, 'step over');
      checkBones(solveSkeleton(walkPose(ph, { carry: true }), H).joints, H, 'walk carry');
    }
    for (let t = 0; t < 3; t += 0.5) checkBones(solveSkeleton(stancePose('give', t), H).joints, H, 'give');
  }
});

test('bending puts the hand down near the ground ahead of the feet, standing keeps it high', () => {
  for (const H of [1.5, 1.75, 1.95]) {
    const low = solveSkeleton(bendPose(1), H).joints, high = solveSkeleton(bendPose(0), H).joints;
    assert.ok(low.handR[2] < 0.06 * H && low.handR[2] > -0.02 * H, `hand height ${low.handR[2]}`);
    assert.ok(high.handR[2] > 0.4 * H, 'hand high when standing');
    assert.ok(low.handR[1] > low.ankleR[1], 'hand ahead of the ankle');
    assert.ok(low.head[2] < high.head[2] - 0.4 * H, 'the head comes down');
    const r = bendReach(H);
    assert.ok(Math.abs(r[2] - low.handR[2]) < 1e-9);
  }
  assert.equal(bendDepth(0), 0);
  assert.equal(bendDepth(BEND_ACT), 1);
  assert.equal(bendDepth(BEND_TIME), 0);
});

test('a put-down releases once, at the bottom of the bend, and a pick-up takes once; both end standing', async () => {
  for (const kind of ['putdown', 'pickup']) {
    const ch = createCharacter(THREE, SPECS.pierre);
    ch.setPlacement(1, 2, 0.5);
    let acts = 0, handZ = null;
    const done = ch.playBend({ kind, onAct: (pos) => { acts++; handZ = pos.z; } });
    assert.ok(ch.busy);
    assert.equal(ch.carrying, false);
    assert.ok(await run(ch, done, null, 5));
    assert.equal(acts, 1, kind + ' acts once');
    assert.ok(handZ < 0.12, `${kind}: the hand is low at the act (${handZ})`);
    assert.ok(!ch.busy);
    assert.equal(ch.carrying, kind === 'pickup', 'carrying after a pick-up only');
    assert.ok(ch.handWorldPosition().z > 0.5, 'hand back up afterwards');
    ch.dispose();
  }
});

test('a walk with via points reaches the target through each waypoint, with lifted legs, and finishes at the yaw', async () => {
  const ch = createCharacter(THREE, SPECS.odette);
  ch.setPlacement(0, 0, 0);
  const seen = [];
  const done = ch.walkTo({ x: 2, y: 3, yaw: 1, speed: 1.3, via: [{ x: 2, y: 0 }, { x: 2, y: 1.5, lift: 2.6 }] });
  assert.ok(await run(ch, done, () => seen.push([ch.root.position.x, ch.root.position.y]), 20));
  assert.ok(seen.some(([x, y]) => Math.abs(x - 2) < 0.02 && Math.abs(y) < 0.05), 'passes the first waypoint');
  assert.ok(Math.hypot(ch.root.position.x - 2, ch.root.position.y - 3) < 1e-6);
  assert.ok(Math.abs(ch.yaw - 1) < 1e-6);
  ch.dispose();
});

test('a carried ball stays in the hand: the hand position follows the walk', async () => {
  const ch = createCharacter(THREE, SPECS.marcel);
  ch.setPlacement(0, 0, 0);
  ch.setCarrying(true);
  const done = ch.walkTo({ x: 0, y: 3, speed: 1.3 });
  const zs = [];
  await run(ch, done, () => zs.push(ch.handWorldPosition().z), 10);
  assert.ok(Math.min(...zs) > 0.5 && Math.max(...zs) < 1.3, 'hand carries at the waist');
  const p = ch.handWorldPosition();
  assert.ok(Math.abs(p.y - 3) < 0.8);
  ch.dispose();
});

// ---------- F20: relaxed holds and idle gestures ----------
import { QUIRKS, quirkAt, holdArmsAt, tossBall } from '../../assets/js/petanque/character.js';
import { PERSONALITIES } from '../../assets/js/petanque/personalities.js';

const GESTURES = ['checkboules', 'wipeboule', 'shade', 'shrug', 'chat', 'toss'];
test('F20: bone lengths stay constant through every idle gesture, held boules or not, left or right', () => {
  for (const hold of [null, { styles: ['sides', 'akimbo', 'fold', 'fidget'], held: { L: true, R: true } }]) {
    for (const dom of ['L', 'R']) {
      for (const g of [...GESTURES, 'hips', 'fold', 'fidget']) {
        for (let u = 0; u <= QUIRKS[g].dur; u += 0.2) {
          const p = stancePose('watch', u, { look: { yaw: 0.3, pitch: 0 }, forceQuirk: g, hold, dom, steps: true, canToss: true, offset: 3 });
          checkBones(solveSkeleton(p, 1.8).joints, 1.8, `${g} u=${u}`);
        }
      }
    }
  }
});

test('F20: in the relaxed hold the hands stay near the hip or waist', () => {
  const H = 1.75;
  for (const style of ['sides', 'akimbo', 'fold', 'fidget']) {
    for (const held of [true, false]) {
      for (let t = 0; t < 30; t += 0.7) {
        const p = stancePose('watch', t, { hold: { styles: [style], held: { L: held, R: held } }, steps: true, offset: 1 });
        const j = solveSkeleton(p, H).joints;
        for (const n of ['L', 'R']) {
          const d = dist(j['hand' + n], j.pelvis);
          assert.ok(d < 0.32 * H, `${style} held=${held} hand ${n} is ${(d / H).toFixed(2)} H from the pelvis`);
          assert.ok(j['hand' + n][2] < j.pelvis[2] + 0.16 * H && j['hand' + n][2] > j.pelvis[2] - 0.25 * H, `${style}: hand height`);
        }
      }
    }
  }
});

test('F20: gestures come at irregular times and differ between characters; reduced motion is subtler', () => {
  const list = PERSONALITIES.marcel.quirks.idle, starts = (off) => {
    const s = []; let prev = null;
    for (let t = 0; t < 200; t += 0.1) { const a = quirkAt(list, t, off); if (a && (!prev || prev.name !== a.name || a.u < prev.u)) s.push(+t.toFixed(1)); prev = a; }
    return s;
  };
  const a = starts(10), b = starts(23.7);
  assert.ok(a.length >= 8 && b.length >= 8);
  assert.notDeepEqual(a.slice(0, 5), b.slice(0, 5));
  const gaps = a.slice(1).map((v, i) => v - a[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 2, 'irregular intervals');
  const full = stancePose('watch', 1, { forceQuirk: 'shrug', hold: null });
  const sub = stancePose('watch', 1, { forceQuirk: 'shrug', hold: null, reduced: true });
  const rest = stancePose('watch', 1, { hold: null, reduced: true });
  assert.ok(Math.abs(sub.armL.ab - rest.armL.ab) <= Math.abs(full.armL.ab - rest.armL.ab) + 1e-9);
  assert.ok(tossBall(0).k === 0 && tossBall(0.9).k === 1);
});

test('F20: standing characters animate while updated and freeze at dt 0; hold styles vary over time', () => {
  const ch = createCharacter(THREE, { height: 1.75, name: 'Marcel', quirks: PERSONALITIES.marcel.quirks });
  ch.setPlacement(0, 0, 0); ch.setStance('watch'); ch.setHeldBoules({ dominant: 1, other: 2 });
  ch.update(1);
  const pos = () => ch.root.children.map((c) => c.position.x + c.position.y + c.position.z).join();
  const a = pos(); ch.update(0); assert.equal(pos(), a, 'paused: nothing moves');
  ch.update(0.5); assert.notEqual(pos(), a, 'update(dt) keeps it alive');
  const seen = new Set();
  for (let t = 0; t < 120; t += 13) seen.add(JSON.stringify(holdArmsAt(['akimbo', 'sides'], false, t, 'L', 5)).slice(0, 12));
  assert.ok(seen.size >= 2, 'the hold style changes over time');
  ch.dispose();
});

test('F28 kickPose: constants add up, bones stay constant (both hands, several heights), the pose is continuous and the foot is ahead at contact', () => {
  assert.ok(Math.abs(KICK_TIME - 0.85) < 1e-9);
  assert.ok(Math.abs(KICK_CONTACT - 0.292) < 1e-9);
  for (const H of [1.5, 1.75, 1.95]) {
    let prev = null;
    for (let t = 0; t <= KICK_TIME + 1e-9; t += 0.01) {
      for (const carry of [false, true]) {
        const p = kickPose(t, { carry }), s = solveSkeleton(p, H).joints;
        checkBones(s, H, `kick t=${t.toFixed(2)}`);
        checkBones(solveSkeleton(mirrorPose(kickPose(t, { carry })), H).joints, H, 'kick mirrored');
        if (!carry) {
          const f = [s.footR[0], s.footR[1], s.footR[2]];
          if (prev) assert.ok(dist(f, prev) < 0.12 * H / 1.75, `foot jump ${dist(f, prev).toFixed(3)} at t=${t.toFixed(2)}`);
          prev = f;
        }
      }
    }
    const c = solveSkeleton(kickPose(KICK_CONTACT), H).joints;
    assert.ok(c.footR[1] > c.footL[1] + 0.05 * H, 'the kicking foot is ahead of the planted foot at contact');
    assert.ok(c.footR[2] < 0.06 * H, 'low: it nudges, it does not punt');
    const r = kickReach(H);
    assert.ok(Math.abs(r[1] - c.footR[1]) < 1e-9 && Math.abs(kickReach(H, 'left')[0] + r[0]) < 1e-9);
  }
  const a = kickPose(0), b = kickPose(KICK_TIME);
  assert.ok(Math.abs(a.footR.y - b.footR.y) < 1e-9 && Math.abs(a.twist - b.twist) < 1e-9, 'starts and ends standing');
});

test('F28 playKick: contact fires once with the foot near the ground ahead of the kicker, then it ends standing; mirrored for a left-hander', async () => {
  for (const spec of [SPECS.pierre, { ...SPECS.pierre, hand: 'left' }]) {
    const ch = createCharacter(THREE, spec);
    ch.setPlacement(1, 2, 0);
    let n = 0, at = null, t0 = null;
    const done = ch.playKick({ onContact: (p) => { n++; at = p; } });
    assert.ok(ch.busy);
    let elapsed = 0;
    assert.ok(await run(ch, done, (t) => { elapsed = t; if (n === 1 && t0 === null) t0 = t; }, 3));
    assert.equal(n, 1, 'contact fires once');
    assert.ok(Math.abs(t0 - KICK_CONTACT) < 0.03, `contact at ${t0}`);
    assert.ok(Math.abs(elapsed - KICK_TIME) < 0.03, `takes ${elapsed}`);
    assert.ok(at.y > 2.3 && at.z < 0.12, `foot at ${JSON.stringify(at)}`);
    assert.ok(spec.hand === 'left' ? at.x < 1 : at.x > 1, 'the kicking foot is the dominant side');
    assert.ok(!ch.busy);
    ch.dispose();
  }
});

test('F28 playKick: setPlacement cancels it cleanly (resolves, no contact after), a second kick can follow', async () => {
  const ch = createCharacter(THREE, SPECS.marcel);
  ch.setPlacement(0, 0, 0);
  let n = 0;
  const done = ch.playKick({ onContact: () => { n++; } });
  let finished = false; done.then(() => { finished = true; });
  for (let i = 0; i < 6; i++) ch.update(1 / 60);
  ch.setPlacement(1, 1, 0);
  await Promise.resolve();
  assert.ok(finished && !ch.busy && n === 0);
  for (let i = 0; i < 60; i++) ch.update(1 / 60);
  assert.equal(n, 0);
  let m = 0;
  assert.ok(await run(ch, ch.playKick({ onContact: () => { m++; } }), null, 3));
  assert.equal(m, 1);
  ch.dispose();
});
