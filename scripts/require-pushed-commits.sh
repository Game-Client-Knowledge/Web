#!/usr/bin/env bash

set -euo pipefail

require_pushed_commit() {
  local repository_path="$1"
  local label="$2"
  local local_commit
  local remote_commit
  local status

  if ! git -C "$repository_path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "$label is not a Git repository: $repository_path" >&2
    return 1
  fi

  status="$(git -C "$repository_path" status --porcelain=v1 --untracked-files=all)"
  if [[ -n "$status" ]]; then
    echo "$label has uncommitted changes. Production deploys require a clean working tree:" >&2
    printf '%s\n' "$status" >&2
    return 1
  fi

  if ! git -C "$repository_path" remote get-url origin >/dev/null 2>&1; then
    echo "$label has no origin remote." >&2
    return 1
  fi

  git -C "$repository_path" fetch --quiet origin main
  local_commit="$(git -C "$repository_path" rev-parse HEAD)"
  remote_commit="$(git -C "$repository_path" rev-parse refs/remotes/origin/main)"

  if [[ "$local_commit" != "$remote_commit" ]]; then
    echo "$label HEAD is not the pushed origin/main commit." >&2
    echo "  local:  $local_commit" >&2
    echo "  remote: $remote_commit" >&2
    return 1
  fi

  printf '%s\n' "$local_commit"
}
