// Surroundings for the court (D15): grass, grass tufts, trees and a painted sky panorama with Mount Rainier and
// the Seattle skyline. Everything is procedural (canvas textures and primitive meshes), nothing is downloaded.
import * as THREE from '../vendor/three.module.js';
import { C } from './constants.js';
import { mulberry32 } from './rng.js';
import { createSailFleet, SAIL } from './sailboats.js';

const TAU = Math.PI * 2;
const deg = (d) => d * Math.PI / 180;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Small viewports or dense screens get fewer tufts
export function isPhone() {
  try { return Math.min(window.innerWidth, window.innerHeight) < 600 || (window.devicePixelRatio || 1) > 2; } catch (e) { return false; }
}

// Distance outside the outer face of the timbers (0 over the court and the timbers)
export function outsideTimbers(x, y) {
  const o = C.lumberGap + C.lumberSize;
  const ox = Math.max(-o - x, x - C.terrainW - o, 0), oy = Math.max(-o - y, y - C.terrainL - o, 0);
  return Math.hypot(ox, oy);
}

// ---- Grass ----------------------------------------------------------------------------------------------

// Tileable grass: varied greens, blade strokes, a few clover patches and bare flecks. One tile = 2.5 m.
export function grassTexture() {
  const S = 512, cv = makeCanvas(S, S), g = cv.getContext('2d');
  const rand = mulberry32(2024);
  g.fillStyle = '#5d7f34';
  g.fillRect(0, 0, S, S);
  const wrap = (x, y, r, fn) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      if (x + ox < -r || x + ox > S + r || y + oy < -r || y + oy > S + r) continue;
      fn(x + ox, y + oy);
    }
  };
  // broad mottling
  for (let i = 0; i < 260; i++) {
    const x = rand() * S, y = rand() * S, r = 18 + rand() * 46;
    g.fillStyle = `hsla(${78 + rand() * 30}, ${38 + rand() * 22}%, ${26 + rand() * 16}%, 0.28)`;
    wrap(x, y, r, (px, py) => { g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill(); });
  }
  // clover patches: lighter, bluer green clusters of small round leaves
  for (let p = 0; p < 9; p++) {
    const cx = rand() * S, cy = rand() * S, pr = 22 + rand() * 26;
    for (let i = 0; i < 90; i++) {
      const a = rand() * TAU, d = Math.sqrt(rand()) * pr, r = 2.5 + rand() * 3.5;
      g.fillStyle = `hsl(${100 + rand() * 18}, ${36 + rand() * 14}%, ${30 + rand() * 12}%)`;
      wrap(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, (px, py) => { g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill(); });
    }
  }
  // blades
  g.lineCap = 'round';
  for (let i = 0; i < 9000; i++) {
    const x = rand() * S, y = rand() * S, len = 3 + rand() * 7, a = -Math.PI / 2 + (rand() - 0.5) * 1.3;
    g.strokeStyle = `hsl(${72 + rand() * 40}, ${35 + rand() * 30}%, ${24 + rand() * 30}%)`;
    g.lineWidth = 0.8 + rand() * 1.2;
    wrap(x, y, 10, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); g.stroke(); });
  }
  // a little dry grass and bare soil
  for (let i = 0; i < 260; i++) {
    const x = rand() * S, y = rand() * S, r = 0.8 + rand() * 1.8;
    g.fillStyle = rand() < 0.5 ? `hsl(${48 + rand() * 12}, 35%, ${42 + rand() * 12}%)` : `hsl(30, 25%, ${30 + rand() * 10}%)`;
    wrap(x, y, r, (px, py) => { g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill(); });
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// The ground plane beyond the terrain mesh; uv chosen so the pattern continues the terrain's (0.4 tiles per metre)
export function makeGrassPlane(tex, cx, cy, size, z) {
  const geo = new THREE.PlaneGeometry(size, size);
  const k = size * 0.4;
  tex.repeat.set(k, k);
  // the plane's uv origin sits at its corner: shift so world x*0.4 matches
  const ox = -(cx - size / 2) * 0.4, oy = -(cy - size / 2) * 0.4;
  tex.offset.set(((ox % 1) + 1) % 1, ((oy % 1) + 1) % 1);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, envMapIntensity: 0.2 }));
  mesh.position.set(cx, cy, z);
  mesh.receiveShadow = true;
  return mesh;
}

