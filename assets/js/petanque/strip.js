// F34: pure geometry for a thin strip draped on the terrain (z-up world). Both edges are sampled every ~step metres and
// lifted; the triangles wind counter-clockwise seen from +z so the strip faces up (front-face culling would hide it otherwise).
export function stripGeometry(x0, y0, x1, y1, width, lift, heightAt, step = 0.1) {
  const len = Math.hypot(x1 - x0, y1 - y0), dx = (x1 - x0) / len, dy = (y1 - y0) / len;
  const nx = -dy * width / 2, ny = dx * width / 2, ext = width / 2; // runs half a width past its ends: square corners
  const n = Math.max(2, Math.ceil((len + 2 * ext) / step)), pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = -ext + (len + 2 * ext) * i / n, x = x0 + dx * t, y = y0 + dy * t;
    for (const s of [-1, 1]) {
      const px = x + s * nx, py = y + s * ny;
      pos.push(px, py, heightAt(px, py) + lift);
    }
    if (i < n) idx.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
  }
  return { pos, idx };
}
