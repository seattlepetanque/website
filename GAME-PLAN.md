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

## 2. Throw gesture (superseded by §9, the donnée throw)

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

---

# Round 2

Play-testing showed the physics has the right feel (randomness, rocks) but the swing gesture made the game unplayable. Round 2 replaces the throw with a donnée-based toss, then adds visible players. Order of importance: (1) throwing, (2) stick-figure skeleton and animation, (3) skinned human meshes. The physics stays as it is for now.

## 9. The donnée throw (replaces §2)

Real players pick a landing spot (the *donnée*) and then decide how high to throw. The game copies that.

**Flow on the human's turn**

1. **Aim:** the player stands in the circle, seen from an over-the-shoulder camera. Drag sideways (or ←/→) to turn. This can be repeated freely.
2. **Toss:** press on the terrain to place the donnée, then pull down to raise the loft. While held, a live arc shows the intended throw, widening into a *cone of possibility*, with an ellipse on the ground where the boule may land. Release to throw. Dragging back above the press point, or Esc, cancels.
3. **Re-aim:** a "Re-aim" button returns to step 1 at any time before release.

- Clicking within a short distance of a boule or the jack snaps the donnée onto it (a tir). The HUD then reads "Tir".
- Keyboard path: ←/→ turn, arrows with Shift move the donnée, W/S change loft, Enter throws, Esc cancels.
- The jack is thrown the same way, with the legal 6–10 m zone drawn.

**Throw model** (`donnee.js`, pure, shared by the human and the AI)

- **Inputs:** release point, donnée (x, y), loft.
- **Loft:** 8°–75°. The HUD names the style: below 20° roulette, 20–45° demi-portée, above 45° plombée, "Tir" when snapped to a target.
- **Speed:** solved numerically so the flight (same gravity and drag as `physics.js`) lands exactly on the donnée, including its terrain height.
- **Backspin:** a function of loft (more loft, more backspin), tuned so a plombée checks up and a roulette runs.
- **Execution error (the cone):** per player skill, a lateral sigma and a longitudinal sigma that grow with distance and with loft, plus a small loft sigma. The actual throw samples the donnée and loft from this distribution, so what is drawn is what happens.
- **Sidespin:** comes from the lateral error (off-axis throws curl a little further off-axis).
- After landing, the physics adds its own randomness (landing tilt, pebbles, rocks, slopes) as now.

**Drawing (C07):** the nominal arc as a cream ribbon inside a translucent pale-blue cone (an elliptical tube whose cross-section grows toward the landing, outlined by four edge arcs at **2σ**, about 86% of landings), filled 1σ (39%) and 2σ ground ellipses, and a small donnée mark. The shoulder camera eases toward the donnée and zooms in a little while a toss is live. An optional *roll guide* of orange dashes laid on the ground, ending in a ring, shows a noiseless roll-out on the perceived terrain; it is on for Easy, off for Medium and Hard, always on for the jack unless the player turned guides off, and can be toggled. Release height follows loft until the character's hand supplies it (0.5 m crouched below 18°, 0.9 m standing above 30°). A tir (snapped donnée) aims 0.2 m short of the target.

**AI:** plans in the same space (donnée + loft) and throws through the same model with its own skill cone. Before throwing, the AI's donnée marker and arc are shown briefly ("Marcel picks his spot…").

**Skill:** the human has a fixed, medium cone; difficulty changes the AI cones and the roll-guide default.

## 10. Players: skeleton, animation, meshes

