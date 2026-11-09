// Crowd steering for the post-mène boule gathering (F14). Pure geometry, no three.js.
//
// `steer` gives one walker's velocity (a unit vector scaled 0..1) for this step: seek the target, be pushed sideways
// (and a little away) by anybody within SEP_R, and slow to a stop behind anybody directly ahead. `createGather` is a
// small whole-process model (seek nearest own boule, bend, next boule, goal) with the 20 s fallback: used by the tests
// and mirroring what main.js drives through the animated characters.

import { waitingSlots } from './waiting.js';
import { chooseLocomotion } from './character.js';

export const SEP_R = 0.8; // m: others closer than this push a walker sideways
export const MIN_GAP = 0.5; // m: walkers try never to come closer than this
export const AHEAD_R = 1.3; // m: how far ahead a walker looks for somebody in the way
export const GATHER_TIMEOUT = 20; // s of game time before the fallback puts the boules in their owners' hands
export const BLOCK_FADE_S = 2; // s blocked on the way to the goal before a walker fades to it
export const PICK_TIME = 0.9; // s to bend and take a boule (character BEND_TIME is about this)

// me, target: { x, y }; others: [{ x, y }] (everybody else, still or walking). -> { vx, vy, scale, blocked }
// F53: `push: false` (a thrower standing at their spot) skips the sideways separation push; they are slowed by nobody's push either.
export function steer(me, target, others, { sepR = SEP_R, minGap = MIN_GAP, aheadR = AHEAD_R, push = true } = {}) {
  const dx = target.x - me.x, dy = target.y - me.y, dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return { vx: 0, vy: 0, scale: 0, blocked: false };
  const ux = dx / dist, uy = dy / dist;
  let px = 0, py = 0, scale = 1;
  for (const o of others) {
    const ox = o.x - me.x, oy = o.y - me.y, d = Math.hypot(ox, oy);
    if (!push) break;
    if (d >= sepR || d < 1e-6) { if (d < 1e-6) { px += 0.6; } continue; }
    const w = (sepR - d) / sepR;
    const ax = -ox / d, ay = -oy / d; // away from the other
    // sideways: perpendicular to the way to the target, on the side that already points away from the other
    let sx = -uy, sy = ux;
    if (sx * ax + sy * ay < 0) { sx = -sx; sy = -sy; }
    px += (ax * 0.7 + sx * 1.6) * w * 1.5; py += (ay * 0.7 + sy * 1.6) * w * 1.5;
  }
  let slipx = 0, slipy = 0; // F28: somebody standing right in the way: step round them instead of waiting for ever
  for (const o of others) { // slow for somebody in the way
    const ox = o.x - me.x, oy = o.y - me.y;
    const along = ox * ux + oy * uy, side = Math.abs(-ox * uy + oy * ux);
    if (along <= 0 || along > aheadR || side > 0.5 || along > dist + 0.3) continue; // a walker beyond the goal is no obstacle
    const s = Math.max(0, (along - minGap * 0.9) / (aheadR - minGap * 0.9));
    if (s < scale) { scale = s; const lat = -ox * uy + oy * ux; const sg = lat > 0 ? -1 : 1; slipx = -uy * sg; slipy = ux * sg; }
  }
  let vx = ux + px, vy = uy + py;
  const m = Math.hypot(vx, vy);
  if (m > 1) { vx /= m; vy /= m; }
  if (scale < 0.3 && dist > 0.6) { // blocked ahead: the slow-down stays, but a sideways step (away from the one in the way) gets the walker round
    const k = 0.45 * (1 - scale / 0.3);
    vx = vx * scale + slipx * k; vy = vy * scale + slipy * k;
    return { vx, vy, scale: Math.max(scale, Math.hypot(vx, vy)), blocked: scale < 0.15 };
  }
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

// ---------------------------------------------------------------------------------------------------------------------
// F28: collection zones and kicks. Each player gets a private disc of open court; a crowded head is cleared by nudging
// boules (a scripted slide, exact end points) out to the owner's zone, which the owner then collects in peace. See
// GAME-PLAN.md section 10c. Everything here is pure geometry (no three.js); main.js executes it with the animations.
// ---------------------------------------------------------------------------------------------------------------------
export const ZONE_R = 0.55; // m: a zone is a disc this big (F54: three boules rest in a 0.09 m triangle at its centre, the owner stands 0.42 m south of it)
export const ZONE_GAP = 0.3; // m: two zones keep this much between their discs (so two stand points are at least 1.4 m apart, well over STAND_APART)
export const STAND_APART = 0.8; // m: F54 stand points of different players are never nearer than this
export const BOULE_GAP = 0.015; // m: F54 gap between neighbouring boules in the slot triangle
export const SLOT_SIDE = 2 * 0.0375 + BOULE_GAP; // m: centre to centre in the triangle (9 cm)
export const SLOT_NEAR = 0.3; // m: a boule this close to its slot is moved there without a kick
export const SLOT_MAX = 6; // m: farther than this (and anything out of bounds) is picked up where it lies
export const STAND_OFFSET = 0.42; // m: the pick-up stand point lies this far south (-y) of the triangle's centre
export const KICK_TIMEOUT = 14; // s of game time before the fallback puts the remaining boules in the owners' hands
export const KICK_STAGGER = 0.25; // s between the starts of successive players (F54: zones are apart, the stagger only avoids four kicks on the same frame)
export const KICK_MIN = 0.5, KICK_MAX = 4; // m: nearer is picked up in place, farther is walked to
export const LOCATE_T = 0.4; // s of looking round at the head before the first move (F54: main.js uses 0.4 to 0.7)
export const KICK_ANIM = 0.85, KICK_CONTACT_T = 0.292; // s: character.js KICK_TIME and KICK_CONTACT (a test keeps them equal)
export const CROWD_R = 1.5; // m: somebody this close to a boule (or its approach) makes the head crowded for it
export const BOULE_CROWD = 0.9; // m: another player's boule this close makes it crowded too (stand points collide)
export const KICK_PERSON_CLEAR = 0.6, KICK_BOULE_CLEAR = 0.3, KICK_TARGET_CLEAR = 1; // m
export const BOULE_R = 0.0375;

const dseg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
};
const segCross = (a, b, c, d) => {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

// Candidate zone centres round the head `head`: rings at 1.8..3.9 m every 30 degrees plus a lattice along the court, kept
// where the whole zone is on court (edge from the lines), clear of the live boules (`boules`, by `clear`), clear of the
// next mène's circle and lane (plan: { to, dir }) and of `obstacles` ({ x, y, r } discs, or a segment with x2, y2).
// dims: { terrainW, terrainL }. -> [{ x, y }], nearest the head first.
export function zoneCandidates(head, { plan = null, dims, obstacles = [], boules = [], clear = ZONE_R + 0.5, edge = ZONE_R } = {}) {
  const W = dims.terrainW, L = dims.terrainL, raw = [];
  for (const r of [1.2, 1.8, 2.5, 3.2, 3.9]) for (let a = 0; a < 360; a += 30) raw.push({ x: head.x + r * Math.sin(a * Math.PI / 180), y: head.y + r * Math.cos(a * Math.PI / 180) });
  for (const fx of [0.15, 0.25, 0.35, 0.5, 0.65, 0.75, 0.85]) for (let k = -12; k <= 12; k++) raw.push({ x: W * fx, y: head.y + k * 0.85 }); // F54: a finer lattice, so four 1.4 m-spaced zones always fit
  const out = [];
  for (const c of raw) {
    if (c.x < edge || c.x > W - edge || c.y < edge || c.y > L - edge) continue;
    if (boules.some((b) => Math.hypot(b.x - c.x, b.y - c.y) < clear)) continue;
    if (plan) {
      if (Math.hypot(c.x - plan.to.x, c.y - plan.to.y) < 1.5) continue;
      const al = (c.y - plan.to.y) * plan.dir;
      if (al > -0.3 && al < 11 && Math.abs(c.x - plan.to.x) < 0.7) continue;
    }
    if (obstacles.some((o) => (o.x2 === undefined ? Math.hypot(c.x - o.x, c.y - o.y) : dseg(c.x, c.y, o.x, o.y, o.x2, o.y2)) < o.r)) continue;
    out.push(c);
  }
  out.sort((a, b) => Math.hypot(a.x - head.x, a.y - head.y) - Math.hypot(b.x - head.x, b.y - head.y) || a.x - b.x || a.y - b.y);
  return out;
}

// Give every player a zone. players: [{ id, team, x, y }] (x, y: where they stand); boules: live boules [{ id, owner, x, y }];
// head: { x, y }; plan: planGoals' { to, dir, thrower }; opts.holder: the ring holder's id. Tries every pairing of players to
// a pool of candidates and takes the cheapest: the walk to the player's first boule and on to the zone, 3 m per pair of
// crossing paths, 1 m per team whose zones lie on opposite sides, 4 m for a zone on someone else's feet; the next jack thrower
// and the ring holder are drawn toward the new circle. Zones never overlap (disc gap ZONE_GAP) unless the court is too tight,
// when two players share one (shared: true). -> { [id]: { x, y, shared } | null }; ties break by id (deterministic).
export function assignZones(players, boules, head, plan, { dims, obstacles = [], holder = null } = {}) {
  const ps = [...players].sort((a, b) => (a.id < b.id ? -1 : 1)), res = {};
  for (const p of ps) res[p.id] = null;
  let cands = [];
  for (const clear of [0.6, 0.45, 0.3]) { // too few valid places: ask less of the boules' clearance
    cands = zoneCandidates(head, { plan, dims, obstacles, boules, clear });
    const spaced = [];
    for (const c of cands) if (spaced.every((s) => Math.hypot(s.x - c.x, s.y - c.y) >= 2 * ZONE_R + ZONE_GAP)) spaced.push(c);
    if (spaced.length >= ps.length) break;
  }
  if (!cands.length) return res;
  const pool = [];
  for (const c of cands) { if (pool.length < 24 && pool.every((s) => Math.hypot(s.x - c.x, s.y - c.y) >= 0.9)) pool.push(c); }
  const first = ps.map((p) => {
    let best = null, bd = Infinity;
    for (const b of boules) if (b.owner === p.id) { const d = Math.hypot(b.x - p.x, b.y - p.y); if (d < bd) { bd = d; best = b; } }
    return best ? { x: best.x, y: best.y } : { x: head.x, y: head.y };
  });
  const cost1 = ps.map((p, i) => pool.map((z) => {
    let c = Math.hypot(first[i].x - p.x, first[i].y - p.y) + Math.hypot(z.x - first[i].x, z.y - first[i].y);
    if (plan && p.id === plan.thrower) c += 1.2 * Math.hypot(z.x - plan.to.x, z.y - plan.to.y);
    else if (plan && holder && p.id === holder) c += 0.6 * Math.hypot(z.x - plan.to.x, z.y - plan.to.y);
    if (ps.some((o) => o !== p && Math.hypot(o.x - z.x, o.y - z.y) < ZONE_R)) c += 4;
    return c;
  }));
  const legs = (i, k) => [[{ x: ps[i].x, y: ps[i].y }, first[i]], [first[i], pool[k]]];
  let best = null, bestCost = Infinity;
  const pick = [];
  let allowShare = false;
  const dfs = (i, cost) => {
    if (cost >= bestCost) return;
    if (i === ps.length) {
      let c = cost;
      for (let a = 0; a < i; a++) for (let b = a + 1; b < i; b++) {
        if (pick[a] === pick[b]) { c += 6; continue; }
        const la = legs(a, pick[a]), lb = legs(b, pick[b]);
        for (const x of la) for (const y of lb) if (segCross(x[0], x[1], y[0], y[1])) c += 3;
        if (ps[a].team === ps[b].team && (pool[pick[a]].x - head.x) * (pool[pick[b]].x - head.x) < 0) c += 1;
      }
      if (c < bestCost - 1e-9) { bestCost = c; best = [...pick]; }
      return;
    }
    for (let k = 0; k < pool.length; k++) {
      let ok = true;
      for (let a = 0; a < i && ok; a++) {
        const d = Math.hypot(pool[pick[a]].x - pool[k].x, pool[pick[a]].y - pool[k].y);
        if ((pick[a] !== k || !allowShare) && d < 2 * ZONE_R + ZONE_GAP) ok = false; // F54: a shared zone only when no unshared layout exists
      }
      if (!ok) continue;
      pick[i] = k; dfs(i + 1, cost + cost1[i][k]);
    }
  };
  dfs(0, 0);
  if (!best) { allowShare = true; bestCost = Infinity; dfs(0, 0); }
  if (best) ps.forEach((p, i) => { res[p.id] = { x: pool[best[i]].x, y: pool[best[i]].y, shared: best.some((k, j) => j !== i && k === best[i]) }; });
  return res;
}

// F54: where `n` boules land in a zone: a tight equilateral triangle (side SLOT_SIDE, 1.5 cm between the boules) centred on
// the zone, apex toward +y; two boules side by side; one at the centre.
export function triangleSlots(zone, n) {
  const s = SLOT_SIDE, R = s / Math.sqrt(3);
  if (n <= 1) return [{ x: zone.x, y: zone.y }];
  if (n === 2) return [{ x: zone.x - s / 2, y: zone.y }, { x: zone.x + s / 2, y: zone.y }];
  return [{ x: zone.x, y: zone.y + R }, { x: zone.x - s / 2, y: zone.y - R / 2 }, { x: zone.x + s / 2, y: zone.y - R / 2 }];
}
export const zoneSpots = triangleSlots;

// F54: where the owner stands to take the whole triangle in one bend (the same offset for every zone, so two stand points are
// exactly as far apart as their zones, 1.4 m or more)
export const zoneStand = (zone) => ({ x: zone.x, y: zone.y - STAND_OFFSET });

// The kicker's stand point: `behind` m behind the boule on the line to its target, facing along it -> { x, y, yaw }
export function kickStand(boule, target, behind = 0.38) {
  const dx = target.x - boule.x, dy = target.y - boule.y, d = Math.hypot(dx, dy) || 1;
  return { x: boule.x - dx / d * behind, y: boule.y - dy / d * behind, yaw: Math.atan2(dx, dy) };
}

// May `boule` be kicked from `from` to `to`? people: [{ x, y, self?, gx?, gy? }] (position, optional goal; self marks the
// kicker); others: live boules that must stay put [{ x, y }] (the caller leaves out the kicker's own boules and the one
// being kicked). Length KICK_MIN..KICK_MAX; nobody (the kicker apart) and no boule within the clearances of the line or
// the target; nobody's position or goal within ZONE_R + 0.3 of the target; never toward somebody within 5 m (25 degrees).
export function kickOk(boule, from, to, people = [], others = []) {
  const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy);
  if (d < KICK_MIN || d > KICK_MAX) return false;
  for (const p of people) {
    if (p.self) continue;
    if (dseg(p.x, p.y, from.x, from.y, to.x, to.y) < KICK_PERSON_CLEAR || Math.hypot(p.x - to.x, p.y - to.y) < KICK_TARGET_CLEAR) return false;
    if (Math.hypot(p.x - to.x, p.y - to.y) < ZONE_R + 0.3) return false;
    if (p.gx !== undefined && Math.hypot(p.gx - to.x, p.gy - to.y) < ZONE_R + 0.3) return false;
    const pd = Math.hypot(p.x - from.x, p.y - from.y);
    if (pd < 5 && pd > 1e-6 && ((p.x - from.x) * dx + (p.y - from.y) * dy) / (pd * d) > Math.cos(25 * Math.PI / 180)) return false;
  }
  for (const o of others) {
    if (o === boule || (o.id !== undefined && o.id === boule.id)) continue;
    if (dseg(o.x, o.y, from.x, from.y, to.x, to.y) < KICK_BOULE_CLEAR || Math.hypot(o.x - to.x, o.y - to.y) < KICK_TARGET_CLEAR) return false;
  }
  return true;
}

