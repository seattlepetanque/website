// F12: quiet synthesized park ambience (birds, breeze, a distant airplane). No audio files; Web Audio only.
// createAmbient(ctx, dest) -> { setActive(bool), audition(name) }. Never throws; without a context it is a no-op.
// Events are scheduled a few seconds ahead on the audio clock (a 0.4 s timer tops up), so a suspended
// context (game paused) simply stops everything. One shared looped noise buffer; voices are capped.
export const AMBIENT = {
  level: 0.10, // the whole ambience bus (linear, into the game master). Boule knocks peak ~0.3-1 there.
  lookahead: 3, // s scheduled ahead
  bird: { gap: [3, 22], tailChance: 0.15, tailGap: [25, 45], answerChance: 0.35, answerDelay: [0.7, 2.2], maxVoices: 4, gain: 0.5 },
  // breeze: silent between gusts. A gust fades in, holds for `duration` with its swells, then fades out.
  // `first` is the first gust after start, `gap` the silence between gusts (all s).
  breeze: { gain: 0.07, swellGain: [0.35, 1], swellEvery: [4, 9], freq: [350, 950], q: 0.7, panRange: 0.6,
    first: [10, 40], gap: [30, 90], duration: [6, 20], fadeIn: [3, 5], fadeOut: [4, 6] },
  rustle: { every: [14, 40], gain: 0.22, dur: [0.5, 1.1] }, // rustles fall only inside a gust (every = mean spacing)
  plane: { every: [120, 300], first: [50, 130], dur: [22, 30], gain: 0.9, tone: 0.1 },
  // F19 floatplane engine: sawtooth + detuned octave + sub square through a low-pass, a rasp of band-passed noise and a
  // firing-rate tremolo; revs 0..1 move the pitch (hz) and brightness. `gain` is the peak at level 1.
  engine: { gain: 0.6, fadeTc: 0.35, hz: [58, 112], lpf: [380, 1500], rasp: 0.16, tremolo: 0.28, farLpf: 0.55 },
};

const rnd = (a, b) => a + Math.random() * (b - a);
const rr = (r) => rnd(r[0], r[1]);

// F47: engine output gain for a plane loudness `level` 0..1 (the floatplane's phase envelope x distance) and revs 0..1.
export function engineGain(level, rev, E) {
  const l = Math.max(0, Math.min(1, level)), r = Math.max(0, Math.min(1, rev));
  return E.gain * l * (0.55 + 0.45 * r);
}