- **Camera:** over-the-shoulder, behind and to the right of the thrower at about head height, looking at the donnée area. Zoom with wheel/pinch. The head (overhead) and inspect views stay available from a View button.
- **Positions:** the thrower stands in the circle; the partner waits behind, the opponents to one side.
- **Stage 1, stick figure (`character.js`):** a procedural skeleton (pelvis, spine, neck, head, shoulders, elbows, wrists, hips, knees, ankles) drawn as simple capsules. Procedural animations: idle (breathing, weight shift), turn, pointer's crouch or shooter's stance, backswing, release, follow-through, watch, celebrate, dismay, walk to and from the circle. The boule leaves from the hand at the release frame, and arm angle at release follows loft.
- **Stage 2, skinned meshes (opt-in with `?figures=mesh`; the user prefers the stick figures, which stay the default):** CC0 rigged humans (first choice: Quaternius or Kenney packs, licences verified and recorded in a credits file), loaded with three.js's GLTFLoader, driven by the same skeleton API. Mixamo and Ready Player Me are out because of their licence terms. The stick figure stays as the fallback if a model fails to load.
- **Moving like people:** players simulate how people really move during a game, walking to the circle, fetching dead balls, carrying the cochonnet to the placer, walking out to place it, rather than objects or people teleporting. These walks are sped up or skipped in fast/test modes and under reduced motion.
- **Personalities** (looks, stance, idle quirks, reactions, commentary, skill):
  - **Marcel:** old Provençal pointeur, flat cap and belly, crouches low, unhurried, grumbles at bad luck.
  - **Odette:** retired schoolteacher and sharp tireur, sun hat, stands tall, precise and dry.
  - **Pierre** (your partner): young, enthusiastic, a bit overconfident, celebrates loudly.
  - **You:** a neutral default look, chosen to stand out from the others.

## 10b. Court surround

The court is ringed with 6×6 timbers a short way outside the string lines. Out-of-bounds balls turn grey, ghost through live balls, bounce off the timbers, and roll only a little on the heavy ground outside them, until a player fetches them.

## 11. Later: terrain styles (not scheduled)

Choosable terrains, each a preset over the terrain and physics constants: mostly sandy; sandy with noticeable rocks; spread gravel on hard pack; spread gravel on soft pack. Each has a dry and a wet version (wet: darker colour, different rolling resistance and landing dig, less bounce). Picked on the setup screen.

---

# Round 3

## 12. Tactics

Today the AI scores each simulated end state with a few hand-tuned terms (`evaluate`), nudged by `shootBonus`, `stylePref` and `styleNoise`. It plays sensibly in the plain case but has no sense of the game: it shoots as readily when down on boules as when up, treats a dead jack as a flat -1, and cannot say *why* it chose a throw. This section adds a tactics layer. The Monte Carlo stays as the source of truth about what a throw will do. Tactics decides which throws are worth simulating, how to score what the simulations produce, and how to explain the result.

Notation: the circle is at (2, 1); y runs up the court; the court is 4 m wide and 15 m long. "Us" is the team of the player who is about to throw, "them" the other team. `hT`, `hO` are boules in hand *after* the throw under consideration (the thrown boule is already spent). The code lives in a new pure module `tactics.js` (no physics, no DOM), so it is testable in Node.

### 12.1 The situation model

`readSituation({ match, bodies, player, difficulty })` returns a plain object, computed once per decision.

| Feature | Definition |
|---|---|
| `score`, `target`, `toGo` | Scores, game target, and points each side still needs (`target - score`). |
| `mene` | Mène number (only for stats; no rule depends on it). |
| `hand` | `{ us, them }` boules in hand *before* this throw, and `handAfter` the same after it. |
| `BA` | Boule advantage, `handAfter.us - handAfter.them`. Positive means we can afford to gamble. |
| `onGround` | Live boules per team, sorted by distance to the jack: `{ team, dist, id, owner }`. |
| `holder`, `pts` | `rules.holdingTeam` and the points `rules.meneResult` gives now; `ptsSigned` is `+pts` if we hold, `-pts` if they do, 0 for none or tie. |
| `margin` | Gap (m) between our best boule and their best: positive when we lead. Computed with a sentinel of 3 m when a side has no live boule. |
| `second` | Distance of the first boule that is not part of the holder's points, i.e. how close the holder is to adding another point. |
| `spread` | Spread of our counting boules, the distance of our k-th boule to the jack for k = 1..n (it decides which points are cheap to lose). |
| `jack` | Position, distance from the circle, and `edge`, the distance to the nearest string or end line. `exposure = clamp((1.3 - edge) / 1.0, 0, 1)`: 0 beyond 1.3 m, 1 on the line. |
| `lane` | For a target point: is the straight ground path from the circle blocked by a boule within 0.25 m of the line (decides roulette)? |
| `next`, `left` | Who throws after us: if we end up holding (and they have boules) they do, otherwise we do (the `rules.nextTeam` rule). `left` lists which players on each team still have boules, with role and skill (`SKILL`, scaled by difficulty for AI players; the human uses `SKILL.human`). |
| `pressure` | `closeOut.us = toGo.them <= 4` (they could finish with a good mène: weight their points more), `closeOut.them` likewise; `needBig = toGo.us <= 2` (our points matter more). See 12.5. |
| `profile` | The player's tactical profile (12.7): risk λ0, shoot appetite, awareness, error rate. |

