// F27: the partner (Pierre, Marcel or Odette) plays what he suggested, in an unchanged situation
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createWorld, createBody } from '../../assets/js/petanque/physics.js';
import { createMatch, defaultPlayers, PARTNER_IDS } from '../../assets/js/petanque/rules.js';
import { AI, chooseThrow, forgetAdvice, peekAdvice } from '../../assets/js/petanque/ai.js';

AI.timeGuard = false;
const flat = () => ({ sample: () => ({ h: 0, nx: 0, ny: 0, nz: 1, friction: 0.1, loose: 0.2 }), stonesNear: () => [], addDivot() {}, resetDivots() {}, visibleStones: () => [], perceived() { return this; } });

// our team is 0 (you + partner), theirs 1
const LAYOUTS = [
  { us: [[0.15, -0.1]], them: [[-0.3, 0.1], [0.5, 0.2]] },
  { us: [], them: [[0.1, 0.1]] },
  { us: [[-0.1, 0.1], [0.4, 0.0]], them: [[0.05, -0.2]] },
  { us: [], them: [[0.1, 0.05], [-0.4, 0.4]] },
  { us: [[0.1, 0.0]], them: [] },
  { us: [[0.0, 0.2], [0.3, 0.3]], them: [[0.2, -0.1], [-0.2, -0.1]] },
];

function scene(partner, layout, seed) {
  const world = createWorld(flat(), mulberry32(seed));
  const J = { x: 2, y: 8 + (seed % 3) * 0.4 };
  const jack = world.add(createBody('jack', J));
  const boules = [];
  for (const [side, t] of [['us', 0], ['them', 1]]) for (const [dx, dy] of layout[side]) boules.push(world.add(createBody('boule', { x: J.x + dx, y: J.y + dy, team: t })));
  const match = { ...createMatch({ players: defaultPlayers(partner) }), phase: 'play', jack: { x: jack.x, y: jack.y }, boules };
  return { world, match, partner: match.players.find((p) => p.id === partner) };
}

for (const partnerId of PARTNER_IDS) {
  test(`${partnerId}: his throw follows his suggestion (family, intent, target) when nothing changed`, () => {
    let followed = 0, total = 0;
    LAYOUTS.forEach((layout, i) => {
      const s = scene(partnerId, layout, i + 1);
      const args = { world: s.world, match: s.match, player: s.partner, difficulty: 'medium' };
      forgetAdvice();
      const said = chooseThrow({ ...args, rand: mulberry32(100 + i), advice: partnerId });
      const memo = peekAdvice(0);
      if (!memo || !memo.plan) return; // a fallback is not a plan
      const did = chooseThrow({ ...args, rand: mulberry32(900 + i) }); // a different random stream: his own execution
      total++;
      assert.equal(did.intent, said.intent, `layout ${i}: intent`);
      assert.equal(did.family, said.family, `layout ${i}: family`);
      if (said.intent === 'shoot') assert.ok(Math.hypot(did.info.target.x - said.info.target.x, did.info.target.y - said.info.target.y) < 0.2, `layout ${i}: target`);
      assert.equal(peekAdvice(0), null, 'the plan is used once');
      followed++;
    });
    assert.ok(total >= 4, `${total} scenarios produced a plan`);
    assert.equal(followed, total);
  });
}

test('a changed court (or a different hand) means no stale plan is followed', () => {
  const s = scene('pierre', LAYOUTS[0], 1);
  const args = { world: s.world, match: s.match, player: s.partner, difficulty: 'medium' };
  forgetAdvice();
  chooseThrow({ ...args, rand: mulberry32(1), advice: 'pierre' });
  assert.ok(peekAdvice(0));
  s.world.bodies.find((b) => b.kind === 'boule').x += 0.3; // someone moved
  chooseThrow({ ...args, rand: mulberry32(2) });
  assert.ok(peekAdvice(0), 'not consumed: the key differs'); // still waiting, harmless
  forgetAdvice();
  assert.equal(peekAdvice(0), null);
});
