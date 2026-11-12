// F71: golden-hour drift. Pure maths, no three.js: a match's progress (0..1) maps to the sun's direction and colours,
// the sky haze and the alpenglow on Rainier. render.js and scenery.js apply the numbers; main.js feeds the progress.

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export const REDUCED_PROGRESS = 0.3; // reduced motion: a fixed mid-afternoon light
export const SUN_DISTANCE = 10.5; // length of the sun offset vector used by the shadow frustum
// F95: the shadow camera is orthographic, sits SUN_DISTANCE from its target and looks along -sunDir. With near = 1 anything
// more than SUN_DISTANCE - 1 m toward the sun from the target was clipped out of the shadow map, so a player 10+ m
// "upsun" of the look target (e.g. the head view of the far end of the court) lost their shadow. Ortho cameras accept a
// negative near, so the box now reaches well behind the light position as well.
export const SHADOW_NEAR = -30, SHADOW_FAR = 60;
// does the shadow box (half-width `half`, centred on `target`, sun along unit-ish vector sunDir) take in point p?
export function shadowBoxCovers(p, target, sunDir, half, near = SHADOW_NEAR, far = SHADOW_FAR, dist = SUN_DISTANCE) {
  const l = Math.hypot(sunDir[0], sunDir[1], sunDir[2]) || 1;
  const z = [sunDir[0] / l, sunDir[1] / l, sunDir[2] / l];
  const xl = Math.hypot(z[0], z[2]) || 1, x = [z[2] / xl, 0, -z[0] / xl]; // (0,1,0) x z, as in render.js
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const d = [p[0] - target[0], p[1] - target[1], p[2] - target[2]];
  const dot = (a) => d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
  const depth = dist - dot(z); // distance from the light along its view direction
  return Math.abs(dot(x)) <= half && Math.abs(dot(y)) <= half && depth >= near && depth <= far;
}
export const SKY_HAZE_HEX = '#d6e5f3'; // the horizon haze at progress 0 (same as scenery.js SKY_HAZE)
export const PEACH = [0.965, 0.81, 0.70]; // warm horizon colour, linear-free sRGB 0..1

const EL0 = 50, EL1 = 22; // degrees of sun elevation at the start and the end
const AZ0 = -125.5, AZ1 = -140; // horizontal azimuth (atan2(y, x) of the offset from the ground to the sun), degrees
const SUN_C0 = hex('#fff0dc'), SUN_C1 = hex('#ffa95c');
const HEMI_SKY0 = hex('#cfe2ff'), HEMI_SKY1 = hex('#ffd6bc');
const HEMI_GND0 = hex('#8a7a5c'), HEMI_GND1 = hex('#946a48');
const HAZE0 = hex(SKY_HAZE_HEX);

// progress 0..1 -> everything the renderer needs. All colours are [r, g, b] in 0..1 (sRGB values as in hex strings).
export function daylightAt(progress) {
  const p = clamp01(Number.isFinite(progress) ? progress : 0), s = smooth(p);
  const el = lerp(EL0, EL1, s) * Math.PI / 180, az = lerp(AZ0, AZ1, s) * Math.PI / 180;
  const sunDir = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  const hazeK = 0.72 * s; // how far the horizon has moved from pale blue haze towards peach
  const skyHaze = mixRgb(HAZE0, PEACH, hazeK);
  return {
    progress: p,
    elevation: el * 180 / Math.PI,
    azimuth: az * 180 / Math.PI,
    sunDir,
    sunColor: mixRgb(SUN_C0, SUN_C1, s),
    sunIntensity: lerp(3.0, 4.6, s),
    hemiSky: mixRgb(HEMI_SKY0, HEMI_SKY1, s),
    hemiGround: mixRgb(HEMI_GND0, HEMI_GND1, s),
    hemiIntensity: lerp(1.1, 0.95, s),
    hemiColors: [mixRgb(HEMI_SKY0, HEMI_SKY1, s), mixRgb(HEMI_GND0, HEMI_GND1, s)],
    hazeK,
    skyHaze,
    fogColor: skyHaze,
    // multiplier for the painted panorama so its horizon haze lands exactly on skyHaze
    panoTint: skyHaze.map((v, i) => Math.min(1.25, v / HAZE0[i])),
    alpenglow: smooth(clamp01((p - 0.7) / 0.3)),
  };
}

// Progress from cumulative inputs only (each one never decreases during a match): the leader's score over the target,
// the mène number, and unpaused play time in seconds. Score alone reaches 1 at the target; time adds a gentle push so
// long mènes still move the light.
export function matchProgress({ scores = [0, 0], target = 13, mene = 1, elapsed = 0 } = {}) {
  const lead = Math.max(0, ...(scores || [0]));
  const scoreP = clamp01(lead / Math.max(1, target));
  const meneP = clamp01((Math.max(1, mene) - 1) / 16);
  const timeP = clamp01(Math.max(0, elapsed) / 1500);
  return clamp01(Math.max(scoreP, 0.7 * meneP) + 0.25 * timeP);
}

// Main-side wrapper: a running max of matchProgress, with the shown value easing towards it (never backwards, so a
// jump in score slides in over a few seconds). `step(match, dt)` takes the game's match object (or null) and the
// unpaused seconds since the last call; it returns the eased value.
export function createDrift({ ease = 0.35 } = {}) {
  let elapsed = 0, target = 0, value = 0;
  return {
    reset() { elapsed = 0; target = 0; value = 0; },
    step(match, dt = 0) {
      if (match) {
        elapsed += Math.max(0, dt);
        target = Math.max(target, matchProgress({ scores: match.scores, target: match.target, mene: match.mene, elapsed }));
      }
      if (dt > 0) value = Math.min(target, Math.max(value, value + (target - value) * (1 - Math.exp(-dt * ease)) + Math.min(target - value, 1e-5)));
      return value;
    },
    get value() { return value; },
    get target() { return target; },
  };
}
