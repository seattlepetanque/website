// The court state (E10): where the throwing circle is and which way (along y) the mène is played. Each new mène
// is thrown from a circle drawn around the last jack, usually back toward the other end, so nothing may assume the
// circle is at (2, 1) or that "ahead" is +y. `court.circle` and `court.throwFrom` are live objects mutated in place,
// so modules may hold a reference to them. Everything below the state is pure geometry.
import { C } from './constants.js';

export const CIRCLE_R = 0.25;
export const DEFAULT_CIRCLE = Object.freeze({ x: 2, y: 1 });
export const JACK_TOL = 0.25; // the last jack lies within this of the new circle's centre
export const COURT_MARGIN = 1; // circle centre at least this far from the side strings and end lines

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
// JACK_TOL of it, at least COURT_MARGIN from the side strings and end lines) and play is turned toward the other end.
// 2) The front of the ring (its edge facing the playing direction) must have at least FRONT_MIN to the far string; if
// not, the ring is moved straight back, away from the far string, until FRONT_WANT remain (still inside the margins).
// Returns { circle: {x, y, r} (the final one), placed: {x, y, r} (step 1), moved, dir, front (metres from the front of
// the final ring to the far string) }.
export const FRONT_MIN = 10;
export const FRONT_WANT = 11;
export function nextCircle(jack, dir = 1, { width = C.terrainW, length = C.terrainL } = {}) {
  const lo = { x: COURT_MARGIN, y: COURT_MARGIN }, hi = { x: width - COURT_MARGIN, y: length - COURT_MARGIN };
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
