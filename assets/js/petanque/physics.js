// Fixed-step rigid-sphere physics for boules and the jack.
// Axes: x across, y along, z up. z is the height of the ball centre.
// Contact velocity at the ground is v + w x (-r n); a solid sphere has I = 2/5 m r^2.
import { C } from './constants.js';
import { court } from './court.js';

let nextId = 1;

// Body: kind 'boule' | 'jack'. Placed bodies default to 'resting'; world.add snaps them to the ground.
export function createBody(kind, props = {}) {
  const spec = kind === 'jack' ? C.jack : C.boule;
  const r = props.r !== undefined ? props.r : spec.r;
  return {
    id: nextId++, kind, team: -1, owner: null,
    x: 0, y: 0, z: r, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
    r, m: spec.m, state: 'resting', dead: false, ghost: false, ghostT: 0, restT: 0,
    hx: 0, hy: 0, rev: 0, // travel heading for the reverse-roll cap, reverse distance so far
    ...props,
  };
}

// yaw 0 = +y, positive yaw toward +x. Backspin opposes the forward roll; sidespin is about +z.
export function launch(body, p, from = p.from || court.throwFrom) {
  const dx = Math.sin(p.yaw), dy = Math.cos(p.yaw);
  const cl = Math.cos(p.loft), sl = Math.sin(p.loft);
  const bs = p.backspin || 0;
  body.x = from.x; body.y = from.y; body.z = from.z;
  body.vx = p.speed * cl * dx; body.vy = p.speed * cl * dy; body.vz = p.speed * sl;
  body.wx = bs * dy; body.wy = -bs * dx; body.wz = p.sidespin || 0;
  body.state = 'airborne'; body.dead = false; body.ghost = false; body.ghostT = 0; body.restT = 0;
  body.fresh = true; // F90: no out-of-bounds judgement until the first contact (the hand/release point may be beyond a string)
  body.hx = dx; body.hy = dy; body.rev = 0;
  return body;
}

function sqr(a) { return a * a; }
const clampv = (v, a, b) => (v < a ? a : v > b ? b : v);

// Lumber: four static axis-aligned boxes round the court. Left and right run the full length, near and far
// butt between them. x0..x1, y0..y1, z0..z1 in metres.
export const LUMBER = (() => {
  const g = C.lumberGap, s = C.lumberSize, W = C.terrainW, L = C.terrainL, z0 = -0.1, z1 = s;
  return Object.freeze([
    Object.freeze({ name: 'left', x0: -g - s, x1: -g, y0: -g - s, y1: L + g + s, z0, z1 }),
    Object.freeze({ name: 'right', x0: W + g, x1: W + g + s, y0: -g - s, y1: L + g + s, z0, z1 }),
    Object.freeze({ name: 'near', x0: -g, x1: W + g, y0: -g - s, y1: -g, z0, z1 }),
    Object.freeze({ name: 'far', x0: -g, x1: W + g, y0: L + g, y1: L + g + s, z0, z1 }),
  ]);
})();

// Beyond the outer face of the timbers (the heavy ground)
function outside(x, y) {
  const o = C.lumberGap + C.lumberSize;
  return x < -o || x > C.terrainW + o || y < -o || y > C.terrainL + o;
}

