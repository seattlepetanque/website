// Crowd steering and the end-of-mene plan (F14, F59). Pure geometry, no three.js.
//
// `steer` gives one walker's velocity (a unit vector scaled 0..1) for this step: seek the target, be pushed sideways
// (and a little away) by anybody within SEP_R, and slow to a stop behind anybody directly ahead. F59: after the result the boules
// are carried into their owners' hands (`handTargets`, `carryAt`), the ring holder drops the ring, and everybody else walks to their
// next-mene place (`planGoals`); the next mene starts when the ring is down and everybody is at a place (`meneEndReady`, `atPlaces`).

import { waitingSlots } from './waiting.js';

export const SEP_R = 0.8; // m: others closer than this push a walker sideways
export const MIN_GAP = 0.5; // m: walkers try never to come closer than this
export const AHEAD_R = 1.3; // m: how far ahead a walker looks for somebody in the way
export const BLOCK_FADE_S = 2; // s blocked on the way to the goal before a walker fades to it
export const COLLECT_TIMEOUT = 14; // s of game time before the fallback puts every boule still on the court in its owner's hand
export const CARRY_T = 0.7; // s a boule takes to arc from where it lies into its owner's hand
export const CARRY_STAGGER = 0.12; // s between successive boules starting (a visible ripple, not one flash)
export const CARRY_LIFT = 0.35; // m: how much higher than a straight line the arc rises
export const BOULE_R = 0.0375;
export const HAND_H = 0.55; // fraction of a player's height: the boules are carried at about hip height
export const AT_PLACE = 0.6; // m: a player this close to their place is at it
export const RING_R = 0.25; // m: the circle's radius (court.js CIRCLE_R; a test keeps them equal)


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

// F59: where the boules go. boules: [{ id, owner, x, y }]; people: [{ id, x, y, h? }] (h: the body height, m).
// -> [{ id, owner, from: {x,y}, to: {x,y,z}, delay }]: every boule with a known owner gets that owner's hand (hip height, at their
// position) as its target, started CARRY_STAGGER apart in the order given (ownerless boules and unknown owners are left out).
export function handTargets(boules, people, { stagger = CARRY_STAGGER, handH = HAND_H } = {}) {
  const at = new Map(people.map((p) => [p.id, p]));
  const out = [];
  for (const b of boules) {
    const p = at.get(b.owner);
    if (!p) continue;
    out.push({ id: b.id, owner: b.owner, from: { x: b.x, y: b.y }, to: { x: p.x, y: p.y, z: (p.h ?? 1.75) * handH }, delay: out.length * stagger });
  }
  return out;
}

// Where a carried boule is `t` seconds after its start: a smooth arc from `from` (on the ground, z0) to the hand `to`, rising
// CARRY_LIFT above the straight line. -> { x, y, z, done }; the boule is placed in the hand once done.
export function carryAt(from, to, t, { dur = CARRY_T, lift = CARRY_LIFT, z0 = BOULE_R } = {}) {
  const u = Math.max(0, Math.min(1, t / dur)), e = u * u * (3 - 2 * u);
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: z0 + (to.z - z0) * e + lift * 4 * u * (1 - u), done: u >= 1 };
}

// Everybody is at their place: places and positions are { id -> { x, y } } maps (Map or plain object); a player without a place counts as there.
export function atPlaces(positions, places, tol = AT_PLACE) {
  const get = (m, k) => (m instanceof Map ? m.get(k) : m[k]);
  const ids = places instanceof Map ? [...places.keys()] : Object.keys(places);
  return ids.every((id) => { const p = get(positions, id), g = get(places, id); return !g || (!!p && Math.hypot(p.x - g.x, p.y - g.y) <= tol); });
}

// ---------------------------------------------------------------------------------------------------------------------
// F51: at the end of a mène the ring is carried to its next spot while every player collects their boules. The spot is known
// as soon as the result is (nextCircle), so the holder walks straight there; the ring goes down only when nothing lies in it
// and nobody stands on it, and the next mène starts when the ring is down AND the collecting is over. Pure decisions here;
// main.js runs the walks.
// ---------------------------------------------------------------------------------------------------------------------
export const RING_BOULE_CLEAR = 0.15; // m: a boule this much (edge to edge) outside the ring does not stop it going down
export const RING_PERSON_CLEAR = 0; // m: F53: the ring never waits for people (it is dropped flat); only a boule in it stops it. > 0 brings the old person check back
export const RING_WAIT_MAX = COLLECT_TIMEOUT + 4; // s the holder waits at the spot before putting it down anyway (the fallback has emptied the court by then)

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

// The next mène may start (nextMene) when the ring is down and everybody is at their place (a skip puts everybody there at once).
export const meneEndReady = ({ ringDown, collectDone }) => !!ringDown && !!collectDone;
