// Pure framing logic for the flight camera (D09): keep every moving body in view, favour a fast jack,
// and move through critically damped springs with capped speeds. No three.js; the renderer turns the
// result into a camera position (yaw 0 looks along +y, the camera sits behind and above the target). E10: opts.dir = -1
// plays toward y = 0: the camera then looks along -y (yaw pi) and the yaw limits are measured around that.
import { C } from './constants.js';

export const CAM = Object.freeze({
  moveSpeed: 0.05, // m/s: a rolling body slower than this no longer counts as moving
  jackFast: 2, // m/s: a jack this fast is the primary subject
  lookAhead: 0.5, // s of jack velocity to aim ahead by
  lookAheadMax: 3, // m: longest look-ahead
  crossTime: 1, // s: a jack projected to cross a string within this is primary
  ghostWeight: 0.3,
  minDist: 3.2, maxDist: 16,
  margin: 1.25, // framing slack on the fitted distance
  pitch: 0.3, minPitch: 0.12, maxPitch: 0.95,
  maxYaw: 0.6, // rad either side of straight down the court: never flips behind the play
  minCamZ: 0.4, // m above the ground
  // spring smooth time (s) and speed caps (units/s): target m, distance m, yaw rad, pitch rad
  target: { time: 0.22, max: 14 },
  dist: { time: 0.45, max: 8, timeIn: 1.0 },
  yaw: { time: 0.5, max: 0.9 },
  pitchSpring: { time: 0.5, max: 0.7 },
  reducedTime: 1.6, reducedSpeed: 0.8, // gentler moves under prefers-reduced-motion
});

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const speedOf = (b) => Math.hypot(b.vx || 0, b.vy || 0, b.vz || 0);

// Critically damped spring step (Game Programming Gems 4 SmoothDamp) with a hard per-frame change cap.
function damp(cur, goal, vel, time, maxSpeed, dt) {
  const om = 2 / Math.max(1e-3, time), x = om * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxChange = maxSpeed * time;
  const change = clamp(cur - goal, -maxChange, maxChange);
  const tg = cur - change;
  const t = (vel + om * change) * dt;
  let nv = (vel - om * t) * e;
  let out = tg + (change + t) * e;
  const cap = maxSpeed * dt;
  if (Math.abs(out - cur) > cap) { out = cur + Math.sign(out - cur) * cap; nv = (out - cur) / dt; }
  return [out, nv];
}

// Live subjects: airborne, or rolling above the threshold, plus the thrown body until it settles.
// Ghosts only while they roll, with low weight. Returns [{x, y, z, w, body}].
export function gatherMoving(bodies, thrown) {
  const pts = [];
  for (const b of bodies || []) {
    if (!b || b.state === 'resting') continue; // the thrown body counts only until it settles
    const moving = b.state === 'airborne' || speedOf(b) > CAM.moveSpeed;
    if (!moving && b !== thrown) continue;
    pts.push({ x: b.x, y: b.y, z: b.z, w: b.ghost && b !== thrown ? CAM.ghostWeight : 1, body: b });
  }
  return pts;
}

function jackIsPrimary(j) {
  if (!j || !j.vx && !j.vy) return false;
  const sp = Math.hypot(j.vx, j.vy);
  if (j.state === 'resting') return false;
  if (sp > CAM.jackFast) return true;
  const px = j.x + j.vx * CAM.crossTime, py = j.y + j.vy * CAM.crossTime;
  return sp > 0.5 && (px < 0 || px > C.terrainW || py < 0 || py > C.terrainL);
}

// Distance needed to fit points around `c` for the given view direction.
function fitDistance(pts, c, yaw, pitch, hTan, vTan) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  let d = CAM.minDist;
  for (const p of pts) {
    const rx = p.x - c.x, ry = p.y - c.y, rz = p.z - c.z;
    const lat = Math.abs(rx * cy - ry * sy), dep = rx * sy + ry * cy;
    const up = Math.abs(rz * cp + dep * sp);
    d = Math.max(d, (lat + 0.15) * CAM.margin / hTan - dep * cp + rz * sp, (up + 0.15) * CAM.margin / vTan - dep * cp + rz * sp);
  }
  return d;
}

function bbox(pts) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, single: x1 - x0 < 0.3 && y1 - y0 < 0.3 };
}

