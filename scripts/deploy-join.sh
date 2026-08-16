#!/usr/bin/env bash

set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-sourcecode@192.168.31.109}"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_gck_deploy}"
RELEASE_ROOT="${JOIN_RELEASE_ROOT:-/var/www/github-org-invite-page}"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
REMOTE_RELEASE="${RELEASE_ROOT}/releases/${RELEASE_ID}"
SSH=(ssh -i "$DEPLOY_KEY" -o IdentitiesOnly=yes)

if [[ ! -f "$DEPLOY_KEY" ]]; then
  echo "Deployment key not found: $DEPLOY_KEY" >&2
  exit 1
fi

if [[ ! -s deploy/join/index.html ]]; then
  echo "Join page source is missing: deploy/join/index.html" >&2
  exit 1
fi

"${SSH[@]}" "$DEPLOY_HOST" "mkdir -p '$REMOTE_RELEASE'"
scp \
  -i "$DEPLOY_KEY" \
  -o IdentitiesOnly=yes \
  deploy/join/index.html \
  "${DEPLOY_HOST}:${REMOTE_RELEASE}/index.html"

"${SSH[@]}" "$DEPLOY_HOST" bash -s -- "$RELEASE_ROOT" "$REMOTE_RELEASE" <<'REMOTE'
set -euo pipefail

release_root="$1"
remote_release="$2"

test -s "${remote_release}/index.html"
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

echo "Deployed Join page ${RELEASE_ID} to ${DEPLOY_HOST}:${RELEASE_ROOT}"
