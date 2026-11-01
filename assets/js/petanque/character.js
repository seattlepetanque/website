// Stick-figure player: procedural skeleton, poses and animations drawn with capsules.
// World is z-up, metres. The character faces +y at yaw 0; positive yaw turns toward +x.
// The pose math below is pure (no three.js) so it can be tested in Node.
import { C } from './constants.js';

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
    thigh: 0.245 * H, shin: 0.246 * H, ankleH: 0.04 * H, foot: 0.15 * H,
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
    px: 0, py: 0, pz: 0.515, hop: 0, pitch: 0, twist: 0, spine: 0, spineTwist: 0,
    neck: 0, headYaw: 0, headPitch: 0,
    armL: { p: 0.05, ab: 0.1, p2: 0.2, ab2: 0.1 }, armR: { p: 0.05, ab: 0.1, p2: 0.2, ab2: 0.1 },
    footL: { x: -0.085, y: 0, z: 0, yaw: -0.15 }, footR: { x: 0.085, y: 0, z: 0, yaw: 0.15 },
  };
}

export function clonePose(p) { return JSON.parse(JSON.stringify(p)); }

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
      p.footL = { x: -0.08, y: 0.07, z: 0, yaw: -0.2 }; p.footR = { x: 0.1, y: -0.05, z: 0, yaw: 0.25 };
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
    case 'celebrate': {
      const w = sin(t * 9);
      const hop = max(0, sin(t * 7)) * 0.045;
      p.hop = hop; p.pz = 0.505; p.pitch = -0.04; p.spine = -0.08; p.neck = -0.15;
      p.headYaw = 0.15 * sin(t * 3);
      p.armL = { p: 2.85 + 0.12 * w, ab: 0.5, p2: 3.0 + 0.1 * w, ab2: 0.45 };
      p.armR = { p: 2.85 - 0.12 * w, ab: 0.5, p2: 3.0 - 0.1 * w, ab2: 0.45 };
      p.footL.z = hop * 0.9; p.footR.z = hop * 0.9;
      break;
    }
    case 'dismay': // hands on head, slow shake, shoulders hunched forward
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
  return p;
}

