// F69: ducks on the lake. Pure wander logic (createDuckFlock, no three.js) plus the tiny low-poly meshes (makeDucks).
// createDuckFlock(seed, { cx, lakeContains, groups }) -> { ducks, step(dt, avoid) }. World metres (x includes the court centre cx);
// headings are maths angles in the x/y plane. Ducks swim in small groups (2-3): the leader holds a heading toward a mark at least
// 20 m away (long straight stretches, slow curvature-limited turns, speed 0.2-0.6 m/s), the others trail it in a loose cluster.
// Marks sit in the shore band (6-20 m inside the shore) and mostly on the near / side shores (the sailboats take the far side).
// avoid: null or { x, y, r } (the floatplane circle, same convention as sailboats.js): marks clear of it, hard guard on every move.
// There is no avoidance between ducks and boats.
import * as THREE from '../vendor/three.module.js';
import { mulberry32 } from './rng.js';
import { lakeDepth, LAKE_SHAPE } from './sailboats.js';

export const DUCK = {
  margin: 3, markMin: 6, markMax: 20, markDist: 20, markDistMax: 55, nearY: 108, // marks: shore band, 20-55 m away, mostly y < nearY
  vMin: 0.2, vMax: 0.6, followMax: 0.7, curvLead: 0.12, curvFollow: 0.35, // rad per metre travelled
  avoidR: 40, spread: 2.4,
};

