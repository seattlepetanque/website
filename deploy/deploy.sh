#!/bin/sh
# Deploy the Hugo site on DreamHost: fetch origin/main, build into a temp dir,
# and publish to the web root only if the build succeeded.
# Serialized with flock, so webhook and cron runs never overlap.
set -eu

HOME="${HOME:-/home/dh_jsaetx}"
PATH="/usr/local/bin:/usr/bin:/bin:$HOME/bin"
export HOME PATH

SITE_SRC="$HOME/site-src"
BUILD_DIR="$HOME/site-build"
WEB_ROOT="$HOME/seattlepetanque.org"
HUGO="$HOME/bin/hugo"
LOCK_FILE="$HOME/.deploy.lock"

log() {
  printf '%s deploy: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

# Block until any other deploy run releases the lock.
exec 9>"$LOCK_FILE"
log "waiting for lock"
flock 9
log "lock acquired"

cd "$SITE_SRC"
log "fetching origin/main"
git fetch --quiet origin main
# reset rather than pull: the host clone is disposable and must match origin exactly.
git reset --quiet --hard origin/main
log "source at $(git rev-parse --short HEAD)"

log "building into $BUILD_DIR"
rm -rf "$BUILD_DIR"
if ! "$HUGO" --minify --cleanDestinationDir --destination "$BUILD_DIR"; then
  log "hugo build FAILED; web root left unchanged"
  exit 1
fi

# Guard against publishing an empty or broken build.
if [ ! -f "$BUILD_DIR/index.html" ]; then
  log "build produced no index.html; web root left unchanged"
  exit 1
fi

log "publishing to $WEB_ROOT"
# Keep paths the build doesn't own: DreamHost's Let's Encrypt renewals write to
# .well-known/, and setup-host.sh installs the webhook/login scripts in _hooks/.
rsync -a --delete --exclude='/.well-known/' --exclude='/_hooks/' "$BUILD_DIR/" "$WEB_ROOT/"
log "deploy complete"