// Walking gait at the given phase (radians, one full cycle = two steps)
export function walkPose(phase) {
  const p = basePose(), A = 0.18, s = sin(phase), c = cos(phase);
  p.footL.y = A * s; p.footR.y = -A * s;
  p.footL.z = 0.035 * max(0, c); p.footR.z = 0.035 * max(0, -c);
  p.pz = 0.505 - 0.012 * abs(c); p.px = 0.012 * s; p.twist = 0.1 * s; p.spine = -0.1 * s * 0.6 + 0.04;
  p.armL = arm(-0.45 * s + 0.1, 0.08, 0.3); p.armR = arm(0.45 * s + 0.1, 0.08, 0.3);
  p.pitch = 0.05; p.neck = -0.04; p.headYaw = 0;
  return p;
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
  // body follows the arm: lean and twist back, then drive through
  p.pitch += 0.12 * kBack + 0.05 * kFollow;
  p.spineTwist += -0.3 * kBack + 0.35 * kFollow;
  p.pz -= 0.02 * kBack;
  if (stance === 'stand') {
    p.footL.y += 0.1 * kBack; p.footR.y -= 0.02 * kBack;
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

// Where the throwing hand will be at release, relative to the root (turned by yaw), for a given stance and loft.
// Pure and matches playThrow (the base pose breathes by about a centimetre, so t barely matters).
export function releaseOffset({ height = 1.75, stance = 'crouch', loft = 0.5, yaw = 0, t = 0 } = {}) {
  const kind = stance === 'stand' ? 'stand' : 'crouch';
  const pose = throwPose(releaseTime(loft), stancePose(kind, t, {}), kind);
  const h = solveSkeleton(pose, height).joints.handR;
  const r = twist(h, yaw);
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
  const stanceKind = spec.stance === 'stand' ? 'stand' : 'crouch';
  const quirks = spec.quirks || {};
  const L = boneLengths(H);

  const root = new THREE.Group();
  root.name = spec.name || 'character';
  const geos = [], mats = [];
  const mat = (c) => {
    const m = new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.85, metalness: 0 });
    mats.push(m); return m;
  };
  const mShirt = mat(colors.shirt), mTrousers = mat(colors.trousers), mSkin = mat(colors.skin), mShoe = mat('#2b2b2b');
  const mDark = mat('#1b1b1b');
  const mHat = colors.hat ? mat(colors.hat) : null;
  const geo = (g) => { geos.push(g); return g; };
  const addMesh = (g, m, parent = root) => {
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
  const hands = ['L', 'R'].map(() => addMesh(new THREE.SphereGeometry(rLimb(0.028), 10, 8), mSkin));
  const feetMeshes = ['L', 'R'].map(() => addMesh(new THREE.CapsuleGeometry(rLimb(0.028), L.foot * 0.8, 4, 8), mShoe));

  let belly = null;
  if (build.belly > 0) {
    belly = addMesh(new THREE.SphereGeometry(H * build.belly + H * 0.04, 14, 10), mShirt);
    belly.scale.set(1, 0.9, 1.05);
  }

  // head: sphere, nose, eyes, optional hat; the group's frame is the head frame
  const headG = new THREE.Group();
  root.add(headG);
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
  if (mHat) {
    if (quirks.hat === 'sunhat') {
      const dome = addMesh(new THREE.SphereGeometry(headR * 1.08, 14, 8, 0, PI * 2, 0, PI / 2).rotateX(PI / 2), mHat, headG);
      dome.position.z = headR * 0.15;
      const brim = addMesh(new THREE.CylinderGeometry(headR * 2.7, headR * 2.7, headR * 0.1, 24).rotateX(PI / 2), mHat, headG);
      brim.position.z = headR * 0.3;
    } else {
      const dome = addMesh(new THREE.SphereGeometry(headR * 1.1, 14, 8, 0, PI * 2, 0, PI / 2).rotateX(PI / 2), mHat, headG);
      dome.position.z = headR * 0.2; dome.scale.set(1, 1, 0.75);
      const peak = addMesh(new THREE.BoxGeometry(headR * 1.6, headR * 1.0, headR * 0.12), mHat, headG);
      peak.position.set(0, headR * 1.15, headR * 0.35); peak.rotation.x = -0.2;
    }
  }

  // boule shown in the hand before release
  const holdMesh = new THREE.Mesh(
    geo(new THREE.SphereGeometry(C.boule.r, 16, 12)),
    new THREE.MeshStandardMaterial({ color: '#b9c0c8', metalness: 0.9, roughness: 0.3 }),
  );
  mats.push(holdMesh.material);
  holdMesh.castShadow = true; holdMesh.visible = false;
  root.add(holdMesh);

  // ----- animation state -----
  const st = {
    t: 0, yaw: 0, stance: 'idle', mode: 'stance', blend: 1, snap: null, out: null,
    look: null, lookSm: { yaw: 0, pitch: 0 }, holding: false,
    walk: null, throwing: null, solved: null,
  };
  const V = THREE;
  const q = new V.Quaternion(), yAxis = new V.Vector3(0, 1, 0), va = new V.Vector3(), vb = new V.Vector3(), vd = new V.Vector3();
  const m4 = new V.Matrix4();
  headG.matrixAutoUpdate = false;

  function currentTarget() {
    if (st.mode === 'walk') return walkPose(st.walk.phase);
    if (st.mode === 'throw') {
      return throwPose(st.throwing.t, stancePose(stanceKind, st.t, {}), stanceKind);
    }
    return stancePose(st.stance, st.t, { look: st.lookSm });
  }
  function evalPose() {
    const target = currentTarget();
    st.out = st.blend < 1 && st.snap ? blendPoses(st.snap, target, st.blend) : target;
    st.solved = solveSkeleton(st.out, H);
    return st.solved;
  }
  function switchMode(mode) {
    if (st.out) st.snap = clonePose(st.out);
    st.mode = mode; st.blend = st.snap ? 0 : 1;
  }
  const setYaw = (y) => { st.yaw = y; root.rotation.z = -y; };
  const handLocal = () => (st.solved || evalPose()).joints.handR;
  const toWorld = (v) => {
    const r = twist(v, st.yaw);
    return { x: root.position.x + r[0], y: root.position.y + r[1], z: root.position.z + r[2] };
  };
  const handWorldPosition = () => toWorld(handLocal());

  function updateLook(dt) {
    let ty = 0, tp = 0;
    if (st.look && st.solved) {
      const hw = twist(st.solved.joints.head, st.yaw);
      const d = [st.look.x - root.position.x - hw[0], st.look.y - root.position.y - hw[1], st.look.z - root.position.z - hw[2]];
      const l = twist(d, -st.yaw);
      ty = atan2(l[0], l[1]); tp = -atan2(l[2], sqrt(l[0] * l[0] + l[1] * l[1]));
    }
    const k = 1 - Math.exp(-dt * 8);
    st.lookSm.yaw += (ty - st.lookSm.yaw) * k;
    st.lookSm.pitch += (tp - st.lookSm.pitch) * k;
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
          if (w.stage === 'turn1') { w.stage = w.dist > 0.02 ? 'go' : 'turn2'; } else w.stage = 'done';
        } else setYaw(st.yaw + Math.sign(dy) * step);
      } else if (w.stage === 'go') {
        const step = min(w.speed * dt, w.dist - w.moved);
        w.moved += step;
        root.position.x += sin(st.yaw) * step; root.position.y += cos(st.yaw) * step;
        w.phase += w.speed * dt / (4 * 0.18 * H) * 2 * PI;
        if (w.dist - w.moved < 1e-6) {
          root.position.x = w.target.x; root.position.y = w.target.y; w.stage = 'turn2';
        }
      }
      if (w.stage === 'done') {
        st.walk = null;
        switchMode('stance');
        w.resolve();
      }
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
        st.holding = false; holdMesh.visible = false;
        evalPose();
        const pos = handWorldPosition();
        if (th.onRelease) th.onRelease(pos);
        left -= h;
        if (h === 0) left -= 1e-9;
        continue;
      }
      advance(h); left -= h;
    }
  }

  function applyMeshes() {
    const { joints: j, frames } = st.solved;
    for (const c of caps) {
      va.set(...j[c.a]); vb.set(...j[c.b]);
      c.me.position.copy(va).add(vb).multiplyScalar(0.5);
      vd.copy(vb).sub(va);
      if (vd.lengthSq() > 1e-12) { q.setFromUnitVectors(yAxis, vd.normalize()); c.me.quaternion.copy(q); }
    }
    // shoulder and hip bars: capsule axis spans exactly the joints, shorten by nothing
    ['L', 'R'].forEach((n, i) => {
      hands[i].position.set(...j['hand' + n]);
      const a = j['ankle' + n], f = j['foot' + n];
      const fm = feetMeshes[i];
      const z = a[2] - L.ankleH + H * 0.028;
      va.set(a[0], a[1], z); vb.set(f[0], f[1], z);
      fm.position.copy(va).add(vb).multiplyScalar(0.5);
      vd.copy(vb).sub(va).normalize(); fm.quaternion.setFromUnitVectors(yAxis, vd);
    });
    const [hx, hy, hz] = frames.head;
    m4.makeBasis(va.set(...hx), vb.set(...hy), vd.set(...hz));
    m4.setPosition(...j.head);
    headG.matrix.copy(m4); headG.matrixWorldNeedsUpdate = true;
    headG.matrixWorld.copy(headG.matrix); // parent is root; recomputed on render
    if (belly) {
      const [cx, cy, cz] = frames.chest;
      const o = (cy.map((v) => v * H * 0.05));
      belly.position.set(j.spine[0] + o[0] - cz[0] * H * 0.02, j.spine[1] + o[1] - cz[1] * H * 0.02, j.spine[2] + o[2] - cz[2] * H * 0.02 + 0.0);
      belly.quaternion.setFromRotationMatrix(m4.makeBasis(va.set(...cx), vb.set(...cy), vd.set(...cz)));
    }
    holdMesh.position.set(...j.handR); holdMesh.position.z -= H * 0.025;
  }

  function update(dt) {
    if (!(dt > 0)) dt = 0;
    if (!st.solved) evalPose();
    updateLook(dt);
    step(dt);
    evalPose();
    applyMeshes();
  }

  // ----- public API -----
  function setStance(name) {
    const valid = ['idle', 'aim', 'crouch', 'stand', 'watch', 'celebrate', 'dismay'];
    if (!valid.includes(name)) throw new Error('unknown stance ' + name);
    if (st.mode === 'throw') cancelThrow();
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
    if (st.walk) st.walk.resolve();
    return new Promise((resolve) => {
      const dx = target.x - root.position.x, dy = target.y - root.position.y;
      const dist = sqrt(dx * dx + dy * dy);
      const heading = dist > 0.02 ? atan2(dx, dy) : st.yaw;
      const ty = target.yaw === undefined ? heading : target.yaw;
      st.walk = {
        target: { x: target.x, y: target.y, yaw: ty }, dist, moved: 0, heading, phase: 0, stage: 'turn1', resolve, speed: target.speed || WALK_SPEED,
      };
      switchMode('walk');
    });
  }
  function playThrow({ loft = 0.5, onRelease } = {}) {
    if (st.mode === 'throw') cancelThrow();
    if (st.walk) { const w = st.walk; st.walk = null; w.resolve(); }
    return new Promise((resolve) => {
      st.throwing = { t: 0, tRel: releaseTime(loft), released: false, onRelease, done: resolve, loft };
      switchMode('throw');
    });
  }
  function setHolding(on) { st.holding = !!on; holdMesh.visible = st.holding; }
  function lookAt(x, y, z) {
    st.look = x === null || x === undefined ? null : { x, y, z: z === undefined ? 1.5 : z };
  }
  function setPlacement(x, y, yaw = st.yaw) { root.position.set(x, y, root.position.z); setYaw(yaw); }
  function dispose() {
    if (st.walk) { const w = st.walk; st.walk = null; w.resolve(); }
    if (st.throwing) cancelThrow();
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    if (root.parent) root.parent.remove(root);
  }

  evalPose();
  applyMeshes();
  return {
    root, update, setStance, walkTo, playThrow, handWorldPosition, dispose,
    lookAt, setHolding, setPlacement,
    get yaw() { return st.yaw; },
    set yaw(v) { setYaw(v); },
    get stance() { return st.stance; },
    get busy() { return st.mode !== 'stance'; },
    skeleton: () => (st.solved || evalPose()).joints, // root-space joints (for tests and debugging)
    height: H,
  };
}