// Is the head crowded for this boule? `me`: the owner { x, y, id }; people: everybody else standing or going (plus the ring
// holder), boules: live boules. True when somebody is within CROWD_R of the boule or of the owner's approach to it, or
// another player's boule lies within BOULE_CROWD of it.
export function isCrowded(boule, me, people = [], boules = []) {
  for (const p of people) {
    if (Math.hypot(p.x - boule.x, p.y - boule.y) < CROWD_R) return true;
    if (dseg(p.x, p.y, me.x, me.y, boule.x, boule.y) < CROWD_R * 0.6) return true;
  }
  return boules.some((o) => o !== boule && o.id !== boule.id && o.owner !== boule.owner && Math.hypot(o.x - boule.x, o.y - boule.y) < BOULE_CROWD);
}

// The scripted slide: a boule nudged from `from` to `to` decelerates evenly (v0 = 1.6 + 0.9 d m/s), hops 1 cm off the foot
// in the first 80 ms and stays on the ground (terrain.sample(x, y).h + r). terrain.stonesNear (optional): a stone on the line
// pulls the end point back to just before it when that point is still inside opts.zone ({ x, y, r }); otherwise the slide
// simply carries over. -> { from, end, d, T, at(t) -> { x, y, z, s, v } } (clamped to 0..T; at(T) is exactly `end`).
export function kickMove(from, to, terrain, { zone = null, r = BOULE_R, stones = true } = {}) { // F54: stones: false ignores the stones (the slot is exact)
  let end = { x: to.x, y: to.y };
  let d = Math.hypot(end.x - from.x, end.y - from.y);
  const ux = d > 0 ? (end.x - from.x) / d : 0, uy = d > 0 ? (end.y - from.y) / d : 0;
  let pulled = false;
  if (stones && terrain && terrain.stonesNear && d > 0) {
    for (let s = 0.1; s <= d; s += 0.05) {
      const x = from.x + ux * s, y = from.y + uy * s;
      if (terrain.stonesNear(x, y, r + 0.01).length) {
        const e = { x: from.x + ux * Math.max(0, s - 0.12), y: from.y + uy * Math.max(0, s - 0.12) };
        if (zone && Math.hypot(e.x - zone.x, e.y - zone.y) <= zone.r) { end = e; d = Math.hypot(end.x - from.x, end.y - from.y); pulled = true; }
        break;
      }
    }
  }
  const v0 = 1.6 + 0.9 * d, T = d > 0 ? 2 * d / v0 : 0;
  const h = (x, y) => (terrain ? terrain.sample(x, y).h : 0);
  const at = (t) => {
    const k = T > 0 ? Math.min(1, Math.max(0, t / T)) : 1;
    const s = k >= 1 ? d : d * (1 - (1 - k) * (1 - k));
    const x = k >= 1 ? end.x : from.x + ux * s, y = k >= 1 ? end.y : from.y + uy * s;
    const hop = t > 0 && t < 0.08 ? 0.01 * Math.sin(Math.PI * t / 0.08) : 0;
    return { x, y, z: h(x, y) + r + hop, s, v: k >= 1 ? 0 : v0 * (1 - k) };
  };
  return { from: { x: from.x, y: from.y }, end, d, T, pulled, at };
}