// Sphere against a static box: push out, bounce with wood restitution, Coulomb friction with spin
function boxContact(w, b, bx) {
  const px = clampv(b.x, bx.x0, bx.x1), py = clampv(b.y, bx.y0, bx.y1), pz = clampv(b.z, bx.z0, bx.z1);
  let dx = b.x - px, dy = b.y - py, dz = b.z - pz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= b.r * b.r) return;
  let pen;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    dx /= d; dy /= d; dz /= d; pen = b.r - d;
  } else { // centre inside the box: leave by the nearest face
    const c = [[b.x - bx.x0, -1, 0, 0], [bx.x1 - b.x, 1, 0, 0], [b.y - bx.y0, 0, -1, 0], [bx.y1 - b.y, 0, 1, 0], [bx.z1 - b.z, 0, 0, 1]];
    let m = c[0];
    for (const q of c) if (q[0] < m[0]) m = q;
    dx = m[1]; dy = m[2]; dz = m[3]; pen = m[0] + b.r;
  }
  b.x += dx * pen; b.y += dy * pen; b.z += dz * pen;
  b.fresh = false; // F90
  const vn = b.vx * dx + b.vy * dy + b.vz * dz;
  if (vn < 0) {
    const e = vn < -0.3 ? C.lumberRestitution : 0;
    const jn = -(1 + e) * vn;
    b.vx += jn * dx; b.vy += jn * dy; b.vz += jn * dz;
    const r = b.r;
    const cx = b.vx + r * (dy * b.wz - dz * b.wy), cy = b.vy + r * (dz * b.wx - dx * b.wz), cz = b.vz + r * (dx * b.wy - dy * b.wx);
    const cn = cx * dx + cy * dy + cz * dz;
    const tx = cx - cn * dx, ty = cy - cn * dy, tz = cz - cn * dz;
    const ts = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (ts > 1e-9) {
      const jt = Math.min(C.lumberFriction * jn, ts / 3.5);
      const fx = -tx / ts * jt, fy = -ty / ts * jt, fz = -tz / ts * jt;
      b.vx += fx; b.vy += fy; b.vz += fz;
      const k = 1 / (0.4 * r * r);
      b.wx += -r * (dy * fz - dz * fy) * k;
      b.wy += -r * (dz * fx - dx * fz) * k;
      b.wz += -r * (dx * fy - dy * fx) * k;
    }
    if (-vn > C.stoneEventSpeed) w.events.push({ type: 'lumber', t: w.t, a: b.id, x: b.x, y: b.y, speed: -vn });
    bv(b);
    if (b.state !== 'airborne' && b.vz > C.hopSpeed) b.state = 'airborne';
  }
  if (dz > 0.7 && b.state === 'airborne') { // perched on the narrow top: slide off along the short axis
    const ax = bx.x1 - bx.x0 < bx.y1 - bx.y0;
    const sgn = ax ? (b.x < (bx.x0 + bx.x1) / 2 ? -1 : 1) : (b.y < (bx.y0 + bx.y1) / 2 ? -1 : 1);
    if (ax) b.vx += sgn * 4 * C.dt; else b.vy += sgn * 4 * C.dt;
  }
}

// Stones are fixed spheres; resolve overlap and bounce. Returns true if touched.
function stoneContacts(w, b) {
  const list = w.terrain.stonesNear(b.x, b.y, b.r);
  let hit = false;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let dx = b.x - s.x, dy = b.y - s.y, dz = b.z - s.h;
    const R = b.r + s.r;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= R * R) continue;
    const d = Math.sqrt(d2) || 1e-9;
    dx /= d; dy /= d; dz /= d;
    const pen = R - d;
    b.x += dx * pen; b.y += dy * pen; b.z += dz * pen;
    const vn = b.vx * dx + b.vy * dy + b.vz * dz;
    hit = true;
    if (vn < 0) {
      const rock = s.r > C.pebbleR[1];
      const e = vn < -0.05 ? (rock ? C.stoneRestitution : C.pebbleRestitution) : 0;
      const f = rock ? 1 : Math.min(1, C.stoneMassRef / b.m);
      const k = -(1 + e) * vn * f;
      b.vx += k * dx; b.vy += k * dy; b.vz += k * dz;
      if (rock) bv(b); // a rock is a real deflector: the new direction is the heading
      if (-vn > C.stoneEventSpeed) w.events.push({ type: 'stone', t: w.t, a: b.id, x: b.x, y: b.y, speed: -vn });
    }
  }
  return hit;
}

// Project velocity onto the tangent plane of the ground
function toTangent(b, s) {
  const vn = b.vx * s.nx + b.vy * s.ny + b.vz * s.nz;
  b.vx -= vn * s.nx; b.vy -= vn * s.ny; b.vz -= vn * s.nz;
}

