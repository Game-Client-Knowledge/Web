#!/usr/bin/env bash

set -euo pipefail

BUILDER_ROOT="${BUILDER_ROOT:-/home/sourcecode/gck-builder}"
WEB_ROOT="${WEB_ROOT:-${BUILDER_ROOT}/web}"
RELEASE_ROOT="${RELEASE_ROOT:-/var/www/game-client-knowledge}"
EDITOR_RELEASE_ROOT="${EDITOR_RELEASE_ROOT:-/opt/game-client-knowledge-editor}"
EDITOR_SERVICE="${EDITOR_SERVICE:-game-client-knowledge-editor}"
EDITOR_PIP_INDEX_URL="${EDITOR_PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"
CONTENT_STATE_FILE="${CONTENT_STATE_FILE:-${BUILDER_ROOT}/last-content-commit}"
WEB_STATE_FILE="${WEB_STATE_FILE:-${BUILDER_ROOT}/last-web-commit}"
ATTRIBUTION_STATE_FILE="${ATTRIBUTION_STATE_FILE:-${BUILDER_ROOT}/last-attribution-commit}"
CONTENT_GIT_MIRROR="${CONTENT_GIT_MIRROR:-${BUILDER_ROOT}/content.git}"
WEB_GIT_MIRROR="${WEB_GIT_MIRROR:-${BUILDER_ROOT}/web.git}"
SNAPSHOT_CACHE_ROOT="${SNAPSHOT_CACHE_ROOT:-${BUILDER_ROOT}/snapshots}"
BROWSER_ROOT="${BROWSER_ROOT:-${BUILDER_ROOT}/browsers}"
LOCK_FILE="${LOCK_FILE:-${BUILDER_ROOT}/update.lock}"
AUTO_CHECK_STATE_FILE="${AUTO_CHECK_STATE_FILE:-${BUILDER_ROOT}/last-auto-check}"
UPDATE_REQUEST_FILE="${UPDATE_REQUEST_FILE:-/var/lib/game-client-knowledge-editor/site-update.request}"
UPDATE_STATUS_FILE="${UPDATE_STATUS_FILE:-/var/lib/game-client-knowledge-editor/site-update-status.json}"
EDITOR_DB_PATH="${EDITOR_DB_PATH:-/var/lib/game-client-knowledge-editor/editor.db}"
FAILURE_NOTIFICATION_STATE_FILE="${FAILURE_NOTIFICATION_STATE_FILE:-${BUILDER_ROOT}/last-update-failure-notification.json}"
EDITOR_PYTHON="${EDITOR_PYTHON:-/opt/game-client-knowledge-editor/venv/bin/python}"
EDITOR_APP_ROOT="${EDITOR_APP_ROOT:-/opt/game-client-knowledge-editor/current/editor}"
CONTENT_REPOSITORY="${CONTENT_REPOSITORY:-Game-Client-Knowledge/Game-Client-Knowledge}"
WEB_REPOSITORY="${WEB_REPOSITORY:-Game-Client-Knowledge/Web}"

mkdir -p "$BUILDER_ROOT"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

run_log_file="$(mktemp)"
workspace=""
expected_source=""
cleanup() {
  [[ -z "$workspace" ]] || rm -rf "$workspace"
  [[ -z "$expected_source" ]] || rm -f "$expected_source"
  rm -f "$run_log_file"
}
trap cleanup EXIT
exec > >(tee -a "$run_log_file") 2>&1

update_mode="auto"
update_stage="initialize"
run_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
content_commit=""
web_commit=""

write_status() {
  local state="$1"
  local message="$2"
  local finished="${3:-0}"
  mkdir -p "$(dirname "$UPDATE_STATUS_FILE")"
  python3 - \
    "$UPDATE_STATUS_FILE" \
    "$state" \
    "$update_mode" \
    "$message" \
    "$run_started_at" \
    "$finished" \
    "$web_commit" \
    "$content_commit" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

path = Path(sys.argv[1])
state, mode, message, started_at = sys.argv[2:6]
finished = sys.argv[6] == "1"
payload = {
    "state": state,
    "mode": mode,
    "message": message,
    "started_at": started_at,
    "finished_at": (
        datetime.now(timezone.utc).isoformat()
        if finished
        else None
    ),
    "web_commit": sys.argv[7] or None,
    "content_commit": sys.argv[8] or None,
}
temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
os.replace(temporary, path)
PY
}

