#!/usr/bin/env bash

set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-sourcecode@192.168.31.109}"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_gck_deploy}"
RELEASE_ROOT="${RELEASE_ROOT:-/var/www/game-client-knowledge}"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
REMOTE_RELEASE="${RELEASE_ROOT}/releases/${RELEASE_ID}"
SSH=(ssh -i "$DEPLOY_KEY" -o IdentitiesOnly=yes)
RSYNC_SSH="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes"

if [[ ! -f "$DEPLOY_KEY" ]]; then
  echo "Deployment key not found: $DEPLOY_KEY" >&2
  exit 1
fi

npm run check

"${SSH[@]}" "$DEPLOY_HOST" "mkdir -p '$REMOTE_RELEASE'"
rsync \
  --archive \
  --compress \
  --delete \
  --human-readable \
  -e "$RSYNC_SSH" \
  _site/ \
  "${DEPLOY_HOST}:${REMOTE_RELEASE}/"

"${SSH[@]}" "$DEPLOY_HOST" bash -s -- "$RELEASE_ROOT" "$REMOTE_RELEASE" <<'REMOTE'
set -euo pipefail

release_root="$1"
remote_release="$2"

test -f "${remote_release}/index.html"
ln -sfn "$remote_release" "${release_root}/current.next"
mv -Tf "${release_root}/current.next" "${release_root}/current"

find "${release_root}/releases" \
  -mindepth 1 \
  -maxdepth 1 \
  -type d \
  -printf '%T@ %p\n' |
  sort -nr |
  tail -n +6 |
  cut -d' ' -f2- |
  xargs -r rm -rf
REMOTE

echo "Deployed ${RELEASE_ID} to ${DEPLOY_HOST}:${RELEASE_ROOT}"
