// F108: the one owner of the GL surface: the canvas element and the WebGLRenderer bound to its context. Everything else
// that lives in that context (shadow map, pause-view target, environment map) is created lazily by the renderer and is
// released/recreated in its `adopt` callback when the surface is rebuilt.
// Input: listeners go on the stable stage wrapper (the canvas's parent) and see only events that start on the current
// canvas, so a new canvas needs no rebinding. `listen` returns an off() function.

// Which options force a new canvas/context. WebGL fixes antialiasing at context creation; nothing else does.
export function surfaceDiff(current, wanted) {
  return { rebuild: !!wanted && wanted.antialias !== undefined && !!wanted.antialias !== !!current.antialias };
}

export function createSurface(THREE, canvas, options = {}) {
  const stage = canvas.parentElement || document;
  let cv = canvas, renderer = null, antialias = options.antialias !== false;
  const stats = { rebuilds: 0, failures: 0, lost: 0, created: 0 };
  const listeners = [];

  function makeRenderer(c, aa) {
    let r;
    try { r = new THREE.WebGLRenderer({ canvas: c, antialias: aa }); } catch (e) { throw new Error('WebGL is not available in this browser, so the 3D game cannot start.'); }
    if (!r.getContext()) { r.dispose(); throw new Error('WebGL is not available in this browser, so the 3D game cannot start.'); }
    stats.created++;
    return r;
  }
  renderer = makeRenderer(cv, antialias);

  function listen(type, fn, opts) {
    const h = (e) => { if (e.target === cv) fn(e); };
    stage.addEventListener(type, h, opts);
    const rec = { type, h, opts };
    listeners.push(rec);
    return () => { stage.removeEventListener(type, h, opts); const i = listeners.indexOf(rec); if (i >= 0) listeners.splice(i, 1); };
  }

  // Replace the canvas and renderer. adopt(renderer, canvas) re-creates what lives in the context; if it throws, the old
  // canvas goes back into the DOM and the old renderer stays in charge. Returns true on success, false on failure.
  function rebuild(next, adopt) {
    const wanted = next.antialias !== undefined ? !!next.antialias : antialias;
    const oldCv = cv, oldR = renderer, oldAA = antialias;
    const nc = oldCv.cloneNode(false); // same attributes: classes, aria, inline style (touch-action), hidden
    const parent = oldCv.parentNode, nextSibling = oldCv.nextSibling;
    let nr = null, swapped = false;
    try {
      if (parent) { parent.insertBefore(nc, oldCv); parent.removeChild(oldCv); swapped = true; }
      nr = makeRenderer(nc, wanted);
      cv = nc; renderer = nr; antialias = wanted;
      if (adopt) adopt(nr, nc);
    } catch (e) {
      cv = oldCv; renderer = oldR; antialias = oldAA;
      if (swapped && parent) { if (nc.parentNode === parent) parent.removeChild(nc); parent.insertBefore(oldCv, nextSibling); }
      if (nr) { try { nr.dispose(); nr.forceContextLoss(); } catch (_) { /* nothing more to free */ } }
      stats.failures++;
      return false;
    }
    oldCv.addEventListener('webglcontextlost', () => { stats.lost++; }, { once: true });
    try { oldR.dispose(); oldR.forceContextLoss(); } catch (_) { /* already gone */ }
    stats.rebuilds++;
    return true;
  }

  function dispose() {
    for (const { type, h, opts } of listeners.splice(0)) stage.removeEventListener(type, h, opts);
    try { renderer.dispose(); } catch (_) { /* gone */ }
  }

  return { get canvas() { return cv; }, get renderer() { return renderer; }, get antialias() { return antialias; }, stage, stats, listen, rebuild, dispose };
}