// ---- the collection plan and its whole-process model (tests; main.js drives the same decisions through the characters) ----
// The order of the players: the team that scored first, within a team the player nearer the head first -> [id]
export function collectOrder(players, head, scoredTeam = null) {
  return [...players].sort((a, b) => (a.team === scoredTeam ? 0 : 1) - (b.team === scoredTeam ? 0 : 1)
    || Math.hypot(a.x - head.x, a.y - head.y) - Math.hypot(b.x - head.x, b.y - head.y) || (a.id < b.id ? -1 : 1)).map((p) => p.id);
}

// F54: one player's plan for the zone: every in-field live boule within SLOT_MAX of the zone gets a slot of the triangle. The
// farthest boule goes first and takes the slot on the far side of the triangle from where it lies, so later slides never run
// over a boule already down. `kick` is false for a boule within SLOT_NEAR of its slot (moved there without the kick animation).
// -> [{ boule, target, kick }] in kicking order. The rest (dead, out of bounds, too far) are picked up in place.
// `from` (the player's position) orders the kicks as a nearest-boule-next tour from there (the shortest walk); without it, farthest first.
export function kickList(boules, zone, inField = () => true, from = null, first = () => false) { // `first(b)`: kicked ahead of the tour (a boule lying in the ring's way)
  let mine = boules.filter((b) => inField(b) && !b.dead && Math.hypot(b.x - zone.x, b.y - zone.y) <= SLOT_MAX)
    .sort((a, b) => Math.hypot(b.x - zone.x, b.y - zone.y) - Math.hypot(a.x - zone.x, a.y - zone.y) || (a.id < b.id ? -1 : 1));
  if (from) {
    const left = [...mine], tour = [];
    let p = { x: from.x, y: from.y };
    while (left.length) {
      let bi = 0;
      const urgent = left.some(first);
      left.forEach((b, i) => { if (urgent && !first(b)) return; if ((urgent && !first(left[bi])) || Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(left[bi].x - p.x, left[bi].y - p.y) - 1e-9) bi = i; });
      const b = left.splice(bi, 1)[0]; tour.push(b); p = b;
    }
    mine = tour;
  }
  const slots = triangleSlots(zone, mine.length);
  return mine.map((b) => {
    const d = Math.hypot(b.x - zone.x, b.y - zone.y) || 1, ux = (b.x - zone.x) / d, uy = (b.y - zone.y) / d;
    let bi = 0, bv = Infinity;
    slots.forEach((t, i) => { const v = (t.x - zone.x) * ux + (t.y - zone.y) * uy; if (v < bv - 1e-12) { bv = v; bi = i; } });
    const target = slots.splice(bi, 1)[0];
    return { boule: b, target, kick: Math.hypot(b.x - target.x, b.y - target.y) >= SLOT_NEAR };
  });
}

