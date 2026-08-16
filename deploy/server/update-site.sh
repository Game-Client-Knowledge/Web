#!/usr/bin/env bash

set -euo pipefail

BUILDER_ROOT="${BUILDER_ROOT:-/home/sourcecode/gck-builder}"
WEB_ROOT="${WEB_ROOT:-${BUILDER_ROOT}/web}"
CONTENT_ROOT="${CONTENT_ROOT:-${BUILDER_ROOT}/content}"
RELEASE_ROOT="${RELEASE_ROOT:-/var/www/game-client-knowledge}"
STATE_FILE="${STATE_FILE:-${BUILDER_ROOT}/last-content-commit}"
LOCK_FILE="${LOCK_FILE:-${BUILDER_ROOT}/update.lock}"
CONTENT_REPOSITORY="${CONTENT_REPOSITORY:-Game-Client-Knowledge/Game-Client-Knowledge}"

mkdir -p "$BUILDER_ROOT"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

remote_commit="$(
  curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --connect-timeout 10 \
    --max-time 30 \
    --retry 2 \
    --header "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${CONTENT_REPOSITORY}/commits/main" |
    python3 -c 'import json, sys; print(json.load(sys.stdin)["sha"])'
)"

if [[ -z "$remote_commit" ]]; then
  echo "Unable to resolve origin/main" >&2
  exit 1
fi

last_commit=""
if [[ -f "$STATE_FILE" ]]; then
  last_commit="$(<"$STATE_FILE")"
fi

if [[ "$remote_commit" == "$last_commit" && -f "${RELEASE_ROOT}/current/index.html" ]]; then
  echo "Content is current at ${remote_commit:0:12}"
  exit 0
fi

archive="$(mktemp)"
snapshot="$(mktemp -d)"
trap 'rm -f "$archive"; rm -rf "$snapshot"' EXIT

curl \
  --fail \
  --silent \
  --show-error \
  --location \
  --connect-timeout 10 \
  --max-time 120 \
  --retry 2 \
  "https://codeload.github.com/${CONTENT_REPOSITORY}/tar.gz/${remote_commit}" \
  --output "$archive"
tar -xzf "$archive" --strip-components=1 -C "$snapshot"
rsync --archive --delete --exclude=".git/" "$snapshot/" "$CONTENT_ROOT/"

cd "$WEB_ROOT"
CONTENT_REPO_PATH="$CONTENT_ROOT" npm run check

release_id="$(date -u +%Y%m%dT%H%M%SZ)-${remote_commit:0:12}"
release_dir="${RELEASE_ROOT}/releases/${release_id}"
mkdir -p "$release_dir"
rsync --archive --delete _site/ "${release_dir}/"

test -f "${release_dir}/index.html"
ln -sfn "$release_dir" "${RELEASE_ROOT}/current.next"
mv -Tf "${RELEASE_ROOT}/current.next" "${RELEASE_ROOT}/current"
printf '%s\n' "$remote_commit" >"$STATE_FILE"

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