// Airborne body reaches the ground: normal restitution + Coulomb friction impulse
function land(w, b, s) {
  b.fresh = false; // F90
  b.z = s.h + b.r;
  // the ball lands on a random pebble face: the effective normal tilts a little (the jack more than a boule)
  const tilt = C.landTilt * Math.sqrt(Math.min(2.25, C.stoneMassRef / b.m));
  let nx = s.nx + (w.rand() * 2 - 1) * tilt, ny = s.ny + (w.rand() * 2 - 1) * tilt, nz = s.nz;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  nx /= nl; ny /= nl; nz /= nl;
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return;
  const impact = -vn;
  const hs = Math.hypot(b.vx, b.vy);
  if (hs > 0.3 && b.hx === 0 && b.hy === 0) { b.hx = b.vx / hs; b.hy = b.vy / hs; }
  const out = outside(b.x, b.y);
  const lo = out ? 1 : s.loose; // heavy, soft ground beyond the timbers
  let e = C.restitutionNormalMax - (C.restitutionNormalMax - C.restitutionNormalMin) * lo;
  e *= 1 + C.restitutionJitter * (w.rand() * 2 - 1);
  e /= 1 + C.landBounceDamp * impact;
  const rolling = e * impact < C.bounceMin;
  if (rolling) e = 0;
  const jn = b.m * (1 + e) * impact;
  b.vx += jn / b.m * nx; b.vy += jn / b.m * ny; b.vz += jn / b.m * nz;
  // contact velocity v + w x (-r n) = v + r (n x w)
  const r = b.r;
  const cx = b.vx + r * (ny * b.wz - nz * b.wy);
  const cy = b.vy + r * (nz * b.wx - nx * b.wz);
  const cz = b.vz + r * (nx * b.wy - ny * b.wx);
  const cn = cx * nx + cy * ny + cz * nz;
  const tx = cx - cn * nx, ty = cy - cn * ny, tz = cz - cn * nz;
  const ts = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (ts > 1e-9) {
    const jt = Math.min(C.contactFriction * jn, b.m * ts / 3.5);
    const fx = -tx / ts * jt, fy = -ty / ts * jt, fz = -tz / ts * jt;
    b.vx += fx / b.m; b.vy += fy / b.m; b.vz += fz / b.m;
    // torque = (-r n) x f, I = 0.4 m r^2
    const k = 1 / (0.4 * b.m * r * r);
    b.wx += -r * (ny * fz - nz * fy) * k;
    b.wy += -r * (nz * fx - nx * fz) * k;
    b.wz += -r * (nx * fy - ny * fx) * k;
  }
  // loose ground soaks up forward energy, and a hard landing digs in and kills spin
  const hard = Math.max(0, Math.min(1, (impact - 4) / 5));
  const gl = 0.4 + 0.6 * lo;
  let drag = Math.max(0, 1 - C.landLooseDrag * lo * Math.min(1, impact / 5) - C.landDig * gl * hard);
  if (out) drag *= 1 - C.outsideLandDrag;
  const vn2 = b.vx * nx + b.vy * ny + b.vz * nz;
  b.vx = (b.vx - vn2 * nx) * drag + vn2 * nx;
  b.vy = (b.vy - vn2 * ny) * drag + vn2 * ny;
  b.vz = (b.vz - vn2 * nz) * drag + vn2 * nz;
  const sd = (1 - C.landSpinDamp * gl * hard) * (out ? 1 - C.outsideLandSpin : 1);
  b.wx *= sd; b.wy *= sd; b.wz *= sd;
  capReverse(b, 0);
  w.events.push({ type: 'land', t: w.t, a: b.id, x: b.x, y: b.y, speed: impact });
  if (!w.isClone && impact > C.divotMinSpeed) {
    const q = Math.min(2, impact / C.divotSpeedRef);
    w.terrain.addDivot(b.x, b.y, Math.min(C.divotDepthMax, C.divotDepthBase * q), C.divotRadiusBase * (0.7 + 0.3 * Math.min(1, q)));
  }
  if (rolling) { b.state = 'rolling'; toTangent(b, s); }
}