// F54: nobody (the kicker apart) within `clear` of the slide's line: the kicker waits a moment otherwise. people: [{ x, y }]
export function kickLineBlocked(from, to, people = [], clear = 0.35) {
  return people.some((p) => dseg(p.x, p.y, from.x, from.y, to.x, to.y) < clear);
}

// ---- F55: one kicker taps every boule toward its owner's slot (sidling along the cluster, a leg out to each boule) ----
export const TAP_REACH = 0.5; // m: a boule this close to the kicker (centre to centre) can be tapped without a step
export const TAP_STAND = 0.42; // m: when a step is needed, the kicker ends this far from the boule (sideways to it)
export const TAP_ANIM = 0.5, TAP_CONTACT_T = 0.22; // s: character.js TAP_TIME and TAP_CONTACT (a test keeps them equal)
export const TURN_T = 0.25; // s: a turn in place before a tap when the boule ended up behind the kicker
export const KICKER_HURRY = 1.35; // the kicker sidles this much quicker than the others walk (short quick steps; main.js passes it to the walk)
export const TAP_FREE_T = 0.34; // s: character.js TAP_FREE: the kicker may start stepping on while the leg is still coming back
const SIDLE_ANGLE = 50 * Math.PI / 180;

// Who kicks: the player nearest the head that is not busy with the ring or the jack (a busy one only when nobody else is free).
// players: [{ id, x, y }]; busy: ids (the ring holder, a fetcher). Ties go by id.
export function chooseKicker(players, head, { holder = null, busy = [] } = {}) {
  const taken = new Set([holder, ...busy].filter((x) => x !== null && x !== undefined));
  const pool = players.some((p) => !taken.has(p.id)) ? players.filter((p) => !taken.has(p.id)) : players;
  const sorted = [...pool].sort((a, b) => Math.hypot(a.x - head.x, a.y - head.y) - Math.hypot(b.x - head.x, b.y - head.y) || (a.id < b.id ? -1 : 1));
  return sorted.length ? sorted[0].id : null;
}

