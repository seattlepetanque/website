// Toss input for the pétanque game: turn, place the donnée, pull down for loft, release to throw.
//
// Usage (C04 integrator):
//   import { createTossInput } from './toss.js';
//   const toss = createTossInput(canvas, {
//     pick: (x, y) => renderer.pick(x, y),          // client px -> { x, y } | null
//     getYaw: () => yaw,
//     getOrigin: () => ({ x: 2, y: 1 }),            // circle position (keyboard donnée placement)
//     onTurn: (dyaw) => { yaw += dyaw; },           // radians, drag right = positive
//     onPreview: ({ donnee, loft, snappedTo, cancel }) => {},
//     onThrow: ({ donnee, loft, snappedTo }) => { toss.setPhase('off'); },
//     onCancel: () => {},
//     targets: () => bodies.map((b) => ({ id: b.id, x: b.x, y: b.y, r: b.r })),
//   });
//   toss.setPhase('aim');   // start of the human's turn; 'off' otherwise; destroy() on teardown
// Phase 'place' (the other team's invalid jack): hover or drag moves a marker over the ground, a click or release
// on a valid spot places the jack, arrows move the marker and Enter places. Extra options: placeValid(point) ->
// boolean, onPlacePreview({ point, valid } | null), onPlace(point), onPlaceInvalid(point).
// The pure state machine (createTossMachine) and helpers are exported for tests.
import { LOFT_MIN, LOFT_MAX, styleForLoft } from './donnee.js';
import { court } from './court.js';

