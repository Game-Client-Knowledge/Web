#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-sourcecode@192.168.31.109}"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_gck_deploy}"
RELEASE_ROOT="${EDITOR_RELEASE_ROOT:-/opt/game-client-knowledge-editor}"
PIP_INDEX_URL="${EDITOR_PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"
ALLOW_INACTIVE="${EDITOR_ALLOW_INACTIVE_DEPLOY:-0}"
SSH=(ssh -i "$DEPLOY_KEY" -o IdentitiesOnly=yes)
RSYNC_SSH="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes"

source "${SCRIPT_DIR}/require-pushed-commits.sh"
cd "$PROJECT_ROOT"

if [[ ! -f "$DEPLOY_KEY" ]]; then
  echo "Deployment key not found: $DEPLOY_KEY" >&2
  exit 1
fi

WEB_COMMIT="$(require_pushed_commit "$PROJECT_ROOT" "Web repository")"
RELEASE_ID="$(printf '%s-%s' "$(date -u +%Y%m%dT%H%M%SZ)" "${WEB_COMMIT:0:12}")"
REMOTE_RELEASE="${RELEASE_ROOT}/releases/${RELEASE_ID}"
PACKAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$PACKAGE_DIR"' EXIT

"${SSH[@]}" "$DEPLOY_HOST" bash -s -- "$ALLOW_INACTIVE" <<'REMOTE'
set -euo pipefail

allow_inactive="$1"
service="game-client-knowledge-editor"
service_pid="$(systemctl show "$service" -p MainPID --value 2>/dev/null || true)"
listener_pid="$(lsof -nP -iTCP:8790 -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
status="$(systemctl is-active "$service" 2>/dev/null || true)"

if [[ -n "$listener_pid" && "$listener_pid" != "$service_pid" ]]; then
  echo "Refusing deployment: port 8790 is owned by unmanaged PID $listener_pid." >&2
  exit 1
fi
if [[ "$status" != "active" && "$allow_inactive" != "1" ]]; then
  echo "Refusing deployment: $service is $status." >&2
  echo "Start it first or set EDITOR_ALLOW_INACTIVE_DEPLOY=1 explicitly." >&2
  exit 1
fi
REMOTE

git archive "$WEB_COMMIT" editor | tar -x -C "$PACKAGE_DIR"

"${SSH[@]}" "$DEPLOY_HOST" "mkdir -p '$REMOTE_RELEASE'"
rsync \
  --archive \
  --compress \
  --delete \
  --human-readable \
  -e "$RSYNC_SSH" \
  "$PACKAGE_DIR/editor/" \
  "${DEPLOY_HOST}:${REMOTE_RELEASE}/editor/"

"${SSH[@]}" "$DEPLOY_HOST" bash -s -- \
  "$RELEASE_ROOT" "$REMOTE_RELEASE" "$PIP_INDEX_URL" <<'REMOTE'
set -euo pipefail

release_root="$1"
remote_release="$2"
pip_index_url="$3"
venv="${release_root}/venv"

test -s "${remote_release}/editor/requirements.txt"
if [[ ! -x "${venv}/bin/python" ]]; then
  python3 -m venv "$venv"
fi
"${venv}/bin/python" -m pip install \
  --disable-pip-version-check \
  --index-url "$pip_index_url" \
  --upgrade "pip==26.1.2"
"${venv}/bin/python" -m pip install \
  --disable-pip-version-check \
  --index-url "$pip_index_url" \
  --requirement "${remote_release}/editor/requirements.txt"
PYTHONPATH="${remote_release}/editor" \
  "${venv}/bin/python" -c "from app.main import create_app"

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

echo "Editor release ${RELEASE_ID} is active."
echo "Restart with: sudo systemctl restart game-client-knowledge-editor"
