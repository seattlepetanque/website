// The court state (E10): where the throwing circle is and which way (along y) the mène is played. Each new mène
// is thrown from a circle drawn around the last jack, usually back toward the other end, so nothing may assume the
// circle is at (2, 1) or that "ahead" is +y. `court.circle` and `court.throwFrom` are live objects mutated in place,
// so modules may hold a reference to them. Everything below the state is pure geometry.
import { C } from './constants.js';

export const CIRCLE_R = 0.25;
export const DEFAULT_CIRCLE = Object.freeze({ x: 2, y: 1 });
export const JACK_TOL = 0.25; // the last jack lies within this of the new circle's centre
export const COURT_MARGIN = 1; // circle centre at least this far from the end lines
// F79: no margin from the side strings (the rule's 1 m is from obstacles; strings are not obstacles): the ring may touch or
// straddle a string. Only its centre must stay on the court, which also keeps it clear of the timbers (C.lumberGap outside).
export const SIDE_MARGIN = 0;
// F89b (user decision): the whole ring is placed in bounds even though Art. 6 would allow straddling a string, so the ring
// centre keeps CIRCLE_R from each side string. Separate from SIDE_MARGIN (the jack's own bound, which may lie on the string).
// End strings: COURT_MARGIN (1 m) > CIRCLE_R, so the whole ring is already inside there.
export const CIRCLE_SIDE_MARGIN = CIRCLE_R;

export const court = {
  circle: { x: DEFAULT_CIRCLE.x, y: DEFAULT_CIRCLE.y, r: CIRCLE_R },
  throwFrom: { x: DEFAULT_CIRCLE.x, y: DEFAULT_CIRCLE.y, z: C.throwFrom.z },
  dir: 1, // +1: played toward y = terrainL, -1: toward y = 0
};

export function setCourt(circle, dir) {
  court.circle.x = circle.x; court.circle.y = circle.y;
  court.throwFrom.x = circle.x; court.throwFrom.y = circle.y;
  court.dir = dir < 0 ? -1 : 1;
}
export const resetCourt = () => setCourt(DEFAULT_CIRCLE, 1);

// Yaw (atan2(dx, dy): 0 faces +y) of straight ahead
export const baseYaw = (dir = court.dir) => (dir < 0 ? Math.PI : 0);
// F109: the yaw a thrower at `circle` starts a turn facing: the bearing to `target` (the jack), kept within `maxOff` of straight
// ahead; straight ahead (baseYaw) without a target. The aim camera, the character and the aim all start from this one value.
export function facingTo(circle, target, maxOff = Math.PI / 2, dir = court.dir) {
  const base = baseYaw(dir);
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return base;
  const dx = target.x - circle.x, dy = target.y - circle.y;
  if (Math.hypot(dx, dy) < 1e-6) return base;
  let d = Math.atan2(dx, dy) - base;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return base + Math.max(-maxOff, Math.min(maxOff, d));
}
export const forward = (yaw = baseYaw()) => ({ x: Math.sin(yaw), y: Math.cos(yaw) });
// The point `dist` metres ahead of the circle along the court (and `lateral` to the thrower's right)
export function ahead(dist, lateral = 0, c = court.circle, dir = court.dir) {
  return { x: c.x + lateral * dir, y: c.y + dist * dir };
}
// y of the end string being played toward
export const farLine = (dir = court.dir, length = C.terrainL) => (dir > 0 ? length : 0);
// metres from `y` to that end string (negative past it)
export const farGap = (y, dir = court.dir, length = C.terrainL) => (dir > 0 ? length - y : y);
// metres of court ahead of the circle along y (negative behind it)
export const alongOf = (p, c = court.circle, dir = court.dir) => (p.y - c.y) * dir;
export const distFromCircle = (p, c = court.circle) => Math.hypot(p.x - c.x, p.y - c.y);
// court coordinates: along (ahead of the circle) and across (to the thrower's right, positive)
export const toLocal = (p, c = court.circle, dir = court.dir) => ({ along: (p.y - c.y) * dir, across: (p.x - c.x) * dir });
export const toWorld = (l, c = court.circle, dir = court.dir) => ({ x: c.x + l.across * dir, y: c.y + l.along * dir });

// The circle for the next mène (pure), in two steps (E10, E28). 1) The ring is placed around `jack` (centre within
// JACK_TOL of it, at least COURT_MARGIN from the end lines, whole ring inside sideways: CIRCLE_SIDE_MARGIN, F89b) and play is turned toward the other end.
// 2) The front of the ring (its edge facing the playing direction) must have at least FRONT_MIN to the far string; if
// not, the ring is moved straight back, away from the far string, until FRONT_WANT remain (still inside the end margins).
// Returns { circle: {x, y, r} (the final one), placed: {x, y, r} (step 1), moved, dir, front (metres from the front of
// the final ring to the far string) }.
// F80: the front is derived from the legal throw range (edge to edge, F75). A jack thrown the full JACK_MAX gap lies with its
// centre JACK_MAX + circle.r + jack.r from the ring's centre and must still be more than JACK_END_MARGIN (its edge) before the
// end string, i.e. its centre at least JACK_END_MARGIN + jack.r before it. The ring's front edge is circle.r nearer the string
// than its centre, so: front >= JACK_MAX + JACK_END_MARGIN + 2 * jack.r (10.53 m). FRONT_WANT adds a metre of slack.
export const JACK_MAX_GAP = C.jackMaxDist;
export const JACK_END_EDGE = 0.5; // = rules.js JACK_END_MARGIN (not imported: rules.js imports this file; a test pins them equal)
export const FRONT_MIN = JACK_MAX_GAP + JACK_END_EDGE + 2 * C.jack.r;
export const FRONT_WANT = FRONT_MIN + 1;
export function nextCircle(jack, dir = 1, { width = C.terrainW, length = C.terrainL } = {}) {
  const lo = { x: CIRCLE_SIDE_MARGIN, y: COURT_MARGIN }, hi = { x: width - CIRCLE_SIDE_MARGIN, y: length - COURT_MARGIN };
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const j = jack && Number.isFinite(jack.x) && Number.isFinite(jack.y) ? jack : DEFAULT_CIRCLE;
  const nd = dir > 0 ? -1 : 1;
  const placed = { x: cl(j.x, lo.x, hi.x), y: cl(j.y, lo.y, hi.y), r: CIRCLE_R };
  const front = (y) => (nd > 0 ? length - (y + CIRCLE_R) : y - CIRCLE_R);
  let circle = { ...placed }, moved = false;
  if (front(placed.y) < FRONT_MIN) {
    const y = nd > 0 ? length - CIRCLE_R - FRONT_WANT : CIRCLE_R + FRONT_WANT;
    circle = { x: placed.x, y: cl(y, lo.y, hi.y), r: CIRCLE_R };
    moved = true;
  }
  return { circle, placed, moved, dir: nd, front: front(circle.y) };
}

// The court as the layout record waiting.js and friends read (C's dimensions, plus the live circle and direction)
export const courtGeo = () => ({ terrainW: C.terrainW, terrainL: C.terrainL, jackMinDist: C.jackMinDist, jackMaxDist: C.jackMaxDist, circle: court.circle, dir: court.dir });
