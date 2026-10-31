// Fixed-step rigid-sphere physics for boules and the jack.
// Axes: x across, y along, z up. z is the height of the ball centre.
// Contact velocity at the ground is v + w x (-r n); a solid sphere has I = 2/5 m r^2.
import { C } from './constants.js';

let nextId = 1;

// Body: kind 'boule' | 'jack'. Placed bodies default to 'resting'; world.add snaps them to the ground.
export function createBody(kind, props = {}) {
  const spec = kind === 'jack' ? C.jack : C.boule;
  const r = props.r !== undefined ? props.r : spec.r;
  return {
    id: nextId++, kind, team: -1, owner: null,
    x: 0, y: 0, z: r, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
    r, m: spec.m, state: 'resting', dead: false, restT: 0,
    ...props,
  };
}

// yaw 0 = +y, positive yaw toward +x. Backspin opposes the forward roll; sidespin is about +z.
export function launch(body, p, from = C.throwFrom) {
  const dx = Math.sin(p.yaw), dy = Math.cos(p.yaw);
  const cl = Math.cos(p.loft), sl = Math.sin(p.loft);
  const bs = p.backspin || 0;
  body.x = from.x; body.y = from.y; body.z = from.z;
  body.vx = p.speed * cl * dx; body.vy = p.speed * cl * dy; body.vz = p.speed * sl;
  body.wx = bs * dy; body.wy = -bs * dx; body.wz = p.sidespin || 0;
  body.state = 'airborne'; body.dead = false; body.restT = 0;
  return body;
}

function sqr(a) { return a * a; }

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
      const e = vn < -0.05 ? C.stoneRestitution : 0;
      const k = -(1 + e) * vn;
      b.vx += k * dx; b.vy += k * dy; b.vz += k * dz;
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
  b.z = s.h + b.r;
  const nx = s.nx, ny = s.ny, nz = s.nz;
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return;
  const impact = -vn;
  let e = C.restitutionNormalMax - (C.restitutionNormalMax - C.restitutionNormalMin) * s.loose;
  e *= 1 + C.restitutionJitter * (w.rand() * 2 - 1);
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
  // loose ground soaks up some forward energy
  const drag = 1 - C.landLooseDrag * s.loose * Math.min(1, impact / 5);
  const vn2 = b.vx * nx + b.vy * ny + b.vz * nz;
  b.vx = (b.vx - vn2 * nx) * drag + vn2 * nx;
  b.vy = (b.vy - vn2 * ny) * drag + vn2 * ny;
  b.vz = (b.vz - vn2 * nz) * drag + vn2 * nz;
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
  if (b.z - b.r > C.lowAirZ + C.maxHeight) return;
  const hit = stoneContacts(w, b);
  const s = w.terrain.sample(b.x, b.y);
  if (b.z - b.r <= s.h) {
    land(w, b, s);
  } else if (hit && b.z - b.r - s.h < 0.03) {
    const vn = b.vx * s.nx + b.vy * s.ny + b.vz * s.nz;
    if (Math.abs(vn) < C.bounceMin) { b.state = 'rolling'; toTangent(b, s); }
  }
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
  const d = s.friction * C.rollFriction * g * nz * dt;
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
  // rest detection
  const w2 = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz;
  if (sp < C.restSpeed && w2 < C.restSpin * C.restSpin) {
    b.restT += dt;
    if (b.restT >= C.restTime) {
      b.state = 'resting';
      b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0;
    }
  } else b.restT = 0;
}

