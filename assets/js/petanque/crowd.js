// Crowd steering and the end-of-mene plan (F14, F60). Pure geometry, no three.js.
//
// `steer` gives one walker's velocity (a unit vector scaled 0..1) for this step: seek the target, be pushed sideways
// (and a little away) by anybody within SEP_R, and slow to a stop behind anybody directly ahead. F60: after the result the boules
// go into their owners' hands at once, the ring holder drops the ring on arrival, and everybody else walks to their
// next-mene place (`planGoals`); the next mene starts when the ring is down and everybody is at a place (`meneEndReady`, `atPlaces`).

import { waitingSlots } from './waiting.js';

export const SEP_R = 0.8; // m: others closer than this push a walker sideways
export const MIN_GAP = 0.5; // m: walkers try never to come closer than this
export const AHEAD_R = 1.3; // m: how far ahead a walker looks for somebody in the way
export const BLOCK_FADE_S = 2; // s blocked on the way to the goal before a walker fades to it
export const AT_PLACE = 0.6; // m: a player this close to their place is at it


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

// Everybody is at their place: places and positions are { id -> { x, y } } maps (Map or plain object); a player without a place counts as there.
export function atPlaces(positions, places, tol = AT_PLACE) {
  const get = (m, k) => (m instanceof Map ? m.get(k) : m[k]);
  const ids = places instanceof Map ? [...places.keys()] : Object.keys(places);
  return ids.every((id) => { const p = get(positions, id), g = get(places, id); return !g || (!!p && Math.hypot(p.x - g.x, p.y - g.y) <= tol); });
}

// ---------------------------------------------------------------------------------------------------------------------
// F51: at the end of a mène the ring is carried to its next spot while every player collects their boules. The spot is known
// as soon as the result is (nextCircle), so the holder walks straight there and drops it; the next mène starts when the ring
// is down AND the collecting is over. Pure decisions here; main.js runs the walks.
// ---------------------------------------------------------------------------------------------------------------------

// The next mène may start (nextMene) when the ring is down and everybody is at their place (a skip puts everybody there at once).
export const meneEndReady = ({ ringDown, collectDone }) => !!ringDown && !!collectDone;

// ---------------------------------------------------------------------------------------------------------------------
// F97: a dead jack is fetched by one player and carried back to jack.spot; the ring carrier (a different player) waits for it.
// ---------------------------------------------------------------------------------------------------------------------

// The jack carrier: the player nearest the dead jack's resting place who is neither the ring holder nor the ring carrier
// (they are the same person in main.js; both are excluded). Ties go to the smaller id, so the choice is deterministic.
// players: [{ id }]; positions: Map or object id -> { x, y }; -> id, or null when nobody else is there.
export function pickJackCarrier(players, positions, jackPos, { ringHolder = null, ringCarrier = null } = {}) {
  const get = (id) => (positions instanceof Map ? positions.get(id) : positions[id]);
  const pool = players.filter((p) => p.id !== ringHolder && p.id !== ringCarrier);
  const dist = (p) => { const q = get(p.id); return q ? Math.hypot(q.x - jackPos.x, q.y - jackPos.y) : Infinity; };
  pool.sort((a, b) => dist(a) - dist(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return pool.length ? pool[0].id : null;
}

// Where the ring carrier waits while the jack is still being brought: `gap` metres short of the ring's destination on the line from
// where they are (never on the spot itself); they are already closer than `gap`: they stay where they are.
export function ringStagePoint(from, to, gap = 1.6) {
  const dx = from.x - to.x, dy = from.y - to.y, d = Math.hypot(dx, dy);
  if (d <= gap) return { x: from.x, y: from.y };
  return { x: to.x + dx / d * gap, y: to.y + dy / d * gap };
}

// The ring may be dropped when no jack task is running or it has finished (the jack is down at jack.spot).
export const ringMayDrop = ({ jackTask, jackDone }) => !jackTask || !!jackDone;
