// F99: first-landing point of a noiseless human throw at several aim angles vs the aimed spot (node tests/petanque/measure-aim.js)
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createBody, launch, createWorld, simulate } from '../../assets/js/petanque/physics.js';
import { solveLaunch } from '../../assets/js/petanque/donnee.js';
import { releaseOffset } from '../../assets/js/petanque/character.js';
import { specFor } from '../../assets/js/petanque/personalities.js';
const DEG = Math.PI / 180, C0 = { x: 2, y: 1 };
const spec = specFor('you');
for (const [loftD, d] of [[14, 5], [32, 7], [60, 6]]) for (const a of [0, 10, 20, 30, 34.4]) {
  const yaw = a * DEG, loft = loftD * DEG;
  const o = releaseOffset({ height: spec.height, stance: spec.stance, loft, yaw, hand: spec.hand });
  const from = { x: C0.x + o.x, y: C0.y + o.y, z: 0.1 + o.z };
  const land = { x: C0.x + Math.sin(yaw) * d, y: C0.y + Math.cos(yaw) * d };
  const terrain = createTerrain(100);
  from.z = terrain.sample(C0.x, C0.y).h + o.z;
  const world = createWorld(terrain, mulberry32(1));
  const tp = solveLaunch({ from, landing: land, loft, terrain });
  const b = launch(createBody('boule', { team: 0 }), tp, from);
  world.add(b); simulate(world);
  const ev = world.events.find((e) => e.type === 'land');
  const p = ev || b;
  console.log(`loft ${loftD} aim ${a}deg d ${d}: from(${(from.x-C0.x).toFixed(2)},${(from.y-C0.y).toFixed(2)}) solvedYaw ${(tp.yaw/DEG).toFixed(2)} land err ${Math.hypot(p.x - land.x, p.y - land.y).toFixed(3)} m, angle from circle ${(Math.atan2(p.x-C0.x,p.y-C0.y)/DEG).toFixed(2)}`);
}
console.log('--- rest vs landing (angle about the circle, deg), 8 seeds mean');
for (const [loftD, d] of [[14, 5], [32, 7], [60, 6]]) for (const a of [-34, 0, 20, 34]) {
  let dang = 0, n = 8;
  for (let s = 0; s < n; s++) {
    const yaw = a * DEG, loft = loftD * DEG, terrain = createTerrain(100 + s);
    const o = releaseOffset({ height: spec.height, stance: spec.stance, loft, yaw, hand: spec.hand });
    const from = { x: C0.x + o.x, y: C0.y + o.y, z: terrain.sample(C0.x, C0.y).h + o.z };
    const land = { x: C0.x + Math.sin(yaw) * d, y: C0.y + Math.cos(yaw) * d };
    const world = createWorld(terrain, mulberry32(s));
    const b = launch(createBody('boule', { team: 0 }), solveLaunch({ from, landing: land, loft, terrain }), from);
    world.add(b); simulate(world);
    dang += Math.atan2(b.x - C0.x, b.y - C0.y) / DEG - a;
  }
  console.log(`loft ${loftD} aim ${a}: mean rest angle minus aim ${(dang / n).toFixed(2)} deg`);
}
