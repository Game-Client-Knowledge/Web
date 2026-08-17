from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


UPDATE_MODES = {"content", "site"}
ACTIVE_STATES = {"queued", "checking", "building"}


class UpdateAlreadyRunningError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def read_release_source(path: Path) -> dict[str, str]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {}
    result: dict[str, str] = {}
    for line in lines:
        key, separator, value = line.partition("=")
        if separator and key in {"web", "content"} and value:
            result[key] = value
    return result


def update_status(
    status_path: Path,
    release_source_path: Path,
    request_path: Path,
) -> dict[str, Any]:
    status = read_json(status_path)
    deployed = read_release_source(release_source_path)
    queued = read_json(request_path)
    return {
        "state": status.get("state", "idle"),
        "mode": status.get("mode"),
        "message": status.get("message", "尚无自动更新运行记录"),
        "started_at": status.get("started_at"),
        "finished_at": status.get("finished_at"),
        "web_commit": status.get("web_commit"),
        "content_commit": status.get("content_commit"),
        "deployed_web_commit": deployed.get("web"),
        "deployed_content_commit": deployed.get("content"),
        "queued": bool(queued),
        "queued_mode": queued.get("mode"),
        "queued_at": queued.get("requested_at"),
    }


def queue_update(
    request_path: Path,
    status_path: Path,
    *,
    mode: str,
    requested_by: int,
) -> dict[str, Any]:
    if mode not in UPDATE_MODES:
        raise ValueError("更新模式无效")
    current_status = read_json(status_path)
    if request_path.exists() or current_status.get("state") in ACTIVE_STATES:
        raise UpdateAlreadyRunningError("已有站点更新正在排队或执行")

    request_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "mode": mode,
        "requested_by": requested_by,
        "requested_at": utc_now(),
    }
    queued_status = {
        "state": "queued",
        "mode": mode,
        "message": (
            "内容更新已排队"
            if mode == "content"
            else "服务器版本更新已排队"
        ),
        "started_at": None,
        "finished_at": None,
        "requested_at": payload["requested_at"],
    }
    status_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_status = status_path.with_name(
        f".{status_path.name}.{os.getpid()}.tmp"
    )
    temporary_status.write_text(
        json.dumps(queued_status, ensure_ascii=False),
        encoding="utf-8",
    )
    os.replace(temporary_status, status_path)

    # The path unit can react as soon as the request appears, so publish the
    # queued status before atomically exposing the trigger file.
    temporary = request_path.with_name(
        f".{request_path.name}.{os.getpid()}.tmp"
    )
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )
    os.replace(temporary, request_path)
    return payload