notify_failure() {
  local exit_code="$1"
  local failed_command="$2"

  if [[ ! -x "$EDITOR_PYTHON" ]]; then
    echo "Failure email skipped: editor Python is unavailable at ${EDITOR_PYTHON}." >&2
    return
  fi
  if [[ ! -f "${EDITOR_APP_ROOT}/app/site_update_notifications.py" ]]; then
    echo "Failure email skipped: notification module is not deployed." >&2
    return
  fi

  PYTHONPATH="$EDITOR_APP_ROOT" \
    "$EDITOR_PYTHON" \
    -m app.site_update_notifications \
    --mode "$update_mode" \
    --stage "$update_stage" \
    --exit-code "$exit_code" \
    --failed-command "$failed_command" \
    --web-commit "$web_commit" \
    --content-commit "$content_commit" \
    --started-at "$run_started_at" \
    --log-file "$run_log_file" \
    --dedupe-file "$FAILURE_NOTIFICATION_STATE_FILE" ||
    echo "Failure email delivery command failed." >&2
}

on_error() {
  local exit_code="$1"
  local failed_command="$2"
  trap - ERR
  set +e
  sleep 0.1
  write_status \
    "failed" \
    "更新失败（阶段 ${update_stage}，退出码 ${exit_code}），请检查服务日志" \
    1 || true
  notify_failure "$exit_code" "$failed_command"
  exit "$exit_code"
}
trap 'on_error "$?" "$BASH_COMMAND"' ERR

fail_update() {
  echo "$1" >&2
  return 1
}

read_auto_interval_minutes() {
  python3 - "$EDITOR_DB_PATH" <<'PY'
import sqlite3
import sys
from pathlib import Path

path = Path(sys.argv[1])
if not path.exists():
    print(10)
    raise SystemExit
try:
    with sqlite3.connect(path) as connection:
        row = connection.execute(
            "SELECT value FROM settings "
            "WHERE key = 'site_auto_update_interval_minutes'"
        ).fetchone()
    value = int(row[0]) if row else 10
except (OSError, sqlite3.Error, TypeError, ValueError):
    value = 10
print(max(0, min(1440, value)))
PY
}

if [[ -f "$UPDATE_REQUEST_FILE" ]]; then
  update_mode="$(
    python3 - "$UPDATE_REQUEST_FILE" <<'PY'
import json
import sys
from pathlib import Path

try:
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError):
    payload = {}
print(payload.get("mode") or "site")
PY
  )"
  rm -f "$UPDATE_REQUEST_FILE"
  if [[ "$update_mode" != "content" && "$update_mode" != "site" ]]; then
    fail_update "Invalid update mode: $update_mode"
  fi
else
  interval_minutes="$(read_auto_interval_minutes)"
  if (( interval_minutes == 0 )); then
    exit 0
  fi
  now_epoch="$(date +%s)"
  last_epoch=0
  if [[ -f "$AUTO_CHECK_STATE_FILE" ]]; then
    last_epoch="$(cat "$AUTO_CHECK_STATE_FILE" 2>/dev/null || printf '0')"
  fi
  if (( now_epoch - last_epoch < interval_minutes * 60 )); then
    exit 0
  fi
  printf '%s\n' "$now_epoch" >"$AUTO_CHECK_STATE_FILE"
fi