function stepAirborne(w, b, dt) {
  const k = 1 - C.airDrag * dt;
  b.vx *= k; b.vy *= k; b.vz = b.vz * k - C.gravity * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (b.state === 'airborne' && b.z - b.r < 0.3) capReverse(b, dt);
  if (b.z - b.r > C.lowAirZ + C.maxHeight) return;
  const hit = stoneContacts(w, b);
  if (hit) b.fresh = false; // F90
  const s = w.terrain.sample(b.x, b.y);
  if (b.z - b.r <= s.h) {
    land(w, b, s);
  } else if (hit && b.z - b.r - s.h < 0.03) {
    const vn = b.vx * s.nx + b.vy * s.ny + b.vz * s.nz;
    if (Math.abs(vn) < C.bounceMin) { b.state = 'rolling'; toTangent(b, s); }
  }
}

// Backspin checks a boule: it may creep back a little, never roll back far
function capReverse(b, dt) {
  if (b.hx === 0 && b.hy === 0) return;
  const vb = -(b.vx * b.hx + b.vy * b.hy);
  if (vb <= 0) return;
  if (dt) b.rev += vb * dt;
  const cap = b.rev > C.reverseDistMax ? 0 : C.reverseSpeedMax;
  if (vb > cap) { const k = vb - cap; b.vx += k * b.hx; b.vy += k * b.hy; }
}

function stepRolling(w, b, dt) {
  b.x += b.vx * dt; b.y += b.vy * dt;
  const s = w.terrain.sample(b.x, b.y);
  b.z = s.h + b.r;
  const nx = s.nx, ny = s.ny, nz = s.nz, r = b.r, g = C.gravity;
  toTangent(b, s);
  // gravity along the slope
  const gn = -g * nz;
  b.vx += (0 - gn * nx) * dt; b.vy += (0 - gn * ny) * dt; b.vz += (-g - gn * nz) * dt;
  // slip friction drives the contact point toward rolling without slipping
  const cx = b.vx + r * (ny * b.wz - nz * b.wy);
  const cy = b.vy + r * (nz * b.wx - nx * b.wz);
  const cz = b.vz + r * (nx * b.wy - ny * b.wx);
  const cn = cx * nx + cy * ny + cz * nz;
  const tx = cx - cn * nx, ty = cy - cn * ny, tz = cz - cn * nz;
  const ts = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (ts > 1e-6) {
    const jt = Math.min(C.slipFriction * b.m * g * nz * dt, b.m * ts / 3.5);
    const fx = -tx / ts * jt, fy = -ty / ts * jt, fz = -tz / ts * jt;
    b.vx += fx / b.m; b.vy += fy / b.m; b.vz += fz / b.m;
    const k = 1 / (0.4 * b.m * r * r);
    b.wx += -r * (ny * fz - nz * fy) * k;
    b.wy += -r * (nz * fx - nx * fz) * k;
    b.wz += -r * (nx * fy - ny * fx) * k;
  }
  // rolling resistance (static below the threshold, so slopes can hold a ball)
  const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
  const mur = outside(b.x, b.y) ? Math.max(s.friction, C.outsideRollResist) : s.friction;
  const d = mur * C.rollFriction * g * nz * dt;
  if (sp <= d) { b.vx = 0; b.vy = 0; b.vz = 0; } else {
    const f = (sp - d) / sp;
    b.vx *= f; b.vy *= f; b.vz *= f;
  }
  // spin about the normal (sidespin) decays
  const wn = b.wx * nx + b.wy * ny + b.wz * nz;
  const dk = wn * (1 - Math.exp(-C.spinDecay * dt));
  b.wx -= dk * nx; b.wy -= dk * ny; b.wz -= dk * nz;
  // stone kicks; a strong upward kick lifts the ball
  if (stoneContacts(w, b)) {
    const vn = b.vx * nx + b.vy * ny + b.vz * nz;
    if (vn > C.hopSpeed) { b.state = 'airborne'; return; }
    toTangent(b, s);
  }
  capReverse(b, dt);
  // rest detection
  const w2 = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz;
  if (sp < C.restSpeed && w2 < C.restSpin * C.restSpin) {
    b.restT += dt;
    if (b.restT >= C.restTime) {
      b.state = 'resting';
      b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0;
    }
  } else b.restT = 0;
  // E21: a ball held by static friction on a slope or stone can keep a little spin for ever (gravity feeds the
  // slip friction each step), so also rest a ball that has barely moved over a whole window
  if (b.state === 'rolling') {
    if (b.ax === undefined) { b.ax = b.x; b.ay = b.y; b.winT = 0; }
    b.winT += dt;
    if (b.winT >= C.restWindow) {
      if (Math.hypot(b.x - b.ax, b.y - b.ay) < C.restWindowDist && sp < C.restWindowSpeed) {
        b.state = 'resting'; b.restT = 0;
        b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0;
      }
      b.ax = b.x; b.ay = b.y; b.winT = 0;
    }
  }
}