export function createDuckFlock(seed, { cx = 0, lakeContains, groups } = {}) {
  const rand = mulberry32(seed * 6151 + 29);
  const depth = lakeContains ? (x, y) => (lakeContains(x, y) ? 100 : -1) : (x, y) => lakeDepth(x, y, cx);
  const inside = (x, y, m) => depth(x, y) >= m;
  const TAU = Math.PI * 2;
  const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  const tmp = { x: 0, y: 0 };
  const pickPoint = (lo, hi, ymax, pred, tries = 300) => {
    for (let i = 0; i < tries; i++) {
      const x = cx + (rand() * 2 - 1) * LAKE_SHAPE.ax, y = LAKE_SHAPE.cy + (rand() * 2 - 1) * LAKE_SHAPE.ay;
      const d = depth(x, y);
      if (d >= lo && d <= hi && y <= ymax && (!pred || pred(x, y))) { tmp.x = x; tmp.y = y; return true; }
    }
    return false;
  };
  const pickMark = (g, avoid) => {
    const nearOnly = rand() < 0.85;
    for (const ymax of nearOnly ? [DUCK.nearY, Infinity] : [Infinity]) {
      for (const [dmin, useHead, band] of [[DUCK.markDist, true, DUCK.markMin], [DUCK.markDist, false, DUCK.markMin], [12, false, 4]]) {
        const ok = pickPoint(band, DUCK.markMax, ymax, (x, y) => {
          const dx = x - g.x, dy = y - g.y, d = Math.hypot(dx, dy);
          return d >= dmin && d <= DUCK.markDistMax && (!avoid || Math.hypot(x - avoid.x, y - avoid.y) > avoid.r + 8)
            && (!useHead || Math.abs(wrap(Math.atan2(dy, dx) - g.heading)) < 1.4);
        });
        if (ok) { g.wx = tmp.x; g.wy = tmp.y; g.legV = DUCK.vMin + rand() * (DUCK.vMax - DUCK.vMin); return; }
      }
    }
    g.wx = g.x; g.wy = g.y; g.legV = DUCK.vMin;
  };

  const sizes = groups || [2 + Math.floor(rand() * 2), 2 + Math.floor(rand() * 2)];
  const ducks = [], leaders = [];
  for (let gi = 0; gi < sizes.length; gi++) {
    pickPoint(8, DUCK.markMax, DUCK.nearY, (x, y) => leaders.every((l) => Math.hypot(l.x - x, l.y - y) > 25)) || pickPoint(8, DUCK.markMax, Infinity);
    const g = { x: tmp.x, y: tmp.y, heading: rand() * TAU, speed: 0, wx: 0, wy: 0, legV: 0.3, leader: true, kind: 0, phase: rand() * 6.28, group: gi, ox: 0, oy: 0, dip: 0, dipCool: 5 + rand() * 20, dipT: -1 };
    pickMark(g, null);
    g.heading = Math.atan2(g.wy - g.y, g.wx - g.x); g.speed = g.legV;
    leaders.push(g); ducks.push(g);
    for (let k = 1; k < sizes[gi]; k++) {
      const a = rand() * TAU, r = 1 + rand() * 1.4;
      const ox = -Math.abs(Math.cos(a)) * r * 1.2 - 0.8, oy = Math.sin(a) * r; // slot behind / beside the leader (leader frame)
      const c = Math.cos(g.heading), s = Math.sin(g.heading);
      ducks.push({ x: g.x + ox * c - oy * s, y: g.y + ox * s + oy * c, heading: g.heading, speed: g.speed, leader: false, kind: rand() < 0.3 ? 1 : 0, phase: rand() * 6.28, group: gi, ox, oy, g, dip: 0, dipCool: 5 + rand() * 20, dipT: -1 });
    }
  }
  // kind: 0 drake (green head), 1 hen (brown); leaders are drakes

  function move(d, dt, avoid) {
    const nx = d.x + Math.cos(d.heading) * d.speed * dt, ny = d.y + Math.sin(d.heading) * d.speed * dt;
    let go = inside(nx, ny, DUCK.margin);
    if (go && avoid) { const dn = Math.hypot(nx - avoid.x, ny - avoid.y); if (dn < avoid.r && dn < Math.hypot(d.x - avoid.x, d.y - avoid.y)) go = false; }
    if (go) { d.x = nx; d.y = ny; return true; }
    d.speed *= 0.5; return false;
  }
  const steer = (d, want, curv, dt) => {
    const lim = curv * Math.max(d.speed, 0.05) * dt; // curvature-limited: heading change per metre bounded
    d.heading = wrap(d.heading + Math.max(-lim, Math.min(lim, wrap(want - d.heading))));
  };

  function step(dt, avoid) {
    if (!(dt > 0)) return;
    if (dt > 0.25) { const n = Math.ceil(dt / 0.25); for (let i = 0; i < n; i++) step(dt / n, avoid); return; }
    for (const d of ducks) {
      if (d.dipT >= 0) { d.dipT += dt; if (d.dipT > 1.8) { d.dipT = -1; d.dip = 0; } else d.dip = Math.sin(d.dipT / 1.8 * Math.PI); }
      else if ((d.dipCool -= dt) <= 0) { d.dipT = 0; d.dipCool = 12 + rand() * 40; }
    }
    for (const g of leaders) {
      let dist = Math.hypot(g.wx - g.x, g.wy - g.y);
      if (dist < 3) { pickMark(g, avoid); dist = Math.hypot(g.wx - g.x, g.wy - g.y); }
      let want = Math.atan2(g.wy - g.y, g.wx - g.x);
      const dPlane = avoid ? Math.hypot(g.x - avoid.x, g.y - avoid.y) : Infinity;
      const ok = (h) => {
        for (const f of [6, 12]) {
          const x = g.x + Math.cos(h) * f, y = g.y + Math.sin(h) * f;
          if (!inside(x, y, DUCK.margin + 1.5)) return false;
          if (avoid && dPlane >= avoid.r && Math.hypot(x - avoid.x, y - avoid.y) < avoid.r + 2) return false;
        }
        return true;
      };
      if (!ok(g.heading)) { pickMark(g, avoid); want = Math.atan2(g.wy - g.y, g.wx - g.x); }
      if (avoid && dPlane < avoid.r) want = Math.atan2(g.y - avoid.y, g.x - avoid.x);
      steer(g, want, DUCK.curvLead, dt);
      const vt = ok(g.heading) ? g.legV : DUCK.vMin * 0.5;
      g.speed += (vt - g.speed) * Math.min(1, dt * 0.5);
      g.speed = Math.max(0, Math.min(DUCK.vMax, g.speed));
      move(g, dt, avoid);
    }
    for (const d of ducks) {
      if (d.leader) continue;
      const g = d.g, c = Math.cos(g.heading), s = Math.sin(g.heading);
      const tx = g.x + d.ox * c - d.oy * s, ty = g.y + d.ox * s + d.oy * c;
      const dx = tx - d.x, dy = ty - d.y, dist = Math.hypot(dx, dy);
      const ahead = dx * c + dy * s; // how far the slot is ahead of the duck along the leader's heading
      // close to the slot: swim with the leader; far: head for it
      const want = dist > 1.2 ? Math.atan2(dy, dx) : g.heading;
      steer(d, want, DUCK.curvFollow, dt);
      const vt = Math.max(DUCK.vMin * 0.6, Math.min(DUCK.followMax, g.speed + ahead * 0.25 + (dist > 1.2 ? 0.1 : 0)));
      d.speed += (vt - d.speed) * Math.min(1, dt * 1.0);
      d.speed = Math.max(0, Math.min(DUCK.followMax, d.speed));
      move(d, dt, avoid);
    }
  }
  return { ducks, step };
}

