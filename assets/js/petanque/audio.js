// Synthesized pétanque sounds. Web Audio only, no audio files.
//
// Usage (main.js):
//   const audio = createAudio();
//   hud.append(audio.createMuteButton());          // clicking it also calls unlock()
//   // once per frame:
//   const byId = new Map(world.bodies.map((b) => [b.id, b]));
//   audio.handleEvents(world.events, byId);        // impacts (events may be empty)
//   audio.update(byId);                            // rolling/scrape loops follow body speeds
//
// unlock() must run inside a user gesture. Before that, when muted, or without Web Audio,
// everything is a silent no-op and never throws. Mute is stored in localStorage ('petanque-muted').
// play(name, params) triggers one sound directly (used by the ?debug&sounds audition panel).
//
// Sound recipes:
//   land      soft low thud (slow-attack, pitch-dropped sine ~40-80 Hz) + faint dry gravel crunch
//   jackLand  light wooden tick + tiny crunch
//   jackHit   light wooden tick (louder with speed)
//   click     boule-boule, a lower billiard-ball knock: dry band-passed noise ~1.5 kHz + low-passed
//             noise body, faint very short tone. Direct hits louder and lower; grazes quieter, higher.
//   roll      per rolling body: barely audible band-passed noise + crackle, gain follows speed

// All tuning numbers live here. Gains are linear (0..1 before the compressor).
export const SOUND = {
  masterGain: 0.7, // overall level into the limiter
  maxVoices: 10, // simultaneous one-shot sounds
  maxRolling: 6, // simultaneous rolling voices
  minSpeed: 0.1, // m/s; quieter impacts are skipped
  fullSpeed: 8, // m/s at which impact volume reaches full
  volumeCurve: 0.7, // <1 lifts quiet impacts

  limiter: { threshold: -10, knee: 6, ratio: 8, attack: 0.003, release: 0.15 }, // dB / seconds

  thud: {
    gain: 1.0,
    attack: 0.012, // s: soft onset (no sharp attack)
    freqHi: 80, freqLo: 42, // Hz: sine starts at freqHi, drops to freqLo
    drop: 0.04, // s: pitch-drop time constant
    decay: 0.09, // s: body decay (short = dry)
    triGain: 0, // triangle layer (adds upper harmonics; off for a lower thud)
    thumpCut: 120, // Hz: low-passed noise "thump" cutoff
    thumpGain: 0.2,
  },
  crunch: {
    gain: 0.05,
    attack: 0.002, // s: grains fade in rather than click
    grainsMin: 2, grainsMax: 7, // number of grains (scales with speed)
    span: 0.06, // s: grains scattered over this window
    freqLo: 500, freqHi: 1600, // Hz: random band-pass centre per grain
    q: 0.9,
    grainMin: 0.004, grainMax: 0.01, // s: grain length
  },
  jack: {
    tickFreq: 2200, tickQ: 1.4, tickGain: 0.5, tickDecay: 0.008, // band-passed noise impulse
    attack: 0.002, // s: light onset
    sineFreq: 1100, sineGain: 0.03, sineDecay: 0.012, // faint woody tone
    landCrunch: 0.12, // fraction of boule crunch added to the jack landing
    quiet: 0.4, // overall level of jack sounds
  },
  click: { // boule on boule: a billiard-ball knock, pitched lower
    gain: 0.9,
    noiseFreq: 1500, noiseQ: 0.8, noiseDecay: 0.004, noiseGain: 1.3, // main dry knock
    bodyCut: 700, bodyDecay: 0.006, bodyGain: 0.8, // low-passed noise: weight of the knock
    partials: [[850, 0.25], [1300, 0.12]], // [Hz, relative gain]: faint, very short tone
    decayGraze: 0.006, decayDirect: 0.014, // s: partial ring, graze to head-on (dry)
    pitchGraze: 1.15, pitchDirect: 0.85, // pitch factor, graze to head-on
    gainGraze: 0.45, gainDirect: 1, // level factor, graze to head-on
  },
  carreauAccent: 0.5, // extra click level for accent('carreau')
  roll: {
    minSpeed: 0.05, // m/s: silent below this
    fullSpeed: 3, // m/s at which scrape reaches full gain
    gain: 0.003, // boule scrape level: barely audible
    freq: 1700, q: 0.9, // band-pass centre/Q for boule
    modDepth: 0.35, // slow random modulation of centre freq (fraction)
    modRate: 1.5, // modulation speed (higher = more restless)
    crackleGain: 0.1, // relative level of the crackle (pebble clicks) layer
    curve: 1.6, // >1 keeps slow rolls near silent
    jackGain: 0.35, jackFreq: 4200, // jack: much lighter and higher
    fade: 0.06, // s: gain smoothing time constant (no clicks)
  },
};

