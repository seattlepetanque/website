// F108: option diffing and the surface owner (fake canvas/DOM/THREE; no browser)
import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceDiff, createSurface } from '../../assets/js/petanque/surface.js';
import { wantAntialias } from '../../assets/js/petanque/quality.js';

test('surfaceDiff: only antialias needs a new context', () => {
  assert.equal(surfaceDiff({ antialias: true }, { antialias: true }).rebuild, false);
  assert.equal(surfaceDiff({ antialias: true }, { antialias: false }).rebuild, true);
  assert.equal(surfaceDiff({ antialias: false }, { antialias: true }).rebuild, true);
  assert.equal(surfaceDiff({ antialias: false }, {}).rebuild, false);
  assert.equal(surfaceDiff({ antialias: true }, undefined).rebuild, false);
});

test('Graphics switches: High/Auto/Low rebuild only when antialiasing differs', () => {
  const seq = ['high', 'low', 'high', 'auto'];
  let aa = wantAntialias('high', false), rebuilds = 0;
  for (const g of seq) { const w = wantAntialias(g, false); if (surfaceDiff({ antialias: aa }, { antialias: w }).rebuild) { rebuilds++; aa = w; } }
  assert.equal(rebuilds, 2); // high->low, low->high; high->auto keeps it
  assert.equal(wantAntialias('auto', true), false); // weak device: Auto starts Low
});

function fakeDom() {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.parentNode = null; this.attrs = {}; this.ls = {}; }
    get parentElement() { return this.parentNode; }
    get nextSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
    cloneNode() { const n = new Node(this.tag); n.attrs = { ...this.attrs }; return n; }
    insertBefore(n, ref) { n.parentNode = this; const i = ref ? this.children.indexOf(ref) : this.children.length; this.children.splice(i, 0, n); return n; }
    removeChild(n) { this.children.splice(this.children.indexOf(n), 1); n.parentNode = null; return n; }
    addEventListener(t, h) { (this.ls[t] ||= []).push(h); }
    removeEventListener(t, h) { this.ls[t] = (this.ls[t] || []).filter((x) => x !== h); }
    fire(t, target) { for (const h of this.ls[t] || []) h({ target }); }
  }
  const stage = new Node('div'), canvas = new Node('canvas'); canvas.attrs.role = 'img';
  stage.insertBefore(canvas, null); stage.insertBefore(new Node('div'), null);
  return { stage, canvas };
}
function fakeThree(opts = {}) {
  const made = [];
  class WebGLRenderer {
    constructor(p) { if (opts.failAt === made.length + 1) throw new Error('nope'); this.p = p; this.disposed = false; this.lost = false; made.push(this); }
    getContext() { return {}; }
    dispose() { this.disposed = true; }
    forceContextLoss() { this.lost = true; }
  }
  return { THREE: { WebGLRenderer }, made };
}

test('rebuild: new canvas in the same place with the same attributes; old renderer disposed; listeners need no rebinding', () => {
  const { stage, canvas } = fakeDom(), { THREE, made } = fakeThree();
  const s = createSurface(THREE, canvas, { antialias: true });
  const seen = [];
  s.listen('pointerdown', (e) => seen.push(e.target));
  stage.fire('pointerdown', canvas); assert.equal(seen.length, 1);
  assert.ok(s.rebuild({ antialias: false }, () => {}));
  const nc = s.canvas;
  assert.notEqual(nc, canvas); assert.equal(stage.children[0], nc); assert.equal(stage.children.length, 2); assert.equal(nc.attrs.role, 'img');
  assert.equal(s.antialias, false); assert.equal(made.length, 2);
  assert.ok(made[0].disposed && made[0].lost); assert.ok(!made[1].disposed);
  stage.fire('pointerdown', canvas); assert.equal(seen.length, 1, 'old canvas events ignored');
  stage.fire('pointerdown', nc); assert.equal(seen.length, 2);
  assert.equal(stage.ls.pointerdown.length, 1);
});

test('rebuild: a failing renderer or adopt keeps the old canvas and renderer', () => {
  for (const mode of ['ctor', 'adopt']) {
    const { stage, canvas } = fakeDom(), { THREE, made } = fakeThree({ failAt: mode === 'ctor' ? 2 : 0 });
    const s = createSurface(THREE, canvas, { antialias: true });
    const ok = s.rebuild({ antialias: false }, () => { if (mode === 'adopt') throw new Error('x'); });
    assert.equal(ok, false); assert.equal(s.canvas, canvas); assert.equal(s.renderer, made[0]); assert.equal(s.antialias, true);
    assert.equal(stage.children[0], canvas); assert.equal(stage.children.length, 2); assert.ok(!made[0].disposed);
    if (mode === 'adopt') assert.ok(made[1].disposed);
    assert.equal(s.stats.failures, 1);
  }
});

test('many rebuilds leave exactly one live renderer', () => {
  const { stage, canvas } = fakeDom(), { THREE, made } = fakeThree();
  const s = createSurface(THREE, canvas, { antialias: true });
  for (let i = 0; i < 6; i++) s.rebuild({ antialias: i % 2 === 1 }, () => {});
  assert.equal(made.filter((r) => !r.disposed).length, 1); assert.equal(stage.children.length, 2);
});