write_status "checking" "正在检查远端提交" 0

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
  local headers=(
    --header "Accept: application/vnd.github+json"
    --header "X-GitHub-Api-Version: 2022-11-28"
  )

  if [[ -n "${EDITOR_GITHUB_BOT_TOKEN:-}" ]]; then
    headers+=(--header "Authorization: Bearer ${EDITOR_GITHUB_BOT_TOKEN}")
  fi

  if payload="$(
    curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --connect-timeout 10 \
    --max-time 30 \
    --retry 2 \
    "${headers[@]}" \
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
  local mirror="$4"
  local archive
  local cache_directory
  local cache_archive
  local remote="https://github.com/${repository}.git"

  cache_directory="$(
    printf '%s/%s' \
      "$SNAPSHOT_CACHE_ROOT" \
      "${repository//\//-}"
  )"
  cache_archive="${cache_directory}/${commit}.tar.gz"

  if [[ -f "$cache_archive" ]] && tar -tzf "$cache_archive" >/dev/null; then
    mkdir -p "$destination"
    tar -xzf "$cache_archive" --strip-components=1 -C "$destination"
    echo "Restored ${repository}@${commit:0:12} from snapshot cache."
    return
  fi

  if [[
    -d "$mirror"
    && -n "$(git --git-dir="$mirror" cat-file -t "$commit" 2>/dev/null || true)"
  ]]; then
    mkdir -p "$destination"
    git --git-dir="$mirror" archive "$commit" | tar -x -C "$destination"
    echo "Restored ${repository}@${commit:0:12} from the local Git mirror."
    return
  fi

  archive="$(mktemp)"
  if curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --connect-timeout 10 \
    --max-time 120 \
    --retry 2 \
    "https://codeload.github.com/${repository}/tar.gz/${commit}" \
    --output "$archive" &&
    tar -tzf "$archive" >/dev/null; then
      mkdir -p "$cache_directory" "$destination"
      mv "$archive" "$cache_archive"
      tar -xzf "$cache_archive" --strip-components=1 -C "$destination"
      return
  fi
  rm -f "$archive"

  echo "Codeload failed for ${repository}; falling back to git." >&2
  if [[ ! -d "$mirror" ]]; then
    git init --bare "$mirror" >/dev/null
    git --git-dir="$mirror" remote add origin "$remote"
  fi
  for attempt in 1 2 3; do
    if timeout 90 git -c http.version=HTTP/1.1 \
      --git-dir="$mirror" fetch --depth=1 origin refs/heads/main; then
        break
    fi
    echo "Git snapshot fetch ${attempt}/3 failed for ${repository}." >&2
    sleep "$((attempt * 2))"
  done
  if ! git --git-dir="$mirror" cat-file -e "${commit}^{commit}" 2>/dev/null; then
    echo "Unable to retrieve immutable snapshot ${repository}@${commit}." >&2
    return 1
  fi
  mkdir -p "$destination"
  git --git-dir="$mirror" archive "$commit" | tar -x -C "$destination"
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

update_stage="resolve-content-commit"
IFS=$'\t' read -r \
  content_commit \
  content_updated_at \
  content_author_name_b64 \
  content_author_email_b64 < <(
  github_commit_metadata "$CONTENT_REPOSITORY"
)
update_stage="resolve-web-commit"
if [[
  "$update_mode" == "content"
  && -f "${RELEASE_ROOT}/current/.release-source"
]]; then
  web_commit="$(
    awk -F= '$1 == "web" { print $2 }' \
      "${RELEASE_ROOT}/current/.release-source"
  )"
fi
if [[ -z "$web_commit" ]]; then
  IFS=$'\t' read -r web_commit _web_updated_at _web_name _web_email < <(
    github_commit_metadata "$WEB_REPOSITORY"
  )
fi
content_author_name="$(
  printf '%s' "$content_author_name_b64" | base64 --decode
)"
content_author_email="$(
  printf '%s' "$content_author_email_b64" | base64 --decode
)"

if [[ -z "$content_commit" || -z "$web_commit" ]]; then
  fail_update "Unable to resolve pushed main commits."
fi

update_stage="prepare-snapshots"
expected_source="$(mktemp)"
printf 'web=%s\ncontent=%s\n' "$web_commit" "$content_commit" >"$expected_source"

editor_is_current=1
if [[ "$update_mode" != "content" ]]; then
  editor_is_current=0
  if [[
    -f "${EDITOR_RELEASE_ROOT}/current/.web-commit"
    && "$(cat "${EDITOR_RELEASE_ROOT}/current/.web-commit")" == "$web_commit"
  ]]; then
    editor_is_current=1
  fi
fi

IFS=$'\t' read -r \
  contribution_graph_initialized \
  contribution_graph_revision \
  contribution_graph_version < <(
  python3 - "$EDITOR_DB_PATH" <<'PY'
import sqlite3
import sys
from pathlib import Path

path = Path(sys.argv[1])
initialized = 0
revision = ""
version = "0"
if path.exists():
    try:
        with sqlite3.connect(path) as connection:
            table = connection.execute(
                "SELECT 1 FROM sqlite_master "
                "WHERE type = 'table' AND name = 'document_contributors'"
            ).fetchone()
            row = connection.execute(
                "SELECT value FROM settings "
                "WHERE key = 'contribution_graph_revision'"
            ).fetchone() if table else None
            version_row = connection.execute(
                "SELECT value FROM settings "
                "WHERE key = 'contribution_graph_version'"
            ).fetchone() if table else None
        if table and row and row[0]:
            version = str(version_row[0]) if version_row else "1"
        if table and row and row[0] and version == "2":
            initialized = 1
            revision = str(row[0])
    except sqlite3.Error:
        pass
print(f"{initialized}\t{revision}\t{version}")
PY
)

