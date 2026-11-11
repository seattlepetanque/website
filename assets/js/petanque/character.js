// Stick-figure player: procedural skeleton, poses and animations drawn with capsules.
// World is z-up, metres. The character faces +y at yaw 0; positive yaw turns toward +x.
// The pose math below is pure (no three.js) so it can be tested in Node.
import { C } from './constants.js';
import { jackStyle } from './terrain.js';

const { sin, cos, sqrt, atan2, min, max, abs, PI } = Math;
const BLEND = 0.25; // s, stance-to-stance blend
const WALK_SPEED = 1.2; // m/s
const TURN_RATE = 4; // rad/s

// ---------- small vector helpers (arrays [x, y, z]) ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => sqrt(dot(a, a));
const norm = (a) => mul(a, 1 / (len(a) || 1));
const clamp = (v, lo, hi) => max(lo, min(hi, v));
const lerp = (a, b, k) => a + (b - a) * k;
// lean about the right axis: positive tips "up" toward +y
const lean = (v, a) => [v[0], v[1] * cos(a) + v[2] * sin(a), -v[1] * sin(a) + v[2] * cos(a)];
// turn about up: positive turns forward (+y) toward +x
const twist = (v, a) => [v[0] * cos(a) + v[1] * sin(a), -v[0] * sin(a) + v[1] * cos(a), v[2]];

export const ease = (t) => { const k = clamp(t, 0, 1); return k * k * (3 - 2 * k); };

// ---------- proportions (fractions of height) ----------
export function boneLengths(H = 1.75) {
  return {
    hipHalf: 0.055 * H, spine: 0.1 * H, chest: 0.17 * H,
    shoulderHalf: 0.115 * H, shoulderUp: 0.02 * H, neck: 0.03 * H, neckBase: 0.05 * H, head: 0.1 * H,
    upperArm: 0.186 * H, forearm: 0.146 * H, hand: 0.05 * H,
    thigh: 0.245 * H, shin: 0.246 * H, ankleH: 0.04 * H, foot: 0.115 * H, heel: 0.03 * H, // toe 0.115 H ahead of the ankle, heel 0.03 H behind: 0.145 H in all
  };
}

// [from joint, to joint, length key] for tests and drawing
export const BONES = [
  ['pelvis', 'spine', 'spine'], ['spine', 'chest', 'chest'],
  ['chest', 'neck', 'neckBase'], ['neck', 'head', 'head'],
  ['pelvis', 'hipL', 'hipHalf'], ['pelvis', 'hipR', 'hipHalf'],
  ['hipL', 'kneeL', 'thigh'], ['hipR', 'kneeR', 'thigh'],
  ['kneeL', 'ankleL', 'shin'], ['kneeR', 'ankleR', 'shin'],
  ['shoulderL', 'elbowL', 'upperArm'], ['shoulderR', 'elbowR', 'upperArm'],
  ['elbowL', 'wristL', 'forearm'], ['elbowR', 'wristR', 'forearm'],
  ['wristL', 'handL', 'hand'], ['wristR', 'handR', 'hand'],
];

// ---------- poses ----------
// Positions are fractions of height. Arms: p = swing forward from hanging, ab = out to the side;
// (p2, ab2) is the forearm's own direction. Feet: ground position, lift z and yaw.
export function basePose() {
  return {
    px: 0, py: 0, ry: 0, pz: 0.515, hop: 0, pitch: 0, twist: 0, spine: 0, spineTwist: 0,
    neck: 0, headYaw: 0, headPitch: 0,
    rollL: 0, rollR: 0, // hand roll about the forearm (E16): 0 palm up, PI palm down, via the inside of the wrist
    armL: { p: 0.05, ab: 0.1, p2: 0.2, ab2: 0.1 }, armR: { p: 0.05, ab: 0.1, p2: 0.2, ab2: 0.1 },
    footL: { x: -0.085, y: 0, z: 0, yaw: -0.15 }, footR: { x: 0.085, y: 0, z: 0, yaw: 0.15 },
  };
}

// Root offset (fraction of height) that centres both feet's footprint (heel 0.03 behind the ankle, toe 0.115
// ahead) on the root, so a thrower standing at the circle's centre has the feet inside it, crouched or standing.
export function footprintShift(p) {
  let lo = Infinity, hi = -Infinity;
  for (const f of [p.footL, p.footR]) {
    const c = cos(f.yaw);
    lo = min(lo, f.y - 0.03 * c); hi = max(hi, f.y + 0.115 * c);
  }
  return (lo + hi) / 2;
}

export function clonePose(p) { return JSON.parse(JSON.stringify(p)); }

// ---------- handedness ----------
// Every pose is authored for a right-hander. A left-hander's pose is its mirror image across the body's sagittal plane
// (headYaw and neck stay: they are look-at angles). armSwap only swaps the arms (walking, bending: the legs are symmetric).
// 'handKey' names the dominant hand's joint; E16 (three boules) can use `offKey` for the other hand.
export const handKey = (hand) => (hand === 'left' ? 'L' : 'R');
export const offKey = (hand) => (hand === 'left' ? 'R' : 'L');
export function armSwap(p) { const a = p.armL; p.armL = p.armR; p.armR = a; const r = p.rollL; p.rollL = p.rollR; p.rollR = r; return p; }
export function mirrorPose(p) {
  armSwap(p);
  const fl = p.footL; p.footL = { ...p.footR, x: -p.footR.x, yaw: -p.footR.yaw }; p.footR = { ...fl, x: -fl.x, yaw: -fl.yaw };
  p.px = -p.px; p.twist = -p.twist; p.spineTwist = -p.spineTwist;
  return p;
}

// Blend two poses of the same shape; t is eased here
export function blendPoses(a, b, t) {
  const k = ease(t);
  const rec = (x, y) => {
    if (typeof x === 'number') return lerp(x, y, k);
    const o = {};
    for (const key of Object.keys(x)) o[key] = rec(x[key], y[key]);
    return o;
  };
  return rec(a, b);
}

const arm = (p, ab, flex) => ({ p, ab, p2: p + flex, ab2: ab });
const armDir = (p, ab, side) => [side * sin(ab), sin(p) * cos(ab), -cos(p) * cos(ab)];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------- hand orientation (E16) ----------
// The hand is a flat palm. Roll 0: palm up (normal n0: up when the forearm points forward, forward when it hangs); the roll turns it about the forearm
// through the inside of the wrist (toward the body's midline), so roll PI is palm down. A held boule rests on the
// palm side, BALL_D off the palm. The palm is always drawn BALL_D behind the boule (ball - n * BALL_D), and the boule
// rides halfway between the two palm-up positions: on the hand joint at roll PI, so a palm-down release leaves exactly
// where the hand joint is (the point the throws were tuned to); BALL_D above it at roll 0. `solved` is solveSkeleton(pose);
// key is 'L' or 'R'.
export const BALL_D = 0.04;
export function handBasis(pose, solved, key) {
  const s = key === 'L' ? -1 : 1, a = key === 'L' ? pose.armL : pose.armR, roll = (key === 'L' ? pose.rollL : pose.rollR) || 0;
  const d = armDir(a.p2, a.ab2, s);
  const n0 = norm([0, -d[2], d[1]]); // the forearm turned a quarter in its swing plane: up when it points forward, forward when it hangs
  let b = norm(cross(d, n0));
  if (b[0] * -s < 0) b = mul(b, -1); // toward the inside
  const n = add(mul(n0, cos(roll)), mul(b, sin(roll)));
  const lat = add(mul(n0, -sin(roll)), mul(b, cos(roll))); // across the palm, toward the inside at roll 0
  const [ex, ey, ez] = solved.frames.chest;
  const F = (v) => add(add(mul(ex, v[0]), mul(ey, v[1])), mul(ez, v[2]));
  return { d: F(d), n: F(n), n0: F(n0), lat: F(lat) };
}
// Centre of a boule held in that hand, given the hand's position
export function heldBallAt(pose, solved, key, handPos) {
  const b = handBasis(pose, solved, key);
  return add(handPos, mul(add(b.n, b.n0), BALL_D / 2));
}

// Forward kinematics plus two-bone leg IK. Returns joint positions in root space (feet near z = 0).
export function solveSkeleton(pose, H = 1.75) {
  const L = boneLengths(H);
  const hop = pose.hop * H;
  const Fp = (v) => twist(lean(v, pose.pitch), pose.twist);
  const Fc = (v) => Fp(twist(lean(v, pose.spine), pose.spineTwist));
  const Fh = (v) => Fc(twist(lean(v, pose.neck + pose.headPitch), pose.headYaw));
  const ph = [pose.px * H, pose.py * H, pose.pz * H + hop];

  const feet = [pose.footL, pose.footR].map((f) => ({
    ankle: [f.x * H, f.y * H, f.z * H + L.ankleH], yaw: f.yaw,
  }));
  // lower the pelvis if a foot would be out of reach, so feet stay planted
  const reach = (L.thigh + L.shin) * 0.998;
  for (let i = 0; i < 8; i++) {
    let worst = 0;
    [-1, 1].forEach((s, j) => {
      const hip = add(ph, Fp([s * L.hipHalf, 0, 0]));
      const d = sub(feet[j].ankle, hip);
      const ex = len(d) - reach;
      if (ex > 0) worst = max(worst, ex / max(0.3, abs(d[2]) / len(d)));
    });
    if (worst <= 0) break;
    ph[2] -= worst;
  }
  // hop lifts the feet with the body
  const j = { pelvis: ph };
  const sides = [['L', -1], ['R', 1]];
  sides.forEach(([n, s], i) => {
    const hip = add(ph, Fp([s * L.hipHalf, 0, 0]));
    const ankleT = feet[i].ankle;
    let d = sub(ankleT, hip);
    let D = clamp(len(d), abs(L.thigh - L.shin) + 1e-4, L.thigh + L.shin - 1e-4);
    const u = norm(d);
    const along = (L.thigh * L.thigh - L.shin * L.shin + D * D) / (2 * D);
    const h = sqrt(max(0, L.thigh * L.thigh - along * along));
    const pole0 = twist([0, 1, 0], feet[i].yaw);
    const pole = norm(sub(pole0, mul(u, dot(pole0, u))));
    const ankle = add(hip, mul(u, D));
    j['hip' + n] = hip;
    j['knee' + n] = add(hip, add(mul(u, along), mul(pole, h)));
    j['ankle' + n] = ankle;
    j['foot' + n] = add(ankle, [...twist([0, L.foot, 0], feet[i].yaw).slice(0, 2), -L.ankleH]);
  });
  j.spine = add(ph, Fp([0, 0, L.spine]));
  j.chest = add(j.spine, Fc([0, 0, L.chest]));
  j.neck = add(j.chest, Fc([0, 0, L.shoulderUp + L.neck]));
  j.head = add(j.neck, Fh([0, 0, L.head]));
  sides.forEach(([n, s]) => {
    const a = n === 'L' ? pose.armL : pose.armR;
    j['shoulder' + n] = add(j.chest, Fc([s * L.shoulderHalf, 0, L.shoulderUp]));
    j['elbow' + n] = add(j['shoulder' + n], mul(Fc(armDir(a.p, a.ab, s)), L.upperArm));
    const fd = Fc(armDir(a.p2, a.ab2, s));
    j['wrist' + n] = add(j['elbow' + n], mul(fd, L.forearm));
    j['hand' + n] = add(j['wrist' + n], mul(fd, L.hand));
  });
  // frames for drawing
  const frames = {
    chest: [Fc([1, 0, 0]), Fc([0, 1, 0]), Fc([0, 0, 1])],
    head: [Fh([1, 0, 0]), Fh([0, 1, 0]), Fh([0, 0, 1])],
  };
  // keep the feet's footprint centred on the root (pose.ry, set by stancePose / walkPose)
  const ry = (pose.ry || 0) * H;
  if (ry) for (const k of Object.keys(j)) j[k] = [j[k][0], j[k][1] - ry, j[k][2]];
  return { joints: j, frames };
}

