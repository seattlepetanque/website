// Game settings (E01): the play mode, remembered in localStorage.
//   'slow'  - people walk: fetching, carrying the jack, walking to the circle (the default)
//   'quick' - everything moves into position instantly or with a short fade
const KEY = 'petanque-mode';
const MODES = ['quick', 'slow'];
const PARTNERS = ['pierre', 'marcel', 'odette'];
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
  // F111: debug scenarios only: switch the mode for this page view without saving it as the user's setting
  setModeInMemory(v) { if (!MODES.includes(v) || v === mode) return; mode = v; for (const fn of [...listeners]) fn(v); },
  // E27 (hidden): the TV camera variant for AI turns in quick mode: '' (off) | 'a' | 'b' | 'c'. Set it from the console:
  // localStorage.setItem('petanque-tvcam', 'b'). ?debug&tvcam=a|b|c overrides it.
  get tvcam() { try { const v = localStorage.getItem('petanque-tvcam'); return ['a', 'b', 'c'].includes(v) ? v : ''; } catch (e) { return ''; } },
  // F05: the "Read the ground" view can be switched off entirely (slow devices): localStorage.setItem('petanque-groundview', 'off')
  get groundView() { try { return localStorage.getItem('petanque-groundview') !== 'off'; } catch (e) { return true; } },
  set groundView(v) { try { localStorage.setItem('petanque-groundview', v ? 'on' : 'off'); } catch (e) { /* storage blocked */ } },
  // F01 (hidden): the camera style, '' (default: observer in slow mode, game cameras in quick) | 'observer' | 'tv' | 'game' | 'broadcast'.
  // localStorage.setItem('petanque-camstyle', 'broadcast'). ?debug&cam=... overrides it.
  get camStyle() { try { const v = localStorage.getItem('petanque-camstyle'); return ['observer', 'tv', 'game', 'broadcast'].includes(v) ? v : ''; } catch (e) { return ''; } },
  // F45: the partner chosen in the setup dialog ('pierre' | 'marcel' | 'odette'; default Pierre)
  get partner() { try { const v = localStorage.getItem('petanque-partner'); return PARTNERS.includes(v) ? v : 'pierre'; } catch (e) { return 'pierre'; } },
  set partner(v) { if (PARTNERS.includes(v)) { try { localStorage.setItem('petanque-partner', v); } catch (e) { /* storage blocked */ } } },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
export const MODE_INFO = {
  quick: 'Everything moves into position at once. No walking.',
  slow: 'People walk: fetching balls, carrying the cochonnet, walking to the circle.',
};
