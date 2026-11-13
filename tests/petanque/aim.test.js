// F99: a human toss at any angle launches from the hand of a thrower who faces the donnée, onto the previewed donnée
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createBody, launch, createWorld, simulate } from '../../assets/js/petanque/physics.js';
import { planAim, solveLaunch, SKILL, executeThrow, coneFor } from '../../assets/js/petanque/donnee.js';
import { releaseOffset } from '../../assets/js/petanque/character.js';
import { specFor } from '../../assets/js/petanque/personalities.js';

const DEG = Math.PI / 180, circle = { x: 2, y: 1 }, spec = specFor('you');
const flat = {
  sample: () => ({ h: 0, nx: 0, ny: 0, nz: 1, friction: 0.14, loose: 0 }),
  stonesNear: () => [], addDivot() {}, resetDivots() {}, visibleStones: () => [], perceived() { return this; },
};
const handAt = (loft) => (yaw) => {
  const o = releaseOffset({ height: spec.height, stance: spec.stance, loft, yaw, hand: spec.hand });
  return { x: circle.x + o.x, y: circle.y + o.y, z: o.z };
};
const at = (deg, d) => ({ x: circle.x + Math.sin(deg * DEG) * d, y: circle.y + Math.cos(deg * DEG) * d });
const bearing = (p, q) => Math.atan2(q.x - p.x, q.y - p.y);

for (const loftD of [14, 32, 60]) {
  for (const deg of [0, 10, 20, 30, 34, -34]) {
    test(`F99 loft ${loftD}, donnée ${deg} deg off centre: faces it, launches from that hand, lands on it`, () => {
      const loft = loftD * DEG, donnee = at(deg, Math.min(4.5, 1.8 / Math.max(0.01, Math.abs(Math.sin(deg * DEG))))); // inside the 4 m wide court
      const plan = planAim({ circle, donnee, loft, handAt: handAt(loft), skill: SKILL.human, terrain: flat });
      // facing = bearing of the donnée from the circle (the hand's offset is a few degrees at most)
      assert.ok(Math.abs(plan.face - deg * DEG) < 1e-3, 'faces the donnée');
      // the release point is the hand of a thrower facing that way (no other yaw feeds it)
      const h = handAt(loft)(plan.face);
      assert.ok(Math.hypot(plan.from.x - h.x, plan.from.y - h.y, plan.from.z - h.z) < 1e-9);
      // the launch heads for the donnée (noiseless), within the parallax of the hand of the facing
      const tp = solveLaunch({ from: plan.from, landing: plan.landing, loft, terrain: flat });
      assert.ok(Math.abs(tp.yaw - plan.face) < 4 * DEG, `launch yaw ${(tp.yaw / DEG).toFixed(2)} vs facing ${(plan.face / DEG).toFixed(2)}`);
      const w = createWorld(flat, mulberry32(3));
      const b = launch(createBody('boule', { team: 0 }), tp, plan.from);
      w.add(b); simulate(w);
      const land = w.events.find((e) => e.type === 'land');
      assert.ok(Math.hypot(land.x - donnee.x, land.y - donnee.y) < 0.03, 'first landing on the donnée');
    });
  }
}

test('F99 a donnée picked off the aim line: the thrower faces the donnée, not the old aim (was up to the full offset off)', () => {
  const loft = 32 * DEG, aim = 34, donnee = at(14, 5);
  const plan = planAim({ circle, donnee, loft, handAt: handAt(loft), skill: SKILL.human, terrain: flat });
  const oldFrom = handAt(loft)(aim * DEG); // before: hand at the aim yaw, launch along the donnée
  const oldYaw = solveLaunch({ from: oldFrom, landing: donnee, loft, terrain: flat }).yaw;
  assert.ok(Math.abs(oldYaw - aim * DEG) > 15 * DEG, 'before: the boule left 15+ degrees off the way the thrower faced');
  const newYaw = solveLaunch({ from: plan.from, landing: plan.landing, loft, terrain: flat }).yaw;
  assert.ok(Math.abs(newYaw - plan.face) < 3 * DEG, 'after: it leaves the way the thrower faces');
});

test('F99 the facing limit bounds the turn and the plan still launches from that hand', () => {
  const loft = 32 * DEG, limit = (a) => Math.max(-0.6, Math.min(0.6, a));
  const plan = planAim({ circle, donnee: at(50, 4), loft, handAt: handAt(loft), skill: SKILL.human, terrain: flat, limit });
  assert.equal(plan.face, 0.6);
  const h = handAt(loft)(0.6);
  assert.ok(Math.hypot(plan.from.x - h.x, plan.from.y - h.y) < 1e-9);
});

test('F99 a noisy human throw has no sideways bias at large angles', () => {
  const loft = 32 * DEG;
  for (const deg of [0, 30, 34]) {
    let sum = 0, n = 120;
    const donnee = at(deg, 4);
    const plan = planAim({ circle, donnee, loft, handAt: handAt(loft), skill: SKILL.human, terrain: flat });
    const cone = coneFor({ skill: SKILL.human, from: plan.from, landing: plan.landing, loft, energyFrac: plan.energyFrac });
    for (let i = 0; i < n; i++) sum += executeThrow({ from: plan.from, landing: plan.landing, loft, cone, terrain: flat, rand: mulberry32(i + 1) }).lateralError;
    assert.ok(Math.abs(sum / n) < 0.5 * cone.sigmaLat, `mean lateral error ${(sum / n).toFixed(3)} at ${deg}`);
  }
});
