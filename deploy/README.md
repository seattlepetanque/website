# Deploying to DreamHost

The site is built on the DreamHost host. On every push to `main`, a GitHub webhook
starts `deploy/deploy.sh`. A nightly cron job runs it too, so past events roll over
to "Past" on their own.

Only `deploy/setup-host.sh` must be copied to the host by hand. After that, everything
comes from git.

## 1. Enable SSH

In the DreamHost panel, turn on SSH/SFTP for user `dh_jsaetx` (Users > Manage Users,
or the SSH setting for that user). Then connect:

```sh
ssh dh_jsaetx@<your-dreamhost-host>
```

## 2. Back up the current live site

The first deploy replaces everything in `~/seattlepetanque.org`. Before running it, keep a copy of the old Publii site:

```sh
tar czf ~/publii-site-$(date +%F).tgz -C ~ seattlepetanque.org
```

## 3. Run the setup script

Copy only the setup script to the host, or pull it straight from a clone you already have:

```sh
scp deploy/setup-host.sh dh_jsaetx@<host>:
ssh dh_jsaetx@<host>
sh ./setup-host.sh
```

The script is idempotent, so it is safe to re-run. It does the following:

- installs hugo 0.169.0 to `~/bin/hugo` (extended build, falling back to standard)
- clones the repo to `~/site-src` as a partial, sparse checkout that leaves out `backups/`
- creates `~/.deploy-secret` if it is missing, and prints it once
- creates a template `~/.decap-oauth.ini` if it is missing (see "Decap login" below)
- copies `deploy/hooks/` (deploy.php, oauth.php, .htaccess) into `~/seattlepetanque.org/_hooks/`

Copy the printed secret now. If you lose it, read it with `cat ~/.deploy-secret`.
Re-run `setup-host.sh` whenever `deploy/hooks/` changes, because it copies the hooks
into `_hooks/`. Site deploys never touch `_hooks/`: deploy.sh's rsync excludes it.

## 4. Add the GitHub webhook

In the GitHub repo, go to Settings > Webhooks > Add webhook:

- **Payload URL:** `https://seattlepetanque.org/_hooks/deploy.php` (must be https, because the site redirects http, which would drop the POST)
- **Content type:** `application/json`
- **Secret:** the value from step 3
- **Which events:** Just the push event

## 5. Install the cron line

`deploy/crontab.txt` has the nightly deploy at 03:15 and a weekly log trim. Install it
with `crontab -e` over SSH, or in the DreamHost panel's cron section. `crontab -e` replaces
the whole crontab, so merge with any existing lines. Check the result with `crontab -l`.

## 6. Test

1. Trigger a delivery: in GitHub, open the webhook and choose Recent Deliveries, then
   Redeliver on a previous push. A `ping` should return 200 with `pong`.
2. Push a commit to `main` (or redeliver a push). The response should be 200 with
   `deploy started`.
3. Check the log (below) and load the site.

## 7. Reading the log

Every deploy run appends to `~/deploy.log`, with a timestamp on each line:

```sh
tail -n 50 ~/deploy.log
```

A healthy run waits for the lock, fetches origin, builds, and ends with
`deploy complete`. If hugo fails, the log says `hugo build FAILED; web root left unchanged`,
and the live site keeps the last good build.

## 8. Rolling back

Revert the bad commit on `main` and push. The webhook redeploys the reverted state:

```sh
git revert <bad-sha>
git push origin main
```

Don't rewrite history on `main` for a rollback.

## 9. Why `backups/` never reaches the host

`backups/` holds the old Publii backups. These are raw data dumps with personal
details and no use to the live site. The host clone is a partial, sparse checkout that
excludes `backups/`, so those files are never downloaded to DreamHost. They stay in the
repo only.

## Notes

- The first deploy replaces the contents of `~/seattlepetanque.org` with the Hugo
  build (`rsync --delete`). Any leftover Publii files there are removed. Keep a copy
  of the old site first if you need one.
- `deploy.sh` needs `flock`, `rsync`, and `git` on the host. `setup-host.sh` checks for them.

## Decap login (OAuth)

`deploy/hooks/oauth.php` lets editors log in to `/admin/` with GitHub. It is copied to
`~/seattlepetanque.org/_hooks/` by `setup-host.sh` and reads its credentials from `~/.decap-oauth.ini`
(outside the docroot, mode 600).

1. **Create a GitHub OAuth App** under the seattlepetanque organization: Org Settings >
   Developer settings > OAuth Apps > New OAuth App.
   - Application name: e.g. `Seattle Pétanque CMS`
   - Homepage URL: `https://seattlepetanque.org`
   - Authorization callback URL: `https://seattlepetanque.org/_hooks/oauth.php`
