// F94: Web Audio unlock/resume lifecycle for iOS Safari (and everything else). Pure-ish: every browser object is injected,
// so node tests drive it with a fake context, document and window.
//
// What iOS does to us:
//  - an AudioContext only starts (or restarts) from a user gesture (touchend/click/pointerup; touchstart does not count);
//  - it goes 'suspended' or 'interrupted' (iOS only) on backgrounding, screen lock, calls and route changes, and stays so
//    until resumed again, so we retry on every gesture while not 'running', and on visibilitychange / pageshow / focus;
//  - the hardware silent switch mutes Web Audio unless the page holds a 'playback' audio session: navigator.audioSession.type
//    where it exists, else a looping silent <audio> element started inside a gesture;
//  - resume() on an interrupted context can hang forever, so an unsettled attempt is retried after RETRY_MS.
//
// const u = createAudioUnlock({ doc, win, nav, getContext, create, isMuted, isHeld, onState });
// u.attach(); u.resume(); u.detach();     u.resumes = number of resume() calls made
// Muted or held (game paused, D12) means: never resume (the unmute click and setPaused(false) do it themselves).

export const NEEDS_RESUME = (s) => s === 'suspended' || s === 'interrupted';
export const GESTURES = ['touchend', 'pointerup', 'click', 'keydown'];
const RETRY_MS = 1000;

// A 0.1 s silent mono 8 kHz 8-bit WAV as a data URI (no file, no network).
export function silentWavUri() {
  const n = 800, b = new Uint8Array(44 + n);
  const w32 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; b[o + 2] = (v >> 16) & 255; b[o + 3] = (v >> 24) & 255; };
  const tag = (o, s) => { for (let i = 0; i < 4; i++) b[o + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); w32(4, 36 + n); tag(8, 'WAVE'); tag(12, 'fmt '); w32(16, 16);
  b[20] = 1; b[22] = 1; w32(24, 8000); w32(28, 8000); b[32] = 1; b[34] = 8; tag(36, 'data'); w32(40, n);
  b.fill(128, 44);
  let s = ''; for (const x of b) s += String.fromCharCode(x);
  return 'data:audio/wav;base64,' + btoa(s);
}

export function createAudioUnlock({ doc, win, nav, getContext, create, isMuted = () => false, isHeld = () => false, onState, now = () => Date.now() } = {}) {
  let attached = false, boundCtx = null, pendingSince = -Infinity, silent = null, sessionSet = false;
  const api = { resumes: 0, attached: () => attached };

  function playbackSession() {
    if (sessionSet) return;
    try { if (nav && nav.audioSession) { nav.audioSession.type = 'playback'; sessionSet = true; } } catch (e) { /* ignore */ }
  }
  // Fallback for iOS without navigator.audioSession: a looping silent <audio> keeps the 'playback' category. Gesture only.
  function silentAudio() {
    if (silent || sessionSet || !doc || !doc.createElement) return;
    try {
      silent = doc.createElement('audio');
      silent.src = silentWavUri(); silent.loop = true; silent.preload = 'auto';
      if (silent.setAttribute) silent.setAttribute('playsinline', '');
      const p = silent.play && silent.play();
      if (p && p.catch) p.catch(() => { silent = null; }); // refused (not a gesture): try again on the next one
    } catch (e) { silent = null; }
  }

  function track(c) {
    if (!c || c === boundCtx) return;
    boundCtx = c;
    if (onState) {
      onState(c.state, 'initial');
      try { c.addEventListener ? c.addEventListener('statechange', () => onState(c.state, 'statechange')) : (c.onstatechange = () => onState(c.state, 'statechange')); } catch (e) { /* ignore */ }
    }
  }

  // Try to bring the context back to 'running'. Returns true if a resume() call was made.
  function resume(why = 'manual', force = false) {
    const c = getContext();
    if (!c) return false;
    track(c);
    if ((isMuted() && !force) || isHeld() || !NEEDS_RESUME(c.state) || !c.resume) return false;
    const t = now();
    if (t - pendingSince < RETRY_MS) return false; // an attempt is still in flight
    pendingSince = t;
    api.resumes++;
    if (onState) onState(c.state, 'resume:' + why);
    try {
      const p = c.resume();
      if (p && p.then) p.then(() => { pendingSince = -Infinity; if (onState) onState(c.state, 'resumed'); }, () => { pendingSince = -Infinity; });
      else pendingSince = -Infinity;
    } catch (e) { pendingSince = -Infinity; }
    return true;
  }

  function onGesture(ev, force = false) {
    playbackSession(); silentAudio();
    if (!getContext() && create && (force || !isMuted())) { try { create(); } catch (e) { /* ignore */ } }
    resume(ev && ev.type || 'gesture', force);
  }
  const onVisible = () => { if (!doc || doc.visibilityState !== 'hidden') resume('visible'); };
  const onPage = () => resume('pageshow');
  const onFocus = () => resume('focus');

  api.attach = function attach() {
    if (attached) return;
    attached = true;
    if (doc && doc.addEventListener) {
      for (const g of GESTURES) doc.addEventListener(g, onGesture, { capture: true, passive: true });
      doc.addEventListener('visibilitychange', onVisible);
    }
    if (win && win.addEventListener) { win.addEventListener('pageshow', onPage); win.addEventListener('focus', onFocus); }
  };
  api.detach = function detach() {
    if (!attached) return;
    attached = false;
    if (doc && doc.removeEventListener) {
      for (const g of GESTURES) doc.removeEventListener(g, onGesture, { capture: true });
      doc.removeEventListener('visibilitychange', onVisible);
    }
    if (win && win.removeEventListener) { win.removeEventListener('pageshow', onPage); win.removeEventListener('focus', onFocus); }
    if (silent) { try { silent.pause(); } catch (e) { /* ignore */ } silent = null; }
  };
  api.resume = resume;
  api.gesture = () => onGesture(null, true); // explicit unlock() (mute button, audition): resumes even while muted
  return api;
}
