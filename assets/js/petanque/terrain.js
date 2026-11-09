// Gravel terrain from one seed: macro heightfield (slopes), firmness map, stones, divots.
// F25: the macro field is a few broad features (tilt, ridge, basin, hills, saddle) and low-amplitude fBm; terrain.shape
// names the archetype and its downhill direction.
// sample() returns { h, nx, ny, nz, friction, loose, firm }; loose is 0 (hard pack) .. 1 (soft gravel),
// firm = 1 - loose (F05 names the map firmness in the UI); friction is the rolling
// resistance coefficient (mu_r). A stone's h is the z of its centre.
import { C } from './constants.js';
import { mulberry32, makeNoise2D } from './rng.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Bridson Poisson-disc sampling inside [x0,x1]x[y0,y1]; `ok` can veto points
function poisson(rand, x0, y0, x1, y1, minD, limit, ok) {
  const cs = minD / Math.SQRT2;
  const gw = Math.ceil((x1 - x0) / cs), gh = Math.ceil((y1 - y0) / cs);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts = [];
  const active = [];
  const fits = (x, y) => {
    const gx = Math.floor((x - x0) / cs), gy = Math.floor((y - y0) / cs);
    for (let j = Math.max(0, gy - 2); j <= Math.min(gh - 1, gy + 2); j++) {
      for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
        const k = grid[j * gw + i];
        if (k < 0) continue;
        const dx = pts[k][0] - x, dy = pts[k][1] - y;
        if (dx * dx + dy * dy < minD * minD) return false;
      }
    }
    return true;
  };
  const add = (x, y) => {
    pts.push([x, y]);
    active.push(pts.length - 1);
    grid[Math.floor((y - y0) / cs) * gw + Math.floor((x - x0) / cs)] = pts.length - 1;
  };
  add(x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0));
  while (active.length && pts.length < limit) {
    const ai = Math.floor(rand() * active.length);
    const p = pts[active[ai]];
    let found = false;
    for (let t = 0; t < 20; t++) {
      const a = rand() * Math.PI * 2, d = minD * (1 + rand());
      const x = p[0] + Math.cos(a) * d, y = p[1] + Math.sin(a) * d;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      if (!fits(x, y) || (ok && !ok(x, y))) continue;
      add(x, y);
      found = true;
      break;
    }
    if (!found) { active[ai] = active[active.length - 1]; active.pop(); }
  }
  return pts;
}

// F25 broad features: unit-scale height functions (h(x, y)); createTerrain normalises them by their court gradient.
const CX = C.terrainW / 2, CY = C.terrainL / 2;
const uni = (r, a, b) => a + r() * (b - a);
const sgn = (r) => (r() < 0.5 ? -1 : 1);
const gauss2 = (cx, cy, sa, sn, ang) => { // elongated Gaussian, sa along the axis at ang, sn across it
  const ca = Math.cos(ang), sa_ = Math.sin(ang);
  return (x, y) => {
    const u = (x - cx) * ca + (y - cy) * sa_, v = -(x - cx) * sa_ + (y - cy) * ca;
    return Math.exp(-0.5 * ((u * u) / (sa * sa) + (v * v) / (sn * sn)));
  };
};
function makeTilt(r) {
  const m = r(), flip = r() < 0.5 ? Math.PI : 0;
  const a = m < 0.6 ? flip + uni(r, -0.6, 0.6) : m < 0.8 ? flip + sgn(r) * uni(r, 0.6, 1.1) : sgn(r) * Math.PI / 2 + uni(r, -0.35, 0.35);
  const d = { x: Math.sin(a), y: Math.cos(a) };
  const L = 12;
  return { f: (x, y) => L * Math.tanh((d.x * (x - CX) + d.y * (y - CY)) / L), dir: d };
}
function makeRidge(r, sign = 1) {
  const m = r();
  const ang = (m < 0.45 ? 0 : m < 0.7 ? Math.PI / 2 : sgn(r) * uni(r, 0.4, 1.1)) + uni(r, -0.15, 0.15); // crest angle from +x
  const sn = uni(r, 1.5, 4), sa = uni(r, 6, 12);
  const n = { x: -Math.sin(ang), y: Math.cos(ang) }, a = { x: Math.cos(ang), y: Math.sin(ang) };
  const o1 = uni(r, -2.5, 2.5), o2 = uni(r, -2, 2);
  const g = gauss2(CX + n.x * o1 + a.x * o2, CY + n.y * o1 + a.y * o2, sa, sn, ang);
  return { f: (x, y) => sign * g(x, y), crest: ang };
}
function makeBasin(r) {
  const g = gauss2(CX + uni(r, -1.2, 1.2), CY + uni(r, -3, 3), uni(r, 4, 7), uni(r, 3, 5), Math.PI / 2 + uni(r, -0.5, 0.5));
  return { f: (x, y) => -g(x, y) };
}
function makeHills(r, n) {
  const hs = [];
  for (let i = 0; i < n; i++) {
    const w = uni(r, 3, 10) / 2, ang = uni(r, 0, Math.PI);
    hs.push({ g: gauss2(uni(r, -0.5, C.terrainW + 0.5), uni(r, 1, C.terrainL - 1), w * uni(r, 1, 1.5), w, ang), a: i === 0 ? 1 : uni(r, 0.55, 0.9) * sgn(r) });
  }
  return { f: (x, y) => hs.reduce((s, h) => s + h.a * h.g(x, y), 0) };
}
function makeSaddle(r) {
  const ang = uni(r, -0.35, 0.35), s = sgn(r), ca = Math.cos(ang), sa = Math.sin(ang);
  return { f: (x, y) => { const u = ((x - CX) * ca + (y - CY) * sa) / 4, v = (-(x - CX) * sa + (y - CY) * ca) / 9; return s * (u * u - v * v); } };
}

