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
  terrainPad: 2.5, // grid extends this far past the string lines (well past the lumber)
  stonePad: 0.6, // stones, pebbles and rocks are scattered this far past the lines; the ground beyond is bare
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
  bodyFriction: 0.1, // tangential friction between spheres
  stoneRestitution: 0.3, // rocks
  pebbleRestitution: 0.05, // pebbles soak up energy rather than bouncing
  stoneMassRef: 0.3, // kg: a pebble's kick scales by min(1, ref / mass), so boules shrug it off, the jack does not

  // Rolling
  rollResistPacked: 0.14, // mu_r on packed gravel
  rollResistLoose: 0.28, // mu_r on loose gravel
  slipFriction: 0.5, // sliding friction while slip speed is nonzero
  restSpeed: 0.02, // m/s: below this (and on the ground) a body rests
  restSpin: 0.5, // rad/s
  restTime: 0.15, // seconds below thresholds before state = resting
  restWindow: 0.5, // s: a rolling body that moved less than restWindowDist over this window (slower than restWindowSpeed) rests, spin or not (E21)
  restWindowDist: 0.003, // m
  restWindowSpeed: 0.1, // m/s
  hardCapSeconds: 12, // s of game time after a throw: anything still moving is forced to rest where it is (E21)
  maxSpeed: 40,
  rollFriction: 1, // scale on terrain mu_r
  spinDecay: 5, // 1/s: exponential decay of spin about the surface normal
  hopSpeed: 0.12, // m/s along the normal after a stone kick that lifts a rolling ball
  bounceMin: 0.4, // m/s: rebound slower than this becomes rolling
  stoneEventSpeed: 0.3, // m/s: smallest stone hit that logs an event
  landLooseDrag: 0.12, // fraction of tangential speed lost at landing on fully loose ground
  landDig: 0.9, // extra tangential speed lost by a hard landing (full at impact 9 m/s, zero below 4), scaled by looseness
  landSpinDamp: 0.55, // fraction of spin lost by a hard landing, scaled by looseness
  landTilt: 0.11, // rad: random tilt of the landing normal (pebble faces), the main source of throw-to-throw spread
  landBounceDamp: 0.08, // restitution divides by 1 + this * impact speed (hard landings plant)
  reverseSpeedMax: 0.7, // m/s: a boule can creep backwards no faster than this
  reverseDistMax: 0.25, // m: nor further than this (backspin checks, never reverses far)
  restitutionJitter: 0.1, // +-fraction randomising landing restitution
  divotSpeedRef: 5, // landing speed that gives divotDepthBase
  divotMinSpeed: 1, // no divot below this landing speed
  lowAirZ: 0.06, // above this ground clearance an airborne body skips terrain/stone checks

  // Out of bounds: dead once fully across a line (see plan §3); the ball then ghosts on until it stops
  deadMargin: 0, // extra slack beyond r
  deadSpacing: 0.1, // m between dead boules lined up beyond the far string line (D11 fetches them there)
  ghostMaxTime: 3, // s: a ghost still moving this long after going out is stopped where it is

  // Lumber surround: 6x6 timbers (0.14 m actual) round the court, lumberGap from the string lines to the inner face
  lumberSize: 0.14,
  lumberGap: 0.4,
  lumberRestitution: 0.35,
  lumberFriction: 0.4, // Coulomb mu against wood
  outsideRollResist: 0.8, // mu_r beyond the timbers (heavy ground)
  outsideLandDrag: 0.6, // fraction of tangential speed lost at any landing beyond the timbers
  outsideLandSpin: 0.7, // fraction of spin lost there

  // Terrain: macro heightfield
  macroAmp: 0.025, // max |h| from noise, m
  macroOctaves: Object.freeze([
    Object.freeze({ freq: 0.25, amp: 0.55 }),
    Object.freeze({ freq: 0.7, amp: 0.3 }),
    Object.freeze({ freq: 1.8, amp: 0.15 }),
  ]),
  crownMax: 0.012, // optional crown/hollow magnitude
  maxHeight: 0.045, // hard clamp on macro height (within +-5 cm)
  jitterAmp: 0.0015,
  jitterFreq: 45,

  // Terrain: looseness
  looseFreq: 0.45,
  looseThreshold: 0.1, // noise above this starts to be loose
  looseSoftness: 0.5, // transition width

  // Stones
  stoneCell: 0.1, // spatial hash cell
  pebbleMinSpacing: 0.13,
  pebbleR: Object.freeze([0.0025, 0.0075]), // radius (5-15 mm diameter)
  pebbleBury: 0.7, // fraction of radius below ground
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
