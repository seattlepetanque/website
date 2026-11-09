// Crowd steering for the post-mène boule gathering (F14). Pure geometry, no three.js.
//
// `steer` gives one walker's velocity (a unit vector scaled 0..1) for this step: seek the target, be pushed sideways
// (and a little away) by anybody within SEP_R, and slow to a stop behind anybody directly ahead. `createGather` is a
// small whole-process model (seek nearest own boule, bend, next boule, goal) with the 20 s fallback: used by the tests
// and mirroring what main.js drives through the animated characters.

import { waitingSlots } from './waiting.js';

export const SEP_R = 0.8; // m: others closer than this push a walker sideways
export const MIN_GAP = 0.5; // m: walkers try never to come closer than this
export const AHEAD_R = 1.3; // m: how far ahead a walker looks for somebody in the way
export const GATHER_TIMEOUT = 20; // s of game time before the fallback puts the boules in their owners' hands
export const BLOCK_FADE_S = 2; // s blocked on the way to the goal before a walker fades to it
export const PICK_TIME = 0.9; // s to bend and take a boule (character BEND_TIME is about this)

// me, target: { x, y }; others: [{ x, y }] (everybody else, still or walking). -> { vx, vy, scale, blocked }
export function steer(me, target, others, { sepR = SEP_R, minGap = MIN_GAP, aheadR = AHEAD_R } = {}) {
  const dx = target.x - me.x, dy = target.y - me.y, dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return { vx: 0, vy: 0, scale: 0, blocked: false };
  const ux = dx / dist, uy = dy / dist;
  let px = 0, py = 0, scale = 1;
  for (const o of others) {
    const ox = o.x - me.x, oy = o.y - me.y, d = Math.hypot(ox, oy);
    if (d >= sepR || d < 1e-6) { if (d < 1e-6) { px += 0.6; } continue; }
    const w = (sepR - d) / sepR;
    const ax = -ox / d, ay = -oy / d; // away from the other
    // sideways: perpendicular to the way to the target, on the side that already points away from the other
    let sx = -uy, sy = ux;
    if (sx * ax + sy * ay < 0) { sx = -sx; sy = -sy; }
    px += (ax * 0.7 + sx * 1.6) * w * 1.5; py += (ay * 0.7 + sy * 1.6) * w * 1.5;
  }
  for (const o of others) { // slow for somebody in the way
    const ox = o.x - me.x, oy = o.y - me.y;
    const along = ox * ux + oy * uy, side = Math.abs(-ox * uy + oy * ux);
    if (along <= 0 || along > aheadR || side > 0.5 || along > dist + 0.3) continue; // a walker beyond the goal is no obstacle
    scale = Math.min(scale, Math.max(0, (along - minGap * 0.9) / (aheadR - minGap * 0.9)));
  }
  let vx = ux + px, vy = uy + py;
  const m = Math.hypot(vx, vy);
  if (m > 1) { vx /= m; vy /= m; }
  // never let the sideways push turn a walker away from the target entirely
  if (vx * ux + vy * uy < 0.15 && scale > 0) scale = Math.min(scale, 0.5);
  return { vx: vx * scale, vy: vy * scale, scale, blocked: scale < 0.15 };
}

// Move agents [{ x, y, tx, ty, speed }] one step with steering (tests of the avoidance on its own)
export function stepAgents(agents, dt) {
  const pos = agents.map((a) => ({ x: a.x, y: a.y }));
  return agents.map((a, i) => {
    const v = steer(pos[i], { x: a.tx, y: a.ty }, pos.filter((_, j) => j !== i));
    const l = Math.hypot(a.tx - a.x, a.ty - a.y), m = Math.hypot(v.vx, v.vy);
    if (m > 0) { const d = Math.min(a.speed * dt * m, l); a.x += v.vx / m * d; a.y += v.vy / m * d; }
    return v;
  });
}

