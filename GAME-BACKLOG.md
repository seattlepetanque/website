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
| C04 | in-progress | sonnet | C03, C05 | Integrate the donnée throw into the game |
| C05 | done | sonnet | C01 | AI on the donnée model |
| C06 | todo | haiku | C04 | Remove the old swing code; update README |
| C07 | todo | sonnet | C04, C05, C06 | Review and tune throw feel |
| C08 | done | sonnet | C02 | Stick-figure skeleton and procedural animation |
| C09 | todo | sonnet | C07, C08 | Characters in the game: positions, throw sync, reactions |
| C10 | done | sonnet | — | Find and vendor CC0 rigged human models |
| C11 | todo | sonnet | C09, C10 | Skinned meshes on the skeleton |
| C12 | todo | sonnet | C11 | Personalities: looks, quirks, reactions, commentary |
| C13 | todo | sonnet | C12 | Round 2 final review |

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

## Later (not scheduled)

- T01 Terrain style presets (GAME-PLAN §11): sandy, sandy with rocks, gravel on hard pack, gravel on soft pack, each dry or wet; picker on the setup screen.
