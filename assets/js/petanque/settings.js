// Game settings (E01): the play mode, remembered in localStorage.
//   'slow'  - people walk: fetching, carrying the jack, walking to the circle (the default)
//   'quick' - everything moves into position instantly or with a short fade
const KEY = 'petanque-mode';
const MODES = ['quick', 'slow'];
const listeners = new Set();

function load() {
  try { const v = localStorage.getItem(KEY); if (MODES.includes(v)) return v; } catch (e) { /* storage blocked */ }
  return 'slow';
}

let mode = load();

export const settings = {
  get mode() { return mode; },
  set mode(v) {
    if (!MODES.includes(v) || v === mode) return;
    mode = v;
    try { localStorage.setItem(KEY, v); } catch (e) { /* storage blocked */ }
    for (const fn of [...listeners]) fn(v);
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
export const MODE_INFO = {
  quick: 'Everything moves into position at once. No walking.',
  slow: 'People walk: fetching balls, carrying the cochonnet, walking to the circle.',
};
