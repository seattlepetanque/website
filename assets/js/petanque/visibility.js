// F106: hidden-tab time. The frame loop asks dt(now) for the time to simulate; time spent hidden (tab in the background,
// page frozen, bfcache) is never simulated: it returns 0 while hidden and discards the interval on the first frame back,
// so the game clock, the physics, the AI timers, the ambience and the quality controller see no jump.
// Pure: timestamps are passed in (performance.now() / the rAF time).
export function createVisibility(startMs = 0) {
  let last = startMs, hidden = false, raw = 0;
  return {
    get hidden() { return hidden; },
    get rawMs() { return raw; }, // the last frame's wall time (never includes hidden time, not clamped by maxMs; 0 on a frame that only resumed)
    // a visibility event: hidden or visible again at time `now`
    set(h, now) { h = !!h; if (h === hidden) return; hidden = h; last = now; raw = 0; },
    // ms to simulate for a frame at `now`, at most maxMs; 0 while hidden
    dt(now, maxMs = 100) {
      const ms = hidden ? 0 : Math.max(0, now - last);
      last = Math.max(last, now); raw = ms;
      return Math.min(ms, maxMs);
    },
  };
}
// Is the page hidden? (document.visibilityState; pagehide/freeze mark it hidden separately in main.js)
export const isPageHidden = (doc) => !!doc && (doc.hidden === true || doc.visibilityState === 'hidden');