// opts: { aspect, fov (vertical, degrees), dt, reduced, thrown, dir (+1 | -1, the playing direction along y) }. prev: the last result (or null to snap).
// Returns { target:{x,y,z}, distance, yaw, pitch, primary, active, v } (feed it back as `prev`).
export function frameMoving(bodies, jack, opts, prev) {
  const dt = clamp(opts.dt || 0, 0, 0.1);
  const base = (opts.dir || 1) < 0 ? Math.PI : 0; // yaw of straight down the court
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const vTan = Math.tan((opts.fov || 50) * Math.PI / 360);
  const hTan = vTan * (opts.aspect || 1.5);
  const moving = gatherMoving(bodies, opts.thrown);
  if (!moving.length) return prev ? { ...prev, primary: null, active: false } : null;

  // priority order: a fast jack first (at its look-ahead), then the rest by weight
  const primary = jackIsPrimary(jack);
  let subjects = moving.slice();
  let heading = 0, hv = 0;
  const lead = primary ? moving.find((m) => m.body === jack) || { x: jack.x, y: jack.y, z: jack.z, w: 1, body: jack } : subjects.sort((a, b) => b.w - a.w)[0];
  const ref = lead.body;
  if (primary) {
    let lx = (jack.vx || 0) * CAM.lookAhead, ly = (jack.vy || 0) * CAM.lookAhead;
    const l = Math.hypot(lx, ly);
    if (l > CAM.lookAheadMax) { lx *= CAM.lookAheadMax / l; ly *= CAM.lookAheadMax / l; }
    const ahead = { x: clamp(jack.x + lx, -1, C.terrainW + 1), y: clamp(jack.y + ly, -1, C.terrainL + 1), z: Math.max(jack.z, 0.05), w: 1, body: jack };
    subjects = [ahead, { ...ahead, x: jack.x, y: jack.y, z: jack.z }, ...moving.filter((m) => m.body !== jack)];
  }
  hv = Math.hypot(ref.vx || 0, ref.vy || 0);
  heading = hv > 1 ? Math.atan2(ref.vx, ref.vy) : (prev ? prev.yaw : base);
  const yaw = base + clamp(wrap(heading - base), -CAM.maxYaw, CAM.maxYaw);
  const pitch0 = CAM.pitch;

  // add subjects while they fit; the lead (and the jack's current spot) always stay
  const keep = primary ? 2 : 1;
  const rest = subjects.slice(keep).sort((a, b) => b.w - a.w || Math.hypot(a.x - lead.x, a.y - lead.y) - Math.hypot(b.x - lead.x, b.y - lead.y));
  let used = subjects.slice(0, keep), c = bbox(used), dist = fitDistance(used, c, yaw, pitch0, hTan, vTan);
  for (const s of rest) {
    const t = used.concat(s), tc = bbox(t), td = fitDistance(t, tc, yaw, pitch0, hTan, vTan);
    if (td <= CAM.maxDist) { used = t; c = tc; dist = td; }
  }
  const ahead = c.single ? 0.8 : 0; // a lone body: look a little way ahead of it
  const tgt = {
    x: clamp(c.x + Math.sin(yaw) * ahead, -1, C.terrainW + 1),
    y: clamp(c.y + Math.cos(yaw) * ahead, -1, C.terrainL + 1),
    z: Math.max(0, c.z * 0.4),
  };
  dist = clamp(fitDistance(used, tgt, yaw, pitch0, hTan, vTan), CAM.minDist, CAM.maxDist);
  // stay above the ground: raise the pitch if the camera would dip under minCamZ
  let pitch = clamp(Math.max(pitch0, Math.asin(clamp((CAM.minCamZ - tgt.z) / dist, -1, 1))), CAM.minPitch, CAM.maxPitch);
  const goal = { target: tgt, distance: dist, yaw, pitch };

  const ids = used.map((u) => u.body.id);
  if (!prev || dt <= 0) {
    if (prev && dt <= 0) return { ...prev, primary: primary ? jack.id : null, active: true };
    return { ...goal, primary: primary ? jack.id : null, ids, active: true, v: { x: 0, y: 0, z: 0, d: 0, yaw: 0, p: 0 } };
  }
  const k = opts.reduced ? CAM.reducedTime : 1, s = opts.reduced ? CAM.reducedSpeed : 1;
  const v = prev.v || { x: 0, y: 0, z: 0, d: 0, yaw: 0, p: 0 };
  const T = CAM.target, D = CAM.dist, Y = CAM.yaw, P = CAM.pitchSpring;
  const [x, vx] = damp(prev.target.x, goal.target.x, v.x, T.time * k, T.max * s, dt);
  const [y, vy] = damp(prev.target.y, goal.target.y, v.y, T.time * k, T.max * s, dt);
  const [z, vz] = damp(prev.target.z, goal.target.z, v.z, T.time * k, T.max * s, dt);
  // zoom out quickly (keep everything in view), zoom back in slowly
  const [d, vd] = damp(prev.distance, dist, v.d, (dist > prev.distance ? D.time : D.timeIn) * k, D.max * s, dt);
  const [yw, vyw] = damp(prev.yaw, goal.yaw, v.yaw, Y.time * k, Y.max * s, dt);
  const [pt, vpt] = damp(prev.pitch, goal.pitch, v.p, P.time * k, P.max * s, dt);
  return {
    target: { x, y, z }, distance: Math.max(d, CAM.minDist * 0.9), yaw: clamp(yw, base - CAM.maxYaw, base + CAM.maxYaw), pitch: clamp(pt, CAM.minPitch, CAM.maxPitch),
    primary: primary ? jack.id : null, ids, active: true, v: { x: vx, y: vy, z: vz, d: vd, yaw: vyw, p: vpt },
  };
}

