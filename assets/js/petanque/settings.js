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
  // E27 (hidden): the TV camera variant for AI turns in quick mode: '' (off) | 'a' | 'b' | 'c'. Set it from the console:
  // localStorage.setItem('petanque-tvcam', 'b'). ?debug&tvcam=a|b|c overrides it.
  get tvcam() { try { const v = localStorage.getItem('petanque-tvcam'); return ['a', 'b', 'c'].includes(v) ? v : ''; } catch (e) { return ''; } },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
export const MODE_INFO = {
  quick: 'Everything moves into position at once. No walking.',
  slow: 'People walk: fetching balls, carrying the cochonnet, walking to the circle.',
};