const MUTE_KEY = 'petanque-muted';

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

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Volume curve: quiet impacts stay quiet, hard ones reach full level.
function volumeFor(speed) {
  return Math.min(1, Math.pow(Math.max(0, speed) / SOUND.fullSpeed, SOUND.volumeCurve));
}

// opts.context: use this (e.g. Offline)AudioContext instead of creating one (testing).
export function createAudio(opts = {}) {
  const Ctor = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  let muted = loadMuted();
  let ctx = null;
  let master = null; // gain -> limiter -> destination; sounds connect here
  let white = null; // shared 2 s white noise
  let grain = null; // shared 1 s sparse crackle (tiny pebble clicks)
  let voices = 0;
  let frame = 0;
  const rolls = new Map(); // key -> rolling voice
  const buttons = new Set();

  function makeWhite(c) {
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Sparse random clicks: each is a ~1 ms noise burst with decaying amplitude.
  function makeGrain(c) {
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = buf.getChannelData(0);
    const burst = Math.round(c.sampleRate * 0.0012);
    for (let i = 0; i < d.length - burst; i++) {
      if (Math.random() < 90 / c.sampleRate) {
        const a = 0.3 + Math.random() * 0.7;
        for (let k = 0; k < burst; k++) d[i + k] += (Math.random() * 2 - 1) * a * (1 - k / burst);
      }
    }
    return buf;
  }

  function setup(c) {
    ctx = c;
    master = ctx.createGain();
    master.gain.value = SOUND.masterGain;
    const lim = ctx.createDynamicsCompressor();
    const L = SOUND.limiter;
    lim.threshold.value = L.threshold; lim.knee.value = L.knee; lim.ratio.value = L.ratio;
    lim.attack.value = L.attack; lim.release.value = L.release;
    master.connect(lim).connect(ctx.destination);
    white = makeWhite(ctx);
    grain = makeGrain(ctx);
  }

  // Create the AudioContext on first call. Safe to call again.
  function unlock() {
    try {
      if (!ctx) {
        if (opts.context) setup(opts.context);
        else if (Ctor) setup(new Ctor());
        else return;
      }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    } catch (e) {
      ctx = null;
      master = null;
    }
  }

  // ---------- building blocks ----------

  // Noise burst from the shared white buffer at a random offset.
  function noiseSrc(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = white;
    s.start(t, Math.random() * 1.5, dur + 0.01);
    s.stop(t + dur + 0.01);
    return s;
  }

  // Attack over `attack` s, then exponential decay to silence by `decay` s after the start.
  function envGain(t, peak, decay, attack = 0.0015) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(decay, attack + 0.004));
    return g;
  }

  function filt(type, f, q) {
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    return b;
  }

  // Count a one-shot as a voice until `dur` seconds pass.
  function startVoice(t, dur) {
    voices++;
    const marker = ctx.createConstantSource();
    marker.offset.value = 0;
    marker.connect(master);
    marker.onended = () => { voices--; };
    marker.start(t);
    marker.stop(t + dur);
  }

  // Sine/triangle with an exponential pitch glide and a decay envelope.
  function tone(t, type, f0, f1, tau, g, decay, attack) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + tau);
    o.connect(envGain(t, g, decay, attack)).connect(master);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  // ---------- one-shot sounds ----------

  // Gravel crunch: random noise grains between 1 and 4 kHz scattered over ~0.1 s.
  function crunch(t, amount) {
    const K = SOUND.crunch;
    const n = Math.round(K.grainsMin + (K.grainsMax - K.grainsMin) * clamp01(amount));
    for (let i = 0; i < n; i++) {
      const gt = t + Math.pow(Math.random(), 1.3) * K.span; // denser at the start
      const len = rnd(K.grainMin, K.grainMax);
      const src = noiseSrc(gt, len);
      const bp = filt('bandpass', rnd(K.freqLo, K.freqHi), K.q);
      src.connect(bp).connect(envGain(gt, K.gain * amount * rnd(0.3, 1), len, K.attack)).connect(master);
    }
  }

  // Boule on gravel: soft low thud + faint crunch. No ringing tone, no sharp attack.
  function land(t, speed) {
    const v = volumeFor(speed), T = SOUND.thud;
    startVoice(t, T.decay + SOUND.crunch.span + 0.05);
    tone(t, 'sine', T.freqHi, T.freqLo, T.drop, (T.gain * v), T.decay, T.attack);
    tone(t, 'triangle', T.freqHi * 1.5, T.freqLo * 1.4, T.drop, (T.gain * v) * T.triGain, T.decay * 0.7, T.attack);
    const n = noiseSrc(t, T.decay);
    n.connect(filt('lowpass', T.thumpCut, 0.7)).connect(envGain(t, T.gain * v * T.thumpGain, T.decay * 0.8, T.attack)).connect(master);
    crunch(t, v);
  }

  // Cochonnet: dry, very short woody tick.
  function tick(t, speed) {
    const J = SOUND.jack;
    const v = volumeFor(speed) * J.quiet;
    const f = rnd(0.94, 1.06);
    startVoice(t, 0.06);
    const n = noiseSrc(t, J.tickDecay * 2);
    n.connect(filt('bandpass', J.tickFreq * f, J.tickQ)).connect(envGain(t, J.tickGain * v, J.tickDecay, J.attack)).connect(master);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = J.sineFreq * f;
    o.connect(envGain(t, J.sineGain * v, J.sineDecay, J.attack)).connect(master);
    o.start(t);
    o.stop(t + J.sineDecay + 0.02);
  }

  function jackLand(t, speed) {
    tick(t, speed);
    crunch(t, volumeFor(speed) * SOUND.jack.landCrunch);
  }

  // Boule on boule, billiard-ball style. d = directness: 0 graze .. 1 head-on.
  function click(t, g, d) {
    const K = SOUND.click;
    const lerp = (a, b) => a + (b - a) * d;
    const decay = lerp(K.decayGraze, K.decayDirect);
    const pitch = lerp(K.pitchGraze, K.pitchDirect) * rnd(0.96, 1.04);
    const level = K.gain * g * lerp(K.gainGraze, K.gainDirect);
    startVoice(t, decay + 0.03);
    const n = noiseSrc(t, K.noiseDecay * 3);
    n.connect(filt('bandpass', K.noiseFreq * pitch, K.noiseQ)).connect(envGain(t, level * K.noiseGain, K.noiseDecay, 0.0008)).connect(master);
    const b = noiseSrc(t, K.bodyDecay * 3);
    b.connect(filt('lowpass', K.bodyCut * pitch, 0.7)).connect(envGain(t, level * K.bodyGain, K.bodyDecay, 0.0008)).connect(master);
    for (const [pf, a] of K.partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = pf * pitch * rnd(0.98, 1.02);
      o.connect(envGain(t, level * a, decay * rnd(0.8, 1.1), 0.0008)).connect(master);
      o.start(t);
      o.stop(t + decay + 0.02);
    }
  }

  function hit(t, speed, rel) {
    const g = volumeFor(Math.max(speed, 0));
    const d = rel > 1e-6 ? clamp01(speed / rel) : 1;
    click(t, g, d);
  }

  // ---------- rolling / scraping ----------

  function startRoll(key, kind) {
    const R = SOUND.roll;
    const jack = kind === 'jack';
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = white; src.loop = true;
    const bp = filt('bandpass', jack ? R.jackFreq : R.freq, R.q);
    const gs = ctx.createGain(); gs.gain.value = 1;
    src.connect(bp).connect(gs);
    const cr = ctx.createBufferSource();
    cr.buffer = grain; cr.loop = true;
    const crf = filt('bandpass', jack ? 5000 : 3000, 0.8);
    const cg = ctx.createGain(); cg.gain.value = R.crackleGain * 3;
    cr.connect(crf).connect(cg).connect(gs);
    const out = ctx.createGain(); out.gain.value = 0;
    gs.connect(out).connect(master);
    src.start(t, Math.random() * 1.5);
    cr.start(t, Math.random() * 0.8);
    const v = { src, cr, bp, crf, out, jack, seen: frame, mod: Math.random() * 10, modTarget: 0, modVal: 0, silent: 0 };
    rolls.set(key, v);
    return v;
  }

  function stopRoll(key) {
    const v = rolls.get(key);
    if (!v) return;
    rolls.delete(key);
    try {
      const t = ctx.currentTime;
      v.out.gain.cancelScheduledValues(t);
      v.out.gain.setTargetAtTime(0, t, 0.04);
      v.src.stop(t + 0.3);
      v.cr.stop(t + 0.3);
    } catch (e) { /* already stopped */ }
  }

  // Drive one rolling voice from a horizontal speed (m/s).
  function rollTick(key, kind, speed, dt = 1 / 60) {
    const R = SOUND.roll;
    let v = rolls.get(key);
    if (speed < R.minSpeed) {
      if (v) {
        v.seen = frame;
        v.out.gain.setTargetAtTime(0, ctx.currentTime, R.fade);
        if ((v.silent += dt) > 0.4) stopRoll(key);
      }
      return;
    }
    if (!v) {
      if (rolls.size >= SOUND.maxRolling) return;
      v = startRoll(key, kind);
    }
    v.seen = frame; v.silent = 0;
    const t = ctx.currentTime;
    // fade in above the threshold, full at fullSpeed
    const lvl = Math.pow(clamp01((speed - R.minSpeed) / (R.fullSpeed - R.minSpeed)), R.curve);
    v.out.gain.setTargetAtTime((v.jack ? R.jackGain : 1) * R.gain * lvl, t, R.fade);
    // slow random modulation of filter centre: random walk toward a drifting target
    if (Math.random() < dt * R.modRate) v.modTarget = rnd(-1, 1);
    v.modVal += (v.modTarget - v.modVal) * Math.min(1, dt * 4);
    const base = v.jack ? R.jackFreq : R.freq;
    const f = base * (0.8 + 0.4 * lvl) * (1 + R.modDepth * v.modVal);
    v.bp.frequency.setTargetAtTime(f, t, 0.05);
    v.crf.frequency.setTargetAtTime(f * 1.8, t, 0.05);
  }

  // Call once per frame. Starts, drives and stops rolling voices for grounded moving bodies.
  function update(bodiesById, dt) {
    if (!ctx || !master) return;
    if (muted || ctx.state !== 'running') {
      for (const k of [...rolls.keys()]) if (!String(k).startsWith('aud:')) stopRoll(k);
      return;
    }
    frame++;
    try {
      const list = bodiesById instanceof Map ? bodiesById.values() : Object.values(bodiesById || {});
      for (const b of list) {
        if (!b || b.dead || b.state !== 'rolling') continue;
        rollTick(b.id, b.kind, Math.hypot(b.vx, b.vy), dt || 1 / 60);
      }
      for (const [k, v] of [...rolls]) {
        if (!String(k).startsWith('aud:') && v.seen !== frame) stopRoll(k); // stopped rolling, airborne or removed
      }
    } catch (e) {
      // a failed sound must never break the game loop
    }
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
        if (!ev || !(ev.speed >= SOUND.minSpeed)) continue;
        if (voices >= SOUND.maxVoices) break;
        if (ev.type === 'hit') {
          const a = bodyOf(bodiesById, ev.a), b = bodyOf(bodiesById, ev.b);
          const jack = (a && a.kind === 'jack') || (b && b.kind === 'jack');
          if (jack) tick(t, ev.speed);
          else hit(t, ev.speed, ev.rel);
        } else if (ev.type === 'land') {
          const a = bodyOf(bodiesById, ev.a);
          if (a && a.kind === 'jack') jackLand(t, ev.speed);
          else land(t, ev.speed);
        } else if (ev.type === 'stone') {
          tick(t, ev.speed * 0.4); // pebble knocked up: tiny click
        }
      }
    } catch (e) {
      // a failed sound must never break the game loop
    }
  }

  // Extra click accent, e.g. accent('carreau').
  function accent(name) {
    if (!ctx || muted || ctx.state !== 'running' || name !== 'carreau') return;
    try { click(ctx.currentTime + 0.005, SOUND.carreauAccent, 1); } catch (e) { /* ignore */ }
  }

  // Audition entry point. Ignores mute (explicit user action) but needs unlock().
  // names: land {speed}, jackLand {speed}, jackHit {speed}, roll {kind, speed, dur, decay},
  //        graze, direct, carreau, hit {speed, rel}
  function play(name, p = {}) {
    unlock();
    if (!ctx) return;
    try {
      const t = ctx.currentTime + 0.01;
      switch (name) {
        case 'land': land(t, p.speed ?? 4); break;
        case 'jackLand': jackLand(t, p.speed ?? 3); break;
        case 'jackHit': tick(t, p.speed ?? 4); break;
        case 'graze': hit(t, p.speed ?? 2.5, p.rel ?? 8); break;
        case 'direct': hit(t, p.speed ?? 4, p.rel ?? 4.2); break;
        case 'carreau': hit(t, p.speed ?? 9, p.rel ?? 9.2); break;
        case 'hit': hit(t, p.speed ?? 4, p.rel ?? p.speed ?? 4); break;
        case 'roll': {
          const key = 'aud:' + (p.kind || 'boule') + Math.random();
          const dur = p.dur ?? 2, v0 = p.speed ?? 1.5, decay = p.decay ?? 0;
          let el = 0;
          const timer = setInterval(() => {
            el += 1 / 60;
            if (el >= dur) { clearInterval(timer); stopRoll(key); return; }
            frame++;
            rollTick(key, p.kind || 'boule', Math.max(0, v0 * (1 - decay * el / dur)), 1 / 60);
          }, 1000 / 60);
          break;
        }
        default: break;
      }
    } catch (e) { /* ignore */ }
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

  return { unlock, handleEvents, update, accent, play, setMuted, isMuted, createMuteButton };
}