// Pick an archetype for a seed and build [main, second?] feature functions
function pickShape(seed, force) {
  const r = mulberry32((Math.floor(seed) ^ 0x25f25a5) >>> 0);
  const names = Object.keys(C.shapeWeights);
  let kind = force;
  const rv = r();
  if (!kind) {
    let acc = 0;
    const tot = names.reduce((s, k) => s + C.shapeWeights[k], 0);
    kind = names[names.length - 1];
    for (const k of names) { acc += C.shapeWeights[k] / tot; if (rv < acc) { kind = k; break; } }
  }
  let main, second = null, info = {};
  if (kind === 'tilt') main = makeTilt(r);
  else if (kind === 'ridge') main = makeRidge(r);
  else if (kind === 'basin') main = makeBasin(r);
  else if (kind === 'hills') { const n = r() < 0.5 ? 1 : 2; main = makeHills(r, n); info.n = n; }
  else if (kind === 'saddle') main = makeSaddle(r);
  else if (kind === 'tilt+hill') { main = makeTilt(r); second = makeHills(r, 1); }
  else { kind = 'ridge+tilt'; main = makeRidge(r); second = makeTilt(r); }
  return { kind, main, second, info };
}

const sideWord = (v) => (v < 0 ? 'left' : 'right');
// Direction text. x is to the player's right looking up the court (+y = the far end)
function ridgeText(c) {
  const across = Math.abs(Math.sin(c)) < 0.4, along = Math.abs(Math.cos(c)) < 0.4;
  return across ? 'A broad ridge crosses the court' : along ? 'A broad ridge runs along the court' : 'A broad diagonal ridge crosses the court';
}
function describe(kind, dir, main, info) {
  const ax = Math.abs(dir.x), ay = Math.abs(dir.y);
  const along = dir.y >= 0 ? 'toward the far end' : 'toward the near end';
  const mix = ay >= ax
    ? `${along}${ax / ay > 0.25 ? ` and ${ax / ay < 0.7 ? 'slightly ' : ''}${sideWord(dir.x)}` : ''}`
    : `${sideWord(dir.x)}${ay / ax > 0.25 ? ` and ${ay / ax < 0.7 ? 'slightly ' : ''}${dir.y >= 0 ? 'toward the far end' : 'toward the near end'}` : ''}`;
  switch (kind) {
    case 'tilt': return ay >= ax ? `The court runs downhill ${mix}.` : `The court leans ${mix}.`;
    case 'tilt+hill': return `${ay >= ax ? 'The court runs downhill' : 'The court leans'} ${mix}, with a gentle hill in it.`;
    case 'ridge': return `${ridgeText(main.crest)}: it falls away on both sides.`;
    case 'ridge+tilt': return `${ridgeText(main.crest)}, and the court tips ${mix}.`;
    case 'basin': return 'A shallow bowl: balls drift toward the middle.';
    case 'hills': return info.n === 2 ? 'Two broad swells: balls run off them.' : 'A broad hill: balls run off it.';
    default: return 'A saddle: high on two sides, low on the other two.';
  }
}

