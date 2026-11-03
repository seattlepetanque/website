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