// Camera position and look-at point for a framing result
export function cameraFromFrame(f, groundAt) {
  const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch);
  const pos = { x: f.target.x - Math.sin(f.yaw) * cp * f.distance, y: f.target.y - Math.cos(f.yaw) * cp * f.distance, z: f.target.z + sp * f.distance };
  if (groundAt) pos.z = Math.max(pos.z, groundAt(pos.x, pos.y) + CAM.minCamZ);
  return { pos, tgt: f.target };
}

// ---- E11: the casual-observer camera (slow mode) ----
// A spectator standing beside the court (OBS.side metres outside the timbers, eye height OBS.eye) who watches the play
// with slow, eased pans, a slowly drifting zoom, and an occasional walking-pace dolly along the side when the action
// moves far. No cuts: every move is a spring with a speed cap. Pure: the renderer passes the subject and a groundAt().
export const OBS = Object.freeze({
  side: 3.5, // m outside the side timber
  eye: 1.7, // m above the ground
  deadband: 4.5, // m of along-court offset before the spectator walks to keep up (and stops within `settle` of it)
  settle: 1.2,
  dolly: { time: 2.4, max: 1.3 }, // walking pace, m/s
  pan: { time: 1.0, max: 0.3, boost: 0.8 }, // rad/s; boost only when the subject nears the edge of the picture
  zoom: { time: 2.5, max: 0.12 }, // fov multiplier per s
  fill: 0.5, // the subject's angular size as a fraction of the view
  minFovK: 0.75, maxFovK: 1.3,
  edge: 0.6, // fraction of the half-field beyond which the boosted pan cap applies
  walkLead: 3, // m: F39, how far ahead of the walking human the frame reaches
  reducedTime: 2.5, reducedPan: 0.12, // reduced motion: slower pans, no dolly, no zoom
});

