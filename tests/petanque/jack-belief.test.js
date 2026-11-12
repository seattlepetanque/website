// F87: the AI must plan against the jack that is really on the court. Seeded AI v AI matches: after every throw settles the
// jack the situation model reads (and the match state keeps) equals the live world jack, and a plan is not
// disturbed by the live world changing while the async planner yields.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createWorld, createBody } from '../../assets/js/petanque/physics.js';
import { createMatch, defaultPlayers } from '../../assets/js/petanque/rules.js';
import { AI, chooseThrow, chooseThrowAsync } from '../../assets/js/petanque/ai.js';
import { court } from '../../assets/js/petanque/court.js';
import { collectDisagreements } from './measure-jackbelief.js';

AI.timeGuard = false;

test('F87: believed jack equals the live jack after every throw (seeded AI v AI)', () => {
  const { out, checks } = collectDisagreements([4101, 4102], 0.01);
  assert.ok(checks > 100);
  assert.deepEqual(out, []);
});

test('F87: a plan is made against the jack as it was when planning began, not a jack moved meanwhile', async () => {
  const mk = () => {
    const terrain = createTerrain(11);
    const world = createWorld(terrain, mulberry32(5));
    const put = (kind, team, x, y) => { const b = createBody(kind, { team, x, y }); b.z = b.r; world.add(b); return b; };
    const jack = put('jack', -1, 2.2, 9.4);
    put('boule', 1, 2.5, 9.2);
    return { world, jack };
  };
  const match = createMatch({ target: 13, players: defaultPlayers().map((p) => ({ ...p, isHuman: false })), firstJackTeam: 0 });
  const player = match.players.find((p) => p.team === 0 && p.boulesLeft > 0);
  const args = (world) => ({ world, match: { ...match, phase: 'play', jack: { x: 2.2, y: 9.4, dead: false }, boules: [] }, player, difficulty: 'medium', rand: mulberry32(77), from: { x: court.throwFrom.x, y: court.throwFrom.y, z: 0.9 } });
  const a = mk();
  const base = chooseThrow(args(a.world));
  const b = mk();
  const pending = chooseThrowAsync(args(b.world));
  b.jack.x += 1.5; b.jack.y += 2; // the live jack moves while the planner is between steps
  const got = await pending;
  assert.deepEqual(got.throwParams, base.throwParams);
  assert.equal(got.label, base.label);
});
