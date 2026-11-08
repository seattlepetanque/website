// F12: quiet synthesized park ambience (birds, breeze, a distant airplane). No audio files; Web Audio only.
// createAmbient(ctx, dest) -> { setActive(bool), audition(name) }. Never throws; without a context it is a no-op.
// Events are scheduled a few seconds ahead on the audio clock (a 0.4 s timer tops up), so a suspended
// context (game paused) simply stops everything. One shared looped noise buffer; voices are capped.
export const AMBIENT = {
  level: 0.10, // the whole ambience bus (linear, into the game master). Boule knocks peak ~0.3-1 there.
  lookahead: 3, // s scheduled ahead
  bird: { gap: [3, 22], tailChance: 0.15, tailGap: [25, 45], answerChance: 0.35, answerDelay: [0.7, 2.2], maxVoices: 4, gain: 0.5 },
  breeze: { gain: 0.07, swellGain: [0.35, 1], swellEvery: [4, 9], freq: [350, 950], q: 0.7, panRange: 0.6 },
  rustle: { every: [14, 40], gain: 0.22, dur: [0.5, 1.1] },
  plane: { every: [120, 300], first: [50, 130], dur: [22, 30], gain: 0.9, tone: 0.1 },
};

const rnd = (a, b) => a + Math.random() * (b - a);
const rr = (r) => rnd(r[0], r[1]);

export function createAmbient(ctx, dest) {
  if (!ctx || !dest) return { setActive() {}, audition() {} };
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
  let nextBird = 0, nextSwell = 0, nextRustle = 0, nextPlane = 0;
  let breeze = null; // { src, g, bp, pan }
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
  function startBreeze(t) {
    const src = noise(t, 0), bp = ctx.createBiquadFilter(), g = ctx.createGain(), pan = panner(0);
    bp.type = 'bandpass'; bp.frequency.value = rr(A.breeze.freq); bp.Q.value = A.breeze.q;
    g.gain.value = A.breeze.gain * 0.3;
    src.connect(bp).connect(g).connect(pan).connect(bus);
    breeze = { src, g, bp, pan };
    nextSwell = t;
  }
  function stopBreeze() {
    if (!breeze) return;
    try { breeze.src.stop(ctx.currentTime + 1); } catch (e) { /* ignore */ }
    breeze = null;
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
        if (nextSwell < now) nextSwell = now;
        while (nextSwell < horizon) { swell(nextSwell); nextSwell += rr(A.breeze.swellEvery); }
      }
      if (nextRustle < now) nextRustle = now + rr(A.rustle.every);
      while (nextRustle < horizon) { rustle(nextRustle, bus); nextRustle += rr(A.rustle.every); }
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
        if (!timer) timer = setInterval(tick, 400);
        tick();
      } else {
        stopBreeze();
        if (timer) { clearInterval(timer); timer = 0; }
        nextBird = nextRustle = nextPlane = 0;
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
      } else if (name === 'breeze') {
        const b = { g: ctx.createGain(), bp: ctx.createBiquadFilter(), pan: panner(0) };
        b.bp.type = 'bandpass'; b.bp.frequency.value = rr(A.breeze.freq); b.bp.Q.value = A.breeze.q;
        b.g.gain.value = A.breeze.gain * 0.3;
        const src = noise(t, 12);
        src.connect(b.bp).connect(b.g).connect(b.pan).connect(audBus);
        swell(t, b);
        rustle(t + 5, audBus);
      } else if (name === 'plane') {
        plane(t, audBus);
        planeEnd = 0;
      }
    } catch (e) { /* ignore */ }
  }

  return { setActive, audition };
}