// F39: what the observer watches while the human walks to the circle: the walker plus a look-ahead point `lead` m along the
// way (the circle itself once within `lead`), so the pan leads them in and the frame settles on the circle at the end.
// pos/goal: { x, y }. Returns [{x, y}, {x, y}]; `out` (optional, same shape) is filled in place so main can keep one live array.
export function walkSubject(pos, goal, lead = OBS.walkLead, out = null) {
  const dx = goal.x - pos.x, dy = goal.y - pos.y, d = Math.hypot(dx, dy);
  const k = d <= lead || d === 0 ? 1 : lead / d;
  const r = out || [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  r[0].x = pos.x; r[0].y = pos.y;
  r[1].x = pos.x + dx * k; r[1].y = pos.y + dy * k;
  return r;
}

// The camera style, read in one place (E27 hooks a TV camera in here): 'observer' | 'tv' | 'game'.
// `game` is the shoulder/head/flight set of cameras. The human's own turn always uses the shoulder view and quick
// mode keeps the game cameras. `override` is a debug or settings value.
export const CAMERA_STYLES = Object.freeze(['observer', 'tv', 'game', 'broadcast']);
// E27: `tv` is the chosen TV variant ('a' | 'b' | 'c', from ?debug&tvcam or settings.tvcam). Quick mode uses the TV camera
// when a variant is chosen; slow mode keeps the observer unless `override` says 'tv'.
export function cameraStyle({ slow, human = false, override = null, tv = null } = {}) {
  if (override === 'broadcast') return human ? 'game' : 'broadcast'; // F01: the sports-broadcast director, in either mode
  if (human) return 'game';
  if (!slow) return tvVariant(tv) ? 'tv' : 'game';
  return CAMERA_STYLES.includes(override) ? override : 'observer';
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// subject: [{x, y, z?}] points to keep in view. opts: { dt, reduced, aspect, fov (vertical degrees), groundAt(x, y),
// width, length (court size) }. prev: the last result (null to snap). Returns { pos, tgt, yaw, pitch, fovK, side, dollyGoal,
// v } where pos/tgt feed the camera and the rest is state to hand back as `prev`.
export function frameObserver(subject, opts, prev) {
  const W = opts.width || C.terrainW, L = opts.length || C.terrainL;
  const groundAt = opts.groundAt || (() => 0);
  const dt = clamp(opts.dt || 0, 0, 0.1);
  const pts = subject && subject.length ? subject : [{ x: W / 2, y: L / 2 }];
  const bb = bbox(pts.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 })));
  const r = Math.max(...pts.map((p) => Math.hypot(p.x - bb.x, p.y - bb.y))) + 1.4; // a margin: people and boules around the head
  const c = { x: bb.x, y: bb.y, z: groundAt(bb.x, bb.y) + 0.6 };
  const reduced = !!opts.reduced;
  const k = reduced ? OBS.reducedTime / 1 : 1;
  const side = prev ? prev.side : (c.x < W / 2 ? -1 : 1);
  const px = side < 0 ? -OBS.side : W + OBS.side;
  const midY = clamp(c.y, 1, L - 1);
  const snap = !prev;

  // dolly: walk along the side only when the subject strays beyond the deadband, and stop once close again
  let y = prev ? prev.pos.y : midY, dollyGoal = prev ? prev.dollyGoal : null;
  if (!reduced && !snap) {
    const off = Math.abs(c.y - y);
    if (dollyGoal === null && off > OBS.deadband) dollyGoal = midY;
    if (dollyGoal !== null && Math.abs(dollyGoal - y) < OBS.settle) dollyGoal = null;
  }
  const v = prev ? prev.v : { y: 0, yaw: 0, p: 0, z: 0 };
  let vy = v.y;
  if (!snap && dt > 0 && dollyGoal !== null) [y, vy] = damp(y, dollyGoal, v.y, OBS.dolly.time, OBS.dolly.max, dt);
  else vy = 0;
  const pos = { x: px, y, z: groundAt(px, y) + OBS.eye };

  const dx = c.x - pos.x, dy = c.y - pos.y, dh = Math.max(0.5, Math.hypot(dx, dy));
  const dist = Math.hypot(dh, c.z - pos.z);
  const goalYaw = Math.atan2(dx, dy), goalPitch = Math.atan2(c.z - pos.z, dh);
  // zoom so the subject fills about OBS.fill of the view
  const baseFov = (opts.fov || 50) * Math.PI / 180;
  const wantFovK = reduced ? 1 : clamp(2 * Math.atan(r / dist) / (baseFov * OBS.fill), OBS.minFovK, OBS.maxFovK);

  let yaw, pitch, fovK, vyaw = v.yaw, vp = v.p, vz = v.z;
  if (snap) { yaw = goalYaw; pitch = goalPitch; fovK = 1; vyaw = vp = vz = 0; }
  else if (dt <= 0) return { ...prev, active: true };
  else {
    // pan cap: slow, unless the subject is near the edge of the picture
    const vt = Math.tan(baseFov * prev.fovK / 2), ht = vt * (opts.aspect || 1.5);
    const err = Math.abs(wrapAngle(goalYaw - prev.yaw)), halfH = Math.atan(ht);
    const base = reduced ? OBS.reducedPan : OBS.pan.max;
    const cap = !reduced && err > OBS.edge * halfH ? OBS.pan.boost : base;
    [yaw, vyaw] = damp(prev.yaw, prev.yaw + wrapAngle(goalYaw - prev.yaw), v.yaw, OBS.pan.time * k, cap, dt);
    [pitch, vp] = damp(prev.pitch, goalPitch, v.p, OBS.pan.time * k, cap, dt);
    [fovK, vz] = damp(prev.fovK, wantFovK, v.z, OBS.zoom.time, OBS.zoom.max, dt);
  }
  const cp = Math.cos(pitch), look = Math.max(dist, 3);
  const tgt = { x: pos.x + Math.sin(yaw) * cp * look, y: pos.y + Math.cos(yaw) * cp * look, z: pos.z + Math.sin(pitch) * look };
  return { pos, tgt, yaw, pitch, fovK, side, dollyGoal, center: c, v: { y: vy, yaw: vyaw, p: vp, z: vz }, active: true };
}

// ---- F57: the wide court shot after Next ----
// A spectator behind the near end, raised, looking down the court (+y) so the whole court is in the picture and Mount Rainier
// (scenery.js paints it at about 9 degrees of elevation straight down-court) stands in the top of the frame. Pure.
export const WIDE = Object.freeze({
  rainierEl: 9, skyMargin: 3, // degrees: the painted summit and the gap kept above it
  edge: 3.5, // degrees of slack between the near end and the bottom of the picture
  side: 0.4, // m of slack either side of the court
  minBack: 3, maxBack: 60, step: 0.25, // m behind the near end
});

