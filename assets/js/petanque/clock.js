// Game clock (D12). Time only advances when tick(ms) is called, and tick() does nothing while paused, so every
// sleep and later() that goes through it freezes with the game and resumes with its remaining delay.
//
//   const clock = createClock();
//   clock.tick(dtMs);                // once per frame
//   await clock.sleep(800);          // resolves after 800 ms of unpaused game time
//   const cancel = clock.later(fn, 500);
//   clock.pause(); clock.resume();   // clock.paused
//   await clock.resumed();           // resolves at once unless paused, else when resumed
//   clock.cancelAll();               // drops every pending timer (sleep promises stay pending)
export function createClock() {
  let t = 0, seq = 0, paused = false;
  let timers = [];
  let waiters = [];
  let flushQueued = false;

  function fire() {
    // run everything that is due, earliest first (a callback may add new timers)
    for (;;) {
      let best = -1;
      for (let i = 0; i < timers.length; i++) {
        const x = timers[i];
        if (x.at <= t && (best < 0 || x.at < timers[best].at || (x.at === timers[best].at && x.seq < timers[best].seq))) best = i;
      }
      if (best < 0) return;
      const [x] = timers.splice(best, 1);
      try { x.fn(); } catch (err) { console.error(err); }
    }
  }
  // zero-delay timers don't wait for the next frame: they run on the next macrotask (unless paused)
  function queueFlush() {
    if (flushQueued || typeof setTimeout !== 'function') return;
    flushQueued = true;
    setTimeout(() => { flushQueued = false; if (!paused) fire(); }, 0);
  }

  const clock = {
    now: () => t,
    get paused() { return paused; },
    pause() { paused = true; },
    resume() {
      if (!paused) return;
      paused = false;
      const w = waiters; waiters = [];
      for (const r of w) r();
      if (timers.some((x) => x.at <= t)) queueFlush();
    },
    tick(ms) {
      if (paused || !(ms > 0)) return;
      t += ms;
      fire();
    },
    later(fn, ms = 0) {
      const x = { at: t + Math.max(0, ms), seq: seq++, fn };
      timers.push(x);
      if (ms <= 0) queueFlush();
      return () => { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); };
    },
    sleep(ms) { return new Promise((res) => clock.later(res, ms)); },
    resumed() { return paused ? new Promise((res) => waiters.push(res)) : Promise.resolve(); },
    cancelAll() { timers = []; },
    get pending() { return timers.length; },
  };
  return clock;
}
