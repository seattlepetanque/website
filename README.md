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

## Repo layout

```
hugo.toml                 Hugo settings (URLs, menus, output formats)
content/
  _index.md               home page
  links.md                links page
  events/<slug>.md        one file per event
  blog/<slug>.md          one file per blog post
data/settings.yaml        site-wide settings (name, tagline, footer, etc.)
layouts/                  page templates (Go templates)
static/
  images/                 uploaded images (Decap media folder)
  admin/                  Decap CMS admin page and config.yml
deploy/                   scripts for building the site on the host
backups/                  old Publii backups, kept for history
```

The `events/` and `blog/` folders have no `_index.md` file on purpose. Decap would list it as an entry.

## Deploying

The site is built on the DreamHost host, not on your computer. On every push to `main`, a GitHub webhook starts `deploy/deploy.sh` on the host. That script pulls the latest code and runs the Hugo build into the web root. A nightly cron job runs the same script, so past events move to Past even when nothing has been pushed. If a build fails, the live site keeps the last good version.

For setup steps, the webhook configuration, the cron job, and log and rollback instructions, see [deploy/README.md](deploy/README.md).

## Old Publii backups

The `backups/` folder holds the tar backups of the old Publii site, kept for history. They are raw data dumps and include some personal details, so they are not used by the live site. The host keeps a partial, sparse clone of this repo that leaves out `backups/`, so those files are never downloaded to the server.
