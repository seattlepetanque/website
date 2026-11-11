// AI accuracy on seeded gravel: node tests/petanque/measure-ai.js [n]
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createBody, launch, createWorld, simulate } from '../../assets/js/petanque/physics.js';
import { createMatch } from '../../assets/js/petanque/rules.js';
import { chooseThrow } from '../../assets/js/petanque/ai.js';

const n = +process.argv[2] || 24;
const pl = (m, id) => m.players.find((p) => p.id === id);
function scenario(i, boules) {
  const terrain = createTerrain(100 + (i % 8));
  const world = createWorld(terrain, mulberry32(i));
  const jack = world.add(createBody('jack', { x: 1.5 + ((i * 7) % 10) * 0.1, y: 7 + (i % 5) * 0.7 }));
  const bodies = boules.map((b) => world.add(createBody('boule', b(jack))));
  const match = { ...createMatch({}), phase: 'play', jack: { x: jack.x, y: jack.y }, boules: bodies };
  return { terrain, world, jack, match, bodies };
}
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const out = [];
const t0 = performance.now();
for (const difficulty of ['easy', 'medium', 'hard']) {
  const ds = [];
  let styles = {};
  for (let i = 0; i < n; i++) {
    const s = scenario(i, []);
    const r = chooseThrow({ world: s.world.clone(), match: s.match, player: pl(s.match, 'marcel'), difficulty, rand: mulberry32(500 + i) });
    const b = launch(createBody('boule', { team: 1 }), r.throwParams);
    s.world.add(b);
    s.terrain.resetDivots();
    simulate(s.world);
    ds.push(b.dead ? 3 : Math.min(3, Math.hypot(b.x - s.jack.x, b.y - s.jack.y)));
    styles[r.label.split(' ').slice(1).join(' ')] = (styles[r.label.split(' ').slice(1).join(' ')] || 0) + 1;
  }
  const mean = ds.reduce((a, v) => a + v, 0) / n;
  console.log(`point ${difficulty}: mean ${mean.toFixed(2)} median ${med(ds).toFixed(2)} within0.5 ${ds.filter((d) => d < 0.5).length}/${n}`, JSON.stringify(styles));
}
for (const difficulty of ['medium', 'hard']) {
  let shot = 0, hit = 0, carreau = 0, jackHit = 0;
  for (let i = 0; i < n; i++) {
    const s = scenario(i, [(j) => ({ x: j.x + 0.05, y: j.y - 0.1, team: 0 })]);
    const target = s.bodies[0];
    const tx = target.x, ty = target.y;
    const r = chooseThrow({ world: s.world.clone(), match: s.match, player: pl(s.match, 'odette'), difficulty, rand: mulberry32(700 + i) });
    if (r.intent !== 'shoot') continue;
    shot++;
    const b = launch(createBody('boule', { team: 1 }), r.throwParams);
    s.world.add(b);
    s.terrain.resetDivots();
    simulate(s.world);
    if (target.dead || Math.hypot(target.x - tx, target.y - ty) > 0.3) {
      hit++;
      if (!b.dead && Math.hypot(b.x - tx, b.y - ty) < 0.5) carreau++;
    }
  }
  console.log(`tireur ${difficulty}: shoots ${shot}/${n}, target moved ${hit}/${shot}, carreau ${carreau}/${shot}`);
}
console.log('ms', Math.round(performance.now() - t0));
