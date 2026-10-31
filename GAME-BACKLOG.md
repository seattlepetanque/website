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
| B13 | in-progress | sonnet | B11 | Polish: divots, measuring, commentary, fallbacks |
| B14 | done | haiku | B11 | README and docs |
| B15 | todo | sonnet | B12, B13, B14, B16 | Final review, tuning, bug fixes |
| B16 | in-progress | sonnet | B10 | Physics realism: stones, shots, spin |

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
