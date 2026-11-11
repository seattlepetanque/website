// F66: pure scheduling logic for the rare ambient events (distant musette accordion, church bell, cicada swells).
// No audio, no DOM, no Math.random: everything is driven by a seed and the time passed to tick(), so it is unit-testable.
// createAmbientSchedule(seed, cfg?) -> { tick(now, state) -> event | null, reset(now) }
//   now    audio-clock seconds (monotonic; the context is suspended while the game is paused, so paused time never counts)
//   state  { busy, loud, slow }: busy = a human aim/throw moment, loud = an airplane/floatplane engine is audible, slow = slow mode
// An event is { kind: 'accordion'|'bell'|'cicada', start, dur, ... }.

// ---- tunables (seconds unless noted) ----
export const SCHEDULE = {
  // `first` = delay before the first one, `gap` = delay from the END of the previous one to the next (play-clock seconds).
  // accordion: one every 4-8 minutes; `tail` = its fade-out after the phrase (must match AMBIENT.accordion.fadeOut in ambient.js)
  accordion: { first: [90, 240], gap: [240, 480], tail: 7 },
  bell: { first: [300, 420], gap: [300, 600], strikes: [3, 6], spacing: [2.3, 2.7], tail: 7 }, // one every 5-10 minutes
  cicada: { first: [20, 60], gap: [45, 140], dur: [10, 30] },
  tonalSeparation: 60, // min seconds between the end of an accordion/bell event and the start of the other kind
  settle: 4, // a tonal event may start only this long after the last busy moment
  quickRate: 0.5, // play-clock speed in quick mode (events are rarer there; they are also played quieter by ambient.js)
  maxDt: 5, // a stalled timer never advances the clock by more than this
};

