// Swing gesture input and gauge for the pétanque game.
//
// Usage (B11 integrator):
//   import { createSwingInput, createSwingGauge } from './input.js';
//   const gauge = createSwingGauge(canvas.parentElement); // parent must be position: relative
//   const swing = createSwingInput(canvas, {
//     getAimYaw: () => aimYaw,
//     onAim: (dyaw) => { aimYaw += dyaw; },          // radians, drag right = positive
//     onSwingStart: () => {},
//     onSwingUpdate: (state) => gauge.update(state),
//     onThrow: (tp) => { gauge.hide(); gauge.showGhost(tp); launchHuman(tp); },
//     onCancel: () => gauge.hide(),
//   });
//   swing.enable();   // when it is the human's turn; swing.disable() otherwise
// onThrow gets { yaw, speed, loft, backspin, sidespin, quality } (extra `quality` is harmless to launch()).
// Gauge styles are in assets/css/game.css under "swing gauge".

// Tuning for the gesture mapping (heights and speeds are normalised by swing-zone height H)
export const SWING = Object.freeze({
  speedMin: 2, speedMax: 12, // m/s
  loftMin: 5 * Math.PI / 180, loftMax: 75 * Math.PI / 180,
  backspinMax: 150, sidespinMax: 40, // rad/s
  maxYawOffset: 0.1, // rad (~6 degrees)
  minForward: 0.12, // upstroke must cover this much of H or it is not a throw
  fullSpeed: 5, // H/s of peak stroke speed that gives speedMax
  peakWindow: 120, // ms: peak speed is measured over the end of the stroke
  speedWindow: 30, // ms: span used to measure a speed
  releaseWindow: 40, // ms: span used for release speed
  heightLow: 0.1, heightHigh: 0.6, // release height (H above start) for loftMin / loftMax
  fullBackswing: 0.2, // backswing (H) that unlocks the full power ceiling
  minCeiling: 6, // m/s ceiling with no backswing
  backspinHi: 0.1, backspinLo: 0.8, // release/peak ratio: <= hi gives full backspin, >= lo none
  aimRadPerWidth: 1.2, // aim drag: radians per element width
  swingZone: 0.4, // bottom fraction of the element that starts a swing
  minMove: 6, // px of movement before a press is treated as a gesture
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, u) => a + (b - a) * u;
const DEG = Math.PI / 180;

export function heightToLoft(h) {
  return lerp(SWING.loftMin, SWING.loftMax, clamp((h - SWING.heightLow) / (SWING.heightHigh - SWING.heightLow), 0, 1));
}
export function loftToHeight(loft) {
  return lerp(SWING.heightLow, SWING.heightHigh, clamp((loft - SWING.loftMin) / (SWING.loftMax - SWING.loftMin), 0, 1));
}

// Speed (H/s) of the motion ending at sample i, measured over at least `span` ms.
function speedAt(s, i, lo, span) {
  let j = i - 1;
  while (j > lo && s[i].t - s[j].t < span) j--;
  const dt = s[i].t - s[j].t;
  if (j < lo || dt <= 0) return 0;
  return Math.hypot(s[i].x - s[j].x, s[i].y - s[j].y) / dt * 1000;
}

// Analyse a stroke; returns null when there is no forward stroke yet.
function analyse(samples, H) {
  const n = samples ? samples.length : 0;
  if (n < 3 || !(H > 0)) return null;
  const s = samples;
  const x0 = s[0].x, y0 = s[0].y;
  let low = 0;
  for (let i = 1; i < n; i++) if (s[i].y >= s[low].y) low = i;
  const end = s[n - 1];
  const forward = (s[low].y - end.y) / H;
  const a = {
    back: Math.max(0, (s[low].y - y0) / H),
    forward,
    height: (y0 - end.y) / H,
    low, n,
  };
  if (low >= n - 1 || forward <= 0) return { ...a, ok: false, vpeak: 0, vrel: 0, drift: 0, curve: 0 };
  // Speeds in H/s over the upstroke
  const tEnd = end.t;
  let vpeak = 0;
  for (let i = low + 1; i < n; i++) {
    if (s[i].t < tEnd - SWING.peakWindow) continue;
    vpeak = Math.max(vpeak, speedAt(s, i, low, SWING.speedWindow) / H);
  }
  const vrel = speedAt(s, n - 1, low, SWING.releaseWindow) / H;
  // Lateral drift and curvature of the upstroke, relative to its length
  const len = Math.max(s[low].y - end.y, 1);
  const drift = (end.x - s[low].x) / len;
  let curve = 0;
  const mid = (s[low].y + end.y) / 2;
  for (let i = low; i < n; i++) {
    if (s[i].y <= mid) {
      const frac = (s[low].y - s[i].y) / len;
      curve = (s[i].x - (s[low].x + (end.x - s[low].x) * frac)) / len;
      break;
    }
  }
  return { ...a, ok: forward >= SWING.minForward, vpeak, vrel, drift, curve, x0 };
}

function throwFrom(a, aimYaw) {
  const ceiling = lerp(SWING.minCeiling, SWING.speedMax, clamp(a.back / SWING.fullBackswing, 0, 1));
  const raw = lerp(SWING.speedMin, SWING.speedMax, clamp(a.vpeak / SWING.fullSpeed, 0, 1));
  const speed = clamp(Math.min(raw, ceiling), SWING.speedMin, SWING.speedMax);
  const loft = heightToLoft(a.height);
  const ratio = a.vpeak > 1e-6 ? clamp(a.vrel / a.vpeak, 0, 1) : 1;
  const backspin = SWING.backspinMax * clamp((SWING.backspinLo - ratio) / (SWING.backspinLo - SWING.backspinHi), 0, 1);
  const gain = 1 + 1.5 * clamp(a.back / (SWING.fullBackswing * 1.5), 0, 1); // big backswing amplifies error
  const yawOff = clamp(a.drift * 0.2 * gain, -SWING.maxYawOffset, SWING.maxYawOffset);
  const sidespin = clamp(a.curve * 100 * gain, -SWING.sidespinMax, SWING.sidespinMax);
  const quality = clamp(1 - 2.5 * Math.abs(a.drift) - 2 * Math.abs(a.curve) - 0.3 * Math.max(0, gain - 1), 0, 1);
  return { yaw: aimYaw + yawOff, speed, loft, backspin, sidespin, quality, ceiling, raw };
}

// Pure mapping from pointer samples to throw parameters; null if the stroke is too short.
export function swingToThrow(samples, aimYaw = 0, opts = {}) {
  const H = opts.height || 600;
  const a = analyse(samples, H);
  if (!a || !a.ok) return null;
  const t = throwFrom(a, aimYaw);
  return { yaw: t.yaw, speed: t.speed, loft: t.loft, backspin: t.backspin, sidespin: t.sidespin, quality: t.quality };
}

// Live gauge state for a stroke in progress (not part of the throw contract)
function liveState(samples, H, aimYaw) {
  const a = analyse(samples, H);
  const last = samples[samples.length - 1], first = samples[0];
  const back = a ? a.back : 0;
  const forwardPhase = !!a && a.low < samples.length - 1 && a.forward > 0.02;
  const height = (first.y - last.y) / H;
  const ceilingSpeed = lerp(SWING.minCeiling, SWING.speedMax, clamp(back / SWING.fullBackswing, 0, 1));
  let power = (ceilingSpeed - SWING.speedMin) / (SWING.speedMax - SWING.speedMin);
  let preview = null;
  if (forwardPhase) {
    const t = throwFrom(a, aimYaw);
    power = (t.speed - SWING.speedMin) / (SWING.speedMax - SWING.speedMin);
    preview = { yaw: t.yaw, speed: t.speed, loft: t.loft, backspin: t.backspin, sidespin: t.sidespin, quality: t.quality };
  }
  return {
    phase: forwardPhase ? 'forward' : 'back',
    x: last.x, y: last.y, startX: first.x, startY: first.y,
    height, back, // H units; height is above the start point
    ceiling: (ceilingSpeed - SWING.speedMin) / (SWING.speedMax - SWING.speedMin),
    power: clamp(power, 0, 1),
    preview,
  };
}

// Pointer Events input. Zones: bottom of the element = swing, elsewhere horizontal drag = aim.
export function createSwingInput(element, handlers = {}) {
  const h = handlers;
  let enabled = false;
  let pointers = new Set();
  let mode = null; // 'swing' | 'aim' | null
  let pid = null;
  let samples = [];
  let H = 600;
  let lastX = 0;
  let moved = false;

  element.style.touchAction = 'none';
  element.style.userSelect = 'none';

  function release() {
    if (pid !== null) {
      try { element.releasePointerCapture(pid); } catch (e) { /* already released */ }
    }
    mode = null; pid = null; samples = []; moved = false;
  }
  function cancel() {
    const wasSwing = mode === 'swing';
    release();
    if (wasSwing && h.onCancel) h.onCancel();
  }

  function onDown(e) {
    if (!enabled) return;
    pointers.add(e.pointerId);
    if (pointers.size > 1) { cancel(); return; } // multi-touch: not a swing
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const r = element.getBoundingClientRect();
    if (!r.height || !r.width) return;
    pid = e.pointerId;
    try { element.setPointerCapture(pid); } catch (err) { /* synthetic pointer */ }
    e.preventDefault();
    if ((e.clientY - r.top) / r.height >= 1 - SWING.swingZone) {
      mode = 'swing';
      H = r.height;
      samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
      moved = false;
      if (h.onSwingStart) h.onSwingStart();
    } else {
      mode = 'aim';
      lastX = e.clientX;
    }
  }

  function onMove(e) {
    if (!enabled || e.pointerId !== pid || !mode) return;
    if (mode === 'aim') {
      const w = element.getBoundingClientRect().width || 1;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      if (dx && h.onAim) h.onAim(dx / w * SWING.aimRadPerWidth);
      return;
    }
    const batch = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of (batch.length ? batch : [e])) {
      if (samples.length < 2000) samples.push({ t: ev.timeStamp, x: ev.clientX, y: ev.clientY });
    }
    if (!moved && Math.hypot(e.clientX - samples[0].x, e.clientY - samples[0].y) >= SWING.minMove) moved = true;
    if (moved && h.onSwingUpdate) {
      h.onSwingUpdate(liveState(samples, H, h.getAimYaw ? h.getAimYaw() : 0));
    }
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (e.pointerId !== pid || !mode) return;
    if (mode === 'aim') { release(); return; }
    samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY }); // release sample captures a stop
    const tp = swingToThrow(samples, h.getAimYaw ? h.getAimYaw() : 0, { height: H });
    release();
    if (tp) { if (h.onThrow) h.onThrow(tp); } else if (h.onCancel) h.onCancel();
  }

  function onCancelEvt(e) {
    pointers.delete(e.pointerId);
    if (e.pointerId === pid) cancel();
  }
  function onKey(e) { if (e.key === 'Escape' && mode) cancel(); }
  const stop = (e) => { if (enabled) e.preventDefault(); };

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onCancelEvt);
  element.addEventListener('contextmenu', stop);
  window.addEventListener('keydown', onKey);

  return {
    enable() { enabled = true; },
    disable() { enabled = false; pointers.clear(); cancel(); },
    destroy() {
      enabled = false; cancel(); pointers.clear();
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onCancelEvt);
      element.removeEventListener('contextmenu', stop);
      window.removeEventListener('keydown', onKey);
    },
  };
}