// ---------- stance poses (pure functions of time) ----------
export function stancePose(stance, t, ctx = {}) {
  const p = basePose();
  const look = ctx.look;
  switch (stance) {
    case 'aim':
      p.footL.y = 0.05; p.footR.y = -0.03; p.footL.x = -0.08; p.footR.x = 0.095;
      p.pz = 0.505; p.pitch = 0.05; p.spine = 0.05; p.twist = 0.06;
      p.neck = -0.05;
      p.armR = arm(0.2, 0.12, 1.15); p.armL = arm(0.12, 0.2, 0.3);
      p.px = 0.005 * sin(t * 1.3);
      break;
    case 'crouch': // pointer's squat: deep knees, heels together, torso forward
      p.pz = 0.285; p.py = -0.085; p.pitch = 0.5; p.spine = 0.3; p.neck = -0.7;
      p.footL = { x: -0.04, y: 0, z: 0, yaw: -0.6 }; p.footR = { x: 0.04, y: 0, z: 0, yaw: 0.6 };
      p.armL = { p: 0.65, ab: 0.35, p2: 0.75, ab2: 0.2 };
      p.armR = arm(0.55, 0.1, 0.9);
      p.pitch += 0.015 * sin(t * 1.7); p.px = 0.004 * sin(t * 0.6);
      break;
    case 'stand': // shooter: upright, slight forward lean, one foot ahead
      p.pz = 0.505; p.pitch = 0.06; p.spine = 0.1; p.neck = -0.12;
      p.footL = { x: -0.06, y: 0.03, z: 0, yaw: -0.15 }; p.footR = { x: 0.07, y: -0.025, z: 0, yaw: 0.2 }; // narrow enough for the 0.5 m circle
      p.twist = 0.08;
      p.armR = arm(0.3, 0.1, 1.2); p.armL = arm(0.15, 0.55, 0.3);
      p.px = 0.004 * sin(t * 0.9);
      break;
    case 'watch': {
      p.pitch = 0.02;
      p.armL = arm(0.1, 0.12, 0.35); p.armR = arm(0.1, 0.12, 0.35);
      p.px = 0.006 * sin(t * 0.7);
      if (look) { p.headYaw = clamp(look.yaw, -1.3, 1.3); p.neck = clamp(look.pitch, -0.8, 0.6); }
      break;
    }
    case 'give': // right hand held out at chest height towards a partner (handing a ball over)
      p.pitch = 0.02; p.armR = { p: 1.15, ab: 0.12, p2: 1.3, ab2: 0.12 }; p.armL = arm(0.1, 0.12, 0.35);
      if (look) { p.headYaw = clamp(look.yaw, -1.3, 1.3); p.neck = clamp(look.pitch, -0.8, 0.6); }
      break;
    case 'celebrate': {
      const react = ctx.react;
      if (react === 'proud' || react === 'clap') { reactionPose(p, 'celebrate', react, t); break; }
      const w = sin(t * 9);
      const hop = max(0, sin(t * 7)) * (react === 'jump' ? 0.075 : 0.045);
      p.hop = hop; p.pz = 0.505; p.pitch = -0.04; p.spine = -0.08; p.neck = -0.15;
      p.headYaw = 0.15 * sin(t * 3);
      p.armL = { p: 2.85 + 0.12 * w, ab: 0.5, p2: 3.0 + 0.1 * w, ab2: 0.45 };
      p.armR = { p: 2.85 - 0.12 * w, ab: 0.5, p2: 3.0 - 0.1 * w, ab2: 0.45 };
      p.footL.z = hop * 0.9; p.footR.z = hop * 0.9;
      break;
    }
    case 'dismay': // hands on head, slow shake, shoulders hunched forward
      if (ctx.react && ctx.react !== 'head') { reactionPose(p, 'dismay', ctx.react, t); break; }
      p.pz = 0.505; p.pitch = 0.1; p.spine = 0.14; p.neck = 0.25;
      p.headYaw = 0.3 * sin(t * 2.6) * 0.6;
      p.armL = { p: 2.8, ab: 0.9, p2: 3.8, ab2: -1.4 };
      p.armR = { p: 2.8, ab: 0.9, p2: 3.8, ab2: -1.4 };
      p.footL.x = -0.095; p.footR.x = 0.095;
      break;
    default: { // idle: breathing, slow weight shift, small head turns
      const b = sin(t * 1.9);
      p.spine = 0.012 + 0.014 * b; p.pitch = 0.01 * b;
      p.px = 0.014 * sin(t * 0.45); p.pz = 0.52 - 0.004 * abs(sin(t * 0.45));
      p.twist = 0.02 * sin(t * 0.45);
      p.headYaw = 0.35 * sin(t * 0.37) * (0.5 + 0.5 * sin(t * 0.13));
      p.neck = 0.03 * sin(t * 0.29);
      p.armL.p = 0.05 + 0.01 * b; p.armR.p = 0.05 + 0.01 * b;
    }
  }
  const standing = stance === 'watch' || stance === 'idle';
  if (standing) {
    microMotion(p, t, ctx, stance);
    if (ctx.hold) holdArms(p, t, ctx);
  }
  p.ry = footprintShift(p);
  if (standing && (ctx.quirks || ctx.forceQuirk)) return withQuirk(p, t, ctx);
  return p;
}

