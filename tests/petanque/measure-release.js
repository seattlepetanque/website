// Roll-out by style with the real release points (stick figure's hand, C09): node tests/petanque/measure-release.js [n]
// Noiseless throws (solveLaunch) at a donnée D metres out; physics randomness only. Reports mean rest minus donnée
// distance (along the line), mean absolute offset and the mean first-touch distance, per player.
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createBody, launch, createWorld, simulate } from '../../assets/js/petanque/physics.js';
import { solveLaunch } from '../../assets/js/petanque/donnee.js';
import { releaseOffset } from '../../assets/js/petanque/character.js';
import { specFor } from '../../assets/js/petanque/personalities.js';

const n = +process.argv[2] || 24;
const DEG = Math.PI / 180;
const CIRC = { x: 2, y: 1 };
const rows = [['roulette', 14, [3, 4]], ['demi', 32, [5, 7]], ['plombee', 60, [4, 6, 8]]];
for (const id of ['you', 'marcel', 'pierre', 'odette']) {
  const spec = specFor(id);
  const out = [];
  for (const [style, deg, dists] of rows) {
    const loft = deg * DEG;
    const o = releaseOffset({ height: spec.height, stance: spec.stance, loft, yaw: 0 });
    const from = { x: CIRC.x + o.x, y: CIRC.y + o.y, z: o.z };
    for (const d of dists) {
      const land = { x: CIRC.x, y: CIRC.y + d };
      let past = 0, abs = 0;
      for (let i = 0; i < n; i++) {
        const terrain = createTerrain(100 + (i % 8));
        const world = createWorld(terrain, mulberry32(i));
        const tp = solveLaunch({ from, landing: land, loft, terrain });
        const b = launch(createBody('boule', { team: 0 }), tp, from);
        world.add(b);
        simulate(world);
        const rest = b.dead ? 15 : b.y - land.y;
        past += rest; abs += Math.abs(rest);
      }
      out.push(`${style}@${d}m z${from.z.toFixed(2)}: ${(past / n).toFixed(2)}/${(abs / n).toFixed(2)}`);
    }
  }
  console.log(id.padEnd(7), out.join('  '));
}
