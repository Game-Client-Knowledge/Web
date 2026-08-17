#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-sourcecode@192.168.31.109}"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_gck_deploy}"
SSH=(ssh -t -i "$DEPLOY_KEY" -o IdentitiesOnly=yes)

source "${SCRIPT_DIR}/require-pushed-commits.sh"
cd "$PROJECT_ROOT"

if [[ ! -f "$DEPLOY_KEY" ]]; then
  echo "Deployment key not found: $DEPLOY_KEY" >&2
  exit 1
fi

require_pushed_commit "$PROJECT_ROOT" "Web repository" >/dev/null

"${SSH[@]}" "$DEPLOY_HOST" bash -s <<'REMOTE'
set -euo pipefail

source_dir="/home/sourcecode/gck-builder/web/deploy/server"
sudo install -d \
  -o sourcecode \
  -g sourcecode \
  -m 0750 \
  /var/lib/game-client-knowledge-editor
sudo install -m 0644 \
  "${source_dir}/game-client-knowledge-update.service" \
  /etc/systemd/system/game-client-knowledge-update.service
sudo install -m 0644 \
  "${source_dir}/game-client-knowledge-update.timer" \
  /etc/systemd/system/game-client-knowledge-update.timer
sudo install -m 0644 \
  "${source_dir}/game-client-knowledge-update.path" \
  /etc/systemd/system/game-client-knowledge-update.path
sudo systemctl daemon-reload
sudo systemctl enable --now \
  game-client-knowledge-update.timer \
  game-client-knowledge-update.path
sudo systemctl restart game-client-knowledge-update.timer
systemctl status \
  game-client-knowledge-update.timer \
  game-client-knowledge-update.path \
  --no-pager
REMOTE