// The leg reach to a boule from where the kicker stands (pos) facing yaw (forward is (sin yaw, cos yaw), no turning toward the boule):
// -> { ok, leg: 'left' | 'right', x, y, d } where (x, y) is where the toe meets the boule's near edge in the kicker's own space
// (x right, y ahead, metres). ok: the boule is within `reach` and not behind the kicker. The leg is the one on the boule's side.
export function tapReach(pos, yaw, boule, { reach = TAP_REACH, r = BOULE_R } = {}) {
  const dx = boule.x - pos.x, dy = boule.y - pos.y, d = Math.hypot(dx, dy);
  const fwd = dx * Math.sin(yaw) + dy * Math.cos(yaw), side = dx * Math.cos(yaw) - dy * Math.sin(yaw);
  const k = d > r ? (d - r) / d : 0;
  return { ok: d <= reach + 1e-9 && fwd >= 0.05, leg: side >= 0 ? 'right' : 'left', x: side * k, y: fwd * k, d };
}

// The sidle (F57): where the kicker moves to so that `boule` is within leg reach, WITHOUT turning to it. His body keeps its facing `yaw`:
// the stop is a point beside the boule and a little ahead of him (TAP_SIDE to one side, TAP_AHEAD in front of the boule), on whichever side
// is nearer, or just behind it, so he arrives by a short step forward, backwards or sideways (chooseLocomotion in character.js picks the
// gait from the move vector) and the leg on the boule's side taps it. Only a long move (more than LOCO.longMove) turns him, to walk it
// facing forward; the stop is then recomputed for the new facing. Already in reach: stays.
// -> { x, y, move, yaw (his facing on arrival), mode ('forward' | 'backward' | 'left' | 'right'), turn (his facing changes) }
export const TAP_SIDE = 0.3, TAP_AHEAD = 0.15; // m: the stop point relative to the boule, in the kicker's own frame (side, ahead of the boule)
function sidleCands(pos, yaw, boule, reach) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), out = [];
  for (const [sd, ah] of [[TAP_SIDE, TAP_AHEAD], [-TAP_SIDE, TAP_AHEAD], [0, 0.4], [TAP_SIDE, 0.25], [-TAP_SIDE, 0.25]]) {
    // the kicker's frame: right = (cos yaw, -sin yaw), forward = (sin yaw, cos yaw); he stands `sd` right of the boule and `ah` behind-it-ahead
    const q = { x: boule.x - sd * cy - ah * sy, y: boule.y + sd * sy - ah * cy };
    if (tapReach(q, yaw, boule, { reach }).ok) out.push({ ...q, walk: Math.hypot(q.x - pos.x, q.y - pos.y) });
  }
  return out.sort((p, q) => p.walk - q.walk);
}
export function sidleStop(pos, yaw, boule, { reach = TAP_REACH, prev = null } = {}) {
  if (tapReach(pos, yaw, boule, { reach }).ok) return { x: pos.x, y: pos.y, move: false, yaw, mode: prev ? prev.mode : 'forward', turn: false };
  let face = yaw, best = sidleCands(pos, face, boule, reach)[0], lo = null;
  for (let pass = 0; pass < 2; pass++) {
    lo = chooseLocomotion({ x: best.x - pos.x, y: best.y - pos.y }, face, prev, Math.hypot(best.x - pos.x, best.y - pos.y));
    if (!lo.turn) break;
    face = lo.facing; best = sidleCands(pos, face, boule, reach)[0]; // turning anyway: arrive facing the way of the walk, the boule beside him
  }
  return { x: best.x, y: best.y, move: true, yaw: face, mode: lo.mode, turn: face !== yaw };
}

