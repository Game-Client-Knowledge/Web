#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTENT_REPO_PATH="${CONTENT_REPO_PATH:-${PROJECT_ROOT}/../Game-Client-Knowledge}"
DEPLOY_HOST="${DEPLOY_HOST:-sourcecode@192.168.31.109}"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_gck_deploy}"
RELEASE_ROOT="${RELEASE_ROOT:-/var/www/game-client-knowledge}"
SSH=(ssh -i "$DEPLOY_KEY" -o IdentitiesOnly=yes)
RSYNC_SSH="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes"

source "${SCRIPT_DIR}/require-pushed-commits.sh"
cd "$PROJECT_ROOT"

if [[ ! -f "$DEPLOY_KEY" ]]; then
  echo "Deployment key not found: $DEPLOY_KEY" >&2
  exit 1
fi

WEB_COMMIT="$(require_pushed_commit "$PROJECT_ROOT" "Web repository")"
CONTENT_COMMIT="$(require_pushed_commit "$CONTENT_REPO_PATH" "Content repository")"
CONTENT_UPDATED_AT="$(git -C "$CONTENT_REPO_PATH" log -1 --format=%cI "$CONTENT_COMMIT")"
RELEASE_ID="$(
  printf '%s-%s-%s' \
    "$(date -u +%Y%m%dT%H%M%SZ)" \
    "${WEB_COMMIT:0:12}" \
    "${CONTENT_COMMIT:0:12}"
)"
REMOTE_RELEASE="${RELEASE_ROOT}/releases/${RELEASE_ID}"

export CONTENT_REPO_PATH
export CONTENT_COMMIT
export CONTENT_UPDATED_AT
export WEB_COMMIT
npm run check
printf 'web=%s\ncontent=%s\n' "$WEB_COMMIT" "$CONTENT_COMMIT" >_site/.release-source

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
