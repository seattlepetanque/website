// Tuning values for the pétanque game. Units: metres, seconds, radians, kilograms.
// Everything the physics, terrain, AI and renderer need to agree on lives here.
export const C = Object.freeze({
  // Fixed timestep
  dt: 1 / 240,
  gravity: 9.81,
  airDrag: 0.02, // per-second velocity decay in flight (tiny)

  // Terrain layout (x across, y along, z up)
  terrainW: 4,
  terrainL: 15,
  terrainPad: 0.5, // grid extends this far past the string lines
  gridStep: 0.05, // macro height/friction grid spacing
  circle: Object.freeze({ x: 2, y: 1, r: 0.25 }),
  throwFrom: Object.freeze({ x: 2, y: 1, z: 0.9 }),

  // Bodies
  boule: Object.freeze({ r: 0.0375, m: 0.72 }),
  jack: Object.freeze({ r: 0.015, m: 0.018 }),
  jackMinDist: 6, // legal jack distance from circle, metres
  jackMaxDist: 10,

  // Collisions and contact
  restitutionNormalMin: 0.15, // packed ground
  restitutionNormalMax: 0.3, // by looseness (loose absorbs more: lower e)
  contactFriction: 0.5, // Coulomb mu at landing contact
  boule2boule: 0.85, // steel-steel restitution
  boule2jack: 0.6,
  bodyFriction: 0.2, // tangential friction between spheres
  stoneRestitution: 0.3,

  // Rolling
  rollResistPacked: 0.08, // mu_r on packed gravel
  rollResistLoose: 0.15, // mu_r on loose gravel
  slipFriction: 0.5, // sliding friction while slip speed is nonzero
  restSpeed: 0.02, // m/s: below this (and on the ground) a body rests
  restSpin: 0.5, // rad/s
  restTime: 0.15, // seconds below thresholds before state = resting
  maxSpeed: 40,

  // Out of bounds: dead once fully across a line (see plan §3)
  deadMargin: 0, // extra slack beyond r

  // Terrain: macro heightfield
  macroAmp: 0.025, // max |h| from noise, m
  macroOctaves: Object.freeze([
    Object.freeze({ freq: 0.25, amp: 0.55 }),
    Object.freeze({ freq: 0.7, amp: 0.3 }),
    Object.freeze({ freq: 1.8, amp: 0.15 }),
  ]),
  crownMax: 0.012, // optional crown/hollow magnitude
  maxHeight: 0.045, // hard clamp on macro height (within +-5 cm)
  jitterAmp: 0.0015, // hidden high-frequency height, m
  jitterFreq: 45, // cycles per metre

  // Terrain: looseness
  looseFreq: 0.45,
  looseThreshold: 0.1, // noise above this starts to be loose
  looseSoftness: 0.5, // transition width

  // Stones
  stoneCell: 0.1, // spatial hash cell
  pebbleMinSpacing: 0.13,
  pebbleR: Object.freeze([0.0025, 0.0075]), // radius (5-15 mm diameter)
  pebbleBury: 0.45, // fraction of radius below ground
  rockCount: Object.freeze([10, 25]),
  rockR: Object.freeze([0.01, 0.02]), // radius (20-40 mm diameter)
  rockBury: 0.3,
  rockMinSpacing: 0.5,
  maxStones: 5000,

  // Divots
  divotDepthBase: 0.004, // per landing, scaled by impact speed in physics
  divotRadiusBase: 0.04,
  divotDepthMax: 0.02,
});