export function createTerrain(seed, opts = {}) {
  const rand = mulberry32(seed);
  const pad = C.terrainPad, step = C.gridStep;
  const X0 = -pad, Y0 = -pad;
  const gw = Math.round((C.terrainW + 2 * pad) / step) + 1;
  const gh = Math.round((C.terrainL + 2 * pad) / step) + 1;
  rand(); // (the former crown draw: keeps the firmness and stone streams of earlier versions)
  const noiseH = makeNoise2D(rand);
  const noiseL = makeNoise2D(rand);
  const noiseJ = makeNoise2D(rand);
  const ph = rand() * 100;

  // Looseness and friction grids
  const base = new Float32Array(gw * gh);
  const loosen = new Float32Array(gw * gh);
  const fric = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = X0 + i * step, y = Y0 + j * step, k = j * gw + i;
      const n = noiseL(x * C.looseFreq + ph, y * C.looseFreq + 31.7) + 0.4 * noiseL(x * 1.3, y * 1.3 + 7);
      const l = clamp((n - C.looseThreshold) / C.looseSoftness + 0.5, 0, 1);
      loosen[k] = l;
      fric[k] = C.rollResistPacked + (C.rollResistLoose - C.rollResistPacked) * l;
    }
  }

  // F25: macro height = broad features + a little low-frequency fBm, normalised on the court so the steepest local
  // gradient is the configured slope (F05) and the main feature carries most of the slope energy
  const deg = clamp(opts.slopeMaxDeg !== undefined ? opts.slopeMaxDeg : C.slopeMaxDeg, C.slopeMinDeg, C.slopeLimitDeg);
  const target = Math.tan((deg * Math.PI) / 180);
  const reach = 0.5; // include a margin around the court, where the timbers are
  const cells = []; // [k, gx-index] cells (i, j) whose centre is on the court plus margin
  for (let j = 0; j < gh - 1; j++) {
    for (let i = 0; i < gw - 1; i++) {
      const x = X0 + (i + 0.5) * step, y = Y0 + (j + 0.5) * step;
      if (x < -reach || x > C.terrainW + reach || y < -reach || y > C.terrainL + reach) continue;
      cells.push(j * gw + i);
    }
  }
  const gradAt = (arr, k) => [(arr[k + 1] - arr[k] + arr[k + gw + 1] - arr[k + gw]) / (2 * step), (arr[k + gw] - arr[k] + arr[k + gw + 1] - arr[k + 1]) / (2 * step)];
  const fieldOf = (f) => {
    const a = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) a[j * gw + i] = f(X0 + i * step, Y0 + j * step);
    return a;
  };
  const gmaxOf = (arr) => { let m = 0; for (const k of cells) { const g = gradAt(arr, k); m = Math.max(m, Math.hypot(g[0], g[1])); } return m; };
  const shp = pickShape(opts.shapeSeed !== undefined ? opts.shapeSeed : seed, opts.shape);
  const unit = (arr, w) => { const m = gmaxOf(arr) || 1; for (let k = 0; k < arr.length; k++) arr[k] *= w / m; return arr; };
  const mainA = unit(fieldOf(shp.main.f), 1);
  const secA = shp.second ? unit(fieldOf(shp.second.f), C.shapeSecond) : null;
  const fbm = unit(fieldOf((x, y) => noiseH(x * 0.15 + ph, y * 0.15) + 0.5 * noiseH(x * 0.31 + ph, y * 0.31 + 5)), C.shapeFbm);
  const energy = (arr) => { let e = 0; for (const k of cells) { const g = gradAt(arr, k); e += g[0] * g[0] + g[1] * g[1]; } return e; };
  const em = energy(mainA);
  let kk = 1, share = 1;
  const total = new Float32Array(gw * gh);
  for (let it = 0; it < 14; it++) {
    for (let k = 0; k < total.length; k++) total[k] = mainA[k] + kk * ((secA ? secA[k] : 0) + fbm[k]);
    share = em / energy(total);
    if (share >= C.shapeMinShare) break;
    kk *= 0.8;
  }
  const gm = gmaxOf(total), sc = gm > 1e-9 ? target / gm : 1;
  let mean = 0;
  for (const k of cells) mean += total[k];
  mean /= cells.length;
  for (let k = 0; k < base.length; k++) base[k] = clamp((total[k] - mean) * sc, -C.maxHeight, C.maxHeight);
  // direction: the main tilt's downhill direction, or the downhill direction where the main feature is steepest
  let dir = shp.main.dir;
  if (!dir) {
    let m = -1;
    for (const k of cells) { const g = gradAt(mainA, k), h = Math.hypot(g[0], g[1]); if (h > m) { m = h; dir = { x: -g[0] / h, y: -g[1] / h }; } }
  }
  dir = { x: +dir.x.toFixed(3), y: +dir.y.toFixed(3) };
  const divots = new Float32Array(gw * gh); // depth (positive = lower ground)

  const jf = C.jitterFreq, ja = C.jitterAmp, je = 0.004;

  // Build a terrain-like view; the jitter flag is the only difference
  function makeView(jitter) {
    const view = {
      sample(x, y) {
        let fx = (x - X0) / step, fy = (y - Y0) / step;
        fx = clamp(fx, 0, gw - 1.0001); fy = clamp(fy, 0, gh - 1.0001);
        const i = Math.floor(fx), j = Math.floor(fy);
        const tx = fx - i, ty = fy - j;
        const k = j * gw + i;
        const h00 = base[k] - divots[k], h10 = base[k + 1] - divots[k + 1];
        const h01 = base[k + gw] - divots[k + gw], h11 = base[k + gw + 1] - divots[k + gw + 1];
        let h = h00 + (h10 - h00) * tx + (h01 - h00) * ty + (h00 - h10 - h01 + h11) * tx * ty;
        let gx = ((h10 - h00) * (1 - ty) + (h11 - h01) * ty) / step;
        let gy = ((h01 - h00) * (1 - tx) + (h11 - h10) * tx) / step;
        if (jitter) {
          const n0 = noiseJ(x * jf, y * jf);
          h += ja * n0;
          gx += (ja * (noiseJ((x + je) * jf, y * jf) - n0)) / je;
          gy += (ja * (noiseJ(x * jf, (y + je) * jf) - n0)) / je;
        }
        const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
        const l = loosen[k] * (1 - tx) * (1 - ty) + loosen[k + 1] * tx * (1 - ty) +
          loosen[k + gw] * (1 - tx) * ty + loosen[k + gw + 1] * tx * ty;
        const f = fric[k] * (1 - tx) * (1 - ty) + fric[k + 1] * tx * (1 - ty) +
          fric[k + gw] * (1 - tx) * ty + fric[k + gw + 1] * tx * ty;
        return { h, nx: -gx * inv, ny: -gy * inv, nz: inv, friction: f, loose: l, firm: 1 - l };
      },
      stonesNear,
      visibleStones,
      heightGrid,
      addDivot,
      resetDivots,
    };
    return view;
  }

  // Stones: rocks first (rare), then pebbles, kept out of rocks' footprints
  const stones = [];
  const sp = C.stonePad;
  const x0 = -sp, y0 = -sp, x1 = C.terrainW + sp, y1 = C.terrainL + sp;
  const area = (x1 - x0) * (y1 - y0);
  const nRocks = Math.round(C.rockCount[0] + rand() * (C.rockCount[1] - C.rockCount[0]) * (area / 80));
  const rocks = poisson(rand, x0, y0, x1, y1, C.rockMinSpacing, nRocks, null);
  const gbase = (x, y) => { // ground height without jitter or divots
    const fx = clamp((x - X0) / step, 0, gw - 1.0001), fy = clamp((y - Y0) / step, 0, gh - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = j * gw + i;
    return base[k] * (1 - tx) * (1 - ty) + base[k + 1] * tx * (1 - ty) +
      base[k + gw] * (1 - tx) * ty + base[k + gw + 1] * tx * ty;
  };
  const stoneList = [];
  for (const [x, y] of rocks) {
    const r = C.rockR[0] + rand() * (C.rockR[1] - C.rockR[0]);
    stoneList.push({ x, y, r, h: gbase(x, y) + r * (1 - 2 * C.rockBury), rock: true });
  }
  const pebbleCap = Math.max(0, C.maxStones - stoneList.length);
  const pebbles = poisson(rand, x0, y0, x1, y1, C.pebbleMinSpacing, pebbleCap, (x, y) => {
    for (const s of stoneList) {
      const dx = s.x - x, dy = s.y - y, m = s.r + C.pebbleR[1];
      if (dx * dx + dy * dy < m * m) return false;
    }
    return true;
  });
  for (const [x, y] of pebbles) {
    const r = C.pebbleR[0] + rand() * (C.pebbleR[1] - C.pebbleR[0]);
    stoneList.push({ x, y, r, h: gbase(x, y) + r * (1 - 2 * C.pebbleBury), rock: false });
  }
  for (const s of stoneList) stones.push(s);

  // Spatial hash
  const cell = C.stoneCell;
  const hash = new Map();
  const key = (cx, cy) => cx * 100003 + cy;
  for (const s of stones) {
    const k = key(Math.floor(s.x / cell), Math.floor(s.y / cell));
    const b = hash.get(k);
    if (b) b.push(s); else hash.set(k, [s]);
  }
  const maxStoneR = C.rockR[1];

  function stonesNear(x, y, radius) {
    const out = [];
    const reach = radius + maxStoneR;
    const cx0 = Math.floor((x - reach) / cell), cx1 = Math.floor((x + reach) / cell);
    const cy0 = Math.floor((y - reach) / cell), cy1 = Math.floor((y + reach) / cell);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const b = hash.get(key(cx, cy));
        if (!b) continue;
        for (const s of b) {
          const dx = s.x - x, dy = s.y - y, m = radius + s.r;
          if (dx * dx + dy * dy <= m * m) out.push({ x: s.x, y: s.y, r: s.r, h: s.h });
        }
      }
    }
    return out;
  }

  function visibleStones() {
    return stones.map((s) => ({ x: s.x, y: s.y, r: s.r }));
  }

  // Heights on a regular grid over the padded extent, without jitter
  function heightGrid(stepOut = step) {
    const w = Math.floor((C.terrainW + 2 * pad) / stepOut + 1e-9) + 1;
    const h = Math.floor((C.terrainL + 2 * pad) / stepOut + 1e-9) + 1;
    const data = new Float32Array(w * h);
    const v = perceivedView;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) data[j * w + i] = v.sample(X0 + i * stepOut, Y0 + j * stepOut).h;
    }
    return { w, h, data, step: stepOut, x0: X0, y0: Y0 };
  }

  // Smooth bowl stamped into the divot buffer, depth clamped
  function addDivot(x, y, depth, radius) {
    const i0 = Math.max(0, Math.floor((x - radius - X0) / step)), i1 = Math.min(gw - 1, Math.ceil((x + radius - X0) / step));
    const j0 = Math.max(0, Math.floor((y - radius - Y0) / step)), j1 = Math.min(gh - 1, Math.ceil((y + radius - Y0) / step));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = X0 + i * step - x, dy = Y0 + j * step - y;
        const q = (dx * dx + dy * dy) / (radius * radius);
        if (q >= 1) continue;
        const k = j * gw + i;
        divots[k] = Math.min(C.divotDepthMax, divots[k] + depth * (1 - q) * (1 - q));
      }
    }
  }

  function resetDivots() {
    divots.fill(0);
  }

  const perceivedView = makeView(false);
  const terrain = makeView(true);
  terrain.perceived = () => perceivedView;
  perceivedView.perceived = () => perceivedView;
  terrain.seed = seed;
  terrain.shape = { kind: shp.kind, dir, text: describe(shp.kind, shp.second && shp.second.dir ? shp.second.dir : dir, shp.main, shp.info), share: +Math.min(1, share).toFixed(3) };
  perceivedView.shape = terrain.shape;
  // The same text for a thrower facing down the court (courtDir -1 plays toward y = 0: left/right and near/far swap)
  const shapeText = (courtDir = 1) => {
    const d = courtDir < 0 ? -1 : 1;
    return describe(shp.kind, shp.second && shp.second.dir ? { x: shp.second.dir.x * d, y: shp.second.dir.y * d } : { x: dir.x * d, y: dir.y * d }, shp.main, shp.info);
  };
  terrain.shapeText = perceivedView.shapeText = shapeText;
  return terrain;
}
