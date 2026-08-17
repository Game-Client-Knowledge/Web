from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

from .config import Settings
from .notifications import deliver_admin_email


MAX_LOG_LINES = 80
MAX_LOG_CHARS = 12_000
ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
SECRET_RE = re.compile(
    r"(?i)\b(password|token|authorization)\s*[:=]\s*\S+"
)
REASON_LINE_RE = re.compile(
    r"(?i)(?:\berror\b|failed|failure|not found|missing|"
    r"traceback|不存在|失败)"
)
TEMP_PATH_RE = re.compile(r"(?:/private)?/tmp/[^\s:]+")
STAGE_LABELS = {
    "resolve-content-commit": "解析内容仓库提交",
    "resolve-web-commit": "解析 Web 仓库提交",
    "prepare-snapshots": "准备不可变快照",
    "download-web-snapshot": "下载 Web 快照",
    "download-content-snapshot": "下载内容快照",
    "import-content-history": "同步内容历史",
    "install-dependencies": "安装构建依赖",
    "audit-and-build": "内容审计与站点构建",
    "sync-line-authors": "同步行级作者信息",
    "publish-release": "发布生产版本",
    "sync-updater": "同步更新器",
    "prune-releases": "清理旧版本",
}


def read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )
    os.replace(temporary, path)


def failure_summary(log_path: Path) -> str:
    try:
        text = log_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return "无法读取本次更新日志，请检查 systemd journal。"
    text = ANSI_ESCAPE_RE.sub("", text)
    text = SECRET_RE.sub(r"\1=[redacted]", text)
    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    summary = "\n".join(lines[-MAX_LOG_LINES:])
    if len(summary) > MAX_LOG_CHARS:
        summary = summary[-MAX_LOG_CHARS:]
    return summary or "本次更新未产生可用的日志摘要。"


def short_commit(value: str) -> str:
    return value[:12] if value else "unresolved"


def reason_signature(summary: str) -> str:
    lines = [line.strip() for line in summary.splitlines() if line.strip()]
    reason_lines = [line for line in lines if REASON_LINE_RE.search(line)]
    selected = reason_lines[-20:] if reason_lines else lines[-20:]
    return TEMP_PATH_RE.sub("<tmp>", "\n".join(selected))


def failure_fingerprint(payload: dict[str, Any], summary: str) -> str:
    source = {
        "mode": payload.get("mode"),
        "stage": payload.get("stage"),
        "web_commit": payload.get("web_commit"),
        "content_commit": payload.get("content_commit"),
        "exit_code": payload.get("exit_code"),
        "failed_command": payload.get("failed_command"),
        "reason": reason_signature(summary),
    }
    encoded = json.dumps(
        source,
        ensure_ascii=False,
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_failure_notice(
    payload: dict[str, Any],
    summary: str,
    *,
    admin_url: str,
) -> tuple[str, str]:
    web_commit = str(payload.get("web_commit") or "")
    content_commit = str(payload.get("content_commit") or "")
    stage = str(payload.get("stage") or "unknown")
    stage_label = STAGE_LABELS.get(stage, stage)
    subject = (
        "[Game Client Knowledge] 发布失败 "
        f"(Content {short_commit(content_commit)})"
    )
    body = "\n".join(
        [
            "Game Client Knowledge 生产发布失败，当前线上版本未被替换。",
            "",
            f"更新模式：{payload.get('mode') or 'unknown'}",
            f"失败阶段：{stage_label} ({stage})",
            f"退出码：{payload.get('exit_code')}",
            f"Web commit：{web_commit or '尚未解析'}",
            f"Content commit：{content_commit or '尚未解析'}",
            f"开始时间：{payload.get('started_at') or 'unknown'}",
            f"失败命令：{payload.get('failed_command') or 'unknown'}",
            "",
            "失败日志摘要：",
            summary,
            "",
            f"后台状态：{admin_url}",
            "完整日志：journalctl -u game-client-knowledge-update.service",
        ]
    )
    return subject, body


def send_failure_notification(
    settings: Settings,
    payload: dict[str, Any],
    *,
    log_path: Path,
    dedupe_path: Path,
) -> dict[str, Any]:
    summary = failure_summary(log_path)
    fingerprint = failure_fingerprint(payload, summary)
    previous = read_json(dedupe_path)
    if (
        previous.get("fingerprint") == fingerprint
        and previous.get("status") == "sent"
    ):
        return {
            "status": "duplicate",
            "fingerprint": fingerprint,
            "error": None,
        }

    subject, body = build_failure_notice(
        payload,
        summary,
        admin_url=f"{settings.base_url}/admin",
    )
    try:
        status, error = deliver_admin_email(
            settings.db_path,
            settings,
            "site_update_failed",
            subject,
            body,
        )
    except Exception as exc:
        status, error = "failed", str(exc)[:500]

    if status == "sent":
        atomic_write_json(
            dedupe_path,
            {
                "fingerprint": fingerprint,
                "status": status,
                "web_commit": payload.get("web_commit"),
                "content_commit": payload.get("content_commit"),
                "stage": payload.get("stage"),
            },
        )
    return {
        "status": status,
        "fingerprint": fingerprint,
        "error": error,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--exit-code", required=True, type=int)
    parser.add_argument("--failed-command", required=True)
    parser.add_argument("--web-commit", default="")
    parser.add_argument("--content-commit", default="")
    parser.add_argument("--started-at", required=True)
    parser.add_argument("--log-file", required=True, type=Path)
    parser.add_argument("--dedupe-file", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = send_failure_notification(
        Settings.from_env(),
        {
            "mode": args.mode,
            "stage": args.stage,
            "exit_code": args.exit_code,
            "failed_command": args.failed_command,
            "web_commit": args.web_commit,
            "content_commit": args.content_commit,
            "started_at": args.started_at,
        },
        log_path=args.log_file,
        dedupe_path=args.dedupe_file,
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
