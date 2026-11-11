// Synthesized pétanque sounds. Web Audio only, no audio files.
//
// Usage (in main.js, not wired yet):
//   import { createAudio } from './audio.js';
//   const audio = createAudio();
//   hud.append(audio.createMuteButton());          // clicking it also calls unlock()
//   startBtn.addEventListener('click', () => audio.unlock());
//   // after each world.step() batch or once per frame:
//   const byId = new Map(world.bodies.map((b) => [b.id, b]));
//   audio.handleEvents(world.events, byId);       // plain object keyed by id also works
//   world.events.length = 0;
//
// unlock() must run inside a user gesture (click, tap, key press). Before that,
// when muted, or without Web Audio, handleEvents() does nothing and never throws.
// Mute state is remembered in localStorage under 'petanque-muted' ('1' or '0').

const MUTE_KEY = 'petanque-muted';
const MAX_VOICES = 8; // simultaneous sounds
const MIN_SPEED = 0.1; // m/s; quieter events are skipped
const FULL_SPEED = 8; // m/s at which volume reaches full
const MASTER_GAIN = 0.6;

function loadMuted() {
  try {
    return globalThis.localStorage.getItem(MUTE_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function saveMuted(muted) {
  try {
    globalThis.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch (e) {
    // storage blocked or full: mute still works for this page view
  }
}

// Volume curve: quiet impacts stay quiet, hard ones reach full level.
function volumeFor(speed) {
  return Math.min(1, Math.pow(speed / FULL_SPEED, 0.7));
}

export function createAudio() {
  const Ctor = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  let muted = loadMuted();
  let ctx = null;
  let master = null;
  let noise = null; // shared 1 s white-noise buffer
  let voices = 0;
  const buttons = new Set();

  function makeNoise(c) {
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Create the AudioContext on first call. Safe to call again.
  function unlock() {
    if (!Ctor) return;
    try {
      if (!ctx) {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = MASTER_GAIN;
        master.connect(ctx.destination);
        noise = makeNoise(ctx);
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch (e) {
      ctx = null;
      master = null;
    }
  }

  // Short noise burst starting at t from a random offset in the shared buffer.
  function noiseSource(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.start(t, Math.random() * 0.5, dur);
    return s;
  }

  // Exponential decay envelope: fast attack, then decay to silence over `decay` seconds.
  function envGain(t, peak, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    return g;
  }

  // Count a sound as one voice until `dur` seconds have passed.
  function startVoice(t, dur) {
    voices++;
    const marker = ctx.createConstantSource();
    marker.offset.value = 0;
    marker.connect(master);
    marker.onended = () => {
      voices--;
    };
    marker.start(t);
    marker.stop(t + dur);
  }

  // Steel boule on boule: bright noise transient plus two inharmonic partials.
  // Jack involved: duller, quieter wooden tick with lower partials.
  function clack(t, g, pitch, jack) {
    const decay = jack ? 0.06 : 0.25;
    startVoice(t, decay + 0.02);

    const n = noiseSource(t, 0.03);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (jack ? 1400 : 3800) * pitch;
    bp.Q.value = jack ? 1.5 : 2;
    n.connect(bp).connect(envGain(t, g * (jack ? 0.3 : 0.8), jack ? 0.03 : 0.012)).connect(master);

    const partials = jack
      ? [[1100, 0.5], [1700, 0.2]]
      : [[2200, 0.5], [3130, 0.3]];
    for (const [f, a] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * pitch;
      o.connect(envGain(t, g * a * (jack ? 0.35 : 0.5), decay)).connect(master);
      o.start(t);
      o.stop(t + decay + 0.02);
    }
  }

  // Gravel crunch: low-passed noise burst, pitch-varied per landing.
  function crunch(t, g, pitch) {
    const dur = 0.16;
    startVoice(t, dur);
    const n = noiseSource(t, dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700 * pitch;
    lp.Q.value = 0.7;
    n.connect(lp).connect(envGain(t, g * 0.9, dur)).connect(master);
  }

  // Stone knocked by a boule: tiny, quiet high-passed click.
  function click(t, g, pitch) {
    const dur = 0.02;
    startVoice(t, dur);
    const n = noiseSource(t, dur);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000 * pitch;
    n.connect(hp).connect(envGain(t, g * 0.15, 0.012)).connect(master);
  }

  function bodyOf(bodiesById, id) {
    if (!bodiesById) return null;
    return bodiesById instanceof Map ? bodiesById.get(id) : bodiesById[id];
  }

  // Play sounds for physics events. Silent for 'dead' and unknown types.
  function handleEvents(events, bodiesById) {
    if (!ctx || muted || !events || !events.length) return;
    if (ctx.state !== 'running') {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    const t = ctx.currentTime + 0.005;
    try {
      for (const ev of events) {
        if (!ev || !(ev.speed >= MIN_SPEED)) continue;
        if (voices >= MAX_VOICES) break;
        const g = volumeFor(ev.speed);
        const pitch = 0.95 + Math.random() * 0.1;
        if (ev.type === 'hit') {
          const a = bodyOf(bodiesById, ev.a);
          const b = bodyOf(bodiesById, ev.b);
          const jack = (a && a.kind === 'jack') || (b && b.kind === 'jack');
          clack(t, g, pitch, !!jack);
        } else if (ev.type === 'land') {
          crunch(t, g, pitch);
        } else if (ev.type === 'stone') {
          click(t, g, pitch);
        }
      }
    } catch (e) {
      // a failed sound must never break the game loop
    }
  }

  function syncButtons() {
    for (const btn of buttons) {
      // Fixed label plus aria-pressed: screen readers announce "Mute, pressed".
      btn.textContent = 'Mute';
      btn.setAttribute('aria-pressed', String(muted));
    }
  }

  function setMuted(value) {
    muted = !!value;
    saveMuted(muted);
    syncButtons();
  }

  function isMuted() {
    return muted;
  }

  // Toggle button. Its click handler also unlocks audio (it is a user gesture).
  function createMuteButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'petanque-mute';
    btn.addEventListener('click', () => {
      unlock();
      setMuted(!muted);
    });
    buttons.add(btn);
    syncButtons();
    return btn;
  }

  return { unlock, handleEvents, setMuted, isMuted, createMuteButton };
}