// ---- meshes ---------------------------------------------------------------------------------------------
// Each duck: a faceted ellipsoid body (about 0.55 m long before the EXAGGERATE scale), a head+bill on a pivot (head dip), and a
// faint V wake quad pair trailing behind. Z is up, +x is forward, the water surface is z = 0 at the lake height.
const EXAGGERATE = 2.5;
const duckGeo = {};
function ellipsoid(tri, c, r, colorAt, nLon = 8, nLat = 4) {
  const pt = (i, j) => { // x along the long axis: j = 0 at the tail end (-x) to nLat at the front
    const a = j / nLat * Math.PI, ph = i / nLon * Math.PI * 2;
    return [c[0] - r[0] * Math.cos(a), c[1] + r[1] * Math.sin(a) * Math.cos(ph), c[2] + r[2] * Math.sin(a) * Math.sin(ph)];
  };
  for (let j = 0; j < nLat; j++) for (let i = 0; i < nLon; i++) {
    const a = pt(i, j), b = pt(i + 1, j), cc = pt(i + 1, j + 1), d = pt(i, j + 1);
    const col = colorAt((j + 0.5) / nLat, (i + 0.5) / nLon);
    if (j > 0) tri(a, b, cc, col[0], col[1]);
    if (j < nLat - 1) tri(a, cc, d, col[0], col[1]);
  }
}
function builder() {
  const pos = [], col = [];
  const tri = (a, b, c, hex, shade = 1) => {
    const k = new THREE.Color(hex).multiplyScalar(shade);
    pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) col.push(k.r, k.g, k.b);
  };
  const build = () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  };
  return { tri, build };
}
function buildBody(kind) {
  const { tri, build } = builder();
  const drake = kind === 0;
  ellipsoid(tri, [0, 0, 0.1], [0.28, 0.17, 0.12], (v, u) => {
    const shade = (u > 0.5 ? 0.78 : 1) * (0.9 + 0.1 * Math.sin(u * 12));
    if (v < 0.2) return [drake ? '#2b2b30' : '#5a4630', shade]; // tail
    if (drake) return [v > 0.72 && u < 0.5 ? '#6b4a30' : v < 0.45 ? '#9a9a9c' : '#a8a39a', shade]; // chestnut breast, grey flanks
    return ['#8a6a46', shade];
  });
  tri([-0.24, 0, 0.17], [-0.38, 0.03, 0.21], [-0.38, -0.03, 0.21], drake ? '#1f1f24' : '#5a4630'); // tail tip
  tri([0.0, 0.1, 0.2], [-0.2, 0.0, 0.22], [-0.05, -0.1, 0.2], drake ? '#8a8a8e' : '#7a5c3c'); // back patch
  return build();
}
function buildHead(kind) {
  const { tri, build } = builder();
  const drake = kind === 0;
  ellipsoid(tri, [0.03, 0, 0.03], [0.09, 0.07, 0.07], (v) => [drake ? '#1f7a45' : '#8a6a46', 1], 6, 3);
  if (drake) { // white neck ring
    tri([-0.07, 0.07, -0.02], [-0.07, -0.07, -0.02], [-0.02, 0, -0.06], '#f2f2f0');
    tri([-0.05, 0.08, 0.0], [-0.05, -0.08, 0.0], [-0.07, 0, -0.07], '#f2f2f0');
  }
  const bill = drake ? '#e0b020' : '#d98a2a';
  tri([0.1, 0.045, 0.0], [0.1, -0.045, 0.0], [0.2, 0, -0.01], bill);
  tri([0.1, 0.045, 0.0], [0.2, 0, -0.01], [0.1, 0, -0.035], bill, 0.85);
  tri([0.1, -0.045, 0.0], [0.1, 0, -0.035], [0.2, 0, -0.01], bill, 0.8);
  return build();
}
function buildWake() { // a faint V trailing behind (-x), centred on the duck
  const { tri, build } = builder();
  for (const s of [1, -1]) {
    tri([-0.2, 0.05 * s, 0], [-0.2, 0.2 * s, 0], [-2.2, 1.0 * s, 0], '#ffffff');
    tri([-0.2, 0.05 * s, 0], [-2.2, 1.0 * s, 0], [-2.2, 0.8 * s, 0], '#ffffff');
  }
  return build();
}

