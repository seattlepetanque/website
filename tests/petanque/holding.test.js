// E16: hands have a direction (palm up or down), boules are shown in the hands, and the throw turns the palm over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../assets/js/vendor/three.module.js';
import { C } from '../../assets/js/petanque/constants.js';
import { jackStyle } from '../../assets/js/petanque/terrain.js';
import {
  createCharacter, stancePose, throwPose, releaseTime, solveSkeleton, handBasis, releaseOffset, mirrorPose,
} from '../../assets/js/petanque/character.js';

const DEG = Math.PI / 180;
const balls = (ch) => { // visible boule meshes of a character
  const out = [];
  ch.root.traverse((o) => { if (o.isMesh && o.geometry.parameters && o.geometry.parameters.radius === C.boule.r && o.visible) out.push(o); });
  return out;
};
async function run(ch, promise, limit = 10, dt = 1 / 60) {
  let done = false;
  promise.then(() => { done = true; });
  for (let t = 0; t < limit && !done; t += dt) { ch.update(dt); await Promise.resolve(); }
  await Promise.resolve();
  return done;
}

test('the palm turns from up to down through the inside during the backswing', () => {
  for (const stance of ['crouch', 'stand']) {
    const base = stancePose(stance, 0, {});
    const normal = (tt) => { const p = throwPose(tt, base, stance); return handBasis(p, solveSkeleton(p, 1.75), 'R').n; };
    assert.ok(normal(0)[2] > 0.5, `${stance}: palm up at the start`);
    assert.ok(normal(releaseTime(70 * DEG))[2] < -0.8, `${stance}: palm down at a high-loft release (the forearm is level)`);
    assert.ok(normal(releaseTime(30 * DEG))[1] < -0.3, `${stance}: a low release has the palm turned back`);
    const mid = normal(0.45 / 2);
    assert.ok(mid[0] < -0.2, `${stance}: halfway round the boule is on the inside of the right hand (towards the body)`);
  }
});

test('a left-hander turns the palm the mirrored way and holds the mirrored boules', async () => {
  const p = throwPose(0.2, stancePose('crouch', 0, {}), 'crouch');
  const R = handBasis(p, solveSkeleton(p, 1.75), 'R');
  const m = mirrorPose(JSON.parse(JSON.stringify(p)));
  const L = handBasis(m, solveSkeleton(m, 1.75), 'L');
  assert.ok(Math.abs(L.n[0] + R.n[0]) < 1e-9 && Math.abs(L.n[1] - R.n[1]) < 1e-9 && Math.abs(L.n[2] - R.n[2]) < 1e-9);
  const mk = (hand) => {
    const ch = createCharacter(THREE, { height: 1.74, hand });
    ch.setPlacement(0, 0, 0); ch.setStance('watch'); ch.setHeldBoules({ dominant: 1, other: 2 });
    ch.update(0.5);
    return ch;
  };
  const r = mk('right'), l = mk('left');
  const rb = balls(r).map((o) => o.position), lb = balls(l).map((o) => o.position);
  assert.equal(rb.length, 3); assert.equal(lb.length, 3);
  assert.ok(rb[0].x > 0 && lb[0].x < 0, 'the dominant boule is on the dominant side');
  assert.ok(rb.slice(1).every((q) => q.x < 0) && lb.slice(1).every((q) => q.x > 0), 'the pair is in the other hand');
  const near = (a, b) => Math.hypot(a.x + b.x, a.y - b.y, a.z - b.z) < 0.02;
  assert.ok(near(rb[0], lb[0]), 'the dominant boule mirrors');
  const d = (q) => Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y, q[0].z - q[1].z);
  assert.ok(Math.abs(d(rb.slice(1)) - 2 * C.boule.r) < 0.02, 'two side by side, touching');
  r.dispose(); l.dispose();
});

test('held boule counts follow the throws and the shift between hands', async () => {
  const ch = createCharacter(THREE, { height: 1.74, stance: 'stand' });
  ch.setPlacement(2, 1, 0); ch.setStance('stand');
  ch.setHeldBoules({ dominant: 1, other: 2 });
  ch.setHolding(true);
  ch.update(0.1);
  assert.equal(balls(ch).length, 3);
  for (let left = 3; left > 0; left--) {
    assert.equal(ch.heldBoules.dominant + ch.heldBoules.other, left);
    ch.shiftBoule();
    assert.equal(ch.heldBoules.dominant, 1);
    let released = false;
    await run(ch, ch.playThrow({ loft: 30 * DEG, onRelease: () => { released = true; assert.equal(ch.heldBoules.dominant, 0, 'the boule left the hand'); } }));
    assert.ok(released);
    assert.equal(ch.heldBoules.dominant, 0);
    assert.equal(ch.heldBoules.dominant + ch.heldBoules.other, left - 1);
    assert.equal(balls(ch).length, left - 1, 'meshes match the counts');
    ch.setStance('stand');
  }
  assert.equal(ch.shiftBoule(), false);
  ch.setHeldBoules(null);
  assert.equal(balls(ch).length, 0);
  ch.dispose();
});

test('the boule leaves the palm-down hand where releaseOffset says, right and left', async () => {
  for (const hand of ['right', 'left']) {
    for (const loft of [15 * DEG, 45 * DEG]) {
      const ch = createCharacter(THREE, { height: 1.74, stance: 'crouch', hand });
      ch.setPlacement(2, 1, 0.3); ch.setStance('crouch'); ch.setHolding(true);
      let at = null;
      await run(ch, ch.playThrow({ loft, onRelease: (p) => { at = p; } }));
      const off = releaseOffset({ height: 1.74, stance: 'crouch', loft, yaw: 0.3, hand });
      assert.ok(Math.hypot(at.x - 2 - off.x, at.y - 1 - off.y, at.z - off.z) < 0.03, `${hand} ${loft}`);
      assert.equal(balls(ch).length, 0, 'the boule is gone from the hand once released');
      ch.dispose();
    }
  }
});

test('E23: a jack throw holds the orange cochonnet, not a boule, and it leaves at release; boules take the team colour', async () => {
  const visible = (ch, radius) => {
    const out = [];
    ch.root.traverse((o) => { if (o.isMesh && o.geometry.parameters && o.geometry.parameters.radius === radius && o.visible) out.push(o); });
    return out;
  };
  const ch = createCharacter(THREE, { height: 1.74, stance: 'stand' });
  ch.setPlacement(2, 1, 0); ch.setStance('stand');
  ch.setHolding('jack');
  ch.update(0.1);
  assert.equal(balls(ch).length, 0, 'no boule in the hand for a jack throw');
  const jacks = visible(ch, C.jack.r);
  assert.equal(jacks.length, 1);
  assert.equal(jacks[0].material.color.getHexString(), jackStyle().color.slice(1));
  let inHand = null;
  await run(ch, ch.playThrow({ loft: 30 * DEG, onRelease: () => { inHand = visible(ch, C.jack.r).length; } }));
  assert.equal(inHand, 0, 'the cochonnet has left the hand at release');
  ch.setHolding(true, '#e8aa6a'); // a bronze team's boule
  ch.update(0.1);
  assert.equal(balls(ch).length, 1);
  assert.equal(balls(ch)[0].material.color.getHexString(), 'e8aa6a');
  assert.equal(visible(ch, C.jack.r).length, 0);
  ch.dispose();
});
