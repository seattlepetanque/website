// Headless full AI-vs-AI matches: terrain + physics + rules + ai, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createWorld, createBody, launch, simulate } from '../../assets/js/petanque/physics.js';
import { createMatch, defaultPlayers, apply, nextTeam, playersWithBoules } from '../../assets/js/petanque/rules.js';
import { AI, chooseThrow, chooseJackThrow, chooseJackPlacement } from '../../assets/js/petanque/ai.js';

function playMatch(seed, target = 13) {
  const terrain = createTerrain(seed);
  const world = createWorld(terrain, mulberry32(seed ^ 0x9e3779b9));
  const rand = mulberry32(seed ^ 0x51ed270b);
  const players = defaultPlayers().map((p) => ({ ...p, isHuman: false }));
  let match = createMatch({ target, players, firstJackTeam: seed % 2 });
  const stats = { menes: 0, maxBoules: 0, maxPoints: 0, voids: 0, jackPlaced: 0, throws: 0, nan: 0 };
  const checkFinite = () => {
    for (const b of world.bodies) {
      if (![b.x, b.y, b.z, b.vx, b.vy, b.vz].every(Number.isFinite)) stats.nan++;
    }
  };
  let guard = 0;
  while (match.phase !== 'gameOver') {
    assert.ok(guard++ < 400, 'match did not terminate');
    if (match.phase === 'jack') {
      world.bodies.length = 0;
      terrain.resetDivots();
      const team = match.jackTeam;
      const thrower = match.players.find((p) => p.team === team);
      const { throwParams } = chooseJackThrow({ world, difficulty: 'medium', rand, player: thrower });
      const jack = createBody('jack', {});
      world.add(jack);
      launch(jack, throwParams);
      simulate(world, 20);
      checkFinite();
      match = apply(match, { type: 'jackThrown', team, jack: { x: jack.x, y: jack.y, dead: jack.dead } });
    } else if (match.phase === 'jackPlace') {
      stats.jackPlaced++;
      const placer = match.players.find((p) => p.team === match.placingTeam);
      const spot = chooseJackPlacement({ match, player: placer, difficulty: 'medium', rand, terrain });
      const before = match.jackTeam;
      match = apply(match, { type: 'jackPlaced', team: match.placingTeam, jack: spot });
      assert.equal(match.phase, 'play', 'AI placement is accepted');
      assert.equal(match.jackTeam, before);
      world.bodies.length = 0;
      world.add(createBody('jack', { x: spot.x, y: spot.y }));
    } else if (match.phase === 'play') {
      const team = nextTeam(match);
      assert.ok(team === 0 || team === 1);
      const avail = playersWithBoules(match, team);
      const player = avail[0];
      const { throwParams } = chooseThrow({ world, match, player, difficulty: 'medium', rand });
      match = apply(match, { type: 'bouleThrown', playerId: player.id });
      const body = createBody('boule', { team, owner: player.id });
      world.add(body);
      launch(body, throwParams);
      simulate(world, 20);
      checkFinite();
      stats.throws++;
      const jack = world.bodies.find((b) => b.kind === 'jack');
      match = apply(match, {
        type: 'throwSettled',
        jack: { x: jack.x, y: jack.y, dead: jack.dead },
        boules: world.bodies.filter((b) => b.kind === 'boule').map((b) => ({ id: b.id, team: b.team, owner: b.owner, x: b.x, y: b.y, dead: b.dead })),
      });
      stats.maxBoules = Math.max(stats.maxBoules, world.bodies.filter((b) => b.kind === 'boule').length);
      if (match.phase === 'meneEnd' || match.phase === 'gameOver') {
        stats.menes++;
        if (match.result.void) stats.voids++;
        else stats.maxPoints = Math.max(stats.maxPoints, match.result.points);
        if (match.phase === 'meneEnd') match = apply(match, { type: 'nextMene' });
      }
    } else {
      assert.fail('unexpected phase ' + match.phase);
    }
  }
  return { match, stats };
}

test('AI-vs-AI matches terminate with a winner at the target', { timeout: 60000 }, () => {
  const saved = { ...AI.sims };
  AI.sims.medium = 4; // keep the test quick
  const t0 = Date.now();
  try {
    for (const seed of [1, 2]) {
      const { match, stats } = playMatch(seed);
      assert.equal(match.phase, 'gameOver');
      assert.ok(match.winner === 0 || match.winner === 1);
      assert.ok(match.scores[match.winner] >= 13, `winner has ${match.scores[match.winner]}`);
      assert.ok(match.scores[1 - match.winner] < 13 + 6);
      assert.equal(stats.nan, 0, 'no NaN state');
      assert.ok(stats.maxBoules <= 12, `${stats.maxBoules} boules in a mène`);
      assert.ok(stats.maxPoints <= 6, `${stats.maxPoints} points in a mène`);
      assert.ok(stats.menes >= 3, 'plausible match length');
    }
  } finally {
    Object.assign(AI.sims, saved);
  }
  assert.ok(Date.now() - t0 < 40000, // about 4 s alone; headroom for the other test files running in parallel
     `took ${Date.now() - t0} ms`);
});