// opts: { width, length, aspect, fov (vertical degrees), groundAt }. Returns { pos, tgt, yaw: 0, pitch (rad, looking down), back, height, topEl }:
// topEl is the elevation (degrees) of the top edge of the picture, always above rainierEl.
export function frameCourtWide(opts = {}) {
  const W = opts.width || C.terrainW, L = opts.length || C.terrainL, groundAt = opts.groundAt || (() => 0);
  const aspect = opts.aspect || 1.5, vf = (opts.fov || 50) * Math.PI / 180, deg = Math.PI / 180;
  const vHalf = vf / 2, hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const pitch = clamp(vHalf - (WIDE.rainierEl + WIDE.skyMargin) * deg, 0.05, 0.6);
  const aNear = pitch + vHalf - WIDE.edge * deg; // the near end's depression below the horizon
  let back = WIDE.minBack;
  while (back < WIDE.maxBack && Math.atan((W / 2 + WIDE.side) / back) > hHalf * 0.92) back += WIDE.step;
  const x = W / 2, y = -back, h = back * Math.tan(aNear);
  const pos = { x, y, z: groundAt(x, y) + h };
  const tgt = { x, y: y + Math.cos(pitch) * 40, z: pos.z - Math.sin(pitch) * 40 };
  return { pos, tgt, yaw: 0, pitch, back, height: h, topEl: (vHalf - pitch) / deg };
}

// Where a world point lands in that picture: { x, y } in [-1, 1] when inside (y up), or null when behind the camera.
export function viewPoint(p, frame, { aspect = 1.5, fov = 50 } = {}) {
  const dx = p.x - frame.pos.x, dy = p.y - frame.pos.y, dz = (p.z || 0) - frame.pos.z;
  const cp = Math.cos(frame.pitch), sp = Math.sin(frame.pitch);
  const fwd = dy * cp - dz * sp, up = dy * sp + dz * cp; // yaw 0: forward is +y, tilted down by pitch
  if (fwd <= 0) return null;
  const t = Math.tan(fov * Math.PI / 360);
  return { x: dx / fwd / (t * aspect), y: up / fwd / t };
}

// ---- E27: TV-presentation cameras for AI turns ----
// (a) a low side shot that tracks the boule in flight (main then cuts to the head view);
// (b) a reverse angle from just behind and beside the jack, watching the boule arrive;
// (c) a slow crane that rises over the head as the boule settles.
// Cuts are fine (the renderer cuts in and out), moves inside a shot are damped. Reduced motion: no tracking spring speed,
// no crane (a fixed medium elevation). `hold` is how long after the boule rests the renderer keeps the shot before the
// next camera request is honoured.
export const TV_VARIANTS = Object.freeze(['a', 'b', 'c']);
export const TV = Object.freeze({
  minZ: 0.35, // m above the ground
  sideOff: 1.3, // (a) m outside the side timber
  lowZ: 0.5, // (a) camera height above the ground
  behind: 2.4, beside: 1.0, eyeZ: 0.7, // (b) behind the jack (away from the throw), beside it, eye height
  azimuth: 0.55, // (c) rad round from straight sideways toward the thrower
  craneTime: 5, craneFrom: 0.12, craneTo: 1.0, // (c) elevation rad, and the seconds to rise
  craneReduced: 0.5,
  hold: { a: 0, b: 1.4, c: 2.2 },
  pos: { time: 0.5, fast: 0.25, max: 14 }, tgt: { time: 0.35, fast: 0.12, max: 20 }, // damping; `fast` while tracking in (a)
  reducedTime: 1.6, reducedSpeed: 0.4,
});
export const tvVariant = (v) => { const k = String(v == null ? '' : v).toLowerCase(); return TV_VARIANTS.includes(k) ? k : null; };

// Goal camera for a shot. s: { body (thrown), jack, dir, groundAt, aspect, fov, width, reduced }. st: { variant, side, anchor, t, restT }.
// Returns { pos, tgt }. Pure and un-damped (tested directly).
export function tvGoal(st, s) {
  const W = s.width || C.terrainW, dir = (s.dir || 1) < 0 ? -1 : 1, g = s.groundAt || (() => 0);
  const body = s.body, jack = s.jack && s.jack !== body ? s.jack : null;
  const bp = { x: body.x, y: body.y, z: Math.max(0, (body.z || 0) - (body.r || 0)) };
  const hp = jack ? { x: jack.x, y: jack.y, z: 0.05 } : bp;
  let variant = st.variant;
  if (!jack) variant = 'a'; // a jack throw has no head to watch yet
  let pos, tgt;
  if (variant === 'a') {
    const sx = st.side > 0 ? W + TV.sideOff : -TV.sideOff;
    pos = { x: sx, y: bp.y + dir * 0.6, z: g(sx, bp.y) + TV.lowZ };
    tgt = { x: bp.x, y: bp.y + dir * 1.0, z: Math.max(0.1, bp.z * 0.6) };
  } else if (variant === 'b') {
    const a = st.anchor || hp, inside = a.x < W / 2 ? 1 : -1;
    const px = a.x + inside * TV.beside, py = a.y + dir * TV.behind;
    pos = { x: px, y: py, z: g(px, py) + TV.eyeZ };
    tgt = { x: (bp.x + hp.x) / 2, y: (bp.y + hp.y) / 2, z: Math.max(0.1, bp.z * 0.3) };
  } else { // 'c'
    const vTan = Math.tan((s.fov || 50) * Math.PI / 360), hTan = vTan * (s.aspect || 1.5);
    const pts = [bp, hp];
    const c = bbox(pts);
    const k = s.reduced ? 0 : clamp(st.t / TV.craneTime, 0, 1), e = k * k * (3 - 2 * k);
    const el = s.reduced ? TV.craneReduced : TV.craneFrom + (TV.craneTo - TV.craneFrom) * e;
    const ux = st.side * Math.cos(TV.azimuth), uy = -dir * Math.sin(TV.azimuth); // horizontal, from the target to the camera
    const yaw = Math.atan2(-ux, -uy);
    tgt = { x: c.x, y: c.y, z: 0.15 };
    const dist = clamp(fitDistance(pts, tgt, yaw, el, hTan, vTan), CAM.minDist, CAM.maxDist);
    pos = { x: tgt.x + ux * Math.cos(el) * dist, y: tgt.y + uy * Math.cos(el) * dist, z: g(tgt.x, tgt.y) + tgt.z + Math.sin(el) * dist };
    pos.z = Math.max(pos.z, g(pos.x, pos.y) + TV.minZ);
    return { pos, tgt };
  }
  pos.z = Math.max(pos.z, g(pos.x, pos.y) + TV.minZ);
  return { pos, tgt };
}

