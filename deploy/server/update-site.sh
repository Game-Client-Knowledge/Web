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

encode_base64() {
  base64 | tr -d '\n'
}

github_commit_metadata_from_git() {
  local repository="$1"
  local remote="https://github.com/${repository}.git"
  local revision
  local metadata_repo
  local authored_at
  local author_name
  local author_email

  revision="$(
    git -c http.version=HTTP/1.1 ls-remote "$remote" refs/heads/main |
      awk 'NR == 1 { print $1 }'
  )"
  if [[ -z "$revision" ]]; then
    echo "Unable to resolve ${repository}:main through git." >&2
    return 1
  fi

  metadata_repo="$(mktemp -d)"
  if ! timeout 60 git -c http.version=HTTP/1.1 \
    init --bare "$metadata_repo" >/dev/null; then
    rm -rf "$metadata_repo"
    return 1
  fi
  if ! timeout 60 git -c http.version=HTTP/1.1 \
    --git-dir="$metadata_repo" fetch --depth=1 "$remote" refs/heads/main; then
    rm -rf "$metadata_repo"
    return 1
  fi

  authored_at="$(
    git --git-dir="$metadata_repo" show -s --format=%cI "$revision"
  )"
  author_name="$(
    git --git-dir="$metadata_repo" show -s --format=%an "$revision"
  )"
  author_email="$(
    git --git-dir="$metadata_repo" show -s --format=%ae "$revision"
  )"
  rm -rf "$metadata_repo"

  printf '%s\t%s\t%s\t%s\n' \
    "$revision" \
    "$authored_at" \
    "$(printf '%s' "$author_name" | encode_base64)" \
    "$(printf '%s' "$author_email" | encode_base64)"
}

github_commit_metadata() {
  local repository="$1"
  local payload

  if payload="$(
    curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --connect-timeout 10 \
    --max-time 30 \
    --retry 2 \
    --header "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/${repository}/commits/main"
  )"; then
    printf '%s' "$payload" |
    python3 -c '
import json
import sys

payload = json.load(sys.stdin)
import base64

commit = payload["commit"]
encode = lambda value: base64.b64encode(value.encode()).decode()
print(
    payload["sha"],
    commit["committer"]["date"],
    encode(commit["author"].get("name") or "GitHub contributor"),
    encode(commit["author"].get("email") or "noreply@github.com"),
    sep="\t",
)
'
    return
  fi

  echo "GitHub API metadata lookup failed for ${repository}; falling back to git." >&2
  github_commit_metadata_from_git "$repository"
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
  local revision="$3"
  local snapshot="$4"
  local author_name="$5"
  local author_email="$6"
  local authored_at="$7"
  local importer="$8"
  local remote="https://github.com/${repository}.git"

  if [[ ! -d "$destination" ]]; then
    if ! timeout 60 git -c http.version=HTTP/1.1 \
      clone --mirror "$remote" "$destination"; then
      if [[ -d "$destination" ]]; then
        mv "$destination" "${destination}.failed-$(date +%s)"
      fi
      git init --bare "$destination" >/dev/null
      git --git-dir="$destination" remote add origin "$remote"
    fi
  fi

  if ! git --git-dir="$destination" cat-file -e "${revision}^{commit}" 2>/dev/null; then
    timeout 30 git -c http.version=HTTP/1.1 \
      --git-dir="$destination" fetch --prune origin \
      '+refs/heads/*:refs/heads/*' || true
  fi

  if git --git-dir="$destination" cat-file -e "${revision}^{commit}" 2>/dev/null; then
    git --git-dir="$destination" update-ref \
      "refs/gck-upstream/${revision}" "$revision"
    printf '%s\n' "$revision"
    return
  fi

  python3 "$importer" \
    --repo "$destination" \
    --worktree "$snapshot" \
    --upstream-revision "$revision" \
    --author-name "$author_name" \
    --author-email "$author_email" \
    --authored-at "$authored_at"
}

IFS=$'\t' read -r \
  content_commit \
  content_updated_at \
  content_author_name_b64 \
  content_author_email_b64 < <(
  github_commit_metadata "$CONTENT_REPOSITORY"
)
IFS=$'\t' read -r web_commit _web_updated_at _web_name _web_email < <(
  github_commit_metadata "$WEB_REPOSITORY"
)
content_author_name="$(
  printf '%s' "$content_author_name_b64" | base64 --decode
)"
content_author_email="$(
  printf '%s' "$content_author_email_b64" | base64 --decode
)"

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
mirror_revision="$(
  update_git_mirror \
    "$CONTENT_REPOSITORY" \
    "$CONTENT_GIT_MIRROR" \
    "$content_commit" \
    "$content_snapshot" \
    "$content_author_name" \
    "$content_author_email" \
    "$content_updated_at" \
    "$web_snapshot/scripts/import-content-snapshot.py"
)"

cd "$web_snapshot"
npm ci \
  --omit=dev \
  --no-audit \
  --no-fund \
  --cache "${BUILDER_ROOT}/npm-cache"
CONTENT_REPO_PATH="$content_snapshot" \
CONTENT_COMMIT="$content_commit" \
CONTENT_UPDATED_AT="$content_updated_at" \
CONTENT_GIT_DIR="$CONTENT_GIT_MIRROR" \
CONTENT_GIT_REVISION="$mirror_revision" \
WEB_COMMIT="$web_commit" \
  npm run check

previous_attribution_commit=""
if [[ -f "$ATTRIBUTION_STATE_FILE" ]]; then
  candidate="$(cat "$ATTRIBUTION_STATE_FILE")"
  mapped_reference="refs/gck-upstream/${candidate}"
  if git --git-dir="$CONTENT_GIT_MIRROR" show-ref \
    --verify --quiet "$mapped_reference"; then
    previous_attribution_commit="$(
      git --git-dir="$CONTENT_GIT_MIRROR" rev-parse "$mapped_reference"
    )"
  elif git --git-dir="$CONTENT_GIT_MIRROR" \
    cat-file -e "${candidate}^{commit}" 2>/dev/null; then
      previous_attribution_commit="$candidate"
  fi
fi
python3 scripts/sync-line-authors.py \
  --repo "$CONTENT_GIT_MIRROR" \
  --revision "$mirror_revision" \
  --content-revision "$content_commit" \
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
