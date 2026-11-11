// F83: pure geometry and alpha math for the two smooth aim-prediction volumes (no three.js). Both fill caller-owned
// typed arrays so the renderer reuses its buffers on every aim change.
//  - throwTube: a soft elliptical tube along the arc (orange); per-vertex alpha along the arc plus a radial direction so the
//    shader can fade the silhouette (alpha ~ facing^p), giving no hard edge.
//  - rollPyramid: a ground-draped pyramid (blue) from the first contact point (apex) widening to the rest spread, closed by
//    a rounded cap; per-vertex alpha fades to 0 at every edge.
export const TUBE_N = 41, TUBE_SIDES = 24, TUBE_K = 2;
export const PYR_ROWS = 24, PYR_CAP = 8, PYR_COLS = 9, PYR_VERTS = (PYR_ROWS + PYR_CAP) * PYR_COLS;

export const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// lateral fade across a section, u in [-1, 1]: 1 at the middle, exactly 0 with zero slope at the edges
export const lateralFade = (u) => { const q = Math.max(0, 1 - u * u); return q * q; };
// along the throw arc, f in [0, 1]: faint start at the hand, gentle rise toward the landing, soft fade at both ends
export const tubeAlong = (f) => (0.18 + 0.5 * f * f) * smoothstep(0, 0.12, f) * (1 - smoothstep(0.9, 1, f));
// silhouette fade of the tube; facing = |normal . view| in [0, 1]
// (the shader uses floor + (1 - floor) * facing^power, so seen along its axis the tube still reads as a soft glow)
export const silhouetteFade = (facing, power = 1.2, floor = 0.12) => floor + (1 - floor) * Math.pow(Math.max(0, Math.min(1, facing)), power);

export function tubeIndices(n = TUBE_N, sides = TUBE_SIDES) {
  const ix = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a0 = i * sides + j, a1 = i * sides + (j + 1) % sides, b0 = a0 + sides, b1 = a1 + sides;
      ix.push(a0, b0, b1, a0, b1, a1);
    }
  }
  return ix;
}

// center: [{x,y,z}] nominal arc; edges: [lat+, lat-, vert+, vert-] arcs at 1 sigma (same length). Fills pos (n*sides*3),
// alpha (n*sides) and rad (n*sides*3, unit outward direction of the section). Returns false when there is nothing to draw.
export function throwTube(center, edges, pos, alpha, rad, n = TUBE_N, sides = TUBE_SIDES, K = TUBE_K) {
  const len = center.length;
  if (!edges || edges.length < 4 || len < 3) return false;
  const m = Math.min(len, n);
  for (let i = 0; i < n; i++) {
    const q = Math.min(i, m - 1);
    const c = center[q], pa = center[Math.max(0, q - 1)], pb = center[Math.min(len - 1, q + 1)];
    let tx = pb.x - pa.x, ty = pb.y - pa.y, tz = pb.z - pa.z;
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const rem = (vx, vy, vz) => { const d = vx * tx + vy * ty + vz * tz; return [vx - d * tx, vy - d * ty, vz - d * tz]; };
    const l = rem((edges[0][q].x - edges[1][q].x) / 2, (edges[0][q].y - edges[1][q].y) / 2, (edges[0][q].z - edges[1][q].z) / 2);
    let nx = ty * l[2] - tz * l[1], ny = tz * l[0] - tx * l[2], nz = tx * l[1] - ty * l[0];
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const w = rem((edges[2][q].x - edges[3][q].x) / 2, (edges[2][q].y - edges[3][q].y) / 2, (edges[2][q].z - edges[3][q].z) / 2);
    const la = Math.hypot(l[0], l[1], l[2]) * K, lb = Math.abs(w[0] * nx + w[1] * ny + w[2] * nz) * K;
    const b = Math.max(lb, 0.8 * la, 0.05); // never thinner than 0.8 of the width, so it reads as a volume from behind
    const lh = la > 1e-9 ? [l[0] / (la / K), l[1] / (la / K), l[2] / (la / K)] : [0, 1, 0];
    const f = q / (m - 1), a = tubeAlong(f);
    for (let j = 0; j < sides; j++) {
      const th = j / sides * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th), o = (i * sides + j) * 3;
      pos[o] = c.x + cs * l[0] * K + sn * nx * b; pos[o + 1] = c.y + cs * l[1] * K + sn * ny * b; pos[o + 2] = c.z + cs * l[2] * K + sn * nz * b;
      rad[o] = cs * lh[0] + sn * nx; rad[o + 1] = cs * lh[1] + sn * ny; rad[o + 2] = cs * lh[2] + sn * nz;
      alpha[i * sides + j] = a;
    }
  }
  return true;
}