// One frame of a TV shot. prev: the last result (null starts a new shot: a cut). dt 0 holds the frame (pause).
// Returns { pos, tgt, variant, side, anchor, t, restT, v } to hand back as `prev`.
export function frameTV(variant, s, prev) {
  const dt = clamp(s.dt || 0, 0, 0.1);
  const W = s.width || C.terrainW;
  const body = s.body;
  if (!body) return prev || null;
  const jack = s.jack && s.jack !== body ? s.jack : null;
  const v0 = tvVariant(variant) || 'a';
  if (prev && dt <= 0) return prev;
  const st = prev ? { ...prev } : {
    variant: v0, side: body.x < W / 2 ? 1 : -1, anchor: jack ? { x: jack.x, y: jack.y } : null, t: 0, restT: 0,
  };
  st.t += dt;
  if (body.state === 'resting') st.restT += dt;
  const goal = tvGoal(st, s);
  if (!prev) return { ...st, pos: goal.pos, tgt: goal.tgt, v: { p: [0, 0, 0], t: [0, 0, 0] } };
  const tracking = st.variant === 'a' || !jack;
  const k = s.reduced ? TV.reducedTime : 1, sp = s.reduced ? TV.reducedSpeed : 1;
  const pt = (tracking ? TV.pos.fast : TV.pos.time) * k, tt = (tracking ? TV.tgt.fast : TV.tgt.time) * k;
  const ax = ['x', 'y', 'z'], pos = {}, tgt = {}, vp = [], vt = [];
  ax.forEach((a, i) => {
    [pos[a], vp[i]] = damp(prev.pos[a], goal.pos[a], prev.v.p[i], pt, TV.pos.max * sp, dt);
    [tgt[a], vt[i]] = damp(prev.tgt[a], goal.tgt[a], prev.v.t[i], tt, TV.tgt.max * sp, dt);
  });
  if (s.groundAt) pos.z = Math.max(pos.z, s.groundAt(pos.x, pos.y) + TV.minZ);
  return { ...st, pos, tgt, v: { p: vp, t: vt } };
}

// ---- F01: sports-broadcast shots ----
// Person shots (prep, throw, reaction) stand in front of the subject, round toward the court (the way they face), and look at
// the upper body; the flight shot sits beyond the cochonnet (away from the thrower) and looks back at it, panning to bring the
// boule into view as it comes in. Cuts between shots are the director's; moves inside a shot are damped. Pure.
export const BC = Object.freeze({
  prep: { dist: 3.0, to: 2.5, push: 4, az: 0.6, camZ: 1.35, lookZ: 1.0 }, // waist-up to full body, a slow push-in
  throw: { dist: 4.0, to: 4.0, push: 1, az: 0.9, camZ: 1.1, lookZ: 0.9, lead: 0.3 }, // fuller, more side-on to see the swing
  reaction: { dist: 2.4, to: 2.4, push: 1, az: 0.35, camZ: 1.45, lookZ: 1.25 },
  flight: { behind: 3.4, beside: 1.3, camZ: 1.2, lookZ: 0.12, pullIn: 8, near: 3 }, // m: the boule this near the jack takes the aim
  minZ: 0.35, halfW: 0.7, // camera floor above the ground; half-width of a person to keep in frame
  person: { pos: { time: 0.6, max: 3 }, tgt: { time: 0.4, max: 4 } },
  fl: { pos: { time: 0.9, max: 3 }, tgt: { time: 0.5, max: 7 } },
  reducedTime: 3, reducedSpeed: 0.4, // reduced motion: slow moves, no fast pans, no push-in
});
export const BROADCAST_SHOTS = Object.freeze(['prep', 'throw', 'reaction', 'flight']);

