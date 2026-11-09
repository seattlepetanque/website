// F45: the player picks a partner (Pierre, Marcel or Odette); the other two are the opponents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createWorld, createBody, launch, simulate } from '../../assets/js/petanque/physics.js';
import { createMatch, defaultPlayers, apply, nextTeam, playersWithBoules, teamNamesFor, opponentIds, validPartner, PARTNER_IDS } from '../../assets/js/petanque/rules.js';
import { chooseThrow, chooseJackThrow } from '../../assets/js/petanque/ai.js';
import { whoThrows, profileFor, adviceProfile, profiles } from '../../assets/js/petanque/tactics.js';
import { PERSONALITIES, LINES, REASON_ACTION, createCommentary, composeSuggestion, whoKind, specFor } from '../../assets/js/petanque/personalities.js';
import { resetCourt } from '../../assets/js/petanque/court.js';

test('each partner gives you + partner against the other two', () => {
  for (const partner of PARTNER_IDS) {
    const ps = defaultPlayers(partner);
    assert.equal(ps.length, 4);
    const t0 = ps.filter((p) => p.team === 0).map((p) => p.id).sort();
    assert.deepEqual(t0, ['you', partner].sort());
    assert.deepEqual(ps.filter((p) => p.team === 1).map((p) => p.id), opponentIds(partner));
    assert.equal(ps.filter((p) => p.isHuman).length, 1);
    assert.ok(ps.find((p) => p.id === 'you').isHuman && ps.every((p) => p.boulesLeft === 3));
    assert.notEqual(ps.find((p) => p.id === 'you').role, ps.find((p) => p.id === partner).role, 'the two partners complement each other');
  }
  assert.deepEqual(teamNamesFor('pierre'), ['You & Pierre', 'Marcel & Odette']);
  assert.deepEqual(teamNamesFor('marcel'), ['You & Marcel', 'Pierre & Odette']);
  assert.deepEqual(teamNamesFor('odette'), ['You & Odette', 'Pierre & Marcel']);
  assert.equal(validPartner('nobody'), 'pierre');
  assert.deepEqual(defaultPlayers().map((p) => p.id), ['you', 'pierre', 'marcel', 'odette']); // default unchanged
});

test('characters keep their own skill, hand and role whoever they partner', () => {
  assert.equal(specFor('odette').hand, 'left');
  assert.equal(specFor('marcel').hand, undefined);
  for (const partner of PARTNER_IDS) {
    for (const p of defaultPlayers(partner)) {
      if (p.id === 'you') continue;
      assert.equal(p.role, { pierre: 'tireur', marcel: 'pointeur', odette: 'tireur' }[p.id]);
      assert.ok(profiles[p.id], 'a tactics profile for ' + p.id);
    }
  }
});

test('advice mixes in the chosen partner\'s temperament', () => {
  const ids = new Set();
  for (const id of PARTNER_IDS) {
    const a = profileFor({ id: 'you' }, { advice: id });
    assert.equal(a.id, 'advice-' + id);
    ids.add(a.appetite);
  }
  assert.equal(ids.size, 3, 'three different advice profiles');
  assert.equal(profileFor({ id: 'you' }, { advice: true }).id, adviceProfile('pierre').id);
});

test('commentary names the right teammate and every partner can advise', () => {
  for (const partner of PARTNER_IDS) {
    const talk = createCommentary(mulberry32(5), { partner });
    for (const code of Object.keys(REASON_ACTION)) assert.ok(LINES[partner].suggest[code], `${partner} advice for ${code}`);
    for (const k of ['youPoint', 'youPointAlone', 'youShoot', 'iShoot', 'iPoint', 'only']) assert.ok(LINES[partner].who[k], `${partner} who.${k}`);
    for (const intent of ['point', 'shoot']) {
      const code = intent === 'point' ? 'takePoint' : 'removePoints';
      const kind = whoKind({ intent, thrower: { id: partner, isHuman: false }, partner: { id: partner }, partnerHasBoules: true, teamSize: 2 });
      const text = composeSuggestion(talk, { speaker: partner, intent, code, kind, vars: { gap: '5 cm', n: 2 } });
      assert.ok(text.startsWith(PERSONALITIES[partner].name + ': '), text);
      assert.ok(!/\{\w+\}/.test(text), text);
    }
    // no pool line names a character who is not on the speaker's side of the table
    for (const id of PARTNER_IDS) {
      const t = createCommentary(mulberry32(9), { partner });
      for (let i = 0; i < 30; i++) for (const ev of ['removePoints', 'ownScores', 'meneWon']) {
        const l = t.line(id, ev === 'removePoints' ? 'why.removePoints' : ev);
        if (l) assert.ok(!/\{(mate|partner)\}/.test(l), l);
      }
    }
  }
  const t = createCommentary(() => 0, { partner: 'pierre' });
  assert.match(t.line('marcel', 'ownScores') + t.line('marcel', 'why.removePoints'), /Odette/); // his mate is Odette
  const t2 = createCommentary(() => 0, { partner: 'odette' });
  assert.match(t2.line('marcel', 'why.removePoints'), /Pierre/); // with Odette as your partner Marcel's mate is Pierre
});

test('the AI plays a mène with any of the three as your partner', () => {
  for (const partner of PARTNER_IDS) {
    resetCourt();
    const seed = 41;
    const terrain = createTerrain(seed);
    const world = createWorld(terrain, mulberry32(seed));
    const rand = mulberry32(seed ^ 0x51ed270b);
    let match = createMatch({ target: 13, players: defaultPlayers(partner).map((p) => ({ ...p, isHuman: false })), firstJackTeam: 0 });
    const thrower = match.players.find((p) => p.team === 0);
    const jack = createBody('jack', {});
    world.add(jack);
    launch(jack, chooseJackThrow({ world, difficulty: 'easy', rand, player: thrower, geometry: match.geometry }).throwParams);
    simulate(world, 20);
    match = apply(match, { type: 'jackThrown', team: 0, jack: { x: jack.x, y: jack.y, dead: jack.dead } });
    if (match.phase !== 'play') continue; // a failed jack is a rules matter, not what this checks
    const throwers = new Set();
    let n = 0;
    while (match.phase === 'play' && n++ < 14) {
      const team = nextTeam(match), avail = playersWithBoules(match, team);
      const player = whoThrows({ match, bodies: world.bodies, team, difficulty: 'easy', players: avail }).player;
      assert.ok(player && player.team === team && player.boulesLeft > 0);
      throwers.add(player.id);
      const advice = !player.isHuman && team === 0 ? partner : false; // the partner also gives advice
      const choice = chooseThrow({ world, match, player, difficulty: 'easy', rand, advice });
      match = apply(match, { type: 'bouleThrown', playerId: player.id });
      const b = createBody('boule', { team, owner: player.id });
      world.add(b); launch(b, choice.throwParams); simulate(world, 20);
      const j = world.bodies.find((q) => q.kind === 'jack');
      match = apply(match, { type: 'throwSettled', jack: { x: j.x, y: j.y, dead: j.dead },
        boules: world.bodies.filter((q) => q.kind === 'boule').map((q) => ({ id: q.id, team: q.team, owner: q.owner, x: q.x, y: q.y, dead: q.dead })) });
    }
    assert.ok(throwers.has(partner) || throwers.has('you'), `${partner}'s team threw`);
    assert.ok(['meneEnd', 'gameOver', 'play'].includes(match.phase));
  }
});
