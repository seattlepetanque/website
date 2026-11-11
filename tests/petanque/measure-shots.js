// D16: tir hit rate by loft and aim-short distance for one player at one difficulty (no AI decision, just the throw).
//   node tests/petanque/measure-shots.js [player] [difficulty] [n]
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { C } from '../../assets/js/petanque/constants.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createWorld, createBody, launch, simulate } from '../../assets/js/petanque/physics.js';
import { SKILL, scaledSkill, coneFor, executeThrow, fitToBudget } from '../../assets/js/petanque/donnee.js';
import { baseFor } from './measure-throws.js';

const player = process.argv[2] || 'odette';
const difficulty = process.argv[3] || 'medium';
const n = +process.argv[4] || 100;
const DEG = Math.PI / 180;
const skill = scaledSkill(SKILL[player], difficulty);
const lofts = (process.env.LOFTS || "20,26,32,38,45,52").split(",").map((d) => +d * DEG);
const shorts = (process.env.SHORTS || "0,0.15,0.3,0.5,0.8,1.2,1.8").split(",").map(Number);
console.log(`${player} ${difficulty}: target moved >15 cm / carreau (%), rows loft, columns aim short of target (m)`);
console.log('loft  ' + shorts.map((s) => String(s).padStart(9)).join(''));
for (const loft of lofts) {
  let row = (loft / DEG).toFixed(0).padStart(3) + '   ';
  for (const sh of shorts) {
    let hit = 0, car = 0;
    for (let i = 0; i < n; i++) {
      const terrain = createTerrain(100 + (i % 8));
      const world = createWorld(terrain, mulberry32(i));
      const jx = 1.5 + ((i * 7) % 10) * 0.1, jy = 7 + (i % 5) * 0.7;
      world.add(createBody('jack', { x: jx, y: jy }));
      const tgt = world.add(createBody('boule', { team: 0, x: jx + 0.05, y: jy - 0.1 }));
      const tx = tgt.x, ty = tgt.y;
      const base = baseFor(player, Math.atan2(jx - C.circle.x, jy - C.circle.y), terrain);
      const from = base.release(loft);
      const dx = tx - from.x, dy = ty - from.y, d = Math.hypot(dx, dy);
      const want = { x: tx - dx / d * sh, y: ty - dy / d * sh };
      const fit = fitToBudget({ from, landing: want, loft, skill, terrain });
      const cone = coneFor({ skill, from, landing: fit.landing, loft, energyFrac: fit.energyFrac });
      const tp = executeThrow({ from, landing: fit.landing, loft, cone, terrain, rand: mulberry32(1000 + i) }).throwParams;
      const b = launch(createBody('boule', { team: 1 }), tp, from);
      world.add(b);
      simulate(world, 20);
      const moved = tgt.dead || Math.hypot(tgt.x - tx, tgt.y - ty) > 0.15;
      if (moved) { hit++; if (!b.dead && Math.hypot(b.x - tx, b.y - ty) < 0.4) car++; }
    }
    row += `${(100 * hit / n).toFixed(0)}/${(100 * car / n).toFixed(0)}`.padStart(9);
  }
  console.log(row);
}