// Goal camera for a shot (un-damped). s: { subject:{x,y} (person shots), face (yaw they face), body, jack, dir, groundAt, aspect, fov,
// reduced }. st: { t, side, anchor }. Returns { pos, tgt }.
export function broadcastGoal(kind, st, s) {
  const g = s.groundAt || (() => 0), dir = (s.dir || 1) < 0 ? -1 : 1, W = s.width || C.terrainW;
  const vTan = Math.tan((s.fov || 50) * Math.PI / 360), hTan = vTan * (s.aspect || 1.5);
  let pos, tgt;
  if (kind === 'flight') {
    const F = BC.flight, a = st.anchor || s.jack || s.body;
    const inside = a.x < W / 2 ? 1 : -1;
    const px = a.x + inside * F.beside, py = a.y + dir * F.behind;
    pos = { x: px, y: py, z: g(px, py) + F.camZ };
    const jk = s.jack || a, b = s.body && s.body !== s.jack ? s.body : null;
    const d = b ? Math.hypot(b.x - jk.x, b.y - jk.y) : 99;
    const w = clamp((F.pullIn - d) / (F.pullIn - F.near), 0, 1), e = w * w * (3 - 2 * w);
    const bz = b ? Math.max(0, (b.z || 0) - (b.r || 0)) : 0;
    tgt = { x: jk.x + (b ? (b.x - jk.x) * e : 0), y: jk.y + (b ? (b.y - jk.y) * e : 0), z: g(jk.x, jk.y) + F.lookZ + bz * e * 0.8 };
  } else {
    const P = BC[kind] || BC.prep, sub = s.subject || { x: C.terrainW / 2, y: C.terrainL / 2 };
    const face = s.face !== undefined ? s.face : dir < 0 ? Math.PI : 0;
    const side = st.side || 1;
    const k = s.reduced ? 0 : clamp(st.t / P.push, 0, 1), e = k * k * (3 - 2 * k);
    let dist = s.reduced ? P.to : P.dist + (P.to - P.dist) * e;
    dist = Math.max(dist, (BC.halfW / hTan) * 1.05, 1.15 * Math.max(P.lookZ, 1.85 - P.lookZ) / vTan); // the whole person fits, narrow screens too
    const ang = face + side * P.az, gz = g(sub.x, sub.y);
    const lead = P.lead || 0;
    tgt = { x: sub.x + Math.sin(face) * lead, y: sub.y + Math.cos(face) * lead, z: gz + P.lookZ };
    const px = sub.x + Math.sin(ang) * dist, py = sub.y + Math.cos(ang) * dist;
    pos = { x: px, y: py, z: gz + P.camZ };
  }
  pos.z = Math.max(pos.z, g(pos.x, pos.y) + BC.minZ);
  return { pos, tgt };
}

// One frame of a broadcast shot. prev: the last result (null starts the shot: a cut). dt 0 holds the frame (pause).
export function frameBroadcast(kind, s, prev) {
  const dt = clamp(s.dt || 0, 0, 0.1), W = s.width || C.terrainW;
  if (prev && dt <= 0) return prev;
  const ref = kind === 'flight' ? (s.jack || s.body) : s.subject;
  if (!ref) return prev || null;
  const st = prev ? { ...prev } : { kind, t: 0, side: ref.x < W / 2 ? 1 : -1, anchor: kind === 'flight' ? { x: ref.x, y: ref.y } : null };
  st.t += dt;
  const goal = broadcastGoal(kind, st, s);
  if (!prev) return { ...st, pos: goal.pos, tgt: goal.tgt, v: { p: [0, 0, 0], t: [0, 0, 0] } };
  const T = kind === 'flight' ? BC.fl : BC.person, k = s.reduced ? BC.reducedTime : 1, sp = s.reduced ? BC.reducedSpeed : 1;
  const pos = {}, tgt = {}, vp = [], vt = [];
  ['x', 'y', 'z'].forEach((a, i) => {
    [pos[a], vp[i]] = damp(prev.pos[a], goal.pos[a], prev.v.p[i], T.pos.time * k, T.pos.max * sp, dt);
    [tgt[a], vt[i]] = damp(prev.tgt[a], goal.tgt[a], prev.v.t[i], T.tgt.time * k, T.tgt.max * sp, dt);
  });
  if (s.groundAt) pos.z = Math.max(pos.z, s.groundAt(pos.x, pos.y) + BC.minZ);
  return { ...st, pos, tgt, v: { p: vp, t: vt } };
}