const DEG = Math.PI / 180;
export const TOSS = Object.freeze({
  turnSpan: 60 * DEG,       // dragging the canvas width turns this much
  moveSlop: 6,              // px of movement that decides turn vs toss
  dwellMs: 150,             // holding still this long starts a toss
  pullFraction: 0.35,       // of canvas height for full loft
  cancelPx: 20,             // above the press point by this much cancels
  snapRadius: 0.25,         // m
  keyTurn: 1 * DEG, keyTurnFine: 0.2 * DEG,
  keyStep: 0.05,            // m per Shift+arrow
  keyLoft: 1 * DEG,
  keyStartLoft: 30 * DEG,
  defaultDistance: 7,       // m, Enter places the donnée this far ahead
  placeStart: { x: 2, y: 9 }, // keyboard marker start while placing the jack
  placeStep: 0.25, placeStepFine: 0.05, // m per arrow / Shift+arrow while placing the jack
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Pull (px, positive = down) to loft. Eased: a blend of linear and smoothstep, so it is monotonic
// and a little slower near both ends where the extremes are easy to reach.
export function pullToLoft(pullPx, canvasHeight) {
  const t = clamp(pullPx / (TOSS.pullFraction * canvasHeight), 0, 1);
  const s = t * t * (3 - 2 * t);
  return LOFT_MIN + (0.6 * t + 0.4 * s) * (LOFT_MAX - LOFT_MIN);
}

// dyPx is relative to the press point, positive down
export function isCancel(dyPx) { return dyPx < -TOSS.cancelPx; }

// Snap to the nearest target centre within radius; returns { x, y, snappedTo }
export function snapDonnee(point, targets, radius = TOSS.snapRadius) {
  let best = null, bd = Infinity;
  for (const t of targets || []) {
    const d = Math.hypot(t.x - point.x, t.y - point.y);
    if (d <= radius && d < bd) { best = t; bd = d; }
  }
  return best ? { x: best.x, y: best.y, snappedTo: best.id } : { x: point.x, y: point.y, snappedTo: null };
}

// Decide what a press is from its movement so far (dx, dy in px, dtMs since press)
export function classifyDrag(dx, dy, dtMs) {
  if (Math.hypot(dx, dy) <= TOSS.moveSlop) return dtMs >= TOSS.dwellMs ? 'toss' : 'undecided';
  if (Math.abs(dx) >= Math.abs(dy)) return 'turn';
  return dy > 0 ? 'toss' : 'undecided';
}

// Pure state machine. opts: pick, getYaw, getOrigin, onTurn, onPreview, onThrow, onCancel, targets,
// size() -> { w, h }, onReadout(state | null), defaultDistance.
export function createTossMachine(opts) {
  const o = opts;
  let phase = 'off';
  let st = 'idle';     // idle | pending | turning | pulling | keys
  let ptr = null;      // active pointer id
  let x0 = 0, y0 = 0, t0 = 0, lastX = 0, pickPt = null;
  let cur = null;      // { donnee, loft, snappedTo, cancel }
  let placePt = null;  // marker position while placing the jack

  function snapped(p) { return snapDonnee(p, o.targets ? o.targets() : [], TOSS.snapRadius); }

  function emit(extra) {
    if (!cur) return;
    o.onPreview && o.onPreview({ donnee: cur.donnee, loft: cur.loft, snappedTo: cur.snappedTo, cancel: cur.cancel });
    o.onReadout && o.onReadout({ ...cur, ...extra });
  }
  function end(result) {
    const c = cur;
    cur = null; st = 'idle'; ptr = null; pickPt = null;
    o.onReadout && o.onReadout(null);
    if (result === 'throw') {
      phase = 'off';
      o.onThrow && o.onThrow({ donnee: c.donnee, loft: c.loft, snappedTo: c.snappedTo });
    } else {
      if (phase === 'toss') phase = 'aim';
      o.onCancel && o.onCancel();
    }
  }
  function startPull(x, y, loft) {
    const s = snapped(pickPt);
    st = 'pulling';
    cur = { donnee: { x: s.x, y: s.y }, loft, snappedTo: s.snappedTo, cancel: false };
    emit({ px: x, py: y });
  }
  function updatePull(x, y) {
    const dy = y - y0;
    const cancel = isCancel(dy);
    const loft = pullToLoft(Math.max(0, dy), o.size().h);
    if (cancel !== cur.cancel || loft !== cur.loft) { cur.cancel = cancel; cur.loft = loft; emit({ px: x, py: y }); }
    else if (o.onReadout) o.onReadout({ ...cur, px: x, py: y });
  }
  function placeAt(p) {
    if (!p) { placePt = null; o.onPlacePreview && o.onPlacePreview(null); return; }
    placePt = { x: p.x, y: p.y };
    o.onPlacePreview && o.onPlacePreview({ point: placePt, valid: !!(o.placeValid && o.placeValid(placePt)) });
  }
  function tryPlace(p) {
    if (!p) return false;
    if (o.placeValid && o.placeValid(p)) {
      phase = 'off'; st = 'idle'; ptr = null; placePt = null;
      o.onPlacePreview && o.onPlacePreview(null);
      o.onPlace && o.onPlace({ x: p.x, y: p.y });
      return true;
    }
    placeAt(p);
    o.onPlaceInvalid && o.onPlaceInvalid({ x: p.x, y: p.y });
    return false;
  }
  function turn(x) {
    const dx = x - lastX; lastX = x;
    if (dx) o.onTurn && o.onTurn(dx * TOSS.turnSpan / o.size().w);
  }

  const m = {
    get phase() { return phase; },
    get state() { return st; },
    get current() { return cur; },
    // pointer hovering with no button down (mouse): move the placement marker
    hover(x, y) {
      if (phase !== 'place' || ptr !== null) return;
      placeAt(o.pick(x, y));
    },
    setPhase(p) {
      if (phase === 'place' && p !== 'place') placeAt(null);
      if (st === 'pulling' || st === 'keys') { cur = null; st = 'idle'; o.onReadout && o.onReadout(null); }
      st = 'idle'; ptr = null; phase = p;
    },
    down(id, x, y, t) {
      if (phase === 'off') return false;
      if (phase === 'place') {
        if (ptr !== null) return false;
        ptr = id; st = 'placing';
        placeAt(o.pick(x, y));
        return true;
      }
      if (ptr !== null) { // second pointer: pinch zoom, abandon the gesture
        if (st === 'pulling') end('cancel');
        st = 'idle'; ptr = null;
        return false;
      }
      if (st === 'keys') return false;
      ptr = id; x0 = lastX = x; y0 = y; t0 = t;
      pickPt = o.pick(x, y);
      if (phase === 'toss') {
        if (!pickPt) { ptr = null; return false; }
        startPull(x, y, LOFT_MIN);
      } else st = 'pending';
      return true;
    },
    move(id, x, y, t) {
      if (id !== ptr) return;
      if (st === 'placing') { placeAt(o.pick(x, y)); return; }
      if (st === 'pending') {
        const k = classifyDrag(x - x0, y - y0, t - t0);
        if (k === 'turn') { st = 'turning'; turn(x); }
        else if (k === 'toss' && pickPt) { startPull(x, y, pullToLoft(Math.max(0, y - y0), o.size().h)); }
      } else if (st === 'turning') turn(x);
      else if (st === 'pulling') updatePull(x, y);
    },
    // called by a timer while a press is held
    tick(t) {
      if (st === 'pending' && pickPt && classifyDrag(0, 0, t - t0) === 'toss') startPull(x0, y0, LOFT_MIN);
    },
    up(id, x, y) {
      if (id !== ptr) return;
      if (st === 'placing') { st = 'idle'; ptr = null; tryPlace(o.pick(x, y)); return; }
      if (st === 'pulling') { updatePull(x, y); end(cur.cancel ? 'cancel' : 'throw'); }
      else { st = 'idle'; ptr = null; pickPt = null; }
    },
    pointerCancel(id) {
      if (id !== ptr) return;
      if (st === 'placing') { st = 'idle'; ptr = null; return; }
      if (st === 'pulling') end('cancel'); else { st = 'idle'; ptr = null; pickPt = null; }
    },
    // returns true if the key was handled
    key(k, shift = false) {
      if (phase === 'off') return false;
      if (phase === 'place') {
        if (k === 'Enter') return tryPlace(placePt || o.placeStart || TOSS.placeStart) || true;
        const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
        if (!dir) return false;
        const step = shift ? TOSS.placeStepFine : TOSS.placeStep;
        const base = placePt || o.placeStart || TOSS.placeStart;
        placeAt({ x: base.x + dir[0] * step, y: base.y + dir[1] * step });
        return true;
      }
      if (k === 'Escape') {
        if (st === 'pulling' || st === 'keys') { end('cancel'); return true; }
        return false;
      }
      if (st === 'pulling') return false;
      const yaw = o.getYaw ? o.getYaw() : 0;
      if (st !== 'keys') {
        if (st !== 'idle') return false;
        if ((k === 'ArrowLeft' || k === 'ArrowRight') && phase === 'aim') {
          const step = shift ? TOSS.keyTurnFine : TOSS.keyTurn;
          o.onTurn && o.onTurn(k === 'ArrowLeft' ? -step : step);
          return true;
        }
        if (k === 'Enter') {
          const org = o.getOrigin ? o.getOrigin() : court.circle;
          const d = o.defaultDistance ?? TOSS.defaultDistance;
          const s = snapped({ x: org.x + Math.sin(yaw) * d, y: org.y + Math.cos(yaw) * d });
          st = 'keys';
          cur = { donnee: { x: s.x, y: s.y }, loft: TOSS.keyStartLoft, snappedTo: s.snappedTo, cancel: false };
          emit();
          return true;
        }
        return false;
      }
      // keyboard toss in progress
      const fwd = { x: Math.sin(yaw), y: Math.cos(yaw) }, right = { x: Math.cos(yaw), y: -Math.sin(yaw) };
      let dx = 0, dy = 0;
      if (shift && (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight')) {
        const a = k === 'ArrowUp' ? 1 : k === 'ArrowDown' ? -1 : 0;
        const b = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0;
        dx = (fwd.x * a + right.x * b) * TOSS.keyStep; dy = (fwd.y * a + right.y * b) * TOSS.keyStep;
        // move from the unsnapped spot so a snap does not trap the cursor
        const base = cur.free || cur.donnee;
        const free = { x: base.x + dx, y: base.y + dy };
        const s = snapped(free);
        cur = { donnee: { x: s.x, y: s.y }, free, loft: cur.loft, snappedTo: s.snappedTo, cancel: false };
        emit();
        return true;
      }
      if (k === 'w' || k === 'W' || k === 's' || k === 'S') {
        const up = k === 'w' || k === 'W';
        cur.loft = clamp(cur.loft + (up ? TOSS.keyLoft : -TOSS.keyLoft), LOFT_MIN, LOFT_MAX);
        emit();
        return true;
      }
      if (k === 'Enter') { end('throw'); return true; }
      return false;
    },
  };
  return m;
}

const STYLE_NAMES = { roulette: 'Roulette', 'demi-portee': 'Demi-portée', plombee: 'Plombée' };

export function createTossInput(canvas, options) {
  const { showReadout = true, ...opts } = options;
  let readout = null;
  if (showReadout) {
    readout = document.createElement('div');
    readout.className = 'toss-readout';
    readout.hidden = true;
    (canvas.parentElement || document.body).appendChild(readout);
  }
  const size = () => { const r = canvas.getBoundingClientRect(); return { w: r.width || 1, h: r.height || 1 }; };
  function onReadout(s) {
    if (!readout) return;
    if (!s) { readout.hidden = true; return; }
    readout.hidden = false;
    readout.classList.toggle('is-cancel', !!s.cancel);
    readout.textContent = s.cancel
      ? 'Release to cancel'
      : `${STYLE_NAMES[styleForLoft(s.loft)]} ${Math.round(s.loft / DEG)}°${s.snappedTo ? ' · lands just short' : ''}`;
    let x, y;
    if (s.px !== undefined) { x = s.px + 18; y = s.py - 36; }
    else { const r = canvas.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height * 0.2; }
    // keep the readout inside the viewport (full-window play, small phones)
    const m = 6, w = readout.offsetWidth, h = readout.offsetHeight;
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    x = Math.max(m, Math.min(x, vw - w - m));
    y = Math.max(m, Math.min(y, vh - h - m));
    readout.style.left = `${x}px`; readout.style.top = `${y}px`;
  }
  const mach = createTossMachine({ ...opts, size, onReadout });

  let timer = 0;
  const clearTimer = () => { clearTimeout(timer); timer = 0; };
  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const wasActive = mach.state !== 'idle';
    const took = mach.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    if (took) {
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
      clearTimer();
      timer = setTimeout(() => mach.tick(performance.now()), TOSS.dwellMs + 10);
    } else if (wasActive) clearTimer();
  };
  const onMove = (e) => {
    if (mach.state === 'idle' && mach.phase === 'place' && e.pointerType === 'mouse') mach.hover(e.clientX, e.clientY);
    else mach.move(e.pointerId, e.clientX, e.clientY, e.timeStamp);
  };
  const onUp = (e) => { clearTimer(); mach.up(e.pointerId, e.clientX, e.clientY, e.timeStamp); };
  const onCancelPtr = (e) => { clearTimer(); mach.pointerCancel(e.pointerId); };
  const onKey = (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'BUTTON' && e.key === 'Enter')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (mach.key(e.key, e.shiftKey)) e.preventDefault();
  };
  const onMenu = (e) => e.preventDefault();

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancelPtr);
  canvas.addEventListener('contextmenu', onMenu);
  window.addEventListener('keydown', onKey);

  return {
    setPhase(p) { clearTimer(); mach.setPhase(p); },
    getPhase() { return mach.phase; },
    destroy() {
      clearTimer();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancelPtr);
      canvas.removeEventListener('contextmenu', onMenu);
      window.removeEventListener('keydown', onKey);
      if (readout) readout.remove();
    },
  };
}
