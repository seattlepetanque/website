# Pétanque game backlog

Design: [GAME-PLAN.md](GAME-PLAN.md). Items run in dependency order; items whose deps are all `done` may run in parallel (they touch different files).

Status values: `todo`, `in-progress`, `done`, `blocked` (with a note).

## Shared contracts (all items must follow these)

- ES modules, plain modern JS (no TypeScript, no npm runtime deps). 2-space indent, single quotes, short comments in the style of `static/admin/preview.js`.
- World units: metres, seconds, radians. Axes: `x` across the terrain (0–4), `y` along it away from the circle (0–15), `z` up. Circle centre `(2, 1)`, radius 0.25.
- `constants.js` exports one frozen object `C` with all tuning values (radii, masses, restitutions, frictions, dt = 1/240, terrain size, etc.). Modules import from it; never hard-code tuning numbers elsewhere.
- `rng.js`: `export function mulberry32(seed) → () => number in [0,1)`, `export function gauss(rand) → number`, `export function makeNoise2D(rand) → (x, y) => number in [-1,1]` (smooth value/simplex noise).
- `terrain.js`: `export function createTerrain(seed, opts?) → terrain` with
  `sample(x, y) → { h, nx, ny, nz, friction, loose }`, `stonesNear(x, y, radius) → [{ x, y, r, h }]`, `addDivot(x, y, depth, radius)`, `resetDivots()`, `visibleStones() → [{ x, y, r }]` (for rendering and AI perception), `perceived()` → a terrain-like object without the hidden jitter (for AI sims), `heightGrid(step) → { w, h, data: Float32Array }` (for the render mesh).
- `physics.js`:
  - `export function createBody(kind /* 'boule' | 'jack' */, props) → body` with `{ id, kind, team, owner, x, y, z, vx, vy, vz, wx, wy, wz, r, m, state, dead }`.
  - `export function launch(body, throwParams, from = { x: 2, y: 1, z: 0.9 })` where `throwParams = { yaw, speed, loft, backspin, sidespin }`; yaw 0 points along +y, positive yaw turns toward +x.
  - `export function createWorld(terrain, rand) → world` with `world.bodies`, `world.add(body)`, `world.step()` (one fixed dt), `world.settled() → boolean`, `world.events` (array of `{ type: 'land' | 'hit' | 'stone' | 'dead', t, a, b?, x, y, speed }`, cleared by caller), `world.clone() → world` (deep copy for AI sims).
  - `export function simulate(world, maxSeconds = 20)` steps until settled.
- `rules.js` (pure, no physics): `export function createMatch({ target = 13 }) → match` and pure helpers:
  `meneResult(jack, boules) → { team, points, measured: [{ id, dist }] } | { void: true }`, `nextTeam(state) → 0 | 1 | null`, plus a reducer `apply(match, event)` for events `jackThrown`, `bouleThrown`, `throwSettled`, `nextMene`. Teams: 0 = human team, 1 = opponents. Players: `{ id, name, team, isHuman, boulesLeft, role: 'pointeur' | 'tireur' }`.
- `ai.js`: `export function chooseThrow({ world, match, player, difficulty, rand }) → { throwParams, intent, label }` where `intent` ∈ `'point' | 'shoot' | 'jack'` and `label` is short commentary text. Must call only physics/terrain public APIs, using `terrain.perceived()`.
- `input.js`: `export function createSwingInput(canvas, { onAim, onSwingUpdate, onThrow })`; `onThrow(throwParams)` gets the same five numbers.
- `render.js`: `export function createRenderer(canvas, terrain) → { sync(world), setCamera(mode, opts), render(dt), pick(clientX, clientY) → {x,y} | null, resize() }`; camera modes `'aim' | 'flight' | 'head' | 'inspect'`.
- `hud.js`: DOM only, receives state and callbacks; no game logic.
- Tests: `tests/petanque/*.test.js`, run with `npm test` (script: `node --test "tests/**/*.test.js"`; Node 24 rejects a bare directory). Root `package.json` has `"type": "module"`.
- Build check: `hugo --gc --minify -d "$TMPDIR/petanque-build"` must succeed with no errors (do not build into `public/`).
- Do not commit. Do not edit files owned by other in-progress items.

## Items

| ID | Status | Model | Deps | Title |
|---|---|---|---|---|
| B01 | done | haiku | — | Vendor three.js |
| B02 | done | haiku | — | Page scaffold and build pipeline |
| B03 | done | sonnet | B02 | Constants, RNG and terrain |
| B04 | done | sonnet | B03 | Physics engine |
| B05 | done | sonnet | B02 | Rules and scoring |
| B06 | done | sonnet | B01, B03 | Renderer and cameras |
| B07 | done | sonnet | B04, B06 | Game loop and precise-mode throws |
| B08 | done | sonnet | B07 | Swing gesture input and gauge |
| B09 | done | sonnet | B05, B07 | HUD and full game flow (placeholder AI) |
| B10 | done | sonnet | B04, B05 | Monte Carlo AI |
| B11 | done | sonnet | B08, B09, B10 | AI integration, personalities, team choice |
| B12 | done | haiku | B07 | Synthesized audio |
| B13 | done | sonnet | B11 | Polish: divots, measuring, commentary, fallbacks |
| B14 | done | haiku | B11 | README and docs |
| B15 | done | sonnet | B12, B13, B14, B16 | Final review, tuning, bug fixes |
| B16 | done | sonnet | B10 | Physics realism: stones, shots, spin |

### B01 Vendor three.js (haiku)
Download a pinned three.js release (use `three@0.170.0`) `build/three.module.min.js` from `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js` into `assets/js/vendor/three.module.js`, plus its `LICENSE` as `assets/js/vendor/three.LICENSE`. Add a one-line header comment file `assets/js/vendor/README.md` stating source URL and version. Done when the file exists and starts with the three.js license banner.

### B02 Page scaffold and build pipeline (haiku)
- `content/game.md`: front matter `title: Play Pétanque`, `layout: game`, `summary:` one line; short intro body.
- `layouts/_default/baseof.html`: add `{{ block "head" . }}{{ end }}` just before `</head>`.
- `layouts/_default/game.html`: `define "head"` loads `css/game.css` (minify + fingerprint + integrity, like baseof) and the JS bundle: `resources.Get "js/petanque/main.js" | js.Build (dict "format" "esm" "minify" true "target" "es2020") | fingerprint`, as `<script type="module">`. `define "main"`: `<article class="content">` with h1 + `.Content`, then a full-width `<div id="petanque" class="petanque">` containing `<canvas>`, a `<div class="petanque-hud">`, a `<div class="petanque-controls">`, a `<p class="petanque-status" aria-live="polite">`, and a `<noscript>`.
- `assets/css/game.css`: layout for the game container (canvas fills width, aspect ~16:10 desktop, taller on phones, `touch-action: none` on canvas), using bistro theme vars.
- `assets/js/petanque/main.js`: stub that writes "Loading…" into the status line.
- Root `package.json` per contracts; `tests/petanque/smoke.test.js` with one passing test.
- `content/links.md`: add `[Play Pétanque on this site](/game.html)` under `## Fun`.
- `.gitignore`: add `node_modules/` already present; nothing else.
Done when the build check passes and `npm test` passes.

### B03 Constants, RNG and terrain (sonnet)
Implement `constants.js`, `rng.js`, `terrain.js` per contracts and GAME-PLAN §4 (macro heightfield, friction/looseness map, Poisson-disc stones in a spatial hash with pebbles and rare rocks, divot buffer, hidden jitter excluded from `perceived()`). Tests: determinism by seed, height within ±5 cm, normals unit length, stonesNear correctness vs brute force, divots change `h` locally and reset.

### B04 Physics engine (sonnet)
Implement `physics.js` per contracts and GAME-PLAN §3. Tests (on a flat terrain stub and on a seeded terrain): a lob with strong backspin stops within ~0.5 m of landing; a roulette rolls much further than it flew; a ball on a slope drifts downhill; a pebble hit changes trajectory vs no pebble; a shot landing on a resting boule moves it and the shooter nearly stops (carreau); out-of-bounds marks `dead`; `clone()` is independent; simulate settles within 20 s; 100 random throws never produce NaN.

### B05 Rules and scoring (sonnet)
Implement `rules.js` per contracts and GAME-PLAN §5, pure and data-only. Tests: who throws next in typical sequences, one team out of boules, equidistant tie, scoring counts, dead jack cases, jack validity (6–10 m, ≥1 m from lines), mène winner throws jack, match ends at target.

