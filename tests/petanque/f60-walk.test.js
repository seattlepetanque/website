// F60: players walk straight to their next-mène places: with the real characters, crowd steering each frame (as main.js crowdTick)
// and the real planGoals slots, every walker arrives without a path much longer than the straight line and without orbiting the goal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../assets/js/vendor/three.module.js';
import { createCharacter } from '../../assets/js/petanque/character.js';
import { steer, planGoals } from '../../assets/js/petanque/crowd.js';
import { createMatch, defaultPlayers, apply } from '../../assets/js/petanque/rules.js';
import { resetCourt } from '../../assets/js/petanque/court.js';
import { C } from '../../assets/js/petanque/constants.js';

const SPEED = 2.4; // main.js CAST_SPEED / FETCH_SPEED

function simulate(starts, goals, { limit = 40 } = {}) {
  const chars = starts.map((s) => { const ch = createCharacter(THREE, { stance: 'stand' }); ch.root.position.x = s.x; ch.root.position.y = s.y; return ch; });
  const done = chars.map(() => false), len = chars.map(() => 0), turn = chars.map(() => 0), last = chars.map((c, i) => ({ x: starts[i].x, y: starts[i].y, a: null }));
  chars.forEach((ch, i) => { ch.walkTo({ x: goals[i].x, y: goals[i].y, yaw: 0, speed: SPEED }); });
  let t = 0;
  while (t < limit && !chars.every((c, i) => done[i])) {
    const all = chars.map((c, i) => ({ id: i, x: c.root.position.x, y: c.root.position.y }));
    chars.forEach((ch, i) => { // main.js crowdTick
      const leg = ch.walkLeg(); if (!leg) return;
      const p = ch.root.position;
      if (Math.hypot(leg.x - p.x, leg.y - p.y) < 0.4) return;
      ch.setSteer(steer({ x: p.x, y: p.y }, leg, all.filter((o) => o.id !== i)));
    });
    chars.forEach((ch) => ch.update(1 / 60));
    chars.forEach((ch, i) => {
      const p = ch.root.position, l = last[i], dx = p.x - l.x, dy = p.y - l.y, d = Math.hypot(dx, dy);
      len[i] += d;
      if (d > 1e-4) { const a = Math.atan2(dx, dy); if (l.a !== null) turn[i] += Math.abs(Math.atan2(Math.sin(a - l.a), Math.cos(a - l.a))); l.a = a; }
      l.x = p.x; l.y = p.y;
    });
    chars.forEach((c, i) => { if (!done[i] && !c.busy) done[i] = true; });
    t += 1 / 60;
  }
  const fin = chars.map((c) => ({ x: c.root.position.x, y: c.root.position.y }));
  chars.forEach((c) => c.dispose());
  return { done, len, turn, fin, t };
}

test('F60: walkers to the real next-mène slots arrive on a near-straight path, no orbiting', () => {
  resetCourt();
  let m = createMatch({ target: 13, players: defaultPlayers(), firstJackTeam: 0 });
  m = { ...m, phase: 'meneEnd', jack: { x: 2.3, y: 9.2 }, boules: [], result: { void: true } };
  const plan = planGoals(apply(m, { type: 'nextMene' }), { terrainW: C.terrainW, terrainL: C.terrainL, jackMinDist: C.jackMinDist, jackMaxDist: C.jackMaxDist });
  resetCourt();
  const goals = plan.slots.slice(0, 4);
  const layouts = [
    [{ x: 2.0, y: 8.6 }, { x: 2.6, y: 9.0 }, { x: 1.7, y: 9.4 }, { x: 2.5, y: 9.8 }], // everybody crowded round the jack
    [{ x: 1, y: 3 }, { x: 1.6, y: 3.3 }, { x: 8, y: 12 }, { x: 8.5, y: 11.6 }],
    goals.map((g) => ({ x: g.x + 0.35, y: g.y - 0.2 })), // already close to the places
    goals.map((g, i) => ({ x: goals[(i + 1) % 4].x, y: goals[(i + 1) % 4].y })), // swapped places
  ];
  for (const [k, starts] of layouts.entries()) {
    const r = simulate(starts, goals);
    starts.forEach((s, i) => {
      const straight = Math.hypot(goals[i].x - s.x, goals[i].y - s.y);
      assert.ok(r.done[i], `layout ${k} walker ${i} arrived (t=${r.t.toFixed(1)}, ${Math.hypot(r.fin[i].x - goals[i].x, r.fin[i].y - goals[i].y).toFixed(2)} m off)`);
      assert.ok(r.len[i] <= Math.max(1.5 * straight, straight + 1), `layout ${k} walker ${i} path ${r.len[i].toFixed(2)} vs straight ${straight.toFixed(2)}`);
      assert.ok(r.turn[i] < 2 * Math.PI * 0.75, `layout ${k} walker ${i} turned ${r.turn[i].toFixed(1)} rad`);
    });
  }
});
