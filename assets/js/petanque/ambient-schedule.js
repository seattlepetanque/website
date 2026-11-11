// F66: pure scheduling logic for the rare ambient events (church bell, cicada swells).
// No audio, no DOM, no Math.random: everything is driven by a seed and the time passed to tick(), so it is unit-testable.
// createAmbientSchedule(seed, cfg?) -> { tick(now, state) -> event | null, reset(now) }
//   now    audio-clock seconds (monotonic; the context is suspended while the game is paused, so paused time never counts)
//   state  { busy, loud, slow }: busy = a human aim/throw moment, loud = an airplane/floatplane engine is audible, slow = slow mode
// An event is { kind: 'bell'|'cicada', start, dur, ... }.

// ---- tunables (seconds unless noted) ----
export const SCHEDULE = {
  // `first` = delay before the first one, `gap` = delay from the END of the previous one to the next (play-clock seconds).
  bell: { first: [300, 420], gap: [300, 600], strikes: [3, 6], spacing: [2.3, 2.7], tail: 7 }, // one every 5-10 minutes
  cicada: { first: [20, 60], gap: [45, 140], dur: [10, 30] },
  settle: 4, // a tonal event may start only this long after the last busy moment
  quickRate: 0.5, // play-clock speed in quick mode (events are rarer there; they are also played quieter by ambient.js)
  maxDt: 5, // a stalled timer never advances the clock by more than this
};

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
  let clock = 0, last = null, lastBusy = -1e9, bellEnd = -1e9;
  const next = {}, end = {}; // play-clock times
  const init = () => {
    for (const k of ['bell', 'cicada']) { next[k] = rr(cfg[k].first); end[k] = -1e9; }
  };
  init();

  function tick(now, state = {}) {
    if (last === null) last = now;
    const dt = Math.max(0, Math.min(cfg.maxDt, now - last));
    last = now;
    clock += dt * (state.slow === false ? cfg.quickRate : 1);
    if (state.busy) lastBusy = clock;
    // tonal events (bell): calm moment, no loud engine, and no bell still ringing
    const calm = !state.busy && !state.loud && clock - lastBusy >= cfg.settle;
    if (clock >= next.bell && calm && clock >= bellEnd) {
      const B = cfg.bell;
      const strikes = Math.round(rr([B.strikes[0] - 0.5, B.strikes[1] + 0.499]));
      const spacing = rr(B.spacing);
      const dur = (strikes - 1) * spacing + B.tail;
      const pan = rr([-0.7, 0.7]);
      end.bell = clock + dur; bellEnd = end.bell;
      next.bell = end.bell + rr(cfg.bell.gap);
      return { kind: 'bell', start: now, strikes, spacing, dur, pan };
    }
    if (clock >= next.cicada && clock >= end.cicada) {
      const C = cfg.cicada, dur = rr(C.dur);
      end.cicada = clock + dur; next.cicada = end.cicada + rr(C.gap);
      return { kind: 'cicada', start: now, dur, pan: rr([-0.8, 0.8]), hz: rr([4300, 5600]) };
    }
    return null;
  }
  function reset(now) { clock = 0; last = now === undefined ? null : now; lastBusy = -1e9; bellEnd = -1e9; init(); }
  return { tick, reset };
}
