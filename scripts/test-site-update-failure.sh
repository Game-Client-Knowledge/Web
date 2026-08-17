#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FIXTURE_ROOT="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_ROOT"' EXIT

mkdir -p \
  "${FIXTURE_ROOT}/bin" \
  "${FIXTURE_ROOT}/builder" \
  "${FIXTURE_ROOT}/editor/app" \
  "${FIXTURE_ROOT}/release"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'echo "fixture curl failure" >&2' \
  'exit 22' \
  >"${FIXTURE_ROOT}/bin/curl"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'echo "fixture git failure" >&2' \
  'exit 1' \
  >"${FIXTURE_ROOT}/bin/git"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'exit 0' \
  >"${FIXTURE_ROOT}/bin/flock"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'stage=""' \
  'mode=""' \
  'web_commit=""' \
  'content_commit=""' \
  'log_file=""' \
  'while (($#)); do' \
  '  case "$1" in' \
  '    --stage) stage="$2"; shift 2 ;;' \
  '    --mode) mode="$2"; shift 2 ;;' \
  '    --web-commit) web_commit="$2"; shift 2 ;;' \
  '    --content-commit) content_commit="$2"; shift 2 ;;' \
  '    --log-file) log_file="$2"; shift 2 ;;' \
  '    *) shift ;;' \
  '  esac' \
  'done' \
  'printf "stage=%s\nmode=%s\nweb=%s\ncontent=%s\n" "$stage" "$mode" "$web_commit" "$content_commit" >"${NOTIFICATION_CAPTURE}.args"' \
  'cp "$log_file" "${NOTIFICATION_CAPTURE}.log"' \
  >"${FIXTURE_ROOT}/editor-python"
chmod +x \
  "${FIXTURE_ROOT}/bin/curl" \
  "${FIXTURE_ROOT}/bin/flock" \
  "${FIXTURE_ROOT}/bin/git" \
  "${FIXTURE_ROOT}/editor-python"
touch "${FIXTURE_ROOT}/editor/app/site_update_notifications.py"
printf '{"mode":"site"}\n' >"${FIXTURE_ROOT}/site-update.request"

set +e
PATH="${FIXTURE_ROOT}/bin:${PATH}" \
BUILDER_ROOT="${FIXTURE_ROOT}/builder" \
WEB_ROOT="${FIXTURE_ROOT}/builder/web" \
RELEASE_ROOT="${FIXTURE_ROOT}/release" \
CONTENT_STATE_FILE="${FIXTURE_ROOT}/builder/last-content-commit" \
WEB_STATE_FILE="${FIXTURE_ROOT}/builder/last-web-commit" \
ATTRIBUTION_STATE_FILE="${FIXTURE_ROOT}/builder/last-attribution-commit" \
CONTENT_GIT_MIRROR="${FIXTURE_ROOT}/builder/content.git" \
LOCK_FILE="${FIXTURE_ROOT}/builder/update.lock" \
AUTO_CHECK_STATE_FILE="${FIXTURE_ROOT}/builder/last-auto-check" \
UPDATE_REQUEST_FILE="${FIXTURE_ROOT}/site-update.request" \
UPDATE_STATUS_FILE="${FIXTURE_ROOT}/site-update-status.json" \
EDITOR_DB_PATH="${FIXTURE_ROOT}/editor.db" \
FAILURE_NOTIFICATION_STATE_FILE="${FIXTURE_ROOT}/last-notification.json" \
EDITOR_PYTHON="${FIXTURE_ROOT}/editor-python" \
EDITOR_APP_ROOT="${FIXTURE_ROOT}/editor" \
NOTIFICATION_CAPTURE="${FIXTURE_ROOT}/notification" \
  bash "${PROJECT_ROOT}/deploy/server/update-site.sh" \
  >"${FIXTURE_ROOT}/updater-output.log" 2>&1
exit_code=$?
set -e

if ((exit_code == 0)); then
  echo "Expected the fixture update to fail." >&2
  cat "${FIXTURE_ROOT}/updater-output.log" >&2
  exit 1
fi

python3 - \
  "${FIXTURE_ROOT}/site-update-status.json" \
  "${FIXTURE_ROOT}/notification.args" \
  "${FIXTURE_ROOT}/notification.log" <<'PY'
import json
import sys
from pathlib import Path

status = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
arguments = Path(sys.argv[2]).read_text(encoding="utf-8")
log = Path(sys.argv[3]).read_text(encoding="utf-8")

assert status["state"] == "failed", status
assert status["mode"] == "site", status
assert "resolve-content-commit" in status["message"], status
assert "stage=resolve-content-commit" in arguments, arguments
assert "mode=site" in arguments, arguments
assert "fixture curl failure" in log, log
assert "fixture git failure" in log, log
PY

printf 'Site update failure notification checks passed\n'
