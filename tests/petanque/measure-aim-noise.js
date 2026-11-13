// F99: Monte-Carlo of the whole human release path (executeThrow with the cone) at several aim angles: mean signed
// lateral error of the first landing and of the rest point about the aimed spot (+ = to the thrower's right)
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createBody, launch, createWorld, simulate } from '../../assets/js/petanque/physics.js';
import { SKILL, coneFor, executeThrow, fitToBudget } from '../../assets/js/petanque/donnee.js';
import { releaseOffset } from '../../assets/js/petanque/character.js';
import { specFor } from '../../assets/js/petanque/personalities.js';
const DEG = Math.PI / 180, C0 = { x: 2, y: 1 }, spec = specFor('you');
const N = +process.argv[2] || 200;
for (const [loftD, d] of [[14, 6], [32, 7], [60, 6]]) for (const a of [-34, -20, 0, 20, 34]) {
  let lat = 0, rlat = 0, land = 0;
  for (let i = 0; i < N; i++) {
    const yaw = a * DEG, loft = loftD * DEG, terrain = createTerrain(100 + (i % 8));
    const o = releaseOffset({ height: spec.height, stance: spec.stance, loft, yaw, hand: spec.hand });
    const from = { x: C0.x + o.x, y: C0.y + o.y, z: terrain.sample(C0.x, C0.y).h + o.z };
    const want = { x: C0.x + Math.sin(yaw) * d, y: C0.y + Math.cos(yaw) * d };
    const fit = fitToBudget({ from, landing: want, loft, skill: SKILL.human, terrain });
    const cone = coneFor({ skill: SKILL.human, from, landing: fit.landing, loft, energyFrac: fit.energyFrac });
    const r = mulberry32(i * 7 + 1);
    const res = executeThrow({ from, landing: fit.landing, loft, cone, terrain, rand: r });
    const world = createWorld(terrain, mulberry32(i));
    const b = launch(createBody('boule', { team: 0 }), res.throwParams, from);
    world.add(b); simulate(world);
    const ev = world.events.find((e) => e.type === 'land');
    const right = { x: Math.cos(yaw), y: -Math.sin(yaw) };
    const L = (p) => (p.x - fit.landing.x) * right.x + (p.y - fit.landing.y) * right.y;
    lat += res.lateralError; land += L(ev || b); rlat += L(b);
  }
  console.log(`loft ${loftD} d ${d} aim ${a}: mean intended lateral err ${(lat / N).toFixed(3)} first-landing ${(land / N).toFixed(3)} rest ${(rlat / N).toFixed(3)} (m, +right)`);
}
