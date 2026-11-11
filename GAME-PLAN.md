# Plan: 3D pétanque game (2v2: you + AI partner vs 2 AIs)

Work is tracked in [GAME-BACKLOG.md](GAME-BACKLOG.md).

## Decisions

- three.js is vendored at a pinned version and bundled by Hugo (no CDN at runtime).
- In your team, you choose who throws next (you or your partner); the partner suggests.
- The game is linked from the Links page under "Fun" only (no main-menu item for now).

## 1. Site integration

- Page: `content/game.md` (`title: Play Pétanque`, `layout: game`) → `/game.html`.
- Template `layouts/_default/game.html` holds the canvas, HUD and precise-mode controls.
- `baseof.html` gets a `{{ block "head" . }}{{ end }}` so only the game page loads `assets/css/game.css` and the game script.
- No new build tools: Hugo extended's `js.Build` (esbuild) bundles `assets/js/petanque/main.js` and its imports, then minify + fingerprint.
- three.js is vendored at `assets/js/vendor/three.module.js` and imported relatively, so esbuild tree-shakes it.
- Physics, rules, terrain and AI have no three.js or DOM dependency, so they run under `node --test` (tests in `tests/petanque/`, `package.json` with `"type": "module"`).

```
assets/js/petanque/
  main.js      boot, game loop, fixed timestep
  rng.js       seeded PRNG (mulberry32), noise helpers
  terrain.js   heightfield, friction/looseness map, stones, divots
  physics.js   boule/jack bodies, flight/impact/roll, collisions
  rules.js     mène state machine, turn order, scoring, dead boule/jack
  ai.js        shot candidates, Monte Carlo evaluation, personalities
  input.js     swing gesture → throw parameters
  render.js    three.js scene, meshes, cameras
  hud.js       score, boules in hand, swing gauge, commentary (DOM, aria-live)
  audio.js     WebAudio synthesized clacks/crunch
  constants.js tuning table
```

## 2. Throw gesture

Every throw is five numbers: `yaw`, `speed` (m/s), `loft` (radians), `backspin` (rad/s), `sidespin` (rad/s). Human and AI produce exactly these and go through the same physics.

**Aim:** before the swing, drag horizontally anywhere to rotate the aim camera and aim line. Pinch / wheel / two-finger drag zooms and tilts to inspect terrain.

**Swing:** start a stroke in the bottom third of the screen; an arc gauge (the arm path) appears.

| Stroke part | Controls | Rationale |
|---|---|---|
| Drag down (backswing) length | Power ceiling: longer allows more force but amplifies error | bigger arm swing |
| Upward stroke speed (peak in last ~120 ms) | Launch speed | arm speed |
| Release height on the arc | Loft: low = roulette, mid = demi-portée, high = portée/plombée | real release point sets trajectory |
| Sharp stop just before release (peak vs release speed) | Backspin | wrist snap: smooth follow-through = no spin |
| Lateral drift / curvature of the upstroke | Yaw error + sidespin | crooked swing, crooked throw |

- Pointer Events cover mouse, trackpad and touch; `touch-action: none` on the canvas.
- No trajectory preview. The gauge leaves a ghost of the last swing.
- Precise mode: sliders/keyboard set the same five numbers (accessibility, testing).

## 3. Physics (custom, fixed 240 Hz)

- Body: position (x across 0–4 m, y along 0–15 m, z up), velocity, angular velocity ω (3D), radius, mass, state ∈ airborne | rolling | resting, `dead` flag.
- Boule r = 0.0375 m, m = 0.72 kg. Jack r = 0.015 m, m = 0.018 kg.
- Flight: gravity + tiny drag. No Magnus.
- Landing: impulse at the local terrain normal. Normal restitution 0.15–0.3 (by looseness). Coulomb friction μ ≈ 0.4–0.6 on contact-point velocity `v + ω × (−r·n)`; this is where backspin checks a boule. Landing adds a divot.
- Rolling: rolling resistance μr ≈ 0.08–0.15 (friction map) + gravity along slope + residual slip friction + stone contacts. Rest below a speed threshold.
- Collisions: 3D sphere-sphere including airborne (tir au fer / carreau emerges naturally). Steel-steel e ≈ 0.85, steel-jack e ≈ 0.6.
- Out of bounds: dead once fully across a string line (x < −r, x > 4 + r, y > 15 + r, y < −r).
- All constants in `constants.js`; tune by feel.

## 4. Gravel terrain

From one seed:

1. Macro heightfield: a few noise octaves, 1–4 cm over metres, optional crown or hollow. Drives rolling drift. Rendered as a displaced plane (~5 cm grid).
2. Friction/looseness map: loose patches (more absorption and rolling resistance) vs packed paths. Visible as a subtle colour/texture shift.
3. Discrete stones (Poisson-disc, spatial hash): pebbles 5–15 mm (dense; small kicks, tilted landing normals) and rocks 20–40 mm (rare, visible, big deflections). The jack is affected more. Visible pebbles are the physical pebbles, plus a small invisible jitter.
4. Divots: landings stamp craters into a deformation buffer added to height; they persist for the mène and reset between mènes.

API: `terrain.sample(x, y) → { h, nx, ny, nz, friction, loose }`, `terrain.stonesNear(x, y, radius)`, `terrain.addDivot(x, y, depth, radius)`, `terrain.resetDivots()`.

## 5. Rules (doublette)

- 2 players × 3 boules per team (6 per team), to 13 (7-point quick option).
- Coin toss for the first jack, then the mène winner throws it. Jack valid at 6–10 m from the circle and ≥ 1 m from boundaries, otherwise rethrow / hand-over.
- The team not holding the point throws. If one team is out of boules, the other plays its remaining boules. Equidistant: the team that threw last plays again.
- Dead jack: void mène if both teams have boules in hand; otherwise the team with boules scores them.
- In your team, you pick who throws next; your partner suggests.
- Mène end: overhead camera, measuring lines, point announcement, "Next mène".
- States: `setup → jack → turn(aim → swing → simulate) → meneEnd → … → gameOver`.

## 6. AI

- Personalities: pointeur and tireur, each with per-shot-type error profiles. Opponents Marcel and Odette, partner Pierre. Difficulty scales noise and sim count.
- AI emits the same five throw numbers (plus skill noise) through the same physics.
- Candidates: point (roulette / demi-portée / plombée) at the jack and slight offsets; shoot opponent boules within ~1 m; shoot the jack; push a boule.
- Launch table: precomputed on flat terrain mapping (distance, loft, spin) → speed, refined by sims.
- Monte Carlo: e.g. 8 candidates × 16 sims (≤ ~50 ms, chunked). Score: points held, margin, boules in hand both sides, risk.
- AI perceives macro height, friction map and visible stones; the hidden jitter is noise to it.

## 7. Rendering and cameras

- Low warm sun with shadows (shadows sell lob height), light distance fog.
- Boules: metal PBR with procedural groove normal map; team = groove pattern + subtle tint, plus a coloured ring in the overhead view. Jack: bright painted wood.
- Cameras: aim cam (behind circle, eye height), flight cam (follows boule), head cam (overhead of jack area), inspect mode (free orbit/zoom).
- Pixel ratio ≤ 2, 1024 shadow map, pebble instancing near the head. No-WebGL fallback message. `prefers-reduced-motion` shortens camera moves.

## 8. Milestones

1. Terrain + physics headless with tests.
2. Rendering, cameras, precise-mode throws.
3. Swing gesture.
4. Rules + HUD + full loop with a placeholder AI.
5. Monte Carlo AI.
6. Polish: audio, divots, measuring, commentary, tuning, device testing.