// F48: the shoulder camera's "Adjust view" pan. yaw orbits the thrower (+ = looks right), pitch tilts (+ = looks down
// from higher up, - = looks level from lower). The allowed region is a rectangle: yaw within +-180 deg of the aim and
// pitch within +-15 deg. Everything that moves the offset goes through clampViewOffset (no wrap-around), so the held
// icon, the arrow keys and the debug flags can never leave it.
export const VIEW_PAN = Object.freeze({
  maxYaw: Math.PI, maxPitch: (15 * Math.PI) / 180,
  yawRate: (70 * Math.PI) / 180, pitchRate: (25 * Math.PI) / 180, // rad/s while a direction is held
});
export function clampViewOffset(yaw, pitch, lim = VIEW_PAN) {
  const y = Number.isFinite(yaw) ? yaw : 0, p = Number.isFinite(pitch) ? pitch : 0;
  return { yaw: clamp(y, -lim.maxYaw, lim.maxYaw), pitch: clamp(p, -lim.maxPitch, lim.maxPitch) };
}
// One pan step: dirX (+1 right, -1 left) and dirY (+1 down, -1 up; each clamped to -1..1) held for dt seconds.
export function panViewOffset(view, dirX, dirY, dt, lim = VIEW_PAN) {
  const dx = clamp(dirX || 0, -1, 1), dy = clamp(dirY || 0, -1, 1), t = clamp(dt || 0, 0, 0.25);
  return clampViewOffset(view.yaw + dx * lim.yawRate * t, view.pitch + dy * lim.pitchRate * t, lim);
}

// ---- F62: the outcome (scoring) view fits ring + badges + labels into the free viewport rectangle ----
export const SCORING_FIT = Object.freeze({
  fill: 0.76,      // the content's box fills this share of the free rectangle (the larger of its two ratios)
  margin: 10,      // px kept clear on every side of the free rectangle
  tallCard: 0.22,  // a card taller than this share of the viewport lifts the centre
  lift: 0.06,      // share of the free height the centre is lifted by on a tall card
});

// The free rectangle {l,t,r,b} of a W x H viewport. bars: wide HUD rects at the top (score board); card: the result card
// rect at the bottom (or null); icons: small controls hugging the right edge (hamburger column, bottom-right buttons). All rects {l,t,r,b}.
export function freeViewRect({ W, H, bars = [], card = null, icons = [], gap = 8 } = {}) {
  const f = { l: 0, t: 0, r: W, b: H };
  for (const q of bars) if (q.b > q.t && q.t < H * 0.4 && q.r - q.l > W * 0.3) f.t = Math.max(f.t, q.b + gap);
  if (card) f.b = Math.min(f.b, card.t - gap);
  f.b = Math.max(f.b, f.t + Math.min(60, H * 0.3));
  for (const q of icons) {
    if (q.r <= q.l || q.b <= q.t || q.l < W * 0.6) continue; // only the right-hand cluster
    if (q.b <= f.t || q.t >= f.b) continue;                  // outside the free band
    if (q.t > f.t + (f.b - f.t) * 0.7) f.b = Math.max(f.t + 40, Math.min(f.b, q.t - gap)); // a low control: shorten, not narrow
    else f.r = Math.min(f.r, q.l - gap);
  }
  f.r = Math.max(f.r, f.l + Math.min(80, W * 0.3));
  return f;
}

// The pixel box the content's bounding box should land in: centred in `free` (lifted a little when the card is tall),
// sized so the content fills `fill` of the free rectangle (the limiting dimension). aspect = content width / height.
// Returns { l, t, r, b }.
export function scoringTargetBox(free, aspect, { cardH = 0, H = 1, fill = SCORING_FIT.fill, margin = SCORING_FIT.margin } = {}) {
  const fw = Math.max(1, free.r - free.l - 2 * margin), fh = Math.max(1, free.b - free.t - 2 * margin);
  const a = Math.max(0.05, aspect || 1);
  let w = fw * fill, h = w / a;
  if (h > fh * fill) { h = fh * fill; w = h * a; }
  const lift = cardH > H * SCORING_FIT.tallCard ? SCORING_FIT.lift * fh : 0;
  const cx = (free.l + free.r) / 2, cy = (free.t + free.b) / 2 - lift;
  return { l: cx - w / 2, t: cy - h / 2, r: cx + w / 2, b: cy + h / 2 };
}

// Pure fit for a top-down view (+y up the screen): world points -> { scale px/m, box, centre, screen }: with `scale` pixels per metre
// the points' bounding box lands in `box` (scoringTargetBox), its world centre `centre` shown at pixel `screen`.
export function fitScoringView(pts, free, opts = {}) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const bw = Math.max(1e-6, x1 - x0), bh = Math.max(1e-6, y1 - y0);
  const box = scoringTargetBox(free, bw / bh, opts);
  const scale = Math.min((box.r - box.l) / bw, (box.b - box.t) / bh);
  const sx = (box.l + box.r) / 2, sy = (box.t + box.b) / 2, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return { scale, box, centre: { x: mx, y: my }, screen: { x: sx, y: sy } };
}