// The whole plan: every in-field live boule within SLOT_MAX of its owner's zone (zones: { [ownerId]: { x, y } | null }) gets its slot
// in the owner's triangle (kickList). Boules within SLOT_NEAR of their slot go to `quick` (slid there, no tap). The rest are the
// kicker's `tour`: a nearest-next walk along the cluster from `from`, boules `first` (lying in the ring's way) ahead of it.
// -> { tour: [{ boule, target, owner, kick }], quick: [...], slotted: { [ownerId]: [boule] } }
export function collectPlan(boules, zones, inField = () => true, from = null, first = () => false) {
  const all = [], slotted = {};
  const owners = [...new Set(boules.map((b) => b.owner))].sort();
  for (const o of owners) {
    const z = zones[o];
    if (!z) continue;
    for (const k of kickList(boules.filter((b) => b.owner === o), z, inField)) { all.push({ ...k, owner: o }); (slotted[o] = slotted[o] || []).push(k.boule); }
  }
  const quick = all.filter((k) => !k.kick), left = all.filter((k) => k.kick), tour = [];
  let p = from ? { x: from.x, y: from.y } : null;
  while (left.length) {
    const urgent = left.some((k) => first(k.boule));
    let bi = -1, bd = Infinity;
    left.forEach((k, i) => {
      if (urgent && !first(k.boule)) return;
      const d = p ? Math.hypot(k.boule.x - p.x, k.boule.y - p.y) : -Math.hypot(k.boule.x - k.target.x, k.boule.y - k.target.y);
      if (d < bd - 1e-9) { bd = d; bi = i; }
    });
    const k = left.splice(bi, 1)[0]; tour.push(k); p = { x: k.boule.x, y: k.boule.y };
  }
  if (from && !boules.some((b) => first(b))) { // 2-opt: reverse a stretch of the path while that shortens the walk
    const pt = (i) => (i < 0 ? from : tour[i].boule), len = (a, b) => Math.hypot(pt(a).x - pt(b).x, pt(a).y - pt(b).y);
    for (let pass = 0, imp = true; imp && pass < 8; pass++) {
      imp = false;
      for (let i = 0; i < tour.length - 1; i++) for (let j = i + 1; j < tour.length; j++) {
        const n = j + 1 < tour.length;
        const delta = len(i - 1, j) + (n ? len(i, j + 1) : 0) - len(i - 1, i) - (n ? len(j, j + 1) : 0);
        if (delta < -1e-6) {
          const seg = tour.slice(i, j + 1).reverse(); tour.splice(i, j - i + 1, ...seg); imp = true;
        }
      }
    }
  }
  return { tour, quick, slotted };
}

