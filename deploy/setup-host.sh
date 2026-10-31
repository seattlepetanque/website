#!/bin/sh
# One-time host setup for DreamHost. Safe to re-run (idempotent).
#   - installs hugo to ~/bin
#   - clones the repo as a partial, sparse checkout that excludes backups/
#   - creates the webhook secret if missing (printed once)
#   - copies deploy/hooks/ into the hooks docroot
# Only this file must be copied by hand. Everything else comes from git.
set -eu

HUGO_VERSION="0.169.0"
# Confirmed by the coordinator: the GitHub repo is seattlepetanque/website.
REPO_URL="https://github.com/seattlepetanque/website.git"
BRANCH="main"

HOME="${HOME:-/home/dh_jsaetx}"
BIN_DIR="$HOME/bin"
SITE_SRC="$HOME/site-src"
HOOKS_DIR="$HOME/seattlepetanque.org/_hooks"
SECRET_FILE="$HOME/.deploy-secret"

log() {
  printf '%s setup: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

# Required tools.
for tool in git curl tar openssl rsync flock; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    log "missing required tool: $tool"
    exit 1
  fi
done

# --- hugo -------------------------------------------------------------------
if [ -x "$BIN_DIR/hugo" ] && "$BIN_DIR/hugo" version 2>/dev/null | grep -q "v$HUGO_VERSION"; then
  log "hugo v$HUGO_VERSION already installed at $BIN_DIR/hugo"
else
  case "$(uname -m)" in
    x86_64|amd64)  arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) log "unsupported architecture: $(uname -m)"; exit 1 ;;
  esac

  mkdir -p "$BIN_DIR"
  tmp=$(mktemp -d "$HOME/.hugo-install.XXXXXX")
  base="https://github.com/gohugoio/hugo/releases/download/v$HUGO_VERSION"
  installed=0

  # Try the extended build first (needs glibc). Fall back to the standard build
  # if the extended binary won't download or won't run on this host.
  for flavor in extended standard; do
    if [ "$flavor" = extended ]; then
      asset="hugo_extended_${HUGO_VERSION}_linux-$arch.tar.gz"
    else
      asset="hugo_${HUGO_VERSION}_linux-$arch.tar.gz"
    fi
    log "trying $flavor build: $asset"
    if curl -fsSL -o "$tmp/hugo.tar.gz" "$base/$asset" &&
       tar -xzf "$tmp/hugo.tar.gz" -C "$tmp" hugo &&
       "$tmp/hugo" version 2>/dev/null | grep -q "v$HUGO_VERSION"; then
      mv -f "$tmp/hugo" "$BIN_DIR/hugo"
      installed=1
      log "installed $flavor hugo v$HUGO_VERSION to $BIN_DIR/hugo"
      break
    fi
    log "$flavor build failed to download or run"
    rm -f "$tmp/hugo.tar.gz" "$tmp/hugo"
  done

  rm -rf "$tmp"
  if [ "$installed" -ne 1 ]; then
    log "could not install hugo"
    exit 1
  fi
fi

# --- source clone (partial + sparse, no backups/) ----------------------------
if [ -d "$SITE_SRC/.git" ]; then
  log "clone already exists at $SITE_SRC"
else
  log "cloning $REPO_URL"
  git clone --filter=blob:none --no-checkout "$REPO_URL" "$SITE_SRC"
fi
git -C "$SITE_SRC" sparse-checkout set --no-cone '/*' '!/backups/'
git -C "$SITE_SRC" checkout "$BRANCH"

# --- webhook secret ----------------------------------------------------------
if [ -f "$SECRET_FILE" ]; then
  log "webhook secret already exists at $SECRET_FILE (not reprinted)"
else
  umask 077
  openssl rand -hex 32 > "$SECRET_FILE"
  log "created $SECRET_FILE. Paste this into the GitHub webhook Secret field now. It is shown once:"
  cat "$SECRET_FILE"
fi
chmod 600 "$SECRET_FILE"

# --- OAuth config (Decap login) ------------------------------------------------
OAUTH_INI="$HOME/.decap-oauth.ini"
if [ -f "$OAUTH_INI" ]; then
  log "OAuth config already exists at $OAUTH_INI (left untouched)"
else
  umask 077
  cat > "$OAUTH_INI" <<'INI'
; GitHub OAuth App credentials for Decap CMS login (read by hooks/oauth.php).
client_id = "REPLACE_WITH_CLIENT_ID"
client_secret = "REPLACE_WITH_CLIENT_SECRET"
allowed_origins = "https://seattlepetanque.org,https://www.seattlepetanque.org"
INI
  chmod 600 "$OAUTH_INI"
  log "created template $OAUTH_INI. Edit it and fill in client_id and client_secret (see deploy/README.md, Decap login)."
fi

# --- hooks docroot -----------------------------------------------------------
# Copy the contents with "/." so dotfiles such as .htaccess are included.
# deploy.sh's rsync excludes /_hooks/, so site deploys never delete these.
mkdir -p "$HOOKS_DIR"
cp -R "$SITE_SRC/deploy/hooks/." "$HOOKS_DIR/"
# umask 077 above would leave these unreadable by Apache; scripts are public, secrets are not.
chmod 755 "$HOOKS_DIR"
chmod 644 "$HOOKS_DIR"/*.php "$HOOKS_DIR/.htaccess"
log "copied hooks to $HOOKS_DIR"

# --- deploy script -----------------------------------------------------------
chmod +x "$SITE_SRC/deploy/deploy.sh"

log "setup complete. Next steps:"
cat <<EOF
  1. Confirm https://seattlepetanque.org/_hooks/deploy.php answers (GET returns 405).
  2. Add the GitHub webhook (see deploy/README.md) using the secret above.
  3. Install the cron line from $SITE_SRC/deploy/crontab.txt (crontab -e).
  4. Run a first deploy by hand: $SITE_SRC/deploy/deploy.sh
     Note: the first deploy replaces the web root contents with the Hugo build.
  Re-run this script any time deploy/hooks/ changes. It re-copies the hooks.
EOF
