# Migration plan: Publii → Hugo + Decap CMS (DreamHost)

## Architecture

- **Source of truth:** this GitHub repo. Content is Markdown with YAML front matter.
- **Editing:** Decap CMS at `/admin/`. Editors log in with GitHub; locally, use `npx decap-server`.
- **Build and host:** DreamHost shared hosting. On every push, a GitHub webhook calls `hooks.seattlepetanque.org/deploy.php`, which runs `deploy/deploy.sh` (git pull + hugo build) into `~/seattlepetanque.org`. A nightly cron job also runs `deploy.sh` so past events roll over from "Upcoming" to "Past" automatically.
- **Host clone:** a partial clone with sparse checkout, so `backups/` is never downloaded to the host.
- **URLs:** keep the old Publii URLs (`/events.html`, `/links.html`, `/history-of-petanque-in-the-northwest.html`). Hugo `uglyURLs` plus `aliases` handle anything that moves.

## Repo layout

```
hugo.toml
content/
  _index.md                 home page
  links.md
  events/<slug>.md          one per event
  blog/<slug>.md
data/settings.yaml          site-wide settings editable in Decap
layouts/                    templates (Go templates), theme TBD
static/
  .htaccess
  images/                   Decap media_folder
  admin/index.html, admin/config.yml
deploy/                     host-side scripts (sftp these once)
backups/                    old Publii backups (excluded from host clone)
```

## Content schema (front matter)

**Event (`content/events/*.md`)**

| field | type | notes |
|---|---|---|
| title | string | required |
| date | datetime | start; required |
| end_date | datetime | optional; used to decide past/upcoming if set |
| location | string | optional |
| map_url | string | optional |
| photos | list | optional, zero to many; each item `{image, alt, caption}`: image is a path like `/images/foo.jpg`, alt is the description (required for each photo), caption is optional. The first photo is the list thumbnail and og:image |
| summary | string | optional, one line for listings |
| recurring | string | optional free text, e.g. "Every Saturday 10am"; recurring events always show as upcoming |
| body | markdown | |

An event is **past** when `(end_date or date)` is before the build date (end of day, local time).

**Blog post (`content/blog/*.md`)**: title, date, author, image, image_alt, summary, body, aliases (optional).

**Home (`content/_index.md`)**: title, hero_heading, hero_image, hero_image_alt, body.

**Links (`content/links.md`)**: title, body.

**data/settings.yaml**: site_title, tagline, facebook_url, contact_email, footer_text, events_intro, blog_intro (Markdown).

The `events/` and `blog/` folders deliberately have **no `_index.md`**. Decap would list it as an entry, so the section intros live in settings instead.

## Backlog

- [x] 0. Install Hugo locally (brew, v0.169).
- [x] 1. Scaffold the Hugo project: hugo.toml (uglyURLs, baseURL, taxonomies off), .gitignore (public/, resources/, .hugo_build.lock), dirs.
- [x] 2. Migrate content from backup db.sqlite → Markdown per schema. Copy the original images, logo, favicon and hero to static/images. Split the Events page into event entries. Drop the trashed post.
- [x] 3. Minimal functional layouts: baseof, home, single, events list (upcoming/past), blog list, 404, RSS at /feed.xml, sitemap. Unstyled placeholder CSS.
- [x] 4. Decap admin: static/admin/index.html (pinned decap-cms version) + config.yml (github backend, local_backend: true, collections per schema, editorial_workflow).
- [x] 5. Old URL compatibility: verify the build produces /events.html, /links.html, /history-of-petanque-in-the-northwest.html, /404.html. Add aliases for /seattle-petanque-club.html and /tags/blog/.
- [x] 6. Deploy kit in deploy/: deploy.sh, hooks/deploy.php, setup-host.sh (install hugo to ~/bin, partial+sparse clone), crontab.txt, README with step-by-step host setup + GitHub webhook + OAuth notes.
- [x] 7. Verify locally: hugo build with no warnings, decap-server + admin loads, upcoming/past logic checked by faking dates.
- [x] 8. Theme options: build 3 design directions and let the user choose. **Needs user input.**
- [x] 9. Apply the chosen theme. Add a Decap preview stylesheet.
- [x] 10. GitHub OAuth for Decap in production (Cloudflare Worker proxy or PHP on DreamHost). **Needs a user decision and accounts.**
- [~] 11. Update README.md with how to edit, run locally, and deploy. Final review. Ready to commit (ask the user before committing).

## Log
- Items 1, 2 and 4 are done. Section `_index.md` files were removed because Decap listed them as entries.
- Content TODOs for the user: Jouval 2024 date confirmed as 2024-08-18. Confirm the event start times (placeholder 10:00). The tagline and footer text were written by the agent. No contact email exists in the source.
- Item 6 is done. On review: rsync now excludes `/.well-known/` (DreamHost Let's Encrypt), and the scripts are committed with the executable bit set. Not yet tested on the real host: PHP, flock, Apache rules.
- Items 3, 5 and 7 are done. Changes in hugo.toml: buildFuture, section URL cascades, locale. Old tag/author URLs redirect via .htaccess RedirectMatch, and the home alias is /seattle-petanque-club.html. Local check: hugo server :1313 and `npx decap-server@3.11.5` both work, and the local backend lists events. The Decap UI has not been clicked through in a browser yet.
- Placeholder event times were removed (date-only), so the site doesn't show made-up "10:00 AM" times.
- Item 8: three themes built (provencal, parkside, clubhouse), selected with `params.theme` or HUGO_PARAMS_THEME. Waiting for the user to choose. Polish noted for item 9: the footer should stick to the bottom on short pages, and the home page repeats the welcome heading (hero plus the first line of the body).
- README rewritten (item 11 partial). Final review still pending.
- **Blocked on the user:** theme choice (item 8) and the production login approach (item 10).
- Items 8 and 9: the user chose the **bistro** theme (French café). It is now the default, and the other three themes were deleted. The footer is sticky, the reading column is centered, the duplicate home heading is gone, and the Facebook link reads "Visit our Facebook Page". 
- Item 10: the user chose GitHub logins plus the PHP OAuth helper (deploy/hooks/oauth.php, config in ~/.decap-oauth.ini, scope public_repo since the repo is public). Reviewed the code, but it is untested until it runs on DreamHost. .htaccess now redirects www to the bare domain over HTTPS.
- Renamed News to Blog throughout: menu, /blog.html, content/blog, layouts/blog, Decap collection "blog", settings.blog_intro. /tags/* and /authors/* redirect to /blog.html.
- Events now take a `photos` list (image, alt, caption per item) instead of image/image_alt; the event page shows a gallery and the first photo is the list thumbnail and og:image.
- Decap preview pane now matches the site: Hugo publishes /admin/preview.css (main + bistro, from layouts/index.html), and static/admin/preview.js registers preview templates for events, blog, home and links. Verified with headless Chrome screenshots.
- Fix: the preview.css publish block had been placed outside `define "main"` in layouts/index.html, which blanked the home page. Moved it into baseof.html <head>.
- Fix: the moved preview block shadowed `$theme` (body class broke, so no theme CSS), so it now reuses `$tc`. The Google Fonts URL was being URL-escaped, so DM Serif Display never loaded; fixed with safeURL. Run the dev server with --disableFastRender, since fast render kept serving stale templates.
