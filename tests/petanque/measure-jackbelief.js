// F87: seeded AI v AI matches; after every throw settles, compare the jack position the AI would believe
// (readSituation's sit.jackPos / sit.jack, and the match state's jack) with the live world jack body.
//   node tests/petanque/measure-jackbelief.js [matches=20] [--verbose]
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { C } from '../../assets/js/petanque/constants.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createWorld, createBody, launch, simulate } from '../../assets/js/petanque/physics.js';
import { createMatch, defaultPlayers, apply, nextTeam, playersWithBoules } from '../../assets/js/petanque/rules.js';
import { readSituation } from '../../assets/js/petanque/tactics.js';
import { chooseThrow, chooseJackThrow, chooseJackPlacement, whoThrows } from '../../assets/js/petanque/ai.js';
import { baseFor } from './measure-throws.js';
import { AI } from '../../assets/js/petanque/ai.js';

AI.timeGuard = false;
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Plays one match; calls onCheck({ phase, seed, throwNo, believed, world, match }) after each throw settles
export function playChecked(seed, onCheck, { target = 13, diffs = ['medium', 'medium'] } = {}) {
  const terrain = createTerrain(seed);
  const world = createWorld(terrain, mulberry32(seed ^ 0x9e3779b9));
  const rand = mulberry32(seed ^ 0x51ed270b);
  const players = defaultPlayers().map((p) => ({ ...p, isHuman: false }));
  let match = createMatch({ target, players, firstJackTeam: seed % 2 });
  let guard = 0, n = 0;
  const check = (what) => {
    const jk = world.bodies.filter((b) => b.kind === 'jack');
    const sit = match.phase === 'play' ? readSituation({ match, bodies: world.bodies, player: match.players.find((p) => p.boulesLeft > 0 && p.team === nextTeam(match)) || match.players[0], difficulty: diffs[nextTeam(match)] }) : null;
    onCheck({ what, seed, n, jacks: jk.length, jack: jk[0], sit, match, world });
  };
  while (match.phase !== 'gameOver' && guard++ < 500) {
    if (match.phase === 'jack') {
      world.bodies.length = 0; terrain.resetDivots();
      const thrower = match.players.find((p) => p.team === match.jackTeam);
      const { throwParams, from } = chooseJackThrow({ world, difficulty: diffs[match.jackTeam], rand, player: thrower, from: baseFor(thrower.id, 0, terrain) });
      const jack = createBody('jack', {}); world.add(jack); launch(jack, throwParams, from); simulate(world, 20);
      match = apply(match, { type: 'jackThrown', team: match.jackTeam, jack: { x: jack.x, y: jack.y, dead: jack.dead } });
      check('jackThrown');
    } else if (match.phase === 'jackPlace') {
      const placer = match.players.find((p) => p.team === match.placingTeam);
      const spot = chooseJackPlacement({ match, player: placer, difficulty: diffs[placer.team], rand, terrain });
      match = apply(match, { type: 'jackPlaceSettled', team: match.placingTeam, jack: spot });
      world.bodies.length = 0; world.add(createBody('jack', { x: spot.x, y: spot.y }));
      check('jackPlaceSettled');
    } else if (match.phase === 'play') {
      const team = nextTeam(match);
      const avail = playersWithBoules(match, team);
      const player = avail.length > 1 ? whoThrows({ match, bodies: world.bodies, team, difficulty: diffs[team], players: avail }).player : avail[0];
      const jk = world.bodies.find((b) => b.kind === 'jack');
      const base = baseFor(player.id, Math.atan2(jk.x - C.circle.x, jk.y - C.circle.y), terrain);
      const choice = chooseThrow({ world, match, player, difficulty: diffs[team], rand, from: base });
      match = apply(match, { type: 'bouleThrown', playerId: player.id });
      const body = createBody('boule', { team, owner: player.id });
      world.add(body); launch(body, choice.throwParams, choice.from); simulate(world, 20);
      n++;
      match = apply(match, { type: 'throwSettled', jack: { x: jk.x, y: jk.y, dead: jk.dead },
        boules: world.bodies.filter((b) => b.kind === 'boule').map((b) => ({ id: b.id, team: b.team, owner: b.owner, x: b.x, y: b.y, dead: b.dead })) });
      if (match.phase === 'play') check('throwSettled');
      if (match.phase === 'meneEnd') match = apply(match, { type: 'nextMene' });
    } else break;
  }
}

// Returns the disagreements above `tol` metres
export function collectDisagreements(seeds, tol = 0.01) {
  const out = []; let checks = 0;
  for (const seed of seeds) {
    playChecked(seed, (c) => {
      checks++;
      if (!c.jack) return;
      if (c.jacks !== 1) out.push({ seed: c.seed, what: c.what, kind: 'jackCount', count: c.jacks });
      const live = c.jack;
      if (c.sit && !c.sit.void) {
        const e = d2(c.sit.jackPos, live);
        if (e > tol) out.push({ seed: c.seed, what: c.what, kind: 'sit', err: e });
        const e2 = d2(c.sit.jack, live);
        if (e2 > tol) out.push({ seed: c.seed, what: c.what, kind: 'sit.jack', err: e2 });
      }
      if (c.match.jack && !c.match.jack.dead) {
        const e = d2(c.match.jack, live);
        if (e > tol) out.push({ seed: c.seed, what: c.what, kind: 'match', err: e, matchJack: c.match.jack, live: { x: live.x, y: live.y } });
      }
    });
  }
  return { out, checks };
}

if (process.argv[1] && process.argv[1].endsWith('measure-jackbelief.js')) {
  const N = +(process.argv[2] || 20);
  const { out, checks } = collectDisagreements(Array.from({ length: N }, (_, i) => 1000 + i));
  console.log(`${checks} checks, ${out.length} disagreements > 1 cm`);
  for (const o of out.slice(0, 30)) console.log(JSON.stringify(o));
}
