// E08: the position judged by jackThrown/jackValid is the jack's final resting position (never one taken mid-roll)
import test from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../../assets/js/petanque/constants.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createBody, launch, createWorld } from '../../assets/js/petanque/physics.js';
import { createMatch, apply, jackValid } from '../../assets/js/petanque/rules.js';

test('E08: for 300 seeded jack throws the judged position is the final one and the verdict matches the rules', () => {
  const terrain = createTerrain(7);
  const rnd = mulberry32(3);
  let valid = 0;
  for (let i = 0; i < 300; i++) {
    const w = createWorld(terrain.perceived(), mulberry32(i));
    const b = w.add(createBody('jack', { team: -1 }));
    launch(b, { yaw: (rnd() - 0.5) * 0.3, speed: 5 + rnd() * 5, loft: 0.3 + rnd() * 0.5, backspin: rnd() * 30, sidespin: 0 }, C.throwFrom);
    let guard = 0;
    while (!w.settled() && guard++ < 240 * 30) w.step();
    assert.ok(w.settled(), `throw ${i} settled`);
    const judged = { x: b.x, y: b.y, dead: b.dead };
    for (let k = 0; k < 480; k++) w.step(); // two more seconds: nothing may move
    assert.ok(Math.hypot(b.x - judged.x, b.y - judged.y) < 1e-9, `throw ${i} still moving when judged`);
    const m = apply(createMatch({ firstJackTeam: 0 }), { type: 'jackThrown', team: 0, jack: judged });
    const d = Math.hypot(judged.x - C.circle.x, judged.y - C.circle.y);
    const expectValid = !judged.dead && d >= 6 && d <= 10 && judged.x >= -0.015 && judged.x <= 4.015 && 15 - judged.y > 0.5;
    assert.equal(jackValid(judged), expectValid, `throw ${i} at ${judged.x},${judged.y} d=${d}`);
    assert.equal(m.phase, expectValid ? 'play' : 'jackPlace', `throw ${i}`);
    if (expectValid) valid++;
  }
  assert.ok(valid > 100 && valid < 300, `${valid} valid`);
});