// Sphere-sphere collision with mass-weighted separation, restitution and tangential friction
function collide(w, a, b) {
  let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const R = a.r + b.r;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= R * R) return;
  const d = Math.sqrt(d2) || 1e-9;
  dx /= d; dy /= d; dz /= d;
  const pen = R - d;
  const ima = 1 / a.m, imb = 1 / b.m, ms = a.m + b.m;
  // grounded bodies cannot move vertically; their share goes to the partner
  const aG = a.state !== 'airborne', bG = b.state !== 'airborne';
  const hz = 1 - dz * dz; // horizontal share of the normal for a grounded body
  let za = b.m / ms, zb = a.m / ms;
  if (aG && !bG) { za = 0; zb = 1; } else if (bG && !aG) { zb = 0; za = 1; }
  a.x -= dx * pen * b.m / ms; a.y -= dy * pen * b.m / ms; a.z -= dz * pen * za;
  b.x += dx * pen * a.m / ms; b.y += dy * pen * a.m / ms; b.z += dz * pen * zb;
  const vn = (b.vx - a.vx) * dx + (b.vy - a.vy) * dy + (b.vz - a.vz) * dz;
  if (vn >= 0) return;
  const e = (a.kind === 'jack' || b.kind === 'jack') ? C.boule2jack : C.boule2boule;
  const iea = aG ? ima * hz : ima, ieb = bG ? imb * hz : imb;
  const jn = -(1 + e) * vn / (iea + ieb);
  a.vx -= jn * ima * dx; a.vy -= jn * ima * dy; if (!aG) a.vz -= jn * ima * dz;
  b.vx += jn * imb * dx; b.vy += jn * imb * dy; if (!bG) b.vz += jn * imb * dz;
  // tangential friction at the contact: a's surface at +n, b's at -n
  const ra = a.r, rb = b.r;
  const sax = a.vx + ra * (dy * a.wz - dz * a.wy), say = a.vy + ra * (dz * a.wx - dx * a.wz), saz = a.vz + ra * (dx * a.wy - dy * a.wx);
  const sbx = b.vx - rb * (dy * b.wz - dz * b.wy), sby = b.vy - rb * (dz * b.wx - dx * b.wz), sbz = b.vz - rb * (dx * b.wy - dy * b.wx);
  let tx = sbx - sax, ty = sby - say, tz = sbz - saz;
  const tn = tx * dx + ty * dy + tz * dz;
  tx -= tn * dx; ty -= tn * dy; tz -= tn * dz;
  const ts = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (ts > 1e-9) {
    const ia = 1 / (0.4 * a.m), ib = 1 / (0.4 * b.m);
    const jt = Math.min(C.bodyFriction * jn, ts / (ima + imb + ia + ib));
    const fx = -tx / ts * jt, fy = -ty / ts * jt, fz = -tz / ts * jt; // impulse on b
    b.vx += fx * imb; b.vy += fy * imb; b.vz += fz * imb;
    a.vx -= fx * ima; a.vy -= fy * ima; a.vz -= fz * ima;
    // torque on b: (-rb n) x f ; on a: (ra n) x (-f)
    b.wx += -rb * (dy * fz - dz * fy) * ib / (rb * rb); b.wy += -rb * (dz * fx - dx * fz) * ib / (rb * rb); b.wz += -rb * (dx * fy - dy * fx) * ib / (rb * rb);
    a.wx += -ra * (dy * fz - dz * fy) * ia / (ra * ra); a.wy += -ra * (dz * fx - dx * fz) * ia / (ra * ra); a.wz += -ra * (dx * fy - dy * fx) * ia / (ra * ra);
  }
  const sp = -vn;
  w.events.push({ type: 'hit', t: w.t, a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed: sp });
  if (a.state === 'resting') { a.state = 'rolling'; a.restT = 0; }
  if (b.state === 'resting') { b.state = 'rolling'; b.restT = 0; }
}

function checkDead(w, b) {
  const m = b.r + C.deadMargin;
  if (b.x < -m || b.x > C.terrainW + m || b.y > C.terrainL + m || b.y < -m) {
    b.dead = true;
    b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0;
    w.events.push({ type: 'dead', t: w.t, a: b.id, x: b.x, y: b.y, speed: 0 });
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
        if (b.dead || b.state === 'resting') continue;
        if (b.state === 'airborne') stepAirborne(w, b, dt); else stepRolling(w, b, dt);
        const sp2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
        if (!(sp2 < C.maxSpeed * C.maxSpeed)) { // also catches NaN
          const f = sp2 === sp2 ? C.maxSpeed / Math.sqrt(sp2) : 0;
          b.vx *= f; b.vy *= f; b.vz *= f;
        }
      }
      for (let i = 0; i < n; i++) {
        const a = bs[i];
        if (a.dead) continue;
        for (let j = i + 1; j < n; j++) {
          const b = bs[j];
          if (b.dead || (a.state === 'resting' && b.state === 'resting')) continue;
          collide(w, a, b);
        }
      }
      for (let i = 0; i < n; i++) if (!bs[i].dead) checkDead(w, bs[i]);
      w.t += dt;
    },
    settled() {
      for (let i = 0; i < w.bodies.length; i++) {
        const b = w.bodies[i];
        if (!b.dead && b.state !== 'resting') return false;
      }
      return true;
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
  return world;
}
