# Seattle Pétanque Club website

The source for [seattlepetanque.org](https://seattlepetanque.org). The site is a static website built with [Hugo](https://gohugo.io). Its content is Markdown files kept in this repo, and club members edit it in a browser through [Decap CMS](https://decapcms.org) at `/admin/`. The site is hosted on DreamHost. It was previously built with Publii.

## For club members: editing the site

1. Go to https://seattlepetanque.org/admin/ and log in with GitHub. Ask the site admin for access first.
2. To add an event, open **Events**, click **New Event**, and fill in the title, start date and time, and location. Add a description under **Details**. Optional fields such as photos, a map link, or a short summary can be left blank. Under **Photos**, click **Add photo** as many times as you like; each photo needs a short description for screen readers and can have a caption such as "Photo by Maggie".
3. **Upcoming and Past are automatic.** An event appears under Upcoming until its date has passed (or its end date, if you set one), then it moves to Past. You don't need to change anything. Recurring events, such as "Every Saturday 10am", always show under Upcoming.
4. The right side of the editor shows a preview of how your entry will look on the site. When you're happy with it, click **Publish**.
5. The change appears on the website a minute or so later. To fix a mistake, just edit the entry and publish again.

## For maintainers: running locally

You need [Homebrew](https://brew.sh) and Node.js (for `npx`).

1. Install Hugo:

   ```sh
   brew install hugo
   ```

2. Start the site:

   ```sh
   hugo server
   ```

   Then open http://localhost:1313.

3. In a second terminal, start the local CMS backend (pinned version):

   ```sh
   npx decap-server@3.11.5
   ```

   Then open http://localhost:1313/admin/. This edits your local files directly, so no GitHub login is needed.

Edits made through the local CMS write straight to your working copy. Review them with `git diff` before you commit.

## Pétanque game

The game is at `/game.html`. Its page is `content/game.md`, its template is `layouts/_default/game.html`, and its styles are in `assets/css/game.css`. The code is in `assets/js/petanque/`, bundled by Hugo's built-in `js.Build`, so building the site needs no `npm install`.

three.js 0.170.0 is vendored in `assets/js/vendor/` (see the README there for its source and licence), with its `GLTFLoader.js`. Nothing is loaded from a CDN at runtime.

Four player models are in `static/models/`: Marcel, Odette, Pierre and You, from the Kenney Mini Characters pack (CC0; see `static/models/CREDITS.md`). The players are stick figures from `character.js` by default (each with their own colours, hat, build and idle quirks, set in `personalities.js`); the models are opt-in with `?figures=mesh` and are not downloaded otherwise.

How it plays:

- Controls: drag sideways to turn; press on the court where the boule should land (the pale cone shows where it may land, the orange band how far it rolls), pull down to throw higher, release to throw; drag back up to cancel. Press near a boule to shoot it. The roll guide is always on while you aim. Three translucent press-and-hold icons sit under the hamburger button, on your turn only: Adjust view (four arrows: hold the arrow you want to look up, down, left or right; limited to 180 degrees sideways and 15 degrees up or down; aiming is off while you hold it), Read the ground (hold to see the slopes and firmness) and View (hold for the overhead view, let go to return to the shoulder view). From the keyboard, focus an icon and hold Space or Enter (the arrow keys pan when the pan icon is focused). The hamburger button opens a menu (Enter, Space or the down arrow opens it; arrows move, Esc closes) with Mode (Slow or Quick) and the temporary plane buttons. A speaker (mute), a fullscreen icon and a pause icon sit at the bottom right; the game never goes fullscreen by itself. The pause icon, or Esc, pauses the game in place (sepia scene you can orbit) and leaves only Resume, New game and End game; End game leaves the full-window view for the page, where Resume and New game remain.
- Modes: the Pace option on the setup card (and the Mode button in play) picks Slow or Quick, remembered in the browser. Slow: people walk to the circle, fetch dead and out-of-bounds balls round the outside of the timbers, the placer fetches a failed cochonnet, the last thrower carries the ring to its new place, players hold their boules in the hand and pick them up, and AI turns are shown by a casual-observer camera outside the side timber. Quick: everything moves into position at once; the thrower changes over with a short fade and a beat with the circle empty, and the ring just appears. Reduced motion always plays Quick.
- Court and moving circle: the throwing circle is a ring on the ground. Each new mène starts from a ring placed around the last cochonnet and is played the other way (toward y = 0 on every second mène). If less than 10 m of court is left in front of the ring it is moved back until about 11 m remain. `court.js` holds the one current circle and direction that the rules, AI, camera, zones and drawing all read. The cochonnet must land 6 to 10 m from the circle, inside the side strings (out only when wholly past one) and more than 0.5 m before the end string; otherwise the other team places it (a placed jack that rests invalid gets a yellow card and is placed again).
- Settings and cameras: AI turns use the observer camera in Slow mode and the game cameras (flight, head) in Quick mode; a hidden TV-style variant for Quick mode (`?debug&tvcam=a|b|c` or `localStorage petanque-tvcam`) tracks the boule from the side (a), from behind the jack (b) or with a crane (c). Your own turn always uses the shoulder view. The mène end looks nearly straight down on the scoring circle, which passes through the best rival boule, labels every scoring boule in cm (mm and "Close call!" when the gaps differ by under 2 cm) and keeps each number badge beside its boule.
- Pause: leaving the full-window view freezes everything (game clock, physics, walking, fades, audio), draws the scene in sepia and lets you drag to orbit and wheel or pinch to zoom round the court. Resume eases back.
- Partner and setup: the setup card lets you pick your partner from Pierre, Marcel or Odette (default Pierre; the other two are your opponents), remembered with the other options. The scoreboard, commentary and advice use that partner's name and character (skill, hand, Marcel as the shooter).
- Court: the gravel is grey with a hint of blue or sandy, a 50/50 pick from the seed, so a court looks the same through a game and a new game rerolls (`?debug&gravel=grey|sand` forces one). The cochonnet is orange on grey gravel and bright red on sand. A floatplane sometimes lands on or leaves the lake beside the court, in Slow mode only (never in Quick mode or with reduced motion); two temporary ✈ Landing and Takeoff buttons in the menu start one on demand.
- When both you and your partner have boules a card in the middle of the court asks who throws, with your partner's suggestion. Between throws the closest boule of each team is measured from the jack. The game also ends when the points on the ground already reach the target and the rest of the mène cannot change who holds them (13 on the ground); leftover boules are not played.
- Reduced motion: no walking (balls fade out and in), no sepia fade, no tree sway, no chevron bob, and a steadier camera.

The modules in `assets/js/petanque/`:

- `main.js`: boot, game loop, game flow, fetching, pause and wiring
- `rng.js`: seeded random numbers and noise
- `constants.js`: tuning values
- `terrain.js`: gravel heightfield, looseness, stones, divots and the pad under a placed cochonnet
- `physics.js`: boule and jack bodies, flight, impact and rolling, the timbers and ghost (out of bounds) balls
- `rules.js`: mène state, turn order, scoring, dead boules, jack placement rules
- `donnee.js`: the donnée throw model: launch solver, backspin from loft, error cones, difficulty scaling, the roll guide (`predictRoll`, `predictRollBand`)
- `tactics.js`: the AI's situation model, candidate families, evaluator, difficulty and personality tables, who throws, and the "why" of each decision (GAME-PLAN section 12)
- `ai.js`: Monte Carlo AI (successive halving over the tactics candidates), jack throws and jack placement
- `toss.js`: toss input: turn, place the donnée, pull for loft
- `character.js`: stick-figure players with procedural animation (walking, bending, carrying)
- `personalities.js`: looks, stances, quirks and commentary lines for each player
- `court.js`: the live throwing circle and playing direction, the next mène's circle, and geometry helpers
- `settings.js`: the play mode (remembered in localStorage) and the hidden TV camera choice
- `waiting.js`: where the players wait, beside the court and outside the timbers
- `fetch.js`: pure route planning for the players who fetch dead balls and place the cochonnet
- `clock.js`: the pause clock; every game delay (`sleep`, `later`) goes through it so a pause freezes them
- `camera.js`: pure framing: the flight camera that follows every moving ball, the casual observer, and the TV variants
- `render.js`: three.js scene, cameras, throw preview, measuring overlays, paused sepia pass
- `scenery.js`: grass, trees and the painted skyline (Mount Rainier, the Space Needle)
- `hud.js`: DOM HUD (setup, score, who-throws card, mène and game-over panels)
- `audio.js`: synthesized sounds (Web Audio)
- `models.js`: optional Kenney mesh models (`?figures=mesh`)

Run the tests with Node (no dependencies to install):

```sh
npm test
```

The tests are in `tests/petanque/`. Everything except the renderer and HUD (physics, rules, terrain, AI, tactics, camera framing, clock, fetch routes) has no DOM or three.js dependency, so it runs under Node. The `measure-*.js` scripts there are not tests; they print statistics (`measure-tactics.js` runs full matches: win rates by difficulty, decision mix, void rate, decision times).

To tune the game:

- Physics and terrain numbers: `constants.js`.
- Player skill and error cones: `SKILL` in `donnee.js`; the one difficulty scaling is `difficultyScale` in `donnee.js` (the AI's error multiplier: Easy 1.95, Medium 1.9, Hard 1.3); release height `releaseHeight`; tir aim `SNAP_SHORT`. `node tests/petanque/measure-human.js` compares a reasonable human with each AI difficulty, and `node tests/petanque/measure-release.js` checks roll-outs by style from each character's real release point.
- AI tactics (how often it shoots, how it values a point, tactical error rates by difficulty): `DIFFICULTY`, `profiles` and the evaluator weights in `tactics.js`; search effort and the 40 ms time guard: `AI` in `ai.js`; `DSCALE=1.9,1.9,1.3 node tests/petanque/measure-tactics.js 100` tries other scalings.
- Loft to backspin: `backspinForLoft` in `donnee.js`. Throw energy limit: `SKILL.*.maxSpeed` and `ENERGY_*` in `donnee.js`.
- Toss input feel: `TOSS` in `toss.js`. Roll band update thresholds: `ROLL_MOVE`, `ROLL_LOFT`, `ROLL_BLEND` in `main.js`.
- Fetching pace and the wait for a fetcher: `FETCH_SPEED`, `FETCH_VIEW_WAIT`, `CAST_SPEED`, `AI_MIN_THINK` in `main.js`. Flight camera: `CAM` in `camera.js`.
- Scenery and sounds: `scenery.js`, `audio.js`.

Debug URLs (add the query to `/game.html`; a debug mode that starts a match enters the full-window view by itself):

- `?debug`: turns on debug hooks (`window.__petanque`).
- `?debug&autotest`: AI-only quick match, with no delays (`&target=7`, `&animate` for real time, `&meneend` stops at the first mène end).
- `?debug&humanturn`: stops at your first boule. Use `?debug&humanturn=chooser` to stop at the who-throws card, or `?debug&humanturn=jack` to throw the jack yourself (`&thrower=pierre` and the like pick who throws first).
- `?debug&humanturn&demo`: a scripted toss preview with the roll band, for screenshots (`&loft=`, `&dist=`, `&dx=`, `&tir`, `&autothrow`).
- `?debug&play`: enters the full-window view without a click (combine with the others); logs scroll metrics to the console.
- `?debug&mene2`: the second mène, played toward y = 0 (`&ringcarry&slow` shows the ring carried back, `&ringheld` a still of it, `&jackplace` the placement view toward y = 0). `?debug&slow` keeps Slow mode under reduced motion; `&cam=game|tv` picks the AI-turn camera; `&tvcam=a|b|c` and `&tvshot` show the TV variants; `&hold` shows the held boules (`&backswing=`); `&closecall` forces a close call at mène end (with `&autotest&meneend`); `&jackplace&yellow` shows the yellow card; `&viewyaw=&viewpitch=&adjust` the Adjust view.
- `?debug&paused` (with `&humanturn`): leaves the full-window view at the human's turn, so the paused sepia view shows.
- `?debug&announce=carreau|biberon`: previews the CARREAU ! / BIBERON ! overlay (shown for real after a settled throw in the animated modes); `&once` shows it a single time, `&still` holds a static frame.
- `?debug&aispot`: holds the view on the AI's spot, with the arc and cone the players never see, for screenshots.
- `?debug&jackplace` (Marcel's jack fails and you place it) or `?debug&jackplace=ai` (the AI places it); `&jx=&jy=` where the failed jack lay, `&px=&py=` shows your marker, `&jphold` keeps the AI's marker up.
- `?debug&fetch`: a scripted fetch of a dead boule and cochonnet and the hand-over and placement (`&fetchat=seconds` freezes it then, `&followc=pierre` with `&dist &az &el` for a close camera, `&fetchcam`, `&jx=&jy=`, `&lx=&ly=`).
- `?debug&measure`: the between-throws measuring lines. `?debug&lumber`: ghost balls against and beyond the timbers (`&lx &ly &dist &az &el`). `?debug&jackshot`: a boule shot into the cochonnet with the flight camera (`&jspeed &jloft &jyaw`, `&freezeat=0.6`).
- `?debug&ailog`: one console line per AI boule (plan and result). `?debug&sounds`: audition panel for the synthesized sounds.
- `?debug&gravel=grey|sand`: force the court gravel (grey with a hint of blue, or sandy); by default a 50/50 pick from the seed. The cochonnet is orange on grey gravel and bright red on sand.
- `?debug&jackvis=a|b|c|ab|…|none`: compare cochonnet finders (chevron, ground halo, bright colour).
- `?debug&topcam`: top-down view of the circle (`&who=pierre|marcel|odette`, `&topdist=`, `&topel=`, `&topaz=` for a side view), for checking foot placement.
- `?debug&preview`: static throw preview with made-up paths (`&zone`, `&snapped`), for screenshots.
- `?debug&characters`: all the stick-figure stances side by side, for screenshots. Add `&cast=quirk` (with `&q=0..2` for which quirk), `&cast=celebrate` or `&cast=dismay` for the four real players, `&closeup`, `&freezethrow`. `&figures=mesh` there too for the models.
- `?debug&freezethrow` (in a match), `&freezeat=T` (stop the simulation at T seconds), `&timerframes` (drive frames from timers; it can hang headless Chrome, so use `--virtual-time-budget` without it).
- `?figures=mesh`: use the Kenney mesh models instead of the stick figures (`?figures=stick` is the default).
- `?seed=N`: fixes the court and random numbers, so the same N gives the same game.

`GAME-PLAN.md` describes the design. `GAME-BACKLOG.md` lists the work items and their history.

## Repo layout

```
hugo.toml                 Hugo settings (URLs, menus, output formats)
package.json              npm test script (no dependencies)
content/
  _index.md               home page
  links.md                links page
  game.md                 game page (/game.html)
  events/<slug>.md        one file per event
  blog/<slug>.md          one file per blog post
data/settings.yaml        site-wide settings (name, tagline, footer, etc.)
assets/
  css/game.css            game styles
  js/petanque/            game code (ES modules, bundled by Hugo)
  js/vendor/              vendored three.js 0.170.0
layouts/                  page templates (Go templates)
  _default/game.html      game page template
static/
  images/                 uploaded images (Decap media folder)
  admin/                  Decap CMS admin page and config.yml
  models/                 player models (Kenney Mini Characters, CC0) and CREDITS.md
deploy/                   scripts for building the site on the host
backups/                  old Publii backups, kept for history
tests/petanque/           Node tests for the game
GAME-PLAN.md              game design
GAME-BACKLOG.md           game work items and history
```

The `events/` and `blog/` folders have no `_index.md` file on purpose. Decap would list it as an entry.

## Deploying

The site is built on the DreamHost host, not on your computer. On every push to `main`, a GitHub webhook starts `deploy/deploy.sh` on the host. That script pulls the latest code and runs the Hugo build into the web root. A nightly cron job runs the same script, so past events move to Past even when nothing has been pushed. If a build fails, the live site keeps the last good version.

For setup steps, the webhook configuration, the cron job, and log and rollback instructions, see [deploy/README.md](deploy/README.md).

## Old Publii backups

The `backups/` folder holds the tar backups of the old Publii site, kept for history. They are raw data dumps and include some personal details, so they are not used by the live site. The host keeps a partial, sparse clone of this repo that leaves out `backups/`, so those files are never downloaded to the server.