// ---------- F20: layered micro-motion, relaxed holds, idle gestures (pure) ----------
const hash = (a, b = 0) => { const x = sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
// Breathing, a slow weight shift, small head movements and an occasional small step, all added to a watch/idle pose.
// ctx.offset desynchronises characters; ctx.reduced scales it down (and drops the step).
function microMotion(p, t, ctx, stance) {
  const o = ctx.offset || 0, k = ctx.reduced ? 0.4 : 1;
  const b = sin(t * 1.9 + o);
  p.spine += 0.012 * b * k; p.pitch += 0.007 * b * k;
  const ws = 0.6 * sin(t * 0.31 + o) + 0.4 * sin(t * 0.53 + o * 2);
  p.px += 0.007 * ws * k; p.twist += 0.014 * ws * k; p.pz -= 0.003 * abs(ws) * k;
  p.neck += 0.025 * sin(t * 0.9 + o) * k;
  if (stance === 'watch') p.headYaw += (ctx.look ? 0.04 * sin(t * 1.3 + o * 3) : 0.3 * sin(t * 0.37 + o) * (0.5 + 0.5 * sin(t * 0.13 + o))) * k;
  if (ctx.steps && !ctx.reduced) { // (ctx.steps: real characters only, so pose tests stay grounded) a small shuffle every STEP seconds: one foot lifts, shifts a little and lands back
    const tt = t + o * 2.7, i = Math.floor(tt / STEP), s = (tt - i * STEP - 2 - hash(i, o) * 8) / 0.9;
    if (s >= 0 && s < 1) {
      const f = i % 2 ? p.footL : p.footR;
      f.x += (i % 2 ? -1 : 1) * 0.035 * (hash(i, o + 1) - 0.3) * sin(PI * s); f.y += 0.03 * (hash(i, o + 2) - 0.5) * sin(PI * s);
      f.z += 0.02 * sin(PI * s);
    }
  }
}
const STEP = 17;

// Relaxed holds while standing about. Styles: 'sides' arms hanging, boules cupped at the hips; 'akimbo' empty hands on the hips;
// 'fold' arms loosely folded; 'fidget' hanging arms that never quite settle.
const SIDE_ARM = { p: 0.1, ab: 0.1, p2: 0.8, ab2: -0.12 };
const FOLD = { L: { p: 0.5, ab: 0.1, p2: 1.75, ab2: -1.0 }, R: { p: 0.55, ab: 0.1, p2: 1.5, ab2: -1.0 } };
const HANG = { p: 0.06, ab: 0.12, p2: 0.3, ab2: 0.12 };
export function holdArm(style, held, t, side, o = 0) {
  const ph = side === 'L' ? 0 : 1.7;
  if (style === 'akimbo') return held ? { ...SIDE_ARM } : { ...HIPS.armL };
  if (style === 'fold') return { ...FOLD[side] };
  if (style === 'fidget') {
    const a = held ? { ...SIDE_ARM } : { ...HANG };
    a.p += 0.07 * sin(t * 2.3 + ph + o); a.p2 += 0.2 * sin(t * 3.1 + ph * 2 + o); a.ab2 += 0.1 * sin(t * 2.1 + ph);
    return a;
  }
  return held ? { ...SIDE_ARM, p2: SIDE_ARM.p2 + 0.03 * sin(t * 1.3 + ph + o) } : { ...HANG };
}
const HOLD_SLOT = 13;
export function holdArmsAt(styles, held, t, side, o = 0) {
  const list = styles && styles.length ? styles : ['sides'];
  const tt = t + o * 3, i = Math.floor(tt / HOLD_SLOT), pick = (n) => list[Math.floor(hash(n, o + 5) * list.length)];
  const cur = holdArm(pick(i), held, t, side, o);
  const w = (tt - i * HOLD_SLOT) / 1.2;
  return w >= 1 ? cur : blendPoses(holdArm(pick(i - 1), held, t, side, o), cur, w);
}
function holdArms(p, t, ctx) {
  for (const s of ['L', 'R']) p['arm' + s] = holdArmsAt(ctx.hold.styles, !!ctx.hold.held[s], t, s, ctx.offset || 0);
}

// ---------- personality: idle quirks and reaction styles (pure) ----------
const HIPS = { armL: { p: -0.15, ab: 0.55, p2: 0.95, ab2: -0.95 }, armR: { p: -0.15, ab: 0.55, p2: 0.95, ab2: -0.95 } };
const setArms = (p, o) => { if (o.armL) p.armL = { ...o.armL }; if (o.armR) p.armR = { ...o.armR }; };
const hasHips = (p) => setArms(p, HIPS);
// Each idle quirk edits a watch/idle pose p at u seconds into the quirk (added to the base, so looking still works)
export const QUIRKS = {
  hips: { dur: 3.2, fn: (p, u) => { hasHips(p); p.spine += -0.05; p.pitch -= 0.02; p.headYaw += 0.15 * sin(u * 1.4); } },
  headshake: { dur: 2.6, fn: (p, u) => { p.headYaw += 0.55 * sin(u * 5.5); p.neck += 0.15; p.spine += 0.03; } },
  wipebrow: { dur: 2.6, fn: (p, u) => {
    p.armR = { p: 1.05, ab: 0.45, p2: 2.85 + 0.2 * sin(u * 9), ab2: -0.45 + 0.12 * sin(u * 9) };
    p.neck += 0.12; p.spine += 0.04;
  } },
  fold: { dur: 5, fn: (p, u) => {
    setArms(p, { armL: { p: 0.5, ab: 0.1, p2: 1.75, ab2: -1.0 }, armR: { p: 0.55, ab: 0.1, p2: 1.5, ab2: -1.0 } });
    p.headYaw += 0.1 * sin(u * 0.8); p.pitch -= 0.015;
  } },
  checkwatch: { dur: 3, fn: (p, u) => {
    p.armL = { p: 0.65, ab: 0.15, p2: 2.25 + 0.05 * sin(u * 3), ab2: -0.35 };
    p.neck += 0.4; p.headYaw -= 0.1;
  } },
  tilt: { dur: 3, fn: (p, u) => { p.headYaw += 0.3; p.neck += 0.1 * sin(u * 2); p.twist += 0.05; p.px += 0.015; p.armL = arm(0.2, 0.15, 0.45); } },
  bounce: { dur: 3.4, fn: (p, u) => {
    const h = max(0, sin(u * 9)) * 0.022;
    p.hop = h; p.footL.z = h * 0.9; p.footR.z = h * 0.9; p.neck -= 0.04;
    p.armL.p = 0.2 + 0.25 * sin(u * 4.5); p.armR.p = 0.2 - 0.25 * sin(u * 4.5);
  } },
  fidget: { dur: 3, fn: (p, u) => {
    p.armL = { p: 0.55, ab: 0.2, p2: 1.55, ab2: -0.9 + 0.2 * sin(u * 7) }; p.armR = { p: 0.55, ab: 0.2, p2: 1.55, ab2: -0.9 - 0.2 * sin(u * 7) };
    p.headYaw += 0.45 * sin(u * 2.2); p.px += 0.012 * sin(u * 3); p.footL.x -= 0.02 * max(0, sin(u * 3));
  } },
  practice: { dur: 3.2, fn: (p, u) => {
    const sw = 0.7 + 0.9 * sin(u * 4.2); // a pretend swing of the throwing arm
    p.armR = { p: sw, ab: 0.1, p2: sw + 0.2, ab2: 0.1 };
    p.spineTwist += 0.25 * sin(u * 4.2 + 0.4); p.pitch += 0.04;
  } },
  shift: { dur: 3, fn: (p, u) => { p.px += 0.035 * sin(u * 2); p.twist += 0.06 * sin(u * 2); p.footR.x += 0.015; } },
  lookaround: { dur: 3, fn: (p, u) => { p.headYaw += 0.55 * sin(u * 1.8); p.neck += 0.03; } },
};
const pulse = (u, dur) => sin(PI * clamp(u / dur, 0, 1));
const dk = (c) => 'arm' + ((c && c.dom) || 'R'), ok = (c) => 'arm' + ((c && c.dom) === 'L' ? 'R' : 'L');
// F20 gestures (c: { dom, off } the dominant and other hand letters; the hands may be holding boules)
const FRONT = (u, a = 0) => ({ p: 0.78 + 0.04 * sin(u * 2 + a), ab: 0.14, p2: 1.5, ab2: -0.12 });
Object.assign(QUIRKS, {
  checkboules: { dur: 3.6, fn: (p, u, c) => { // look down at what is in the hands, turning them over a little
    p[dk(c)] = FRONT(u); p[ok(c)] = FRONT(u, 1.5);
    p[dk(c)].p2 += 0.08 * sin(u * 5); p[ok(c)].p2 += 0.08 * sin(u * 4.2 + 1);
    p.neck += 0.5 * pulse(u, 3.6); p.spine += 0.05; p.headYaw += 0.12 * sin(u * 1.5);
  } },
  wipeboule: { dur: 3, fn: (p, u, c) => { // rub a boule on the trouser leg
    p[dk(c)] = { p: 0.3, ab: 0.08, p2: 0.62 + 0.3 * sin(u * 8), ab2: 0.05 };
    p.spine += 0.08; p.neck += 0.4 * pulse(u, 3); p.pitch += 0.03;
  } },
  shade: { dur: 3.4, fn: (p, u, c) => { // a flat hand over the eyes, peering toward the head
    const k = min(1, pulse(u, 3.4) / 0.9);
    p[dk(c)] = { p: 1.3, ab: 0.35, p2: 2.95, ab2: -0.45 }; p.neck -= 0.08 * k;
    p.headYaw += 0.1 * k; p.spine -= 0.03;
  } },
  shrug: { dur: 2.4, fn: (p, u) => { // both palms up and out, a small lift and drop
    const e = pulse(u, 2.4), a = { p: 0.4, ab: 0.45 + 0.2 * e, p2: 0.85, ab2: 0.8 + 0.15 * e };
    p.armL = { ...a }; p.armR = { ...a }; p.neck += 0.1 * e; p.pz -= 0.006 * e; p.headYaw += 0.15 * sin(u * 2.5);
  } },
  chat: { dur: 4, fn: (p, u, c) => { // talking with the hand to a teammate beside us
    const side = (c && c.dom) === 'L' ? -1 : 1;
    p[dk(c)] = { p: 0.85, ab: 0.3, p2: 1.45 + 0.35 * sin(u * 5.3), ab2: 0.02 + 0.2 * sin(u * 2.9) };
    p.headYaw += 0.5 * side * pulse(u, 4); p.twist += 0.1 * side * pulse(u, 4); p.neck += 0.04 * sin(u * 3);
  } },
  toss: { dur: 3.6, fn: (p, u, c) => { // Pierre tosses a boule from hand to hand (tossBall places it)
    p[dk(c)] = { ...FRONT(u), ab: 0.22 }; p[ok(c)] = { ...FRONT(u, 1), ab: 0.22 };
    const f = u / 0.9 % 1, i = Math.floor(u / 0.9); // the hand that just caught dips a little
    (i % 2 ? p[dk(c)] : p[ok(c)]).p += 0.06 * sin(PI * f);
    p.neck += 0.2; p.headYaw += 0.1 * sin(u * 3.5);
  } },
});
// Where the tossed boule is at u seconds in: k 0 at the dominant hand, 1 at the other, arc metres of lift
export function tossBall(u) {
  const c = u / 0.9, i = Math.floor(c), f = c - i;
  return { k: i % 2 ? 1 - f : f, arc: 0.22 * sin(PI * f) };
}
const BLEND_IN = 0.45;
// Which quirk (if any) is active at time t for a character: one slot every SLOT seconds, each with a hashed start, a quirk and sometimes
// nothing, so the gestures come at irregular intervals and differ between characters (offset)
const SLOT = 8.5;
export function quirkAt(list, t, offset = 0) {
  if (!list || !list.length) return null;
  const tt = t + offset, i = Math.floor(tt / SLOT);
  if (hash(i, offset + 9) < 0.25) return null;
  const name = list[Math.floor(hash(i, offset + 3) * list.length)], dur = QUIRKS[name].dur;
  const u = tt - i * SLOT - 0.5 - hash(i, offset) * max(0, SLOT - dur - 1);
  if (u < 0 || u > dur) return null;
  return { name, u, w: clamp(min(u, dur - u) / BLEND_IN, 0, 1) };
}
// The active gesture at time t for a ctx ({ quirks, forceQuirk, offset, reduced, canToss }), or null
export function activeQuirk(t, ctx) {
  if (ctx.forceQuirk) return { name: ctx.forceQuirk, u: t, w: 1 };
  const a = quirkAt(ctx.quirks && ctx.quirks.idle, t, ctx.offset || 0);
  if (!a || (a.name === 'toss' && (ctx.reduced || !ctx.canToss))) return null;
  return ctx.reduced ? { ...a, w: a.w * 0.5 } : a;
}
function withQuirk(p, t, ctx) {
  const a = activeQuirk(t, ctx);
  if (!a) return p;
  const q = clonePose(p);
  QUIRKS[a.name].fn(q, a.u, ctx);
  return blendPoses(p, q, a.w);
}

// Celebrate / dismay variants by personality (the default 'cheer' and 'head' live in stancePose)
function reactionPose(p, kind, style, t) {
  p.pz = 0.505; p.footL.x = -0.095; p.footR.x = 0.095;
  if (kind === 'celebrate' && style === 'proud') { // Marcel: hands on hips, chest out, a slow satisfied nod
    hasHips(p); p.spine = -0.06; p.pitch = -0.03; p.neck = 0.12 * sin(t * 2.4); p.hop = max(0, sin(t * 3.5)) * 0.008;
  } else if (kind === 'celebrate') { // Odette: a small nod and a single clap
    const m = t % 3, k = m < 0.55 ? 0.5 - 0.5 * cos(m / 0.55 * 2 * PI) : 0;
    p.neck = 0.1 * max(0, sin(t * 3)); p.spine = 0.02;
    p.armL = { p: 0.95, ab: 0.3 - 0.2 * k, p2: 1.95, ab2: -0.5 - 0.5 * k }; p.armR = { p: 0.95, ab: 0.3 - 0.2 * k, p2: 1.95, ab2: -0.5 - 0.5 * k };
  } else if (style === 'wave') { // Marcel: a grumbling wave of the hand, head shaking
    p.armR = { p: 1.25, ab: 0.65, p2: 2.3, ab2: 0.45 + 0.55 * sin(t * 7) };
    p.armL = { ...HIPS.armL };
    p.headYaw = 0.45 * sin(t * 2.6); p.neck = 0.2; p.pitch = 0.07; p.spine = 0.08;
  } else if (style === 'sigh') { // Odette: a hand to the forehead, a slow shake of the head
    p.armR = { p: 1.2, ab: 0.45, p2: 3.0, ab2: -0.65 }; p.armL = arm(0.1, 0.12, 0.35);
    p.headYaw = 0.25 * sin(t * 1.6); p.neck = 0.28; p.spine = 0.12; p.pitch = 0.05;
  } else { // shrug (You): palms up
    const s = 0.05 * sin(t * 2);
    p.armL = { p: 0.4, ab: 0.65 + s, p2: 0.85, ab2: 0.95 }; p.armR = { p: 0.4, ab: 0.65 + s, p2: 0.85, ab2: 0.95 };
    p.neck = 0.12; p.headYaw = 0.2 * sin(t * 1.5);
  }
}

// Right arm holding a ball at the waist (carrying), elbow bent
export const CARRY_ARM = { p: 0.55, ab: 0.2, p2: 1.45, ab2: 0.15 };

// Walking gait at the given phase (radians, one full cycle = two steps). opts.lift scales the foot lift (stepping over
// a timber raises it to a high step). opts.stride stretches the stride (brisk walks, see walkTo). Arms (F26): opts.arms
// 'swing' (default: each arm swings opposite its leg) or 'fold' (folded across the chest); opts.amp scales the swing;
// opts.held = { R, L } marks hands holding boules (a smaller swing, the boules ride the palm); opts.carry holds the
// right arm with a ball or ring at the waist, swinging a little.
export function walkPose(phase, opts = {}) {
  const p = basePose(), k = opts.stride || 1, A = 0.18 * k, s = sin(phase), c = cos(phase), lift = opts.lift || 1;
  p.footL.y = A * s; p.footR.y = -A * s;
  p.footL.z = 0.035 * lift * max(0, c); p.footR.z = 0.035 * lift * max(0, -c);
  p.pz = 0.505 - 0.012 * abs(c); p.px = 0.012 * s; p.twist = 0.1 * s; p.spine = -0.1 * s * 0.6 + 0.04;
  walkArms(p, s, opts);
  if (opts.carry) p.twist = 0.1 * s * 0.5;
  p.pitch = 0.05; p.neck = -0.04; p.headYaw = 0;
  p.ry = 0.0425; // the gait's footprint is centred here at every phase
  return p;
}
// F26: the walking arms. A free arm swings about its shoulder from hanging, the elbow bent a little more on the forward
// swing; a hand holding boules swings less and its forearm rests a little forward (the boules ride the palm, E16);
// a folded pair stays folded (FOLD); a carried ball or ring keeps the right arm at the waist with a small swing.
const WALK_SWING = 0.45, WALK_HOLD_SWING = 0.2; // rad, each way from hanging
function walkArms(p, s, o) {
  const amp = o.amp || 1;
  const arm1 = (key, sg) => { // sg: +1 right, -1 left (the leg opposite the arm steps forward when s > 0 for the left)
    if (key === 'R' && o.carry) return { p: CARRY_ARM.p + 0.12 * s, ab: CARRY_ARM.ab, p2: CARRY_ARM.p2 + 0.12 * s, ab2: CARRY_ARM.ab2 };
    if (o.arms === 'fold') return { ...FOLD[key] };
    const held = !!(o.held && o.held[key]);
    if (held) return arm(0.1 + sg * WALK_HOLD_SWING * amp * s, 0.12, 0.55);
    return arm(0.1 + sg * WALK_SWING * amp * s, 0.08, 0.3);
  };
  p.armL = arm1('L', -1); p.armR = arm1('R', 1);
}
// F26: the walking style for one walk: a personality's tendency to fold its arms and how big its swing is, varied from walk
// to walk by a hash of the walk's number (so no two walks look the same). who: the personality id (lower case).
const WALK_TENDENCY = { odette: { fold: 0.7, amp: 0.85 }, marcel: { fold: 0.25, amp: 0.55 }, pierre: { fold: 0.05, amp: 1.15 } };
export function walkStyle(who, seed, n) {
  const t = WALK_TENDENCY[who] || { fold: 0.3, amp: 1 };
  return { arms: hash(n, seed + 17) < t.fold ? 'fold' : 'swing', amp: t.amp * (0.85 + 0.3 * hash(n, seed + 23)) };
}
// F26: a walk's stride stretch: a brisk walk takes longer strides (capped so the feet stay in reach of the hips)
export const walkStride = (speed) => min(1.3, sqrt(max(0.5, speed) / WALK_SPEED));

// Bending to the ground (pick up or set down): u = 0 standing, 1 knees bent, back leaning forward, right hand at ground
// level a little ahead of the feet. opts.carry keeps the right arm at the waist when standing (a ball in hand).
export function bendPose(u, opts = {}) {
  const k = clamp(u, 0, 1), p = basePose();
  p.pz = 0.505 - 0.235 * k; p.py = -0.06 * k;
  p.pitch = 0.05 + 0.85 * k; p.spine = 0.05 + 0.3 * k; p.neck = -0.55 * k;
  p.footL = { x: -0.09, y: 0.05 * k, z: 0, yaw: -0.15 }; p.footR = { x: 0.09, y: -0.05 * k, z: 0, yaw: 0.15 };
  const A = p.pitch + p.spine;
  const hang = arm(0.1, 0.1, 0.35), reach = arm(A + 0.04, 0.1, 0.05);
  const r0 = opts.carry ? CARRY_ARM : hang;
  p.armR = { p: lerp(r0.p, reach.p, k), ab: lerp(r0.ab, reach.ab, k), p2: lerp(r0.p2, reach.p2, k), ab2: lerp(r0.ab2, reach.ab2, k) };
  p.armL = arm(0.1 + (A * 0.7 - 0.1) * k, 0.2, 0.2);
  p.ry = footprintShift(p);
  return p;
}
// Depth over a pick-up or put-down: down, a beat at the bottom (the ball changes hands at BEND_ACT), back up
export const BEND_DOWN = 0.6, BEND_BEAT = 0.2, BEND_UP = 0.55;
export const BEND_ACT = BEND_DOWN + BEND_BEAT / 2;
export const BEND_TIME = BEND_DOWN + BEND_BEAT + BEND_UP;
// Where the right hand is at the bottom of a bend, in root space (x right, y ahead, z up): a fetcher stands so this
// lands on the ball
export function bendReach(H = 1.75, hand = 'right') {
  const p = bendPose(1);
  return solveSkeleton(hand === 'left' ? armSwap(p) : p, H).joints['hand' + handKey(hand)];
}
export function bendDepth(t) {
  if (t <= 0) return 0;
  if (t < BEND_DOWN) return ease(t / BEND_DOWN);
  if (t < BEND_DOWN + BEND_BEAT) return 1;
  return 1 - ease((t - BEND_DOWN - BEND_BEAT) / BEND_UP);
}
// F28: the kick, a gentle nudge with the side of the right foot (a left-hander is mirrored): weight onto the left leg, right foot
// back (wind-up), a short low sweep forward through the boule (contact), follow-through, recover. t is seconds from the start,
// 0..KICK_TIME. opts.carry keeps the right arm at the waist (the ring is in the hand).
export const KICK_WIND = 0.22, KICK_SWING = 0.12, KICK_FOLLOW = 0.26, KICK_RECOVER = 0.25;
export const KICK_TIME = KICK_WIND + KICK_SWING + KICK_FOLLOW + KICK_RECOVER; // about 0.85 s
export const KICK_CONTACT = KICK_WIND + KICK_SWING * 0.6;
const KICK_FOOT_Y = 0.24; // fraction of height the foot reaches ahead at the end of the swing
export function kickPose(t, opts = {}) {
  const p = basePose();
  const wind = ease(t / KICK_WIND);
  const sw = ease((t - KICK_WIND) / KICK_SWING);
  const rec = ease((t - KICK_WIND - KICK_SWING - KICK_FOLLOW) / KICK_RECOVER);
  const w = wind * (1 - sw); // wind-up weight, gone once the foot swings through
  const out = sw * (1 - rec); // foot forward
  p.footR = { x: 0.085, y: -0.22 * w + KICK_FOOT_Y * out + 0.03 * ease((t - KICK_WIND) / (KICK_SWING + KICK_FOLLOW)) * out, z: 0.03 * w + 0.016 * out, yaw: 0.15 };
  p.footL = { x: -0.085, y: 0.02 * (wind - rec * wind), z: 0, yaw: -0.15 };
  const k = wind * (1 - rec); // body engaged: weight on the left leg, a little lean forward
  p.pz = 0.505 - 0.015 * k; p.px = -0.03 * k;
  p.pitch = 0.05 + 0.12 * k;
  p.twist = 0.12 * w - 0.2 * out; // the hips turn back for the wind-up and through toward the target
  p.spine = 0.04 * k; p.neck = -0.1 * k;
  const bal = k * 0.25; // arms out a little for balance
  p.armL = arm(0.1, 0.1 + bal, 0.3);
  p.armR = opts.carry ? { ...CARRY_ARM } : arm(0.1, 0.1 + bal, 0.3);
  p.ry = footprintShift({ footL: p.footL, footR: p.footL }); // the planted left foot stays where the character stands
  return p;
}
// Where the kicking foot is at the contact frame, in root space (x right, y ahead, z up): a kicker stands so this lands on the boule
export function kickReach(H = 1.75, hand = 'right') {
  const p = kickPose(KICK_CONTACT);
  return solveSkeleton(hand === 'left' ? mirrorPose(p) : p, H).joints['foot' + (hand === 'left' ? 'L' : 'R')];
}

// Arm angle (shoulder swing) at the moment of release for a given loft (radians)
export function releaseArmAngle(loft) {
  const lo = 8 * PI / 180, hi = 75 * PI / 180;
  return 0.3 + 1.25 * clamp((loft - lo) / (hi - lo), 0, 1);
}

const T_BACK = 0.45, T_FWD = 0.4, T_HOLD = 0.3;
const P_BACK = -0.95, P_END = 2.0;
const accel = (u) => { const k = clamp(u, 0, 1); return k * (0.25 + 0.75 * k); }; // slow start, fast finish

// Time (since throw start) at which the forward swing reaches the release angle
export function releaseTime(loft) {
  const target = (releaseArmAngle(loft) - P_BACK) / (P_END - P_BACK);
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (accel(m) < target) lo = m; else hi = m; }
  return T_BACK + T_FWD * lo;
}