// agents: [{ id, x, y, boules: [{ id, x, y }], goal: { x, y } }]. step(dt) advances; fields afterwards: agent.held
// (boules in hand), agent.phase ('seek' | 'pick' | 'goal' | 'done' | 'faded'), gather.fallback, gather.finished.
export function createGather(agents, { speed = 1.35, timeout = GATHER_TIMEOUT, pick = PICK_TIME } = {}) {
  const A = agents.map((a) => ({ ...a, boules: a.boules.map((b) => ({ ...b })), held: 0, phase: 'seek', timer: 0, blockedT: 0, target: null }));
  const g = { agents: A, t: 0, fallback: false, finished: false };
  const near = (a) => a.boules.reduce((best, b) => (!best || Math.hypot(b.x - a.x, b.y - a.y) < Math.hypot(best.x - a.x, best.y - a.y) ? b : best), null);
  g.step = (dt) => {
    if (g.finished) return;
    g.t += dt;
    if (!g.fallback && g.t >= timeout) { // the boules still on the ground go into their owners' hands; everyone heads for the goal
      g.fallback = true;
      for (const a of A) {
        if (a.phase === 'done' || a.phase === 'faded') continue;
        a.held += a.boules.length; a.boules = []; a.phase = 'goal'; a.blockedT = 0;
      }
    }
    const pos = A.map((a) => ({ x: a.x, y: a.y }));
    A.forEach((a, i) => {
      if (a.phase === 'seek') {
        const b = near(a);
        if (!b) { a.phase = 'goal'; return; }
        a.target = b;
        // somebody else bending at that boule: wait
        if (A.some((o) => o !== a && o.phase === 'pick' && Math.hypot(o.x - b.x, o.y - b.y) < 0.9)) return;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 0.05) { a.phase = 'pick'; a.timer = pick; a.target = b; return; }
        move(a, i, b, dt);
      } else if (a.phase === 'pick') {
        a.timer -= dt;
        if (a.timer <= 0) { a.boules = a.boules.filter((b) => b !== a.target); a.held++; a.phase = a.boules.length ? 'seek' : 'goal'; }
      } else if (a.phase === 'goal') {
        if (Math.hypot(a.goal.x - a.x, a.goal.y - a.y) < 0.05) { a.phase = 'done'; return; }
        const s = move(a, i, a.goal, dt);
        a.blockedT = s.blocked ? a.blockedT + dt : 0;
        if (g.fallback && a.blockedT > BLOCK_FADE_S) { a.x = a.goal.x; a.y = a.goal.y; a.phase = 'faded'; }
      }
    });
    function move(a, i, to, dt2) {
      const s = steer(pos[i], to, pos.filter((_, j) => j !== i));
      const l = Math.hypot(to.x - a.x, to.y - a.y), m = Math.hypot(s.vx, s.vy);
      const dist = Math.min(speed * dt2 * m, l);
      if (m > 0) { a.x += s.vx / m * dist; a.y += s.vy / m * dist; }
      return s;
    }
    g.finished = A.every((a) => a.phase === 'done' || a.phase === 'faded');
  };
  return g;
}

// F15: where everybody goes for the next mène, from the state `nextMene` will produce (known as soon as the mène result is).
// next: rules `apply(match, { type: 'nextMene' })`; dims: { terrainW, terrainL, jackMinDist, jackMaxDist }.
// -> { to, dir, thrower, slots }: the new circle, the jack thrower's id (they walk to the circle) and the waiting slots behind it.
export function planGoals(next, dims) {
  const g = next.geometry, dir = g.dir ?? 1, to = { x: g.circle.x, y: g.circle.y };
  const team = next.jackTeam;
  const thrower = next.players.find((p) => p.team === team && (p.isHuman || team === 1)) || next.players.find((p) => p.team === team); // keep in sync with beginMene
  const slots = waitingSlots(null, { ...dims, circle: to, dir }).filter((s) => s.zone === 'circle');
  return { to, dir, thrower: thrower ? thrower.id : null, slots };
}