if [[
  -f "${RELEASE_ROOT}/current/index.html"
  && -f "${RELEASE_ROOT}/current/.release-source"
  && "$(cat "${RELEASE_ROOT}/current/.release-source")" == "$(cat "$expected_source")"
  && -f "$ATTRIBUTION_STATE_FILE"
  && "$(cat "$ATTRIBUTION_STATE_FILE")" == "$content_commit"
  && "$editor_is_current" == "1"
  && "$contribution_graph_revision" == "$content_commit"
]]; then
  printf '%s\n' "$content_commit" >"$CONTENT_STATE_FILE"
  printf '%s\n' "$web_commit" >"$WEB_STATE_FILE"
  rm -f "$expected_source"
  write_status \
    "success" \
    "服务器已是目标版本" \
    1
  echo "Production is current at web=${web_commit:0:12} content=${content_commit:0:12}"
  exit 0
fi

write_status "building" "正在下载快照并执行完整构建检查" 0
workspace="$(mktemp -d)"
web_snapshot="${workspace}/web"
content_snapshot="${workspace}/content"

update_stage="download-web-snapshot"
download_snapshot \
  "$WEB_REPOSITORY" \
  "$web_commit" \
  "$web_snapshot" \
  "$WEB_GIT_MIRROR"
update_stage="download-content-snapshot"
download_snapshot \
  "$CONTENT_REPOSITORY" \
  "$content_commit" \
  "$content_snapshot" \
  "$CONTENT_GIT_MIRROR"
update_stage="import-content-history"
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
update_stage="install-dependencies"
npm ci \
  --include=dev \
  --no-audit \
  --no-fund \
  --cache "${BUILDER_ROOT}/npm-cache"
update_stage="install-build-browser"
if ! PLAYWRIGHT_BROWSERS_PATH="$BROWSER_ROOT" node -e \
  'const fs=require("fs");const {chromium}=require("playwright-core");process.exit(fs.existsSync(chromium.executablePath())?0:1)'; then
    PLAYWRIGHT_BROWSERS_PATH="$BROWSER_ROOT" \
      ./node_modules/.bin/playwright-core install chromium
fi
update_stage="audit-and-build"
CONTENT_REPO_PATH="$content_snapshot" \
CONTENT_COMMIT="$content_commit" \
CONTENT_UPDATED_AT="$content_updated_at" \
CONTENT_GIT_DIR="$CONTENT_GIT_MIRROR" \
CONTENT_GIT_REVISION="$mirror_revision" \
CONTENT_STATS_CACHE_PATH="${BUILDER_ROOT}/content-statistics-v2.json" \
PLAYWRIGHT_BROWSERS_PATH="$BROWSER_ROOT" \
WEB_COMMIT="$web_commit" \
  npm run check

update_stage="sync-line-authors"
previous_attribution_commit=""
if [[ "$contribution_graph_initialized" == "1" && -f "$ATTRIBUTION_STATE_FILE" ]]; then
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
if [[ "$contribution_graph_initialized" == "1" ]]; then
  python3 scripts/sync-line-authors.py \
    --repo "$CONTENT_GIT_MIRROR" \
    --revision "$mirror_revision" \
    --content-revision "$content_commit" \
    --previous "$previous_attribution_commit"
fi

release_id="$(
  printf '%s-%s-%s' \
    "$(date -u +%Y%m%dT%H%M%SZ)" \
    "${web_commit:0:12}" \
    "${content_commit:0:12}"
)"
update_stage="stage-release"
release_dir="${RELEASE_ROOT}/releases/${release_id}"
mkdir -p "$release_dir"
rsync --archive --delete _site/ "${release_dir}/"
cp "$expected_source" "${release_dir}/.release-source"
test -f "${release_dir}/index.html"

