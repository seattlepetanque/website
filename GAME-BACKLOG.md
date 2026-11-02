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
| D04 | in-progress | sonnet | — | Make the cochonnet easy to see |
| D05 | done | sonnet | — | Rolling sound as faint ticks against pebbles, not white noise |
| D06 | done | sonnet | — | Out of bounds on every side; dead balls placed beyond the far end line |
| D07 | todo | sonnet | — | Measuring lines between throws; numbered scoring circle at mène end |
| D08 | todo | sonnet | D01–D07, D09–D16 | Round 3 review |
| D09 | todo | sonnet | — | Flight camera follows every moving object, the cochonnet first when it moves fast |
| D10 | done | sonnet | — | 6×6 lumber round the court; out-of-bounds balls turn grey, ghost through live balls, bounce off the boards |
| D11 | todo | sonnet | D10 | Players fetch dead balls and walk the cochonnet to its spot |
| D12 | todo | sonnet | — | Paused game: frozen, sepia, UI inert, free orbit camera |
| D13 | todo | sonnet | D04, D16 | AI tactics system: design done (GAME-PLAN §12, decisions in §12.10); step 2 implement next |
| D14 | todo | sonnet | — | Placed cochonnet: legal region runs out to the strings; settle the ground under it |
| D15 | todo | sonnet | — | Surroundings: grass, nearby trees, Seattle skyline with Mount Rainier and the Space Needle |
| D16 | in-progress | sonnet | — | Investigate AI throws that fall far short, and why Pierre misses most shots |

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

### D08 Round 3 review (sonnet)
Run `npm test`, the build check and the full-match test, take screenshots on desktop and phone, review the code for bugs, and add a "Round 3 remaining issues" list at the end of this file.