Everything is derived from data the AI could see on the court. It uses the real opponent skill from the `SKILL` table the way a human guesses "she is a good shooter", not the hidden terrain jitter.

### 12.2 Decisions and candidate families

Tactics does not emit raw positions. It emits **families**, each a labelled bundle of one or more simulated candidates, with a prior and a reason. The existing Monte Carlo then simulates the candidates.

| Family | Candidates (target; styles) | Admitted when |
|---|---|---|
| `pointJack` | Jack centre; roulette, demi, plombée | Always. Roulette dropped when `lane` is blocked. |
| `pointSlot` | Up to two spots at 0.7 × the distance of their best boule, on the open sides of the jack (replaces the fixed ±0.22 m offsets); demi, plombée | They hold, `margin < -0.1`, and their best boule is within 0.8 m. |
| `pointFront` (blocker) | Jack - (0, 0.3), 0.3 m short on the line from the circle; plombée, demi | They have a pointeur with boules left, or their boule sits just behind the jack. |
| `pointBehind` (safety) | Jack + (0, 0.4) and (±0.3, +0.35); demi, plombée | `jack.exposure >= 0.4` and they have a tireur with boules, or we hold and `hO > 0`. |
| `shootBoule` | Their boule `t`; tir (snap, 0.45 m short) and high tir (0.1 m short) | `G(t) >= gate` and analytic `pHit >= 0.15` (below). Best two targets by `A(t)`. |
| `shootJack` | The jack; tir and high tir | The dead-jack payoff (12.4) beats the status quo by at least 0.8, or `jack.exposure >= 0.6` with a positive score trick. |

For a target boule the **removal gain** `G(t)` is static, with no simulation: `EPnet` (12.4) with `t` deleted from the ground, minus `EPnet` now. The analytic hit chance is `pHit ≈ Φlat · Φlong · 0.7`, from the player's cone at that distance (`coneFor`): `Φlat = P(|N(0, σlat)| < 0.075 m)` (boule plus target radius), `Φlong = P(|N(0, σlong)| < 0.25 m)`, and a 0.7 factor for the roll and the pebbles. Then `A(t) = pHit·G(t) - (1 - pHit)·missCost(t)` with `missCost = 0.15 + 0.35·collateral(t) + 0.3·jackNear(t)` where `collateral` counts our counting boules within 0.3 m of `t` and `jackNear` is 1 if the jack is within 0.25 m. `A` ranks shoot targets and prunes before any simulation.

