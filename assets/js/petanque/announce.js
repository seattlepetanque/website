// F61: pure detection of the two announced throws, decided once a throw has settled.
// No DOM, no physics: it reads the before positions (id -> { x, y }, a Map or a plain object), the settled bodies
// (id, kind, team, x, y, r, dead, ghost) and the physics events of the throw ({ type: 'hit', a, b }).
//
// Definitions (pétanque usage):
//  - CARREAU: a shot (tir) where the thrown boule hits an opposing boule, the target is knocked away (it moved at least
//    CARREAU.minMove, or it left the court) and the shooter's own boule stops on the target's original spot (its centre
//    within CARREAU.spotM of the target's old centre; a real carreau is "on the spot", with some slack for a few cm of roll).
//    A shooter that is itself out (dead) never counts. Hitting a teammate's boule is not announced.
//  - BIBERON: a boule at rest touching the cochonnet: surface-to-surface gap (gapM, rules.js) from just under zero
//    (overlap tolerance) to BIBERON.maxGapM (1 cm). F101: only the boule just thrown (shooterId) can
//    be a biberon, wherever it bounced on the way; boules it displaces, or that were already there, never are (a boule
//    that was already touching never counts, because only the thrown boule is checked). Dead or ghost boules and a dead jack never count.
// A carreau wins when both happen (it is the rarer call).
import { gapM } from './rules.js';

export const CARREAU = { minMove: 0.3, spotM: 0.1 };
export const BIBERON = { maxGapM: 0.01, minGapM: -0.005 };

const pos = (before, id) => (before instanceof Map ? before.get(id) : before && before[id]);
const live = (b) => b && b.kind === 'boule' && !b.dead && !b.ghost;
const touching = (b, j) => {
  const g = gapM(b, j);
  return g >= BIBERON.minGapM && g <= BIBERON.maxGapM;
};

export function isCarreau({ before, bodies, shooterId, events }) {
  const shooter = bodies.find((b) => b.id === shooterId);
  if (!live(shooter)) return false;
  for (const ev of events || []) {
    if (ev.type !== 'hit' || (ev.a !== shooterId && ev.b !== shooterId)) continue;
    const tid = ev.a === shooterId ? ev.b : ev.a;
    const t = bodies.find((b) => b.id === tid), from = pos(before, tid);
    if (!t || t.kind !== 'boule' || t.team === shooter.team || !from) continue;
    const moved = t.dead || t.ghost || Math.hypot(t.x - from.x, t.y - from.y) >= CARREAU.minMove;
    if (moved && Math.hypot(shooter.x - from.x, shooter.y - from.y) <= CARREAU.spotM) return true;
  }
  return false;
}

export function isBiberon({ bodies, shooterId }) {
  if (shooterId == null) return false; // only the thrown boule can be announced (a jack throw never is)
  const jack = bodies.find((b) => b.kind === 'jack');
  if (!jack || jack.dead || jack.ghost) return false;
  const b = bodies.find((x) => x.id === shooterId); // by identity, so bounces off other boules do not matter
  return live(b) && touching(b, jack);
}

// 'carreau' | 'biberon' | null
export function detectAnnouncement(throwInfo) {
  if (throwInfo.shooterId == null) return null;
  if (isCarreau(throwInfo)) return 'carreau';
  return isBiberon(throwInfo) ? 'biberon' : null;
}