// A knocked body gets a new heading for the reverse-roll cap
function bv(q) {
  const q2 = Math.hypot(q.vx, q.vy);
  if (q2 > 0.2) { q.hx = q.vx / q2; q.hy = q.vy / q2; q.rev = 0; }
}

// Sphere-sphere collision with mass-weighted separation, restitution and tangential friction
function collide(w, a, b) {
  let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const R = a.r + b.r;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= R * R) return;
  a.fresh = false; b.fresh = false; // F90
  const d = Math.sqrt(d2) || 1e-9;
  dx /= d; dy /= d; dz /= d;
  const pen = R - d;
  const ima = 1 / a.m, imb = 1 / b.m, ms = a.m + b.m;
  // grounded bodies cannot move vertically; their share goes to the partner
  const aG = a.state !== 'airborne', bG = b.state !== 'airborne';
  let za = b.m / ms, zb = a.m / ms;
  if (aG && !bG) { za = 0; zb = 1; } else if (bG && !aG) { zb = 0; za = 1; }
  a.x -= dx * pen * b.m / ms; a.y -= dy * pen * b.m / ms; a.z -= dz * pen * za;
  b.x += dx * pen * a.m / ms; b.y += dy * pen * a.m / ms; b.z += dz * pen * zb;
  // An airborne ball striking a grounded one from above (tir au fer): the ground takes the vertical part,
  // so the exchange is horizontal along the centre line and the shooter's vertical motion is left alone
  // (it drops, rather than being reflected up and back). Otherwise a full 3D normal.
  let nx = dx, ny = dy, nz = dz, lam = 1;
  if (aG !== bG && (aG ? b.z > a.z : a.z > b.z)) {
    const hl = Math.hypot(dx, dy);
    if (hl > 1e-6) { nx = dx / hl; ny = dy / hl; nz = 0; lam = hl; }
  }
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
  if (vn >= 0) return;
  const rel = Math.hypot(b.vx - a.vx, b.vy - a.vy, b.vz - a.vz); // full relative speed before impact (audio: directness = speed / rel)
  const e = (a.kind === 'jack' || b.kind === 'jack') ? C.boule2jack : C.boule2boule;
  const hz = 1 - nz * nz;
  const iea = aG ? ima * hz : ima, ieb = bG ? imb * hz : imb;
  const jn = -(1 + e) * vn / (iea + ieb) * lam;
  a.vx -= jn * ima * nx; a.vy -= jn * ima * ny; if (!aG) a.vz -= jn * ima * nz;
  b.vx += jn * imb * nx; b.vy += jn * imb * ny; if (!bG) b.vz += jn * imb * nz;
  // tangential friction at the contact: a's surface at +n, b's at -n
  const ra = a.r, rb = b.r;
  const sax = a.vx + ra * (ny * a.wz - nz * a.wy), say = a.vy + ra * (nz * a.wx - nx * a.wz), saz = a.vz + ra * (nx * a.wy - ny * a.wx);
  const sbx = b.vx - rb * (ny * b.wz - nz * b.wy), sby = b.vy - rb * (nz * b.wx - nx * b.wz), sbz = b.vz - rb * (nx * b.wy - ny * b.wx);
  let tx = sbx - sax, ty = sby - say, tz = sbz - saz;
  const tn = tx * nx + ty * ny + tz * nz;
  tx -= tn * nx; ty -= tn * ny; tz -= tn * nz;
  const ts = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (ts > 1e-9) {
    const ia = 1 / (0.4 * a.m), ib = 1 / (0.4 * b.m);
    const jt = Math.min(C.bodyFriction * jn, ts / (ima + imb + ia + ib));
    const fx = -tx / ts * jt, fy = -ty / ts * jt, fz = -tz / ts * jt; // impulse on b
    b.vx += fx * imb; b.vy += fy * imb; if (!bG) b.vz += fz * imb;
    a.vx -= fx * ima; a.vy -= fy * ima; if (!aG) a.vz -= fz * ima;
    // torque on b: (-rb n) x f ; on a: (ra n) x (-f)
    b.wx += -rb * (ny * fz - nz * fy) * ib / (rb * rb); b.wy += -rb * (nz * fx - nx * fz) * ib / (rb * rb); b.wz += -rb * (nx * fy - ny * fx) * ib / (rb * rb);
    a.wx += -ra * (ny * fz - nz * fy) * ia / (ra * ra); a.wy += -ra * (nz * fx - nx * fz) * ia / (ra * ra); a.wz += -ra * (nx * fy - ny * fx) * ia / (ra * ra);
  }
  bv(a); bv(b);
  const sp = -vn;
  w.events.push({ type: 'hit', t: w.t, a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed: sp, rel });
  if (a.state === 'resting') { a.state = 'rolling'; a.restT = 0; }
  if (b.state === 'resting') { b.state = 'rolling'; b.restT = 0; }
}

