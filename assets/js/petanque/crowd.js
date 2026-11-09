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
export const ZONE_R = 0.7; // m: a zone is a disc this big (three boules rest in a 0.25 m triangle, with room to stand)
export const ZONE_GAP = 0.2; // m: two zones keep this much between their discs
export const KICK_TIMEOUT = 14; // s of game time before the fallback puts the remaining boules in the owners' hands
export const KICK_STAGGER = 0.7; // s between the starts of successive players
export const KICK_MIN = 0.5, KICK_MAX = 4; // m: nearer is picked up in place, farther is walked to
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
  for (const r of [1.8, 2.5, 3.2, 3.9]) for (let a = 0; a < 360; a += 30) raw.push({ x: head.x + r * Math.sin(a * Math.PI / 180), y: head.y + r * Math.cos(a * Math.PI / 180) });
  for (const fx of [0.25, 0.5, 0.75]) for (let k = -6; k <= 6; k++) raw.push({ x: W * fx, y: head.y + k * 1.7 });
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
  for (const clear of [ZONE_R + 0.3, ZONE_R + 0.1, 0.5, 0.3]) { // too few valid places: ask less of the boules' clearance
    cands = zoneCandidates(head, { plan, dims, obstacles, boules, clear });
    const spaced = [];
    for (const c of cands) if (spaced.every((s) => Math.hypot(s.x - c.x, s.y - c.y) >= 2 * ZONE_R + ZONE_GAP)) spaced.push(c);
    if (spaced.length >= ps.length) break;
  }
  if (!cands.length) return res;
  const pool = [];
  for (const c of cands) { if (pool.length < 12 && pool.every((s) => Math.hypot(s.x - c.x, s.y - c.y) >= 0.9)) pool.push(c); }
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
        if (pick[a] !== k && d < 2 * ZONE_R + ZONE_GAP) ok = false;
      }
      if (!ok) continue;
      pick[i] = k; dfs(i + 1, cost + cost1[i][k]);
    }
  };
  dfs(0, 0);
  if (best) ps.forEach((p, i) => { res[p.id] = { x: pool[best[i]].x, y: pool[best[i]].y, shared: best.some((k, j) => j !== i && k === best[i]) }; });
  return res;
}