if [[ "$update_mode" != "content" && "$editor_is_current" != "1" ]]; then
  update_stage="publish-editor-release"
  editor_release_dir="${EDITOR_RELEASE_ROOT}/releases/${release_id}"
  editor_venv="${EDITOR_RELEASE_ROOT}/venv"
  editor_previous_target="$(
    readlink -f "${EDITOR_RELEASE_ROOT}/current" 2>/dev/null || true
  )"
  editor_service_pid="$(
    systemctl show "$EDITOR_SERVICE" -p MainPID --value 2>/dev/null || true
  )"
  editor_listener_pid="$(
    lsof -nP -iTCP:8790 -sTCP:LISTEN -t 2>/dev/null | head -1 || true
  )"

  if [[ "$(systemctl is-active "$EDITOR_SERVICE" 2>/dev/null || true)" != "active" ]]; then
    fail_update "${EDITOR_SERVICE} is not active."
  fi
  if [[
    -z "$editor_service_pid"
    || "$editor_service_pid" == "0"
    || (
      -n "$editor_listener_pid"
      && "$editor_listener_pid" != "$editor_service_pid"
    )
  ]]; then
    fail_update "Editor port 8790 is not owned by the managed service."
  fi

  mkdir -p "$editor_release_dir" "$editor_venv"
  rsync \
    --archive \
    --delete \
    "${web_snapshot}/editor/" \
    "${editor_release_dir}/editor/"
  printf '%s\n' "$web_commit" >"${editor_release_dir}/.web-commit"

  if [[ ! -x "${editor_venv}/bin/python" ]]; then
    python3 -m venv "$editor_venv"
  fi
  "${editor_venv}/bin/python" -m pip install \
    --disable-pip-version-check \
    --index-url "$EDITOR_PIP_INDEX_URL" \
    --requirement "${editor_release_dir}/editor/requirements.txt"
  PYTHONPATH="${editor_release_dir}/editor" \
    "${editor_venv}/bin/python" -c "from app.main import create_app"

  ln -sfn "$editor_release_dir" "${EDITOR_RELEASE_ROOT}/current.next"
  mv -Tf \
    "${EDITOR_RELEASE_ROOT}/current.next" \
    "${EDITOR_RELEASE_ROOT}/current"
  kill -TERM "$editor_service_pid"

  editor_ready=0
  for _attempt in $(seq 1 45); do
    sleep 1
    editor_next_pid="$(
      systemctl show "$EDITOR_SERVICE" -p MainPID --value 2>/dev/null || true
    )"
    editor_next_cwd="$(
      readlink -f "/proc/${editor_next_pid}/cwd" 2>/dev/null || true
    )"
    if [[
      -n "$editor_next_pid"
      && "$editor_next_pid" != "0"
      && "$editor_next_pid" != "$editor_service_pid"
      && "$editor_next_cwd" == "${editor_release_dir}/editor"
      && "$(systemctl is-active "$EDITOR_SERVICE" 2>/dev/null || true)" == "active"
    ]] && curl \
      --fail \
      --silent \
      --show-error \
      --max-time 5 \
      http://127.0.0.1:8790/api/config \
      >/dev/null; then
        editor_ready=1
        break
    fi
  done

  if [[ "$editor_ready" != "1" ]]; then
    if [[ -n "$editor_previous_target" ]]; then
      ln -sfn \
        "$editor_previous_target" \
        "${EDITOR_RELEASE_ROOT}/current.next"
      mv -Tf \
        "${EDITOR_RELEASE_ROOT}/current.next" \
        "${EDITOR_RELEASE_ROOT}/current"
      editor_failed_pid="$(
        systemctl show "$EDITOR_SERVICE" -p MainPID --value 2>/dev/null || true
      )"
      if [[ -n "$editor_failed_pid" && "$editor_failed_pid" != "0" ]]; then
        kill -TERM "$editor_failed_pid" || true
      fi
    fi
    fail_update "Editor failed to restart from ${editor_release_dir}."
  fi

  find "${EDITOR_RELEASE_ROOT}/releases" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d \
    -printf '%T@ %p\n' |
    sort -nr |
    tail -n +6 |
    cut -d' ' -f2- |
    xargs -r rm -rf
fi

if [[ "$contribution_graph_initialized" != "1" ]]; then
  update_stage="backfill-contribution-graph"
  python3 scripts/sync-line-authors.py \
    --repo "$CONTENT_GIT_MIRROR" \
    --revision "$mirror_revision" \
    --content-revision "$content_commit"
fi

update_stage="publish-release"
ln -sfn "$release_dir" "${RELEASE_ROOT}/current.next"
mv -Tf "${RELEASE_ROOT}/current.next" "${RELEASE_ROOT}/current"
printf '%s\n' "$content_commit" >"$CONTENT_STATE_FILE"
printf '%s\n' "$web_commit" >"$WEB_STATE_FILE"
printf '%s\n' "$content_commit" >"$ATTRIBUTION_STATE_FILE"

# Keep the installed updater aligned with the pushed Web commit for the next run.
update_stage="sync-updater"
mkdir -p "$WEB_ROOT"
rsync \
  --archive \
  --delete \
  --exclude="node_modules/" \
  --exclude="_site/" \
  "$web_snapshot/" \
  "$WEB_ROOT/"

update_stage="prune-releases"
find "${RELEASE_ROOT}/releases" \
  -mindepth 1 \
  -maxdepth 1 \
  -type d \
  -printf '%T@ %p\n' |
  sort -nr |
  tail -n +6 |
  cut -d' ' -f2- |
  xargs -r rm -rf

update_stage="complete"
write_status "success" "更新已发布" 1
echo "Published ${release_id}"
