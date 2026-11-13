// F103: graphics quality levels (0 = High ... LOW_LEVEL = Low) and the Auto controller. Pure, node-testable.
// The renderer applies a level with setQuality(levelSettings(i)). WebGL antialiasing is fixed when the context is
// created, so levels never change it: they lower the pixel ratio and skip the 4-sample sepia target instead.
// Low has no shadows at all: no sun shadow map, no tree decals, no cloud shadows, no divot discs (the last level, so Auto reaches it only after
// everything else). Fields: pixelRatioMax, shadows (on), shadowScale (shadow map size factor), shadowHalfScale (shadow box half-width factor),
// sepiaSamples (MSAA of the pause view), tufts, treeShadows, sailboats, butterflies, cloudShadows, divots (the dark discs where boules landed), ambient (volume factor).
export const LEVELS = [
  { name: 'High',   pixelRatioMax: 2, shadows: true, shadowScale: 1,    shadowHalfScale: 1,   sepiaSamples: 4, tufts: true,  treeShadows: true,  sailboats: true,  butterflies: true,  cloudShadows: true,  divots: true,  ambient: 1 },
  { name: 'Medium', pixelRatioMax: 1, shadows: true, shadowScale: 1,    shadowHalfScale: 1,   sepiaSamples: 0, tufts: true,  treeShadows: true,  sailboats: true,  butterflies: true,  cloudShadows: true,  divots: true,  ambient: 1 },
  { name: 'Lower',  pixelRatioMax: 1, shadows: true, shadowScale: 0.5,  shadowHalfScale: 1,   sepiaSamples: 0, tufts: true,  treeShadows: true,  sailboats: true,  butterflies: true,  cloudShadows: true,  divots: true,  ambient: 1 },
  { name: 'Plain',  pixelRatioMax: 1, shadows: true, shadowScale: 0.5,  shadowHalfScale: 1,   sepiaSamples: 0, tufts: false, treeShadows: false, sailboats: false, butterflies: false, cloudShadows: false, divots: true,  ambient: 0.6 },
  { name: 'Low',    pixelRatioMax: 1, shadows: false, shadowScale: 0.25, shadowHalfScale: 0.5, sepiaSamples: 0, tufts: false, treeShadows: false, sailboats: false, butterflies: false, cloudShadows: false, divots: false, ambient: 0.4 },
];
export const LOW_LEVEL = LEVELS.length - 1;
export const GRAPHICS = ['high', 'auto', 'low'];

export const levelSettings = (i) => LEVELS[Math.max(0, Math.min(LOW_LEVEL, i | 0))];

// Level a setting starts at. Auto starts High, or Low on a weak device (the soft hints of gpuinfo.weakDevice).
export function initialLevel(graphics, weak) {
  if (graphics === 'low') return LOW_LEVEL;
  if (graphics === 'high') return 0;
  return weak ? LOW_LEVEL : 0;
}
// The context is created with antialiasing unless the setting starts in Low.
export const wantAntialias = (graphics, weak) => initialLevel(graphics, weak) < LOW_LEVEL;

export const AUTO = {
  windowMs: 2500,       // frame times are averaged over this much play
  warmupMs: 1000,       // ignored at the start and after every level change (shader builds, shadow map reallocation)
  slowMs: 45,           // average above this (below ~22 fps) is slow: a clean 30 fps cap (33 ms frames; iOS Low Power Mode, throttled tabs) never is
  windowsToStep: 2,     // consecutive slow windows before stepping down one level (hysteresis against one hiccup)
  maxFrameMs: 250,      // a longer frame counts as this long: one hitch (GC, shader build) barely moves a window, but a device that only manages 3 fps still reads as slow
  minFrames: 6,
};

// createAutoQuality(startLevel) -> { level, frame(ms, active) -> new level or null }. Only ever steps down.
// active = false while paused or hidden: nothing is counted and the window restarts.
export function createAutoQuality(startLevel = 0, cfg = AUTO) {
  let level = startLevel, warm = 0, sum = 0, n = 0, span = 0, slow = 0;
  const restart = (w) => { warm = w; sum = n = span = 0; };
  restart(cfg.warmupMs);
  return {
    get level() { return level; },
    frame(ms, active = true) {
      if (!active || level >= LOW_LEVEL) { if (!active) { restart(Math.max(warm, 0)); slow = 0; } return null; }
      ms = Math.min(ms, cfg.maxFrameMs);
      if (warm > 0) { warm -= ms; return null; }
      sum += ms; n++; span += ms;
      if (span < cfg.windowMs) return null;
      const avg = sum / n, ok = n >= cfg.minFrames;
      restart(0);
      if (!ok) return null;
      slow = avg > cfg.slowMs ? slow + 1 : 0;
      if (slow < cfg.windowsToStep) return null;
      slow = 0; level++; restart(cfg.warmupMs);
      return level;
    },
  };
}
