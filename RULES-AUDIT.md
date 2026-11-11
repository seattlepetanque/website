# Rules audit (F73)

Source of truth: `petanque-rules.txt` (official FIPJP rules, December 2020; untracked, not to be committed).
Audited code: `assets/js/petanque/rules.js` (state machine, scoring), `court.js`, `constants.js`, `physics.js` (out of bounds), `main.js` (flows), and tests in `tests/petanque/`.
Format played: doublette (2 v 2, 3 boules each), 13 points (7 as a quick option). This was a read-only audit: no code or test was changed. `node --test tests/petanque/rules.test.js tests/petanque/match.test.js tests/petanque/jack-judge.test.js`: 36 tests, all pass (the tests encode today's behaviour, including the wrong one below).

## (a) Summary

Status per article (42 articles, counting 2a; the worst applicable status of an article decides its row):

| Status | Count | Articles |
|---|---|---|
| Implemented | 11 | 1, 2, 3, 12, 14, 15, 18, 19, 22, 26, 29 |
| Partly | 6 | 5, 6, 7, 9, 16, 35 |
| Not implemented | 1 | 21 (time limits) |
| Not applicable (physical world, refereeing, tournament admin) | 24 | 2a, 4, 8, 10, 11, 13, 17, 20, 23, 24, 25, 27, 28, 30, 31, 32, 33, 34, 36 to 41 |

Top discrepancies, by gameplay impact:

1. **High. Art. 16, first boule out of bounds.** The rule says the opponent plays next, then alternately while no boule is on the terrain. The code makes the same team throw again, and again, until one of its boules stays in. Full analysis in section (c). Proven with a script: four consecutive dead boules give turns `0,0,0,0`. The test `nobody on the ground: last thrower throws again` asserts the wrong behaviour.
2. **Medium. Art. 7.1, jack distance.** The 6 to 10 m limits are measured from the circle centre; the rule says from the internal edge of the circle (a 50 cm circle: 25 cm difference at each end). Valid zone today is 5.75 to 9.75 m from the circle edge instead of 6 to 10 m.
3. **Medium. Art. 9.3, jack knocked to less than 3 m from the circle is dead.** Not implemented (the more-than-20 m half cannot occur on a 15 m court).
4. **Low/Medium. Art. 21, one-minute time limit** (and the 1 minute for the jack throw): not implemented at all, no clock on turns.
5. **Low. Art. 5, barrier distance.** Lumber is 0.4 m outside the strings; the rule asks at least 1 m. Visual/physical simplification only.
6. **Low. Art. 6 / 35, repeated bad jack placement.** Every bad placement gives a yellow card and the same team places again, with no escalation (rule: new card to the whole team, then penalties of Art. 35).

Could not decide (rule text ambiguous):

- Art. 16 last paragraph versus the "alternately" sentence when boules were on the ground and a shot clears all of them. Art. 16 sends you to Art. 29 (last team to play, plays again), but Art. 29 is written for equidistant boules. See (c).
- Art. 7.3 "50 cm from the end line": measured to the jack centre or its edge? The code and the user-given rule (GAME-BACKLOG E20) use the centre, strictly more than 0.5 m. The text does not say.
- Art. 7.1 "6 m from the internal edge of the circle": measured to the jack centre or its nearest point (1.5 cm difference)? Negligible.
- Art. 7 and 14: where the next circle goes after a dead jack (the text says "where it finished"; the code uses the last in-bounds spot, F10).
- Art. 29: how "equal distance" is decided. The code uses 1 mm (`TIE_EPS`); `main.js` explains a void with a 2 mm test. Real life: only when the umpire cannot separate them.

## (b) Article table

Severity is gameplay impact (High, Medium, Low, or "-" where nothing is wrong). Line numbers are from the current `dev` (0ccf749). Test names are proposed, none written.

| Art. | Title / summary | Status | Where in code | Discrepancy | Sev. | Suggested fix | Suggested test |
|---|---|---|---|---|---|---|---|
| 1 | Composition. Triples, doubles, singles; doubles use 3 boules each. | Implemented | `rules.js` `createMatch`, `defaultPlayers` (2 v 2, `BOULES_PER_PLAYER` 3) | Only doubles offered, which is allowed. | - | None. | Existing `createMatch sets up doublette`. |
| 2 | Boules: metal, 7.05 to 8 cm, 650 to 800 g. | Implemented | `constants.js` `C.boule` r 0.0375 (7.5 cm), m 0.72 kg | None. | - | None. | A constant-range check (diameter and mass inside the limits). |
| 2a | Penalties for irregular boules. | Not applicable | n/a | Cheating and equipment checks do not exist in the game. | - | None. | None. |
| 3 | Jack: 30 mm, 10 to 18 g. | Implemented | `C.jack` r 0.015, m 0.018 | Mass exactly at the 18 g upper limit; fine. | - | None. | None. |
| 4 | Licences. | Not applicable | n/a | Tournament admin. | - | None. | None. |
| 5 | Area of play: at least 15 x 4 m, strings are dead lines, barriers at least 1 m from the outer line, games to 13 (11 for leagues), timed games. | Partly | `C.terrainW` 4, `C.terrainL` 15; `physics.js` `checkDead`; `rules.js` `target`; `C.lumberGap` 0.4 | Size, dead lines and 13 points match. Lumber sits 0.4 m outside the strings (rule: barriers at least 1 m). No 11-point option (a 7-point quick game exists instead). Timed games not modelled. | Low | Either widen `lumberGap` to 1 m (visual cost) or list it under simplifications (it is in section d). Offer 11 as a target if wanted. | `createMatch({target:11})` ends at 11 (works today, add the test). |
| 6 | Start: coin toss, circle 35 to 50 cm, feet inside, one jack attempt, invalid jack placed by the opponent, penalties for a bad placement. | Partly | Toss: `main.js` `startGame` line 968 (random `firstJackTeam`) and `beginMene` line 979; circle: `court.js` `CIRCLE_R` 0.25 (50 cm); one attempt and hand-over: `rules.js` `apply` `jackThrown` line 205; placement: `jackPlaceSettled` line 215 | (a) Toss is random with no coin and no terrain/starting-point choice; the first circle is fixed at (2, 1). (b) Feet in circle not checked (character always stands in it; no foot fault). (c) Second bad placement gives a yellow card every time, forever; no escalation to a card for the whole team (Art. 35). (d) The opponent cannot move the circle back when placing (the code moves it at the start of the mène instead). (e) No one-minute jack limit (Art. 21). (f) Who throws the jack is free (matches the rule). | Low | Escalation after the second yellow (orange card = lose a boule, or just a text). Not needed for gameplay. | `jackPlaceSettled` three times with an invalid spot: assert the card count and a defined consequence. |
| 7 | Valid thrown jack: 6 to 10 m from the circle edge; centre of circle 1 m from obstacles; jack 50 cm from the end line (no minimum from side lines); jack visible; next circle around the last jack, stepped back if needed; the thrower's team still plays first after an invalid jack; 1 minute to throw. | Partly | `rules.js` `jackValid` line 75 and `JACK_END_MARGIN` line 66; `jackFault` line 127; `court.js` `nextCircle` (`FRONT_MIN` 10, `FRONT_WANT` 11, `COURT_MARGIN` 1); first boule: `nextTeam` via `lastThrower ?? jackTeam` | (a) Distance is centre of circle to the jack centre, not the circle edge: both limits are 25 cm too tight (Medium). (b) End line: centre more than 0.5 m (user rule E20, matches the text). Side lines: no margin, in while any part is inside (E20; matches Art. 9). (c) Jack visibility from the circle (7.4) is not checked (Low; nothing hides a jack on this court). (d) `FRONT_MIN` 10 m measured to the front of the ring; a 10 m jack needs 10.5 m of front to satisfy 7.3, so for fronts 10 to 10.25 m the longest throw is invalid (Low). (e) The ring is kept at least 1 m from the side strings (the rule says 1 m from obstacles, strings are not obstacles): a circle around a jack lying within 1 m of a side line is moved sideways (Low). (f) Placing team cannot move the circle back (Low). (g) The team that threw plays first after an invalid jack: Implemented, tested. | Medium | `jackValid`: use `dist(jack, circle) - circle.r` for 6 and 10 (add `circle.r` to geometry, 0.25). Update zone drawing, AI jack aims and tests that assume centre distances. Decide first with the user (it changes what existing tests, `jackValid` at `y` 7 and 11, mean). | `jackValid` at centre distance 6.1 m is invalid, at 6.26 m valid, at 10.2 m valid, at 10.3 m invalid. |
| 8 | Thrown jack stopped or invalid (stopped by an umpire, opponent, team member; objections). | Not applicable | n/a (no spectators or umpires in the game; invalid throws go to Art. 7 handling) | The game decides validity once, from the resting jack (E08), with no objection phase. | - | None. | None. |
| 9 | Dead jack: (1) wholly out of bounds, even if it returns; straddling is valid; (2) not visible from the circle (masked by a boule is not dead); (3) displaced to more than 20 m or less than 3 m from the circle; (4) crosses lanes; (5 to 7) lost, out-of-bounds area in between, timed game. | Partly | 9.1: `physics.js` `checkDead` (dead is sticky, centre beyond `r`; `C.deadMargin` 0); `rules.js` `jackValid`; `jackFault` 'out' | 9.1 Implemented (a jack that returns stays dead; tested in rules and jack-judge). 9.2 not implemented (Low: no obstacles hide a jack). **9.3 not implemented**: a jack knocked to less than 3 m from the circle stays in play (Medium). More than 20 m cannot happen on 15 m. 9.4 to 9.7 not applicable (single lane, no search). | Medium | After each throw settles, if the jack is alive and inside 3 m of the circle centre (or edge; see 7.1), mark it dead (`rules.js` `throwSettled`, then the usual dead-jack scoring). Both need a decision on the circle edge. | `throwSettled` with jack at 2.9 m from the circle and both teams holding boules is a void mène; at 3.1 m the mène continues. |
| 10 | Obstacles: no pressing down or removing; fill holes made by a boule; testing the landing point. | Not applicable | `terrain.js` divots persist for the mène, reset between mènes | Players do not repair divots during a mène; that is optional in the rule ("may fill in"). | - | None. | None. |
| 11 | Changing jack or boule when lost or broken. | Not applicable | n/a | Cannot happen in the simulation. | - | None. | None. |
| 12 | Jack masked or displaced: moved by wind, slope, umpire, spectator: put back. Moved by a boule played in this game: valid. | Implemented | `physics.js` (boules push the jack; the jack's final rest is read in `main.js` `snapshot` line 1790 and `throwSettled`) | The only applicable part (moved by a boule: valid) is implemented. | - | None. | A shot that moves the jack leaves it valid at the new place, mène continues (add if absent). |
| 13 | Jack moved into another game. | Not applicable | n/a | One court. | - | None. | None. |
| 14 | Dead jack: (1) both teams have boules: void, same jack thrower; (2) one team: scores the boules it still holds; (3) none: void. | Implemented | `rules.js` `endMene` line 169, `deadJackText` line 161; `apply` `nextMene` keeps `jackTeam` on a void mène | Correct. The boules in hand are counted after the boule that killed the jack was thrown (correct: it is no longer "to be played"). Tested in `dead jack: void if both have boules, else holder scores its boules`. | - | None. | Existing. |
| 15 | Jack stopped or deviated by spectator, umpire or player (opponent chooses the new position); jack that leaves and comes back is dead. | Implemented | `physics.js` `checkDead` (sticky dead); no humans touch the jack in play | The last paragraph (leaves, returns: dead, Art. 14 applies) is implemented. 15.1 and 15.2 describe people stopping balls: not applicable. | - | None. | Existing jack-judge test; add one that a jack going out and rolling back still ends the mène by Art. 14. |
| 16 | Throwing order: first boule by the team that won the draw or scored last; afterwards the team that does not hold the point; **first boule out: opponent plays first, then alternately while there are no boules on the terrain**; if shooting leaves no boule, Art. 29 applies. | Partly | `rules.js` `nextTeam` lines 144 to 158 | Team not holding the point plays, team with no boule on the ground plays, one team out of boules: implemented and tested. **First boule out (or all boules out): the same team throws again instead of the opponent (High).** See (c). | High | In `nextTeam` (see (c) for the exact change). | See (c). |
| 17 | Behaviour of players and spectators. | Not applicable | n/a | Etiquette. (The game keeps players off the court while a boule flies: `main.js` `fetchGate`.) | - | None. | None. |
| 18 | No test throws; boules going outside the marked terrain are valid except per Art. 19. | Implemented | `physics.js` `checkDead`; boules keep moving as ghosts after going out | Consistent: a boule outside the strings but not wholly beyond them is valid. | - | None. | None. |
| 19 | Dead boules: dead once wholly beyond the boundary seen from above, and stays dead if it returns; anything it displaced after going out is put back; dead boules are removed. | Implemented | `physics.js` `checkDead` (centre beyond `r`), ghost flag (no collisions with other bodies, line 442), `deadRowSlot` / `dropDead` (dead row beyond the far string); `rules.js` `measure` ignores `dead` | Matches, including the displaced-things rule (ghosts pass through boules and the jack). "Considered live when the opponent plays" (default if the dead boule is not removed) is a refereeing rule: not needed. Ghost stopped after 3 s (`C.ghostMaxTime`): simplification, no gameplay effect. | - | None. | A boule that goes out and rolls back through boules moves none of them (check exists in physics tests; add a rules-level one). |
| 20 | Stopped boules (by spectator, umpire, own team, opponent). | Not applicable | n/a | Nobody stops a ball in this game. | - | None. | None. |
| 21 | One minute per boule (and per jack throw), clock starts when the previous ball stops or after measuring; yellow card for the team. | Not implemented | no turn timer anywhere (`main.js` has none) | No time limit at all; a player (or the human) can take as long as they like. | Low | Optional: a soft 60 s turn timer with a visible countdown and a yellow-card text, or leave as a deliberate omission (not fun in a casual game). | If built: with the clock past 60 s the human's turn gets a warning (clock test). |
| 22 | Displaced boules: put back if moved by wind, slope, a person; a boule moved by a boule of the same game stays. | Implemented | `physics.js`; `main.js` `snapshot` reads final rest positions | The applicable part is the default behaviour of the simulation. | - | None. | None. |
| 23 | Playing another player's boule. | Not applicable | n/a | Boules are tied to their owner by the game. | - | None. | None. |
| 24 | Boules thrown contrary to the rules are dead (unless the opponent accepts). | Not applicable | n/a | No foot faults, no illegal throws exist in the game. If foot faults are ever added, this is the rule. | - | None. | None. |
| 25 | Temporary removal of boules to measure. | Not applicable | `main.js` `endOfMene` measures automatically | The computer measures; nothing is picked up. | - | None. | None. |
| 26 | Measuring is the thrower's team's job; opponents may re-measure; instruments, not feet; umpire decides. | Implemented | `rules.js` `measure`, `meneResult` (centre distances; all boules share one radius, so identical to surface distance); `main.js` shows surface gaps (`gapM`) | Automatic and exact, at least as precise as a gauge. | - | None. | Existing scoring tests. |
| 27 | Removed boules: picking up boules before the end is forbidden. | Not applicable | `main.js` fetch flow only fetches dead boules during play | Players only fetch dead boules, as a courtesy. | - | None. | None. |
| 28 | Disturbing the jack or a boule while measuring loses the point. | Not applicable | n/a | Nothing is touched when measuring. | - | None. | None. |
| 29 | Equal distance: (1) no boules in hand: end void, same jack thrower; (2) one team has boules: it plays them and scores those closer than the nearest opponent boule; (3) both have boules: the team that played last plays again, then alternately; no boules left on the terrain: end void. | Implemented | `rules.js` `holdingTeam` line 101 (returns 'tie' at 1 mm), `nextTeam` (tie: last thrower), `meneResult` (tie: void; points strictly nearer), `endMene` | All three cases and "no boule left: void" are correct and tested (`equidistant tie: team that threw last plays again`, `scoring ignores dead boules; no boules or tie is void`). The tie tolerance is 1 mm; main.js's void explanation uses 2 mm (cosmetic mismatch, Low). | Low | Unify the two tolerances (use `TIE_EPS` in `main.js` line 2117). | A tie at 0.0015 m and a message check. |
| 30 | Foreign bodies on boules or jack. | Not applicable | n/a | No mud in the game. | - | None. | None. |
| 31 | Complaints. | Not applicable | n/a | No umpire. | - | None. | None. |
| 32 | Absent teams. | Not applicable | n/a | Tournament admin. | - | None. | None. |
| 33 | Late arrival of players. | Not applicable | n/a | Tournament admin. | - | None. | None. |
| 34 | Replacement of a player. | Not applicable | n/a | Tournament admin. | - | None. | None. |
| 35 | Penalties: yellow, orange (lose the boule), red, team disqualification. | Partly | `rules.js` `jackPlaceSettled` `yellowCards`; `main.js` `placeDone` (yellow card overlay, same team places again) | Only the yellow card for a bad jack placement exists; no orange card for the repeat, no cards for other faults (there are none to commit). | Low | Optional escalation (see Art. 6). | See Art. 6. |
| 36 | Bad weather. | Not applicable | n/a | n/a | - | None. | None. |
| 37 | New phase of play. | Not applicable | n/a | Tournament admin. | - | None. | None. |
| 38 | Lack of sportsmanship. | Not applicable | n/a | n/a | - | None. | None. |
| 39 | Bad behaviour, dress, smoking, phones. | Not applicable | n/a | n/a | - | None. | None. |
| 40 | Duties of the umpires. | Not applicable | n/a | n/a | - | None. | None. |
| 41 | Jury; cases not provided for. | Not applicable | n/a | n/a | - | None. | None. |

Rule items that are correct and worth keeping tested (not separate articles): the winner of a mène throws the next jack, a void mène keeps the same team (Art. 6/14/16, `mène ends when no boules remain; winner throws next jack...`, `void mène keeps the same jack team`); scoring counts the winner's boules nearer than the opponent's nearest (Art. 29.2 wording, `scoring counts closer boules...`); the new circle goes around the last jack (Art. 7, `court.js` `nextCircle`, `court.test.js`).

Deliberate extras not in the rules (see d): E15 early game end, F31 score cap.

## (c) First boule of a mène goes out of bounds

### The rule, verbatim

Art. 16 (Throwing of the first and following boules):

> The first boule of an end is thrown by a player belonging to the team that has won the draw or has been the last to score. After that, it is the team that does not hold the point that plays.

> If the first boule played goes out-of-bounds, it is for the opponent to play first then alternately so long as there are no boules on the designated terrain.

> If, after shooting or pointing, there are no boules left in the authorised area, the provisions of article 29 relating to boules equidistant from the jack apply.

Art. 19 (Dead boules), relevant parts:

> Any boule is dead from the moment that it enters an out of bounds area. A boule straddling the boundary line of the authorised playing area is valid. The boule is dead only after having completely crossed the boundary of the allotted playing area, that is to say, when it is situated entirely beyond the boundary when viewed from directly above.
> If the boule comes back into the playing area, either because of the slope of the ground or by having rebounded from an obstacle, moving or stationary, it is immediately taken out of the game and anything that it has displaced after its passage into an out of bounds area is put back in place provided these objects have been marked.

Art. 29 (Boules equidistant), relevant part:

> 3) If both teams have boules at their disposition, it is for the team which played the last boule to play again, then the opposing team, and so on alternately until the point belongs to one of them.
> If, after completion of the end, no boules remain within the authorised playing area, the end is null and void.

Art. 9 and 14 (jack out of bounds), for contrast: the jack is dead when wholly beyond the boundary, even if it returns; with both teams holding boules the end is void and the jack is thrown again by the team that scored the previous end or won the toss; with one team holding boules it scores them; with none the end is void.

### What the rules say, in sequence

| Question | Answer from the text |
|---|---|
| Does the dead boule count as played? | Yes. It was thrown, is out of the game (Art. 19), and is not replayed (Art. 16: "any boule thrown cannot be replayed"). The thrower's boule count goes down by one. |
| Does the mène continue? | Yes. Only a dead jack ends the mène early (Art. 9 and 14). A dead boule is simply removed. |
| What happens to the jack? | Nothing: the jack stays where it is, valid. (A jack knocked out by that boule is a separate case: Art. 14.) |
| Who throws next? | The opponent ("for the opponent to play first"). |
| Then? | "Alternately so long as there are no boules on the designated terrain." So if the opponent's boule also goes out, the first team plays again, and so on, one at a time, until some boule stays in. Once a boule is on the terrain, the normal rule applies: the team that does not hold the point plays. |
| Does the opponent start the mène? | Effectively yes: the opponent plays the second boule of the mène; the jack thrower's team still threw the first boule (and still has the jack rights for the next end per Art. 14/6). |
| If the boules run out with none on the terrain? | The end is null and void (Art. 29, last sentence): no points; same jack team throws next. |

Ambiguity: the third Art. 16 paragraph says that if, after shooting or pointing, nothing is left on the terrain, Art. 29 applies (the team that played last plays again). Read together, there are two cases: (i) no boule has ever stayed in play, all dead (the "alternately" sentence); (ii) boules were on the ground and a shot cleared them (Art. 29: last player plays again). The text does not say which case a "shot that removes everything" belongs to if the shooter's own boule also left, but the Art. 16/29 pointer clearly sends it to Art. 29. This audit recommends reading (ii) literally, keeping today's behaviour for that case, and changing only case (i).

### What the code does today

1. `rules.js` `nextTeam` (lines 144 to 158):
   - `last = match.lastThrower ?? match.jackTeam`.
   - `live = [0, 1].map(t => match.boules.some(b => !b.dead && b.team === t))`.
   - Line 154: `if (!live[0] && !live[1]) return last;` so when no live boule is on the ground, **the team that threw last throws again**.
2. At the first boule: `lastThrower` is null after `jackThrown` or `jackPlaceSettled`, so `last` is `jackTeam`, the team that threw the first boule. If that boule is dead (`physics.js` `checkDead`, the event reaches `rules.js` as `dead: true` in `throwSettled`, line 233), no team has a live boule, and `nextTeam` returns `jackTeam` again.
3. `main.js` `nextTurn` (line 1747) calls `nextTeam(match)` and starts that team's turn; the HUD says "Your team throws next" or "X to throw". `describe` (line 1800) announces "<owner> boule is out: dead boule." and `kickFetch` sends a team-mate to bring the dead boule to the row beyond the far string. Nothing in `main.js` overrides the order.
4. Verified by running the reducer (a scratch script, not committed): a match with the jack at (2, 8) and four consecutive dead boules gives the throw order `0, 0, 0, 0`. The same team keeps throwing until it has no boules; only then does `nextTeam` hand over because the other team is the only one with boules in hand (line 150).
5. Existing test that pins the wrong behaviour: `tests/petanque/rules.test.js` line 96, `nobody on the ground: last thrower throws again`: team 0's only boule is dead, expects `nextTeam(m) === 0`. By Art. 16 it must be 1.
6. The tests that surround it are correct and must keep passing: `team with no live boule on ground throws; dead boules do not count` (team 0's boule is live, team 1's is dead: team 1 plays again because team 0 holds the point, which is what Art. 16 says) and `equidistant tie: team that threw last plays again` (Art. 29.3).
7. Everything else about the dead boule is right: dead the moment it is wholly beyond a string (`checkDead`, `deadMargin` 0), stays dead if it returns, ghosts through the other boules and the jack (Art. 19), removed from `measure` (`dead` filtered), the jack unaffected, the mène continues, the boule count is decremented in `bouleThrown` (line 222).

### The concrete difference

| Situation | Rule | Code | Impact |
|---|---|---|---|
| First boule of the mène is dead | Opponent plays next | Same team plays again | High: the team that threw out gets a free retry, and the opponent is denied its turn. A bad first throw costs nothing, which also warps the AI's risk evaluation (a risky first boule is free). |
| First boule dead, then opponent's boule dead | First team plays again (alternate) | Opponent plays again | Same bug, other side. |
| Any number of consecutive dead boules from the start | Strict alternation | The first team throws all its boules until it runs out | Up to 6 consecutive throws by one team (human team: the human is told "your team throws next" repeatedly). |
| Boules were on the ground and a shot clears all of them (shooter out too) | Art. 29 via Art. 16: last player plays again | Last thrower plays again | Correct today; must not be changed by the fix. |
| Both teams have nothing left and no live boule | Void mène | Void ('No live boules on the court: mène void.', `endOfMene`) | Correct. |

### Suggested fix (not applied)

- Add one bit of state to the match: "has any boule stayed in play this mène" (call it `stayed`, set to true in `throwSettled` when any non-dead boule is on the ground, reset by `jackThrown`, `jackPlaceSettled` and `nextMene`).
- In `nextTeam`, line 154: `if (!live[0] && !live[1]) return match.stayed ? last : 1 - last;` where `last` is the team of the last boule thrown (the first team at the start). With `stayed` false and no boule thrown yet, `last` is `jackTeam` and the answer is `jackTeam`, as now.
- A subtle point: "last" must be the team of the last thrower, so for the alternate order `1 - last` it works after each throw (0 then 1 then 0 ...).
- AI check: `tactics.js` and `ai.js` do not call `nextTeam`; only `main.js` and the test drivers (`match.test.js`, `court-match.test.js`, `partner.test.js`, `measure-*.js`) do. `tests/petanque/match.test.js` plays full AI-v-AI matches and will exercise the new order.

### Suggested tests

1. `first boule dead: the opponent throws next` (replaces `nobody on the ground: last thrower throws again`): `throwBoule` with a dead boule of team 0, `nextTeam === 1`.
2. `all boules dead: strict alternation`: dead boules thrown alternately by 0, 1, 0, 1: `nextTeam` gives 1, 0, 1, 0.
3. `a shot that clears the ground: the last thrower plays again (Art. 29)`: team 0 live boule on the ground, then team 1's shot leaves nothing live: `nextTeam === 1`.
4. `first boule dead, second live: the point holder is the second team's opponent`: after team 1's live boule, `nextTeam === 0`.
5. `six dead boules: mène void` (alternate order, all six thrown, `endMene` is void, same jack team).

## (d) Rules we deliberately simplify

From GAME-PLAN notes and backlog items (E15, F31, E20, D-series, physics notes):

| Simplification | Why |
|---|---|
| Doublette only, 2 v 2 with a human and a partner (GAME-PLAN section 5) | Four characters; the other formats are not offered. |
| 7-point quick game; no 11-point option (GAME-PLAN section 5) | Shorter session. Art. 5 allows 11 for leagues; 13 is the default. |
| Random coin toss with no terrain choice, a fixed first circle (GAME-PLAN section 5) | One court, no lanes. |
| E15: the game ends as soon as the points on the ground reach the target and only the holder still has boules (`clinchedOnGround`) | Leftover boules cannot change the result except by the holder adding points; skipping them keeps matches short. The real rule would have them played out. |
| F31: a team's score never exceeds the target (12 + 3 stored as 13) | Display and message simplicity. The real score could read 15, but the game is over anyway. |
| E20: the jack is judged at the side strings by "any part inside = in", and must be more than 0.5 m from the end string, measured to its centre (user-given rule) | Recent FIPJP change as relayed by the user; the text of Art. 7.3 and 9.1 is consistent with it. |
| Jack and boule distances use centres (and Art. 7.1 limits use the circle centre) | Simplicity of the zones; flagged as a discrepancy above (Art. 7.1). |
| Measuring is automatic and exact (centre distances, 1 mm tie tolerance) | No gauges, no re-measuring (Art. 25, 26, 28). |
| Dead boules go to a row beyond the far string (D11) and a dead jack is carried back (F10); ghosts stop after 3 s | Visible, tidy, a team-mate fetches them; Art. 19 only says "removed from the game". |
| Lumber 0.4 m outside the strings | Looks right, lets balls go out visibly; Art. 5 asks for 1 m. |
| No foot faults, no wrong-boule, no time limit, no umpire, no obstacle rules (Art. 6, 10, 17, 20 to 24, 31) | A relaxed single-player experience; nothing in the game can trigger them. |
| Card penalty only for a bad jack placement (E04) | The only fault the player can commit; no escalation. |
| Circle always 50 cm, moved around the last jack and stepped back so the front has 10 to 11 m to the far string (E10, E28) | Art. 7 asks the same, with the team choosing; the ring is also kept 1 m from side strings. |