// F55 whole-process model. agents: [{ id, team, x, y, goal: { x, y } }]; boules: [{ id, owner, x, y, dead? }]; opts: { head, plan, dims,
// scoredTeam, terrain, speed, holder }. One kicker (chooseKicker) sidles along the boules and taps each toward its slot in its
// owner's triangle (scripted slide, exact end point); everybody else walks to their own zone's stand point and takes all three at once
// when their triangle is complete; the kicker takes his last. Boules out of bounds or too far are picked up where they lie. step(dt)
// advances; afterwards agent.phase ('wait' | 'locate' | 'sidle' | 'tap' | 'zone' | 'pick' | 'seek' | 'seekpick' | 'goal' | 'done' |
// 'faded'), agent.stands, collect.kicks, collect.kicker, collect.finished, collect.fallback, collect.zones.
export function createCollect(agents, boules, { head, plan = null, dims, scoredTeam = null, terrain = null, speed = 1.35, holder = null, timeout = KICK_TIMEOUT, pick = PICK_TIME } = {}) {
  const A = agents.map((a) => ({ ...a, held: 0, phase: 'wait', timer: 0, blockedT: 0, stands: null, slotted: [], yaw: Math.atan2(head.x - a.x, head.y - a.y) }));
  const B = boules.map((b) => ({ ...b, slide: null, at: false }));
  const inField = (b) => b.x > 0 && b.x < dims.terrainW && b.y > 0 && b.y < dims.terrainL;
  const c = { agents: A, boules: B, t: 0, fallback: false, finished: false, kicks: [], zones: null, kicker: null, tour: [] };
  const live = () => B.filter((b) => !b.taken);
  c.zones = assignZones(A, live().filter((b) => inField(b) && !b.dead), head, plan, { dims, holder });
  const kid = chooseKicker(A, head, { holder });
  c.kicker = kid;
  const kp = A.find((a) => a.id === kid);
  const cp = collectPlan(live().filter((b) => inField(b) && !b.dead), c.zones, inField, kp, () => false);
  c.tour = cp.tour;
  for (const a of A) { a.zone = c.zones[a.id]; a.slotted = cp.slotted[a.id] || []; }
  for (const k of cp.tour) k.boule.tour = true;
  const people = (a) => A.filter((o) => o !== a && o.phase !== 'done');
  const mine = (a) => live().filter((b) => b.owner === a.id);
  const near = (a, list) => list.reduce((best, b) => (!best || Math.hypot(b.x - a.x, b.y - a.y) < Math.hypot(best.x - a.x, best.y - a.y) ? b : best), null);
  function walk(a, to, dt0) {
    const dt = a.phase === 'sidle' ? dt0 * KICKER_HURRY : dt0;
    const pos = A.map((o) => ({ x: o.x, y: o.y })), i = A.indexOf(a);
    const l = Math.hypot(to.x - a.x, to.y - a.y);
    let v = { blocked: false };
    const free = a.phase === 'sidle'; // F57: the kicker keeps his facing (strafes, backs up); a.yaw changes only when a.stop.turn
    if (l < 0.4) { const d = Math.min(speed * dt, l); if (!free) a.yaw = Math.atan2(to.x - a.x, to.y - a.y); a.x += (to.x - a.x) / l * d; a.y += (to.y - a.y) / l * d; return v; } // arriving: no steering (as main.js crowdTick), so the last step lands
    v = steer(pos[i], to, pos.filter((_, j) => j !== i));
    const m = Math.hypot(v.vx, v.vy);
    if (m > 0) { const d = Math.min(speed * dt * m, l); a.x += v.vx / m * d; a.y += v.vy / m * d; a.yaw = free ? a.yaw : Math.atan2(v.vx, v.vy); }
    return v;
  }
  const arrived = (a, to) => Math.hypot(to.x - a.x, to.y - a.y) < 0.05;
  const takeAll = (a) => { for (const b of mine(a)) { b.taken = true; a.held++; } };
  const slide = (b, target) => { b.slide = { t: 0, mv: kickMove(b, target, terrain, { stones: false }) }; };
  c.step = (dt) => {
    if (c.finished) return;
    c.t += dt;
    if (!c.fallback && c.t >= timeout) {
      c.fallback = true;
      for (const a of A) { if (a.phase === 'done' || a.phase === 'faded') continue; takeAll(a); a.phase = 'goal'; a.blockedT = 0; }
    }
    if (c.t - dt <= 0) for (const k of cp.quick) slide(k.boule, k.target); // already at the slot: moved there, no tap
    for (const b of B) { // slides run on
      if (!b.slide) continue;
      b.slide.t += dt;
      const p = b.slide.mv.at(b.slide.t);
      b.x = p.x; b.y = p.y;
      if (b.slide.t >= b.slide.mv.T) { b.slide = null; b.at = true; }
    }
    for (const a of A) {
      if (a.phase === 'wait') { a.phase = 'locate'; a.timer = LOCATE_T; }
      else if (a.phase === 'locate') { a.timer -= dt; if (a.timer <= 0) a.phase = a.id === kid ? 'sidle' : 'zone'; }
      else if (a.phase === 'sidle') {
        const k = c.tour[0];
        if (!k) { a.phase = 'zone'; continue; }
        if (k.boule.taken) { c.tour.shift(); continue; }
        const st = sidleStop(a, a.yaw, k.boule);
        a.stop = st;
        if (!st.move || arrived(a, st)) {
          a.phase = 'tap'; a.timer = 0; a.fired = false; a.cur = k;
          if (!tapReach(a, a.yaw, k.boule).ok) { a.phase = 'sidle'; continue; } // steering left him short: another small step (no turning)
        }
        else { if (st.turn) a.yaw = st.yaw; walk(a, st, dt); }
      } else if (a.phase === 'tap') {
        a.timer += dt;
        const k = a.cur;
        if (!a.fired && a.timer >= TAP_CONTACT_T) {
          a.fired = true;
          const r = tapReach(a, a.yaw, k.boule);
          slide(k.boule, k.target);
          c.kicks.push({ t: c.t, id: k.boule.id, owner: k.owner, from: { x: k.boule.x, y: k.boule.y }, to: { x: k.target.x, y: k.target.y }, kicker: { x: a.x, y: a.y }, reach: r });
        }
        if (a.timer >= TAP_FREE_T) { c.tour.shift(); a.cur = null; a.phase = 'sidle'; }
      } else if (a.phase === 'zone') {
        if (!a.slotted.length) { a.phase = 'seek'; continue; }
        const st = zoneStand(a.zone);
        if (arrived(a, st)) { if (a.slotted.every((b) => b.at || b.taken) && (a.id !== kid || !c.tour.length)) { a.phase = 'pick'; a.timer = pick; a.stands = { x: a.x, y: a.y }; } } // all three down: one bend
        else walk(a, st, dt);
      } else if (a.phase === 'pick') { // one bend takes the whole triangle
        a.timer -= dt;
        if (a.timer <= 0) { for (const b of a.slotted) if (!b.taken) { b.taken = true; a.held++; } a.slotted = []; a.phase = 'seek'; }
      } else if (a.phase === 'seek') { // what is left lies where it fell (dead, out of bounds, too far): one bend each
        const list = mine(a);
        if (!list.length) { a.phase = 'goal'; continue; }
        const b = near(a, list);
        if (A.some((o) => o !== a && o.phase === 'seekpick' && o.target && Math.hypot(o.target.x - b.x, o.target.y - b.y) < 0.9)) continue;
        if (arrived(a, b)) { a.phase = 'seekpick'; a.timer = pick; a.target = b; } else walk(a, b, dt);
      } else if (a.phase === 'seekpick') {
        a.timer -= dt;
        if (a.timer <= 0) { a.target.taken = true; a.held++; a.target = null; a.phase = 'seek'; }
      } else if (a.phase === 'goal') {
        if (arrived(a, a.goal)) { a.phase = 'done'; continue; }
        const v = walk(a, a.goal, dt);
        a.blockedT = v.blocked ? a.blockedT + dt : 0;
        if (c.fallback && a.blockedT > BLOCK_FADE_S) { a.x = a.goal.x; a.y = a.goal.y; a.phase = 'faded'; }
      }
    }
    c.finished = A.every((a) => a.phase === 'done' || a.phase === 'faded');
  };
  return c;
}

