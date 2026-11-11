// Synthesized pétanque sounds. Web Audio only, no audio files.
//
// Usage (main.js):
//   const audio = createAudio();
//   hud.append(audio.createMuteButton());          // clicking it also calls unlock()
//   // once per frame:
//   const byId = new Map(world.bodies.map((b) => [b.id, b]));
//   audio.handleEvents(world.events, byId);        // impacts (events may be empty)
//   audio.update(byId, dt);                        // schedules rolling pebble ticks from body speeds
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
//   roll      per rolling body: very faint, sparse, dry pebble ticks (1-3 ms band-passed noise bursts,
//             random centre 1.5-4 kHz, 2-6 ms decay, some duller gravel ticks, rare 2-3 tick clatter).
//             Poisson-ish scheduling on AudioContext time; rate and level follow speed. No noise floor.
//   stone     one slightly louder pebble tick when the physics reports a stone contact

import { createAmbient } from './ambient.js'; // F12: park ambience (birds, breeze, airplane)

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
  roll: { // rolling = sparse pebble ticks, scheduled per rolling body (no continuous noise)
    minSpeed: 0.05, // m/s: silent below this
    fullSpeed: 3, // m/s at which rate and level reach their maximum
    fadeSpeed: 0.3, // m/s above minSpeed over which rate/level fade in: slow rolls = a few ticks, then silence
    rateMin: 0.6, rateMax: 6, // ticks per second per body: slow roll .. fast roll (Poisson-ish, random gaps)
    rateCurve: 1.5, // >1 keeps mid speeds sparse
    lookahead: 0.07, // s: ticks are scheduled this far ahead of the audio clock inside each update()
    maxPerSec: 120, // cap on ticks per second across all bodies (clatter ticks count too)
    gain: 0.015, // level of a fast boule tick (compare: soft landing thud peaks ~0.3)
    levelMin: 0.35, // level factor at the slowest roll (rising to 1 at fullSpeed)
    levelSpread: [0.3, 1], // random per-tick level factor
    freqLo: 600, freqHi: 1600, q: [0.7, 1.2], // Hz band-pass centre range and Q (low = soft, dry)
    burst: [0.001, 0.003], // s: noise burst length
    attack: 0.0005, // s: soft onset
    decay: [0.002, 0.006], // s: fast decay (dry, no ringing)
    dullChance: 0.25, // fraction of boule ticks that are lower and duller (gravel grinding)
    dullFreqLo: 250, dullFreqHi: 550, dullDecay: [0.005, 0.01], dullGain: 1.3,
    clatterChance: 0.12, // chance a tick becomes a pair/triple (small pebble clatter)
    clatterGap: [0.004, 0.02], clatterFall: 0.65, // s between ticks; level factor per extra tick
    jackFreqLo: 1400, jackFreqHi: 3000, jackGain: 0.5, jackRate: 0.8, // jack: higher, lighter, quieter, a bit sparser
    deadGain: 0.7, // level factor for dead/ghost balls rolling outside the court
    stoneGain: 2, // stone event tick: level factor over a normal tick, also scaled by speed
    stoneSpeed: 3, // m/s of a stone contact that gives the full stone tick level
  },
};

