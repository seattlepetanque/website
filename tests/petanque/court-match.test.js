// E17 (E24/E25/E26): seeded AI-vs-AI matches over a moving circle, both directions. Every jack that goes into play
// (thrown or placed) is valid and 6-10 m from the CURRENT circle, ahead of it in the playing direction, and the
// rules, the AI and the court module always agree on the circle and direction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createWorld, createBody, launch, simulate } from '../../assets/js/petanque/physics.js';
import { createMatch, defaultPlayers, apply, nextTeam, playersWithBoules, jackValid, jackCentreRange } from '../../assets/js/petanque/rules.js';
import { AI, chooseThrow, chooseJackThrow, chooseJackPlacement } from '../../assets/js/petanque/ai.js';
import { court, setCourt, resetCourt, nextCircle } from '../../assets/js/petanque/court.js';

function play(seed) {
  resetCourt();
  const terrain = createTerrain(seed);
  const world = createWorld(terrain, mulberry32(seed ^ 0x9e3779b9));
  const rand = mulberry32(seed ^ 0x51ed270b);
  const players = defaultPlayers().map((p) => ({ ...p, isHuman: false }));
  let match = createMatch({ target: 13, players, firstJackTeam: seed % 2 });
  const seen = { dirs: new Set(), jacks: 0, placed: 0, menes: 0 };
  const checkJack = (spot, label) => {
    const g = match.geometry;
    assert.equal(g.dir, court.dir, `${label}: rules dir = court dir`);
    assert.equal(g.circle.x, court.circle.x); assert.equal(g.circle.y, court.circle.y);
    const d = Math.hypot(spot.x - court.circle.x, spot.y - court.circle.y);
    const r = jackCentreRange(g); // F73-F77: the 6-10 m range is edge to edge, so the centre bound is shifted by circle + jack radius
    assert.ok(d >= r.min - 1e-6 && d <= r.max + 1e-6, `${label}: seed ${seed} jack ${d.toFixed(2)} m from the circle (dir ${court.dir})`);
    assert.ok((spot.y - court.circle.y) * court.dir > 0, `${label}: ahead of the circle`);
    assert.ok(jackValid(spot, g), `${label}: valid`);
  };
  let guard = 0;
  while (match.phase !== 'gameOver') {
    assert.ok(guard++ < 500, 'terminates');
    if (match.phase === 'jack') {
      world.bodies.length = 0; terrain.resetDivots();
      seen.dirs.add(court.dir);
      const team = match.jackTeam, thrower = match.players.find((p) => p.team === team);
      const { throwParams } = chooseJackThrow({ world, difficulty: 'medium', rand, player: thrower, geometry: match.geometry });
      const jack = createBody('jack', {});
      world.add(jack); launch(jack, throwParams); simulate(world, 20);
      match = apply(match, { type: 'jackThrown', team, jack: { x: jack.x, y: jack.y, dead: jack.dead } });
      if (match.phase === 'play') { seen.jacks++; checkJack(jack, 'thrown'); }
    } else if (match.phase === 'jackPlace') {
      const placer = match.players.find((p) => p.team === match.placingTeam);
      const spot = chooseJackPlacement({ match, player: placer, difficulty: 'medium', rand, terrain, attempt: 0 });
      match = apply(match, { type: 'jackPlaceSettled', team: match.placingTeam, jack: spot });
      assert.equal(match.phase, 'play', 'placement accepted');
      seen.placed++; checkJack(spot, 'placed');
      world.bodies.length = 0; world.add(createBody('jack', { x: spot.x, y: spot.y }));
    } else if (match.phase === 'play') {
      const team = nextTeam(match), player = playersWithBoules(match, team)[0];
      const { throwParams } = chooseThrow({ world, match, player, difficulty: 'medium', rand });
      match = apply(match, { type: 'bouleThrown', playerId: player.id });
      const body = createBody('boule', { team, owner: player.id });
      world.add(body); launch(body, throwParams); simulate(world, 20);
      const jack = world.bodies.find((b) => b.kind === 'jack');
      match = apply(match, {
        type: 'throwSettled', jack: { x: jack.x, y: jack.y, dead: jack.dead },
        boules: world.bodies.filter((b) => b.kind === 'boule').map((b) => ({ id: b.id, team: b.team, owner: b.owner, x: b.x, y: b.y, dead: b.dead })),
      });
      if (match.phase === 'meneEnd') {
        seen.menes++;
        const prevJack = match.jack, prevDir = court.dir;
        match = apply(match, { type: 'nextMene' });
        const nc = nextCircle(prevJack, prevDir, { width: match.geometry.width, length: match.geometry.length });
        assert.equal(match.geometry.dir, nc.dir, 'the rules flip the direction like the court');
        assert.ok(Math.abs(match.geometry.circle.y - nc.circle.y) < 1e-9);
        setCourt(match.geometry.circle, match.geometry.dir);
      } else if (match.phase === 'gameOver') break;
    } else assert.fail('phase ' + match.phase);
  }
  return seen;
}

test('E24: seeded full matches keep every jack 6-10 m from the current circle, both directions', { timeout: 170000 }, () => {
  const saved = { ...AI.sims };
  AI.sims.medium = 3;
  let jacks = 0, menes = 0; const dirs = new Set();
  try {
    for (const seed of [2, 5, 8, 11]) {
      const s = play(seed);
      jacks += s.jacks + s.placed; menes += s.menes; s.dirs.forEach((d) => dirs.add(d));
    }
  } finally { Object.assign(AI.sims, saved); resetCourt(); }
  console.log('E24 sweep:', menes, 'menes,', jacks, 'jacks');
  assert.ok(menes >= 8 && jacks >= 8, `${menes} menes, ${jacks} jacks`);
  assert.deepEqual([...dirs].sort(), [-1, 1], 'both directions were played');
});