// Pose at time tt into a throw. base = the stance pose the thrower starts from.
export function throwPose(tt, base, stance) {
  const p = clonePose(base);
  const hold = base.armR;
  const kBack = ease(tt / T_BACK);
  const kFollow = ease((tt - T_BACK - T_FWD) / T_HOLD);
  p.rollR = lerp(base.rollR || 0, PI, kBack); // the boule comes round the inside of the hand to underneath: palm down at release
  // body follows the arm: lean and twist back, then drive through
  p.pitch += 0.12 * kBack + 0.05 * kFollow;
  p.spineTwist += -0.3 * kBack + 0.35 * kFollow;
  p.pz -= 0.02 * kBack;
  if (stance === 'stand') {
    p.footL.y += 0.04 * kBack; p.footR.y -= 0.02 * kBack;
  } else {
    p.px += 0.01 * kFollow;
  }
  // swing angles are measured from hanging straight down in the world, so add the torso lean
  const tilt = p.pitch + p.spine;
  if (tt < T_BACK) {
    const backArm = { p: P_BACK + tilt, ab: 0.12, p2: P_BACK + tilt + 0.25, ab2: 0.12 };
    for (const key of Object.keys(hold)) p.armR[key] = lerp(hold[key], backArm[key], kBack);
  } else {
    const u = clamp((tt - T_BACK) / T_FWD, 0, 1);
    const pa = P_BACK + (P_END - P_BACK) * accel(u) + tilt;
    p.armR = { p: pa, ab: 0.1, p2: pa + lerp(0.25, 0.12, u), ab2: 0.1 };
  }
  return p;
}