### B06 Renderer and cameras (sonnet)
Implement `render.js` per contracts and GAME-PLAN §7 using `../vendor/three.module.js`: displaced terrain mesh from `heightGrid`, gravel look (procedural canvas texture + friction-map tint), instanced visible stones, string lines and circle, boule meshes with procedural groove normal map and team tint, jack, shadows, fog, camera modes with smooth transitions, `pick()` via raycast. Temporarily wire into `main.js` to show a static scene with a few boules. Verify with a headless Chrome screenshot (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --screenshot=... --window-size=1200,900 http://localhost:PORT/game.html` against `hugo server -p PORT`), and look at the screenshot.

### B07 Game loop and precise-mode throws (sonnet)
`main.js`: create terrain/world/renderer, fixed-timestep loop (accumulator, 240 Hz physics, rAF render), precise-mode controls in `.petanque-controls` (sliders for yaw, speed, loft, backspin, sidespin + Throw button, keyboard accessible) that launch a boule from the circle; camera goes aim → flight → head. Verify by screenshot after a scripted throw (expose `window.__petanque` debug hooks only when `?debug` is in the URL).

### B08 Swing gesture input and gauge (sonnet)
`input.js` per GAME-PLAN §2 and contracts; arc gauge rendered in the HUD (DOM/SVG overlay) with ghost of last swing. Pure helper `swingToThrow(samples, aimYaw) → throwParams` exported and unit-tested with synthetic pointer samples (smooth release = ~0 backspin, sharp stop = high backspin, higher release = higher loft, faster = more speed, lateral drift = yaw offset). Precise mode stays available via a toggle.

### B09 HUD and full game flow (sonnet)
`hud.js` + wire `rules.js` into `main.js`: setup screen (target 13/7, difficulty), scoreboard, boules-in-hand per player, whose turn, jack throw, turn sequencing, mène end overhead with points, next mène, game over + play again. Placeholder AI: aim at the jack with a demi-portée and gaussian noise. Human team: chooser for "You / Pierre" when both have boules.

### B10 Monte Carlo AI (sonnet)
`ai.js` per contracts and GAME-PLAN §6: launch table (cached), candidate generation, Monte Carlo on `world.clone()` using `terrain.perceived()`, evaluation, personalities (pointeur/tireur error profiles), difficulty levels, time budget (chunked, async-friendly API also exported: `chooseThrowAsync`). Tests: AI points closer than random on flat terrain; AI prefers shooting when opponent boule sits on the jack and it has boules; deterministic with fixed rand; runs under 200 ms in Node for 8×16 sims.

### B11 AI integration, personalities, team choice (sonnet)
Replace placeholder AI with `ai.js` (async, with a short "Marcel is aiming…" status), partner suggestion text and the "who throws" choice, names Marcel/Odette (opponents) and Pierre (partner), difficulty from setup.

### B12 Synthesized audio (haiku)
`audio.js`: WebAudio-only sounds (steel clack scaled by impact speed, gravel crunch on landing, soft roll noise), mute toggle in controls (remembered in localStorage inside try/catch), driven by `world.events`. Starts only after a user gesture.

### B13 Polish (sonnet)
Divot decals in render, measuring lines at mène end, commentary for carreau/biberon/dead boule, `prefers-reduced-motion`, no-WebGL fallback message, phone layout check via screenshot at 390×844, performance (pixel ratio cap, shadow size).

### B14 README and docs (haiku)
Add a short "Pétanque game" section to README.md (where the code lives, how to run tests, how to tune `constants.js`), and update the repo layout block.

### B16 Physics realism: stones, shots, spin (sonnet)
Fix the problems B10 measured: identical throws end 1–2 m apart because pebbles kick 0.72 kg boules sideways (often to the side line); a tir that hits a boule in the air bounces back several metres; heavy backspin can roll a boule backwards metres; a plombée needs ~120 rad/s backspin to stay near its landing spot. Targets: a boule's resting-spread from identical demi-portée throws on seeded gravel ~0.3–0.6 m at 8 m (jack noticeably more erratic); rare visible rocks can still cause big deflections; a direct in-air hit on a boule transfers most momentum to the target and the shooter drops near the impact point (carreau possible with moderate backspin ~40–80 rad/s); backspin checks a boule but never reverses it more than ~0.3 m; a plombée with ~50–80 rad/s stays within ~0.5 m. Owns physics.js, terrain.js, constants.js and their tests; update ai.js style presets (STYLES / AI) and ai tests only where the new physics requires it. Re-measure and report AI accuracy per difficulty afterwards.

### B15 Final review, tuning, bug fixes (sonnet)
Run `npm test` and the build check; play-test through debug hooks (simulate a full AI-vs-AI match headlessly in Node using rules + physics + ai to confirm it terminates with a winner); fix bugs; tune constants so lobs/rolls/shots feel right; report remaining issues in this file.

## Notes for B15 (tuning)

- From B04: very heavy backspin (~60 rad/s at speed 9, loft 1.0) can make a boule roll backwards several metres. Real boules check up and stop; cap the reverse roll (e.g. damp spin hard on landing in loose gravel).
- From B04: a shooter with no backspin keeps rolling after a hit; carreau needs strong backspin. Check this feels right with the gesture input.
- From B07 screenshot: the 'head' camera sits too high, so boules look tiny. Frame the jack and nearby boules tighter (~2.5–3 m across).
- Integration owed by B11: wire input.js (B08 swing gesture + gauge) and audio.js (B12) into main.js; B08 and B12 deliberately did not touch main.js.
- From B08: swing tuning lives in `SWING` in input.js (speed 12 m/s at 5 screen-heights/s; backswing < 0.2 height caps speed; loft 5° at 0.1 → 75° at 0.6 release height). Tune by feel once integrated.
- From B09: slider defaults are not tuned for the jack throw (a default human jack may land outside 6–10 m); game-over camera shows bare ground instead of the final head; `ownerName` in main.js has a leftover no-op `.replace`.
- From B11 screenshots: the swing gauge arc and labels are oversized and cover the court; the head camera centres on the jack and can cut off boules near the edge (frame the jack plus nearby live boules); the human jack throw has no special mapping and depends on a legal 6–10 m swing.
- From B13 screenshot: the mène-end card said "Odette's boule is 1.64 m from the jack" while the measuring labels showed 37 cm and 52 cm for the scoring boules; check which distance the card reports.
- From B13: the phone gauge CSS was edited after the last 390 px screenshot; re-check it, and capture the setup overlay on a phone.
- From B16: a hit target can roll 9 m or more (rolling resistance 0.08–0.15); carreau mostly happens only on clean in-air hits; plombée has a long tail from rock deflections. Measurement scripts: tests/petanque/measure-physics.js, measure-ai.js.

## Remaining issues

B15 outcome: all "Notes for B15" were fixed or decided (rolling resistance retuned to 0.14 packed / 0.28 loose; swing `fullSpeed` 5 to 9 and `heightHigh` 0.6 to 0.5; human jack gets a speed assist (`assistJackThrow`), a drawn 6 m / 10 m zone and jack slider defaults; mène-end card now reports the winning boule's edge-to-edge gap, matching the measuring labels; gauge nudged off the canvas edge). `tests/petanque/match.test.js` plays full AI-vs-AI matches headlessly.

Worth a human play-test or not done:
- Real-device gesture feel (mouse, trackpad, phone touch). Only synthetic swings were checked; typical swings land 5 to 10 m, but the speed/loft scale may want a further nudge.
- Audio by ear (clack, crunch, roll levels).
- Hit boules now travel about 1.5 to 4 m on gravel; tir feel and carreau frequency are untested by hand.
- Phone setup card sits below the intro text, so on a 390 px screen the player scrolls to it; the setup could scroll into view on load.
- In `?debug&autotest` (all players AI) the human player's name "You" gives odd commentary ("You is aiming...").
- The head camera at game over is dimmed by the overlay and loose boules spread over 2 m make labels small.
- The AI launch table is built on the first AI turn (a short pause on slow devices).

---

# Round 2 backlog

Design: GAME-PLAN.md §9–11. Round 1 contracts above still apply (units, axes, `constants.js`, tests, build check, agents do not commit, don't edit files owned by another in-progress item). Order of importance: throwing (C01–C07), stick figures (C08–C09), meshes (C10–C12).

## Round 2 contracts

- **`donnee.js`** (pure, no DOM/three.js), shared by human and AI:
  - `LOFT_MIN` (8°), `LOFT_MAX` (75°) in radians; `styleForLoft(loft, snapped) → 'roulette' | 'demi-portee' | 'plombee' | 'tir'`.
  - `backspinForLoft(loft) → rad/s`.
  - `solveLaunch({ from, landing: { x, y }, loft, terrain }) → { yaw, speed, loft, backspin, sidespin: 0 }`. Numeric, using the same gravity and drag as `physics.js`; lands within 2 cm of the donnée (including its terrain height).
  - `SKILL`: `{ human, marcel, odette, pierre }`, each `{ lat, long, loft }` base sigmas, plus `difficultyScale` for AI players.
  - `coneFor({ skill, from, landing, loft }) → { sigmaLat, sigmaLong, sigmaLoft }` (metres, metres, radians), growing with distance and loft.
  - `executeThrow({ from, landing, loft, cone, terrain, rand }) → { throwParams, actualLanding, lateralError }`: samples the cone, solves the launch, sets sidespin from the lateral error.
  - `arcPath(from, throwParams, n = 40) → [{ x, y, z }]` (flight only, no collisions).
  - `coneEnvelope({ from, landing, loft, cone, terrain }) → { center, edges: [4 paths], ellipse1, ellipse2 }`, paths as `[{ x, y, z }]`.
  - `predictRoll({ world, terrain, throwParams }) → [{ x, y, z }]`: noiseless sim on `terrain.perceived()` via `world.clone`, path of the thrown body.
- **`render.js` additions:** `setCamera('shoulder', { player: { x, y }, yaw, zoom })`; `setThrowPreview({ center, edges, ellipse1, ellipse2, roll, donnee, style, legalZone } | null)`; `setPlayers([{ id, x, y, yaw }])` (placeholder capsules until C09 replaces them with characters).
- **`toss.js`** (DOM input, replaces the swing in `input.js`): `createTossInput(canvas, { pick(clientX, clientY) → {x,y}|null, getYaw, onTurn(dyaw), onPreview({ donnee, loft, snappedTo }), onThrow({ donnee, loft, snappedTo }), onCancel(), targets() → [{ id, x, y, r }] }) → { setPhase('aim' | 'toss' | 'off'), destroy() }`.
- **`character.js`** (C08): `createCharacter(THREE, spec) → { root, update(dt), setStance('idle' | 'aim' | 'crouch' | 'stand' | 'watch' | 'celebrate' | 'dismay'), walkTo({ x, y, yaw }) → Promise, playThrow({ loft, onRelease(handWorldPos) }) → Promise, handWorldPosition(), dispose() }`. `spec = { name, height, build, colors, stance: 'crouch' | 'stand', quirks }`. C11 swaps the visual for a skinned mesh behind the same API.

## Round 2 items

| ID | Status | Model | Deps | Title |
|---|---|---|---|---|
| C01 | done | sonnet | — | Throw model: solver, backspin, cone (`donnee.js`) |
| C02 | done | sonnet | — | Over-the-shoulder camera, placeholder players, preview drawing |
| C03 | done | sonnet | C01, C02 | Toss input: aim, donnée, pull for loft |
| C04 | done | sonnet | C03, C05 | Integrate the donnée throw into the game |
| C05 | done | sonnet | C01 | AI on the donnée model |
| C06 | done | haiku | C04 | Remove the old swing code; update README |
| C07 | done | sonnet | C04, C05, C06 | Review and tune throw feel |
| C08 | done | sonnet | C02 | Stick-figure skeleton and procedural animation |
| C09 | done | sonnet | C07, C08 | Characters in the game: positions, throw sync, reactions |
| C10 | done | sonnet | — | Find and vendor CC0 rigged human models |
| C11 | done | sonnet | C09, C10 | Skinned meshes on the skeleton |
| C12 | done | sonnet | C11 | Personalities: looks, quirks, reactions, commentary |
| C13 | done | sonnet | C12 | Round 2 final review |

### C01 Throw model (sonnet)
Implement `donnee.js` per the contracts and GAME-PLAN §9, with `tests/petanque/donnee.test.js`. Read `physics.js` for the exact flight integration (gravity, drag, dt) and make `solveLaunch` match it (e.g. bisection on speed using a tiny flight-only integrator that mirrors physics, or launching a body in a bare world). Tune `backspinForLoft` with the physics: a 60° plombée should stop within ~0.4 m of its donnée on flat terrain, a 12° roulette should run well past it, a 35° demi-portée in between. Cone defaults: human lateral ≈ 1.2% of distance, longitudinal ≈ 3% at low loft rising to ≈ 5% at 75°, loft sigma ≈ 1.5°. Tests: landing error < 2 cm across distances 3–12 m and lofts 8–75° on flat and seeded terrain; backspin monotonic in loft; sampled landings match the cone's sigmas statistically; envelope paths finite; `predictRoll` ends near a real noiseless sim.

### C02 Over-the-shoulder camera, placeholder players, preview drawing (sonnet)
In `render.js` only: the `'shoulder'` camera (behind and right of the player at ~1.7 m, looking at a point ~7 m ahead along `yaw`, smooth, wheel/pinch zoom), `setPlayers` with simple capsule placeholders (team colours), and `setThrowPreview` drawing: nominal arc as a ribbon or tube, four faint edge arcs, 1σ (solid) and 2σ (faint) ellipses on the terrain, dotted roll guide, donnée marker (ring on the ground, distinct when snapped to a target), optional legal-zone arcs. Add a `?debug&preview` path in `main.js` (only that block) that shows a static preview with made-up paths for screenshots. Verify with headless Chrome screenshots.

### C03 Toss input (sonnet)
Implement `toss.js` per contracts and GAME-PLAN §9 (aim drag/arrow turning, press to place the donnée, pull down for loft, release to throw, cancel above press point or Esc, snapping to targets within ~0.25 m, keyboard path), with `tests/petanque/toss.test.js` for the pure parts (drag → loft mapping, snapping, cancel rule). Pull distance for full loft ≈ 35% of canvas height; loft changes smoothly. Does not edit `main.js`.

### C04 Integrate the donnée throw (sonnet)
In `main.js`, `hud.js`, CSS, `content/game.md`: replace the swing and the precise sliders (keep raw sliders only behind `?debug`) with `toss.js` + `donnee.js` + the shoulder camera and preview. HUD: loft readout with style name, "Re-aim" button, "Roll guide" toggle (default by difficulty), "View" button cycling shoulder / head / inspect. Human jack throw uses the same flow with the legal zone. AI turns: show the AI's donnée and arc for ~1 s before it throws. Update the intro text and first-time hint. Debug paths keep working.

### C05 AI on the donnée model (sonnet)
Refactor `ai.js` to plan candidates as (donnée, loft) and throw through `donnee.js` (`executeThrow` with the player's `SKILL` scaled by difficulty). Keep the Monte Carlo evaluation and the `chooseThrow` / `chooseThrowAsync` / `chooseJackThrow` signatures, adding `{ donnee, loft }` to the result so the game can show it. Remove the old launch table if no longer needed. Update `ai.test.js` and `match.test.js`; report accuracy per difficulty with `measure-ai.js`.

### C06 Remove the old swing code (haiku)
Delete the swing gesture and gauge (`input.js`, its tests, gauge CSS) once nothing imports them; update README.md's game section (controls, modules, tuning locations). `npm test` and the build must pass.

### C07 Review and tune throw feel (sonnet)
Play through the new flow (scripted via debug hooks and headless screenshots): check the cone sizes feel fair at 6–10 m, the loft → backspin curve gives distinct roulette / demi-portée / plombée behaviour, tir by snapping works and sometimes carreaus, AI shows its spot, jack throws are easy to make legal. Fix bugs, tune, and add a short human play-test checklist to the end of this file.

### C08 Stick-figure skeleton and animation (sonnet)
Implement `character.js` per contracts and GAME-PLAN §10, stage 1: joint hierarchy with fixed bone lengths scaled by `spec.height` and `build`, drawn with capsules and a sphere head; procedural animations with smooth blending; `playThrow` with backswing → release (calls `onRelease` with the hand's world position at the release frame; arm angle at release follows loft) → follow-through; crouch for `stance: 'crouch'`. Tests for pose math (no NaN, bone lengths constant, release fires once). A `?debug&characters` path in `main.js` (only that block) shows all stances for screenshots.

### C09 Characters in the game (sonnet)
Replace placeholder capsules with four `character.js` characters: thrower in the circle, partner behind, opponents to the side; walk in and out of the circle between turns; the throw animation drives the launch (boule leaves from the hand at release; `from` = hand position) and the shoulder camera follows the current thrower; reactions after each throw (celebrate / dismay / watch) from the outcome.

### C10 Find and vendor CC0 rigged human models (sonnet)
Find rigged, animated or animatable human models in glTF/GLB under CC0 (first choice: Quaternius, Kenney) or CC-BY (attribution required). Verify each licence on the source page; exclude Mixamo, Ready Player Me and anything with unclear terms. Pick enough to give four distinct players (separate models, or one base plus variants for hats, colours and proportions), keep the total download small (target < 3 MB), put them in `static/models/` with `static/models/CREDITS.md` (source URL, author, licence, date checked). Also vendor three.js r170's `GLTFLoader.js` and its imports into `assets/js/vendor/`. Report bone names, scale, triangle counts and any included animations.

### C11 Skinned meshes on the skeleton (sonnet)
Load the C10 models with GLTFLoader, map `character.js`'s skeleton onto the model bones (retarget or drive the model bones directly), keep the same API, fall back to the stick figure if loading fails, keep phones smooth.

### C12 Personalities (sonnet)
Give Marcel, Odette, Pierre and You distinct looks (model choice, colours, hats/accessories), stances, idle quirks, reactions and commentary lines, tied to their `SKILL` profiles, per GAME-PLAN §10.

### C13 Round 2 final review (sonnet)
`npm test`, build check, full-match test, screenshots on desktop and phone, bug review, and a "Round 2 remaining issues" list at the end of this file.

## Round 2 notes

- From C02 screenshot: waiting players placed near the circle (partner behind at (2.6, 0.2), opponents at x ≈ 3.5) stand between the shoulder camera and the court and block much of the view. C04/C09: put waiting players out of shot (behind the camera, or beside the court near y ≈ 0–1 at x < 0 or x > 4), and raise the shoulder camera a little (~2.1 m) so the head area shows above the thrower's shoulder.
- From C02: the roll-guide dots are too small to see at 7–9 m; make them larger or a dashed ribbon.
- From C01: with release at z = 0.9 m, a 12° roulette to a 4 m donnée lands fast and runs ~10 m past (off the court). Real roulettes are released low from a crouch and land 1–2 m out. C07/C09: take the release point from the character's hand (crouched pointer ≈ 0.4–0.5 m), and check roulettes then behave; consider capping roulette donnée distance or showing the roll guide by default for low lofts.
- From C01: sidespin from lateral error (≈ 20 rad/s at 2σ) moves a ball only ~3 mm; the lateral error itself carries the off-axis effect. Fine for now.
- From C01: plombée stops within 0.4 m up to ~7 m; at 8–10 m it ends 0.5–0.9 m past (backspin depends only on loft). Acceptable; revisit in C07 if it feels off.
- From C10: the vendored models are Kenney "Mini Characters" (CC0, ~250 KB each): stylised chibi figures ~0.7 units tall (scale ≈ 2.4 for 1.7 m), T-pose, a 7-bone rig (root, leg-left, leg-right, torso, arm-left, arm-right, head) with no elbows or knees, 32 short clips (idle, walk, crouch, pick-up, emote-yes/no, holding-right…), no throw or celebrate clip, no hats. Throws must be procedural on arm-right/torso; hats as meshes on the head bone. A richer human rig (Quaternius Universal Base Characters / Modular Women, CC0) needs a manual download (122 MB zip / Drive quota). The user chose the Kenney chibis (2026-10-31). C11: drive the 7 bones from character.js's skeleton (shoulder → arm-right/arm-left, hips → legs, spine lean → torso, pelvis height → root), use Kenney clips (walk, idle, crouch) where they fit, and keep the stick figure selectable (e.g. `?figures=stick`) and as the load-failure fallback.
- From C05: AI now picks plombée for ~85–90% of points (roulette rarely wins); tireur shoot bonus raised to 0.4; on flat terrain many shots run past the target to the end of the lane. Pointing accuracy improved a lot (medium mean 0.47 m, hard 0.40 m) because the skill cones are tighter than the old noise — C07 should check whether the AI is now too strong against a human using the same cones.
- From C04 screenshots: the cone is hard to see — at 8 m the ±1σ edge arcs (~±10 cm) merge with the centre arc and the 1σ ellipse is a small ring. C07: make the cone read as a cone (e.g. a translucent filled surface between the edge arcs, widening toward the landing; make the ellipses filled and more visible; consider drawing 2σ as the outer edge). Also the roll guide sits behind the descending arc along the camera's line of sight; dashes or a ribbon would read better. Waiting players' shadows show at the left edge of the shoulder view.

### C07 human play-test checklist

Done by script and screenshots; a person still needs to feel it. Try each on a mouse, a trackpad and a phone (touch), on Easy and Hard.

- **Cone:** press on the court at about 8 m and pull for a demi-portée (~35°) and a plombée (~60°). The pale-blue cone should widen toward the landing, the two ground ellipses (inner 1σ, outer 2σ) should be easy to see, and the camera should ease toward your spot. Throw ten boules at the same spot: about nine should end up inside the outer ellipse, four in the inner one. Does the cone feel fair, or too small to matter?
- **Roll guide:** toggle it. The orange dashes should be clearly different from the cream arc and end in a ring. A roulette (≤ 18°) to a donnée 3 to 3.5 m out should roll to about 7 to 8 m; a plombée should stop near its donnée. On Easy the guide starts on, on Medium and Hard off.
- **Low throws:** drag a low loft (about 12°) and watch the release height drop (crouch). Do roulettes feel controllable, or do they run off the court too easily? (Rest distance changes about 3.5 m per metre of donnée, so it is touchy by nature.)
- **Tir:** press within 25 cm of a boule or the jack: the ring turns red, the readout says "Tir ... lands just short" and the cone sits 20 cm short of the target. At 30 to 40° expect to move the target about a third of the time and carreau a few times in a hundred.
- **Jack:** the jack guide is on by default; aim so the orange dashes end between the yellow lines. Almost every toss aimed that way should be legal.
- **AI spot:** watch Marcel and Odette show their spot (marker, arc and cone) for about a second before each throw. Marcel should now sometimes roll or demi-portée; Easy should feel clearly beatable, Medium about even with you pointing carefully, Hard strong.
- **Phone:** the cone and dashes should still read at 500 px wide; dragging with a thumb must not scroll the page; pulling for loft should reach both extremes without leaving the canvas.
- **Look for:** arcs leaving the top of the screen for lofts above ~60° (expected for very high lobs), the placeholder thrower hiding the start of the arc, cones that look wider or narrower than where the boules land, and any throw that leaves from a different height than the preview showed.
- From C09: release heights now come from the character's hand (crouched ≈ 0.16–0.8 m, standing ≈ 0.7–1.4 m by loft), replacing C07's 0.5/0.9 m rule — roulette behaviour shifts; re-run the C07 checklist in C13. The mène-end/game-over gathering reads poorly from the steep head camera (only legs at the top corners); the post-throw reaction cut shows only the thrower; the first throw of a mène gets no reaction. Waiting characters cast no shadow (their shadows fell into the shoulder view).
- From C11: meshes load in the background (stick figures until ready; `?figures=stick`; 5 s timeout → stick fallback; use `&modeltimeout=600000` for headless screenshots). Mesh release heights are lower (crouch ≈ 0.12–0.4 m, stand ≈ 0.1–0.7 m), so plombées start low — check in C13 whether standing throwers should release higher (the chibi's short arms). Shoulder camera widened (×1.45) because the big heads block the view; the thrower's head still fills the lower-left in the human view. Odette's bun pokes through her sun hat from behind. `spec.colors` is ignored in mesh mode (texture colours), and the belly ellipsoid uses the spec shirt colour, which can clash with the texture. Kenney walk clip unused (procedural gait).
- User decision (2026-10-31, after C11): stick figures are the default — the meshes are cute but oddly scaled and can't show crouching. Kenney meshes stay opt-in behind `?figures=mesh` and are not downloaded otherwise. Folded into C12.
- From C12: feet resized (heel-to-toe 0.145·H) and the thrower's footprint centred on the circle; worst-case reach 0.20–0.23 m of the 0.25 m radius (Pierre standing has ~2 cm margin) — checked numerically, not visually. The AI-spot status read "Odette throws the cochonnet (4.5 m)" — check whether that distance is the donnée, and whether the jack ends legal. "You points…" labels still appear in all-AI debug matches. Marcel's belly reads as a large green ball on the stick figure.

## Later (not scheduled)

- T01 Terrain style presets (GAME-PLAN §11): sandy, sandy with rocks, gravel on hard pack, gravel on soft pack, each dry or wet; picker on the setup screen.

## Round 2 remaining issues

C13 outcome (numbers from `measure-human.js 160`, `measure-release.js`, real stick-figure release points):

- **Release-point regression:** no retune needed. Mean distance of the point to the jack (m), before with the old fixed release heights, then after with the figure's hand: human plombée 0.50 (perfect donnée judgement), demi 0.95, roulette 1.85 to 1.93; Marcel easy 0.99 to 0.95, medium 0.65 to 0.69, hard 0.46 to 0.52; Pierre easy 0.99 to 1.01, medium 0.75 to 0.64, hard 0.46 to 0.43. Easy stays clearly beatable, Medium is near a careful human, Hard is a little stronger than a perfect-judgement plombée. Plombée stops within 0.1 to 0.4 m of its donnée from 4 to 8 m for all four players; a roulette to a 3 m donnée comes to rest about 3 m beyond it (standing throwers about 2.8 m, crouching 3.5 m). AI jack legality over 64 jacks each: 81% to 98% (average 92%); Pierre and Odette on Easy are lowest (84% to 86%), because their wide cones miss the 6 to 10 m window; an illegal jack just passes to the other team. Raising the simulation count for the jack did not change this. A human aiming with the roll guide at 7 to 8 m gets 88% to 98% legal at 14, 25 and 35 degrees; aiming at 9 m is 88% at 14 degrees but only 73% at 25 and 53% at 35 degrees (the cone grows with loft and 10 m is close).
- **Fixed in C13:** a player teleported mid-walk (new mène or New game while walking) snapped back to the old walk goal (`setPlacement` now ends the walk); the AI jack throw had no error handling and the throw animation path could leave a rejected promise (both now caught, with a single-launch guard); AI spot text for a jack now reads "lands at 7.5 m, should roll to about 7.7 m" (the old "(4.5 m)" was the landing spot, not where the jack ends; the settled distance is reported afterwards as "Jack is X m out"); all-AI debug matches call the first player Sam, not You; Marcel's belly is a small flattened paunch in the shirt colour (and absent in mesh mode); the mène-end and game-over views now hold the head camera for 2.2 s (measuring labels), then cut to a low angled shot from the circle side with the four players gathered behind the jack; the reaction cut now frames the thrower and a reacting team-mate, and the first boule of a mène gets a reaction (celebrate when within 30 cm, dismay beyond 1 m); `setCamera('inspect')` ignored new angle and distance when already in inspect mode (`reset: true` now overrides the user's orbit).
- **Feet in the circle:** checked visually from the side (`?debug&topcam&who=pierre&topdist=2.4&topel=0.5&topaz=1.5708`): both the crouch and the stand footprints sit inside the red ring; Pierre's margin looked fine, so it was not widened.
- **Listeners and state:** `boot()` runs once, so New game and Play again reuse the same toss, HUD and renderer listeners (no leaks); the toss machine goes to 'off' as soon as a throw is released, so there are no double throws.
- **Not done:** the bundle always includes `GLTFLoader` (about 110 KB unminified) even though the models only download with `?figures=mesh` (Hugo's js.Build does not split chunks); mesh mode is otherwise as C11 left it (odd scale, bun under the sun hat, short arms so plombées start low); in all-AI debug matches Sam still speaks as "You" in commentary; waiting characters have no shadow; the AI launch table is still built on the first AI turn; the mène-end card covers the boules by the jack in the gathered view (the head view just before it shows them with labels).
- **A human should play-test:** the toss on a mouse, trackpad and phone (pull length for loft, dwell to start a toss, thumb dragging without scrolling the page, cancelling by dragging back up); cone fairness at 6 to 10 m (about 86% of throws inside the outer ellipse, 39% inside the inner one); how the roulette run-out feels now that crouched releases are low (touchy: about 3.5 m of rest per metre of donnée); walk-in, reaction and gathering timing (CAST_SPEED 2.4 m/s, 800 ms reaction cut, 2.2 s before the gathered shot) and whether the reaction cut is too short or interrupts the next turn; the shoulder view with Odette or Pierre standing (their bodies fill the lower left); the commentary tone and repetition across a whole game; audio levels by ear (clack, crunch, roll); phone layout of the toss readout and the setup card in portrait and landscape.
- From the C13 mène-end screenshot: in all-AI debug matches the scoreboard says "Sam" but quotes still read "You: …". The mène-end card covers the boules by the jack in the gathering shot.

---

# Round 3 backlog

From the user's play-testing (2026-11-01). Round 1 and 2 contracts still apply: units, axes, `constants.js`, the test and build checks, agents don't commit, and don't edit files owned by another in-progress item. D01, D03, D04 and D07 all touch `main.js` and/or `render.js`, so run them one after another, or split the files clearly.

| ID | Status | Model | Deps | Title |
|---|---|---|---|---|
| D00 | done | sonnet | — | Invalid jack: the other team places it |
| D01 | done | sonnet | — | Full-window game view; no page scrolling while playing |
| D02 | done | sonnet | — | Throw energy limit: far lobs pulled closer, higher lobs less accurate |
| D03 | done | haiku | — | Hide the planned trajectory for AI players |
| D04 | done | sonnet | — | Make the cochonnet easy to see |
| D05 | done | sonnet | — | Rolling sound as faint ticks against pebbles, not white noise |
| D06 | done | sonnet | — | Out of bounds on every side; dead balls placed beyond the far end line |
| D07 | done | sonnet | — | Measuring lines between throws; numbered scoring circle at mène end |
| D08 | done | sonnet | D01–D07, D09–D22 | Round 3 review |
| D09 | done | sonnet | — | Flight camera follows every moving object, the cochonnet first when it moves fast |
| D10 | done | sonnet | — | 6×6 lumber round the court; out-of-bounds balls turn grey, ghost through live balls, bounce off the boards |
| D11 | done | sonnet | D10 | Players fetch dead balls and walk the cochonnet to its spot |
| D12 | done | sonnet | — | Paused game: frozen, sepia, UI inert, free orbit camera |
| D13 | done | sonnet | D04, D16 | AI tactics system (GAME-PLAN §12): first version built; tuning in D22 |
| D14 | done | sonnet | — | Placed cochonnet: legal region runs out to the strings; settle the ground under it |
| D15 | done | sonnet | — | Surroundings: grass, nearby trees, Seattle skyline with Mount Rainier and the Space Needle |
| D16 | done | sonnet | — | Investigate AI throws that fall far short, and why Pierre misses most shots |
| D17 | done | haiku | — | Bright orange cochonnet; arrow only while the human aims, fading after the throw |
| D18 | done | haiku | — | No target marking for AI throws (boules or cochonnet) |
| D19 | done | haiku | — | Roll guide over-predicts low throws (same perceived-terrain bias D16 fixed for the AI) |
| D20 | done | haiku | D13 | Centre the "who throws" choice on screen |
| D21 | done | sonnet | D13 | Simpler, steadier roll guide: a gist of direction and distance, flaring with uncertainty |
| D22 | done | sonnet | D13 | Tune tactics: defensive when down on boules, and rebalance difficulty and teams |

### D00 Invalid jack: the other team places it (sonnet)
Current rule (FIPJP): if the jack throw is invalid (out of bounds, closer than 6 m, further than 10 m, or within 1 m of a line), the opposing team places the jack by hand anywhere valid. The team that threw the jack still plays the first boule. Replace the current hand-over (other team throws again):
- **rules.js:** an invalid `jackThrown` moves to a new phase `'jackPlace'` with `placingTeam = 1 - event.team`, keeping `jackTeam = event.team`. A new event `{ type: 'jackPlaced', team, jack }` must come from `placingTeam` and be valid (otherwise it is ignored). It then moves to `'play'` with the jack set and `jackTeam` unchanged. Update tests.
- **AI placing:** a pure helper in `ai.js`, `chooseJackPlacement({ match, player, difficulty, rand, terrain })`, picks a valid spot that suits its team: a distance and lateral position the placing team's pointeur likes, away from big rocks and slopes it can see on the perceived terrain, with a little randomness. Show a short line ("Odette places the cochonnet at 7.5 m"), then place it with a small drop animation.
- **Human placing:** when it's team 0's turn to place, the human clicks or taps on the court. While hovering or dragging, draw a marker on the ground: a green circle where the spot is valid, a red X where it isn't, and the legal-zone arcs. A click or tap on a valid spot places the jack; on an invalid spot it does nothing except a short status hint. Keyboard: arrows move the marker, Enter places. Put the pointer handling in toss.js as a `'place'` phase (callbacks `onPlacePreview({ point, valid })`, `onPlace(point)`), or in a small new module, and the marker drawing in render.js (`setPlaceMarker({ x, y, valid } | null)`).
- **Status line:** when the jack is invalid, explain why ("Too short: 5.2 m. Marcel & Odette place the cochonnet.").
- Keep `?debug&autotest` working, and add `?debug&jackplace` that forces an invalid human-team jack so the human placement UI shows, plus `?debug&jackplace=ai` for the AI placing.

### D01 Full-window game view (sonnet)
After the setup screen's Start, the game takes over the whole browser window: the canvas and all game UI (scoreboard, whose turn, chooser, buttons, status line, mène and game-over panels, toss readout) fit inside the viewport with no page scrolling, on desktop and on phones in portrait and landscape. Use a fixed full-viewport layer (or the Fullscreen API where available, with the fixed layer as fallback), `100dvh` sizing, and safe-area insets. Overlay the HUD on the canvas or lay it out compactly around it. Keep a clear way out: an Exit or Menu button and Esc go back to the normal page. The site header and footer stay hidden while playing. Respect `prefers-reduced-motion`. Check with screenshots at 1200×800, 1440×900, 390×844 and 844×390 that nothing scrolls and nothing is cut off.

### D02 Throw energy limit (sonnet)
Very high, very accurate lobs are unrealistic and make the game too easy. Add an internal energy budget for a throw: the launch speed (or kinetic energy) a player can deliver with good control, per player in `SKILL` (Odette and Pierre a bit stronger as tireurs, Marcel less). When a toss needs more than the budget (a high lob to a far donnée), pull the donnée toward the thrower along the aim line until the throw fits. Do it live in the preview, so the donnée marker visibly slides closer as you pull for more loft, and show it in the readout (e.g. "max reach"). Also make the cone grow with loft more strongly, and with the fraction of the budget used: near-max throws are less accurate. Apply the same rule to the AI through `donnee.js` (candidates outside the budget get clamped or dropped), and to the human jack throw. Retune so a high plombée at 9–10 m is hard and risky. Re-measure human-vs-AI balance and jack legality.

### D03 Hide the planned trajectory for AI players (haiku)
Don't show the AI's arc, cone, ellipses or roll guide before it throws. Keep the short pause and the "Marcel picks his spot…" line, and optionally a small marker at its donnée. Remove the cone drawing from the AI turn path in `main.js`, and keep `?debug&aispot` working; it may show the arc only when debug is on.

### D04 Make the cochonnet easy to see (sonnet)
At 6–10 m the jack is a few pixels. Try and compare, with screenshots, at least:
- a bouncing arrow or chevron floating above the jack (camera-facing sprite, gently bobbing, constant screen size);
- a soft ring or halo on the ground around it;
- a slightly brighter or emissive material.

Optionally try a narrower field of view or an adjusted shoulder camera, but keep the aim view usable. Pick the clearest that doesn't clutter the scene, show it in the shoulder, head and flight views, and hide or fade it when the camera is close to the jack. Make it work on phones.

### D05 Rolling sound as pebble ticks (sonnet)
The rolling sound still reads as white noise. Replace the continuous filtered noise with sparse, very quiet, dry ticks of the boule against pebbles. Their rate follows rolling speed, with slight random timing and pitch, and an occasional slightly louder tick when the physics reports a stone contact. Keep it near silent overall: barely audible under the landing and collision sounds. The jack's rolling ticks are lighter and higher. Put the tuning in `SOUND.roll` and update the `?debug&sounds` audition buttons.

### D06 Out of bounds on every side (sonnet)
A ball is out of bounds when, seen from above, the whole ball is outside the string line on any side: left, right, front (far end) or back (behind the circle). Verify `physics.js` applies this on all four sides with tests, including balls that roll back toward the circle, and make sure nothing (terrain padding, boards, clamping in `terrain.sample`) stops a ball reaching or crossing a line. When a boule goes out, it stops being simulated (dead, as now) and is moved to the far end of the court, just beyond the far string line, lined up neatly so dead boules are visible and don't clutter the play area. A dead jack follows the existing dead-jack rules; move it there too if the mène continues. Update scoring and measuring so dead balls are never counted. Update the renderer so dead balls show at their new spot, perhaps slightly greyed.

### D07 Measuring lines and scoring circle (sonnet)
- **Between throws:** during the interstitial camera moves (after a throw settles and before the next aim), show measuring lines from the cochonnet to the closest boule of each team, labelled with distances. Use the team colours, and clear them when aiming starts.
- **At mène end:** the camera shows a transparent filled circle on the ground, centred on the jack, just large enough to contain every scoring boule. Each scoring boule is numbered 1, 2, 3… in order of closeness. Show the opponent's best boule just outside the circle, unnumbered, for comparison. Fit the camera so the circle and numbers read clearly, and make sure the mène-end card doesn't cover them (move the card or shrink it).

### D00 notes
- Invalid jack → `'jackPlace'` (rules.js `jackFault()` gives the reason); the other team places it on a wide overhead view with the 6/10 m arcs; green ring = valid, red X = invalid; AI shows its marker ~2 s with a personality line; the jack drops 10 cm and play resumes with the original thrower's team. Debug: `?debug&jackplace`, `?debug&jackplace=ai`, `&jx/&jy`, `&px/&py`, `&jphold`.
- Not seen in a browser: the drop and the hand-back to play (physics test says it settles in ~1 s and moves < 2.5 cm). A rock under the chosen spot could nudge the jack on the drop.

### D10 notes
- Timbers 0.14 m square, 0.4 m outside the strings (`lumberGap`), exported as `LUMBER`; restitution 0.35. Out balls become ghosts (`dead` + `ghost`), collide only with ground, stones and timbers; outside the timbers μr = 0.8 with heavy landing loss; a ghost still moving after 3 s (`ghostMaxTime`) is stopped. In AI sims an out ball stops on the spot (keeps decisions ≈ 50 ms). `terrainPad` is now 2.5 m. D11 helpers: `deadRowSlot(i)`, `deadJackSpot()`, `placeDeadBall()`. New `lumber` physics event (no sound yet). `?debug&lumber` scene.
- Not done: the ground beyond the timbers still reads much like the court gravel (darker earth tint is subtle; soft diagonal patches); string lines are flat at z = 0.012 and break up over terrain bumps (old issue); a ghost stopped by the 3 s timer can overlap a live boule until D11 fetches it; timber collision isn't swept (fine below ~30 m/s); `?debug&timerframes&play` now hangs headless Chrome (use `?debug&play` with a 4–8 s budget).

### Void mène investigation (2026-11-01)
- The user saw a void mène whose card measured a boule to a jack sitting in the court. Since D10, a dead (ghost) jack bounces off the timbers and can come to rest back inside the strings (6 of 160 simulated side knocks), looking alive; by the rules it stays dead and the mène is void when nobody has boules left. In 12 headless AI matches both voids were dead-jack voids. The user's card showed the live-jack text, which the code shouldn't produce for a dead jack, so the cause there is unconfirmed (possibly a page mid-reload, or a human-only path). The card now states the void reason and logs `[void mène]` details to the console; an unexplained void logs a warning. D11 (fetching dead balls) also removes the confusing dead jack from the court.

### D01 notes
- Start/Resume enters a fixed full-viewport layer (plus requestFullscreen where allowed); Exit or Esc returns to the page with a "Game paused" bar (Resume / New game). Debug sliders and "Throw (raw)" removed at the user's request; `?debug&play` enters the layer for screenshots; the sounds audition panel is a collapsible drawer.
- Not done: `viewport-fit=cover` isn't set (iOS letterboxes instead of using the notch area; setting it in baseof.html affects every page). While paused, AI timers still run, so an AI throw can launch and sit frozen until Resume. On phone landscape the mène-end card and first-time hint cover a fair share of the court (D07 reworks the card).

### D02 notes
- Effort = launch speed × loft weight (0.76 at 8° → 1.55 at 75°) against `SKILL.*.maxSpeed` (human 11.6, Marcel 11.3, Odette 12.4, Pierre 12.2). Human reach: demi-portée to 10 m fine; 60° tops out ≈ 8.4 m, 65° ≈ 6.3 m, 70° ≈ 4.6 m.
- Cone: lateral ×(1 + 0.25·t), long ×(1 + 0.85·t) with loft fraction t, all × (1 + 9·max(0, energyFrac − 0.7)²). Coverage test unchanged. `difficultyScale` now 2.3 / 1.35 / 0.65.
- AI jack legality on Easy fell to 82% (Medium/Hard ≈ 97%). The "Max reach" status line isn't cleared when you unclamp. The main.js preview hook (`fitToss`) was committed with D01 because both edited main.js at once.

### D09 Flight camera follows all moving objects (sonnet)
Today the flight camera tracks only the thrown boule. Instead, while anything is moving, frame every moving body: the thrown boule, any boule it knocks, and the cochonnet.
- Each frame, gather the live bodies that are airborne or rolling above a small speed threshold, plus the thrown boule until it settles. Fit the camera (position, target and distance) so all of them stay in view with a margin. Smooth it with damping and limits on pan, zoom and rotation speed, so it never jitters or jumps when a body starts or stops.
- If the cochonnet is moving fast (above a threshold, or projected to reach a string line), make it the primary focus. Aim at where it is heading (current position plus velocity times a short look-ahead, clamped near the court bounds), so the viewer sees whether it goes out of bounds. Keep the other moving boules in frame when possible, giving the jack priority when they can't all fit.
- When everything has stopped, hand over smoothly to the head view as now.
- Keep the camera above the ground and outside characters, keep the court orientation readable (no flipping behind the play), respect `prefers-reduced-motion` (fewer, gentler moves), and work on phone aspect ratios.
- Put the logic in a pure helper (e.g. `frameMoving(bodies, jack, aspect, fov, prev) → { target, distance, yaw, pitch }`) with tests: one boule tracked; two diverging bodies both in view; a fast jack chosen as primary; and smoothing that bounds the per-frame change.
- Add a debug path that scripts a shot knocking the jack hard, e.g. `?debug&jackshot`, and check it with screenshots or a short frame sequence.

### D10 Lumber surround and ghost out-of-bounds balls (sonnet)
Replaces D06's instant relocation of dead balls.
- **Lumber:** 6×6 timbers (actual 0.14 m × 0.14 m) round the whole court, outside the string lines, with a gap of about 0.3–0.5 m between line and timber. Pick the distance so a ball can clearly be out before it reaches the wood. Make it a constant. Render it as weathered wood (a procedural grain texture, slightly uneven tops, butt joints at the corners), casting shadows. Extend the terrain or ground plane outside the timbers.
- **Out-of-bounds physics:** when a ball goes out (whole ball past the string, as now), it turns grey at once and becomes a ghost. It keeps being simulated against the ground, stones and the lumber, but no longer collides with any live boule or the cochonnet, and live balls pass through it. It doesn't affect scoring, measuring or the AI.
- **Lumber collisions:** ghosts and live balls bounce off the timbers (box collision with sensible restitution, about 0.3–0.4 for wood, plus friction). A live ball can't reach the timber without first being out, so in practice only ghosts hit it. A thrown ball that flies over the timber lands outside it and keeps rolling. Out there the ground has strong drag (a high-rolling-resistance zone), so it stops within a metre or two.
- **Settling:** a throw is settled when every body, ghosts included, is at rest (or a ghost has rolled for more than ~3 s). Dead balls stay where they stop; D11 has the players carry them away.
- Update `physics.js` (static lumber boxes, ghost flag, outside drag zone), `terrain.js` (ground outside the timbers), `render.js` (lumber, ghost look), and the tests: ghosts pass through live balls, bounce off timbers, stop quickly outside them, never count, no NaN. Remove D06's relocation, and drop its tests where they no longer apply. Keep AI sims (`world.clone`) consistent.

### D11 Players fetch dead balls and place the cochonnet (sonnet)
Design principle (GAME-PLAN §10): simulate how people really move about during a game, walking to things, picking them up, handing them over, rather than objects teleporting.
- **Fetching:** after a throw settles, the thrower's teammate (or the thrower if alone) walks to each dead ball that has come to rest. They bend and pick it up (the ball attaches to the hand), then carry it to its place:
  - a dead boule goes to the row of out-of-play balls just beyond the far string, set down in its slot;
  - a dead cochonnet goes to the player who will place it (D00 rules), handed over hand to hand.
  Use `walkTo`, a new bend/pick-up and put-down pose in `character.js`, and the hand position.
- **AI placing the cochonnet:** the placing character walks out to the chosen spot, crouches, sets the jack down (attached to the hand until release), and walks back.
- **Human placing:** after the click, the human's character walks out and places it, and the human can skip the walk. Keep the game responsive: the next throw may start while the fetcher is still walking back, if they're out of the shoulder view.
- **Timing:** walks at a natural pace (about 1.2–1.5 m/s), skipped or sped up in `instant`/autotest and under `prefers-reduced-motion` (teleport with a short fade). Characters avoid walking through the court's live boules where cheap (step around or along the side), and step over the lumber.
- **Camera:** stays on the head or follows the fetcher loosely while a fetch runs; never blocks the human's next aim.
- Add a `?debug&fetch` path that scripts a boule and a jack going out, and check the walk, pick-up and carry with a few frame screenshots.

### D12 Paused game: frozen, sepia, UI inert, free orbit camera (sonnet)
When the game is paused (Exit in the game, or Esc, per D01):
- **Freeze everything:** the physics step, character animation and walks, AI thinking and its timers (D01 noted AI timers keep running while paused), throw-reveal sleeps, reaction cuts, camera transitions and audio (suspend the context or stop scheduling ticks). Resume continues exactly where it stopped, with no time jump. Use one pause clock or gate that every timer and sleep in main.js goes through, rather than ad-hoc checks.
- **Sepia:** render the 3D scene in sepia (a post-process pass, or a full-screen shader quad over the frame; keep it cheap) and the game UI too: the scoreboard, buttons, dock and toss readout, via a CSS `filter: sepia(…)` on the game layer, so the whole game reads as a paused photograph. The page's paused bar (Resume / New game) stays in normal colour and fully interactive.
- **UI inert:** game widgets don't respond (`inert` attribute or `pointer-events: none` plus `tabindex=-1`), and the toss input is off.
- **Free camera:** any drag on the scene orbits the camera around a point on the ground (the point under the screen centre when the pause began, or the jack). The wheel or a pinch zooms toward that point. Clamp it to stay above the ground and within a sensible distance. On Resume the camera eases back to where it was before the pause.
- Respect `prefers-reduced-motion` (no animated sepia fade). Check that the paused game shown on the normal page (not full window) still looks right.
- Add `?debug&paused` to enter the paused state for screenshots. Tests for the pause clock: timers don't fire while paused, and fire with the remaining delay after resume.

### D13 AI tactics system (sonnet)
Today the AI picks a throw by Monte Carlo over candidates, scoring each end state, plus a few hand-tuned bonuses (shoot bonus, style preferences). It has no real game sense. Build a coherent tactics layer.

**Step 1: design (write it before any code).** Add a "Tactics" section to GAME-PLAN.md and get it reviewed (the orchestrator shows it to the user before step 2). It must cover:
- **The situation the AI reads:** score and target, mène number, who holds the point and by how much, boules in hand for each team (the boule advantage), boules on the ground and their spread, the jack's position and risk (near a line, could be shot out), the player's role, skill and personality, and who's left to throw on each team.
- **The decisions:** point vs shoot vs shoot the jack (*tirer le bouchon*). Which boule to shoot. Where to point (in front of the jack as a "blocker", or behind it as a safety). Who on the team throws next (also used for Pierre's suggestion).
- **Principles to encode**, each with a short rationale:
  - **Boule advantage:** when down on boules compared with the other team, play defensively: point rather than shoot, and avoid gambling.
  - **Up on boules:** you can afford to shoot or try for more points.
  - **Shooting to bring in more:** shoot an opponent boule when it would bring your more distant boules into scoring, or remove several of their points.
  - **Risk to your own boules:** don't shoot when a miss or a carreau-gone-wrong could knock away your own good boules, or move the jack toward the opponent's boules.
  - **Last boules and score pressure:** near 13, or with the last boules of the mène, value securing a point over a big gamble. Facing a big loss, consider shooting the jack out to void the mène, which only works if the other team has no boules left.
  - **Placing a defensive boule:** a boule in front of the jack can block, or one behind it covers a shot jack.
- **The architecture:** how tactics plug into the existing Monte Carlo. Options: tactics set candidate weights or priors and a risk-aversion level, and the evaluator scores end states with tactics-aware terms such as expected points this mène, the boule advantage after the throw, and the probability of losing the point. Keep the decision explainable, so it can feed commentary ("Odette shoots — we're up on boules").
- **Personality and difficulty:** e.g. Marcel cautious and Pierre reckless; Easy makes more tactical mistakes, Hard plays near-optimally.
- **Testing:** a scenario test table, each a fixed court state with the expected decision (point or shoot, target), plus full-match statistics: AI vs AI and AI vs a scripted human, win rates by difficulty, and the mix of decisions.

**Step 2: implement** the agreed design in `ai.js` (or a new `tactics.js`), with scenario tests and updated measurements. Make sure decision time stays within budget (medium ≤ ~50 ms), and that Pierre's suggestions and the commentary use the tactical reason.

### D14 Placed cochonnet: legal region runs out to the strings (sonnet)
After a bad initial throw, the placing team may put the cochonnet anywhere 6–10 m from the circle, right out to the string lines, without the 1 m margin that applies to a thrown jack. Keep the thrown-jack validity rule (`jackValid`, with its 1 m margin) unchanged.
- **Rules:** add a placement validity check (e.g. `jackPlaceValid`): 6–10 m from the circle centre, with the whole jack inside the strings, and no margin. `jackPlaced` uses it. Tests for spots near each side string, just inside and just outside.
- **Rendering:** during placement, draw the legal zone across the full court width. The 6 m and 10 m arcs run string to string, optionally with a faint fill between them, clipped to the strings. Draw the green ring and red X per the new rule. Don't change the zone drawn for the thrown jack.
- **AI placement:** `chooseJackPlacement` may use the full width, but keeps its personality preferences.
- **Physics near the edge:** a jack placed near a string must stay exactly where it was put, not glance off a pebble or roll on a slope out of bounds. When placing, settle the ground locally: remove stones within ~0.15 m of the spot, and flatten the height field in a small radius (a gentle local "pad" blended into the surroundings, recorded like a divot so it resets each mène). Then set the jack at rest directly, without the drop bounce, or keep the drop and guarantee no lateral motion. Test that a jack placed 1 cm inside a string on a steep seeded terrain stays put and stays live.
- `?debug&jackplace` should show the full-width zone.

### D15 Surroundings: grass, trees, Seattle skyline (sonnet)
Give the court a Seattle park setting.
- **Grass:** replace the dark earth beyond the timbers with grass. Use a procedural grass texture (varied greens, a little noise and clover patches) on the ground out to the horizon, plus a band of instanced grass tufts or blades close to the timbers for depth. Keep it cheap: instanced, with few triangles, and fewer tufts on phones. Leave a strip of worn, bare earth right next to the timbers where people walk. The grass is visual only; the physics outside the timbers stays as D10 set it.
- **Trees:** a few trees nearby (e.g. 4–8, set back 4–15 m from the court, not blocking the shoulder or head views). Mix Pacific Northwest conifers (Douglas fir, western red cedar shapes) with one or two broadleaf trees (bigleaf maple). Low-poly and stylised to match the stick figures, built procedurally in code (cones, icosahedra, simple trunks) with gentle colour variation. They cast soft shadows; optionally add a slight sway.
- **Sky and skyline:** a sky background (a large cylinder or sphere, or `scene.background` with an equirectangular canvas texture) painted procedurally on a canvas at runtime. It has a soft Pacific Northwest sky gradient with light clouds, Mount Rainier (a broad, snow-capped stratovolcano silhouette, hazy with distance) and a Seattle skyline with a recognisable Space Needle silhouette (the saucer top on a tapering waisted tower) among generic downtown towers. Place them in the direction the shoulder camera usually faces (down the court), so Rainier and the Needle show in the background of normal play. Don't use photos or third-party images, so there are no licensing questions. Match the haze and fog colour to the sky, and the sun direction to the existing shadows. Make sure the skyline reads at phone resolution.
- **Performance:** keep the frame rate on phones (pixel ratio ≤ 2), use texture sizes around 2048×512 for the panorama, and don't add per-frame cost beyond the instanced grass.
- Check with screenshots from the shoulder view (Rainier and the Needle visible beyond the court), the head view, and a phone portrait view.

### D16 Investigate short AI throws and Pierre's missed shots (sonnet)
From play-testing: the AI sometimes throws very low balls that stop far short of the cochonnet, and Pierre misses most of his shots. Investigate first, report the findings with numbers, then fix.
- **Reproduce and instrument:** add a `?debug&ailog` mode (and a Node harness) that logs, for every AI throw: the player, difficulty, intent and style, planned donnée and loft, the release point the plan used vs the release point the throw actually used (character hand vs `releasePoint`), whether `fitToBudget` clamped it and by how much, `energyFrac`, the sampled cone error, the actual landing spot, the final rest position, and the distance to the jack or target. Collect a few hundred throws from Node AI-vs-AI matches with the real `executeThrow` and release points.
- **Suspects for short low throws:**
  - Plan vs execution mismatch in the release point: the AI plans with one `from`, but the character's real hand position (crouched, low) is used at launch.
  - `fitToBudget` pulling a donnée much closer than intended, which then still gets thrown.
  - Roulette or low-loft candidates on rough gravel, where the roll-out table (flat terrain) overestimates the roll.
  - The energy penalty inflating the longitudinal sigma.
  - A candidate chosen because every other candidate scored worse (e.g. clamped options dropped).
  - Bugs in the roll-out lookup or in `predictRoll` refinement.

  Measure planned rest point vs actual for each style and find which cause dominates.
- **Pierre's shooting:** measure Pierre's shot rate (how often he chooses to shoot), hit rate (target moved), carreau rate and outcomes, against Odette's. Check his SKILL (lateral sigma for a tir at ~7–9 m vs the boule's 7.5 cm width), his shoot bonus and `stylePref`, the tir aim point (`SNAP_SHORT`, landing just short), the energy budget and penalty for a fast shot, and whether he shoots from situations where a hit is unlikely (long distance, partly hidden target). Decide whether he should shoot less often, aim better, or both. A tireur should hit roughly 40–60% at Medium and more at Hard, with Pierre slightly below Odette.
- **Fix** the causes found, keep human-vs-AI balance roughly as tuned in D02, and add regression tests: planned vs actual rest within tolerance on flat terrain for each style, no AI throw ends more than ~2 m short of its intended rest on flat terrain without a physics reason, and tireur hit rates in range.
- Report before/after tables.

### D17 Bright orange cochonnet; arrow only while the human aims (haiku)
Follow-up to D04.
- **Colour:** make the cochonnet bright orange (e.g. `#ff7a00`, with a slight emissive boost so it stays vivid in shade) instead of yellow, in every view. The dead or ghost jack stays greyed.
- **Arrow:** show the chevron only while the human player is aiming or tossing: from the start of the human's aim phase (turning, placing the donnée, pulling for loft) until release. Hide it during AI turns, the flight, settling, reactions, mène end and jack placement, unless placement is by the human; decide what reads best. After the human releases the throw, fade it out over ~0.4 s, or instantly under `prefers-reduced-motion`.
- **Never while the cochonnet is being thrown:** the arrow is a guide for the human aiming a boule at the jack. Hide it whenever the cochonnet itself is in the air or rolling (a human or AI jack throw), and during the jack throw's aim and toss phase, when there is no jack to point at.
- Implement it as a `renderer.setJackArrow(visible)` (or similar) toggle that `main.js` calls at the start of the human aim and on release. Keep D04's distance fade and the hide rules (inspect, measuring, dead jack). Update `?debug&jackvis` if needed.
- Check with screenshots: human aiming (arrow on), an AI turn (no arrow), and just after release (fading or gone).

### D18 No target marking for AI throws (haiku)
D03 hid the AI's arc and cone but kept a small donnée ring on the ground. Remove the AI's target marking entirely, for both boule and cochonnet throws: no donnée ring, no snapped-target marker, no preview of any kind. Keep the short pause and the "Marcel picks his spot…" line. Also hide the yellow legal-zone arcs during the AI's jack throw (they only help a human aiming). Keep `?debug&aispot` showing the full preview for debugging. This is a small change in `main.js` (`showAiSpot`); check with an AI-turn screenshot that nothing is drawn before the throw.

### D16 notes
- Root cause of short throws: the AI planned on the perceived terrain, which has no ground jitter, so roulettes were predicted to roll 2–3 m too far (Medium roulettes landed 1.9 m short on average, 85% of them over 1 m short). The fixed-step refine search also oscillated. Fixed with a low-loft roughness allowance (`AI.roughK`) and a secant refine. Medium roulettes now average 0.25 m short, and 8% are over 1 m short. Release point, budget clamps and the energy penalty were ruled out.
- Pierre shot 78% of the time and moved the target 20%: poor tir aim (32°, 0.45 m short), a flat +0.6 shoot bonus, and a lateral sigma close to the contact width. Fixed with a 22° tir aimed 0.6 m short plus a closer option, `AI.minHit` (40% simulated hit rate to shoot) with the bonus scaled by hit rate, and slightly tighter Pierre and Odette skills. Medium tireur hit rates are now 32–46%, Hard 62–72%, with Pierre below Odette.
- Knocked-jack report: no stale jack found in the committed or the new AI; a regression test moves the jack and checks the plan follows it. The user's game was likely running D16's mid-edit code.

### D15 notes
- `scenery.js`: tileable grass texture, instanced tufts (7000 desktop / 2200 phone), 8 low-poly trees (Douglas fir, cedar, maple), and a 2048×800 runtime-painted panorama on an inside cylinder spanning 140° around +y (Rainier ~12° left of down-court, downtown and the Space Needle right of centre). Fog pushed to 30–170 m; the terrain mesh eases down to the grass plane 1–1.9 m outside the timbers (visual only).
- Not done: on desktop the shoulder camera sees only ~9° above the horizon, so the top HUD covers Rainier's summit and the Needle's saucer (fine on phone portrait). Fix by lowering or compressing the skyline vertically, or tilting the shoulder camera up slightly. Tree sway skipped.

### D07 notes
- Between throws: team-coloured ribbons from the jack to each team's closest live boule with edge-to-edge cm labels; cleared on aim or launch. Mène end: a translucent circle in the scoring team's colour sized to the farthest scoring boule (trimmed so the best rival sits just outside), numbered badges by closeness, the rival ringed with a grey cm label; the head view frames it above the card, and the gather cut is skipped while it shows. `?debug&measure` scene.
- Not done: a between-throws label placed "beyond the boule" along its line can end up next to a different boule (seen in the debug scene); badges can overlap a neighbour in very tight mènes; the centred game-over card still covers the circle; landscape phones untested.

### D19 Roll guide over-predicts low throws (haiku)
The human's roll guide (`predictRoll` in donnee.js) simulates on `terrain.perceived()`, which has no ground jitter, so it over-predicts how far roulettes and low demi-portées roll. This is the bias D16 found for the AI. Apply the same low-loft roughness allowance D16 added in ai.js (`roughness()` / `AI.roughK`; move the helper into donnee.js so both share it) to `predictRoll`. Test that the predicted rest for 14° and 30° throws on seeded gravel matches the mean real rest within ~0.3 m, and leave plombée unchanged.

### D20 Centre the "who throws" choice (haiku)
The You throw / Pierre throws choice is a critical decision, but in the full-window layout it sits in the bottom-left strip. Make it a centred card over the court: a short heading ("Your team to play"), Pierre's suggestion (D13 adds who he thinks should throw), and two large buttons, "You throw" and "Pierre throws", with the suggested one visually marked (e.g. a "Pierre suggests" tag), not pre-selected. Focus moves to the card for keyboard users; Enter or Space activates and arrow keys switch. Keep the court visible behind it with a translucent backdrop. It must fit on phones in portrait and landscape. The card closes as soon as a choice is made. Remove the old strip version. Depends on D13 because D13 changes the suggestion text in `hud.js`.

### D20 notes
- Centred card over the court (heading, Pierre's suggestion, two large buttons, "Pierre suggests" tag on his pick, focus and arrow keys); old strip removed. The one-line `hud.setSuggestion(text, who.id)` call in main.js was committed with a later main.js change. Keyboard use not tested in a browser.

### D12 notes
- `clock.js` pause clock (frame-driven; sleep/later/cancelAll) with tests; main.js routes waits, AI min-think, reactions and the AI decision through it; pausing freezes physics, characters and rolling audio, sets `inert` on the game widgets, turns the toss off, draws the scene in sepia (render-target shader pass) and the widgets via CSS, and lets drags orbit and zoom around a ground point, easing back on resume. `?debug&paused`. Committed in two parts: standalone files first, main.js/render.js wiring with the next shared-file commit.
- Not checked: the paused bar staying in colour, the inert widgets, the orbit and zoom, and reduced motion. The agent ran the 19:22 stash/pop; all agents were told to check their edits.

### D14 notes
- `jackPlaceValid` / `jackPlaceFault` (6–10 m, whole jack inside the strings), `terrain.settleSpot` (stones within 0.15 m removed, 0.35 m pad flattened, reset with divots), placed jack set at rest with no drop; `chooseJackPlacement` searches the full width; the placement zone is drawn string to string with a faint fill. Committed in two parts (rules/terrain/tests first; ai.js, render.js, main.js with the shared-file commit).
- Not done: removed stones stay drawn (meshes built once); the pad isn't shown in the ground mesh (a few mm); small skewed triangles where the fill is clipped at the strings.

### D22 notes
- The "shoots more when down" figure was mostly a measurement artefact (down-and-not-holding courts have boules worth shooting; up-and-holding ones don't), plus real bugs: appetite divided the downOnBoules penalty (Pierre and Odette barely restrained), and the gate and prior were too weak. Fixed: shoot gate +0.6 per boule down, prior −0.4 per boule down, appetite no longer weakens it. Medium, 100 matches, "shoot% when a shot is on": down 24–28%, even 29%, up 38–44% (Hard 24–30 / 42 / 45–48). Easy shows no trend by design (half-weight boule advantage + 30% errors). New seeded trend test.
- Balance (100 matches, AI team vs a pointer that now plans with `planPoint`): Easy 38%, Medium 46%, Hard 71%, via `DIFFICULTY.*.skillMul` (0.85 / 1.4 / 2.0) in tactics.js stacked on donnee's `difficultyScale`. Follow-up: fold `skillMul` into `difficultyScale`. Hard is now looser than D16's Hard accuracy. Hard v Hard 68% for Marcel & Odette, 53% with a symmetric harness: the rest is the skill table (Pierre looser than Odette) and the human stand-in, not an AI fault.
- Scenarios: Marcel shoots in scenario 4 (60% of seeds at Hard); Odette shoots the jack in scenario 9 (~90%); Marcel also shoots the jack in scenario 9 (it is right there), and points in a two-point variant. `npm test` ≈ 6–9 s. Also commits D14's full-width `chooseJackPlacement`.

### D11 notes
- `fetch.js` (pure route planning around live boules, high-step over timbers, where to stand for a pick-up) with tests; character.js bend/pick-up/put-down (`playBend`), carrying, a `give` stance and waypoint walks. After a throw settles the thrower's teammate fetches each dead ball to `deadRowSlot`/`deadJackSpot`; a failed cochonnet is fetched and handed to the placer, who walks it out and sets it down (the human can skip their walk). `nextTurn` waits up to 20 s while a fetcher is in view (click or key skips). Instant mode teleports; reduced motion teleports after ~0.4 s (no fade yet). `?debug&fetch` with `&fetchat`, `&followc`, `&fetchcam`.
- Not seen in a live game: the full real-time flow (only the scripted scene). The placer's put-down with the tiny jack in the fist wasn't visible; the camera only loosely follows a dead-ball fetch and stays wide during the jack hand-over; mesh figures untried.

### D09 notes
- `camera.js` `frameMoving`: airborne bodies, rolling > 0.05 m/s and the thrown body until it settles (ghosts at weight 0.3 while rolling); a jack faster than 2 m/s or heading out within 1 s becomes primary with look-ahead (≤ 3 m); distance ≤ 16 m, yaw ±0.6, pitch 0.12–0.95, ≥ 0.4 m above ground; capped springs, slow zoom-in. The flight mode uses it when given `bodies`. `?debug&jackshot` (`&jspeed&jloft&jyaw`) and `&freezeat=T`. Committed in two parts.
- Not seen in a browser: the jack becoming primary after a strike (verified in a Node sim and tests; the browser shot's seed differs). The thrower's body fills early flight frames from behind the circle (unchanged from before).

### D21 notes
- `predictRollBand`: 17 noiseless sims across the cone, smoothed to 25 points, half-widths and a rest ellipse, cached; recomputed only after 5 cm / 1° and eased over 150 ms; drawn as nested translucent orange strips with a dashed centre and a faint rest ellipse. Mean rest within ~0.1 m of real at 14°/30°/55°. Committed in two parts like D12.

### D21 Simpler, steadier roll guide (sonnet)
Today the roll guide traces one noiseless simulated path on the perceived terrain. Every pebble and slope bends it, so it draws a complex wiggly shape that jumps with every pixel of drag. Replace it with a gist:
- **Shape:** a smooth, gently curved band from the landing ellipse to the expected rest point, showing roughly where and how far the boule will roll. It flares out toward the end to show the spread of likely rest positions (e.g. a soft wedge or teardrop ending in a small rest ellipse). No pebble-by-pebble wiggles.
- **Computing it:** run a handful of jittered sims (e.g. 8–12 across the landing cone and terrain jitter, cheap and cached) or use a smoothed analytic roll-out (direction from the throw and the large-scale slope, distance from the roll table with D19's roughness allowance). Draw the mean path, smoothed, plus the spread of rest points. Keep it under a few ms per update.
- **Stability:** the guide must change smoothly as you drag. Debounce or throttle updates (e.g. recompute when the donnée moves more than ~5 cm or loft changes more than ~1°), interpolate between results, and keep a fixed random seed per throw so it doesn't flicker.
- **Looks:** keep the orange-dashes palette but as a soft translucent band with a dashed centre line and a faint rest ellipse, readable from the shoulder view, distinct from the cone.
- It depends on D13, which touches `predictRoll` in `donnee.js` for D19. Tests: the band's mean rest is within ~0.3 m of the average real rest on seeded gravel for 14°, 30° and 55° throws, and a 1-pixel drag changes the drawn rest point by at most a few cm.

### D13 notes
- Built: `tactics.js` (situation model, candidate families with priors and reasons, analytic shot pruning, risk λ, evaluator and dead-jack payoff, personality and difficulty tables with 30/8/2% tactical errors, `explain`, `whoThrows`, Pierre's 50/50 advice blend); `ai.js` successive halving with a 40 ms Medium time guard, decisions return `why`/`family`/`who`/`alt`; `why.*`, `suggest.*`, `who.*` line pools; Pierre's chooser suggestion names who should throw; the AI side picks its thrower with `whoThrows`. Medium decision ≈ 24 ms (scenario courts). Tests: `tactics.test.js` (static checks and the §12.8 scenarios), harness `measure-tactics.js`. `match.test.js` now runs 2 seeds with a 40 s limit (flaky under heavy load).
- Deviations from §12 are listed in the D13 report: boule advantage measured before the throw, HOLDER_BONUS 0.25, R3 raises the removal gain, blockers only when something is on the ground, errors never shoot the jack, scenario 7/9/12 tweaks, EPnet tuned on scenarios rather than fitted to rollouts.
- Statistics (20 matches per row, noisy): AI team vs scripted pointer won 90% at Medium (old AI 75%), 70% Easy, 90% Hard; vs shooter 95%, vs tactician 35%; Hard v Hard 90% for Marcel & Odette (teams asymmetric). Voids 1–5%. Shot target-moved: Pierre 40%, Odette 43%, Marcel 46%.
- **Wrong:** the AI shoots more when down on boules (~25%) than when up and holding (9–13%), the opposite of the core principle.

### D19 notes
- Roughness helper moved to donnee.js and applied in `predictRoll`: 14° roll guide error +1.69 m → −0.08 m, 30° +0.34 → −0.26 m, plombée unchanged.

### D22 Tune tactics (sonnet)
Fix and tune the first version of the tactics system (D13 notes):
- **Down on boules → defensive:** the AI currently shoots more when down on boules than when up. Find why (e.g. boule advantage measured before the throw so even hands read zero, the removal-gain gate, the λ sign, the "up on boules" prior scaling) and fix it so shoot rate falls clearly when down on boules and rises when up, as in GAME-PLAN §12.3. Add a statistical test for the trend.
- **Balance:** with ≥100 matches per row on a quiet machine, target AI-team win rates vs the scripted pointer of ~30–45% Easy, ~50% Medium, ~60–75% Hard (or matched to a scripted "reasonable human"), and Hard v Hard ≈ 50% (find the team asymmetry: Pierre's skill, the human seat's stand-in, or the jack team).
- **Scenario fidelity:** make Marcel point in scenario 9 and shoot in scenario 4 per §12.8, and raise Odette's jack shot rate in scenario 9, or document why the design should change.
- Keep `npm test` under ~15 s (move heavy Monte Carlo checks to measure scripts or reduce seeds).

### D08 Round 3 review (sonnet)
Run `npm test`, the build check and the full-match test, take screenshots on desktop and phone, review the code for bugs, and add a "Round 3 remaining issues" list at the end of this file.

## Round 3 remaining issues

D08 review (2026-11-02). Fixed in the review: debug match modes (`autotest`, `jackplace`, `aispot`, `humanturn`) started paused and an instant match never ran (they now enter the full-window view themselves); a drag to orbit the paused scene, or Esc, skipped the cochonnet walk or the fetch wait; a New game while paused re-enabled the toss; New game now also clears the placement marker, scoring flag, fetch gate, last thrower and chevron, and restores stones removed under a placed jack; removed stones are hidden (D14); between-throws labels avoid neighbouring boules and each other (D07); reduced motion fades fetched balls out and in (D11); trees sway slowly (D15); `?debug&paused` waits for the camera to settle; D22's `skillMul` is folded into `difficultyScale` (Easy 1.95, Medium 1.9, Hard 1.3; the tests pin the D02 values 2.3 / 1.35 / 0.65 for their scenario assertions); dead code in main.js removed (`dropping`/`onDropped`, `CAST_ALL`, unused imports and values).

Not done:
- The ground beyond the timbers still reads much like the court gravel; string lines are flat and break up over bumps; timber collision is not swept (fine below ~30 m/s); `&timerframes` hangs headless Chrome.
- The pad flattened under a placed cochonnet is not in the ground mesh (a few mm); small skewed triangles remain where the placement zone fill is clipped at the strings.
- `viewport-fit=cover` is not set (iOS letterboxes); phone landscape untested (mène-end card, hint and card sizes); the centred game-over card still covers the scoring circle; badges can overlap in very tight mènes.
- On desktop the top HUD covers Rainier's summit and the Needle's saucer in the shoulder view (fine in phone portrait).
- Mesh figures (`?figures=mesh`) were not tried with fetching, carrying or the cochonnet hand-over; the put-down with the tiny jack in the fist is hard to see; the fetch camera only loosely follows and stays wide during the jack hand-over.
- The "Max reach" status line is not cleared when you unclamp.
- Pierre is looser than Odette in the skill table, so Hard v Hard is not 50/50 (about 68% for Marcel and Odette).
- A headless screenshot of the paused page showed the site header and title blank (the DOM and classes were correct), so check by eye that leaving the full-window view repaints the whole page.
- Keyboard use of the who-throws card, and the paused view's orbit, zoom and reduced motion, are untested in a browser.
- The void-mène report in the user's game (live-jack text on a dead-jack mène) is unconfirmed; the card logs `[void mène]` details to the console.

A human should play-test:
- Toss feel: the pull for loft, the energy limit and the "Max reach" message, shooting (press near a boule), and how forgiving Easy, Medium and Hard are for you.
- Roll band usefulness: is the orange band readable and steady as you drag, does it match where boules really stop, and is it right to have it on by default only at Easy?
- AI tactics and difficulty: does Medium feel fair (about 46% for the AI against the scripted pointer) and Hard hard (about 71%), do the players point when behind on boules and shoot when ahead, and do their spoken reasons match what they do?
- Fetch pacing: how long fetching dead balls and carrying the cochonnet takes in real time, the wait before your turn while a fetcher is in view (click or key skips), whether the camera follows well, and the jack hand-over and placement.
- Pause and orbit: Exit then drag and zoom (mouse and touch), Resume mid-throw, mid-fetch and while an AI is thinking, and New game from the paused bar.
- Sound levels: the pebble-tick rolling, landings, timber hits (still silent: the `lumber` event has no sound), and the mute button.

---

# Round 4 backlog

From the user's play-testing (2026-11-02). Earlier contracts still apply. Shared-repo rules for agents: never run `git stash`, `checkout`, `restore`, `reset` or `switch`; make small targeted edits in shared files (`main.js`, `render.js`, `character.js`, `hud.js`, `game.css`) and re-read the lines before each edit; don't commit.

| ID | Status | Model | Deps | Title |
|---|---|---|---|---|
| E01 | done | sonnet | — | Quick and slow modes, selectable in game |
| E02 | done | sonnet | E01 | Slow mode: people move like people (who fetches, where they wait, walking to the circle, retrieving out-of-bounds balls) |
| E03 | done | haiku | — | Don't show the AI's target when it places the cochonnet |
| E04 | done | sonnet | — | Undo the ground settling under a placed jack; "Yellow card!" if it ends up outside the valid region |
| E05 | done | haiku | — | Cochonnet range lines always run string to string; draw them behind the people |
| E06 | done | sonnet | — | Odette is left-handed |
| E07 | done | haiku | E06 | Pierre crouches half the time; the human player always stands |
| E08 | done | sonnet | — | Bug: a jack in a clearly valid spot is treated as invalid and gets placed |
| E09 | done | sonnet | — | Bug: Pierre suggests both pointing and shooting in one dialog |
| E10 | done | sonnet | E01 | Each new mène starts from a circle placed around the last jack, playing the other direction |
| E11 | done | sonnet | E01 | Slow mode: a casual-observer camera |
| E12 | done | sonnet | — | "Re-aim" becomes an "Adjust view" toggle for free camera angles |
| E13 | done | haiku | — | Remove "New game" from the in-game controls |
| E14 | done | haiku | — | Full-screen toggle as a video-player-style icon |
| E15 | done | sonnet | — | Game ends at 13 on the ground; leftover boules aren't played |
| E16 | done | sonnet | E01, E06 | Holding the boules: slow-mode pick-up and hand positions; quick-mode underarm palm-down toss |
| E17 | done | sonnet | E01–E33 | Round 4 review |
| E18 | done | haiku | — | Choppy yellow placement-zone fill: clip it properly instead of clamping cells |
| E19 | done | sonnet | — | Bug: AI throws to the middle when the jack is near a string |
| E20 | done | sonnet | — | Current cochonnet boundary rule: in if any part is inside the side strings; > 0.5 m from the end string |
| E21 | done | sonnet | — | Bug: the cochonnet can stay "Rolling…" forever after a throw |
| E22 | done | haiku | — | Scoring circle reaches out to the losing team's best boule |
| E23 | done | haiku | E16 | Bug: a boule shows in the hand when throwing the jack |
| E24 | done | sonnet | E10 | Bug: valid jack judged invalid, then the AI placed it ~2–3 m from the circle |
| E25 | done | sonnet | E10 | Bug: the jack-placement view isn't centred on the valid area (both directions) |
| E26 | done | sonnet | E10 | Bug: after a boule is thrown the camera swings round to face the opposite direction |
| E27 | done | sonnet | E26, E11 | Experiment: a dynamic TV-presentation camera for AI turns (test builds) |
| E28 | done | sonnet | E10 | Ring too close to the far end: move it back to ~11 m of space |
| E30 | done | haiku | — | No automatic fullscreen; fullscreen and pause icons bottom right above the status |
| E31 | done | haiku | E10 | Quick mode: thrower changeover in the circle (out, empty pause, new player in) |
| E32 | done | sonnet | E11 | Close calls at mène end: distances on scoring boules too, millimetres when close, top-down measuring view |
| E33 | done | haiku | — | Header and footer bars span the full width again |

### E01 Quick and slow modes (sonnet)
- **Toggle:** add a game mode setting, shown on the setup screen and switchable mid-game from an in-game control. It is remembered in localStorage (with try/catch).
- **Quick mode** works like the older behaviour: things move into position instantly or with a short fade. Out-of-bounds balls go straight to their row past the far string, players appear at their spots, and the jack hands itself over.
- **Slow mode** is the current walking behaviour (D11: fetching, carrying, walking the jack out), extended by E02, E10, E11 and E16.
- Put the mode in one place (e.g. `settings.mode`) that every walking or teleporting path checks. Debug `instant` and autotest stay instant whatever the mode.

### E02 Slow mode: people move like people (sonnet)
- **Placer fetches the jack:** the player who will place the cochonnet is the one who picks it up. No hand-over from a teammate.
- **Dynamic waiting spots:** when a player returns to wait, they go to the nearest side (left or right of the court) that has a free waiting slot. The slot is either just beyond the cochonnet or just behind the circle, whichever is nearer. Slots never overlap.
- **Walk to the circle:** players walk to the circle to throw, never warp.
- **Who fetches a dead boule:** whoever isn't playing next and can reach it most easily.
  - **Inside the field of play:** if the dead ball came to rest inside the field of play (inside the strings), play pauses (the next turn waits) while the retriever walks onto the court, picks it up and walks off.
  - **Outside the strings:** the retriever walks around the outside of the timbers, never across the court, to fetch it and carry it to its place in the row past the far string.
- All walking uses the pause clock (D12), and the human can skip a walk with a click or key.

### E03 Don't show the AI's cochonnet placement target (haiku)
When an AI player places the cochonnet after a bad throw, show no green ring, marker or preview of where it will go. Keep the status line, and in slow mode the walk out and set-down. `?debug` may still show it.

### E04 Undo the settled ground; "Yellow card!" (sonnet)
- **Remove the settling:** take out D14's `settleSpot` stone removal and ground flattening (terrain.js), its use in main.js, the renderer's stone hiding, and the related tests. Keep `jackPlaceValid` (out to the strings).
- **Real drop:** the placed jack now drops for real and settles on the natural ground.
- **Yellow card:** if it comes to rest outside the valid placement region, show a dialog: "Yellow card! Place the cochonnet correctly!". The same team places it again; the AI picks a safer spot.
- Tests for the re-placement flow.

### E05 Cochonnet range lines string to string, behind the people (haiku)
The 6 m and 10 m range lines shown while throwing the cochonnet still stop short of the strings. Always draw them string to string, for both the throw and placement. Render the valid-area lines and fill behind the people: set the render order and depth so characters always draw over them.

### E06 Odette is left-handed (sonnet)
Add a handedness setting to character specs (`hand: 'right' | 'left'`; Odette `'left'`). Mirror the throw, holding, release point (`releaseOffset` and the hand position), pick-up and carry poses. Make sure the preview, AI planning and physics release from her left hand, and that the shoulder camera sits on the appropriate side for a left-hander. Tests: her release point mirrors a right-hander's.

### E07 Pierre crouches half the time; the human always stands (haiku)
Pierre chooses crouch or stand per throw (50/50, seeded). The human player always stands. Release points follow the stance, so the preview, AI and physics still agree.

### E08 Bug: a valid jack treated as invalid (sonnet)
Sometimes a jack that lands in a clearly valid spot (well within 6–10 m and away from the lines) is treated as invalid and goes to placement. Reproduce it in Node and the browser: log the jack's position at settle vs the position used by `jackThrown`/`jackValid`, the distance reference (circle centre vs throw point), whether the jack is still moving (ghost or rolling) when judged, and the `jackFault` reason. Fix the root cause, show the fault reason and measured distance in the status, and add a regression test.

### E09 Bug: Pierre suggests both pointing and shooting (sonnet)
The chooser sometimes shows two contradictory suggestions (e.g. "You point… / A blocker in front…" or point and shoot together). Make the suggestion one coherent line (who throws plus what), built from a single decision. Remove duplicate `setSuggestion` calls or merged pools. Add a test.

### E10 Each new mène starts from a circle around the last jack (sonnet)
Real rule: the next mène starts from a new circle drawn around where the jack finished, so play usually goes back the other way.
- **Circle position:** at the end of a mène, the circle (a ring object) is placed so the last jack position is inside it, clamped to legal ground (≥ 1 m from the lines, and a jack distance of 6–10 m still possible in the new direction). The next mène is played toward the other end. The camera, aim yaw, legal zones, waiting spots and AI all use the current circle and direction instead of assuming (2, 1) and +y.
- **Slow mode:** the last player to throw carries the ring and places it on the ground around the jack position.
- **Quick mode:** the ring is placed there at the start of the next jack throw.
- Make it a real object (ring mesh) that can be carried.
- Tests: legal circle placement and the direction flip.

### E11 Slow mode: a casual-observer camera (sonnet)
In slow mode the camera behaves like a person watching from the side, not a video-game camera. It takes gentle, unhurried shots from a spectator position at the side of the court, follows play loosely with slow pans and few cuts, and frames the head after throws. The exception is the human's own turn: shoulder view, aiming and preview as now. Quick mode keeps the current cameras. Respect reduced motion.

### E12 "Adjust view" toggle (sonnet)
Rename "Re-aim" to "Adjust view" and make it an obvious toggle (pressed or unpressed state, aria-pressed). While on, click-drag changes the camera's left-right angle freely and up-down a little (about ±15°), and the toss input is disabled. Turning it off restores aiming from the adjusted view. Keyboard: arrow keys while on.

### E13 Remove "New game" from the in-game controls (haiku)
Drop the New game button from the in-game control bar. Keep starting a new game from the paused bar (Resume / New game), the game-over panel and the setup screen.

### E14 Full-screen toggle as a video-player icon (haiku)
The game stays full-window when playing. On desktop, replace the "Exit" or fullscreen controls with a small icon button in a corner, like a video player: enter or leave browser fullscreen with the standard four-corners and inverted icons, plus a tooltip and aria-label. Exit and pause remain available (Esc, plus a pause icon). Hide the icon where the Fullscreen API isn't available.

### E15 Game ends at 13 on the ground (sonnet)
The game ends as soon as a team reaches 13 counting the points currently on the ground, when the other team has no boules left. Example: a team on 12 whose opponents are out of boules needs only one point on the ground to win, so it doesn't play its remaining boules. More generally, once the opponent has no boules left and the current points on the ground already take a team to 13, the mène ends immediately. Implement it in rules.js (with tests), have main.js end the mène and game at once, and have the AI and tactics treat it correctly (no wasted throws).

### E16 Holding the boules (sonnet)
- **Slow mode:** at the start of a mène, players take turns quickly picking up their three boules. Each holds one in the dominant hand and two side by side in the other hand (Odette is the lefty). Hands visibly carry them between throws, and the count drops as they're thrown.
- **Quick mode:** show the boule held with the hand upright at first. During the backswing it comes round the inside to the bottom of the hand, for an underarm, palm-down toss at release.
- Update character.js poses (hand orientation now matters: give the hand a visible direction or a flat palm), and keep the release point accurate.

### E18 Choppy placement-zone fill (haiku)
Cause (render.js, the D14 placement zone): the faint fill is a polar grid of cells between the 6 m and 10 m arcs. Cells that cross a string are kept, with their vertices clamped onto the string, so neighbouring cells fold and overlap. With `depthTest: false` and transparency, the overlaps stack and show as darker triangles along the strings. It isn't z-fighting. The mottling in the middle is mostly the gravel texture showing through the 16% fill. Fix: build the fill as a clean annular sector without clamping, and clip it exactly at the strings and the far line. Either use three.js clipping planes (`material.clippingPlanes` with `renderer.localClippingEnabled`) or clip each cell polygon to the court rectangle (Sutherland–Hodgman), so no triangles overlap. Keep it draped on the terrain and drawn behind people (E05). Check by screenshot.

### E19 Bug: AI throws to the middle when the jack is near a string (sonnet)
Cause: `tactics.js` (around line 463) drops every candidate whose target is within 0.3 m of a side string (`target.x > 0.3 && target.x < W - 0.3`) or past 14.5 m. With the jack touching a string, all the "point at the jack" and nearby-offset candidates are discarded and the AI falls back to what's left (the middle). D14's string-to-string placement makes this common. Fix: keep candidates whose target is inside the strings, clamping the target a boule radius inside the line rather than dropping it. Make sure the roll and refine logic copes with targets near a line (risk of going out is part of the evaluation, not a filter), and that tirs at boules near the line are allowed. Tests: with the jack 2 cm inside each side string (and near the far line), the AI's pointing plan aims at the jack and its predicted rest is within ~0.5 m of it.

### E01 notes
- `settings.js` (mode quick/slow, default slow, localStorage); a Pace option on setup; a "Mode: Slow/Quick" button in the controls bar; `slow()` in main.js (`!instant && !reduceMotion() && mode === 'slow'`) gates every walk; switching to quick mid-walk finishes walks at once. Reduced motion still forces quick. Committed in parts: settings.js first, wiring with the next shared-file commit. Quick play and the mid-game switch not tried in a browser.

### E06 notes
- `hand: 'right'|'left'` in character specs (Odette left); throw, aim, crouch, stand and give stances mirror; holding, carrying, pick-up and `handWorldPosition` use the dominant hand; `releaseOffset`/`bendReach` take `hand`; `handKey`/`offKey` helpers for E16; main.js passes `spec.hand` into every `from` path; the shoulder camera mirrors for a left-hander. Tests for mirrored release, bend reach and carry. Committed with the next shared-file commit.

### E19 notes
- tactics.js: pointing targets clamped 0.08 m inside the strings and 0.55 m before the far end instead of dropped; the field filter keeps only `y > 2`; shot targets stay on the real body (hit counting needs it). Tests at both strings and near the far line (jacks at y 13.5/14: long roulettes scatter more than 0.5 m, so the far check is looser).

### E07 notes
- The human's spec stance is 'stand'; Pierre has `stances: ['crouch','stand']` picked by `pickStance` from a separate seeded stream when he enters the circle; `stanceOf(id)` feeds `handFrom`, so preview, AI plan and launch agree; `setStance` now updates the throw pose's stance. New personalities.test.js. Pierre's advisory plan uses his default stance (advice only). Committed with the next shared-file commit.

### E08 / E09 notes
- E08: no judging defect found in thousands of seeded throws. The "clearly valid" rejections were jacks within the old 1 m side margin; `jackFault` now names the side and gap ("Too close to the right line: 0.83 m, it needs 1 m"), flags a dead jack that rolled back, and `?debug` logs the judged state. The user then gave the current rule (E20), which replaces the margin. Fault messages in rules.js commit with E04/E20.
- E09: the who line and the reason line came from different decisions and each had its own "Pierre:" prefix; `composeSuggestion` now builds one line from one decision. Committed (8d30331) with suggest.test.js.

### Small UI fixes (E03, E05, E13, E14, E18) notes
- E03: no AI placement target unless `?debug&showtarget` with aispot or jackplace=ai (not screenshotted; code reading). E05: both zones' arcs are depth-tested terrain-draped ribbons string to string, behind people. E18: the fill is concentric in-court ring strips ending exactly on the strings (no clamping or overlap). E13: no New game in the controls bar. E14: top-right fullscreen icon (hidden without the API or on coarse pointers) and a pause icon replacing Exit. Committed with the next shared-file commit. The range lines are thin at a distance.

### E20 Current cochonnet boundary rule (sonnet)
The user's rule (recent FIPJP change): after a throw the cochonnet is judged at the side strings like a boule: it is in if any part of it is inside the string (out only when the whole jack is past it). At the end string it must be more than 0.5 m from the end string. The 6–10 m distance still applies. Use the same rule for a placed jack. Update `jackValid`, `jackPlaceValid` (or merge them), `jackFault` messages, the AI's jack throw and placement targets, the human placement marker, and the drawn zones (string to string; with E10's moving circle, the far end of the zone must stop 0.5 m before the end string). Tests for edge cases at each side string (jack centre just outside but overlapping the string = in) and at the end string.

### E12 notes
- "Adjust view" toggle (eye icon, aria-pressed, filled state): drag orbits the shoulder camera (yaw ±180°, pitch ±15°), wheel/pinch zoom, arrows adjust, Esc turns it off; toss input off while on. Turning it off keeps an offset within 35° (eases back beyond that; pitch kept); auto-off at turn end and on release. `?debug&humanturn=jack&viewyaw=40&viewpitch=10&adjust`. Committed with the next shared-file commit.

### E04 notes
- D14's settling removed (settleSpot, stone removal, pads, stone hiding). `placeJack` drops the jack ~4 cm onto natural ground; `jackPlaceSettled` (replaces `jackPlaced`) moves to play on a valid rest, otherwise stays in jackPlace with `yellowCards` + 1. `hud.showYellowCard` ("Yellow card! Place the cochonnet correctly!" + reason; human "Place it again"; AI auto-continues after ~2.8 s and retries with a stricter margin per attempt). `?debug&jackplace&yellow`. Not done: on a re-place the jack is removed rather than carried back; no natural roll-out seen in a browser. Committed with the next shared-file commit.

### E21 Bug: cochonnet stuck "Rolling…" forever (sonnet)
After a jack throw the game can sit on "Rolling…" indefinitely. Suspects to check:
- `world.settled()` never returning true: the light jack jittering on a pebble or slope, rest thresholds (`restSpeed`, `restSpin`, `restTime`) never met because of spin or micro-bounces, a ghost jack against a timber, or a jack balanced on a timber top.
- The game waiting on something other than physics: the clock paused, a fetch or walk gate, a camera hand-over, or `flying` never cleared.
- An exception in onSettled swallowed.

Reproduce with seeded Node throws (thousands of jack throws over seeded terrain, flagging any that haven't settled after 20 s) and by reading the browser path. Fix the root causes. Add a robust fallback: if the throw hasn't settled after a hard cap (e.g. 12 s of game time), force every body to rest where it is and log under `?debug`. Add regression tests for any stuck case found.

### E20 notes
- Single `jackValid` (alias `jackPlaceValid`): in unless wholly past a side string; centre > 0.5 m before the end string in the playing direction (`geometry.dir`); 6–10 m still applies; a jack that crossed a line and came back is still dead. `jackFault` reasons line/end/out/short/far with specific messages; the AI jack throw keeps 1.3 m from the end string, placement 0.1 m inside the rule; zones clamp 0.5 m before the end string. Hooks handed to E10 (`geometry.dir`, `zoneDir`, AI jack aim). Committed with the next shared-file commit.

### E22 Scoring circle reaches the losing team's best boule (haiku)
D07 sized the mène-end circle to just contain the scoring boules and trimmed it so the rival's best boule sat outside, which leaves a gap that reads as wrong. The circle should mean "everything closer than their best boule scores": make its radius the distance from the jack to the losing team's best live boule (edge to edge, matching the cm labels), so that boule sits on the circle line and every scoring boule is inside. Keep the rival boule's ring and grey label on the line, the numbered badges inside, and the camera framing including the whole circle. When the losing team has no live boule, fall back to just enclosing the scoring boules plus a margin. render.js / main.js endOfMene; check with a mène-end screenshot.

### E23 Bug: a boule shows in the hand when throwing the jack (haiku)
When a player prepares to throw the cochonnet, the hand shows a boule (`setHolding(true)` draws the steel boule). For a jack throw, show the small orange cochonnet in the hand instead (jack radius and material), released at the same frame; and for E16's held-boule display, keep the player's three boules in the other hand or not shown during the jack throw as reads best. Covers human and AI jack throws, both modes. Check with a screenshot of the jack throw aim and a frozen release.

### E02 notes
- `waiting.js` (two zones per side, beyond the jack and behind the circle, 3 slots each 0.8 m apart, 1 m outside the strings; nearest free slot on the nearer side), `fetch.js` `outsideWaypoints`/`planRoute` (round the outside of the timbers when a straight walk would cross the court), the placer fetches the failed jack, `beginTurn` waits for the thrower to walk to the circle, `pickRetriever` (not the next thrower, shortest route), on-court dead balls hold the next turn, off-court ones don't. Debug `&slow`, `&e02`, `&fetchin`. Six waiting tests.
- For E17: `enterCircle` runs twice in the walk-to-circle step, so Pierre's E07 stance is re-rolled on arrival (pick once); the debug fetch scene still shows the old teammate hand-over; in the debug fetch view the controls bar ("Mode: Slow") is partly covered by the E14 fullscreen and pause icons. Committed with the next shared-file commit.

### E24 Bug: valid jack judged invalid, AI placed it ~2–3 m out (sonnet)
User report (2026-11-02, while E10/E20/E04 were mid-edit on the live-reload server): a valid jack was treated as invalid, then the AI placed it far closer than 6 m (about 2–3 m from the circle, screenshot in the session). Likely an inconsistent circle/direction: the rules, the AI placement and the drawing using different circle positions or directions while E10 moved from fixed `C.circle`/+y to the court module. After E10 lands: assert in tests that `jackValid`, `jackFault`, `chooseJackThrow`, `chooseJackPlacement`, the human placement marker and the drawn zone all use the same circle and direction (a single source); run seeded full matches over several mènes (including direction flips and invalid jacks) checking every placed jack is 6–10 m from the current circle and valid; and fix any path still reading `C.circle` or assuming +y.

### E16 notes
- Mitten hands with palm roll (`rollL`/`rollR`; the throw turns palm-down in the backswing), `setHeldBoules({dominant, other, color})`, `shiftBoule()`, `heldBoules`; the held boule's position keeps `releaseOffset` unchanged (an offset version hurt hit rates). Slow mode: `collectBoules()` after the jack is set (staggered bends, 1 + 2 each), `readyHeld()` in enterCircle. Quick mode: one boule, palm up then over. Debug `&hold`, `&backswing=`. holding.test.js. Not seen: the slow-mode pick-up in a browser; boules don't appear on the ground before pick-up. In the `&hold` screenshot Marcel (bronze team) held steel boules: check the team colour. Committed with the next shared-file commit.

### E21 notes
- Cause: 0.6% of seeded jacks stuck `rolling` on ~0.2-grade slopes at speed 0 with spin ~0.52–0.67 rad/s (just above `restSpin`), a fixed point between slip friction and the rolling-resistance clamp. Fix: rest when moving < 3 mm over 0.5 s below 0.1 m/s (`restWindow*`); 3000-jack sweep now 0 stuck. Hard cap `hardCapSeconds` 12 with `world.forceRest()` (also bounds `simulate()`); main.js frame loop caps an unsettled throw at 12 s of game time (logs under ?debug), wraps `onSettled`/`tickCast` in try/catch, and a 12 s watchdog forces the release if the walk or throw animation stalls. settle-cap.test.js. physics.js now imports E10's court.js, so it commits with E10.

### E23 notes
- `setHolding('jack' | 'boule' | false, color)`: a jack-radius orange mesh for jack throws (same centre, so the release point is unchanged); jack throws clear held boules and skip `readyHeld`. Team colours: quick mode never passed a colour (always steel) and `&hold` indexed by cast slot; both now use the player's team. The jack floats slightly above the mitten. Committed with the next shared-file commit.

### E25 Bug: placement view not centred on the valid area (sonnet)
User screenshot (mène 4, quick mode): the wide placement camera framed the court from behind the circle with the valid zone squeezed at the top edge (the green ring at the far end). The placement camera must frame the whole 6–10 m zone for the current circle and direction (court module from E10): centred on the zone, looking along the playing direction, both arcs and the strings fully in view on desktop and phone.

### E26 Bug: camera swings round after a throw (sonnet)
After a boule is thrown the camera rapidly turns to face the opposite direction (likely the flight camera, D09's `frameMoving`, or the head view assuming +y while play now runs toward −y after E10). Make every camera mode (flight framing yaw limits, head view, reaction cut, mène end, gathering, paused orbit pivot) use the current playing direction, and add a test that `frameMoving` with dir −1 keeps the camera behind the play.

### E27 Experiment: TV-presentation camera for AI turns (sonnet)
The accidental swing in E26 felt lively. Build a few test variants of a dynamic, TV-style camera for AI turns only (the human's turn keeps the shoulder view): e.g. (a) a low side shot tracking the boule then cutting to the head, (b) a reverse angle from behind the jack watching the boule arrive, (c) a slow crane over the head. Selectable via `?debug&tvcam=a|b|c` and a hidden setting so the user can compare, plus screenshots or short frame sequences of each. Keep motion smooth, respect reduced motion and the pause, and work in both directions. Coordinate with E11 (slow-mode casual camera): quick mode could use TV-style, slow mode the observer style, or let the user pick.

### E28 Ring too close to the far end: move it back (sonnet)
Refines E10. When a new mène's ring is first placed around the last jack position, measure from the front of the ring (its edge facing the playing direction) to the far string. If there is less than 10 m, move the ring backwards along the playing direction until there are about 11 m from the front of the ring to the far string (still inside the court, ≥ 1 m from the lines behind it). In slow mode this is visible: the player who placed the ring picks it up again, walks it back and puts it down at the corrected spot. In quick mode it simply appears at the corrected spot. Tests: a jack that finished 4 m from an end yields a ring with ~11 m to the far string; one with plenty of room isn't moved.

### E30 No automatic fullscreen; icons bottom right (haiku)
Starting a game must not put the browser into fullscreen: drop the `requestFullscreen()` call on Start, Resume, New game and Play again. The game still fills the browser window (the fixed full-window layer, as now). Browser fullscreen only happens through the fullscreen icon button. Move the fullscreen and pause icon buttons from the top-right corner to the bottom right, just above the status/commentary area, so they never overlap the scoreboard or the controls bar; keep them reachable on phones (portrait and landscape) and above any cards. Check with screenshots at 1200×800 and 500×900.

### E31 Quick mode: thrower changeover in the circle (haiku)
In quick mode, changing throwers should read clearly: the previous thrower disappears from the circle to their waiting spot (the circle is empty), a brief pause (~0.4 s), then the new thrower appears in the circle (a short fade for each, instant under reduced motion). No overlap of two players in the ring, no snapping one onto the other. Uses the pause clock and the current circle (E10). Slow mode keeps the walking changeover.

### E30 notes
- `setPlaying` no longer requests fullscreen (Start, Resume, New game and debug entries call `setPlaying(true)`); the fullscreen and pause icons moved to grid row 2, bottom right just above the dock, z-index above cards; the scoreboard's corner padding removed. For E17: in the E30 screenshot of the who-throws card the head camera was zoomed right onto the gravel (huge "34 cm" label), probably E10's in-progress camera; check the head view framing. Committed with the next shared-file commit.

### E10 / E28 notes
- `court.js` is the single source of truth (live `court.circle`, `court.throwFrom`, `court.dir`, plus helpers); `nextCircle` places the ring around the last jack (≥ 1 m from the lines), flips the direction, and moves it back until ~11 m remain from the ring's front to the far string when there was under 10 m (E28). `nextMene` sets `geometry.circle`/`geometry.dir`. AI, tactics, donnee, physics dead rows, waiting spots, toss, aiming, walk-ins, gather and home spots, all camera modes (flight `frameMoving` with dir, head, inspect, reaction, placement framing the whole zone) and the zone drawing follow the court. The ring is a mesh: slow mode the last thrower carries it (and re-carries if corrected); quick mode it fades. Debug `?debug&mene2` (+ `&ringcarry&slow`, `&ringheld`). court.test.js, camera dir −1 test.
- E24: no fixed circle remained in the validity, AI or marker paths after E10 (the AI jack y-offsets and the E20 end rule were fixed to +y and are now direction-aware); a test checks placements 6–10 m from the current circle in four setups. The user's short placement likely came from mid-edit code. E25/E26: E10 reframed the placement camera and made the flight camera direction-aware; verify in E17.
- Not seen in a browser: the animated ring carry, quick-mode ring fade, and the real mène-end flow.

### E22 notes
- Circle radius = max(rival centre distance, furthest scoring boule edge), so the rival's centre sits on the line (edge band centred on the radius); no live rival → scoring edge + 0.07 m; old trim removed. Fallback not screenshotted. Committed with the next shared-file commit.

### E31 notes
- `character.setOpacity`/`fadeTo` (game-time fades, freeze with the pause); quick mode `changeoverIn`: previous thrower fades out (0.15 s) to their waiting spot, 0.4 s empty circle, new thrower fades in; `beginTurn` waits for it. Slow mode, autotest and reduced motion unchanged. Not seen in a browser. Committed with the next shared-file commit.

### E32 Close calls at mène end (sonnet)
User screenshot (mène 3): Marcel's boule (scoring, badge 1) and Pierre's steel boule (the rival, grey "22 cm") were both ~22 cm from the jack; from the low angled camera the steel boule looked closer, so the result looked wrong even though the circle was consistent. Make close calls unambiguous: label every scoring boule with its distance as well as the rival; when the winning and rival gaps differ by < 2 cm, show millimetres ("21.6 cm" vs "22.3 cm") and say "Close call!" in the card; and at mène end move the camera to a near top-down view over the circle (higher pitch, centred on the jack) so perspective can't mislead. Keep it readable on phones.

### E33 Header and footer full width (haiku)
Since E30 moved the fullscreen and pause icons, the scoreboard header no longer spans the full width (and the bottom strip may be narrower). Restore full-width header and footer bars as before, with the icons placed without squeezing them (e.g. in the bottom-right corner above the status strip as an overlay that doesn't take a grid column, or inside the footer bar at its right end). Check at 1200×800, 500×900 and 844×390.

### E33 notes
- The E30 icon group took an implicit grid column (~84 px), squeezing the scoreboard and dock; it's now absolutely positioned in row 2 at the bottom right. For E17: in the E33 screenshot the jack chevron was faintly visible during Marcel's turn ("Marcel is aiming…"); confirm it's only the fade-out and that D17's human-aim-only rule holds.

### E11 notes
- `camera.js` `frameObserver`: a spectator 3.5 m outside the side timber at 1.7 m, eased capped pans (0.3 rad/s, 0.8 near the frame edge), slow zoom drift, walks along the side at 1.3 m/s only when the action is > 4.5 m away; reduced motion: slower, no dolly; dt 0 freezes (pause). `cameraStyle({slow, human, override})` → observer/tv/game read once in main.js (`camStyle`), `?debug&cam=game|tv`. render.js `'observer'` mode (and negative frame time clamped). Slow mode uses it for AI turns, after throws, mène end, chooser, flights, reactions, gathering, fetches and the ring carry; the human's own turn (shoulder), placement and quick mode keep the game cameras; after the human's release a 1.1 s flight follow. Six camera tests. Not visually checked (headless renders too few frames): framing, zoom tightness, whether the mène-end card covers the subject.

### E32 notes
- Every scoring boule labelled (team-coloured), mm precision and "Close call!" when gaps differ < 2 cm, near top-down mène-end view (head camera `el` 1.38 rad) in both modes, box-based label placement; `&closecall` debug. Quick-mode mène end not screenshotted.
- For E17: in the close-call screenshot (gaps 2.8 vs 3.5 cm) the circle was drawn ~1 m across instead of passing through the rival boule (a minimum display radius overriding E22?), and the "1" badge sat on top of the scoring boule, hiding it. Committed with E27.

### E27 notes
- Three TV variants for AI boule throws (`camera.js` `frameTV`/`tvGoal`/`tvVariant`, render.js `'tv'` mode): (a) low side tracking shot then cut to the head; (b) reverse angle from 2.4 m behind and 1 m beside the jack, holding 1.4 s after rest; (c) crane rising 0.12 → 1.0 rad over 5 s, holding 2.2 s. Jack throws fall back to (a). `?debug&tvcam=a|b|c` or `localStorage petanque-tvcam`; quick mode uses TV when set, slow mode keeps the observer unless overridden. During a hold the next camera request (including the mène-end view) is queued, delaying it up to 2.2 s. Agent recommends (b) as the default, (c) as the cinematic option. Smoothness, real-turn handoff and phone framing not checked (headless stills only). `?debug&play&tvshot&tvcam=…&freezeat=`.

### E15 notes
- `clinchedOnGround` in rules.js: when exactly one team has boules in hand and holds points on the ground reaching the target, `throwSettled` ends the mène through the normal scoring; a team out of boules that holds the point doesn't end it early. main.js and the AI needed no change (no turn is asked for after the phase ends). Four new tests.

### E17 Round 4 review (sonnet)
Tests, build, integration across modes (quick vs slow on every flow), screenshots, bug review, and a "Round 4 remaining issues" list.

## Round 4 remaining issues

E17 review (2026-11-08). Fixed in the review:
- Pierre's stance is picked once per throw (the slow-mode walk-to-circle step passes it on to the turn's own `enterCircle`).
- The jack chevron is switched off at once at the start of every AI turn and on a new game, and fades out in 0.25 s on release; it shows only during the human's boule aim.
- The default head camera is wider (min half-width 0.9 m, distance 2.4 m); the who-throws card view lifts the subject above the card. The mène-end close-up keeps its own tight framing.
- Close calls: the scoring circle radius is now computed after the debug close-call shift (a stale radius made it about 1 m across; real mènes were consistent), a tiny circle gets a thin edge line (never inflated), and number badges sit beside their boules (turned aside from the jack, other boules and each other) so every scoring boule stays visible.
- The mène-end camera cuts at once (`now`) instead of queuing behind a TV shot's hold (up to 2.2 s).
- Missing imports in main.js (`whoKind`, `composeSuggestion`) made Pierre's suggestion throw "not defined" at the who-throws card; fixed (the card now shows his line).
- `?debug&autotest` stalled in a mène when the AI placed a jack (the placed jack's drop was never simulated in instant mode); it now settles synchronously. `&mene2&jackplace` shows the placement toward y = 0. The placement zone fill is a little stronger.
- New `court-match.test.js` (E24): seeded full AI matches (4 seeds, 42 mènes, both directions) check every thrown or placed jack is valid and 6 to 10 m from the current circle and ahead of it, and that the rules, AI and court agree on circle and direction. E25 (placement view frames the whole 6-10 m zone string to string, also toward y = 0) and E26 (flight, TV and observer cameras behind the play at dir -1, covered by camera tests) were checked in screenshots and tests. The fullscreen and pause icons sit bottom right and overlapped nothing in normal play at 1200x800 and 500x900.

Not done or not verified:
- Headless Chrome renders few frames, so no walking, carrying, fading or camera motion was seen in motion: walk to the circle, the ring carry and its E28 correction, the held-boule pick-up, the quick-mode changeover fades, the observer and TV cameras, and pause freezing mid-walk are verified by code reading, tests and stills only. New game / Play again reset the court to (2, 1), +y, clear held boules, opacities and the chevron (code), but not in a running browser.
- The mène-end card still covers the lowest scoring boule in tall boards; the debug `&closecall` forces a rival that contradicts the scoring set, so its circle is only a layout check.
- The debug fetch scene still shows the old teammate hand-over; the head view of a tight mène end on a phone was not checked in landscape.
- `aimView()` at a jack-out mène end is not forced to cut ahead of a TV hold.

A human should play-test:
- Slow against Quick: pace, whether walking to the circle and fetching feel too slow, and what a reasonable walking speed is.
- The observer camera in Slow mode (framing, pan and dolly speed, whether it ever loses the action) and the TV variants a, b and c in Quick mode (which is best, smoothness, the hand-off to your turn).
- Holding the boules (pick-up, hands, the palm-up quick toss) and the team colour of the held boules.
- The ring carry, the E28 move back, and the quick-mode ring fade at a mène's start.
- The close-call view: top-down framing, mm labels, badge placement, and whether the card hides anything on a phone.
- The head camera at the who-throws card and between throws; the placement view on a phone; pause and resume in the middle of a walk; New game after a long game.

---

# Round 5 backlog

From the user's play-testing (2026-11-08). Earlier contracts and shared-repo rules still apply.

| ID | Status | Model | Deps | Title |
|---|---|---|---|---|
| F34 | review | haiku | F25 | String lines partly buried in the ground (implemented; steep seeds unverified) |
| F35 | todo | haiku | F32 | Drop the "tir" label: always name the throw by loft |
| F33 | todo | sonnet | F04 | Nobody crouches for throws over 7.5 m |
| F32 | in-progress | sonnet | — | Simplified in-game controls: always-on roll guide, icon cluster, hamburger menu, minimal pause screen |
| F31 | done | haiku | — | Cap reported scores at the game target (13) |
| F30 | done | haiku | F29 | Landing button: plane lands in the background, no camera change |
| F29 | done (temporary) | haiku | F19 | Temporary button to trigger a floatplane landing (remove later) |
| F01 | done | sonnet | — | Sports-broadcast follow camera for the roving view |
| F02 | done | sonnet | F07 | After a mène, players collect their boules from the head and walk to their spots |
| F03 | done | sonnet | — | Teams keep roles (pointer and shooter) instead of alternating throwers |
| F04 | done | sonnet | F03 | Tactics expansion: design done (GAME-PLAN §12.12, decisions recorded); step 2 implement |
| F05 | done | sonnet | — | Slope and firmness fields tuned, plus an optional "Read the ground" analysis view |
| F06 | done | haiku | — | Surface-to-surface measuring: circle to the rival boule's near edge, all distances to 0.1 cm |
| F07 | done | sonnet | — | Last thrower picks up the ring straight away and carries it toward the jack |
| F08 | done | haiku | — | Tree shadows cut off at the edge of the inner grass |
| F09 | done | haiku | — | Remove the white halo around the cochonnet |
| F10 | done | sonnet | F07 | Cochonnet out of bounds: next ring goes at its last in-bounds spot |
| F11 | done | haiku | — | "Who holds the point" overlay before each throw |
| F12 | done | sonnet | — | Ambient park sounds with stereo movement |
| F13 | done | haiku | — | Dead-jack void message gives the wrong reason |
| F14 | done | sonnet | F02 | Simultaneous boule gathering with collision avoidance and a 20 s fallback |
| F15 | done | sonnet | F14 | Gathering follow-up: walk straight to next-mène spots, confirm the 20 s fallback |
| F16 | todo | sonnet | F04, F15, F17, F18, F19, F20, F21, F22, F23, F24, F25, F26, F27, F28, F31, F32, F33, F34 | Round 5 review |
| F26 | done | haiku | — | Slow mode: brisker fetch walks with natural arm swing (or folded arms) |
| F27 | todo | sonnet | F04 | Pierre does what he said he'd do |
| F28 | in-progress (step 2) | sonnet | F26 | Better end-of-mène boule collection: design done (GAME-PLAN §10c, decisions recorded); implementing |
| F17 | done | haiku | — | Remove "lands at …" landing-distance text from the status line |
| F18 | done | haiku | — | Breeze only occasionally, fading in and out |
| F19 | done | sonnet | — | Distant lake with an occasional floatplane taking off or landing |
| F20 | done | sonnet | — | Better hands, relaxed arms while holding boules, richer idle animation |
| F21 | done | haiku | — | Remove the coloured team rings around boules |
| F22 | done | sonnet | — | Mène-end card never hides the scoring circle or its labels |
| F23 | todo | sonnet | F04, F25 | Rebalance: Pierre strong and well-rounded (prefers shooting); Medium opponents beatable |
| F24 | done | sonnet | — | Bug: in quick mode the circle isn't placed at the start of a new mène |
| F25 | done | sonnet | — | Court shapes: broad, readable slopes (tilt, hills, ridges, basins) instead of noise |

### F01 Sports-broadcast follow camera (sonnet)
**User approval (2026-11-08):** the current camera (as of commit cf14495: the E11 slow-mode observer and the E27 TV-style shots, with the E32 mène-end view) is good. Treat it as the approved baseline. F01 and any later camera experiments must keep this behaviour available as a selectable camera style (and the default unless the user says otherwise), never replace it outright, and be compared against it.
The user likes the roving (observer/TV) camera and wants it to cut like a sports broadcast when action happens:
1. **Before the throw:** cut or pan to a full-body (at least waist-up) shot of the player getting ready, in the circle, holding the boule.
2. **The throw:** hold on the player through the swing and release.
3. **The flight:** cut to a camera that shows the cochonnet, then pan to bring the incoming boule into view as it lands and rolls.
4. **After it stops:** hover there for 1–2 s on the head (boule and jack).
5. **Reaction:** cut to a player reaction: the thrower, their partner, or an opponent, chosen by outcome (good point → thrower or partner celebrating; a point taken from the other side → an opponent's dismay; a miss → the thrower).

Build it as a shot sequencer on top of the E11/E27 camera styles (pure framing helpers in camera.js plus a small director that schedules shots on the game clock), used for AI turns in both modes and for the post-throw part of the human's turn (the human's aim stays in the shoulder view). Cuts may be instant; moves within a shot are smooth. Works in both directions, respects reduced motion (fewer cuts, no fast pans) and pause. Screenshots or freeze-frames of each shot.

### F02 After a mène: collect boules and walk to spots (sonnet)
In slow mode, after the mène-end result, players take turns walking to the head to pick up their own boules (each player's three, from wherever they lie on the court; a dead boule from the row past the far string), then walk to their spots for the next mène: the next jack thrower to the new circle (after the ring is placed, E10/E28), and the others to their waiting spots (E02) or the circle in turn. They hold their boules (E16) as they walk. Turns should be quick and natural: two or three players can be moving at once, but not bumping. Quick mode: boules and players fade to their places. Skippable with a click or key. Uses the pause clock.

### F03 Teams keep roles (sonnet)
Teams shouldn't simply alternate who throws. Each team has a pointer and a shooter (Marcel pointer and Odette shooter; on your team the human and Pierre per the chooser). The AI team picks the pointer for pointing situations and the shooter for shooting situations, switching only when needed: when the preferred player is out of boules, or tactics strongly favour the other (the shooter can point when needed and the pointer can shoot when needed, but they tend to stick to their role). Tie this into tactics.js `whoThrows` and the role skills (D16/D22), and into Pierre's suggestion for the human team. Measure that throw allocation follows roles in AI-vs-AI matches (e.g. Odette takes most shots, Marcel most points) without hurting balance.

### F04 Tactics expansion (sonnet)
Step 1, design (extend GAME-PLAN §12, shown to the user before implementing), adding scenarios and decision rules for:
- **Pointing vs shooting:** refine when each pays, by distance, boules in hand and score.
- **Promotion:** deliberately striking your own boule to push it closer to the cochonnet (or onto it), when a gentle hit improves your position more than a new point would.
- **Defensive play:** when the other team has more boules to throw, limit their chances to score more, e.g. block the approach line, place a boule just behind the jack to cover a shot jack, keep boules spread, and avoid leaving easy targets.
- **The deliberate short drop:** in rare end-of-mène cases, throwing a boule intentionally very short (essentially dropping it) is right, to avoid any risk of giving away the point (e.g. you hold the point, it's your last boule, any real throw risks disturbing the head, and the opponent has no boules left).

Each with a scenario test (fixed court, expected decision and why). Step 2: implement in tactics.js and ai.js (new candidate families: `promote`, `block`/`cover`, `drop`), with reason codes and commentary lines, keeping decision time within budget and the D22 balance. Depends on F03 (roles).

### F05 Slope and firmness fields, plus a "Read the ground" view (sonnet)
What exists: terrain.js already generates, per game seed, a smooth macro height field (±4.5 cm over metres, which drives rolling drift) and a looseness map (0..1) that sets landing restitution (0.15–0.3), landing dig and rolling resistance (μr 0.14–0.28). Physics terms: the bounce is the coefficient of restitution; softness is compliance (its inverse, firmness). Call the combined map **firmness** in the UI.
- **Tune the slopes:** make the slope field explicit and controllable. A few gentle undulations with local gradients up to about 1–2° (≈ 1.7–3.5 cm per metre), generated at the start of each game, so boules visibly tend to drift left, right or up and down the tiny hills. Expose the amplitude in constants.js. Re-run the measure scripts and keep the AI's perceived terrain consistent (it already reads the large-scale height).
- **Firmness field:** keep the looseness map but name it firmness (hard ↔ soft). Make it vary meaningfully across the court (patches of hard pack and soft, loose gravel), affecting restitution, landing dig and rolling resistance as now.
- **"Read the ground" view:** a toggle for the human player only, available during their turn. It overlays an animated visualisation on the court:
  - slope gradients: flowing particles or animated arrows moving downhill, with speed showing steepness;
  - firmness: a colour wash (e.g. warm = soft and absorbent, cool = hard and lively), with a small legend.
  
  It simulates a player walking up to study the terrain.
- **Performance:** the view is off by default and costs nothing when off. Particles are instanced and capped (fewer on phones). The overlay texture is computed once per game (plus divots if cheap). Add a setting to disable it entirely on slow devices.
- Tests for the slope field (max gradient within the configured range, smoothness) and screenshots of the view.

### F06 Surface-to-surface measuring (haiku)
Measurements are about surfaces, not centres:
- **Distances:** every displayed distance (between-throw lines, mène-end labels, card text, status lines) is the edge-to-edge gap between the cochonnet's surface and the boule's surface (centre distance − jack radius − boule radius), always shown to one decimal: "18.3 cm".
- **Scoring circle:** centred on the cochonnet's centre, with radius reaching the near edge of the losing team's best boule (centre distance − boule radius), so the circle line touches that boule's near surface rather than passing through its centre. Scoring boules lie inside.
- **Measuring lines:** the D07 lines run from the jack's surface to the boule's near surface.
- **Scoring:** the ranking itself is unchanged (all boules share one radius, so centre and edge order agree), but compute and display the gap with the same helper everywhere.

Update `edgeCm`/`gapText`, `showScoring` and `showBetween` in main.js and render.js, and remove E32's "mm only on close calls" rule in favour of always one decimal. Check with a mène-end screenshot.

### F07 Last thrower brings the ring (sonnet)
Slow mode. Today, after the mène ends, the last thrower walks back to the old circle later to pick up the ring (E10). Instead: after the last boule of the mène is thrown, the thrower stays in the circle until it stops; then picks up the ring right there (they're standing in it) and walks with it to about 1 m from the cochonnet (on the circle's side of the jack), where they wait holding it while the mène is scored. When the next mène starts, they set the ring down around the jack's position (with the E28 correction if needed: pick up again and walk it back). Fits with F02 (others collecting boules meanwhile). Quick mode unchanged. Uses the pause clock; skippable.

### F08 Tree shadows cut off (haiku)
Tree shadows show on the inner grass near the court but stop at its edge and don't appear on the wider field. Likely causes: the sun's shadow camera frustum is fitted tightly around the court (for sharp boule and character shadows), so shadows outside it aren't rendered; and/or the large outer grass plane (D15, 600 m) has `receiveShadow` off. Fix without blurring the important near shadows: e.g. enlarge or refit the frustum to include the trees and their shadows (they're within ~15 m), raise the shadow map size moderately on desktop only, or use a second cheap shadow source / baked blob shadows for the trees on the far field. Make sure the outer plane receives shadows. Check performance on phones and compare screenshots before and after.

### F09 Remove the cochonnet halo (haiku)
Remove D04's ground halo (the cream/white ring around the jack shown in the head view) entirely: the mesh, its material, its update and fade logic, and the `b` option of `?debug&jackvis`. Keep the orange jack and the D17 arrow behaviour unchanged.

### F10 Cochonnet out of bounds: ring at its last in-bounds spot (sonnet)
When the cochonnet goes out of bounds during a mène (dead jack), the next mène's ring goes at the jack's last position in bounds, i.e. where it crossed the string (physics already records `outX`/`outY`; make sure that's the last in-bounds point, clamped just inside the lines), not where the ghost jack came to rest. Then apply E10's legal-circle clamp and E28's room correction as usual.
In slow mode: after the mène is scored, the idle player closest to the dead jack walks to it (around the outside of the timbers if it's out there, E02 routing), picks it up and sets it down at that last in-bounds spot, so the player carrying the ring (F07) brings the ring there and places it around it. Quick mode: the jack and ring simply appear at the spot. Tests: the next circle is centred near the crossing point for jacks that went out over each side and the end string.

### F06 notes
- `gapM`/`fmtCm` in rules.js (surface gap; one decimal, "1.8 m" above 1 m) used for every displayed distance (labels, card, status, tactics suggestion text); the scoring circle radius = rival centre distance − boule radius, so its line touches the rival's near surface; no rival → furthest scoring far edge + 0.07 m; "Close call!" kept for < 2 cm. A scoring boule can straddle the line (its near surface is inside). Committed with the next combined commit.

### F08 / F09 notes
- F09: halo mesh, material, update/fade and the `b`/headRing jackvis options removed (`jackvis` now a|c).
- F08: the sun shadow box was a fixed ±5 m around the look target and its bounds were never applied (no `updateProjectionMatrix()`); now desktop 2048 map over ±14 m, phones 1024 over ±10 m, 60 m depth range with rescaled bias. The outer plane already received shadows. The box still follows the look target, so very wide views can lose far shadows; the outer-field result wasn't clearly confirmed in screenshots: check by eye. Committed with the next combined commit.

### F11 "Who holds the point" overlay (haiku)
Before each throw (human or AI, once the previous throw has settled and before the next aim starts), if a team holds the point, show a short overlay near the top of the screen, below the scoreboard: e.g. "Marcel & Odette are holding 2" / "You & Pierre are holding 1", with the team's colour accent. The number is how many of that team's live boules are closer to the jack than the other team's best (`meneResult`/`holdingTeam` on the current ground). If no team holds (no boules yet, tie, dead jack), show nothing. It fades in, stays ~2 s (or until aiming starts), and fades out; instant under reduced motion; frozen while paused; aria-live polite text for screen readers. It must not cover the scoreboard or the court centre. hud.js plus a small hook in main.js; check with a screenshot.

### F05 notes
- `slopeMaxDeg` 1.5 (clamped 1–2, `slopeLimitDeg` 2): terrain.js rescales the macro field per seed so the steepest local gradient near the court equals it (seeds measured 1.32–1.50°, previously 1.6–2.1°); `sample()` also returns `firm = 1 − loose`; physics unchanged; AI planning unchanged (measure-throws mean short 0.39/0.28/0.05 m). `groundview.js`: firmness wash (orange soft ↔ grey/blue hard) on a court overlay, up to 220 instanced downhill arrows (90 on phones, static lattice under reduced motion, frozen when paused), legend; built on first use; "Read the ground" button on the human's turn only; `localStorage petanque-groundview=off` disables it; `&groundview` forces it. Terrain tests added. Committed with the next combined commit.

### F01 notes
- New selectable `'broadcast'` style (default and observer/tv/game unchanged): `director.js` schedules prep (full body from the front, slow push-in), throw (side-on, AI only), flight (from beyond the jack looking back, panning to the incoming boule; jack throws use TV 'a'), head hover 1–2 s, outcome-based reaction cut. Reduced motion: no throw/reaction cuts, slower pans. Game-clock scheduling (pause freezes). Next turn waits ~2.5–3.5 s in this style. `?debug&cam=broadcast` or `localStorage petanque-camstyle=broadcast`; `?bshot=prep|throw|reaction|head`. Not seen in a live match. Committed with the next combined commit.

### F07 notes
- Slow mode: `startRingPickup()` at mène end (not on game over): the last thrower waits ~0.9 s, picks up the ring, walks to 1 m from the jack on the circle's side and holds it; `gather()` skips them. `nextMene` waits for that, sets the ring down at `nc.placed`, re-carries for E28. Old walk-back path removed. Hooks: `ringJackSpot()` (F10), `ringTask` (F02). Debug `?debug&mene2&ringcarry&slow&f07` (`&f07=held` still). Not seen animated. Committed with the next combined commit.

### F12 Ambient park sounds (sonnet)
A quiet, synthesized (no audio files) park soundscape under the game sounds, in audio.js or a new ambient.js:
- **Birds:** occasional chirps and short phrases from a few synthesized species (different pitch contours and rhythms), each at a random stereo position (StereoPannerNode, −0.9…0.9) and distance (level and a touch of low-pass), with irregular gaps; sometimes a call and an answer from the other side.
- **Breeze:** soft filtered noise swells that slowly rise and fall, panning gently across the field; occasional leaf-rustle bursts.
- **Distant airplane:** every few minutes, a low, muffled broadband rumble that fades in, pans slowly from one side to the other over ~20–30 s (with a slight Doppler pitch drift), and fades out.
- **Optional:** faint distant city hum or a far-off dog bark, very rarely.

Very low overall level (well under the boule sounds), its own volume control or toggle ("Ambience" on/off, remembered in localStorage), off when muted, paused with the game (pause clock / suspend), started only after a user gesture. Keep CPU low: schedule events ahead on the audio clock, reuse noise buffers, cap voices. Add audition buttons to the `?debug&sounds` drawer (bird, breeze, plane).

### F02 notes
- Slow mode: 2.6 s after the result, every player except the F07 ring carrier walks to their own boules (nearest first; dead ones round the timbers), staggered 1.3 s, avoiding each other; pick-ups grow held counts; then `nextMene` sends all but the next jack thrower to slots behind the new circle. `resetCast` no longer teleports or clears held boules; `collectBoules` skips players already holding. Click/key skips to the end state. Quick mode: fades. `&f02&f02at=`. Gaps: the ring carrier and jack thrower use the mène-start pick-up; `walkToSpots` copies `beginMene`'s thrower selection (keep in sync with F03). Quick mode and skip not tried. Committed with the next combined commit.

### F10 notes
- physics.js records each live body's last in-bounds centre (`lastInBounds()`, clamped `OUT_INSET` 2 cm inside the lines) as `outX`/`outY` when it dies; `snapshot()` gives a dead jack a `spot`; rules `nextMene` and `ringJackSpot()` build the circle from it. Slow mode `startJackReturn()`: the idle player nearest the dead jack (not the ring holder) fetches it round the timbers and sets it at the spot; the ring holder waits on `jackTask`; F02 collection skips the jack meanwhile. Quick mode: the ring just appears there. Tests in physics and court; ai.test.js out-of-bounds rest tolerances widened (1.8 m far end, 0.95 m side): review in the round 5 review. Committed with the next combined commit.

### F11 notes
- hud.js `showHolding(text, team)`/`hideHolding()` (aria-live polite, team accent); absolutely positioned under the controls bar (an early grid version squeezed phone layouts); fades via a class, instant under reduced motion, sepia when paused; shown in onSettled after a boule from `holdingTeam`/`meneResult`, hidden after 2 s of game clock or when aiming starts. `&holding` debug. Committed with the next combined commit.

### F12 notes
- `ambient.js` (all numbers in `AMBIENT`): four bird species (chirp, trill, two-note whistle, warble) at random pan ±0.9 and distance (level + low-pass), gaps 3–22 s with occasional lulls, 35% answered from the other side, ≤ 4 voices; breeze = looped band-passed noise with swells every 4–9 s and slow pan, leaf rustle every 14–40 s; airplane every 2–5 min, low-passed rumble + faint falling tone panning across over 22–30 s. Own gain 0.10 into the master bus. "Ambience" toggle (`petanque-ambience`, default on), silent when muted, suspended with the pause, starts after unlock. Audition buttons in `?debug&sounds`. Dog bark and city hum skipped. Not heard yet. Committed with the next combined commit.

### F13 Dead-jack void message gives the wrong reason (haiku)
main.js (~line 2021, the void-mène note in endOfMene) always says "The cochonnet went out of bounds, so it is dead … and neither side has boules left: mène void." whenever the jack is dead. By the rules (rules.js endMene) a dead jack voids the mène when both teams still hold boules, or when neither does; if only one team holds boules, that team scores them (not a void). Make the message state the actual case from the boules in hand at that moment: "The cochonnet went out: both teams still have boules, so the mène is void." / "… neither team has boules left, so the mène is void." Also check the non-void dead-jack case reads right (e.g. "The cochonnet went out with only Marcel & Odette holding boules: they score 2."). Add a small test of the message builder (pure helper) for all three cases.

### F03 notes
- `whoThrows` decides the favoured action, then gives the role player a stickiness bonus (`ROLE_STICK`: Marcel 0.8, Odette 1.0, Pierre 0.9, human seat 0.8; `SHOOT_LEAN` 0.3); the other player throws only when clearly better or the role player is out of boules; close calls go to the role player (no alternating); returns `action`. Medium, 40 matches: shooter's share of shots 71/70% → 74/76%, pointer's share of points (while holding boules) 61/55% → 80/74%; balance unchanged (AI v AI 70 → 68%, vs pointer 48 → 50%). Shot share caps near 75% because the pointer's own plan sometimes shoots after a team-level "point" call (ai.js, left alone).

### F14 Simultaneous boule gathering (sonnet)
Replaces F02's staggered turns. After the mène-end result, all players (except while busy with the ring F07 or the dead jack F10, who join when free) start at once: each walks to their own boules (nearest first), bends and picks each up, then walks to their goal spot for the next mène (the next jack thrower to the new circle, others to waiting slots).
- **Collision avoidance:** simple local steering, e.g. each step, separation from other players within ~0.8 m (a repulsive push sideways), slowing when someone is directly ahead, and waiting briefly if a target boule is being picked up by someone else. Keep it cheap (4 agents) and deterministic enough for tests.
- **Deadlock fallback:** if the whole process hasn't finished after 20 s of game time, any boules still on the ground go straight into their owners' hands (`setHeldBoules`), and everyone walks (or, if blocked, fades) to their goal spot.
- **Skip and modes:** click/key still skips to the end state; quick mode unchanged (fades); pause clock; instant/autotest instant.
- **Tests:** a pure steering step keeps agents ≥ ~0.5 m apart in a crowded scenario; the fallback fires and completes at 20 s; nobody walks across a boule being picked up.

### F13 notes
- `endMene` stores `inHand` at the jack's death; `deadJackText(inHand, teamNames)` gives the void-both, void-neither or one-team-scores sentence; used in endOfMene. Three tests.

### F14 notes
- `crowd.js` (`steer()`: seek + sideways push within 0.8 m + slow behind someone ahead; `createGather()` model; `GATHER_TIMEOUT` 20 s, `BLOCK_FADE_S` 2 s, `MIN_GAP` 0.5 m), character `setSteer`/`walkLeg`, main.js F02 section now starts everyone at once with per-frame steering, waits ≤ 6 s for someone bending at their boule, fallback `giveBoules` at 20 s, steered goal walks that fade if blocked > 2 s. crowd.test.js (7).
- **Gaps for F15:** goal walks only start at `nextMene` (goals depend on the new circle), so after picking up players stand around until then, and the fallback leaves them overlapping; in the 25 s screenshot one player still had boules on the ground, so the 20 s fallback may not fire in the real scene. Quick mode and skip not tried.

### F15 Gathering follow-up (sonnet)
Fix the F14 gaps: (1) once a player has their boules, they walk straight to their next-mène spot (compute the new circle and slots as soon as the mène result is known, so goals don't wait for `nextMene`); (2) confirm in the real scene that the 20 s fallback fires (the F14 screenshot at 25 s still showed boules on the ground) and that nobody is left overlapping (separate or fade); (3) try quick mode and click-skip. Tests for the earlier goal timing; screenshots at a few times.

### F16 Round 5 review (sonnet)
Tests, build, full-match test, integration across modes and directions for all round 5 features (broadcast camera, gathering, roles, terrain view, measuring, ring carry, dead-jack ring spot, holding banner, ambience, tactics expansion), README update, screenshots, and a "Round 5 remaining issues" list.

### F15 notes
- `planGoals()` in crowd.js and `planNext()` in main.js compute the next circle, jack thrower and slots as soon as the result is known; players walk straight to the nearest free slot after their last pick-up (steered, fade if blocked 2 s); the next jack thrower waits for the ring (`plan.ringDown`). The 25 s screenshot: Marcel was the ring carrier (collects after `nextMene`, by design) and the fallback had frozen players already walking; `fallbackFor` now skips those. Skip puts free players at their slots. Debug `&f02next=N`, `&f02skip=N`. Tests for early goals and a crowded fallback. Full match with real clicks not run.

### F17 Remove the landing-distance status (haiku)
The status/commentary shows where a throw is planned to land, e.g. "Marcel points a demi-portée (lands at 4.4 m)" and "Marcel throws the cochonnet (lands at 6.1 m, should roll to about 7.2 m)". Remove the landing (and "should roll to") distances from these lines everywhere (AI spot text, jack throw text, spotText/labels in main.js and any in ai.js/personalities.js); keep the rest of the line (who, which throw, the personality quote). Results after the throw (e.g. "Jack is 7.3 m out", "18.3 cm from the jack") stay.

### F17 notes
- `spotText` no longer adds "(lands at … m[, should roll to about … m])"; unused `solveLaunch`/`predictRoll` imports dropped. "Max reach" hint and post-throw results unchanged.

### F18 Breeze only occasionally (haiku)
The F12 breeze plays continuously. Make it occasional: silence most of the time, then a gust that fades in over a few seconds, lasts ~6–20 s with its gentle swells, and fades out; gaps of ~30–90 s between gusts (random). Leaf rustles only during a gust. Tunables in `AMBIENT.breeze` (gap, duration, fade times). Keep the audition button (plays one gust).

### F18 notes
- Breeze runs through a gust envelope (0 between gusts): `AMBIENT.breeze` first [10,40] s, gap [30,90] s, duration [6,20] s, fadeIn [3,5] s, fadeOut [4,6] s; swells and rustles only during a gust; audition plays one gust. Not heard in a browser.

### F19 Distant lake and floatplane (sonnet)
A Lake Union touch: a lake in the distance down-court (between the field and the skyline/Rainier panorama), with an occasional floatplane.
- **Lake:** a large flat water plane far beyond the trees (visible from the shoulder view below the skyline), with a simple animated water look (subtle moving normal or colour shimmer, sky-tinted, a faint shoreline), matched to the fog/haze. Cheap: one plane, small shader or animated texture.
- **Floatplane:** a low-poly prop plane on floats (single high wing, white/red), about once per full game at a random time: either takes off (taxi, accelerate along the water with a small spray trail, lift off and climb away into the distance) or lands (descends from the distance, touches down with spray, slows). Small and far away but readable; propeller spin hinted.
- **Sound:** a synthesized single-engine prop drone (a buzzing tone with harmonics and a little rasp) panning with the plane's screen position, rising and falling with distance (and higher revs during take-off), mixed under the game sounds via the ambience bus (respects the Ambience toggle, mute and pause).
- Debug: `?debug&floatplane=takeoff|landing` to trigger it now, plus a camera framing it; audition button for the engine sound. Freeze with the pause clock; no per-frame allocation.

### F20 Hands, relaxed arms, idle animation (sonnet)
- **Hands:** E16's mitten hands read like raised middle fingers. Redesign them so they read as hands at this scale: a palm with a thumb and a suggestion of fingers (e.g. a flattened palm box plus a short thumb capsule, fingers as one rounded block or 2–4 short capsules), still cheap, with the palm-roll from E16 and held boules sitting in the palm. Check from the shoulder, observer and broadcast close-ups.
- **Arms while holding:** standing around holding boules, arms should hang relaxed at the sides (boules cupped at the hip) or sit akimbo (hands on hips), not held out in a carry pose. E16's `heldArms()` forces the carry pose; replace it with a relaxed hold and switch to the carry pose only while walking briskly. Personality: Marcel tends to akimbo, Odette arms by her sides or folded with boules, Pierre fidgets.
- **Idle animation:** while waiting or watching, everyone moves a little all the time (breathing, weight shifts, small head turns tracking play, an occasional step) and, now and then, an interesting gesture: checking the boules in hand, wiping a boule on the trousers, shading the eyes to look at the head, a shrug, chatting gestures toward a teammate, tossing a boule from hand to hand (Pierre). Randomised timing per character, never in sync; respect reduced motion (subtler) and pause. Build on character.js's existing quirks (C12) without breaking release-point accuracy or tests.
- Screenshots of the new hands close up and of idle poses.

### F21 Remove the coloured team rings around boules (haiku)
Remove the navy/orange team rings drawn on the ground around each boule (from B06's head-view rings, also visible at mène end and in the overhead views), and the white rival ring added in D07/E22. Teams stay distinguishable by the boules' own steel/bronze look. Keep the mène-end scoring circle, numbered badges and distance labels. render.js only; check with a mène-end screenshot.

### F21 notes
- Team ring geometry, materials, per-boule meshes and visibility toggles removed from render.js; the two rival ring meshes removed from `showScoring`. For F16: in the mène-end screenshot the rival boule's distance label sat behind the result card; keep labels clear of the card. Committed with the next render.js commit.

### F19 notes
- scenery.js `makeLake`: shader water ~42 m down-court into the fog (sky shimmer, shallow band, faint foam shoreline; frozen when paused/reduced motion). floatplane.js: low-poly white/red floatplane, keyframed takeoff (taxi, spray, lift-off, climb) or landing (descend, touchdown spray, slow, taxi off), random side, once per match at 25–75% of 900 s game time, skipped under reduced motion; 150-point spray pool. ambient.js engine (sawtooth + octave + sub-square, low-pass, rasp, tremolo, revs with throttle, panned and distance-filtered on the ambience bus). `?debug&floatplane=takeoff|landing` (`&fpat`, `&fpmirror`, `&fpcam=0`); audition button. Engine not heard. On the desktop shoulder view the lake and plane sit just under the top HUD.

### F20 notes
- Hands: palm + angled thumb + three finger capsules (curl when holding; mirrored for Odette). Relaxed holds (sides / akimbo / folded / fidget per personality, drifting every 13 s; carry pose only while walking). Idle micro-motion and irregular gestures (check boules, wipe a boule, shade eyes, shrug, chat, Pierre's hand-to-hand toss); reduced motion scales it down; frozen at dt 0. Four new character tests. The `quirks.hold` field in personalities.js commits with F04 (shared file); character.js falls back to defaults until then.

### F22 Mène-end card never hides the scoring view (sonnet)
The result card ("Marcel & Odette score 3 points") can cover boules, badges or distance labels around the scoring circle. Fix it from both sides:
- **Camera:** measure the card's on-screen rect (and the top HUD) after it's shown, and frame the circle plus every label and badge into the remaining visible area (offset the camera target and adjust distance so the content's projected bounds fit the free region with a margin), in both the top-down (E32) and the observer/broadcast end views.
- **Card:** make it compact: a slim bar along the bottom on wide screens (headline + one line of detail + the Next mène button inline), a smaller card on phones, optionally collapsible ("details" toggle) and semi-transparent. Never covers the circle centre.
- **Labels:** the label placement (E32) treats the card rect as an obstacle.
- Check with mène-end screenshots for small, medium and very large circles (1 vs 4+ scoring boules), at 1200×800, 500×900 and 844×390.

### F23 Rebalance Pierre and Medium (sonnet)
User play-testing: Pierre (your partner) plays badly, and Marcel and Odette are both great pointers, so even Medium is hard to beat.
- **Pierre:** a strong, well-rounded player with a preference for shooting: pointing accuracy close to Marcel's, shooting close to Odette's (slightly below each specialist), good tactical sense, his shoot-leaning appetite kept but not reckless. Check his SKILL, role stickiness, appetite, tactical error rate and any personality penalties.
- **Opponents:** Marcel is the pointer, Odette the shooter; Odette's pointing should be clearly weaker than Marcel's, not "great". Re-tune per difficulty so a reasonable human with a strong Pierre wins roughly: Easy ~85–90% (very winnable), Medium ~45–55%, Hard ~25–40% (measure with a scripted human using the roll guide plus the real Pierre AI as partner, ≥ 100 matches per row on a quiet machine).
- Report the before/after accuracy tables per player and difficulty, and win rates. Runs after F04 (tactics expansion), since both touch ai.js/tactics.js balance.

### F24 Bug: quick mode doesn't place the circle at a new mène (sonnet)
User report: in quick mode the circle (ring) isn't placed at the beginning of a new mène. Expected (E10): at the start of the next jack throw the ring appears (short fade) at the new spot around the last jack (or F10's dead-jack spot), with the E28 room correction, and the thrower stands in it. Likely regression from F02/F07/F10/F14/F15 rewiring the mène transition around slow mode (ring carry, `ringTask`, `plan.ringDown`, `walkToSpots`) that left the quick-mode path without a ring move or with the court state not updated. Fix the quick path; make sure the court module (circle, dir), the ring mesh, the rules geometry and the camera all move together; add a test (pure where possible) that after `nextMene` in quick mode the court circle equals `nextCircle(...)` and the ring mesh position matches; check the slow path still works.

### F22 notes
- Card: slim bottom bar on wide screens (headline + 2-line detail + inline Next mène), compact stacked card under 34rem. render.js `fitScoring(measure)`: frames circle, boules, badges and labels into the area left by the scoreboard, controls and card (top-down, el 1.38, re-fits on resize); the card rect is an obstacle for label placement. `?debug&play&mescenario=small|big|close`.
- For F16: in the big-scenario screenshot badge 1 had no distance label and the jack wasn't visible (hidden under boule 1?); the first-time hint text showed faintly behind the bar; the in-turn controls (Adjust view, Roll guide…) stay visible at mène end; on phones the fullscreen/pause icons overlap the card's corner; the close-call circle is small on screen. Committed with F24 (shared main.js).

### F25 Court shapes: broad, readable slopes (sonnet)
The F05 slope field reads as noise. Real courts have a few broad features players all notice: an overall tilt (uphill one way, downhill the other), a left-to-right lean, one or two gentle hills, a ridge running across or along, a shallow basin. Replace the macro height field with a composition of broad features, scaled so the steepest local gradient stays within F05's range (1–2°):
- **Court archetypes**, picked per game seed with weights: e.g. "tilted" (a plane: uphill along y and/or a side lean), "ridge" (an elongated Gaussian ridge across or along the court), "basin" (a broad shallow bowl), "two hills" (1–2 broad Gaussian bumps), "saddle", combined (e.g. tilt + a hill). Feature widths of several metres (3–10 m), so slopes are coherent over the whole head area.
- **Fine variation:** a small low-frequency fBm (Perlin/simplex, 2 octaves, low amplitude) for naturalness, kept well below the broad features. Approaches to borrow from: Gaussian-hill / "hill algorithm" terrain generators, low-octave fBm, radial basis functions, at this subtle scale.
- **Rescaling:** the whole field is scaled so the max gradient near the court ≈ `slopeMaxDeg` (F05), and the dominant feature accounts for most of the slope (e.g. the shape's own gradient ≥ ~70% of the total over the court).
- **Telling the player:** expose the chosen archetype and its main direction (e.g. "court slopes downhill toward the far end and to the left"), shown subtly in the F05 Read-the-ground legend, and maybe a line of Pierre or Marcel commentary at the first mène ("Watch it, it all runs left here").
- **Consistency:** keep `perceived()` consistent (the AI sees the same broad shape), re-run measure-throws briefly, and keep divots and firmness untouched.
- **Tests:** each archetype's gradient field is coherent (the gradient direction varies slowly: e.g. average angular change between neighbouring cells below a threshold), max gradient within range, the dominant-feature share holds, deterministic per seed. Screenshots of the Read-the-ground view for a few archetypes.

### F24 notes
- Cause: the slow-mode carry ends with `renderer.setRingPose({...})`, which set `ringHeld = true` forever, so later `syncCourt`/`tickRing` never moved the ring (quick mode after any slow carry, or a new game). Fix: `applyCourt` releases the ring (`setRingPose(null)`) when nobody is carrying it. Court-state test added; the renderer flag itself isn't testable in Node. Not run through a real slow-then-quick session.

### F26 Brisker, more natural walking (haiku)
- **Pace:** in slow mode, walks to pick up or fetch boules (F02/F14 gathering, E02/F10 retrievals) use the same brisk pace as walking to the circle for a turn (match the walk-in speed constant), not the slower stroll.
- **Arms:** while walking, arms either swing naturally opposite the legs (a typical walking swing, smaller when holding boules) or stay folded across the chest, chosen per personality and varied (e.g. Odette often folded, Pierre swinging); no stiff carry pose unless actually carrying the ring or a jack. Keep the hand/boule attachment and release accuracy; tests for bone lengths during the new walk arms.

### F27 Pierre does what he said (sonnet)
When Pierre suggests a move in the chooser ("I'd shoot Marcel's boule", "A blocker in front", "You point, I'll shoot after") and the player picks him, he must play that move: the same intent, family and target (e.g. the boule he named), not a fresh decision that might point instead. Likewise any "I'm going to…" line he says before throwing must match the throw. Cause to check: the chooser runs an advice decision (`advice: true`, blended profile, human skill cone) but Pierre's actual turn calls `chooseThrowAsync` again with his own profile; cache the advice decision (keyed to the court state) and, when he's chosen, re-plan only the execution (his own skill, release point) for the same candidate. If the court changed since the suggestion, re-suggest first. Test: across seeded scenarios, the family and target of Pierre's throw equal his suggestion when chosen.

### F28 Better boule collection: kick to open space, then collect (sonnet)
F14/F15's simultaneous gathering still gets players stuck around the head. Model what real players do: each player locates their boules and nudges/kicks them out toward a free area nobody is standing in (a spot to the side of the head on their own side, chosen to avoid others' areas and paths), then walks there and picks them up together; dead boules beyond the strings are still fetched round the timbers.
Step 1, design (short write-up in GAME-PLAN §10, shown to the user before step 2): how collection zones are assigned (e.g. each player gets a sector around the head, left/right/near/far by team and next-mène role), how a kick works (a short foot swing that launches the boule with a small simulated roll toward the zone, through physics with live-ball collisions off or limited, or a scripted slide), order and timing so players rarely cross paths, and the fallback (after ~12–15 s, remaining boules go to hands).
Step 2, implement: a kick animation in character.js, the kick roll (physics or scripted), zone assignment and pathing in crowd.js/main.js replacing the current walk-to-each-boule loop, then the pick-up at the zone and the walk to next-mène spots (F15). Tests: zone assignment never overlaps, kicked boules end within the zone, a crowded head finishes without deadlock in simulation. Screenshots at a few times.

### F29 Temporary floatplane landing button (haiku)
Top priority, temporary. Add a small in-game button (controls bar, e.g. "✈ Landing") that triggers the F19 floatplane landing immediately (same as `?debug&floatplane=landing`, including framing the camera on it, then returning to the normal camera when it's done). Mark it clearly in code as temporary (`// TEMP F29: remove after review`) so it's easy to delete later.

### F30 Landing button stays ambient (haiku)
Top priority. The F29 button should just start the floatplane landing in the background, exactly as it happens naturally once per game: no camera framing, no interruption of play. Remove `fp.debugFrame = true` and the `releaseLandingCam`/`fpTempCam` camera handling from the button; keep the `TEMP F29` marking.

### F31 Cap reported scores at the target (haiku)
If a team ever ends a mène with more points than needed (e.g. 12 + 3 = 15), the scores stored and shown must never exceed the game target: clamp each team's score to `match.target` (13 in a normal game, 7 in the quick game) when scoring a mène (rules.js `endMene` / the scores array), so the scoreboard, mène-end card, game-over panel and winner logic all show at most the target (e.g. "13 to 8", not "15 to 8"). The winner is still decided by reaching the target. Tests: 12 + 3 gives 13; 6 + 6 in a 7-point game gives 7; normal scoring is unchanged.

### F31 notes
- rules.js `endMene`: `scores[team] = Math.min(match.target, scores[team] + points)`; display code reads `match.scores` so needed no change. The old "7-point game ends at 7" test now expects the capped `[5, 7]`; four new tests (12 + 3 → 13, 6 + 6 in a 7-point game → 7, normal scoring unchanged, E15 early end at a capped score).

### F26 notes
- `FETCH_SPEED = CAST_SPEED` (2.4 m/s, was 1.35) so fetches, pick-ups, ring/jack carries and gathering use the brisk walk-to-circle pace; stride stretched up to 1.3× (capped to stay in reach); free arms swing opposite the legs with more elbow bend, hands holding boules swing ~0.2 rad (boules ride the palm), folded arms stay folded; no stiff carry pose any more; style per walk by personality (Odette folds ~70%, Pierre swings most, Marcel small). walk-arms.test.js (7). A carried ring/jack has no separate pose (would need main.js call-site edits). `crowd.js` keeps its own 1.35 default for its tests.

### F25 notes
- terrain.js: per-seed archetypes tilt .25, ridge .17, basin .12, hills .14 (1–2 gaussians), saddle .08, tilt+hill .14, ridge+tilt .10; feature widths 3–10 m, plus low-amplitude 2-octave fBm; the main feature keeps ≥ 75% of the slope energy (`shapeMinShare`), then the whole field is scaled to `slopeMaxDeg` (1–2°). `terrain.shape` `{kind, dir, text, share}` (also on `perceived()`); `terrain.shapeText(courtDir)` rewords for the playing direction; groundview legend shows it in small italics. firmness/stones/divots streams unchanged. `maxHeight` 0.045 → 0.32 m (a 1.5° tilt spans about ±0.2 m).
- Tests added (determinism, every archetype reachable, gradient range, main-feature share, direction coherence). Loosened: physics roulette test seed 3 → 1, demi spread lower bound 0.25 → 0.2 (measured 0.20–0.24; not compared against the old terrain), roll-band seeds [4,7] → [7,1]; old ±5 cm height test now checks `maxHeight`.
- For F16/F23: check court edges against the timbers and grass plane now that heights reach ±0.2 m (and scenery following `sample()`), the Easy demi-portée outliers in measure-throws, and wire a first-mène commentary line from `terrain.shapeText(court.dir)` (personalities.js was F04's).

### F32 Simplified in-game controls (sonnet)
- **Roll guide always on:** remove the "Roll guide" toggle and its localStorage override; the guide is shown whenever the human aims (D21 band). Remove dead code and the difficulty-dependent default.
- **Icon cluster:** the bottom-right cluster (just above the status text) holds: a speaker icon (the Mute button, toggling a muted-speaker/speaker icon, aria-pressed and aria-label), fullscreen, and pause icons.
- **Hamburger menu:** every other in-game option button (Adjust view, Read the ground, Mode: Slow/Quick, View, Ambience, the temporary ✈ Landing button, and anything else in the controls bar) moves into a single hamburger button's submenu (a small dropdown or panel; keyboard accessible: Enter/Space opens, Esc closes, arrow keys move, focus returns to the button; closes on outside click; aria-expanded/haspopup; toggle items show their on/off state). Keep it in the top-right where the controls bar is now (or beside the icon cluster, whichever is tidier), so the scoreboard stays clean. Items that only apply on the human's turn (Adjust view, Read the ground, View) are shown disabled or hidden otherwise.
- **Pause mode:** the paused state shows only three buttons: **Resume**, **New game** (back to setup / restart) and **End game** (leave the full-window view to the normal page, as the old Exit did). The in-game option buttons (hamburger, icon cluster) and the status/commentary strip and turn banner are hidden while paused (the sepia scene and free orbit stay). The existing paused bar on the page stays consistent with this (same three actions).
- Update README controls text and the first-time hint if they mention the old buttons. Check at 1200×800, 500×900 and 844×390 with screenshots (menu closed, menu open, paused).

### F33 Nobody crouches for throws over 7.5 m (sonnet)
Real players stand for long throws. When the throw distance (circle centre to the planned landing spot or, before the plan exists, to the target: the jack for a boule, the intended spot for a jack throw) is over 7.5 m, every player uses the standing stance, overriding E07's per-throw choice (Pierre's 50/50) and Marcel's crouch preference; at 7.5 m or less the personalities' stances apply as now (the human always stands). The stance affects the release point (`from`), so decide it before the AI plans: compute the distance from the target first (the donnée distance is within about a metre of it), choose the stance, then plan with that stance's `from` and re-check after planning (if the planned donnée crosses 7.5 m the other way, re-plan once with the corrected stance). Apply to the preview, AI plan, throw animation and launch consistently, and to Pierre's advice planning. Files: main.js `stanceOf`/`enterCircle`, a pure helper in personalities.js (`stanceFor(spec, distance, rand)`, not touching F04's line pools) with tests: distance > 7.5 m → stand for everyone, ≤ 7.5 m → the personality's stance, stance fixed once per throw.

### F34 String lines partly buried (haiku)
The string lines are drawn as flat lines at a fixed height (about z = 0.012, noted in D10), but F25's broad slopes now raise the ground by up to about ±0.2 m, so parts of the strings sit under the terrain (and elsewhere z-fight). Fix: drape the lines on the terrain: build each string as a thin ribbon/strip following `terrain.sample(x, y).h` along its length at fine spacing (every ~10 cm), a few millimetres above the surface, with `polygonOffset` (and a slight depth bias) so it never z-fights, correct fog and shadow behaviour, and sharp corners. Also check the other ground overlays (jack range zone lines, placement zone, scoring circle, Read-the-ground overlay, divot decals, throwing circle) sit above the new terrain heights the same way. Screenshots on steep seeds (ridge, tilt, basin) from the shoulder and head views.

### F35 Remove "tir" terminology from the throw readout (haiku)
User: remove the "tir" shooting terminology, always show the categorisation by loft (roulette < 20°, demi-portée 20-45°, plombée > 45°). Change `styleForLoft` in `donnee.js` to ignore `snapped`, update the readout/hud text and tests. Check `main.js:1135` (`choice.style === 'tir'`) and the AI's own `tir` style in `tactics.js` still work (the AI's internal style names are not user-facing; leave them unless they leak into UI text). Depends on F32 because hud/main are being edited there.