// ---- musette phrases (waltz, 3 beats per bar) ----
// Melody notes are [midi, beats] (null = rest), beats sum to 3 per bar. chord names index CHORDS.
export const CHORDS = {
  Am: { bass: 45, notes: [57, 60, 64] }, Dm: { bass: 50, notes: [57, 62, 65] }, E7: { bass: 40, notes: [56, 62, 64] },
  C: { bass: 48, notes: [55, 60, 64] }, F: { bass: 41, notes: [57, 60, 65] }, G: { bass: 43, notes: [55, 59, 62] },
  Gm: { bass: 43, notes: [58, 62, 67] }, A7: { bass: 45, notes: [55, 61, 64] },
};
export const PHRASES = [
  { name: 'A minor', bpm: 138, bars: [ // 8 bars, ~10.4 s
    ['Am', [[69, 1], [72, 0.5], [76, 0.5], [81, 1]]], ['Am', [[80, 1.5], [81, 0.5], [76, 1]]],
    ['Dm', [[77, 1], [74, 0.5], [77, 0.5], [81, 1]]], ['Dm', [[77, 1.5], [76, 0.5], [74, 1]]],
    ['E7', [[76, 1], [80, 0.5], [83, 0.5], [81, 1]]], ['E7', [[80, 1], [83, 1], [80, 1]]],
    ['Dm', [[74, 1], [77, 1], [76, 1]]], ['Am', [[69, 2], [null, 1]]],
  ] },
  { name: 'C major', bpm: 150, bars: [ // 6 bars, ~7.2 s
    ['C', [[76, 1], [79, 0.5], [84, 0.5], [83, 1]]], ['C', [[81, 1], [79, 1], [76, 1]]],
    ['F', [[77, 1], [81, 0.5], [84, 0.5], [81, 1]]], ['G', [[79, 1], [83, 1], [86, 1]]],
    ['G', [[84, 1], [83, 0.5], [81, 0.5], [79, 1]]], ['C', [[76, 2], [null, 1]]],
  ] },
  { name: 'D minor', bpm: 126, bars: [ // 7 bars, ~10 s
    ['Dm', [[74, 1], [77, 1], [81, 1]]], ['Dm', [[79, 0.5], [77, 0.5], [76, 1], [74, 1]]],
    ['Gm', [[74, 1.5], [70, 0.5], [74, 1]]], ['Gm', [[79, 1], [77, 0.5], [74, 0.5], [70, 1]]],
    ['A7', [[76, 1], [73, 0.5], [76, 0.5], [79, 1]]], ['A7', [[77, 1], [76, 1], [73, 1]]],
    ['Dm', [[74, 2], [null, 1]]],
  ] },
];
// Each phrase is played PHRASE_PASSES times back to back, so an accordion piece lasts about 14-21 s.
export const PHRASE_PASSES = 2;
export const phraseBars = (v) => { const out = []; for (let i = 0; i < PHRASE_PASSES; i++) out.push(...PHRASES[v].bars); return out; };
export const phraseDuration = (v) => phraseBars(v).length * 3 * 60 / PHRASES[v].bpm;
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Accordion loudness multiplier 0..1 at time t (s) of a piece lasting `duration` s (the fade-out ends it).
// fadeIn / fadeOut: smoothstep ramps at the start and end. swellPeriod / swellDepth: a breathing swell that
// drifts between 1 and (1 - swellDepth). 0 before the start and at/after the end.
export const smoothstep = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
export function accordionEnvelope(t, env) {
  const { duration, fadeIn, fadeOut, swellPeriod, swellDepth } = env;
  if (t < 0 || t >= duration) return 0;
  const inG = fadeIn > 0 ? smoothstep(t / fadeIn) : 1;
  const outG = fadeOut > 0 ? smoothstep((duration - t) / fadeOut) : 1;
  const swell = 1 - swellDepth * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / swellPeriod));
  return inG * outG * swell;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createAmbientSchedule(seed, cfg = SCHEDULE) {
  const rand = mulberry32(seed);
  const rr = (r) => r[0] + rand() * (r[1] - r[0]);
  let clock = 0, last = null, lastBusy = -1e9, tonalEnd = -1e9, tonalKind = '';
  const next = {}, end = {}; // play-clock times
  const init = () => {
    for (const k of ['accordion', 'bell', 'cicada']) { next[k] = rr(cfg[k].first); end[k] = -1e9; }
  };
  init();

  function tick(now, state = {}) {
    if (last === null) last = now;
    const dt = Math.max(0, Math.min(cfg.maxDt, now - last));
    last = now;
    clock += dt * (state.slow === false ? cfg.quickRate : 1);
    if (state.busy) lastBusy = clock;
    // tonal events: calm moment, no loud engine, nothing else tonal live or just finished
    const calm = !state.busy && !state.loud && clock - lastBusy >= cfg.settle;
    const tonalFree = (kind) => {
      const sep = kind === tonalKind ? 0 : cfg.tonalSeparation;
      return clock >= tonalEnd + sep;
    };
    for (const kind of ['accordion', 'bell']) {
      if (clock < next[kind] || !calm || !tonalFree(kind)) continue;
      const ev = { kind, start: now };
      if (kind === 'accordion') {
        ev.variant = Math.floor(rand() * PHRASES.length);
        ev.dur = phraseDuration(ev.variant) + cfg.accordion.tail; // audible span incl. the fade-out
        ev.pan = rr([-0.7, 0.7]);
      } else {
        const B = cfg.bell;
        ev.strikes = Math.round(rr([B.strikes[0] - 0.5, B.strikes[1] + 0.499]));
        ev.spacing = rr(B.spacing);
        ev.dur = (ev.strikes - 1) * ev.spacing + B.tail;
        ev.pan = rr([-0.7, 0.7]);
      }
      end[kind] = clock + ev.dur; tonalEnd = end[kind]; tonalKind = kind;
      next[kind] = end[kind] + rr(cfg[kind].gap);
      // the other tonal kind must also keep its distance from this one
      const other = kind === 'accordion' ? 'bell' : 'accordion';
      next[other] = Math.max(next[other], tonalEnd + cfg.tonalSeparation);
      return ev;
    }
    if (clock >= next.cicada && clock >= end.cicada) {
      const C = cfg.cicada, dur = rr(C.dur);
      end.cicada = clock + dur; next.cicada = end.cicada + rr(C.gap);
      return { kind: 'cicada', start: now, dur, pan: rr([-0.8, 0.8]), hz: rr([4300, 5600]) };
    }
    return null;
  }
  function reset(now) { clock = 0; last = now === undefined ? null : now; lastBusy = -1e9; tonalEnd = -1e9; tonalKind = ''; init(); }
  return { tick, reset };
}