// ---------- Kenney "Mini Characters" rig (pure mapping from the procedural skeleton to its 7 bones) ----------
// Model units: +Y up, facing +Z, the character's left on +X. Game space: z up, facing +y, right on +x.
// model (x, y, z) <-> game (-x, z, y); the map is its own inverse.
export const RIG = {
  hipX: 0.0836, hipY: -0.0288, leg: 0.17625, torsoY: -0.0288, torsoZ: 0.17625,
  shoulder: [0.0999, 0.0115, 0.1115], // x (outward), y (forward), z (up) relative to the torso bone, game axes
  head: [0, 0.0264, 0.167], armHand: 0.2713, // hand centre, along the arm's rest axis from the shoulder
  armRest: [0.263, 0.0665], // the T-pose arm points 14 degrees forward of straight out: [outward, forward] (model x, z)
  headCentre: 0.12, // head box centre above the head bone (hats)
};
// Model heights (feet to top of head, hair buns excluded) used to scale each model to its spec height
export const MODEL_HEIGHT = { marcel: 0.661, odette: 0.7, pierre: 0.671, you: 0.676 };
export const meshScale = (H, model) => H / (MODEL_HEIGHT[model] || 0.675);
const hyp = Math.hypot;
const HAND_MIN_Z = 0.12; // m above the ground

// Bone targets in character root space (metres) for the Kenney rig. The legs and arms are rigid, so the
// crouch bends the legs outward and lowers the root; the hand is where the arm bone ends.
export function meshFrame(solved, pose, H, s) {
  const j = solved.joints;
  const [ex, ey, ez] = solved.frames.chest;
  const L = RIG.leg * s;
  const ks = L / (0.475 * H);
  const c = clamp((0.49 - pose.pz) / 0.205, 0, 1); // 0 standing .. 1 full squat
  const legs = {}, rootXY = [j.pelvis[0], j.pelvis[1]];
  let R = 0, fwd = 0;
  for (const [n, sg] of [['L', -1], ['R', 1]]) {
    const a = j['ankle' + n], h = j['hip' + n];
    let hx = (a[0] - h[0]) * ks + sg * c * 0.25 * L, hy = (a[1] - h[1]) * ks + c * 0.4 * L;
    const hl = hyp(hx, hy) || 1;
    const mag = clamp(max(hl, c * 0.8 * L), 0, 0.98 * L);
    hx = hx / hl * mag; hy = hy / hl * mag;
    const dz = -sqrt(max(0, L * L - mag * mag));
    const lift = max(0, a[2] - L_ANKLE(H));
    R = max(R, -dz + lift);
    fwd += hy / 2;
    legs[n] = { hx, hy, dz };
  }
  rootXY[1] -= 0.5 * fwd * (0.5 + 0.5 * c);
  const root = [rootXY[0], rootXY[1], R - L]; // root bone offset (the root bone's rest is at the ground)
  const hipZ = R;
  const out = { root, legDir: {}, hip: {}, shoulder: {}, armDir: {}, hand: {}, scale: s, crouch: c };
  for (const [n, sg] of [['L', -1], ['R', 1]]) {
    const g = legs[n];
    out.legDir[n] = norm([g.hx, g.hy, g.dz]);
    out.hip[n] = [rootXY[0] + sg * RIG.hipX * s, rootXY[1] + RIG.hipY * s, hipZ];
  }
  const T = [rootXY[0], rootXY[1] + RIG.torsoY * s, hipZ];
  out.torso = T;
  const [sx, sy, sz] = RIG.shoulder;
  for (const [n, sg] of [['L', -1], ['R', 1]]) {
    const off = add(add(mul(ex, sg * sx * s), mul(ey, sy * s)), mul(ez, sz * s));
    const sh = add(T, off);
    let d = norm(sub(j['hand' + n], j['shoulder' + n]));
    // the chibi's shoulders sit low and its arms are long: keep the hand off the ground (a low release in a crouch)
    const armLen = RIG.armHand * s, dzMin = (HAND_MIN_Z - sh[2]) / armLen;
    if (d[2] < dzMin) {
      const dz = clamp(dzMin, -1, 1), hl = hyp(d[0], d[1]);
      const k = hl > 1e-6 ? sqrt(1 - dz * dz) / hl : 0;
      d = hl > 1e-6 ? [d[0] * k, d[1] * k, dz] : [0, sqrt(1 - dz * dz), dz];
    }
    out.shoulder[n] = sh; out.armDir[n] = d;
    out.hand[n] = add(sh, mul(d, RIG.armHand * s));
  }
  out.head = add(T, add(add(mul(ex, RIG.head[0] * s), mul(ey, RIG.head[1] * s)), mul(ez, RIG.head[2] * s)));
  return out;
}
const L_ANKLE = (H) => 0.04 * H;

// Where the throwing hand will be at release, relative to the root (turned by yaw), for a given stance and loft.
// Pure and matches playThrow (the base pose breathes by about a centimetre, so t barely matters).
export function releaseOffset({ height = 1.75, stance = 'crouch', loft = 0.5, yaw = 0, t = 0, model = null, hand = 'right' } = {}) {
  const kind = stance === 'stand' ? 'stand' : 'crouch';
  const pose = throwPose(releaseTime(loft), stancePose(kind, t, {}), kind);
  if (hand === 'left') mirrorPose(pose);
  const hk = handKey(hand);
  const solved = solveSkeleton(pose, height);
  // with a model name the hand is the end of the Kenney arm bone instead of the stick figure's hand
  const h = model ? meshFrame(solved, pose, height, meshScale(height, model)).hand[hk] : solved.joints['hand' + hk];
  const r = twist(heldBallAt(pose, solved, hk, h), yaw); // the boule leaves from its place on the (now palm-down) hand
  return { x: r[0], y: r[1], z: r[2] };
}

export const THROW_TIME = T_BACK + T_FWD + T_HOLD; // then ~0.35 s back to watch

// ---------- three.js character ----------
const BUILD = {
  slim: { r: 0.86, belly: 0 },
  average: { r: 1, belly: 0.02 },
  stout: { r: 1.2, belly: 0.09 },
};