// --- Gauge overlay (DOM + SVG) ---
const NS = 'http://www.w3.org/2000/svg';
const ARC = { cx: 50, cy: 50, r: 40 };
// Arc position for a release height h (H units above start): s 0 (bottom) .. 1 (top)
const arcS = (h) => clamp((h + 0.1) / 0.8, 0, 1);
function arcPoint(s) {
  const phi = (-90 + 180 * s) * DEG;
  return { x: ARC.cx + ARC.r * Math.cos(phi), y: ARC.cy - ARC.r * Math.sin(phi) };
}
function arcPath(s0, s1) {
  const p0 = arcPoint(s0), p1 = arcPoint(s1);
  return `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A${ARC.r} ${ARC.r} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}
function svgEl(tag, attrs, parent) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}

export function createSwingGauge(container) {
  const root = document.createElement('div');
  root.className = 'swing-gauge';
  root.setAttribute('aria-hidden', 'true');
  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'sg-svg', preserveAspectRatio: 'xMidYMid meet' }, root);
  // Zone arcs: roulette < 25 deg, demi-portee < 55 deg, plombee above
  const zones = [
    ['sg-roulette', 0, 0.43, 'Roulette'],
    ['sg-demi', 0.43, 0.70, 'Demi-portée'],
    ['sg-plombee', 0.70, 1, 'Plombée'],
  ];
  for (const [cls, s0, s1, label] of zones) {
    svgEl('path', { d: arcPath(s0, s1), class: `sg-arc ${cls}` }, svg);
    const p = arcPoint((s0 + s1) / 2);
    const t = svgEl('text', { x: (p.x + 5).toFixed(2), y: p.y.toFixed(2), class: 'sg-label' }, svg);
    t.textContent = label;
  }
  const start = arcPoint(0);
  svgEl('circle', { cx: start.x, cy: start.y, r: 1.6, class: 'sg-start' }, svg);
  const ghost = svgEl('circle', { r: 3, class: 'sg-ghost', cx: start.x, cy: start.y }, svg);
  const marker = svgEl('circle', { r: 2.8, class: 'sg-marker', cx: start.x, cy: start.y }, svg);
  const ghostText = document.createElement('div');
  ghostText.className = 'sg-ghost-text';
  const bar = document.createElement('div');
  bar.className = 'sg-bar';
  const ceil = document.createElement('div');
  ceil.className = 'sg-bar-ceiling';
  const fill = document.createElement('div');
  fill.className = 'sg-bar-fill';
  bar.append(ceil, fill);
  root.append(ghostText, bar);
  container.appendChild(root);

  let ghostData = null;
  function drawGhost() {
    if (!ghostData) { ghost.style.opacity = '0'; ghostText.textContent = ''; return; }
    const p = arcPoint(arcS(loftToHeight(ghostData.loft)));
    ghost.setAttribute('cx', p.x.toFixed(2));
    ghost.setAttribute('cy', p.y.toFixed(2));
    ghost.style.opacity = '';
    ghostText.textContent = `Last: ${Math.round(ghostData.loft / DEG)}° · ${ghostData.speed.toFixed(1)} m/s · backspin ${Math.round(ghostData.backspin)}`;
  }
  drawGhost();

  return {
    update(state) {
      root.classList.add('is-active');
      root.classList.remove('is-ghost');
      const p = arcPoint(arcS(state.height));
      marker.setAttribute('cx', p.x.toFixed(2));
      marker.setAttribute('cy', p.y.toFixed(2));
      fill.style.height = `${Math.round(state.power * 100)}%`;
      ceil.style.bottom = `${Math.round(state.ceiling * 100)}%`;
      root.classList.toggle('is-forward', state.phase === 'forward');
      drawGhost();
    },
    showGhost(tp) {
      ghostData = tp;
      drawGhost();
      root.classList.remove('is-active');
      root.classList.add('is-ghost');
    },
    hide() {
      root.classList.remove('is-active', 'is-forward', 'is-ghost');
      const s = arcPoint(0);
      marker.setAttribute('cx', s.x);
      marker.setAttribute('cy', s.y);
      fill.style.height = '0';
    },
    destroy() { root.remove(); },
  };
}