// Patch the terrain material so the grass blends in over the gravel past the timbers (one mesh, one draw)
export function blendGrassIntoTerrain(material, grassMap) {
  const o = C.lumberGap + C.lumberSize;
  material.onBeforeCompile = (sh) => {
    sh.uniforms.grassMap = { value: grassMap };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGp = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGp;\nuniform sampler2D grassMap;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec2 q = max(max(vec2(-${o.toFixed(3)} - vGp.x, -${o.toFixed(3)} - vGp.y), vec2(vGp.x - ${C.terrainW.toFixed(3)} - ${o.toFixed(3)}, vGp.y - ${C.terrainL.toFixed(3)} - ${o.toFixed(3)})), 0.0);
        float gk = smoothstep(0.75, 1.4, length(q));
        diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(grassMap, vGp * 0.4).rgb, gk);
      }`);
  };
}

// Instanced grass tufts in a band round the timbers (3 crossed tapered blades, 6 triangles)
export function makeTufts(terrain, phone) {
  const rand = mulberry32(555);
  const verts = [], cols = [];
  for (let b = 0; b < 3; b++) {
    const a = b * Math.PI / 3, c = Math.cos(a), s = Math.sin(a), hw = 0.016, hgt = 0.1;
    verts.push(-c * hw, -s * hw, 0, c * hw, s * hw, 0, c * 0.004, s * 0.004, hgt);
    cols.push(0.55, 0.6, 0.45, 0.55, 0.6, 0.45, 1, 1, 1); // darker at the root
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const count = phone ? 2200 : 7000;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.2 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const Wx = C.terrainW, Ly = C.terrainL, band = 6.5;
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 40) {
    const x = -band - 0.6 + rand() * (Wx + 2 * band + 1.2), y = -band - 0.6 + rand() * (Ly + 2 * band + 1.2);
    const d = outsideTimbers(x, y);
    if (d < 0.95 || d > band) continue;
    // dense near the timbers, thinning with distance (nearer is more visible)
    if (rand() > Math.pow(1 - (d - 0.95) / (band - 0.95), 1.5)) continue;
    const inGrid = x > -C.terrainPad && x < Wx + C.terrainPad && y > -C.terrainPad && y < Ly + C.terrainPad;
    const z = inGrid ? terrain.sample(x, y).h : -0.03;
    const s = 0.6 + rand() * 0.9;
    q.setFromAxisAngle(zAxis, rand() * TAU);
    sc.set(s, s, s * (0.7 + rand() * 0.8));
    m.compose(p.set(x, y, z - 0.01), q, sc);
    mesh.setMatrixAt(n, m);
    col.setHSL(0.24 + rand() * 0.07, 0.38 + rand() * 0.2, 0.2 + rand() * 0.1);
    mesh.setColorAt(n, col);
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- Trees ----------------------------------------------------------------------------------------------

// Layered cones with concave (drooping) sides and a ragged rim; z is up
function conifer(rand, opts) {
  const { layers, height, radius, droop, trunkH } = opts;
  const parts = [];
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1); // 0 bottom .. 1 top
    const r = radius * (1 - t * 0.82) * (0.9 + rand() * 0.2);
    const h = height / layers * 2.1;
    const g = new THREE.ConeGeometry(r, h, 9, 2);
    g.rotateX(Math.PI / 2);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const z = pos.getZ(k), x = pos.getX(k), y = pos.getY(k);
      const rr = Math.hypot(x, y);
      if (rr < 1e-5) continue;
      let f = 1;
      if (Math.abs(z) < h * 0.1) f = droop; // mid ring pulled in: concave, drooping boughs
      else if (z < 0) f = 0.9 + rand() * 0.2; // ragged rim
      pos.setX(k, x * f); pos.setY(k, y * f);
      if (z < 0) pos.setZ(k, z - h * 0.08 * (rr / r)); // rim sags a little
    }
    g.rotateZ(rand() * TAU);
    g.translate(0, 0, trunkH * 0.6 + t * (height - trunkH * 0.6 - h * 0.5) + h * 0.45);
    g.computeVertexNormals();
    parts.push(g);
  }
  return parts;
}

function mergeGeos(list) {
  // tiny non-indexed merge (no BufferGeometryUtils needed)
  let total = 0;
  const ng = list.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of ng) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of ng) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

function tree(kind, rand, scale, cast) {
  const grp = new THREE.Group();
  let crown, trunkH, trunkR, crownColor;
  const jitter = (h, s, l) => new THREE.Color().setHSL(h + (rand() - 0.5) * 0.03, s + (rand() - 0.5) * 0.08, l + (rand() - 0.5) * 0.05);
  if (kind === 'fir') {
    trunkH = 2.2; trunkR = 0.2;
    crown = mergeGeos(conifer(rand, { layers: 6, height: 9, radius: 2.0, droop: 0.72, trunkH }));
    crownColor = jitter(0.36, 0.42, 0.15);
  } else if (kind === 'cedar') {
    trunkH = 1.4; trunkR = 0.26;
    crown = mergeGeos(conifer(rand, { layers: 8, height: 8, radius: 2.1, droop: 0.62, trunkH }));
    crownColor = jitter(0.33, 0.38, 0.13);
  } else { // maple: lumpy icosahedron canopy
    trunkH = 2.6; trunkR = 0.24;
    const blobs = [];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.IcosahedronGeometry(1.5 + rand() * 0.8, 1);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const f = 0.85 + rand() * 0.3, x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        p.setXYZ(k, x * f, y * f, z * f * 0.85);
      }
      g.translate((rand() - 0.5) * 2.6, (rand() - 0.5) * 2.6, trunkH + 1.6 + rand() * 1.6);
      g.computeVertexNormals();
      blobs.push(g);
    }
    crown = mergeGeos(blobs);
    crownColor = jitter(0.25, 0.5, 0.27);
  }
  crown.computeVertexNormals();
  const cm = new THREE.Mesh(crown, new THREE.MeshStandardMaterial({ color: crownColor, roughness: 0.95, metalness: 0, flatShading: true, envMapIntensity: 0.25 }));
  const tg = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH + 2, 7);
  tg.rotateX(Math.PI / 2); tg.translate(0, 0, (trunkH + 2) / 2);
  const tm = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: kind === 'cedar' ? '#6b4a34' : '#5a4331', roughness: 1, flatShading: true }));
  cm.castShadow = tm.castShadow = false; // F73: trees shade the grass with camera-independent blob decals (makeTreeShadows); the shadow map follows the camera, so tree shadows used to come and go
  cm.receiveShadow = tm.receiveShadow = false;
  grp.add(tm, cm);
  grp.scale.setScalar(scale);
  grp.rotation.z = rand() * TAU;
  grp.userData.crown = cm;
  return grp;
}

// Positions (x, y), species, scale and whether it casts a shadow. The shoulder view looks down +y from below
// the circle, so trees stay out of the central corridor; those near the far end and on the right cast shadows
// (the sun is behind-left, so shadows fall away from the court); left-hand trees would shade the court, so they don't.
const TREES = [
  [-7.0, 3.5, 'fir', 1.0, false],
  [-9.5, 10.5, 'cedar', 1.15, false],
  [-6.0, 19.0, 'fir', 1.05, false],
  [-11, 16.5, 'maple', 1.0, false],
  [11.5, 18.5, 'fir', 1.1, true],
  [10.0, 6.5, 'maple', 1.0, true],
  [9.5, 12.0, 'cedar', 0.95, true],
  [-5.2, -4.5, 'cedar', 0.8, false],
];

export function makeTrees(terrain) {
  const rand = mulberry32(88);
  const grp = new THREE.Group();
  for (const [x, y, kind, s, cast] of TREES) {
    const t = tree(kind, rand, s * (0.9 + rand() * 0.2), cast);
    const inGrid = x > -C.terrainPad && x < C.terrainW + C.terrainPad && y > -C.terrainPad && y < C.terrainL + C.terrainPad;
    t.position.set(x, y, inGrid ? terrain.sample(x, y).h : -0.03);
    grp.add(t);
  }
  return grp;
}

// Approximate tree heights (m at scale 1) and canopy radii, for the cheap blob shadows
const TREE_SIZE = { fir: [11.2, 2.0], cedar: [9.4, 2.1], maple: [6.5, 2.4] };

// Pure helper: the ground footprint of a tree's shadow as an ellipse. `sunOffset` points from the ground to the sun
// (the single source of the sun direction), so the shadow runs the opposite way. The length is height / tan(elevation),
// shortened so it stops `clear` metres outside the timbers (`outside(x, y)` is the distance beyond them).
export function treeShadowDecal(x, y, height, radius, sunOffset, outside, clear = 0.8) {
  const hx = -sunOffset.x, hy = -sunOffset.y, hl = Math.hypot(hx, hy) || 1;
  const dx = hx / hl, dy = hy / hl, tanEl = sunOffset.z / hl;
  let len = tanEl > 0.05 ? height / tanEl : height * 20;
  len = Math.min(len, 18);
  if (outside(x, y) >= clear) { // stop at the first point along the shadow that would touch the court
    for (let t = 0.25; t <= len; t += 0.25) if (outside(x + dx * t, y + dy * t) < clear) { len = t - 0.25; break; }
  }
  return { cx: x + dx * len / 2, cy: y + dy * len / 2, len, width: radius * 1.5, angle: Math.atan2(dy, dx) };
}

// F73: soft dark ellipses on the grass for every tree, aligned with the sun and independent of the camera (the shadow
// map re-centres on the look target, so real tree shadows entered and left it as the camera moved). One instanced mesh.
export function makeTreeShadows(terrain, sunOffset) {
  const cv = makeCanvas(64, 64), g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(0,0,0,0.9)'); grad.addColorStop(0.6, 'rgba(0,0,0,0.6)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, color: '#0b1a05' });
  const list = TREES;
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
  list.forEach(([x, y, kind, s], i) => {
    const [h, r] = TREE_SIZE[kind];
    const d = treeShadowDecal(x, y, h * s, r * s, sunOffset, outsideTimbers);
    const inGrid = x > -C.terrainPad && x < C.terrainW + C.terrainPad && y > -C.terrainPad && y < C.terrainL + C.terrainPad;
    p.set(d.cx, d.cy, (inGrid ? terrain.sample(x, y).h : -0.03) + 0.012);
    q.setFromAxisAngle(z, d.angle);
    sc.set(Math.max(d.len, 0.01), d.width, 1);
    mesh.setMatrixAt(i, m.compose(p, q, sc));
  });
  mesh.renderOrder = 1; mesh.frustumCulled = false;
  return mesh;
}

// ---- Sky and panorama -----------------------------------------------------------------------------------

// One sky gradient shared by the sky dome (render.js), the fog and the painted panorama, so nothing mismatches:
// a light haze at the horizon, deepening to a clear summer blue overhead.
export const SKY_HAZE = '#d6e5f3';
const SKY_STOPS = [[0, SKY_HAZE], [3, '#c4dcf2'], [10, '#a0c8ee'], [25, '#6fa9e6'], [50, '#428bdd'], [90, '#2670d0']]
  .map(([e, h]) => [e, new THREE.Color(h)]);
export function skyColor(elDeg, out = new THREE.Color()) {
  const e = Math.max(0, Math.min(90, elDeg));
  let i = 0;
  while (i < SKY_STOPS.length - 2 && e > SKY_STOPS[i + 1][0]) i++;
  const [e0, c0] = SKY_STOPS[i], [e1, c1] = SKY_STOPS[i + 1];
  const t = (e - e0) / (e1 - e0);
  return out.copy(c0).lerp(c1, t * t * (3 - 2 * t) * 0.35 + t * 0.65);
}

// Rows are linear in tan(elevation) so an inside cylinder shows the painting undistorted
function rowMap(minEl, maxEl, H) {
  const tmax = Math.tan(deg(maxEl)), tmin = Math.tan(deg(minEl));
  return (el) => (tmax - Math.tan(deg(el))) / (tmax - tmin) * H;
}

// An inside-facing cylinder strip, az0..az1 (radians from +y, positive towards +x), minEl..maxEl in degrees
function cylinderStrip(tex, cx, cy, R, az0, az1, minEl, maxEl, segs, order) {
  const hLo = R * Math.tan(deg(minEl)), hHi = R * Math.tan(deg(maxEl));
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs, az = az0 + (az1 - az0) * u;
    const x = cx + R * Math.sin(az), y = cy + R * Math.cos(az);
    pos.push(x, y, hLo, x, y, hHi); uv.push(u, 0, u, 1);
    if (i < segs) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, fog: false, depthWrite: false, toneMapped: false }));
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return mesh;
}

function canvasTexture(cv, wrapS) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  if (wrapS) tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

const mix = (a, b, t) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
};

// Base line of the horizon band (degrees): ground haze below, silhouettes above
const BASE_EL = 0.25;

// ---- 360 degree wrap: sky clouds, distant ridges and the treeline all the way round ----
const WRAP = { W: 4096, H: 512, minEl: -3, maxEl: 22 };

function paintConifer(g, x, base, w, h, col, kind, rand) {
  const tiers = kind === 'cedar' ? 6 : 8;
  const tip = base - h, step = h / tiers;
  const half = (i) => (w / 2) * (0.22 + 0.78 * i / tiers) * (0.88 + rand() * 0.24);
  const droop = kind === 'cedar' ? step * 0.35 : step * 0.12;
  g.fillStyle = col;
  g.beginPath(); g.moveTo(x, tip);
  let px = x, py = tip + step * 0.2;
  const R = [], L = [];
  for (let i = 1; i <= tiers; i++) {
    const r = half(i), yb = tip + step * i;
    R.push([x + r, yb + droop, x + r * 0.55, yb - step * 0.28]);
    L.push([x - r, yb + droop, x - r * 0.55, yb - step * 0.28]);
  }
  void px; void py;
  for (const s of R) { g.lineTo(s[0], s[1]); g.lineTo(s[2], s[3]); }
  g.lineTo(x + w * 0.06, base); g.lineTo(x - w * 0.06, base);
  for (let i = L.length - 1; i >= 0; i--) { g.lineTo(L[i][2], L[i][3]); g.lineTo(L[i][0], L[i][1]); }
  g.closePath(); g.fill();
}

function paintMaple(g, x, base, w, h, col, rand) {
  g.fillStyle = col;
  g.fillRect(x - w * 0.04, base - h * 0.4, w * 0.08, h * 0.4 + 1);
  for (let i = 0; i < 6; i++) {
    const r = w * (0.2 + rand() * 0.12);
    g.beginPath(); g.arc(x + (rand() - 0.5) * w * 0.55, base - h * (0.55 + rand() * 0.35), r, 0, TAU); g.fill();
  }
}

function makeWrapTexture(haze) {
  const { W, H, minEl, maxEl } = WRAP;
  const cv = makeCanvas(W, H), g = cv.getContext('2d');
  const rand = mulberry32(1962);
  const Y = rowMap(minEl, maxEl, H);
  const X = (az) => (az + 180) / 360 * W;
  const yb = Y(BASE_EL);
  const wrapDraw = (x, r, fn) => { for (const o of [-W, 0, W]) if (x + o > -r && x + o < W + r) fn(x + o); };
  g.clearRect(0, 0, W, H);

  // a few small fair-weather cumulus: flat shaded bases, puffy white tops
  const clouds = [[-150, 12, 8], [-118, 17, 6], [-84, 9.5, 9], [-52, 15, 5], [-34, 20, 5.5], [22, 14.5, 7], [48, 10, 6], [70, 17.5, 8],
    [102, 11, 9], [133, 16, 6], [158, 9, 7], [-176, 18, 6], [176, 13.5, 5], [5, 20, 4.5]];
  for (const [az, el, wd] of clouds) {
    const cw = wd * W / 360, ch = cw * 0.2;
    const c2 = makeCanvas(Math.ceil(cw * 1.5), Math.ceil(ch * 3)), q = c2.getContext('2d');
    const cx0 = c2.width / 2, cy0 = c2.height * 0.7;
    q.fillStyle = '#fff';
    for (let i = 0; i < 11; i++) {
      const t = (i + rand() * 0.6) / 11 - 0.5, hump = 1 - Math.abs(t) * 1.6;
      const r = ch * (0.32 + 0.55 * Math.max(0.15, hump) * (0.7 + rand() * 0.5));
      q.beginPath(); q.arc(cx0 + t * cw * 1.05, cy0 - r * 0.55 * hump - rand() * ch * 0.1, r, 0, TAU); q.fill();
    }
    q.fillRect(cx0 - cw * 0.5, cy0 - ch * 0.12, cw, ch * 0.12); // flat base
    q.globalCompositeOperation = 'source-atop';
    const sg = q.createLinearGradient(0, cy0 - ch * 1.2, 0, cy0);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.6, 'rgba(214,226,240,0.3)'); sg.addColorStop(1, 'rgba(176,196,222,0.85)');
    q.fillStyle = sg; q.fillRect(0, 0, c2.width, c2.height);
    q.globalCompositeOperation = 'destination-out'; // clear everything under the flat base
    q.fillRect(0, cy0, c2.width, c2.height);
    wrapDraw(X(az), cw, (x) => { g.globalAlpha = 0.96; g.drawImage(c2, x - cx0, Y(el) - cy0); g.globalAlpha = 1; });
  }

  // distant mountain ranges (Olympics to the west, Cascades to the east), three layers deep: each farther range is taller,
  // paler and hazier. Low, craggy rock (grey, brown and blue-grey; no snow): a few octaves of sines with integer cycles
  // round the circle so the wrap closes, plus sharp |sin| crag terms, with ridge/gully strokes painted over the silhouette.
  // Fading out behind the players, where the treeline is tallest anyway.
  const sines = (az, terms) => terms.reduce((acc, [k, amp, ph]) => acc + amp * Math.sin(az * k * Math.PI / 180 + ph), 0);
  const crags = (az, ri) => 0.3 * (1 - Math.abs(Math.sin(az * (73 + ri * 22) * Math.PI / 360 + ri))) + 0.2 * (1 - Math.abs(Math.sin(az * (131 + ri * 30) * Math.PI / 360 + 2 * ri)));
  const ranges = [
    // far: tallest, palest | middle | near ridge
    { col: mix('#7f8896', haze, 0.45), lit: '#a2a3a6', shade: '#566174', brown: '#85705f', top: 4.6, lo: 0.8, from: 26, to: 160, terms: [[3, 0.55, 0.4], [5, 0.4, 2.1], [9, 0.3, 4.0], [17, 0.2, 1.1], [31, 0.12, 3.3], [57, 0.08, 0.2]] },
    { col: mix('#76727a', haze, 0.36), lit: '#9a9288', shade: '#4c4957', brown: '#76624f', top: 3.2, lo: 0.55, from: 32, to: 158, terms: [[4, 0.5, 1.4], [7, 0.4, 5.0], [13, 0.3, 2.2], [23, 0.2, 0.7], [41, 0.1, 3.9]] },
    { col: mix('#6c6b72', haze, 0.26), lit: '#8c8076', shade: '#444757', brown: '#6a5646', top: 2.1, lo: 0.35, from: 38, to: 152, terms: [[5, 0.5, 2.6], [8, 0.4, 0.3], [15, 0.3, 4.4], [29, 0.2, 1.9], [47, 0.1, 5.1]] },
  ];
  ranges.forEach((rg, ri) => {
    const prof = (az) => {
      const a = Math.abs(az);
      const k = Math.max(0, Math.min(1, (a - rg.from) / 30)) * Math.max(0, Math.min(1, (rg.to + 18 - a) / 28));
      const n = Math.max(0, 0.55 + sines(az, rg.terms) / 1.4 + crags(az, ri)); // 0..~1.4, jagged peaks and saddles
      const t = n * (0.8 + 0.2 * Math.sin(az * 0.07 + ri)); // soft saturation, so peaks stay pointed rather than flat-topped
      return BASE_EL + 0.25 + k * (rg.lo + (rg.top - rg.lo) * (t / (1 + 0.35 * t)) * 1.35);
    };
    g.fillStyle = rg.col;
    g.beginPath(); g.moveTo(0, yb);
    for (let a = -180; a <= 180; a += 0.15) g.lineTo(X(a), Y(prof(a)));
    g.lineTo(W, yb); g.closePath(); g.fill();
    { // rock texture, clipped to the silhouette: sunlit left faces, shaded right faces, brown scree bands, crag strokes
      g.save(); g.clip();
      const seed = (i) => Math.abs(Math.sin(i * 12.9898 + ri * 78.233) * 43758.5453) % 1;
      const dAz = 0.15;
      for (let a = -180; a < 180; a += dAz * 2) {
        const p0 = prof(a), p1 = prof(a + dAz * 2), sl = p1 - p0;
        const x0 = X(a), x1 = X(a + dAz * 2);
        if (p0 < BASE_EL + 0.6) continue;
        const y0 = Y(p0), yb2 = Y(BASE_EL + 0.4);
        g.globalAlpha = 0.4;
        g.fillStyle = sl > 0 ? rg.lit : rg.shade; // faces rising to the right catch the light from the left
        g.fillRect(x0, y0, Math.max(1, x1 - x0), yb2 - y0);
        g.globalAlpha = 1;
      }
      for (let i = 0; i < 2600; i++) { // ridge and gully strokes running down from the crest
        const a = -180 + seed(i) * 360, p = prof(a);
        if (p < BASE_EL + 0.7) continue;
        const x = X(a), y = Y(p) + seed(i + 5000) * (Y(BASE_EL + 0.4) - Y(p)) * 0.8;
        const len = (6 + seed(i + 9000) * 22) * (1 - ri * 0.2), lean = (seed(i + 7000) - 0.5) * 8;
        g.strokeStyle = seed(i + 3000) < 0.45 ? rg.shade : (seed(i + 3000) < 0.75 ? rg.brown : rg.lit);
        g.globalAlpha = 0.3 + seed(i + 1000) * 0.3; g.lineWidth = 0.8 + seed(i + 2000) * 1.4;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + lean, y + len); g.stroke();
      }
      g.strokeStyle = rg.brown; g.globalAlpha = 0.22; g.lineWidth = 1.5; // horizontal strata bands
      for (let j = 0; j < 5; j++) {
        const lvl = BASE_EL + 0.4 + (rg.top - 0.2) * (0.2 + j * 0.17);
        g.beginPath();
        for (let a = -180; a <= 180; a += 1) { const yy = Y(lvl + 0.08 * Math.sin(a * 0.9 + j * 3)); a === -180 ? g.moveTo(X(a), yy) : g.lineTo(X(a), yy); }
        g.stroke();
      }
      g.globalAlpha = 1;
      g.restore();
    }
    // layered haze: a veil thickening towards the foot of each range
    const hv = g.createLinearGradient(0, Y(rg.top), 0, Y(BASE_EL + 0.4));
    hv.addColorStop(0, 'rgba(' + hazeRgb(haze) + ',0)'); hv.addColorStop(1, 'rgba(' + hazeRgb(haze) + ',' + (0.38 - ri * 0.07) + ')');
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = hv; g.fillRect(0, Y(rg.top), W, Y(BASE_EL + 0.4) - Y(rg.top));
    g.globalCompositeOperation = 'source-over';
  });

  // treeline: how tall it stands depends on direction: full behind and at the sides, low towards the city and
  // mountain (those are painted in the detail strip over the top of it)
  const env = (az) => {
    const a = Math.abs(az), k = Math.max(0, Math.min(1, (a - 38) / 80));
    return 0.28 + 0.72 * k * k * (3 - 2 * k);
  };
  // rolling ground under the trees: each row stands on its own set of low hills (integer cycles round the circle, so it
  // closes), gentler towards the city and Rainier. Farther rows have bigger, softer swells.
  const hillTerms = [
    [[2, 0.55, 0.3], [3, 0.45, 2.0], [6, 0.3, 4.1], [11, 0.18, 1.2], [19, 0.1, 5.0]],
    [[2, 0.5, 1.9], [4, 0.4, 0.5], [7, 0.3, 3.7], [13, 0.17, 2.8], [23, 0.1, 0.9]],
    [[3, 0.4, 4.2], [5, 0.35, 1.1], [9, 0.25, 2.4], [16, 0.14, 5.5], [27, 0.08, 3.0]],
  ];
  const HILL_AMP = [1.0, 0.7, 0.4]; // degrees of elevation of the hilltops over the flats
  const hillAt = (ri, az) => {
    const k = 0.3 + 0.7 * Math.max(0, Math.min(1, (Math.abs(az) - 25) / 45));
    return HILL_AMP[ri] * k * Math.max(0, 0.5 + sines(az, hillTerms[ri]) * 0.7);
  };
  const rows = [
    // far, hazy, taller | mid | near, dark
    { col: mix('#456f5a', haze, 0.4), hmin: 2.4, hmax: 4.4, wmin: 0.8, wmax: 1.5, base: BASE_EL + 0.18, maple: 0, step: 0.5 },
    { col: mix('#2f5a43', haze, 0.25), hmin: 1.8, hmax: 3.7, wmin: 0.7, wmax: 1.4, base: BASE_EL + 0.08, maple: 0.06, step: 0.45 },
    { col: '#1d3f2c', hmin: 1.1, hmax: 3.0, wmin: 0.7, wmax: 1.5, base: BASE_EL, maple: 0.1, step: 0.55 },
  ];
  rows.forEach((row, ri) => {
    const baseAt = (az) => row.base + hillAt(ri, az);
    // the hill itself first (so the trees stand on its rim), then the trees
    g.fillStyle = row.col;
    g.beginPath(); g.moveTo(0, yb);
    for (let a = -180; a <= 180; a += 0.25) g.lineTo(X(a), Y(baseAt(a)));
    g.lineTo(W, yb); g.closePath(); g.fill();
    for (let a = -182; a < 182; a += row.step * (0.4 + rand() * 0.9)) {
      const e = env(a), kind = rand() < 0.55 ? 'fir' : 'cedar';
      let h = (row.hmin + (row.hmax - row.hmin) * Math.pow(rand(), 1.3)) * e;
      if (ri === 2 && rand() < 0.05) h *= 1.5;
      const w = row.wmin + rand() * (row.wmax - row.wmin);
      const bAz = baseAt(a) - 0.04; // sink the trunk a touch into the hill
      const hp = Math.abs(Y(h + bAz) - Y(bAz));
      const wp = w * W / 360 * (kind === 'cedar' ? 1.25 : 0.9) * (0.6 + 0.4 * e);
      const shade = rand() * 0.18 - 0.09;
      const col = mix(row.col, shade > 0 ? '#5f8a50' : '#0c1f15', Math.abs(shade) * (ri === 0 ? 0.6 : 1));
      const x = X(a), base = Y(bAz);
      wrapDraw(x, wp, (xx) => {
        if (rand() < row.maple * e * 1.6) paintMaple(g, xx, base, wp * 1.35, hp * 0.7, mix('#3f6a2c', row.col, ri === 2 ? 0.1 : 0.4), rand);
        else paintConifer(g, xx, base, wp, hp, col, kind, rand);
      });
    }
    // a soft haze veil on the hillside above this row's flats (stronger further away), following the hills
    g.save();
    g.globalCompositeOperation = 'source-atop';
    const vg = g.createLinearGradient(0, Y(row.base + 1.4), 0, Y(row.base));
    vg.addColorStop(0, 'rgba(' + hazeRgb(haze) + ',0)'); vg.addColorStop(1, 'rgba(' + hazeRgb(haze) + ',' + (0.3 - ri * 0.09) + ')');
    g.fillStyle = vg; g.fillRect(0, Y(row.base + 1.4), W, Y(row.base) - Y(row.base + 1.4));
    g.restore();
  });
  // below the base line: the nearest row's dark foliage right down to the grass (the grass plane meets the trees crisply
  // there instead of through a pale band), with only a whisper of haze
  g.fillStyle = rows[2].col; g.fillRect(0, yb - 1, W, H - yb + 1);
  const hz = g.createLinearGradient(0, yb - 3, 0, yb + (H - yb));
  hz.addColorStop(0, 'rgba(' + hazeRgb(haze) + ',0.18)'); hz.addColorStop(1, 'rgba(' + hazeRgb(haze) + ',0.18)');
  g.fillStyle = hz; g.fillRect(0, yb - 1, W, H - yb + 1);
  return cv;
}

function hazeRgb(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(','); }

// ---- Detail strip down-court (+y): Rainier, the foothills, downtown and the Space Needle at high resolution ----
const DET = { span: 120, W: 4096, minEl: -1.2, maxEl: 14 };
DET.H = Math.round((Math.tan(deg(DET.maxEl)) - Math.tan(deg(DET.minEl))) * (DET.W / DET.span) * 180 / Math.PI);

// The Space Needle, drawn as a silhouette from the tip (t = 0) to the foot (t = 1) of a tower `tot` px tall:
// six slender legs flaring from a wide base to a narrow waist about 64% of the way down, then splaying out again
// under the wide flat saucer (halo ring plus disc), with a smaller upper deck, roof cone and a thin spire.
function paintNeedle(g, px, baseY, tot, haze) {
  const topY = baseY - tot, y = (t) => topY + t * tot;
  const light = '#f3f5f8', mid = '#d6dde6', edge = '#566d8c', shade = '#8da0b8';
  const WAIST = 0.64, TOPW = 0.092, WAISTW = 0.034, BASEW = 0.125, TOPT = 0.335;
  const hw = (t) => (t < WAIST
    ? WAISTW + (TOPW - WAISTW) * Math.pow((WAIST - t) / (WAIST - TOPT), 1.9)
    : WAISTW + (BASEW - WAISTW) * Math.pow((t - WAIST) / (1 - WAIST), 1.45)) * tot;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const leg = (k, w, col) => {
    g.strokeStyle = col; g.lineWidth = w; g.beginPath();
    for (let t = TOPT - 0.01; t <= 1.0001; t += 0.01) { const X = px + k * hw(t); t === TOPT - 0.01 ? g.moveTo(X, y(t)) : g.lineTo(X, y(t)); }
    g.stroke();
  };
  // semi-transparent web between the outer legs so the hourglass reads as a solid shape
  g.beginPath();
  for (let t = TOPT - 0.01; t <= 1.0001; t += 0.01) g.lineTo(px - hw(t), y(t));
  for (let t = 1; t >= TOPT - 0.01; t -= 0.01) g.lineTo(px + hw(t), y(t));
  g.closePath(); g.fillStyle = 'rgba(236,241,247,0.72)'; g.fill();
  // cross rings: just under the saucer, at the waist and down the lower flare
  g.strokeStyle = mid; g.lineWidth = Math.max(1.3, tot * 0.009);
  for (const t of [0.4, 0.5, WAIST, 0.74, 0.85, 0.95]) { g.beginPath(); g.moveTo(px - hw(t), y(t)); g.lineTo(px + hw(t), y(t)); g.stroke(); }
  // legs: outer edges bold with a dark rim, inner legs lighter
  const lw = Math.max(2.4, tot * 0.026);
  leg(-1, lw + 2, edge); leg(1, lw + 2, edge);
  leg(-0.55, lw * 0.7, shade); leg(0.55, lw * 0.7, shade); leg(-0.12, lw * 0.6, shade); leg(0.12, lw * 0.6, shade);
  leg(-1, lw, light); leg(1, lw, mid);
  // saucer: halo ring, windowed disc and a skirt tapering into the legs
  const sw = tot * 0.19, t0 = 0.232;
  g.fillStyle = light; g.strokeStyle = edge; g.lineWidth = Math.max(1.4, tot * 0.01);
  g.beginPath(); g.moveTo(px - sw * 0.7, y(t0 + 0.005)); g.lineTo(px - sw, y(t0 + 0.028)); g.lineTo(px - sw * 0.86, y(t0 + 0.062));
  g.lineTo(px - hw(TOPT) * 1.05, y(TOPT + 0.004)); g.lineTo(px + hw(TOPT) * 1.05, y(TOPT + 0.004)); g.lineTo(px + sw * 0.86, y(t0 + 0.062));
  g.lineTo(px + sw, y(t0 + 0.028)); g.lineTo(px + sw * 0.7, y(t0 + 0.005)); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#8ea3bb'; // window band
  g.fillRect(px - sw * 0.9, y(t0 + 0.021), sw * 1.8, tot * 0.014);
  g.fillStyle = light; g.strokeStyle = edge; g.lineWidth = Math.max(1.4, tot * 0.01); // the halo: a thin, wider ring
  g.beginPath(); g.moveTo(px - sw * 1.12, y(t0 + 0.002)); g.lineTo(px - sw * 0.66, y(t0 - 0.014)); g.lineTo(px + sw * 0.66, y(t0 - 0.014));
  g.lineTo(px + sw * 1.12, y(t0 + 0.002)); g.lineTo(px + sw * 0.66, y(t0 + 0.012)); g.lineTo(px - sw * 0.66, y(t0 + 0.012)); g.closePath(); g.fill(); g.stroke();
  // smaller upper deck, roof cone and the spire
  const dw = tot * 0.075;
  g.fillStyle = light;
  g.beginPath(); g.moveTo(px - dw * 0.8, y(t0 - 0.014)); g.lineTo(px - dw, y(t0 - 0.05)); g.lineTo(px + dw, y(t0 - 0.05)); g.lineTo(px + dw * 0.8, y(t0 - 0.014)); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#8ea3bb'; g.fillRect(px - dw * 0.92, y(t0 - 0.038), dw * 1.84, tot * 0.01);
  g.fillStyle = mid;
  g.beginPath(); g.moveTo(px - dw * 0.7, y(t0 - 0.05)); g.lineTo(px, y(t0 - 0.085)); g.lineTo(px + dw * 0.7, y(t0 - 0.05)); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = edge; g.lineWidth = Math.max(1.8, tot * 0.012);
  g.beginPath(); g.moveTo(px, y(t0 - 0.083)); g.lineTo(px, topY); g.stroke();
  // distance haze over the whole tower
  g.fillStyle = 'rgba(' + hazeRgb(haze) + ',0.06)';
  g.fillRect(px - sw * 1.3, topY - 2, sw * 2.6, tot + 2);
}

function makeDetailTexture(haze) {
  const { span, W, H, minEl, maxEl } = DET;
  const cv = makeCanvas(W, H), g = cv.getContext('2d');
  const rand = mulberry32(1962);
  const X = (az) => (az + span / 2) / span * W;
  const Y = rowMap(minEl, maxEl, H);
  const yb = Y(BASE_EL), ppd = W / span;
  const hz = hazeRgb(haze);
  g.clearRect(0, 0, W, H);

  // Mount Rainier: broad massif, flat crater summit, ragged snowline, sunlit snow on blue-grey flanks.
  // Real Rainier is ~4 deg tall from Seattle, a little exaggerated here.
  const rc = -12, halfW = 16, peakEl = 9;
  const prof = (az) => {
    const u = (az - rc) / halfW;
    if (Math.abs(u) >= 1) return BASE_EL;
    const shape = Math.pow(1 - Math.abs(u), 1.2) * (1 + 0.045 * Math.sin(u * 17) + 0.03 * Math.sin(u * 41 + 1));
    let e = BASE_EL + (peakEl - BASE_EL) * shape;
    if (Math.abs(u) < 0.07) e -= 0.22 * (1 - Math.abs(u) / 0.07);
    return e;
  };
  g.beginPath(); g.moveTo(X(rc - halfW), yb);
  for (let a = rc - halfW; a <= rc + halfW; a += 0.1) g.lineTo(X(a), Y(prof(a)));
  g.lineTo(X(rc + halfW), yb); g.closePath();
  const rg = g.createLinearGradient(0, Y(peakEl), 0, yb);
  rg.addColorStop(0, '#6f8bb2'); rg.addColorStop(1, '#8aa3c3');
  g.fillStyle = rg; g.fill();
  g.save(); g.clip();
  // shaded flank on the right (the sun is behind us to the left), a darker blue-grey ridge on the left
  g.beginPath(); g.moveTo(X(rc + 0.5), Y(peakEl));
  for (let a = rc + 0.5; a <= rc + halfW; a += 0.4) g.lineTo(X(a), Y(prof(a) * 0.93));
  g.lineTo(X(rc + halfW), yb); g.lineTo(X(rc + 4), yb); g.closePath();
  g.fillStyle = 'rgba(52,76,118,0.42)'; g.fill();
  // snow cap above a ragged snow line
  const sl = (a) => 4.2 + 0.35 * Math.sin(a * 1.7) + 0.3 * Math.sin(a * 4.3 + 2) + (Math.abs(a - rc) / halfW) * 0.45;
  g.beginPath(); g.moveTo(X(rc - halfW), Y(0));
  for (let a = rc - halfW; a <= rc + halfW; a += 0.1) g.lineTo(X(a), Y(sl(a)));
  g.lineTo(X(rc + halfW), Y(12)); g.lineTo(X(rc - halfW), Y(12)); g.closePath();
  const sg = g.createLinearGradient(X(rc - halfW), 0, X(rc + halfW), 0);
  sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.55, '#fbfdff'); sg.addColorStop(0.75, '#dbe5f2'); sg.addColorStop(1, '#bccbe0');
  g.fillStyle = sg; g.fill();
  // glacier ridges and rock ribs running down from the summit
  g.strokeStyle = 'rgba(96,120,160,0.4)'; g.lineWidth = 3.2;
  for (let i = 0; i < 9; i++) {
    const a0 = rc + (rand() - 0.5) * 3, a1 = rc + (rand() - 0.5) * 22;
    g.beginPath(); g.moveTo(X(a0), Y(peakEl - 0.4));
    g.quadraticCurveTo((X(a0) + X(a1)) / 2 + (rand() - 0.5) * 30, Y(5.6), X(a1), Y(sl(a1) - 0.1));
    g.stroke();
  }
  // gentle distance haze, heavier at the foot
  const hg = g.createLinearGradient(0, Y(peakEl), 0, yb);
  hg.addColorStop(0, 'rgba(' + hz + ',0.04)'); hg.addColorStop(1, 'rgba(' + hz + ',0.6)');
  g.fillStyle = hg; g.fillRect(0, 0, W, H);
  g.restore();

  // foothills and a tree-covered ridge behind the city; faded out towards both ends of the strip
  const foot = (a) => BASE_EL + 0.9 + 0.5 * Math.sin(a * 0.31) + 0.2 * Math.sin(a * 0.9 + 1);
  g.fillStyle = mix('#6a8a8c', haze, 0.3);
  g.beginPath(); g.moveTo(X(-span / 2), yb);
  for (let a = -span / 2; a <= span / 2; a += 0.2) g.lineTo(X(a), Y(foot(a)));
  g.lineTo(X(span / 2), yb); g.closePath(); g.fill();

  // downtown: blue-grey towers with lit left faces and window flecks. Low next to the Needle.
  const towers = [];
  let a = -11;
  while (a < 15) {
    const w = 0.9 + rand() * 1.3, c = a + w / 2, k = 1 - Math.min(1, Math.abs(c - 7) / 18);
    towers.push({ az: c, w, h: 0.6 + (0.45 + rand() * 1.0) * (0.45 + 0.7 * k), tone: rand() });
    a += w * (0.55 + rand() * 0.4);
  }
  towers.push({ az: 9.5, w: 1.5, h: 3.1, tone: 0.6 }); // Columbia Center-like tallest tower
  towers.push({ az: 1.8, w: 1.4, h: 2.5, tone: 0.2 });
  towers.push({ az: -1.2, w: 1.1, h: 2.1, tone: 0.7 });
  towers.push({ az: 12.5, w: 1.0, h: 1.9, tone: 0.4 });
  const paintTower = (t) => {
    const x0 = X(t.az - t.w / 2), x1 = X(t.az + t.w / 2), top = Y(BASE_EL + t.h);
    const lum = t.tone * 0.5;
    g.fillStyle = `rgb(${Math.round(112 + lum * 34)},${Math.round(134 + lum * 32)},${Math.round(166 + lum * 24)})`;
    g.fillRect(x0, top, x1 - x0, yb - top);
    g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x0, top, (x1 - x0) * 0.4, yb - top);
    g.fillStyle = 'rgba(44,64,100,0.26)'; g.fillRect(x1 - (x1 - x0) * 0.3, top, (x1 - x0) * 0.3, yb - top);
    if (t.h > 2.6) { g.fillStyle = 'rgba(112,134,166,0.95)'; g.fillRect(x0 + (x1 - x0) * 0.3, top - 10, (x1 - x0) * 0.4, 11); }
    g.fillStyle = 'rgba(255,248,214,0.26)';
    for (let yy = top + 10; yy < yb - 14; yy += 11) for (let xx = x0 + 4; xx < x1 - 4; xx += 8) if (rand() < 0.28) g.fillRect(xx, yy, 3, 3);
  };
  towers.sort((p, q) => p.h - q.h).forEach(paintTower);
  // haze at the foot of the city
  const fh = g.createLinearGradient(0, Y(1.2), 0, yb);
  fh.addColorStop(0, 'rgba(' + hz + ',0)'); fh.addColorStop(1, 'rgba(' + hz + ',0.5)');
  g.fillStyle = fh; g.fillRect(X(-14), Y(1.2), X(18) - X(-14), yb - Y(1.2));

  // Space Needle: about twice the height of the typical tower
  paintNeedle(g, X(4.5), yb + 2, yb - Y(BASE_EL + 6.3), haze);

  // the nearest dark foliage down to the grass, matching the 360 wrap below (a crisp join, only a whisper of haze)
  g.fillStyle = '#1d3f2c'; g.fillRect(0, yb - 1, W, H - yb + 1);
  g.fillStyle = 'rgba(' + hz + ',0.18)'; g.fillRect(0, yb - 1, W, H - yb + 1);
  // fade this strip out at both ends (the 360 degree wrap shows through)
  g.globalCompositeOperation = 'destination-out';
  for (const [x0, x1, a0, a1] of [[0, W * 0.16, 1, 0], [W * 0.84, W, 0, 1]]) {
    const ef = g.createLinearGradient(x0, 0, x1, 0);
    ef.addColorStop(0, `rgba(0,0,0,${a0})`); ef.addColorStop(1, `rgba(0,0,0,${a1})`);
    g.fillStyle = ef; g.fillRect(x0, 0, x1 - x0, yb - 2);
  }
  g.globalCompositeOperation = 'source-over';
  void ppd;
  return cv;
}

// Panorama group: the 360 degree wrap (sky features and treeline) and the down-court detail strip over it.
// Cylinders are centred on the court; fog is off and colours are exact (not tone mapped), like the sky dome.
export function makeSkyPanorama(cx, cy, fogHex = SKY_HAZE) {
  const grp = new THREE.Group();
  const wrap = cylinderStrip(canvasTexture(makeWrapTexture(fogHex), true), cx, cy, 240, -Math.PI, Math.PI, WRAP.minEl, WRAP.maxEl, 144, -2);
  const det = cylinderStrip(canvasTexture(makeDetailTexture(fogHex), false), cx, cy, 236, deg(-DET.span / 2), deg(DET.span / 2), DET.minEl, DET.maxEl, 48, -1);
  grp.add(wrap, det);
  return grp;
}

// ---- Lake (F19) -----------------------------------------------------------------------------------------
// One flat plane down-court (+y), beyond the trees: the near shore is ~40 m from the court centre. A small shader gives it a sky-reflecting, slowly moving shimmer, a lighter shallow band and
// a faint foam line along an irregular near shore. Fog is the scene's own (60-320 m to SKY_HAZE), so the water melts
// into the panorama exactly like the grass does.
// F46: an elliptical lake (about half the old visible area): centre (court x, cy), semi-axes ax (x) and ay (y), in metres,
// so the shore is 43 m from the court at nearest and the far shore 153 m away. The plane paths in floatplane.js stay inside it.
export const LAKE = { cy: 98, ax: 65, ay: 55, dz: 0.05 }; // height dz over the grass plane

const LAKE_VERT = `
#include <fog_pars_vertex>
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const LAKE_FRAG = `
uniform float uTime;
uniform float uCx;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSky0;
uniform vec3 uSky1;
uniform vec3 uSky2;
uniform vec3 uSky3;
varying vec3 vW;
#include <fog_pars_fragment>
vec3 skyAt(float e) { // sky gradient by elevation (degrees), the same stops as the dome
  vec3 c = mix(uSky0, uSky1, smoothstep(0.0, 10.0, e));
  c = mix(c, uSky2, smoothstep(10.0, 25.0, e));
  return mix(c, uSky3, smoothstep(25.0, 50.0, e));
}
float lakeDepth(vec2 p) { // metres inside the irregular elliptical shore (negative outside)
  vec2 q = vec2((p.x - uCx) / ${LAKE.ax.toFixed(1)}, (p.y - ${LAKE.cy.toFixed(1)}) / ${LAKE.ay.toFixed(1)});
  float r = length(q) + 0.035 * sin(p.x * 0.06 + 1.0) + 0.03 * sin(p.y * 0.11 + 2.3) + 0.015 * sin(p.x * 0.23 + p.y * 0.17);
  return (1.0 - r) * 45.0;
}
void main() {
  float d = lakeDepth(vW.xy); // metres into the water
  if (d < -0.2) discard;
  vec3 toCam = cameraPosition - vW;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  // a few crossing wave trains (world space, sped by uTime); their slope fades with distance so far water does not alias
  vec2 p = vW.xy;
  float t = uTime;
  vec2 g = vec2(0.0);
  g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.9 + t * 0.9) * 0.9;
  g += vec2(-0.5, 0.87) * cos(dot(p, vec2(-0.5, 0.87)) * 1.7 + t * 1.3 + 1.7) * 0.6;
  g += vec2(0.97, -0.24) * cos(dot(p, vec2(0.97, -0.24)) * 2.9 + t * 1.9 + 4.0) * 0.4;
  g += vec2(0.2, 0.98) * cos(dot(p, vec2(0.2, 0.98)) * 0.35 + t * 0.5) * 1.1;
  float slope = 0.045 / (1.0 + dist * 0.012);
  vec3 n = normalize(vec3(-g * slope, 1.0));
  vec3 R = reflect(-V, n);
  float el = degrees(asin(clamp(R.z, 0.0, 1.0)));
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(V.z, 0.0, 1.0), 5.0);
  vec3 sky = skyAt(el);
  vec3 body = mix(uDeep, uShallow, 1.0 - smoothstep(0.0, 14.0, d));
  vec3 col = mix(body, sky * vec3(0.62, 0.8, 1.0), clamp(fres * 0.34, 0.0, 1.0));
  // a faint light streak where the slope catches the sky, drifting slowly
  col += 0.05 * smoothstep(0.35, 1.0, sin(g.x * 1.3 + g.y * 0.9 + t * 0.4)) * (1.0 - smoothstep(0.0, 120.0, dist) * 0.6);
  // foam line along the shore (a few metres wide, so it still reads at a grazing angle) and soft fade at the very edge
  float foam = smoothstep(-0.2, 0.8, d) * (1.0 - smoothstep(0.8, 3.6, d));
  foam *= 0.55 + 0.45 * sin(vW.x * 0.9 + t * 0.7 + d * 1.3);
  col = mix(col, uFoam, foam * 0.7);
  float a = smoothstep(-0.2, 0.9, d);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// Returns { mesh, update(dt) }. cx: x of the court centre (the lake is centred on it); z: the grass plane's height.
export function makeLake(cx, z) {
  const geo = new THREE.PlaneGeometry(LAKE.ax * 2 * 1.1, LAKE.ay * 2 * 1.1);
  const sk = [0, 10, 25, 50].map((e) => skyColor(e));
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uCx: { value: cx },
    uDeep: { value: new THREE.Color('#0a58a8') }, uShallow: { value: new THREE.Color('#3a9bd2') }, uFoam: { value: new THREE.Color('#f2f7f5') },
    uSky0: { value: sk[0] }, uSky1: { value: sk[1] }, uSky2: { value: sk[2] }, uSky3: { value: sk[3] },
  }]);
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: LAKE_VERT, fragmentShader: LAKE_FRAG, fog: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, LAKE.cy, z + LAKE.dz);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // under the spray and the plane (also transparent)
  return { mesh, update(dt) { uniforms.uTime.value += dt; } };
}

// ---- Sailboats (F64, F65) -------------------------------------------------------------------------------
// Two or three simple low-poly racing sloops (hull ~4.6 m, mast ~6.3 m above the deck). The sailing (wind, polar, tacks,
// jibes, heel, sail trim) is the pure fleet in sailboats.js; here each boat is four small merged vertex-coloured meshes
// (hull+mast+fin, mainsail+boom, jib) in a few groups that are only rotated each frame: heading, heel, and the mainsail
// and jib swinging about the mast and forestay. No per-frame allocations.
const HULLS = ['#f1ece0', '#2f5d8a', '#a8322d', '#d8c9a0', '#2d4a3e'];
const SAIL_COL = ['#f6f1e4', '#f6f1e4', '#efe6cf', '#f6f1e4', '#f0c53a', '#d23b30', '#2f6fc0'];
const STRIPES = ['#d23b30', '#2f6fc0', '#1f8a70', '#f0c53a'];
const MAST_X = 0.5, JIB_TACK = [1.95, 0, 0.3], JIB_LEN = Math.hypot(1.45, 5.1), JIB_TILT = Math.atan2(1.45, 5.1);

function geoBuilder() {
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

function buildHull(kind) {
  const { tri, build } = geoBuilder();
  const hull = HULLS[kind % HULLS.length], deck = '#a98a5e', trim = '#3a3a3a';
  const zd = 0.3, zk = -0.3; // deck and keel-line heights (the water surface is at 0)
  const B = [2.4, 0, zd + 0.05], L1 = [0.7, 0.72, zd], L2 = [-2.2, 0.58, zd], R1 = [0.7, -0.72, zd], R2 = [-2.2, -0.58, zd];
  const KB = [1.5, 0, zk], KS = [-2.1, 0, zk + 0.1];
  tri(B, L1, R1, deck); tri(L1, L2, R2, deck, 0.95); tri(L1, R2, R1, deck, 0.95);
  tri(B, L1, KB, hull, 0.95); tri(L1, KS, KB, hull, 0.85); tri(L1, L2, KS, hull, 0.9); // port side
  tri(B, KB, R1, hull, 0.8); tri(R1, KB, KS, hull, 0.7); tri(R1, KS, R2, hull, 0.75); // starboard side
  tri(L2, R2, KS, hull, 0.65); // flat transom
  tri([-0.2, 0.3, zd + 0.01], [-1.5, 0.3, zd + 0.01], [-0.9, 0.0, zd + 0.01], trim); // small cockpit mark
  tri([0.3, 0, zk + 0.05], [1.0, 0, zk + 0.05], [0.75, 0, -1.15], '#3b4650'); // fin keel, under the water
  tri([-2.05, 0, zk + 0.1], [-1.8, 0, zk + 0.1], [-1.95, 0, -0.75], '#3b4650'); // rudder
  const mt = 6.6; // thin mast: two crossed slivers
  tri([MAST_X - 0.06, 0, zd], [MAST_X + 0.06, 0, zd], [MAST_X, 0, mt], '#e6e1d4');
  tri([MAST_X, -0.06, zd], [MAST_X, 0.06, zd], [MAST_X, 0, mt], '#cfcabd');
  return build();
}

// Mainsail + boom in a frame centred on the mast (rotate about z to trim; the boom/sail trail along -x).
function buildMain(sail, stripe) {
  const { tri, build } = geoBuilder();
  const tack = [0, 0, 1.25], clew = [-2.2, 0, 1.3], head = [-0.15, 0.12, 6.3], mid = [-1.2, -0.28, 3.8], q = [-0.02, 0, 4.9];
  tri(tack, clew, mid, sail, 0.95);
  if (stripe) { tri(tack, mid, q, sail); tri(q, mid, head, stripe); } else tri(tack, mid, head, sail);
  // boom: a thin flat quad just under the foot
  tri([0, -0.04, 1.2], [0, 0.04, 1.2], [-2.3, 0.04, 1.2], '#d9d4c8'); tri([0, -0.04, 1.2], [-2.3, 0.04, 1.2], [-2.3, -0.04, 1.2], '#d9d4c8');
  return build();
}

// Jib in a frame along the forestay (local +z runs up the luff, -x trails aft; rotate about z to trim).
function buildJib(sail, stripe) {
  const { tri, build } = geoBuilder();
  const tack = [0, 0, 0], head = [0, 0, JIB_LEN], clew = [-1.6, 0, 0.9], mid = [-0.8, -0.2, 3.1], q = [0, 0, JIB_LEN * 0.78];
  tri(tack, clew, mid, sail, 0.97);
  if (stripe) { tri(tack, mid, q, sail, 0.97); tri(q, mid, head, stripe); } else tri(tack, mid, head, sail, 0.97);
  return build();
}

// Returns { group, fleet, update(dt, reduced, plane, groundZ) }. cx: court centre x; z: the lake's water height; seed varies each game.
export function makeSailboats(cx, z, seed) {
  if (seed === undefined) seed = (typeof location !== 'undefined' && +new URLSearchParams(location.search).get('seed')) || (Date.now() % 100000);
  const rand = mulberry32(seed * 31 + 5);
  const count = 2 + (rand() < 0.5 ? 1 : 0);
  const fleet = createSailFleet(seed, { cx, count });
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, fog: true });
  const group = new THREE.Group();
  const rigs = fleet.boats.map((b, i) => {
    const sail = SAIL_COL[Math.floor(rand() * SAIL_COL.length)];
    const stripe = (sail === '#f6f1e4' || sail === '#efe6cf') && rand() < 0.5 ? STRIPES[Math.floor(rand() * STRIPES.length)] : null;
    const mk = (geo) => { const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; return m; };
    const outer = new THREE.Group(), heel = new THREE.Group(), mainPivot = new THREE.Group(), jibTilt = new THREE.Group(), jibPivot = new THREE.Group();
    heel.add(mk(buildHull(i + Math.floor(rand() * 5))));
    mainPivot.position.set(MAST_X, 0, 0); mainPivot.add(mk(buildMain(sail, stripe))); heel.add(mainPivot);
    jibTilt.position.set(...JIB_TACK); jibTilt.rotation.y = -JIB_TILT; jibPivot.add(mk(buildJib(sail, stripe))); jibTilt.add(jibPivot); heel.add(jibTilt);
    outer.add(heel); group.add(outer);
    return { outer, heel, mainPivot, jibPivot, ph: b.phase };
  });
  const avoid = { x: 0, y: 0, r: SAIL.avoidR };
  let t = 0;
  function place(reduced) {
    const sway = reduced ? 0 : 1;
    for (let i = 0; i < rigs.length; i++) {
      const b = fleet.boats[i], r = rigs[i];
      r.outer.position.set(b.x, b.y, z + 0.05 + sway * Math.sin(t * 1.3 + r.ph) * 0.05);
      r.outer.rotation.z = b.heading;
      r.heel.rotation.x = b.heel + sway * Math.sin(t * 0.9 + r.ph) * 0.02; // + heel = leaning to the right (leeward when the wind is from the left)
      r.heel.rotation.y = sway * Math.sin(t * 0.7 + r.ph * 2) * 0.02; // pitch
      r.mainPivot.rotation.z = b.sail; r.mainPivot.scale.y = b.sail < 0 ? -1 : 1; // belly stays to leeward on either tack
      r.jibPivot.rotation.z = b.jib; r.jibPivot.scale.y = b.jib < 0 ? -1 : 1;
    }
  }
  place(false);
  return {
    group, fleet,
    update(dt, reduced, plane, groundZ) {
      if (!(dt > 0)) return; // paused: frozen
      const k = reduced ? 0.1 : 1; // reduced motion: a very slow drift, no bob
      t += dt * k;
      let av = null;
      if (plane && plane.active && plane.pos.z < groundZ + 12) { avoid.x = plane.pos.x; avoid.y = plane.pos.y; av = avoid; }
      fleet.step(dt * k, av);
      place(reduced);
    },
  };
}