export function createCharacter(THREE, spec = {}) {
  const H = spec.height || 1.75;
  const build = BUILD[spec.build] || BUILD.average;
  const colors = Object.assign({ shirt: '#3a6ea5', trousers: '#4a4a52', skin: '#d9a37c' }, spec.colors || {});
  let stanceKind = spec.stance === 'stand' ? 'stand' : 'crouch'; // the throwing stance; setStance('crouch'|'stand') changes it per throw
  const quirks = spec.quirks || {};
  const hand = spec.hand === 'left' ? 'left' : 'right';
  const HK = handKey(hand), armKey = 'arm' + HK; // the dominant hand's joint letter and pose key
  const L = boneLengths(H);
  let quirkOffset = 0; // desynchronises the idle quirks of different characters
  for (const ch of String(spec.name || '')) quirkOffset += ch.charCodeAt(0) * 0.37;
  let walks = 0; // F26: the number of walks so far (each walk's arm style is hashed from it)

  const root = new THREE.Group();
  root.name = spec.name || 'character';
  const stickG = new THREE.Group(); // the stick figure; hidden once a model is attached
  root.add(stickG);
  const geos = [], mats = [];
  const mat = (c) => {
    const m = new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.85, metalness: 0 });
    mats.push(m); return m;
  };
  const mShirt = mat(colors.shirt), mTrousers = mat(colors.trousers), mSkin = mat(colors.skin), mShoe = mat('#2b2b2b');
  const mDark = mat('#1b1b1b');
  const mHat = colors.hat ? mat(colors.hat) : null;
  const geo = (g) => { geos.push(g); return g; };
  const addMesh = (g, m, parent = stickG) => {
    const me = new THREE.Mesh(geo(g), m); me.castShadow = true; me.receiveShadow = true; parent.add(me); return me;
  };
  const rs = (v) => v * H * build.r;

  // capsule between two joints; length is fixed per bone so only its placement changes
  const caps = [];
  const bone = (a, b, radius, m, lenKey) => {
    const dist = lenKey ? L[lenKey] : 0.2;
    const me = addMesh(new THREE.CapsuleGeometry(radius, max(0.001, dist), 4, 10), m);
    caps.push({ me, a, b });
    return me;
  };
  const rLimb = (v) => v * H;
  bone('pelvis', 'spine', rs(0.07), mTrousers, 'spine');
  bone('spine', 'chest', rs(0.078), mShirt, 'chest');
  bone('chest', 'neck', rLimb(0.025), mSkin, 'neckBase');
  for (const n of ['L', 'R']) {
    bone('hip' + n, 'knee' + n, rs(0.047), mTrousers, 'thigh');
    bone('knee' + n, 'ankle' + n, rs(0.036), mTrousers, 'shin');
    bone('shoulder' + n, 'elbow' + n, rs(0.033), mShirt, 'upperArm');
    bone('elbow' + n, 'wrist' + n, rLimb(0.026), mSkin, 'forearm');
  }
  // drawn bars: shoulders and hips (length set from the joints below)
  const shoulderBar = addMesh(new THREE.CapsuleGeometry(rs(0.04), L.shoulderHalf * 2, 4, 10), mShirt);
  const hipBar = addMesh(new THREE.CapsuleGeometry(rs(0.06), L.hipHalf * 2, 4, 10), mTrousers);
  caps.push({ me: shoulderBar, a: 'shoulderL', b: 'shoulderR' }, { me: hipBar, a: 'hipL', b: 'hipR' });
  // F20 hands: a flattened palm, a short thumb angled out and three finger capsules that curl toward the palm side (more when
  // a boule is held). The group's frame is the hand basis: x across the palm toward the inside (so the thumb is at -x for
  // either hand), y along the forearm, z away from the palm side. Everything is cheap and mirrors for free.
  const hands = ['L', 'R'].map(() => {
    const g = new THREE.Group(); stickG.add(g);
    const palm = addMesh(new THREE.BoxGeometry(H * 0.044, H * 0.045, H * 0.014), mSkin, g);
    const knuckle = new THREE.Group(); knuckle.position.y = H * 0.0225; g.add(knuckle);
    const fr = H * 0.0075;
    for (const i of [-1, 0, 1]) {
      const f = addMesh(new THREE.CapsuleGeometry(fr, H * (i === 0 ? 0.032 : 0.026), 3, 6), mSkin, knuckle);
      f.position.set(i * fr * 2, H * (i === 0 ? 0.0235 : 0.021), 0);
    }
    const thumb = addMesh(new THREE.CapsuleGeometry(H * 0.0072, H * 0.018, 3, 6), mSkin, g);
    thumb.position.set(-H * 0.0285, H * 0.002, -H * 0.005); thumb.rotation.set(-0.3, 0, 0.5);
    void palm;
    return { g, knuckle };
  });
  const feetMeshes = ['L', 'R'].map(() => addMesh(new THREE.CapsuleGeometry(rLimb(0.028), L.foot + L.heel - 2 * rLimb(0.028), 4, 8), mShoe));

  // optional neckerchief (colors.scarf): a ring at the base of the neck, turned with the chest
  let scarf = null;
  if (colors.scarf) scarf = addMesh(new THREE.TorusGeometry(H * 0.05, H * 0.02, 8, 14), mat(colors.scarf));
  let belly = null;
  if (build.belly > 0) {
    // a paunch, not a ball: about the torso's own width, flattened front to back, same shirt (chest frame: x across,
    // y forward, z up), sitting low on the waist and blending into the torso capsule
    belly = addMesh(new THREE.SphereGeometry(H * (0.06 + build.belly * 0.33), 16, 12), mShirt);
    belly.scale.set(1, 0.72, 0.78);
  }

  // head: sphere, nose, eyes, optional hat; the group's frame is the head frame
  const headG = new THREE.Group();
  stickG.add(headG);
  const headR = H * 0.065;
  const neckMesh = bone('neck', 'head', rLimb(0.024), mSkin, 'head');
  addMesh(new THREE.SphereGeometry(headR, 16, 12), mSkin, headG);
  const nose = addMesh(new THREE.ConeGeometry(headR * 0.22, headR * 0.5, 8), mSkin, headG);
  nose.position.set(0, headR * 1.0, -headR * 0.1);
  for (const sx of [-1, 1]) {
    const eye = addMesh(new THREE.SphereGeometry(headR * 0.1, 6, 6), mDark, headG);
    eye.position.set(sx * headR * 0.38, headR * 0.88, headR * 0.2);
  }
  void neckMesh;
  // hat in a head-like frame (z up, y forward) sized by the head radius
  const buildHat = (g, hr, brimK = 2.7, domeK = 1) => {
    if (quirks.hat === 'sunhat') {
      const dome = addMesh(new THREE.SphereGeometry(hr * 1.08, 14, 8, 0, PI * 2, 0, PI / 2).rotateX(PI / 2), mHat, g);
      dome.position.z = hr * 0.15; dome.scale.z = domeK;
      const brim = addMesh(new THREE.CylinderGeometry(hr * brimK, hr * brimK, hr * 0.1, 24).rotateX(PI / 2), mHat, g);
      brim.position.z = hr * 0.3;
    } else {
      const dome = addMesh(new THREE.SphereGeometry(hr * 1.1, 14, 8, 0, PI * 2, 0, PI / 2).rotateX(PI / 2), mHat, g);
      dome.position.z = hr * 0.2; dome.scale.set(1, 1, 0.75);
      const peak = addMesh(new THREE.BoxGeometry(hr * 1.6, hr * 1.0, hr * 0.12), mHat, g);
      peak.position.set(0, hr * 1.15, hr * 0.35); peak.rotation.x = -0.2;
    }
  };
  if (mHat) buildHat(headG, headR);

  // boule shown in the hand before release
  const holdMesh = new THREE.Mesh(
    geo(new THREE.SphereGeometry(C.boule.r, 16, 12)),
    new THREE.MeshStandardMaterial({ color: '#b9c0c8', metalness: 0.9, roughness: 0.3 }),
  );
  mats.push(holdMesh.material);
  holdMesh.castShadow = true; holdMesh.visible = false;
  root.add(holdMesh);
  // E23: the cochonnet in the dominant hand for a jack throw: the live jack's colour (terrain.js JACK_STYLE, render.js jackMat), jack radius
  const jackHeld = new THREE.Mesh(
    geo(new THREE.SphereGeometry(C.jack.r, 14, 10)),
    new THREE.MeshStandardMaterial({ color: jackStyle().color, metalness: 0, roughness: 0.45, emissive: jackStyle().emissive }),
  );
  mats.push(jackHeld.material);
  jackHeld.castShadow = true; jackHeld.visible = false;
  root.add(jackHeld);
  // E16: boules held in the hands. held = null: the legacy single boule (setHolding); else { dominant, other } counts.
  // The other hand's boules sit side by side on its palm.
  let held = null;
  const offMeshes = [0, 1].map(() => {
    const m = new THREE.Mesh(holdMesh.geometry, holdMesh.material);
    m.castShadow = true; m.visible = false; root.add(m); return m;
  });
  const OFF_HK = offKey(hand);

  // ----- animation state -----
  const st = {
    t: 0, yaw: 0, stance: 'idle', mode: 'stance', blend: 1, snap: null, out: null,
    look: null, lookSm: { yaw: 0, pitch: 0 }, holding: false,
    walk: null, throwing: null, bending: null, kicking: null, carry: false, solved: null, frame: null, forceQuirk: null,
  };
  let vis = null; // skinned-mesh visual: { scene, s, name, bones, hatG, mHat }
  const V = THREE;
  const q = new V.Quaternion(), yAxis = new V.Vector3(0, 1, 0), va = new V.Vector3(), vb = new V.Vector3(), vd = new V.Vector3();
  const m4 = new V.Matrix4();
  headG.matrixAutoUpdate = false;

  // F20: what the idle system needs to know: the quirk lists, hold styles, which hands hold boules, reduced motion
  const reduced = () => reducedMotion === null ? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) : reducedMotion;
  let reducedMotion = null;
  function idleCtx(react) {
    return {
      look: st.lookSm, quirks, react, forceQuirk: st.forceQuirk, offset: quirkOffset, reduced: reduced(), dom: HK, steps: true,
      canToss: holdMesh.visible && !(held && held.other > 0),
      hold: held ? { styles: quirks.hold, held: { [HK]: held.dominant > 0, [OFF_HK]: held.other > 0 } } : null,
    };
  }
  function currentTarget() {
    const sw = (p) => (hand === 'left' ? armSwap(p) : p);
    if (st.mode === 'walk') { // the hands holding boules are named in right/left terms (the walk is authored for a right-hander)
      const w = st.walk, dom = !!held && held.dominant > 0, oth = !!held && held.other > 0;
      const holds = hand === 'left' ? { R: oth, L: dom } : { R: dom, L: oth };
      return sw(walkPose(w.phase, { lift: w.lift, carry: st.carry, stride: w.stride, arms: w.style.arms, amp: w.style.amp, held: holds }));
    }
    if (st.mode === 'bend') {
      const b = st.bending;
      return sw(bendPose(bendDepth(b.t), { carry: b.kind === 'pickup' ? b.acted : !b.acted }));
    }
    if (st.mode === 'kick') { // F28: authored for a right-hander, mirrored for a left-hander
      const kp = kickPose(st.kicking.t, { carry: st.carry });
      return hand === 'left' ? mirrorPose(kp) : kp;
    }
    if (st.mode === 'throw') {
      const p = throwPose(st.throwing.t, stancePose(stanceKind, st.t, {}), stanceKind);
      return hand === 'left' ? mirrorPose(p) : p;
    }
    const react = st.stance === 'celebrate' ? quirks.celebrate : st.stance === 'dismay' ? quirks.dismay : undefined;
    const sp = stancePose(st.stance, st.t, idleCtx(react));
    // the throwing stances and the hand-over are one-handed: mirror them for a left-hander (the rest is symmetric)
    if (hand === 'left' && ['aim', 'crouch', 'stand', 'give'].includes(st.stance)) mirrorPose(sp);
    if (st.carry && !held && (st.stance === 'watch' || st.stance === 'idle')) sp[armKey] = { ...CARRY_ARM };
    return sp;
  }
  function refreshHeld() {
    holdMesh.visible = held ? held.dominant > 0 : st.holding === 'boule';
    jackHeld.visible = !held && st.holding === 'jack';
    offMeshes[0].visible = !!held && held.other > 0;
    offMeshes[1].visible = !!held && held.other > 1;
  }
  function evalPose() {
    const target = currentTarget();
    st.out = st.blend < 1 && st.snap ? blendPoses(st.snap, target, st.blend) : target;
    st.solved = solveSkeleton(st.out, H);
    st.frame = vis ? meshFrame(st.solved, st.out, H, vis.s) : null;
    return st.solved;
  }
  function switchMode(mode) {
    if (st.out) st.snap = clonePose(st.out);
    st.mode = mode; st.blend = st.snap ? 0 : 1;
  }
  const setYaw = (y) => { st.yaw = y; root.rotation.z = -y; };
  const handLocal = () => { const j = (st.solved || evalPose()).joints; return st.frame ? st.frame.hand[HK] : j['hand' + HK]; };
  const toWorld = (v) => {
    const r = twist(v, st.yaw);
    return { x: root.position.x + r[0], y: root.position.y + r[1], z: root.position.z + r[2] };
  };
  const handWorldPosition = () => toWorld(handLocal());
  const handAt = (k) => (st.frame ? st.frame.hand[k] : st.solved.joints['hand' + k]);
  // centre of a boule held on the palm of hand k (root space)
  const ballLocal = (k) => heldBallAt(st.out, st.solved, k, handAt(k));
  function placeHeld() {
    holdMesh.position.set(...ballLocal(HK));
    if (st.mode === 'stance' && st.blend >= 1 && (st.stance === 'watch' || st.stance === 'idle') && holdMesh.visible) {
      const a = activeQuirk(st.t, idleCtx());
      if (a && a.name === 'toss') { // Pierre's toss: the boule arcs between the hands
        const { k, arc } = tossBall(a.u), d = ballLocal(HK), o = ballLocal(OFF_HK);
        holdMesh.position.set(lerp(d[0], o[0], k), lerp(d[1], o[1], k), lerp(d[2], o[2], k) + arc);
      }
    }
    jackHeld.position.set(...ballLocal(HK)); // same centre as a boule: the release point is unchanged
    if (!held || held.other < 1) return;
    const c = ballLocal(OFF_HK);
    if (held.other === 1) { offMeshes[0].position.set(...c); return; }
    const lat = handBasis(st.out, st.solved, OFF_HK).lat, w = C.boule.r * 1.02; // side by side across the palm
    offMeshes[0].position.set(...add(c, mul(lat, w))); offMeshes[1].position.set(...sub(c, mul(lat, w)));
  }
  function placeHands() {
    ['L', 'R'].forEach((n, i) => {
      const b = handBasis(st.out, st.solved, n), j = st.solved.joints['hand' + n];
      const p = add(sub(add(j, mul(add(b.n, b.n0), BALL_D / 2)), mul(b.n, BALL_D)), mul(b.d, -H * 0.02)); // the palm under the boule's place, wrist side
      const z = cross(b.lat, b.d);
      const holds = held ? (n === HK ? held.dominant > 0 : held.other > 0) : (n === HK && st.holding === 'boule');
      const g = hands[i].g;
      g.position.set(...sub(p, mul(b.n, H * 0.008)));
      g.quaternion.setFromRotationMatrix(m4.makeBasis(va.set(...b.lat), vb.set(...b.d), vd.set(...z)));
      hands[i].knuckle.rotation.x = -(holds ? 0.75 : 0.3);
    });
  }

  function updateLook(dt) {
    let ty = 0, tp = 0;
    if (st.look && st.solved) {
      const hw = twist(st.frame ? st.frame.head : st.solved.joints.head, st.yaw);
      const d = [st.look.x - root.position.x - hw[0], st.look.y - root.position.y - hw[1], st.look.z - root.position.z - hw[2]];
      const l = twist(d, -st.yaw);
      ty = atan2(l[0], l[1]); tp = -atan2(l[2], sqrt(l[0] * l[0] + l[1] * l[1]));
    }
    const k = 1 - Math.exp(-dt * 8);
    st.lookSm.yaw += (ty - st.lookSm.yaw) * k;
    st.lookSm.pitch += (tp - st.lookSm.pitch) * k;
  }

  function endKick() { // F28
    const k = st.kicking; st.kicking = null;
    switchMode('stance');
    if (k) k.done();
  }
  function endBend() {
    const b = st.bending; st.bending = null;
    st.carry = b.kind === 'pickup';
    switchMode('stance');
    b.done();
  }
  // Start the walk's next leg (via points, then the final target) from where the character stands
  function nextLeg(w) {
    const p = w.via.shift();
    const dx = p.x - root.position.x, dy = p.y - root.position.y;
    w.leg = { x: p.x, y: p.y }; w.dist = sqrt(dx * dx + dy * dy); w.moved = 0;
    if (w.dist > 0.01) w.heading = atan2(dx, dy);
    w.lift = p.lift || 1;
    w.stage = w.dist > 0.01 ? 'go' : (w.via.length ? 'go' : 'turn2');
    if (w.dist <= 0.01 && w.via.length) nextLeg(w);
  }
  function finishThrow() {
    const th = st.throwing; st.throwing = null;
    st.stance = 'watch'; switchMode('stance');
    st.afterThrow = th.done;
    st.afterThrowT = 0;
  }

  // advance logic by dt (may be split so the release lands on its exact frame)
  function advance(dt) {
    st.t += dt;
    if (st.blend < 1) st.blend = min(1, st.blend + dt / BLEND);
    if (st.mode === 'walk') {
      const w = st.walk;
      if (w.stage === 'turn1' || w.stage === 'turn2') {
        const goal = w.stage === 'turn1' ? w.heading : w.target.yaw;
        const dy = atan2(sin(goal - st.yaw), cos(goal - st.yaw));
        const step = TURN_RATE * dt;
        if (abs(dy) <= step) {
          setYaw(goal);
          if (w.stage === 'turn1') { if (w.dist > 0.02) w.stage = 'go'; else if (w.via.length) nextLeg(w); else w.stage = 'turn2'; } else w.stage = 'done';
        } else setYaw(st.yaw + Math.sign(dy) * step);
      } else if (w.stage === 'go' && st.steer && w.lift <= 1) {
        // F14: a crowd-steered step ({ vx, vy } scaled 0..1 from crowd.js): head along it, never past the leg's end
        const sv = st.steer, m = sqrt(sv.vx * sv.vx + sv.vy * sv.vy);
        const lx = w.leg.x - root.position.x, ly = w.leg.y - root.position.y, left = sqrt(lx * lx + ly * ly);
        if (m > 1e-6) w.heading = atan2(sv.vx, sv.vy);
        const step = min(w.speed * dt * m, left);
        const dh = atan2(sin(w.heading - st.yaw), cos(w.heading - st.yaw));
        if (abs(dh) > 1e-6) setYaw(abs(dh) <= TURN_RATE * dt ? w.heading : st.yaw + Math.sign(dh) * TURN_RATE * dt);
        if (m > 1e-6) { root.position.x += sin(w.heading) * step; root.position.y += cos(w.heading) * step; w.phase += step / (4 * 0.18 * H * w.stride) * 2 * PI; }
        if (left - step < 0.02) {
          root.position.x = w.leg.x; root.position.y = w.leg.y;
          if (w.via.length) nextLeg(w); else w.stage = 'turn2';
        }
      } else if (w.stage === 'go') {
        const step = min(w.speed * dt, w.dist - w.moved);
        w.moved += step;
        // turn towards the leg's heading while walking (a corner of a multi-leg path), then move along it
        const dh = atan2(sin(w.heading - st.yaw), cos(w.heading - st.yaw));
        if (abs(dh) > 1e-6) setYaw(abs(dh) <= TURN_RATE * dt ? w.heading : st.yaw + Math.sign(dh) * TURN_RATE * dt);
        root.position.x += sin(w.heading) * step; root.position.y += cos(w.heading) * step;
        w.phase += w.speed * dt / (4 * 0.18 * H * w.stride) * 2 * PI;
        if (w.dist - w.moved < 1e-6) {
          root.position.x = w.leg.x; root.position.y = w.leg.y;
          if (w.via.length) nextLeg(w); else w.stage = 'turn2';
        }
      }
      if (w.stage === 'done') {
        st.walk = null;
        switchMode('stance');
        w.resolve();
      }
    } else if (st.mode === 'bend') {
      const b = st.bending;
      b.t += dt;
      if (!b.acted && b.t >= BEND_ACT) {
        b.acted = true;
        if (b.onAct) { const f = b.onAct; b.onAct = null; evalPose(); applyMeshes(); f(handWorldPosition()); }
      }
      if (b.t >= BEND_TIME) endBend();
    } else if (st.mode === 'kick') { // F28: onContact (the kicking foot's world position) fires once at KICK_CONTACT
      const k = st.kicking;
      k.t += dt;
      if (!k.contacted && k.t >= KICK_CONTACT) {
        k.contacted = true;
        if (k.onContact) { const f = k.onContact; k.onContact = null; evalPose(); applyMeshes(); f(toWorld(st.solved.joints['foot' + HK])); }
      }
      if (k.t >= KICK_TIME) endKick();
    } else if (st.mode === 'throw') {
      const th = st.throwing;
      th.t += dt;
      if (th.t >= THROW_TIME && !th.ending) {
        th.ending = true;
        finishThrow();
      }
    }
    if (st.afterThrow) {
      st.afterThrowT += dt;
      if (st.afterThrowT >= BLEND) { const f = st.afterThrow; st.afterThrow = null; f(); }
    }
  }

  function step(dt) {
    let left = dt;
    while (left > 1e-9) {
      let h = min(left, 1 / 60);
      const th = st.throwing;
      if (st.mode === 'throw' && th && !th.released && th.t + h >= th.tRel) {
        h = max(0, th.tRel - th.t);
        advance(h);
        th.released = true;
        st.holding = false;
        evalPose();
        applyMeshes(); // bones at the release frame, so the visible hand is where the boule leaves from
        const pos = toWorld(ballLocal(HK));
        if (held) held.dominant = max(0, held.dominant - 1);
        refreshHeld();
        if (th.onRelease) th.onRelease(pos);
        left -= h;
        if (h === 0) left -= 1e-9;
        continue;
      }
      advance(h); left -= h;
    }
  }

  // Mesh mode: pose the 7 Kenney bones. All bones rest with no rotation, so a bone's world rotation is its
  // rotation from the rest direction. Targets come from meshFrame (game space), converted to model space.
  const MM = new V.Matrix4().makeBasis(new V.Vector3(-1, 0, 0), new V.Vector3(0, 0, 1), new V.Vector3(0, 1, 0));
  const mdir = (d) => new V.Vector3(-d[0], d[2], d[1]);
  const qTorso = new V.Quaternion(), qTmp = new V.Quaternion(), mTmp = new V.Matrix4(), mTmp2 = new V.Matrix4();
  function frameQuat(out, [x, y, z]) {
    mTmp.makeBasis(va.set(...x), vb.set(...y), vd.set(...z));
    mTmp2.multiplyMatrices(MM, mTmp).multiply(MM);
    return out.setFromRotationMatrix(mTmp2);
  }
  const [rOut, rFwd] = RIG.armRest, rLen = Math.hypot(rOut, rFwd);
  const restL = new V.Vector3(rOut / rLen, 0, rFwd / rLen), restR = new V.Vector3(-rOut / rLen, 0, rFwd / rLen);
  function applyBones() {
    const f = st.frame, b = vis.bones, s = vis.s;
    b.root.position.copy(mdir(f.root)).divideScalar(s);
    const down = new V.Vector3(0, -1, 0);
    b['leg-left'].quaternion.setFromUnitVectors(down, mdir(f.legDir.L));
    b['leg-right'].quaternion.setFromUnitVectors(down, mdir(f.legDir.R));
    frameQuat(qTorso, st.solved.frames.chest);
    b.torso.quaternion.copy(qTorso);
    const inv = qTmp.copy(qTorso).invert();
    // arm-left rests along +X, arm-right along -X (model space)
    const armQ = (bone, rest, d) => {
      bone.quaternion.setFromUnitVectors(rest, mdir(d).normalize()).premultiply(inv);
    };
    armQ(b['arm-left'], restL, f.armDir.L);
    armQ(b['arm-right'], restR, f.armDir.R);
    frameQuat(b.head.quaternion, st.solved.frames.head);
    b.head.quaternion.premultiply(inv);
    b.root.updateMatrixWorld(true);
  }

  function applyMeshes() {
    if (vis) { applyBones(); placeHeld(); return; }
    const { joints: j, frames } = st.solved;
    for (const c of caps) {
      va.set(...j[c.a]); vb.set(...j[c.b]);
      c.me.position.copy(va).add(vb).multiplyScalar(0.5);
      vd.copy(vb).sub(va);
      if (vd.lengthSq() > 1e-12) { q.setFromUnitVectors(yAxis, vd.normalize()); c.me.quaternion.copy(q); }
    }
    // shoulder and hip bars: capsule axis spans exactly the joints, shorten by nothing
    ['L', 'R'].forEach((n, i) => {
      const a = j['ankle' + n], f = j['foot' + n];
      const fm = feetMeshes[i];
      const z = a[2] - L.ankleH + H * 0.028;
      const fx = f[0] - a[0], fy = f[1] - a[1], fl = Math.hypot(fx, fy) || 1, r = rLimb(0.028);
      va.set(a[0] - fx / fl * (L.heel - r), a[1] - fy / fl * (L.heel - r), z);
      vb.set(a[0] + fx / fl * (L.foot - r), a[1] + fy / fl * (L.foot - r), z);
      fm.position.copy(va).add(vb).multiplyScalar(0.5);
      vd.copy(vb).sub(va).normalize(); fm.quaternion.setFromUnitVectors(yAxis, vd);
    });
    const [hx, hy, hz] = frames.head;
    m4.makeBasis(va.set(...hx), vb.set(...hy), vd.set(...hz));
    m4.setPosition(...j.head);
    headG.matrix.copy(m4); headG.matrixWorldNeedsUpdate = true;
    headG.matrixWorld.copy(headG.matrix); // parent is root; recomputed on render
    if (scarf) {
      const [cx, cy, cz] = frames.chest;
      scarf.position.set(...j.neck); scarf.position.z += H * 0.005;
      scarf.quaternion.setFromRotationMatrix(m4.makeBasis(va.set(...cx), vb.set(...cy), vd.set(...cz)));
    }
    if (belly) {
      const [cx, cy, cz] = frames.chest;
      const o = (cy.map((v) => v * H * (0.04 + build.belly * 0.25)));
      belly.position.set(j.spine[0] + o[0] - cz[0] * H * 0.045, j.spine[1] + o[1] - cz[1] * H * 0.045, j.spine[2] + o[2] - cz[2] * H * 0.045);
      belly.quaternion.setFromRotationMatrix(m4.makeBasis(va.set(...cx), vb.set(...cy), vd.set(...cz)));
    }
    placeHands();
    placeHeld();
  }

  function update(dt) {
    if (!(dt > 0)) dt = 0;
    if (!st.solved) evalPose();
    if (fadeRun) { // E31: a fade runs on game time, so it freezes with the pause clock
      fadeRun.t += dt;
      const k = Math.min(1, fadeRun.t / fadeRun.dur);
      applyAlpha(fadeRun.from + (fadeRun.to - fadeRun.from) * k);
      if (k >= 1) fadeRun = null;
    }
    updateLook(dt);
    step(dt);
    st.steer = null; // F14: set again each frame by the caller
    evalPose();
    applyMeshes();
  }

  // ----- public API -----
  function setStance(name) {
    const valid = ['idle', 'aim', 'crouch', 'stand', 'watch', 'celebrate', 'dismay', 'give'];
    if (!valid.includes(name)) throw new Error('unknown stance ' + name);
    if (st.mode === 'throw') cancelThrow();
    if (st.mode === 'bend') endBend(); else if (st.mode === 'kick') endKick();
    if (name === 'crouch' || name === 'stand') stanceKind = name;
    st.stance = name;
    if (st.mode === 'stance') switchMode('stance');
  }
  function cancelThrow() {
    const th = st.throwing;
    st.throwing = null; st.afterThrow = null; st.mode = 'stance';
    if (th && th.done) th.done();
  }
  function walkTo(target) {
    if (st.mode === 'throw') cancelThrow();
    if (st.mode === 'bend') endBend(); else if (st.mode === 'kick') endKick();
    if (st.walk) st.walk.resolve();
    return new Promise((resolve) => {
      // target.via: waypoints [{x, y, lift}] walked first without stopping (lift > 1: stepping over something)
      const via = (target.via || []).map((v) => ({ ...v }));
      const first = via.length ? via.shift() : target;
      const dx = first.x - root.position.x, dy = first.y - root.position.y;
      const dist = sqrt(dx * dx + dy * dy);
      const heading = dist > 0.02 ? atan2(dx, dy) : st.yaw;
      const fx = target.x - (via.length ? via[via.length - 1].x : first.x), fy = target.y - (via.length ? via[via.length - 1].y : first.y);
      const ty = target.yaw === undefined ? (via.length || first !== target ? atan2(fx, fy) : heading) : target.yaw;
      if (first !== target) via.push({ x: target.x, y: target.y, lift: target.lift });
      const speed = target.speed || WALK_SPEED;
      st.walk = {
        target: { x: target.x, y: target.y, yaw: ty }, leg: { x: first.x, y: first.y }, via, dist, moved: 0, heading, phase: 0, stage: 'turn1',
        resolve, speed, lift: first.lift || target.lift || 1,
        stride: walkStride(speed), style: walkStyle(String(spec.personality || spec.name || '').toLowerCase(), quirkOffset, walks++),
      };
      switchMode('walk');
    });
  }
  // Bend to the ground and straighten again. kind 'pickup': the ball is taken at BEND_ACT and carried afterwards;
  // 'putdown': it is let go at BEND_ACT (onAct runs once, with the hand's world position), the hand is empty afterwards.
  function playBend({ kind = 'pickup', onAct } = {}) {
    if (st.mode === 'throw') cancelThrow();
    if (st.mode === 'bend') endBend(); else if (st.mode === 'kick') endKick();
    if (st.walk) { const w = st.walk; st.walk = null; w.resolve(); }
    return new Promise((resolve) => {
      st.bending = { t: 0, kind, acted: false, onAct, done: resolve };
      switchMode('bend');
    });
  }
  // F28: a gentle kick with the side of the dominant foot (see kickPose); resolves when the character is upright again
  function playKick({ onContact } = {}) {
    if (st.mode === 'throw') cancelThrow();
    if (st.mode === 'bend') endBend(); else if (st.mode === 'kick') endKick();
    if (st.walk) { const w = st.walk; st.walk = null; w.resolve(); }
    return new Promise((resolve) => {
      st.kicking = { t: 0, contacted: false, onContact, done: resolve };
      switchMode('kick');
    });
  }
  // F14: for this frame only, a walk's 'go' stage follows { vx, vy } (crowd.js steer) instead of its straight leg
  function setSteer(v) { st.steer = v || null; }
  // the point the walk is heading for now ({ x, y }), or null when not walking a straight stretch
  function walkLeg() { return st.mode === 'walk' && st.walk && st.walk.stage === 'go' && st.walk.lift <= 1 ? { x: st.walk.leg.x, y: st.walk.leg.y } : null; }
  function setCarrying(on) { st.carry = !!on; }
  function playThrow({ loft = 0.5, onRelease } = {}) {
    if (st.mode === 'throw') cancelThrow();
    if (st.mode === 'bend') endBend(); else if (st.mode === 'kick') endKick();
    if (st.walk) { const w = st.walk; st.walk = null; w.resolve(); }
    return new Promise((resolve) => {
      st.throwing = { t: 0, tRel: releaseTime(loft), released: false, onRelease, done: resolve, loft };
      switchMode('throw');
    });
  }
  function setReducedMotion(on) { reducedMotion = on === null || on === undefined ? null : !!on; }
  function forceQuirk(name) { st.forceQuirk = name || null; st.t = 0; } // debug: hold one idle quirk
  // E23: setHolding('jack') shows the cochonnet in the dominant hand; setHolding(true | 'boule', colour) a boule (the
  // team's look: colour sets the single boule's material); false hides both. A release clears it (step()).
  function setHolding(on, color) {
    st.holding = on === 'jack' ? 'jack' : on ? 'boule' : false;
    if (color && st.holding === 'boule') holdMesh.material.color.set(color);
    refreshHeld();
  }
  // E16: show boules in the hands ({ dominant: 0|1, other: 0..2 }, optional colour of the boule); null goes back to the
  // single boule that setHolding shows. A throw takes one from the dominant hand.
  function setHeldBoules(h) {
    held = h ? { dominant: h.dominant | 0, other: h.other | 0 } : null;
    if (h && h.color) holdMesh.material.color.set(h.color);
    refreshHeld();
  }
  // Move one boule from the other hand to the dominant hand if the latter is empty; true when it did
  function shiftBoule() {
    if (!held || held.dominant > 0 || held.other < 1) return false;
    held.dominant = 1; held.other -= 1; refreshHeld(); return true;
  }
  function lookAt(x, y, z) {
    st.look = x === null || x === undefined ? null : { x, y, z: z === undefined ? 1.5 : z };
  }
  function setPlacement(x, y, yaw = st.yaw) {
    // a teleport ends any walk in progress, else the walk would carry on and snap the figure to its old goal
    if (st.mode === 'throw') cancelThrow();
    if (st.mode === 'bend') endBend(); else if (st.mode === 'kick') endKick();
    if (st.walk) { const w = st.walk; st.walk = null; switchMode('stance'); w.resolve(); }
    root.position.set(x, y, root.position.z); setYaw(yaw);
  }
  // E31: opacity of the whole figure (every material keeps its own base opacity; alpha scales it). At 0 the root is
  // hidden. applyAlpha is the only writer; fadeTo runs a fade over `sec` game seconds (0 snaps), setOpacity snaps.
  const fadeBase = new Map(); // material -> { o, t } as first seen
  let alpha = 1, fadeRun = null;
  function applyAlpha(a) {
    alpha = Math.max(0, Math.min(1, a));
    root.visible = alpha > 0;
    const list = new Set(mats);
    if (vis) vis.model.traverse((o) => { if (o.isMesh) [].concat(o.material).forEach((m) => m && list.add(m)); });
    for (const m of list) {
      if (!fadeBase.has(m)) fadeBase.set(m, { o: m.opacity, t: m.transparent });
      const base = fadeBase.get(m), t = alpha < 1 || base.t;
      if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
      m.opacity = base.o * alpha;
    }
  }
  function fadeTo(to, sec) {
    if (!(sec > 0)) { fadeRun = null; applyAlpha(to); return; }
    fadeRun = { from: alpha, to: Math.max(0, Math.min(1, to)), dur: sec, t: 0 };
  }
  function setOpacity(a) { fadeRun = null; applyAlpha(a); }
  // Swap the stick figure for a loaded Kenney model (a THREE.Group from GLTFLoader, used once)
  function attachModel(model, name = spec.model) {
    if (vis) return;
    const bones = {};
    for (const n of ['root', 'torso', 'leg-left', 'leg-right', 'arm-left', 'arm-right', 'head']) {
      bones[n] = model.getObjectByName(n);
      if (!bones[n]) throw new Error('model has no bone ' + n);
    }
    const s = meshScale(H, name);
    const mg = new V.Group();
    mg.quaternion.setFromRotationMatrix(MM); mg.scale.setScalar(s);
    mg.add(model);
    model.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
    // hats ride the head bone: a head-like frame (z up, y forward) mapped into model space
    const hatG = new V.Group();
    hatG.quaternion.setFromRotationMatrix(MM);
    const cap = quirks.hat === 'cap';
    hatG.position.set(0, RIG.headCentre + (cap ? 0.07 : 0.1), cap ? 0.015 : 0.01);
    // the sun hat's dome is tall so Odette's bun stays inside it; Marcel's cap covers the flat crown
    if (mHat) buildHat(hatG, cap ? 0.235 : 0.2, 1.5, cap ? 1.5 : 1.8);
    bones.head.add(hatG);
    // no belly ellipsoid in mesh mode: the chibi is round already and the texture's colours would clash with the shirt
    root.add(mg);
    stickG.visible = false;
    vis = { scene: mg, model, s, name, bones };
    evalPose(); applyMeshes();
  }
  function dispose() {
    if (st.walk) { const w = st.walk; st.walk = null; w.resolve(); }
    if (st.throwing) cancelThrow();
    if (st.mode === 'bend') endBend(); else if (st.mode === 'kick') endKick();
    if (vis) {
      vis.model.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); }
      });
    }
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    if (root.parent) root.parent.remove(root);
  }

  evalPose();
  applyMeshes();
  return {
    root, update, setStance, walkTo, playThrow, playBend, playKick, setCarrying, handWorldPosition, dispose,
    setTrousers: (c) => mTrousers.color.set(c), // F45: team colour of the trousers
    lookAt, setHolding, setHeldBoules, shiftBoule, setPlacement, setSteer, walkLeg, attachModel, forceQuirk, setReducedMotion, fadeTo, setOpacity,
    hand, // 'right' | 'left': the dominant (throwing, carrying) hand
    get isMesh() { return !!vis; },
    get yaw() { return st.yaw; },
    set yaw(v) { setYaw(v); },
    get stance() { return st.stance; },
    get busy() { return st.mode !== 'stance'; },
    get carrying() { return st.carry; },
    get opacity() { return alpha; },
    get heldBoules() { return held ? { ...held } : null; },
    ballWorldPosition: () => { if (!st.solved) evalPose(); return toWorld(ballLocal(HK)); },
    skeleton: () => (st.solved || evalPose()).joints, // root-space joints (for tests and debugging)
    height: H,
  };
}