// Returns { group, flock, update(dt, reduced, plane, groundZ) }. cx: court centre x; z: the lake's water height.
export function makeDucks(cx, z, seed) {
  if (seed === undefined) seed = (typeof location !== 'undefined' && +new URLSearchParams(location.search).get('seed')) || (Date.now() % 100000);
  const flock = createDuckFlock(seed, { cx });
  if (!duckGeo.body) {
    duckGeo.body = [buildBody(0), buildBody(1)]; duckGeo.head = [buildHead(0), buildHead(1)]; duckGeo.wake = buildWake();
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, fog: true });
  const wakeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, fog: true });
  const group = new THREE.Group();
  const rigs = flock.ducks.map((d) => {
    const outer = new THREE.Group(), body = new THREE.Group(), head = new THREE.Group();
    outer.scale.setScalar(EXAGGERATE);
    const bm = new THREE.Mesh(duckGeo.body[d.kind], mat), hm = new THREE.Mesh(duckGeo.head[d.kind], mat);
    const wm = new THREE.Mesh(duckGeo.wake, wakeMat); wm.position.z = 0.03; wm.renderOrder = 1;
    for (const m of [bm, hm, wm]) m.frustumCulled = false;
    head.position.set(0.24, 0, 0.26); head.add(hm); body.add(bm); body.add(head);
    outer.add(body); outer.add(wm); group.add(outer);
    return { outer, body, head, ph: d.phase };
  });
  let t = 0;
  function place(reduced) {
    const bob = reduced ? 0 : 1;
    for (let i = 0; i < rigs.length; i++) {
      const d = flock.ducks[i], r = rigs[i];
      r.outer.position.set(d.x, d.y, z + 0.05);
      r.outer.rotation.z = d.heading;
      r.body.position.z = bob * Math.sin(t * 1.7 + r.ph) * 0.012 - 0.02;
      r.body.rotation.x = bob * Math.sin(t * 1.1 + r.ph * 2) * 0.05; // gentle roll
      r.body.rotation.y = bob * d.dip * -0.35; // tip forward for a dip
      r.head.rotation.y = bob * d.dip * 1.0; // head down
    }
  }
  place(false);
  const avoid = { x: 0, y: 0, r: DUCK.avoidR };
  return {
    group, flock,
    update(dt, reduced, plane, groundZ) {
      if (!(dt > 0)) return; // paused: frozen
      const k = reduced ? 0.1 : 1;
      t += dt * k;
      let av = null;
      if (plane && plane.active && plane.pos.z < groundZ + 12) { avoid.x = plane.pos.x; avoid.y = plane.pos.y; av = avoid; }
      flock.step(dt * k, av);
      place(reduced);
    },
  };
}