**Which teammate throws.** `whoThrows(sit)` is used for Pierre's suggestion and for the AI side's pick. If only one player has boules, no choice. Otherwise it computes, per player, the best *analytic* family score using that player's cone: shoot families scored by `A`, point families by `P_close · value`, where `P_close = 1 - exp(-r²/(2σ²))` for r = 0.25 m and σ the player's point spread (`√(σlat² + σlong²)` at the jack's distance, +0.15 m terrain). The higher scorer throws; within 0.25 of each other the player with more boules in hand throws (tie again: the human). This needs no simulation. Pierre's suggestion names both the player and the throw.

### 12.3 Principles

Principles act in three places: on **admission** (which families exist), on the **prior** added to a candidate's score (in the same units as the evaluation, small: |prior| <= 0.5, so the evaluator can overrule them), and on **risk λ**. A principle exists because the evaluator cannot see something: the sims only look one throw ahead, so a prior stands in for the value of the throws that follow.

| # | Principle and rationale | Effect on the model |
|---|---|---|
| R1 `downOnBoules` | `BA <= -1`: the other side has more ammunition, so each of our boules must count; shooting spends one for little. | Shoot prior `-0.3·min(|BA|,2)`; gate raised by 0.4 per boule; λ × (1 + 0.25·min(|BA|,2)); `pointJack`, `pointSlot`, `pointFront` priors `+0.15`. |
| R2 `upOnBoules` | `BA >= 1`: a miss costs little because we still outnumber them, and extra boules make a big mène possible. | Shoot prior `+0.25·min(BA,2)`; gate lowered by 0.2 per boule; λ × (1 - 0.2·min(BA,2)). |
| R3 `bringInBoules`, `removePoints` | A shot is worth most when it lifts our *distant* boules into the count, or deletes two or more of their points. | `unlock(t)` = our new points after removing `t` minus our points now; prior `+0.3·unlock + 0.2·[their points removed >= 2]`. Raises `G`, so the target is also more likely to be admitted. |
| R4 `protectOwn` | A hit moves the target and the shooter; our boules close to the target are knocked, and a jack nudged toward their boules turns a hit into a loss. | `collateral` and `jackNear` in `missCost`; prior `-0.25` per own counting boule within 0.3 m, `-0.4` when the jack is within 0.25 m of the target and the push direction (target to jack, extended) points at one of their boules within 0.8 m. If `collateral >= 2` and `G < 2`, the family is dropped. Reason `protectOwn` is reported when a shot that would otherwise have been admitted is dropped or loses to a point. |
| R5 `lastBoule`, `closeOut` | Late in a mène and near 13, a sure point beats a gamble. | Last boule (`hand.us = 1`, `holder != us`): λ × 1.3. The game term (12.4) multiplies points that finish the game, which also shrinks the appetite for a shot that risks the point we hold. |
| R6 `voidMene`, `jackScoreTrick` | A mène that is going badly can be ended. A dead jack scores exactly as `rules.endMene` says: void if both teams still have boules, otherwise the team with boules scores them. | No special case: the evaluator uses that payoff (12.4). A shot at the jack is admitted when the payoff beats the status quo by 0.8, so it appears naturally when we are down 3+ and both teams keep boules (void), and when only we keep boules (trick). It is *bad* when `hO > 0` and `hT = 0` unless they hold fewer points than `hO`. |
| R7 `blockFront`, `safetyBehind`, `coverJack` | A boule just in front of the jack blocks the roll of a pointeur's boule; one just behind it keeps the point if the jack is shot or pushed. | Priors: `pointFront +0.2` against a pointeur with boules left and a clear lane; `pointBehind +0.2·exposure·2` against a tireur (reason `coverJack` when `exposure >= 0.6`). |
| R8 `noReply` | If they have no boules left (`hO = 0`) and we hold, nobody can take the point, and the only risk is damaging our own. | λ = 0, shoot prior `-0.5` (do not shoot, add points), `pointJack`/`pointSlot` `+0.1`. |
| R9 `takePoint`, `holdPoint` | The default: with no stronger reason, point to hold or take the point. | Reported when no principle moved the decision. |

### 12.4 Evaluation

The evaluator scores a settled simulated state from the thrower's view. Units are mène points. It replaces `evaluate()` in `ai.js` and lives in `tactics.js` as `evalEnd(state, sit, params)`.

```
V = wE·EPnet + wG·Gterm + wB·BA' + wM·marginTerm - wX·exposureTerm - wL·ownLost + wF·foesLost
```

**Expected points `EPnet`.** A point is worth what survives the other side's remaining boules. Let `d1 <= d2 <= ...` be the distances of the holder's counting boules, `n` their number, `X` the other side's best remaining boule count `hX` (their hand if we hold, ours if they hold) and `σX` their point spread. For one remaining boule landing as a 2-D Gaussian around the jack, the chance it beats a boule at distance `d` is `1 - exp(-d²/(2σX²))`, so with `hX` boules left, boule k survives with

```
keep_k = exp(-hX · d_k² / (2·σX²)) · (1 - shootRisk_k)
shootRisk_1 = min(0.6, 0.5 · pHit_X · [X has a tireur] · visibility)   (0 for k > 1)
EPhold = Σ_k keep_k  -  (1 - keep_1) · 1.2
```

The `-(1 - keep_1)·1.2` term is the expected point the other side then scores (1 point plus a little). `EPnet = EPhold` if we hold and `-EPhold` if they do; ties and no live boules are 0. When the holder still has boules and the other side loses the point, the holder may add points; this is a small bonus of `0.2·hHolder`. `σX` is `√(σlat² + σlong²)` at the jack's distance for the best pointer among the other side's players with boules, plus 0.15 m for terrain. `pHit_X` uses their best shooter's cone at the distance to the holder's best boule. Step 2 should fit these constants against a few hundred rollouts of full mènes (they are a heuristic, not a proof).

**Game term.** With `toGo.us` and `toGo.them` the points each side needs: `Gterm = P(we reach target this mène) - P(they reach target)`, where `P(reach n points)` is `keep_n` if the holder has at least `n` counting boules, else 0. Default `wG = 2.5`. This is what makes the AI safe at 11 and desperate at 4–11.

**Other terms** (defaults):

| Term | Definition | Default |
|---|---|---|
| `wE` | `EPnet` weight | 1.0 |
| `BA'` | `clamp(hT - hO, -3, 3)`; ammunition in hand | `wB = 0.25`, halved when `holder = us` and `hO = 0` |
| `marginTerm` | `clamp(dO - dT, -1, 1)`, with 3 m for a side with no boule on the ground | `wM = 0.5` |
| `exposureTerm` | `exposure · hO · max(0, EPhold when we hold)`: the chance the jack is shot out and our point voided | `wX = 0.15` |
| `ownLost` | Own boules newly dead in this sim | `wL = 0.2` |
| `foesLost` | Their boules newly dead | `wF = 0.1` |

**Dead jack** (`jack.dead` in the sim). The payoff mirrors `rules.endMene`: both sides have boules: `V = -0.15` (a replay costs a little tempo and the jack throw); only we have boules: `V = hT + Gterm'`; only they have boules: `V = -hO + Gterm'`; neither: `-0.15`. `Gterm'` applies the same game-reaching test to those scored boules. A test checks `V` against `rules.endMene` for all four hand combinations so the two cannot drift. Because the status quo is now valued by `EPnet`, voiding becomes attractive exactly when `EPnet` is worse than about -0.15.

**Risk attitude.** The candidate score is `mean(V) - λ·sd(V) + prior + noise`, as today but with a situational λ:

```
λ = λ0(profile) · fBA · fLast · fDesperate · fClose
fBA        = 1 + 0.25·clamp(-BA, -2, 2)           (down: more careful; up: freer)
fLast      = 1.3 if this is our last boule and we do not hold, else 1
fDesperate = 1 - 0.6·clamp((-EPnow - 1.5)/2.5, 0, 1)   (losing big: take the gamble)
fClose     = 1.4 if closeOut.us (we are about to win), 0.6 if closeOut.them and EPnow < 0
λ = 0 under R8 noReply
```

`noise` is `±0.04·rand` (was 0.08) and only breaks ties.

### 12.5 Explainability

Every decision carries `reason: { code, ...params }`, chosen as the principle that contributed most to the winner's score relative to the runner-up (the largest prior or the term that flipped the ranking), or `takePoint` / `holdPoint` when nothing exceeded 0.1. The result also keeps `alt`, the best candidate of the other kind (point vs shoot) with its score gap, which Pierre uses to say "close call".

| Code | Params | Marcel (spot line) | Pierre (suggestion to you) |
|---|---|---|---|
| `takePoint` | `gap` | "Doucement. I take the point." | "Their boule is {gap} off the jack. Point it, you've got this." |
| `holdPoint` | none | "A little more, to be safe." | "We're in front. Keep pointing." |
| `downOnBoules` | `BA`, `hand` | "They have more boules. I do not gamble." | "They've got {n} more boules than us. Point, don't shoot." |
| `upOnBoules` | `BA` | "We have the boules. I can afford a bold one." | "We're up on boules, you can shoot." |
| `bringInBoules` | `unlock` | "Move that one, and ours count." | "Knock that boule out and our two come into the point." |
| `removePoints` | `removed` | "Odette, take that one away." | "They hold {n}. Shoot the first one." |
| `protectOwn` | `collateral` | "Too near our own boule. I point." | "Don't shoot, you'd knock our boule." |
| `lastBoule` | none | "The last one. Safe." | "Last boule, play it safe." |
| `closeOut` | `toGo` | "Eleven. A safe point wins it." | "Only {n} to win, don't gamble." |
| `voidMene` | `losing` | "Pff. We shoot the cochonnet and start again." | "We're losing {n}. Shoot the jack and void it." |
| `jackScoreTrick` | `hT` | "They have none left. Cochonnet out, and mine are points." | "They're out of boules, knock the jack out and we score ours." |
| `blockFront` | none | "I put one in front, as a door." | "Put one in front, stop their roller." |
| `safetyBehind` / `coverJack` | `exposure` | "Behind the jack, in case she shoots it." | "The jack is near the line. Cover it from behind." |
| `noReply` | none | "They have none left. Points, points." | "They're out. Just add points." |
| `mistake` | none (Easy and Medium only; log only) | (falls back to `takePoint`) | (falls back to `takePoint`) |

The existing events `spotPoint`, `spotShoot` and `spotJack` stay as the generic lines. `main.js` asks `talk.say(player, 'why.' + code, params)` first, falling back to the old event when a character has no line, so Odette says "we're up on boules" through her own pool. Pierre's `suggest()` gets `reason` from his choice and picks `suggest.<code>` the same way, with `{n}`, `{gap}` templates filled from the params. New pools live in `personalities.js` (`LINES.<id>.why`, `LINES.pierre.suggest`).

### 12.6 Candidate flow and performance

A decision runs in five steps. Steps 1–3 are analytic and cost under 2 ms.

1. `readSituation`.
2. Generate families and their candidates (12.2); apply admission.
3. **Prune** by analytic score `A = prior + analytic value`: drop candidates more than 1.5 below the best, dedupe candidates on the same style whose targets are within 0.15 m, cap at 6 (Easy), 8 (Medium), 10 (Hard). Typical Medium counts are 6–9, against up to 12 today.
4. **Successive halving** on the Monte Carlo: every survivor gets 4 sims. Keep the top 3, plus any within `2·standard error` of the best, and give those the rest of the sim budget (Easy 8, Medium 12, Hard 16 in total per candidate, as now). About 8×4 + 3×8 = 56 sims, against 144 today at Medium.
5. **Early cut-offs:** a shoot candidate whose first 4 sims never move the target is dropped; a point candidate with all 4 sims worse than the best candidate's worst is dropped. A wall-clock guard (`performance.now`) stops at 40 ms at Medium and returns the best so far; the loop already yields between candidates so the UI stays live.

The `measure-ai.js` harness reports mean and 95th percentile decision time for each difficulty and for the 12 scenarios.

### 12.7 Personality and difficulty

Profiles replace `shootBonus`, `stylePref` and the shoot part of `AI.riskAversion`. Style taste (Marcel likes the roulette) stays as small priors (`+0.22` roulette, `+0.06` demi), and `styleNoise` drops to 0.04.

| Profile | `λ0` | `appetite` (× shoot priors, 1/gate) | `awareness` (weight on R1/R2/R5) | `gate` base (min `G`) | Taste |
|---|---|---|---|---|---|
| Marcel | 0.30 | 0.5 | 1.0 | 1.8 | Roulette; blocks; avoids the jack shot unless desperate |
| Odette | 0.15 | 1.3 | 1.0 | 0.7 | Demi; shoots when `G >= 0.7`; plays the jack shot when it is right |
| Pierre | 0.05 | 1.6 | 0.5 | 0.56 | Shoots; underweights being down on boules |
| You (advice) | 0.15 | 1.0 | 1.0 | 0.9 | Neutral; used for suggestions in play |

`gate = gateBase · (1 + 0.4·max(0, -BA)) / appetite` is then adjusted by R1/R2. Odette, with the same `G` as Marcel, shoots at about 2.5 times his rate.

| Difficulty | Tactical error rate `ε` | Principle weight | Other |
|---|---|---|---|
| Easy | 0.30 | 0.3 (priors, awareness, game term all scaled) | Never considers `shootJack`; `BA'` weight halved; noise × 3 |
| Medium | 0.08 | 0.8 | `shootJack` only when `G`-like gain >= 1.5 |
| Hard | 0.02 | 1.0 | Full candidate cap; fits `λ` situationally; extra slot and safety candidates |

A tactical error is drawn once per decision with probability `ε`: the AI then skips the priors and picks a random admitted candidate weighted by its analytic score. It is not a physical miss; the throw cone still applies. That gives Easy believable mistakes (shooting when down, pointing when it should shoot) while the throws stay honest. Reason `mistake` is logged.

Pierre's *suggestion* is computed with the profile "You (advice)" blended 50/50 with Pierre's, **and with the human's cone** (the human throws it), always at Hard rationality (`ε = 0.02`), so the advice is good but still has his enthusiasm.

### 12.8 Testing

**Scenario tests** (`tests/petanque/tactics.test.js`, plus `ai.test.js` additions). Each is a fixed court state with a fixed seed. The *static* part is deterministic and asserts the plan: admitted families, ranking and reason. The *Monte Carlo* part runs 20 seeds at Hard and asserts the decision class holds for at least 70%. Coordinates have jack J = (2, 8), the thrower at the circle (2, 1); "ahead" means smaller y. "Ours" are team 0 boules, "theirs" team 1.

| # | Court state | Expected decision and why |
|---|---|---|
| 1 | Jack only; hands 3 v 3; Marcel throws | `pointJack`, roulette or demi, `takePoint` |
| 2 | Theirs 0.12 m from J; no more; hands 3 v 3 (even, we are first throw back) | Marcel: point (`takePoint`). Odette: `shootBoule`, G≈1.3 passes her gate 0.7 but not Marcel's 1.8 |
| 3 | Theirs at 0.15 m; we have 1 left, they 3 | Everyone points (`downOnBoules`); Pierre shoots at most 35% of seeds, Odette at most 15% |
| 4 | Theirs at 0.10 and 0.30 m, ours at 0.9 m; we 3 left, they 1 | `shootBoule` at the 0.10 boule (`removePoints`, `upOnBoules`); Marcel too, since R2 and G both high |
| 5 | Theirs at 0.20 m; ours at 0.35 and 0.50 m; we 2 left, they 2 | `shootBoule` the 0.20 m boule (`bringInBoules`, unlock = 2) |
| 6 | Theirs at 0.20 m with our boule 0.12 m beside it; jack 0.2 m behind it | `pointSlot` or `pointJack`, not a shot (`protectOwn`) |
| 7 | Theirs at 0.10, 0.20, 0.30, 0.40 m; we 2 left (1 after), they 1 left | `shootJack` (`voidMene`): void payoff -0.15 against `EPnet` of about -4 |
| 8 | Theirs at 0.10 and 0.25 m; our last boule; they 3 left | No `shootJack`: dead jack gives them 3 > their 2 points. Point at the jack |
| 9 | Jack at (3.0, 9.0), 1 m from the string; theirs hold 1 point; they have no boules left; we 3 (2 after) | Odette at Hard: `shootJack` (`jackScoreTrick`, payoff 2 plus the game term). Marcel: point |
| 10 | Score 5–11, theirs hold 2 points (13 wins); we 2 left, they 1 | Odette: `shootBoule` or `shootJack` (`closeOut`, `voidMene`, desperate, λ down 60%). Never a plain safe point |
| 11 | Score 11–4, we hold 2 points with the other side holding no boules; we 2 left | Point, no shot (`noReply`, λ = 0) |
| 12 | Jack at (2, 13.4) 0.6 m from the end line; theirs 0.30 m, ours 0.60 m; Odette has 2 left; we 2 | `pointBehind`, J + (0, 0.4) (`coverJack`); never a roulette past the jack |
| 13 | Theirs 0.50 m beside the jack; Marcel has boules; clear lane; BA +1 | `pointFront` or `pointJack` with a plombée (`blockFront`), not a roulette that can run into their zone |
| 14 | Same court as 4; the human's team has You and Pierre, both with boules | `whoThrows`: Pierre (better shooter); suggestion `suggest.removePoints` |
| 15 | Same as 1 but the human's team to throw | `whoThrows`: You (point-first; lower long σ than Pierre at the jack); suggestion `suggest.takePoint` |
| 16 | Only Pierre has boules | No choice; the suggestion is for him alone |
| 17 | Case 3 at Easy, 200 seeds | Shoots in at least 25% of seeds (`ε = 0.3`); Hard at most 5% |

**Static tests** (no simulation) also cover: `readSituation` field by field on hand-built states; `evalEnd` monotone in points held, in distance, in boules in hand; the dead-jack payoff equal to `rules.endMene` for the four hand combinations; `A(t)` ranks the closer target higher; admission (case 8 admits no `shootJack`); performance tests that candidate counts stay under the cap.

**Full-match statistics** (`tests/petanque/measure-tactics.js`, 200 matches per row, seeded):

- *Decision mix by situation bucket*: `BA` (down, even, up) × (holding, not) × last boule or not; for each bucket the share of point (roulette, demi, plombée, front, behind, slot), `shootBoule`, `shootJack`, and the share of each reason code. Expected: shoot rate rises with BA, shoot appetite Odette > Pierre ≥ Marcel, `shootJack` rare (<3% of throws) and almost always `voidMene` or `jackScoreTrick`.
- *Shot results*: hit rate, carreau rate, own boules displaced, jack moved, per player.
- *Mène outcomes*: void rate (target <5%), mean points per mène, game length in mènes.
- *Win rates by difficulty* of Marcel+Odette against three scripted human teams: a **pointer** (always demi at the jack, never shoots), a **shooter** (shoots whenever they hold anything), and a **tactician** (uses the same tactics at Medium). The human skill is `SKILL.human`; Pierre plays with his own tactics. Report Easy, Medium and Hard. Keep the D02 balance: the AI's Medium win rate against the pointer bot must stay within ±5 points of the pre-change baseline measured first; Easy at 30–45%, Hard at 60–75%.
- *AI v AI* (Hard v Hard, Hard v Easy) to check the layer helps: Hard must beat Easy at least 70%.
- *Timing*: mean and p95 decision time per difficulty (target Medium p95 under 50 ms).

### 12.9 Migration

What stays in `ai.js`: the roll-out table and `donneeDistFor`, `refineDonnee`, `pointDonnee`, `throwThrough` and `finish` (budget fit, release point, cone), `chooseJackThrow` and `chooseJackPlacement`, the generator-based `decide` loop and the async wrapper, the sim counts, `AI.lofts`, `tirShort` and `tirHighShort`. Cones, `fitToBudget` and `SKILL` in `donnee.js` are untouched; tactics only reads them (`coneFor`, `SKILL`, `scaledSkill`).

What changes in `ai.js`: `buildCandidates` is replaced by `tactics.plan(sit)` (candidates are the same shape as now plus `family`, `prior`, `reason`); `evaluate()` is replaced by `tactics.evalEnd`; the score line (`shootBonus`, `stylePref`, `styleNoise`, `riskAversion`) is replaced by `mean - sit.lambda·sd + prior + noise`; the loop becomes successive halving; `decide` returns `reason`, `alt`, `family` and `who` as well. Removed: `AI.shootBonus`, `AI.stylePref` (moved into profiles), `AI.riskAversion`, `AI.shootRange` (replaced by the `G` gate).

New in `tactics.js` (pure): `readSituation`, `removalGain`, `analyticHit`, `plan`, `evalEnd`, `riskLambda`, `profiles`, `explain`, `whoThrows`. In `personalities.js`: `why.*` and `suggest.*` line pools. In `main.js`: use `choice.reason` in `spotText` and `suggest`, and call `whoThrows` instead of "most boules first" when the AI side picks a player. `main.js` and `ai.js` are also touched by D04 and D16, so step 2 starts after those land.

Order of work:

1. `readSituation` plus its tests.
2. `evalEnd` (EPnet, game term, dead-jack payoff) plus the consistency test with `rules.endMene`. Plug into the existing candidates first and measure: the evaluator alone should already fix cases 3, 7 and 8.
3. Families, admission, `A`, and the static scenario tests.
4. Successive halving and the wall-clock guard; timing measurements.
5. Profiles, difficulty, tactical errors.
6. Reason codes, commentary pools, Pierre's suggestion and `whoThrows`.
7. Harness statistics, tuning, update the measurements in the plan.

### 12.10 Decisions (2026-11-01)

- **Pierre's advice:** the blend. Half Pierre's own appetite, half neutral, with Hard-level tactical sense, simulated with the human's skill cone.
- **Easy mistakes:** Easy makes visible tactical mistakes, about 30% of the time (Medium 8%, Hard 2%), on top of wider cones.
- **Chooser:** Pierre's chooser suggestion names who should throw as well as the shot (e.g. "You point, I'll shoot after"). The human still chooses.
- **EPnet:** a heuristic fitted to rollouts in step 2, not an offline lookup table.

### 12.11 Open questions (resolved above)


- Should Pierre's advice use his own recklessness (more fun, sometimes bad advice) or the neutral advice profile proposed here?
- Is a visible tactical error rate on Easy acceptable (the AI occasionally shoots when it should not), or should Easy stay physically weak only?
- The constants in `EPnet` (σ, 0.2, 1.2, `wG`) are a heuristic. OK to fit them against rollouts in step 2, or should the evaluator be a lookup table built offline?
- Should `You`'s partner-chooser prompt show Pierre's suggested player as well as the throw (new UI line)?
