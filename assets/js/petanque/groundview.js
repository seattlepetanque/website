// "Read the ground" (F05): a human-only overlay that shows the court's slope (particles drifting downhill, faster on
// steeper ground) and firmness (a colour wash: warm = soft and absorbent, cool = hard and lively). Everything is read
// from the perceived terrain, the same field the AI sees. Nothing is built until the view is first switched on.
import * as THREE from '../vendor/three.module.js';
import { C } from './constants.js';
import { mulberry32 } from './rng.js';
import { court } from './court.js';

export const GV_STEP = 0.1; // sampling grid of the overlay data, metres
const LIFT = 0.006; // overlay sits this far above the ground
const MAX_GRAD = () => Math.tan((C.slopeLimitDeg * Math.PI) / 180);

// Court-wide slope and firmness on a regular grid, straight from sample(). Downhill direction is (dx, dy) = -gradient.
export function fieldData(terrain, step = GV_STEP) {
  const v = terrain.perceived ? terrain.perceived() : terrain;
  const w = Math.round(C.terrainW / step) + 1, h = Math.round(C.terrainL / step) + 1;
  const dx = new Float32Array(w * h), dy = new Float32Array(w * h), grad = new Float32Array(w * h), firm = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = v.sample(i * step, j * step), k = j * w + i;
      dx[k] = s.nx / s.nz; dy[k] = s.ny / s.nz; // -gradient: the way a boule rolls
      grad[k] = Math.hypot(dx[k], dy[k]);
      firm[k] = 1 - s.loose;
    }
  }
  return { w, h, step, dx, dy, grad, firm };
}

// Bilinear lookup into fieldData
export function lookup(fd, x, y) {
  const fx = Math.min(fd.w - 1.0001, Math.max(0, x / fd.step)), fy = Math.min(fd.h - 1.0001, Math.max(0, y / fd.step));
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = j * fd.w + i;
  const m = (a) => a[k] * (1 - tx) * (1 - ty) + a[k + 1] * tx * (1 - ty) + a[k + fd.w] * (1 - tx) * ty + a[k + fd.w + 1] * tx * ty;
  return { dx: m(fd.dx), dy: m(fd.dy), firm: m(fd.firm) };
}

// firm 0 (soft) .. 1 (hard) -> warm amber .. cool blue
export function washColor(firm) {
  const t = Math.max(0, Math.min(1, firm));
  const warm = [232, 118, 40], mid = [236, 226, 200], cool = [48, 120, 200];
  const a = t < 0.5 ? warm : mid, b = t < 0.5 ? mid : cool, u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return [0, 1, 2].map((c) => Math.round(a[c] + (b[c] - a[c]) * u));
}

