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

The modules in `assets/js/petanque/`:

- `main.js`: boot, game loop, and wiring
- `rng.js`: seeded random numbers and noise
- `terrain.js`: gravel heightfield, looseness, stones and divots
- `physics.js`: boule and jack bodies, flight, impact and rolling
- `rules.js`: mène state, turn order, scoring, dead boules
- `ai.js`: Monte Carlo AI
- `donnee.js`: the donnée throw model: launch solver, backspin from loft, error cones
- `toss.js`: toss input: turn, place the donnée, pull for loft
- `character.js`: stick-figure players with procedural animation
- `render.js`: three.js scene and cameras
- `hud.js`: DOM HUD (setup, score, who throws, mène and game-over panels)
- `audio.js`: synthesized sounds (Web Audio)
- `constants.js`: tuning values

Run the tests with Node (no dependencies to install):

```sh
npm test
```

The tests are in `tests/petanque/`. Physics, rules, terrain and AI have no DOM or three.js dependency, so they run under Node.

To tune the game:

- Physics and terrain numbers: `constants.js`.
- Player skill and error cones: `SKILL` and `difficultyScale` in `donnee.js`; release height `releaseHeight`; tir aim `SNAP_SHORT`; AI style personality `AI.stylePref` in `ai.js`. `node tests/petanque/measure-human.js` compares a reasonable human with each AI difficulty.
- Loft to backspin: `backspinForLoft` in `donnee.js`.
- Toss input feel: `TOSS` in `toss.js`.
- AI strength: `AI` in `ai.js`.

Debug URLs (add the query to `/game.html`):

- `?debug`: turns on debug hooks.
- `?debug&autotest`: AI-only quick match, with no delays.
- `?debug&humanturn`: stops at your first boule. Use `?debug&humanturn=chooser` to stop at the who-throws chooser, or `?debug&humanturn=jack` to throw the jack yourself.
- `?debug&humanturn&demo`: a scripted toss preview, for screenshots.
- `?debug&aispot`: holds the view on the AI's spot, for screenshots.
- `?debug&preview`: static throw preview with made-up paths, for screenshots.
- `?debug&characters`: all the stick-figure stances side by side, for screenshots. Add `&cast=quirk` (with `&q=0..2` for which quirk), `&cast=celebrate` or `&cast=dismay` for the four real players. `&figures=mesh` there too for the models.
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
