// Human-vs-AI pointing comparison (donnée model): node tests/petanque/measure-human.js [n]
// The "reasonable human" picks a donnée short of the jack from the flat-terrain roll table (no Monte Carlo, no
// refining on the perceived terrain) with an optional judgment error, and throws through the human cone.
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { gauss } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createBody, launch, createWorld, simulate } from '../../assets/js/petanque/physics.js';
import { createMatch } from '../../assets/js/petanque/rules.js';
import { chooseThrow, donneeDistFor } from '../../assets/js/petanque/ai.js';
import { SKILL, coneFor, executeThrow, releaseFrom, fitToBudget } from '../../assets/js/petanque/donnee.js';
import { releaseOffset } from '../../assets/js/petanque/character.js';
import { specFor } from '../../assets/js/petanque/personalities.js';

const n = +process.argv[2] || 40;
const DEG = Math.PI / 180;
const CIRC = { x: 2, y: 1 };
// real release points: where the stick figure's hand is at the release frame (C09), facing +y
function baseFor(id) {
  const spec = specFor(id);
  return { ...CIRC, release: (loft) => { const o = releaseOffset({ height: spec.height, stance: spec.stance, loft, yaw: 0 }); return { x: CIRC.x + o.x, y: CIRC.y + o.y, z: o.z }; } };
}
const BASE = baseFor('you');
function scenario(i) {
  const terrain = createTerrain(100 + (i % 8));
  const world = createWorld(terrain, mulberry32(i));
  const jack = world.add(createBody('jack', { x: 1.5 + ((i * 7) % 10) * 0.1, y: 7 + (i % 5) * 0.7 }));
  const match = { ...createMatch({}), phase: 'play', jack: { x: jack.x, y: jack.y }, boules: [] };
  return { terrain, world, jack, match };
}
function settle(s, tp, from) {
  const b = launch(createBody('boule', { team: 1 }), tp, from);
  s.world.add(b);
  s.terrain.resetDivots();
  simulate(s.world);
  return b.dead ? 3 : Math.min(3, Math.hypot(b.x - s.jack.x, b.y - s.jack.y));
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const out = [];
// human policies: style loft, judgment error (m, along the line)
for (const [name, loftDeg, err] of [
  ['human plombee', 55, 0], ['human plombee +0.3m error', 55, 0.3], ['human high lob 65deg', 65, 0],
  ['human demi', 32, 0], ['human demi +0.3m error', 32, 0.3],
  ['human roulette', 14, 0], ['human roulette +0.3m error', 14, 0.3],
]) {
  const ds = [], r = mulberry32(77);
  let clamps = 0;
  for (let i = 0; i < n; i++) {
    const s = scenario(i), loft = loftDeg * DEG, from = releaseFrom(BASE, loft);
    const dist = Math.hypot(s.jack.x - from.x, s.jack.y - from.y);
    const dd = donneeDistFor('boule', loft, from, dist) ?? dist;
    const dn = Math.min(dd, dist) + gauss(r) * err, k = dn / dist;
    const want = { x: from.x + (s.jack.x - from.x) * k, y: from.y + (s.jack.y - from.y) * k };
    const fit = fitToBudget({ from, landing: want, loft, skill: SKILL.human, terrain: s.terrain }); // D02: the arm's limit
    const landing = fit.landing;
    if (fit.clamped) clamps++;
    const cone = coneFor({ skill: SKILL.human, from, landing, loft, energyFrac: fit.energyFrac });
    const tp = executeThrow({ from, landing, loft, cone, terrain: s.terrain, rand: r }).throwParams;
    ds.push(settle(s, tp, from));
  }
  out.push(`${name.padEnd(28)} mean ${mean(ds).toFixed(2)}  <0.5m ${(ds.filter((d) => d < 0.5).length / n * 100).toFixed(0)}%  clamped ${clamps}/${n}`);
}
for (const id of ['marcel', 'pierre']) {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const ds = [], styles = {};
    for (let i = 0; i < n; i++) {
      const s = scenario(i);
      const player = s.match.players.find((p) => p.id === id);
      const r = chooseThrow({ world: s.world.clone(), match: s.match, player, difficulty, rand: mulberry32(500 + i), from: baseFor(id) });
      styles[r.style] = (styles[r.style] || 0) + 1;
      ds.push(settle(s, r.throwParams, r.from));
    }
    out.push(`AI ${id} ${difficulty}`.padEnd(28) + ` mean ${mean(ds).toFixed(2)}  <0.5m ${(ds.filter((d) => d < 0.5).length / n * 100).toFixed(0)}%  ${JSON.stringify(styles)}`);
  }
}
console.log(out.join('\n'));