// ---------------------------------------------------------------------------------------------------------------------
// F51: at the end of a mène the ring is carried to its next spot while every player collects their boules. The spot is known
// as soon as the result is (nextCircle), so the holder walks straight there; the ring goes down only when nothing lies in it
// and nobody stands on it, and the next mène starts when the ring is down AND the collecting is over. Pure decisions here;
// main.js runs the walks.
// ---------------------------------------------------------------------------------------------------------------------
export const RING_R = 0.25; // m: the circle's radius (court.js CIRCLE_R; a test keeps them equal)
export const RING_BOULE_CLEAR = 0.15; // m: a boule this much (edge to edge) outside the ring does not stop it going down
export const RING_PERSON_CLEAR = 0; // m: F53: the ring never waits for people (it is dropped flat); only a boule in it stops it. > 0 brings the old person check back
export const RING_WAIT_MAX = KICK_TIMEOUT + 4; // s the holder waits at the spot before putting it down anyway (the fallback has emptied the court by then)

// What stops the ring being set down at `spot`: live boules (not the jack) lying in or against it, people other than the holder
// standing on it. boules: [{ id, x, y, r? }]; people: [{ id, x, y }].
// -> { boules: [id], people: [id], clear: boolean }
export function ringBlockers(spot, boules = [], people = [], holder = null, { ringR = RING_R, bouleClear = RING_BOULE_CLEAR, personClear = RING_PERSON_CLEAR } = {}) {
  const bs = boules.filter((b) => Math.hypot(b.x - spot.x, b.y - spot.y) < ringR + (b.r ?? BOULE_R) + bouleClear).map((b) => b.id);
  const ps = personClear <= 0 ? [] : people.filter((p) => p.id !== holder && Math.hypot(p.x - spot.x, p.y - spot.y) < personClear).map((p) => p.id);
  return { boules: bs, people: ps, clear: !bs.length && !ps.length };
}

// The holder is at the spot with the ring: 'go' (put it down), 'wait' (something is in it) or 'force' (waited too long, or skipped).
export function ringGate(blockers, waited, { max = RING_WAIT_MAX, skipped = false } = {}) {
  if (skipped) return 'force';
  if (blockers.clear) return 'go';
  return waited >= max ? 'force' : 'wait';
}

// The next mène may start (nextMene) when the ring is down and the collecting is over (a skip finishes the collecting at once).
export const meneEndReady = ({ ringDown, collectDone }) => !!ringDown && !!collectDone;