// Out-of-play row beyond the far string line, where D11's fetchers set dead boules down: they line up along x
// in slot order; the jack sits apart, centred, a little further out.
export function deadRowSlot(index) {
  const perRow = Math.floor((C.terrainW - 0.4) / C.deadSpacing) + 1;
  const out = 0.15 + Math.floor(index / perRow) * 0.1; // E10: past the string at the end being played toward
  return { x: 0.2 + (index % perRow) * C.deadSpacing, y: court.dir > 0 ? C.terrainL + out : -out };
}
export function deadJackSpot() { return { x: C.terrainW / 2, y: court.dir > 0 ? C.terrainL + 0.3 : -0.3 }; }

// Put a dead ball at rest on the ground at (x, y), out of play
export function placeDeadBall(world, body, x, y) {
  body.dead = true; body.ghost = true; body.ghostT = 0;
  if (body.outX === undefined) { body.outX = x; body.outY = y; }
  body.x = x; body.y = y;
  body.z = world.terrain.sample(x, y).h + body.r;
  body.vx = body.vy = body.vz = 0; body.wx = body.wy = body.wz = 0;
  body.state = 'resting'; body.restT = 0;
  return body;
}

// Fully across a string line: the ball is dead at once, turns ghost (keeps moving, touches only ground, stones
// and lumber) and records where it went out
function inLumber(b) {
  for (const bx of LUMBER) if (b.x > bx.x0 - b.r && b.x < bx.x1 + b.r && b.y > bx.y0 - b.r && b.y < bx.y1 + b.r && b.z - b.r < bx.z1) return true;
  return false;
}

// F10: the last in-bounds spot of a ball judged dead: where its centre last was inside the string lines (tracked each
// step as lx/ly, so it is the crossing point to within one step), held OUT_INSET inside every line
export const OUT_INSET = 0.02;
export function lastInBounds(b) {
  const x = Number.isFinite(b.lx) ? b.lx : b.x, y = Number.isFinite(b.ly) ? b.ly : b.y;
  const cl = (v, hi) => Math.max(OUT_INSET, Math.min(hi - OUT_INSET, v));
  return { x: cl(x, C.terrainW), y: cl(y, C.terrainL) };
}

function checkDead(w, b) {
  if (b.fresh) return; // F90: still in flight from the release, nothing touched yet
  const m = b.r + C.deadMargin;
  if (b.x < -m || b.x > C.terrainW + m || b.y > C.terrainL + m || b.y < -m) {
    b.dead = true; b.ghost = true; b.ghostT = 0;
    const o = lastInBounds(b); b.outX = o.x; b.outY = o.y; // F10: where it crossed the line, just inside it (AI sims aim by this; the jack's next ring goes here)
    w.events.push({ type: 'dead', t: w.t, a: b.id, x: b.x, y: b.y, speed: Math.hypot(b.vx, b.vy, b.vz) });
    if (w.isClone) { // AI sims only need to know it went out: a new ghost is stopped on the spot (saves sim time)
      b.state = 'resting'; b.restT = 0;
      b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0;
    }
  }
}