export function createGroundView(terrain, { phone = false, reduced = () => false } = {}) {
  const group = new THREE.Group();
  group.visible = false;
  group.name = 'groundview';
  let built = false, fd = null, arrows = null, parts = null, wash = null, on = false, lattice = false;
  const count = phone ? 90 : 220;
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
  const rand = mulberry32(99);
  const ground = (x, y) => terrain.perceived().sample(x, y).h + LIFT;

  // Legend, a small DOM element the page places (hidden unless the view is on)
  const legend = document.createElement('div');
  legend.className = 'pc-ground-legend';
  legend.hidden = true;
  legend.setAttribute('aria-hidden', 'true');
  legend.style.cssText = 'position:absolute;left:.6rem;top:5.6rem;z-index:5;pointer-events:none;font:600 .72rem/1.2 system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000;background:rgba(20,40,75,.55);padding:.35rem .5rem;border-radius:.4rem;max-width:11rem';
  legend.innerHTML = '<div>Firmness</div><div style="height:.5rem;margin:.2rem 0;border-radius:.25rem;background:linear-gradient(90deg,rgb(232,118,40),rgb(236,226,200),rgb(48,120,200))"></div>' +
    '<div style="display:flex;justify-content:space-between"><span>soft</span><span>hard</span></div><div style="margin-top:.25rem">Arrows: downhill, faster = steeper</div>' +
    (terrain.shape ? '<div class="pc-ground-shape" style="margin-top:.3rem;font-weight:500;font-style:italic;opacity:.8"></div>' : '');

  function build() {
    built = true;
    fd = fieldData(terrain);
    // colour wash: one canvas texture, computed once, draped on a mesh that follows the ground
    const TW = 128, TH = Math.round((TW * C.terrainL) / C.terrainW);
    const cv = document.createElement('canvas');
    cv.width = TW; cv.height = TH;
    const g = cv.getContext('2d'), img = g.createImageData(TW, TH);
    for (let j = 0; j < TH; j++) {
      for (let i = 0; i < TW; i++) {
        const x = ((i + 0.5) / TW) * C.terrainW, y = ((j + 0.5) / TH) * C.terrainL; // flipY below puts y up
        const [r, gg, b] = washColor(lookup(fd, x, y).firm);
        const o = ((TH - 1 - j) * TW + i) * 4;
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    const nx = Math.round(C.terrainW / 0.1), ny = Math.round(C.terrainL / 0.1);
    const geo = new THREE.PlaneGeometry(C.terrainW, C.terrainL, nx, ny);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k) + C.terrainW / 2, y = p.getY(k) + C.terrainL / 2;
      p.setXYZ(k, x, y, ground(x, y) - LIFT + 0.003);
    }
    geo.computeBoundingSphere();
    wash = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }));
    wash.renderOrder = 2;
    group.add(wash);

    // arrows: a flat instanced arrowhead lying on the ground
    const sh = new THREE.Shape();
    sh.moveTo(0.11, 0); sh.lineTo(-0.05, 0.05); sh.lineTo(-0.02, 0.012); sh.lineTo(-0.11, 0.012);
    sh.lineTo(-0.11, -0.012); sh.lineTo(-0.02, -0.012); sh.lineTo(-0.05, -0.05); sh.closePath();
    const ageo = new THREE.ShapeGeometry(sh);
    arrows = new THREE.InstancedMesh(ageo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false }), count);
    arrows.frustumCulled = false;
    arrows.renderOrder = 3;
    group.add(arrows);
    parts = Array.from({ length: count }, () => ({ x: 0, y: 0, age: 0, life: 1 }));
    lattice = reduced();
    if (lattice) layLattice(); else for (const q of parts) respawn(q, true);
    writeAll();
  }

  function respawn(q, anywhere) {
    q.x = rand() * C.terrainW; q.y = rand() * C.terrainL;
    q.life = 2.5 + rand() * 2.5;
    q.age = anywhere ? rand() * q.life : 0;
  }

  // Reduced motion: static arrows on a staggered lattice, length showing steepness
  function layLattice() {
    const cols = Math.max(2, Math.round(Math.sqrt((count * C.terrainW) / C.terrainL))), rows = Math.floor(count / cols);
    parts.forEach((q, n) => {
      const c = n % cols, r = Math.floor(n / cols);
      q.x = ((c + 0.5 + (r % 2) * 0.5) / (cols + 0.5)) * C.terrainW;
      q.y = ((r + 0.5) / Math.max(1, rows)) * C.terrainL;
      q.age = 0; q.life = 1; q.dead = r >= rows;
    });
  }

  function writeOne(n, q, k) {
    const f = lookup(fd, q.x, q.y), gr = Math.hypot(f.dx, f.dy);
    if (q.dead || gr < 1e-5) { tmpM.makeScale(0, 0, 0); arrows.setMatrixAt(n, tmpM); return; }
    const steep = Math.min(1, gr / Math.tan((C.slopeMaxDeg * Math.PI) / 180));
    const sc = (0.55 + 0.9 * steep) * k;
    tmpQ.setFromAxisAngle(Z, Math.atan2(f.dy, f.dx));
    tmpP.set(q.x, q.y, ground(q.x, q.y));
    tmpS.set(sc, sc, 1);
    tmpM.compose(tmpP, tmpQ, tmpS);
    arrows.setMatrixAt(n, tmpM);
  }
  function writeAll() {
    parts.forEach((q, n) => writeOne(n, q, 1));
    arrows.instanceMatrix.needsUpdate = true;
  }

  // Advance the drifting arrows (called with dt 0 while paused, which freezes them)
  function update(dt) {
    if (!on || !built || dt <= 0 || lattice) return;
    const cap = MAX_GRAD();
    for (let n = 0; n < parts.length; n++) {
      const q = parts[n];
      q.age += dt;
      const f = lookup(fd, q.x, q.y), gr = Math.hypot(f.dx, f.dy);
      // speed in proportion to the gradient: a 1.5 degree slope drifts at about 0.5 m/s
      const v = (gr / Math.tan((C.slopeMaxDeg * Math.PI) / 180)) * 0.5;
      if (gr > 1e-6) { q.x += (f.dx / gr) * v * dt; q.y += (f.dy / gr) * v * dt; }
      if (q.age >= q.life || q.x < 0 || q.x > C.terrainW || q.y < 0 || q.y > C.terrainL || gr > cap * 2) respawn(q, false);
      const u = q.age / q.life, k = Math.min(1, u * 5, (1 - u) * 5); // fade by scaling in and out
      writeOne(n, q, Math.max(0.001, k));
    }
    arrows.instanceMatrix.needsUpdate = true;
  }

  function setVisible(v) {
    v = !!v;
    if (v === on) return;
    on = v;
    if (v && !built) build();
    if (v && built && lattice !== reduced()) { // the motion preference changed while hidden
      lattice = reduced();
      if (lattice) layLattice(); else for (const q of parts) { q.dead = false; respawn(q, true); }
      writeAll();
    }
    if (v && terrain.shape) { // worded for the way the court is being played now
      const el = legend.querySelector('.pc-ground-shape');
      if (el) el.textContent = terrain.shapeText ? terrain.shapeText(court.dir) : terrain.shape.text;
    }
    group.visible = v;
    legend.hidden = !v;
  }

  return { object: group, legend, setVisible, update, get built() { return built; }, get active() { return on; }, data: () => fd || fieldData(terrain), count };
}
