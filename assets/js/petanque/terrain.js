// Gravel terrain from one seed: macro heightfield, looseness map, stones, divots.
// sample() returns { h, nx, ny, nz, friction, loose }; friction is the rolling
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

export function createTerrain(seed, opts = {}) {
  const rand = mulberry32(seed);
  const pad = C.terrainPad, step = C.gridStep;
  const X0 = -pad, Y0 = -pad;
  const gw = Math.round((C.terrainW + 2 * pad) / step) + 1;
  const gh = Math.round((C.terrainL + 2 * pad) / step) + 1;
  const crown = opts.crown !== undefined ? opts.crown : (rand() * 2 - 1) * C.crownMax;
  const noiseH = makeNoise2D(rand);
  const noiseL = makeNoise2D(rand);
  const noiseJ = makeNoise2D(rand);
  const ph = rand() * 100;

  // Macro height, looseness and friction grids
  const base = new Float32Array(gw * gh);
  const loosen = new Float32Array(gw * gh);
  const fric = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = X0 + i * step, y = Y0 + j * step;
      let h = 0;
      for (const o of C.macroOctaves) h += o.amp * noiseH(x * o.freq + ph, y * o.freq);
      h *= C.macroAmp;
      const cx = (x - C.terrainW / 2) / (C.terrainW / 2);
      h += crown * (1 - cx * cx); // crown (positive) or hollow (negative)
      const k = j * gw + i;
      base[k] = clamp(h, -C.maxHeight, C.maxHeight);
      const n = noiseL(x * C.looseFreq + ph, y * C.looseFreq + 31.7) + 0.4 * noiseL(x * 1.3, y * 1.3 + 7);
      const l = clamp((n - C.looseThreshold) / C.looseSoftness + 0.5, 0, 1);
      loosen[k] = l;
      fric[k] = C.rollResistPacked + (C.rollResistLoose - C.rollResistPacked) * l;
    }
  }
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
        return { h, nx: -gx * inv, ny: -gy * inv, nz: inv, friction: f, loose: l };
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

  function resetDivots() { divots.fill(0); }

  const perceivedView = makeView(false);
  const terrain = makeView(true);
  terrain.perceived = () => perceivedView;
  perceivedView.perceived = () => perceivedView;
  terrain.seed = seed;
  return terrain;
}
