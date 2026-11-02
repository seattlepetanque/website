// Surroundings for the court (D15): grass, grass tufts, trees and a painted sky panorama with Mount Rainier and
// the Seattle skyline. Everything is procedural (canvas textures and primitive meshes), nothing is downloaded.
import * as THREE from '../vendor/three.module.js';
import { C } from './constants.js';
import { mulberry32 } from './rng.js';

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
  cm.castShadow = tm.castShadow = cast;
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

// ---- Sky panorama ---------------------------------------------------------------------------------------

// Painted 140 degree strip centred on +y (down the court), RADIUS from the court centre. Columns are linear in
// azimuth, rows linear in tan(elevation), so a cylinder shows it undistorted.
const PAN = { span: deg(140), minEl: deg(-5), maxEl: deg(40), W: 2048, H: 800, R: 240, base: deg(0.35) };

export function makeSkyPanorama(cx, cy, fogHex, haze) {
  const { span, minEl, maxEl, W, H, R } = PAN;
  const cv = makeCanvas(W, H), g = cv.getContext('2d');
  const rand = mulberry32(1962);
  const X = (azDeg) => (deg(azDeg) + span / 2) / span * W;
  const tmax = Math.tan(maxEl), tmin = Math.tan(minEl);
  const Y = (elDeg) => (tmax - Math.tan(deg(elDeg))) / (tmax - tmin) * H;
  const yb = Y(0.35); // the base line: ground haze below, silhouettes above
  g.clearRect(0, 0, W, H);

  // soft clouds (elevations 2..30 deg), more of them off to the sides so the skyline stays clear
  for (let i = 0; i < 26; i++) {
    const az = (rand() - 0.5) * 120, el = 5 + rand() * 24, w = 10 + rand() * 22;
    const px = X(az), py = Y(el), pw = w * W / 140, ph = pw * (0.07 + rand() * 0.05);
    for (let k = 0; k < 9; k++) {
      const ox = (rand() - 0.5) * pw, oy = (rand() - 0.5) * ph * 0.6, r = pw * (0.12 + rand() * 0.14);
      const gr = g.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, r);
      const a = 0.28 + rand() * 0.22;
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.save(); g.translate(px + ox, py + oy); g.scale(1, ph / pw * 1.8); g.translate(-(px + ox), -(py + oy));
      g.fillRect(px + ox - r, py + oy - r, 2 * r, 2 * r); g.restore();
    }
  }

  // Mount Rainier: broad massif, a flattened summit with a crater rim, snow cap with ragged line and a shaded flank.
  // Real Rainier is ~5 deg tall from Seattle; this is exaggerated so it reads at phone width.
  const rc = -12, halfW = 16, peakEl = 8.4, hazeCol = '#aebdd2';
  const prof = (azDeg) => { // elevation of the outline at an azimuth
    const u = (azDeg - rc) / halfW;
    if (Math.abs(u) >= 1) return 0.35;
    const shape = Math.pow(1 - Math.abs(u), 1.25) * (1 + 0.05 * Math.sin(u * 17) + 0.035 * Math.sin(u * 41 + 1));
    let e = 0.35 + (peakEl - 0.35) * shape;
    if (Math.abs(u) < 0.07) e -= 0.35 * (1 - Math.abs(u) / 0.07); // summit crater notch
    return e;
  };
  g.beginPath(); g.moveTo(X(rc - halfW), yb);
  for (let a = rc - halfW; a <= rc + halfW; a += 0.25) g.lineTo(X(a), Y(prof(a)));
  g.lineTo(X(rc + halfW), yb); g.closePath();
  const rg = g.createLinearGradient(0, Y(peakEl), 0, yb);
  rg.addColorStop(0, '#9fb2cc'); rg.addColorStop(1, '#bccadb');
  g.fillStyle = rg; g.fill();
  g.save(); g.clip();
  // shaded flank (left side faces away from the sun)
  g.beginPath(); g.moveTo(X(rc - 1), Y(peakEl));
  for (let a = rc - 1; a >= rc - halfW; a -= 0.5) g.lineTo(X(a), Y(prof(a) * 0.9) + 0);
  g.lineTo(X(rc - halfW), yb); g.lineTo(X(rc - 3), yb); g.closePath();
  g.fillStyle = 'rgba(95,115,150,0.38)'; g.fill();
  // snow cap: everything above a ragged snow line
  g.beginPath(); g.moveTo(X(rc - halfW), Y(0));
  const sl = (a) => 3.3 + 0.5 * Math.sin(a * 1.7) + 0.4 * Math.sin(a * 4.3 + 2) + (Math.abs(a - rc) / halfW) * 0.4;
  for (let a = rc - halfW; a <= rc + halfW; a += 0.25) g.lineTo(X(a), Y(sl(a)));
  g.lineTo(X(rc + halfW), Y(30)); g.lineTo(X(rc - halfW), Y(30)); g.closePath();
  const sg = g.createLinearGradient(X(rc - halfW), 0, X(rc + halfW), 0);
  sg.addColorStop(0, '#d6e0ee'); sg.addColorStop(0.45, '#f6f9fd'); sg.addColorStop(1, '#ffffff');
  g.fillStyle = sg; g.fill();
  // glacier ridges: darker streaks running down from the summit
  g.strokeStyle = 'rgba(120,140,175,0.45)'; g.lineWidth = 3;
  for (let i = 0; i < 9; i++) {
    const a0 = rc + (rand() - 0.5) * 4, a1 = rc + (rand() - 0.5) * 24;
    g.beginPath(); g.moveTo(X(a0), Y(peakEl - 0.6));
    g.quadraticCurveTo((X(a0) + X(a1)) / 2 + (rand() - 0.5) * 18, Y(5.6), X(a1), Y(sl(a1) - 0.2));
    g.stroke();
  }
  // distance haze across the whole mountain
  const hg = g.createLinearGradient(0, Y(peakEl), 0, yb);
  hg.addColorStop(0, 'rgba(214,226,240,0.12)'); hg.addColorStop(1, 'rgba(214,226,240,0.72)');
  g.fillStyle = hg; g.fillRect(0, 0, W, H);
  g.restore();

  // low hazy foothills / tree line behind the city
  g.fillStyle = 'rgba(122,146,150,0.75)';
  g.beginPath(); g.moveTo(X(-70), yb);
  for (let a = -70; a <= 70; a += 0.5) g.lineTo(X(a), Y(0.35 + 0.9 + 0.5 * Math.sin(a * 0.31) + 0.35 * Math.sin(a * 0.9 + 1) - Math.max(0, (Math.abs(a) - 58) * 0.08)));
  g.lineTo(X(70), yb); g.closePath(); g.fill();

  // Seattle skyline: generic towers (hazy blue-grey with lit left faces and window flecks) and the Space Needle
  const towers = [];
  const addT = (az, wDeg, hEl, tone) => towers.push({ az, w: wDeg, h: hEl, tone });
  // downtown cluster between -22 and +4 degrees, tallest near -1 (Columbia Center)
  let a = -11;
  while (a < 15) {
    const w = 0.9 + rand() * 1.3;
    const centre = a + w / 2, k = 1 - Math.min(1, Math.abs(centre - 7) / 18);
    addT(centre, w, 0.8 + (0.6 + rand() * 1.4) * (0.45 + 0.7 * k), rand());
    a += w * (0.55 + rand() * 0.4);
  }
  addT(9.5, 1.5, 4.0, 0.6); // Columbia Center-like tallest tower
  addT(1.8, 1.4, 3.2, 0.2); // a second slab tower
  addT(-1.2, 1.1, 2.7, 0.7);
  const needleAz = 5.8, needleTop = 4.5;
  const paintTower = (t) => {
    const x0 = X(t.az - t.w / 2), x1 = X(t.az + t.w / 2), top = Y(0.35 + t.h);
    const lum = 0.30 + t.tone * 0.12;
    g.fillStyle = `rgb(${Math.round(120 + lum * 40)},${Math.round(142 + lum * 36)},${Math.round(170 + lum * 28)})`;
    g.fillRect(x0, top, x1 - x0, yb - top);
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(x0, top, (x1 - x0) * 0.4, yb - top); // sunlit face
    g.fillStyle = 'rgba(52,72,104,0.22)'; g.fillRect(x1 - (x1 - x0) * 0.3, top, (x1 - x0) * 0.3, yb - top);
    if (t.h > 3.4) { g.fillStyle = 'rgba(120,138,164,0.9)'; g.fillRect(x0 + (x1 - x0) * 0.3, top - 7, (x1 - x0) * 0.4, 8); } // crown step
    g.fillStyle = 'rgba(255,248,214,0.22)'; // window flecks
    for (let yy = top + 8; yy < yb - 10; yy += 9) for (let xx = x0 + 3; xx < x1 - 3; xx += 6) if (rand() < 0.28) g.fillRect(xx, yy, 2.2, 2.2);
  };
  towers.sort((p, q) => p.h - q.h).forEach(paintTower);

  // Space Needle: three tapering legs pinched to a waist, an observation saucer, a roof cone and a spire
  {
    const px = X(needleAz), ppd = W / 140; // pixels per degree
    const baseY = yb, topY = Y(needleTop);
    const tot = baseY - topY; // overall height in px
    const saucerY = topY + tot * 0.17; // saucer centre
    const waistY = topY + tot * 0.62;
    const colour = '#dfe7f1', shade = '#4f6786';
    g.lineCap = 'round'; g.lineJoin = 'round';
    // spire
    g.strokeStyle = shade; g.lineWidth = 3; g.beginPath(); g.moveTo(px, topY); g.lineTo(px, saucerY - tot * 0.08); g.stroke();
    // tower: tapered hourglass (stroked as a filled polygon of two legs)
    const half = (yy) => { // half-width of the hourglass at a height
      const t = (yy - saucerY) / (baseY - saucerY);
      const waist = 0.5 * ppd * 0.42, foot = 0.5 * ppd * 1.8, neck = 0.5 * ppd * 0.7;
      if (yy < waistY) return neck + (waist - neck) * ((yy - saucerY) / (waistY - saucerY));
      return waist + (foot - waist) * Math.pow((yy - waistY) / (baseY - waistY), 1.4) + 0 * t;
    };
    g.fillStyle = colour; g.strokeStyle = shade; g.lineWidth = 1.6;
    // two outer legs
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(px + s * half(saucerY + 4) * 0.6, saucerY + 4);
      for (let yy = saucerY + 4; yy <= baseY; yy += 3) g.lineTo(px + s * half(yy), yy);
      for (let yy = baseY; yy >= saucerY + 4; yy -= 3) g.lineTo(px + s * Math.max(half(yy) - (yy > waistY ? 3.2 + (yy - waistY) * 0.03 : 2.4), 0.6), yy);
      g.closePath(); g.fill(); g.stroke();
    }
    // centre core
    g.fillStyle = shade; g.fillRect(px - 2.2, saucerY, 4.4, waistY - saucerY + 8);
    // waist ring and cross braces
    g.strokeStyle = shade; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(px - half(waistY) - 1, waistY); g.lineTo(px + half(waistY) + 1, waistY); g.stroke();
    g.beginPath(); g.moveTo(px - half(waistY + 14), waistY + 14); g.lineTo(px + half(waistY + 14), waistY + 14); g.stroke();
    // saucer: a wide flat ellipse with a thin lower skirt, windows band and a small roof dome
    const sw = ppd * 1.5, sh = tot * 0.055;
    g.fillStyle = colour; g.strokeStyle = shade; g.lineWidth = 1.6;
    g.beginPath(); g.ellipse(px, saucerY, sw, sh, 0, 0, TAU); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(px - sw * 0.82, saucerY + sh * 0.5); g.lineTo(px - sw * 0.42, saucerY + sh * 2.2);
    g.lineTo(px + sw * 0.42, saucerY + sh * 2.2); g.lineTo(px + sw * 0.82, saucerY + sh * 0.5); g.closePath(); g.fill(); g.stroke(); // lower hull
    g.fillStyle = '#5d7390'; g.beginPath(); g.ellipse(px, saucerY - sh * 0.1, sw * 0.9, sh * 0.42, 0, 0, TAU); g.fill(); // window band
    g.fillStyle = colour; g.beginPath(); g.ellipse(px, saucerY - sh * 0.9, sw * 0.52, sh * 0.55, 0, Math.PI, TAU); g.fill(); g.stroke(); // roof
  }

  // ground haze and the base fog band, matching scene.fog so the court's grass fades straight into it
  const hz = g.createLinearGradient(0, Y(1.8), 0, yb);
  hz.addColorStop(0, 'rgba(' + haze + ',0)'); hz.addColorStop(1, 'rgba(' + haze + ',0.6)');
  g.fillStyle = hz; g.fillRect(0, Y(1.8), W, yb - Y(1.8));
  g.fillStyle = fogHex; g.fillRect(0, yb - 1, W, H - yb + 1);
  // fade the clouds and haze out at the left and right ends of the strip
  g.globalCompositeOperation = 'destination-out';
  for (const [x0, x1, a0, a1] of [[0, W * 0.1, 1, 0], [W * 0.9, W, 0, 1]]) {
    const ef = g.createLinearGradient(x0, 0, x1, 0);
    ef.addColorStop(0, `rgba(0,0,0,${a0})`); ef.addColorStop(1, `rgba(0,0,0,${a1})`);
    g.fillStyle = ef; g.fillRect(x0, 0, x1 - x0, yb - 2);
  }
  g.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;

  // inside-facing cylinder strip
  const segs = 48, hLo = R * Math.tan(minEl), hHi = R * Math.tan(maxEl);
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs, az = (u - 0.5) * span;
    const x = cx + R * Math.sin(az), y = cy + R * Math.cos(az);
    pos.push(x, y, hLo, x, y, hHi); uv.push(u, 0, u, 1);
    if (i < segs) { const a0 = i * 2; idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, fog: false, depthWrite: false, toneMapped: false }));
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