const MUTE_KEY = 'petanque-muted';
const MUTE_ICON_ON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const MUTE_ICON_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

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
  let amb = null; // F12 ambience (created in setup, after unlock); always on, the mute button silences it
  const syncAmb = () => { if (amb) amb.setActive(!muted); };
  let voices = 0;
  let tickWin = 0, tickCount = 0; // ticks scheduled in the current 1 s window (cap)
  let frame = 0;
  const rolls = new Map(); // key -> rolling tick scheduler { next, seen, silent }
  const buttons = new Set();

  function makeWhite(c) {
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
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
    try { amb = createAmbient(ctx, master); } catch (e) { amb = null; }
    syncAmb();
  }

  // D12: the game is paused. Suspend the context (scheduled ticks stop with it); unlock() and events don't wake it.
  let held = false;
  function setPaused(on) {
    held = !!on;
    if (!ctx) return;
    try {
      if (held && ctx.state === 'running' && ctx.suspend) ctx.suspend().catch(() => {});
      else if (!held && ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    } catch (e) { /* ignore */ }
  }

  // Create the AudioContext on first call. Safe to call again.
  function unlock() {
    try {
      if (!ctx) {
        if (opts.context) setup(opts.context);
        else if (Ctor) setup(new Ctor());
        else return;
      }
      if (!held && ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    } catch (e) {
      ctx = null;
      master = null;
      amb = null;
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

  // One dry pebble tick: tiny band-passed noise burst, soft attack, very fast decay.
  // kind: 'boule' | 'jack'. Returns false when the per-second cap is reached.
  function pebble(t, kind, level, dullChance) {
    const R = SOUND.roll;
    if (t >= tickWin + 1 || t < tickWin) { tickWin = t; tickCount = 0; }
    if (tickCount >= R.maxPerSec) return false;
    tickCount++;
    const jack = kind === 'jack';
    const dull = !jack && Math.random() < dullChance;
    const f = dull ? rnd(R.dullFreqLo, R.dullFreqHi) : jack ? rnd(R.jackFreqLo, R.jackFreqHi) : rnd(R.freqLo, R.freqHi);
    const decay = dull ? rnd(...R.dullDecay) : rnd(...R.decay);
    const gain = R.gain * level * (jack ? R.jackGain : dull ? R.dullGain : 1) * rnd(...R.levelSpread);
    const src = noiseSrc(t, rnd(...R.burst));
    src.connect(filt('bandpass', f, rnd(...R.q))).connect(envGain(t, gain, decay, R.attack)).connect(master);
    return true;
  }

  // A tick, sometimes a pair or triple of quick, fading ticks (little clatter).
  function pebbleGroup(t, kind, level, clatterChance = SOUND.roll.clatterChance) {
    const R = SOUND.roll;
    if (!pebble(t, kind, level, R.dullChance)) return;
    if (Math.random() < clatterChance) {
      const n = Math.random() < 0.3 ? 2 : 1;
      let gt = t, lv = level;
      for (let i = 0; i < n; i++) {
        gt += rnd(...R.clatterGap); lv *= R.clatterFall;
        if (!pebble(gt, kind, lv, R.dullChance)) break;
      }
    }
  }

  // Poisson-ish gap to the next tick for a given rate (ticks/s).
  const gapFor = (rate) => Math.min(0.6, Math.max(0.002, -Math.log(1 - Math.random()) / Math.max(rate, 0.5)));

  // Rate (ticks/s) and level factor for a horizontal speed, 0 below minSpeed.
  function rollParams(kind, speed) {
    const R = SOUND.roll;
    if (!(speed >= R.minSpeed)) return null;
    const f = clamp01((speed - R.minSpeed) / (R.fullSpeed - R.minSpeed));
    const fade = clamp01((speed - R.minSpeed) / R.fadeSpeed);
    const rate = (R.rateMin + (R.rateMax - R.rateMin) * Math.pow(f, R.rateCurve)) * fade * (kind === 'jack' ? R.jackRate : 1);
    const level = (R.levelMin + (1 - R.levelMin) * f) * (0.4 + 0.6 * fade);
    return { rate, level };
  }

  function stopRoll(key) {
    rolls.delete(key);
  }

  // Drive one rolling body from its horizontal speed (m/s): schedule ticks inside the lookahead window.
  function rollTick(key, kind, speed, dt = 1 / 60, gainMul = 1) {
    const R = SOUND.roll;
    let v = rolls.get(key);
    const p = rollParams(kind, speed);
    if (!p) {
      if (v) {
        v.seen = frame;
        if ((v.silent += dt) > 0.4) stopRoll(key);
      }
      return;
    }
    const now = ctx.currentTime;
    if (!v) {
      if (rolls.size >= SOUND.maxRolling) return;
      v = { next: now + gapFor(p.rate) * Math.random(), seen: frame, silent: 0 };
      rolls.set(key, v);
    }
    v.seen = frame; v.silent = 0;
    if (v.next < now) v.next = now + gapFor(p.rate) * Math.random(); // fell behind (tab hidden, long frame)
    const horizon = now + R.lookahead;
    let guard = 12;
    while (v.next < horizon && guard-- > 0) {
      pebbleGroup(v.next, kind === 'jack' ? 'jack' : 'boule', p.level * gainMul);
      v.next += gapFor(p.rate);
    }
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
        if (!b || b.state !== 'rolling') continue; // dead/ghost balls still roll: a little quieter
        rollTick(b.id, b.kind, Math.hypot(b.vx, b.vy), dt || 1 / 60, b.dead || b.ghost ? SOUND.roll.deadGain : 1);
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
      if (!held && ctx.state === 'suspended') ctx.resume().catch(() => {});
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
          const a = bodyOf(bodiesById, ev.a); // real pebble contact: one slightly louder tick, still quiet
          const R = SOUND.roll;
          pebble(t, a && a.kind === 'jack' ? 'jack' : 'boule', R.stoneGain * (0.4 + 0.6 * clamp01(ev.speed / R.stoneSpeed)), R.dullChance);
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

  // F61: a short synthesized fanfare for the CARREAU / BIBERON overlay (a rising arpeggio with a glittering top). Respects mute.
  function fanfare(kind) {
    if (!ctx || muted || held || ctx.state !== 'running') return;
    try {
      const t0 = ctx.currentTime + 0.02;
      const notes = kind === 'carreau' ? [523.25, 659.25, 783.99, 1046.5] : [440, 554.37, 659.25, 880];
      notes.forEach((f, i) => {
        const t = t0 + i * 0.075;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.connect(envGain(t, 0.14, 0.38, 0.01)).connect(master);
        o.start(t); o.stop(t + 0.42);
        const s = ctx.createOscillator(); // octave sparkle
        s.type = 'sine';
        s.frequency.value = f * 2;
        s.connect(envGain(t, 0.05, 0.25, 0.005)).connect(master);
        s.start(t); s.stop(t + 0.3);
      });
    } catch (e) { /* ignore */ }
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
      // F32: an icon button (speaker / muted speaker). Fixed label plus aria-pressed: screen readers announce "Mute, pressed".
      btn.innerHTML = muted ? MUTE_ICON_OFF : MUTE_ICON_ON;
      btn.setAttribute('aria-label', 'Mute');
      btn.title = muted ? 'Unmute' : 'Mute';
      btn.setAttribute('aria-pressed', String(muted));
    }
  }

  function setMuted(value) {
    muted = !!value;
    saveMuted(muted);
    syncButtons();
    syncAmb();
  }

  // F12: audition ('bird' | 'breeze' | 'plane' | 'floatplane' | 'accordion' | 'cicada' | 'bell') ignores mute.
  function playAmbient(name) { unlock(); if (amb) amb.audition(name); }
  // F19: the floatplane's engine, fed every frame by the game (follows mute; silent while paused)
  function setEngine(on, level, pan, rev, dist) { if (amb && amb.engine && !held) amb.engine(on, level, pan, rev, dist); }

  // F66: busy = a human aim/throw moment (no rare tonal events start), slow = slow mode
  function setAmbientState(st) { if (amb && amb.setState) amb.setState(st); }

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

  return { unlock, setPaused, handleEvents, update, accent, fanfare, play, setMuted, isMuted, playAmbient, setEngine, setAmbientState, createMuteButton };
}