export function createAmbient(ctx, dest) {
  if (!ctx || !dest) return { setActive() {}, audition() {}, engine() {} };
  const A = AMBIENT;
  const bus = ctx.createGain(); // follows the on/off + mute state
  bus.gain.value = 0;
  bus.connect(dest);
  const audBus = ctx.createGain(); // audition: ignores the toggle and mute
  audBus.gain.value = A.level;
  audBus.connect(dest);

  // shared 4 s soft noise (a little low-weighted so it is not hissy), looped
  const len = Math.floor(ctx.sampleRate * 4);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < len; i++) { lp += 0.45 * ((Math.random() * 2 - 1) - lp); d[i] = lp * 1.6; }
  const noise = (t, dur, loop = true) => {
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = loop;
    s.start(t, Math.random() * 3);
    if (dur) s.stop(t + dur);
    return s;
  };
  const panner = (p) => {
    if (ctx.createStereoPanner) { const n = ctx.createStereoPanner(); n.pan.value = p; return n; }
    return ctx.createGain();
  };
  const setPan = (n, v, t, tc) => { if (n.pan) n.pan.setTargetAtTime(v, t, tc); };

  let active = false, timer = 0;
  let nextBird = 0, nextGust = 0, nextPlane = 0;
  let breeze = null; // live chain: { src, bp, g, pan, env }
  const birdEnds = []; // end times of live bird voices (cap)

  // ---- birds ----
  // Soft-attack sine note: freq glides through `pts` [[dt, hz], ...]; optional vibrato.
  function note(t, out, pts, dur, peak, vib) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(pts[0][1], t);
    for (let i = 1; i < pts.length; i++) o.frequency.linearRampToValueAtTime(pts[i][1], t + pts[i][0]);
    if (vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = vib[0]; lg.gain.value = vib[1];
      l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.012, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.06);
  }
  const SPECIES = {
    chirp(t, out, k) { // 1-3 short rising peeps
      const n = 1 + Math.floor(Math.random() * 3), f = rnd(3200, 4300) * k;
      for (let i = 0; i < n; i++) note(t + i * 0.16, out, [[0, f * 0.9], [0.09, f * 1.12]], 0.1, 0.35);
      return n * 0.16 + 0.1;
    },
    trill(t, out, k) { // a run of fast soft pulses
      const n = 8 + Math.floor(Math.random() * 7), f = rnd(2800, 3800) * k;
      for (let i = 0; i < n; i++) note(t + i * 0.045, out, [[0, f], [0.03, f * 1.06]], 0.04, 0.25 * (1 - i / (n * 1.6)));
      return n * 0.045 + 0.05;
    },
    twoNote(t, out, k) { // a whistled high-low call
      const f = rnd(2000, 2700) * k;
      note(t, out, [[0, f * 1.1], [0.2, f * 1.2]], 0.22, 0.4, [6, f * 0.01]);
      note(t + 0.3, out, [[0, f * 0.85], [0.26, f * 0.78]], 0.28, 0.4, [6, f * 0.01]);
      return 0.6;
    },
    warble(t, out, k) { // a descending whistle with fast wobble
      const f = rnd(3000, 3800) * k;
      note(t, out, [[0, f], [0.35, f * 0.62]], 0.38, 0.35, [28, f * 0.04]);
      note(t + 0.45, out, [[0, f * 0.8], [0.2, f * 0.7]], 0.22, 0.28, [20, f * 0.03]);
      return 0.7;
    },
  };
  const NAMES = Object.keys(SPECIES);
  function bird(t, dest2, species, pan, dist, pitch) {
    const out = ctx.createGain(), lpf = ctx.createBiquadFilter(), p = panner(pan);
    out.gain.value = A.bird.gain * (1 - 0.8 * dist);
    lpf.type = 'lowpass'; lpf.frequency.value = 9000 - 6000 * dist; lpf.Q.value = 0.5;
    out.connect(lpf).connect(p).connect(dest2);
    const dur = SPECIES[species](t, out, pitch);
    birdEnds.push(t + dur + 0.2);
    return dur;
  }
  function birdEvent(t, dest2) {
    for (let i = birdEnds.length - 1; i >= 0; i--) if (birdEnds[i] < ctx.currentTime) birdEnds.splice(i, 1);
    if (birdEnds.length >= A.bird.maxVoices) return;
    const sp = NAMES[Math.floor(Math.random() * NAMES.length)];
    const pan = rnd(-0.9, 0.9), dist = rnd(0.05, 1), pitch = rnd(0.92, 1.08);
    const dur = bird(t, dest2, sp, pan, dist, pitch);
    if (Math.random() < A.bird.answerChance && birdEnds.length < A.bird.maxVoices) { // answer from the other side
      bird(t + dur + rr(A.bird.answerDelay), dest2, sp, -Math.sign(pan || 1) * rnd(0.3, 0.9), rnd(0.2, 1), pitch * rnd(1.04, 1.14));
    }
  }

  // ---- breeze ----
  // noise -> band-pass -> swell gain -> pan -> gust envelope -> out. The envelope is 0 between gusts, so the
  // noise can keep looping silently; all level changes are ramps (no clicks).
  function breezeChain(t, out, dur) {
    const c = { src: noise(t, dur), bp: ctx.createBiquadFilter(), g: ctx.createGain(), pan: panner(0), env: ctx.createGain() };
    c.bp.type = 'bandpass'; c.bp.frequency.value = rr(A.breeze.freq); c.bp.Q.value = A.breeze.q;
    c.g.gain.value = A.breeze.gain * 0.3;
    c.env.gain.value = 0;
    c.src.connect(c.bp).connect(c.g).connect(c.pan).connect(c.env).connect(out);
    return c;
  }
  function startBreeze(t) {
    breeze = breezeChain(t, bus, 0);
  }
  function stopBreeze() {
    if (!breeze) return;
    try { breeze.src.stop(ctx.currentTime + 1); } catch (e) { /* ignore */ }
    breeze = null;
  }
  // One gust starting at t: fade in, swells and rustles through the hold, fade out. Returns its end time.
  function gust(t, c, out, hold) {
    const B = A.breeze, fi = rr(B.fadeIn), fo = rr(B.fadeOut), h = hold || rr(B.duration);
    const holdStart = t + fi, holdEnd = holdStart + h, end = holdEnd + fo;
    c.env.gain.setValueAtTime(0, t);
    c.env.gain.linearRampToValueAtTime(1, holdStart);
    c.env.gain.setValueAtTime(1, holdEnd);
    c.env.gain.linearRampToValueAtTime(0, end);
    for (let s = holdStart; s < holdEnd; s += rr(B.swellEvery)) swell(s, c);
    for (let r = holdStart + rnd(0.5, 3); r < holdEnd; r += rr(A.rustle.every)) rustle(r, out);
    return end;
  }
  function swell(t, tg = breeze) {
    if (!tg) return;
    const B = A.breeze, up = rnd(1.5, 3.5), hold = rnd(0.5, 2);
    tg.g.gain.setTargetAtTime(B.gain * rr(B.swellGain), t, up * 0.5);
    tg.g.gain.setTargetAtTime(B.gain * rnd(0.1, 0.35), t + up + hold, rnd(1.5, 3));
    tg.bp.frequency.setTargetAtTime(rr(B.freq), t, 2.5);
    setPan(tg.pan, rnd(-B.panRange, B.panRange), t, 3);
  }
  function rustle(t, dest2) {
    const R = A.rustle, dur = rr(R.dur), n = 6 + Math.floor(Math.random() * 8);
    const hp = ctx.createBiquadFilter(), p = panner(rnd(-0.8, 0.8)), out = ctx.createGain();
    hp.type = 'bandpass'; hp.frequency.value = rnd(2500, 4200); hp.Q.value = 0.6;
    out.gain.value = 0.0001;
    const src = noise(t, dur + 0.2);
    // irregular soft grains
    out.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < n; i++) {
      const gt = t + (i / n) * dur + rnd(0, 0.04), pk = R.gain * rnd(0.2, 1) * Math.sin(Math.PI * (i + 0.5) / n);
      out.gain.linearRampToValueAtTime(Math.max(pk, 0.0002), gt + 0.02);
      out.gain.linearRampToValueAtTime(0.0002, gt + 0.05);
    }
    out.gain.linearRampToValueAtTime(0.0001, t + dur + 0.1);
    src.connect(hp).connect(out).connect(p).connect(dest2);
  }

  // ---- airplane ----
  let planeEnd = 0;
  function plane(t, dest2) {
    const P = A.plane, dur = rr(P.dur), dir = Math.random() < 0.5 ? -1 : 1;
    const src = noise(t, dur + 0.2), lpf = ctx.createBiquadFilter(), g = ctx.createGain(), p = panner(dir * -0.85);
    lpf.type = 'lowpass'; lpf.Q.value = 0.4;
    lpf.frequency.setValueAtTime(rnd(240, 300), t);
    lpf.frequency.linearRampToValueAtTime(rnd(170, 210), t + dur); // slight downward drift
    const env = new Float32Array(64);
    for (let i = 0; i < env.length; i++) { const x = i / (env.length - 1); env[i] = P.gain * Math.pow(Math.sin(Math.PI * Math.pow(x, 0.9)), 1.6) + 0.0001; }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setValueCurveAtTime(env, t, dur);
    if (p.pan) { p.pan.setValueAtTime(dir * -0.85, t); p.pan.linearRampToValueAtTime(dir * 0.85, t + dur); }
    src.connect(lpf).connect(g);
    const o = ctx.createOscillator(), og = ctx.createGain(); // faint low engine tone
    o.type = 'sine'; o.frequency.setValueAtTime(rnd(74, 90), t); o.frequency.linearRampToValueAtTime(rnd(58, 68), t + dur);
    og.gain.value = P.tone;
    o.connect(og).connect(g);
    g.connect(p).connect(dest2);
    o.start(t); o.stop(t + dur + 0.1);
    planeEnd = t + dur;
  }

  // ---- floatplane engine (F19) ----
  // One chain, built on demand: [saw f, saw 2f (detuned), square f/2] -> low-pass -> tremolo -> level -> pan -> out, plus
  // noise -> band-pass (rasp). set(t, level, pan, rev, dist, tc) moves it with smoothing; stop(t) ends it.
  function engineChain(out) {
    const E = A.engine, t = ctx.currentTime;
    const mk = (type, g) => { const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; og.gain.value = g; o.connect(og); o.start(t); return { o, og }; };
    const o1 = mk('sawtooth', 0.5), o2 = mk('sawtooth', 0.22), o3 = mk('square', 0.2);
    o2.o.detune.value = 9;
    const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.Q.value = 1.2; lpf.frequency.value = E.lpf[0];
    const trem = ctx.createGain(); trem.gain.value = 1 - E.tremolo / 2;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lg.gain.value = E.tremolo / 2; lfo.connect(lg).connect(trem.gain); lfo.start(t);
    const lvl = ctx.createGain(); lvl.gain.value = 0;
    const pan = panner(0);
    o1.og.connect(lpf); o2.og.connect(lpf); o3.og.connect(lpf);
    lpf.connect(trem).connect(lvl);
    const ns = noise(t, 0), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.8; ng.gain.value = E.rasp;
    ns.connect(bp).connect(ng).connect(trem);
    lvl.connect(pan).connect(out);
    return {
      set(at, level, p, rev, dist, tc) {
        const f = E.hz[0] + (E.hz[1] - E.hz[0]) * rev;
        for (const [n, m] of [[o1.o, 1], [o2.o, 2], [o3.o, 0.5]]) n.frequency.setTargetAtTime(f * m, at, tc);
        lfo.frequency.setTargetAtTime(f * 0.5, at, tc);
        lpf.frequency.setTargetAtTime((E.lpf[0] + (E.lpf[1] - E.lpf[0]) * rev) * (1 - E.farLpf * dist), at, tc);
        lvl.gain.setTargetAtTime(engineGain(level, rev, E), at, tc);
        setPan(pan, p, at, tc);
      },
      stop(at) {
        for (const n of [o1.o, o2.o, o3.o, lfo, ns]) { try { n.stop(at); } catch (e) { /* ignore */ } }
        setTimeout(() => { try { lvl.disconnect(); pan.disconnect(); } catch (e) { /* ignore */ } }, Math.max(0, (at - ctx.currentTime) * 1000) + 100);
      },
    };
  }
  let eng = null, engLast = 0;
  function engineStop() {
    if (!eng) return;
    const t = ctx.currentTime;
    eng.set(t, 0, 0, 0.3, 1, 0.3); // F47: smooth fade to silence, then stop
    eng.stop(t + 2.2);
    eng = null;
  }
  // Called every frame by the game with the plane's state; throttled here. Silent unless the ambience is on.
  function engine(on, level, pan, rev, dist) {
    try {
      if (!on || !active || ctx.state !== 'running') { if (eng && (!on || !active)) engineStop(); return; }
      const now = ctx.currentTime;
      if (eng && now - engLast < 0.05) return;
      if (!eng) { eng = engineChain(bus); engLast = 0; }
      engLast = now;
      eng.set(now, level, pan, rev, dist || 0, A.engine.fadeTc);
    } catch (e) { /* ignore */ }
  }

  // ---- scheduler ----
  function tick() {
    try {
      if (!active || ctx.state !== 'running') return;
      const now = ctx.currentTime, horizon = now + A.lookahead;
      if (nextBird < now) nextBird = now + rr([1, 6]);
      while (nextBird < horizon) {
        birdEvent(nextBird, bus);
        nextBird += Math.random() < A.bird.tailChance ? rr(A.bird.tailGap) : rr(A.bird.gap);
      }
      if (breeze) {
        if (nextGust < now) nextGust = now + 0.1;
        while (nextGust < horizon) nextGust = gust(nextGust, breeze, bus) + rr(A.breeze.gap);
      }
      if (nextPlane < now) nextPlane = now + rr(A.plane.first);
      if (nextPlane < horizon && planeEnd < nextPlane) { plane(nextPlane, bus); nextPlane += rr(A.plane.every) + rr(A.plane.dur); }
    } catch (e) { /* ignore */ }
  }

  function setActive(on) {
    try {
      on = !!on;
      if (on === active) return;
      active = on;
      const t = ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setTargetAtTime(on ? A.level : 0, t, on ? 1.5 : 0.15);
      if (on) {
        startBreeze(t);
        nextGust = t + rr(A.breeze.first);
        if (!timer) timer = setInterval(tick, 400);
        tick();
      } else {
        stopBreeze();
        engineStop();
        if (timer) { clearInterval(timer); timer = 0; }
        nextBird = nextGust = nextPlane = 0;
      }
    } catch (e) { /* ignore */ }
  }

  function audition(name) {
    try {
      const t = ctx.currentTime + 0.05;
      if (name === 'bird') {
        const sp = NAMES[Math.floor(Math.random() * NAMES.length)], pan = rnd(-0.9, 0.9);
        const dur = bird(t, audBus, sp, pan, rnd(0.05, 0.5), 1);
        bird(t + dur + 1, audBus, sp, -Math.sign(pan || 1) * 0.7, 0.7, 1.08);
      } else if (name === 'breeze') { // one full gust, stopping after its fade out
        const c = breezeChain(t, audBus, 0);
        c.src.stop(gust(t, c, audBus) + 0.2);
      } else if (name === 'floatplane') { // 10 s: idle, a take-off run revving up, then climbing away to the right
        const c = engineChain(audBus);
        for (let i = 0; i <= 20; i++) {
          const k = i / 20, rev = k < 0.2 ? 0.3 + k * 0.5 : Math.min(1, 0.4 + (k - 0.2) * 0.9);
          c.set(t + k * 10, Math.pow(1 - Math.max(0, k - 0.5) * 1.6, 1.5) * (0.5 + 0.5 * Math.min(1, k * 3)), -0.7 + 1.5 * k, rev, Math.max(0, k - 0.4), 0.15);
        }
        c.stop(t + 10.5);
      } else if (name === 'plane') {
        plane(t, audBus);
        planeEnd = 0;
      }
    } catch (e) { /* ignore */ }
  }

  return { setActive, audition, engine };
}