// Where `n` boules land in a zone: one at the centre, otherwise on a small ring (0.25 m apart for three)
export function zoneSpots(zone, n) {
  if (n <= 1) return [{ x: zone.x, y: zone.y }];
  const r = n === 2 ? 0.125 : 0.145;
  return Array.from({ length: n }, (_, i) => ({ x: zone.x + r * Math.sin(2 * Math.PI * i / n), y: zone.y + r * Math.cos(2 * Math.PI * i / n) }));
}

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
export function kickMove(from, to, terrain, { zone = null, r = BOULE_R } = {}) {
  let end = { x: to.x, y: to.y };
  let d = Math.hypot(end.x - from.x, end.y - from.y);
  const ux = d > 0 ? (end.x - from.x) / d : 0, uy = d > 0 ? (end.y - from.y) / d : 0;
  let pulled = false;
  if (terrain && terrain.stonesNear && d > 0) {
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

// One player's kick list: their in-field boules more than KICK_MIN and at most KICK_MAX from the zone, farthest from the
// zone first, each with its target spot in the zone. The rest (near the zone already, too far, dead) are picked up in place.
export function kickList(boules, zone, inField = () => true) {
  const mine = boules.filter((b) => inField(b) && !b.dead);
  const far = mine.filter((b) => { const d = Math.hypot(b.x - zone.x, b.y - zone.y); return d >= KICK_MIN && d <= KICK_MAX; })
    .sort((a, b) => Math.hypot(b.x - zone.x, b.y - zone.y) - Math.hypot(a.x - zone.x, a.y - zone.y) || (a.id < b.id ? -1 : 1));
  const spots = zoneSpots(zone, far.length);
  return far.map((b, i) => ({ boule: b, target: spots[i] }));
}

// agents: [{ id, team, x, y, goal: { x, y } }]; boules: [{ id, owner, x, y, dead? }]; opts: { head, plan, dims, scoredTeam, terrain,
// force (always kick what kickOk allows), speed, holder }. step(dt) advances; afterwards agent.phase ('wait' | 'locate' | 'hold' |
// 'approach' | 'kick' | 'zone' | 'pick' | 'seek' | 'goal' | 'done' | 'faded'), collect.kicks (the log), collect.finished,
// collect.fallback, collect.zones.
export function createCollect(agents, boules, { head, plan = null, dims, scoredTeam = null, terrain = null, force = false, speed = 1.35, holder = null, timeout = KICK_TIMEOUT, pick = PICK_TIME } = {}) {
  const A = agents.map((a) => ({ ...a, held: 0, phase: 'wait', timer: 0, queue: null, cur: null, blockedT: 0, slid: [] }));
  const B = boules.map((b) => ({ ...b, slide: null }));
  const inField = (b) => b.x > 0 && b.x < dims.terrainW && b.y > 0 && b.y < dims.terrainL;
  const c = { agents: A, boules: B, t: 0, fallback: false, finished: false, kicks: [], zones: null };
  const live = () => B.filter((b) => !b.taken);
  c.zones = assignZones(A, live().filter((b) => inField(b) && !b.dead), head, plan, { dims, holder });
  const order = collectOrder(A, head, scoredTeam);
  A.forEach((a) => { a.start = 0; a.kickAt = order.indexOf(a.id) * KICK_STAGGER; a.zone = c.zones[a.id]; }); // the stagger spreads the kicks; a player with nothing to kick just starts
  const people = (a) => A.filter((o) => o !== a && o.phase !== 'done').map((o) => ({ x: o.x, y: o.y, gx: o.goal && o.phase === 'goal' ? o.goal.x : undefined, gy: o.goal ? o.goal.y : undefined }));
  const mine = (a) => live().filter((b) => b.owner === a.id);
  const near = (a, list) => list.reduce((best, b) => (!best || Math.hypot(b.x - a.x, b.y - a.y) < Math.hypot(best.x - a.x, best.y - a.y) ? b : best), null);
  function walk(a, to, dt) {
    const pos = A.map((o) => ({ x: o.x, y: o.y })), i = A.indexOf(a);
    const l = Math.hypot(to.x - a.x, to.y - a.y);
    if (l < 0.4) { const d = Math.min(speed * dt, l); a.x += (to.x - a.x) / l * d; a.y += (to.y - a.y) / l * d; return { blocked: false }; } // arriving: no steering (as main.js crowdTick), so the last step lands
    const v = steer(pos[i], to, pos.filter((_, j) => j !== i)), m = Math.hypot(v.vx, v.vy);
    if (m > 0) { const d = Math.min(speed * dt * m, l); a.x += v.vx / m * d; a.y += v.vy / m * d; }
    return v;
  }
  const arrived = (a, to) => Math.hypot(to.x - a.x, to.y - a.y) < 0.05;
  const takeAll = (a) => { for (const b of mine(a)) { b.taken = true; a.held++; } };
  function nextStep(a) { // decide the next thing to do
    if (a.zone && a.kicks === undefined) { a.kicks = kickList(mine(a), a.zone, inField); a.kicked = []; }
    while (a.kicks && a.kicks.length) {
      const k = a.kicks[0];
      const others = live().filter((b) => b.owner !== a.id && inField(b) && !b.dead);
      const ppl = people(a);
      const crowded = force || isCrowded(k.boule, a, ppl, live());
      if (crowded && kickOk(k.boule, k.boule, k.target, ppl, others)) { a.cur = k; a.stand = kickStand(k.boule, k.target); a.phase = c.t < a.kickAt ? 'hold' : 'approach'; return; }
      a.kicks.shift(); // picked up in place
    }
    if (a.kicked && a.kicked.length) { a.phase = 'zone'; return; }
    a.phase = 'seek';
  }
  c.step = (dt) => {
    if (c.finished) return;
    c.t += dt;
    if (!c.fallback && c.t >= timeout) {
      c.fallback = true;
      for (const a of A) { if (a.phase === 'done' || a.phase === 'faded') continue; takeAll(a); a.phase = 'goal'; a.blockedT = 0; }
    }
    for (const b of B) { // slides run on
      if (!b.slide) continue;
      b.slide.t += dt;
      const p = b.slide.mv.at(b.slide.t);
      b.x = p.x; b.y = p.y;
      if (b.slide.t >= b.slide.mv.T) { b.slide = null; }
    }
    for (const a of A) {
      if (a.phase === 'wait') { if (c.t >= a.start) { a.phase = 'locate'; a.timer = 0.8; } }
      else if (a.phase === 'locate') { a.timer -= dt; if (a.timer <= 0) nextStep(a); }
      else if (a.phase === 'hold') { if (c.t >= a.kickAt) a.phase = 'approach'; }
      else if (a.phase === 'approach') {
        if (arrived(a, a.stand)) { a.phase = 'kick'; a.timer = 0; a.fired = false; a.yaw = a.stand.yaw; }
        else walk(a, a.stand, dt);
      } else if (a.phase === 'kick') {
        a.timer += dt;
        if (!a.fired && a.timer >= KICK_CONTACT_T) {
          a.fired = true;
          const k = a.cur, ppl = people(a), others = live().filter((b) => b.owner !== a.id && inField(b) && !b.dead);
          if (kickOk(k.boule, k.boule, k.target, ppl, others)) {
            const mv = kickMove(k.boule, k.target, terrain, { zone: { x: a.zone.x, y: a.zone.y, r: ZONE_R } });
            k.boule.slide = { t: 0, mv }; a.kicked.push(k);
            c.kicks.push({ t: c.t, id: k.boule.id, owner: a.id, from: { x: k.boule.x, y: k.boule.y }, to: mv.end, people: ppl.map((p) => ({ x: p.x, y: p.y })), kicker: { x: a.x, y: a.y } });
          }
        }
        if (a.timer >= KICK_ANIM) { a.kicks.shift(); a.cur = null; nextStep(a); }
      } else if (a.phase === 'zone') {
        if (arrived(a, a.zone)) { a.phase = 'seek'; } else walk(a, a.zone, dt);
      } else if (a.phase === 'seek') {
        const list = mine(a).filter((b) => !b.slide);
        if (!list.length) { a.phase = mine(a).length ? 'seek' : 'goal'; continue; }
        const b = near(a, list);
        if (A.some((o) => o !== a && o.phase === 'pick' && o.target && Math.hypot(o.target.x - b.x, o.target.y - b.y) < 0.9)) continue;
        if (arrived(a, b)) { a.phase = 'pick'; a.timer = pick; a.target = b; } else walk(a, b, dt);
      } else if (a.phase === 'pick') {
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
export const RING_PERSON_CLEAR = 0.6; // m: a person nearer than this to the ring's centre stops it going down
export const RING_WAIT_MAX = KICK_TIMEOUT + 4; // s the holder waits at the spot before putting it down anyway (the fallback has emptied the court by then)

// What stops the ring being set down at `spot`: live boules (not the jack) lying in or against it, people other than the holder
// standing on it. boules: [{ id, x, y, r? }]; people: [{ id, x, y }].
// -> { boules: [id], people: [id], clear: boolean }
export function ringBlockers(spot, boules = [], people = [], holder = null, { ringR = RING_R, bouleClear = RING_BOULE_CLEAR, personClear = RING_PERSON_CLEAR } = {}) {
  const bs = boules.filter((b) => Math.hypot(b.x - spot.x, b.y - spot.y) < ringR + (b.r ?? BOULE_R) + bouleClear).map((b) => b.id);
  const ps = people.filter((p) => p.id !== holder && Math.hypot(p.x - spot.x, p.y - spot.y) < personClear).map((p) => p.id);
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
