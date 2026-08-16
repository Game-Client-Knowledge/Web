#!/usr/bin/env bash

set -euo pipefail

BUILDER_ROOT="${BUILDER_ROOT:-/home/sourcecode/gck-builder}"
WEB_ROOT="${WEB_ROOT:-${BUILDER_ROOT}/web}"
RELEASE_ROOT="${RELEASE_ROOT:-/var/www/game-client-knowledge}"
CONTENT_STATE_FILE="${CONTENT_STATE_FILE:-${BUILDER_ROOT}/last-content-commit}"
WEB_STATE_FILE="${WEB_STATE_FILE:-${BUILDER_ROOT}/last-web-commit}"
ATTRIBUTION_STATE_FILE="${ATTRIBUTION_STATE_FILE:-${BUILDER_ROOT}/last-attribution-commit}"
CONTENT_GIT_MIRROR="${CONTENT_GIT_MIRROR:-${BUILDER_ROOT}/content.git}"
LOCK_FILE="${LOCK_FILE:-${BUILDER_ROOT}/update.lock}"
CONTENT_REPOSITORY="${CONTENT_REPOSITORY:-Game-Client-Knowledge/Game-Client-Knowledge}"
WEB_REPOSITORY="${WEB_REPOSITORY:-Game-Client-Knowledge/Web}"

mkdir -p "$BUILDER_ROOT"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

github_commit_metadata() {
  local repository="$1"

  curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --connect-timeout 10 \
    --max-time 30 \
    --retry 2 \
    --header "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${repository}/commits/main" |
    python3 -c '
import json
import sys

payload = json.load(sys.stdin)
print(payload["sha"], payload["commit"]["committer"]["date"])
'
}

download_snapshot() {
  local repository="$1"
  local commit="$2"
  local destination="$3"
  local archive

  archive="$(mktemp)"
  curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --connect-timeout 10 \
    --max-time 120 \
    --retry 2 \
    "https://codeload.github.com/${repository}/tar.gz/${commit}" \
    --output "$archive"
  mkdir -p "$destination"
  tar -xzf "$archive" --strip-components=1 -C "$destination"
  rm -f "$archive"
}

update_git_mirror() {
  local repository="$1"
  local destination="$2"
  local remote="https://github.com/${repository}.git"

  if [[ ! -d "$destination" ]]; then
    git clone --mirror "$remote" "$destination"
  else
    git --git-dir="$destination" fetch --prune origin \
      '+refs/heads/*:refs/heads/*'
  fi
}

read -r content_commit content_updated_at < <(
  github_commit_metadata "$CONTENT_REPOSITORY"
)
read -r web_commit _web_updated_at < <(
  github_commit_metadata "$WEB_REPOSITORY"
)

if [[ -z "$content_commit" || -z "$web_commit" ]]; then
  echo "Unable to resolve pushed main commits." >&2
  exit 1
fi

expected_source="$(mktemp)"
printf 'web=%s\ncontent=%s\n' "$web_commit" "$content_commit" >"$expected_source"

if [[
  -f "${RELEASE_ROOT}/current/index.html"
  && -f "${RELEASE_ROOT}/current/.release-source"
  && "$(cat "${RELEASE_ROOT}/current/.release-source")" == "$(cat "$expected_source")"
  && -f "$ATTRIBUTION_STATE_FILE"
  && "$(cat "$ATTRIBUTION_STATE_FILE")" == "$content_commit"
]]; then
  printf '%s\n' "$content_commit" >"$CONTENT_STATE_FILE"
  printf '%s\n' "$web_commit" >"$WEB_STATE_FILE"
  rm -f "$expected_source"
  echo "Production is current at web=${web_commit:0:12} content=${content_commit:0:12}"
  exit 0
fi

workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"; rm -f "$expected_source"' EXIT
web_snapshot="${workspace}/web"
content_snapshot="${workspace}/content"

download_snapshot "$WEB_REPOSITORY" "$web_commit" "$web_snapshot"
download_snapshot "$CONTENT_REPOSITORY" "$content_commit" "$content_snapshot"
update_git_mirror "$CONTENT_REPOSITORY" "$CONTENT_GIT_MIRROR"

cd "$web_snapshot"
npm ci \
  --omit=dev \
  --no-audit \
  --no-fund \
  --cache "${BUILDER_ROOT}/npm-cache"
CONTENT_REPO_PATH="$content_snapshot" \
CONTENT_COMMIT="$content_commit" \
CONTENT_UPDATED_AT="$content_updated_at" \
WEB_COMMIT="$web_commit" \
  npm run check

previous_attribution_commit=""
if [[ -f "$ATTRIBUTION_STATE_FILE" ]]; then
  candidate="$(cat "$ATTRIBUTION_STATE_FILE")"
  if git --git-dir="$CONTENT_GIT_MIRROR" cat-file -e "${candidate}^{commit}" 2>/dev/null; then
    previous_attribution_commit="$candidate"
  fi
fi
python3 scripts/sync-line-authors.py \
  --repo "$CONTENT_GIT_MIRROR" \
  --revision "$content_commit" \
  --previous "$previous_attribution_commit"

release_id="$(
  printf '%s-%s-%s' \
    "$(date -u +%Y%m%dT%H%M%SZ)" \
    "${web_commit:0:12}" \
    "${content_commit:0:12}"
)"
release_dir="${RELEASE_ROOT}/releases/${release_id}"
mkdir -p "$release_dir"
rsync --archive --delete _site/ "${release_dir}/"
cp "$expected_source" "${release_dir}/.release-source"

test -f "${release_dir}/index.html"
ln -sfn "$release_dir" "${RELEASE_ROOT}/current.next"
mv -Tf "${RELEASE_ROOT}/current.next" "${RELEASE_ROOT}/current"
printf '%s\n' "$content_commit" >"$CONTENT_STATE_FILE"
printf '%s\n' "$web_commit" >"$WEB_STATE_FILE"
printf '%s\n' "$content_commit" >"$ATTRIBUTION_STATE_FILE"

# Keep the installed updater aligned with the pushed Web commit for the next run.
mkdir -p "$WEB_ROOT"
rsync \
  --archive \
  --delete \
  --exclude="node_modules/" \
  --exclude="_site/" \
  "$web_snapshot/" \
  "$WEB_ROOT/"

find "${RELEASE_ROOT}/releases" \
  -mindepth 1 \
  -maxdepth 1 \
  -type d \
  -printf '%T@ %p\n' |
  sort -nr |
  tail -n +6 |
  cut -d' ' -f2- |
  xargs -r rm -rf

echo "Published ${release_id}"