2. **Generate a client secret** on the app's page. Re-run `sh ./setup-host.sh` (it creates
   a template `~/.decap-oauth.ini` if missing and never overwrites an existing one), then
   edit it and put in `client_id` and `client_secret`. `allowed_origins` lists the sites
   allowed to receive the token (apex and www by default).
3. **Org approval.** If the organization restricts third-party OAuth app access, an owner
   must approve the app (Org Settings > Third-party Access / OAuth app policy).
4. **Editors.** Add them as org members or collaborators with write access to
   `seattlepetanque/website`, since Decap commits as the logged-in user. Require 2FA for
   all members in the org's Authentication security settings.
5. **Test.** Visit `https://seattlepetanque.org/admin/` and click "Login with GitHub".
   The popup should close and the editor should load.
6. **Troubleshooting**
   - Popup blocked: allow popups for the site and click the button again.
   - Popup says login failed or nothing happens after login: the page origin is not in
     `allowed_origins`. Add exactly what is in the address bar (www vs apex are different
     origins), with scheme and no trailing slash.
   - GitHub shows "redirect_uri mismatch": the OAuth App callback URL must be exactly
     `https://seattlepetanque.org/_hooks/oauth.php`.
   - "Server configuration error" (HTTP 500): `~/.decap-oauth.ini` is missing, unreadable,
     or lacks a key.
   - "login session was invalid or expired": cookies blocked, or more than 10 minutes
     passed between starting and finishing login. Try again.

## Secrets: where they live and who can read them

The repo is public and holds **no secrets**. There are exactly two secrets, both stored only on the
DreamHost host, in the home directory (outside the web root), with mode `600`:

| File | Contains | Also stored at | Used by |
|---|---|---|---|
| `~/.deploy-secret` | Webhook HMAC key (random 64 hex chars) | GitHub webhook settings (write-only; GitHub never shows it again) | `_hooks/deploy.php` |
| `~/.decap-oauth.ini` | OAuth app `client_id` (not secret) and `client_secret` | GitHub OAuth app page (the secret is shown once at creation) | `_hooks/oauth.php` |

Why they can't be fetched over the web:
- Apache serves only `~/seattlepetanque.org/`. Files in `~` itself have no URL.
- Inside the site, `_hooks/.htaccess` denies everything except `deploy.php` and `oauth.php`, and the
  root `.htaccess` denies any dotfile.
- Neither script ever prints a secret. The webhook only compares an HMAC. The login script sends
  the client secret only to GitHub over HTTPS.

Who can read them on the server: only the `dh_jsaetx` user. DreamHost runs PHP as that same user,
which is how the scripts read them. So:
- **Do not install other PHP apps** (WordPress, etc.) under `dh_jsaetx`. Any PHP code running as
  this user could read these files.
- **Protect SSH access**: use a strong password, prefer SSH keys, and turn on 2FA for the DreamHost panel.
  Anyone with shell access as `dh_jsaetx` can read everything.

What an attacker could do with each one, and how to recover:
- **Webhook secret leaked:** they could trigger a rebuild of what is already on `main`. They
  cannot change content, because deploy.sh only builds what is in GitHub. Rotate it with `openssl rand -hex 32 > ~/.deploy-secret`
  and paste the new value into the GitHub webhook.
- **OAuth client secret leaked:** they could build a fake "Seattle Pétanque CMS" login, but a
  user would still have to approve it on GitHub. Rotate it on the OAuth app page (generate a new
  secret, delete the old one) and update `~/.decap-oauth.ini`.
- **Editor tokens** are never stored on the server. Decap keeps the logged-in editor's token in
  that editor's browser. It has `public_repo` scope, which is write access to every public repo
  that editor can write to, not just this one. Editors should log out of `/admin/` on shared
  computers. Anyone can revoke a token under GitHub > Settings > Applications > Authorized OAuth Apps.


## Webhook blocked by ModSecurity (HTTP 500 from Apache)

Symptom: GitHub shows "An exception occurred" for a push delivery and the response is Apache's generic
500 page. The host's `~/logs/seattlepetanque.org/https/error.log` has `ModSecurity: Access denied with code 418`
with rule 930120 ("OS File Access Attempt") matching a file name such as `package.json` in the payload.
The `.htaccess` in `deploy/hooks/` turns ModSecurity off for `_hooks/` only (the HMAC check in `deploy.php`
is the protection). After changing it, run `sh ~/site-src/deploy/setup-host.sh` on the host (or edit
`~/seattlepetanque.org/_hooks/.htaccess` by hand), then redeliver the push in GitHub: expect 200 `deploy started`.
If DreamHost rejects `SecRuleEngine Off` (500 on every request to `_hooks/`), replace it with `SecRuleRemoveById 930120`.