export function pyramidIndices(rows = PYR_ROWS + PYR_CAP, cols = PYR_COLS) {
  const ix = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    ix.push(a, b, d, a, d, c);
  }
  return ix;
}

// Ground-plane footprint of the roll prediction. band: { center: [{x,y}], halfWidths, restMean, restCov }.
// Fills xy (PYR_VERTS * 2) and alpha (PYR_VERTS); returns { apex, base } or null. The caller lifts each vertex onto the terrain.
export function rollPyramid(band, xy, alpha, { alpha0 = 0.1, alpha1 = 0.42, minBase = 0.3, spread = 2.5 } = {}) {
  const pts = band && band.center;
  if (!pts || pts.length < 2) return null;
  // cumulative length, so rows are evenly spaced along the path
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1];
  if (total < 1e-6) return null;
  const at = (d) => {
    let k = 1; while (k < pts.length - 1 && cum[k] < d) k++;
    const seg = cum[k] - cum[k - 1] || 1, t = Math.max(0, Math.min(1, (d - cum[k - 1]) / seg));
    const a = pts[k - 1], b = pts[k], hw = band.halfWidths || [];
    const ha = hw[k - 1] ?? 0.05, hb = hw[k] ?? ha;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, hw: ha + (hb - ha) * t, tx: (b.x - a.x) / seg, ty: (b.y - a.y) / seg };
  };
  const last = pts[pts.length - 1], prev = pts[Math.max(0, pts.length - 2)];
  let ex = last.x - prev.x, ey = last.y - prev.y; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
  const c = band.restCov || { xx: 0.003, xy: 0, yy: 0.003 };
  // rest spread across and along the final direction
  const sLat = Math.sqrt(Math.max(1e-6, c.xx * ey * ey - 2 * c.xy * ex * ey + c.yy * ex * ex));
  const sLon = Math.sqrt(Math.max(1e-6, c.xx * ex * ex + 2 * c.xy * ex * ey + c.yy * ey * ey));
  const endHw = at(total).hw;
  const wBase = Math.max(minBase, spread * Math.max(endHw, sLat));
  const wApex = 0.06;
  const capLen = Math.max(0.2, 1.5 * sLon);
  let o = 0, ao = 0;
  const put = (x, y, w, nx, ny, a) => {
    for (let j = 0; j < PYR_COLS; j++) {
      const u = j / (PYR_COLS - 1) * 2 - 1;
      xy[o++] = x + nx * w * u; xy[o++] = y + ny * w * u;
      alpha[ao++] = a * lateralFade(u);
    }
  };
  for (let i = 0; i < PYR_ROWS; i++) {
    const s = i / (PYR_ROWS - 1), p = at(total * s);
    put(p.x, p.y, wApex + (wBase - wApex) * s, -p.ty, p.tx, alpha0 + (alpha1 - alpha0) * s * s * (3 - 2 * s) * smoothstep(0, 0.08, s + 0.04));
  }
  for (let k = 1; k <= PYR_CAP; k++) {
    const th = k / PYR_CAP * Math.PI / 2, sn = Math.sin(th), cs = Math.cos(th);
    put(last.x + ex * capLen * sn, last.y + ey * capLen * sn, wBase * cs, -ey, ex, alpha1 * cs * cs);
  }
  return { apex: { x: pts[0].x, y: pts[0].y }, base: wBase };
}