export function createWorld(terrain, rand = Math.random) {
  const w = {
    terrain, rand, bodies: [], events: [], t: 0,
    // Clones skip divots so AI sims never modify the real terrain
    isClone: false,
    add(body) {
      if (body.state !== 'airborne') {
        const s = terrain.sample(body.x, body.y);
        body.z = s.h + body.r;
      }
      body.restT = body.restT || 0;
      w.bodies.push(body);
      return body;
    },
    step() {
      const dt = C.dt, bs = w.bodies, n = bs.length;
      for (let i = 0; i < n; i++) {
        const b = bs[i];
        if (b.state === 'resting') continue;
        if (b.state === 'airborne') stepAirborne(w, b, dt); else stepRolling(w, b, dt);
        for (let k = 0; k < LUMBER.length; k++) boxContact(w, b, LUMBER[k]);
        if (b.ghost) { // a ghost still moving after ghostMaxTime is stopped where it is
          b.ghostT += dt;
          if (b.ghostT > C.ghostMaxTime) {
            b.state = 'resting'; b.restT = 0;
            b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0;
            if (b.z - b.r > w.terrain.sample(b.x, b.y).h + 0.001 && !inLumber(b)) b.z = w.terrain.sample(b.x, b.y).h + b.r;
          }
        }
        const sp2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
        if (!(sp2 < C.maxSpeed * C.maxSpeed)) { // also catches NaN
          const f = sp2 === sp2 ? C.maxSpeed / Math.sqrt(sp2) : 0;
          b.vx *= f; b.vy *= f; b.vz *= f;
        }
      }
      for (let i = 0; i < n; i++) {
        const a = bs[i];
        if (a.ghost) continue; // ghosts pass through everything but ground, stones and lumber
        for (let j = i + 1; j < n; j++) {
          const b = bs[j];
          if (b.ghost || (a.state === 'resting' && b.state === 'resting')) continue;
          collide(w, a, b);
        }
      }
      for (let i = 0; i < n; i++) {
        const q = bs[i];
        if (q.ghost || q.dead) continue;
        if (q.x >= 0 && q.x <= C.terrainW && q.y >= 0 && q.y <= C.terrainL) { q.lx = q.x; q.ly = q.y; } // F10
        checkDead(w, q);
      }
      w.t += dt;
    },
    settled() {
      for (let i = 0; i < w.bodies.length; i++) {
        const b = w.bodies[i];
        if (b.state !== 'resting') return false;
      }
      return true;
    },
    // E21 hard cap: stop every moving body where it is (airborne ones drop to the ground unless over the lumber).
    // Returns a description of each body it had to stop.
    forceRest() {
      const out = [];
      for (const b of w.bodies) {
        if (b.state === 'resting') continue;
        out.push({ id: b.id, kind: b.kind, state: b.state, ghost: b.ghost, dead: b.dead, x: b.x, y: b.y, z: b.z, speed: Math.hypot(b.vx, b.vy, b.vz), spin: Math.hypot(b.wx, b.wy, b.wz) });
        b.state = 'resting'; b.restT = 0;
        b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0;
        if (!(b.x === b.x && b.y === b.y && b.z === b.z)) { b.x = b.x === b.x ? b.x : 0; b.y = b.y === b.y ? b.y : 0; }
        const h = w.terrain.sample(b.x, b.y).h;
        if (!inLumber(b)) b.z = h + b.r;
      }
      return out;
    },
    // Deep copy for AI sims. Pass a terrain (e.g. terrain.perceived()) and/or an rng to swap them
    // (the rng is shared with the original by default); clones never write divots.
    clone(terrainOverride, randOverride) {
      const c = createWorld(terrainOverride || terrain, randOverride || rand);
      c.isClone = true;
      c.t = w.t;
      c.bodies = w.bodies.map((b) => ({ ...b }));
      return c;
    },
  };
  return w;
}

export function simulate(world, maxSeconds = 20) {
  const end = world.t + maxSeconds;
  while (!world.settled() && world.t < end) world.step();
  if (!world.settled()) world.forceRest(); // bounded: whatever is still moving stops where it is
  return world;
}
