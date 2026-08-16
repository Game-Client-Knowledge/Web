from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from .config import Settings
from .database import Database
from .github import GitHubClient, GitHubError
from .notifications import deliver_email


def parse_github_time(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def auto_close_days(db: Database, settings: Settings) -> int:
    try:
        value = int(
            db.setting(
                "pr_auto_close_days",
                str(settings.pr_auto_close_days),
            )
        )
    except ValueError:
        value = settings.pr_auto_close_days
    return min(365, max(0, value))


def user_action_url(settings: Settings, submission_id: int) -> str:
    return f"{settings.base_url}/?submission={submission_id}"


async def send_user_feedback(
    db: Database,
    settings: Settings,
    submission: dict[str, Any],
    event_type: str,
    subject: str,
    body: str,
) -> None:
    if not submission["email_verified"]:
        return
    await asyncio.to_thread(
        deliver_email,
        settings.db_path,
        settings,
        event_type,
        [submission["email"]],
        subject,
        body,
        audience="contributor",
        user_id=submission["user_id"],
        submission_id=submission["id"],
    )


async def reconcile_submissions(
    db: Database,
    settings: Settings,
    github: GitHubClient,
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    result = {
        "checked": 0,
        "merged": 0,
        "closed": 0,
        "auto_closed": 0,
        "errors": 0,
    }
    token = settings.github_bot_token
    if not token:
        return result

    current_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    current_iso = current_time.isoformat()
    stale_days = auto_close_days(db, settings)
    with db.connect() as connection:
        submissions = [
            dict(row)
            for row in connection.execute(
                """
                SELECT s.*, u.email, u.email_verified, u.username
                FROM submissions s
                JOIN users u ON u.id = s.user_id
                WHERE s.status = 'open' AND s.pr_number IS NOT NULL
                ORDER BY s.id
                """
            ).fetchall()
        ]

    for submission in submissions:
        result["checked"] += 1
        try:
            pull = await github.pull_request(
                submission["pr_number"],
                token,
            )
            pull_updated = (
                parse_github_time(pull.get("updated_at"))
                or parse_github_time(submission.get("pr_updated_at"))
                or parse_github_time(submission.get("updated_at"))
                or current_time
            )
            if pull.get("merged_at"):
                with db.connect() as connection:
                    cursor = connection.execute(
                        """
                        UPDATE submissions
                        SET status = 'merged', auto_closed = 0,
                            closed_at = ?, pr_updated_at = ?,
                            last_synced_at = ?, updated_at = ?
                        WHERE id = ? AND status = 'open'
                        """,
                        (
                            current_iso,
                            pull_updated.isoformat(),
                            current_iso,
                            current_iso,
                            submission["id"],
                        ),
                    )
                if cursor.rowcount == 0:
                    continue
                result["merged"] += 1
                await send_user_feedback(
                    db,
                    settings,
                    submission,
                    "contributor_pr_merged",
                    f"[GCK] 你的贡献 PR #{submission['pr_number']} 已合并",
                    (
                        f"感谢你的贡献，{submission['title']} 已合并。\n\n"
                        f"PR：{submission['pr_url']}\n"
                    ),
                )
                db.audit(
                    "submission.merged",
                    "system",
                    user_id=submission["user_id"],
                    target=submission["pr_url"],
                )
                continue

            if pull.get("state") == "closed":
                with db.connect() as connection:
                    cursor = connection.execute(
                        """
                        UPDATE submissions
                        SET status = 'closed', auto_closed = 0,
                            closed_at = ?, pr_updated_at = ?,
                            last_synced_at = ?, updated_at = ?
                        WHERE id = ? AND status = 'open'
                        """,
                        (
                            current_iso,
                            pull_updated.isoformat(),
                            current_iso,
                            current_iso,
                            submission["id"],
                        ),
                    )
                if cursor.rowcount == 0:
                    continue
                result["closed"] += 1
                await send_user_feedback(
                    db,
                    settings,
                    submission,
                    "contributor_pr_closed",
                    f"[GCK] 你的贡献 PR #{submission['pr_number']} 已关闭",
                    (
                        f"你的贡献 {submission['title']} 已被关闭。\n\n"
                        f"PR：{submission['pr_url']}\n"
                    ),
                )
                db.audit(
                    "submission.closed",
                    "system",
                    user_id=submission["user_id"],
                    target=submission["pr_url"],
                )
                continue

            stale = (
                stale_days > 0
                and current_time - pull_updated >= timedelta(days=stale_days)
            )
            if stale:
                closed_pull = await github.update_pull_state(
                    submission["pr_number"],
                    "closed",
                    token,
                )
                closed_updated = (
                    parse_github_time(closed_pull.get("updated_at"))
                    or current_time
                )
                with db.connect() as connection:
                    cursor = connection.execute(
                        """
                        UPDATE submissions
                        SET status = 'closed', auto_closed = 1,
                            closed_at = ?, pr_updated_at = ?,
                            last_synced_at = ?, updated_at = ?
                        WHERE id = ? AND status = 'open'
                        """,
                        (
                            current_iso,
                            closed_updated.isoformat(),
                            current_iso,
                            current_iso,
                            submission["id"],
                        ),
                    )
                if cursor.rowcount == 0:
                    continue
                result["auto_closed"] += 1
                await send_user_feedback(
                    db,
                    settings,
                    submission,
                    "contributor_pr_auto_closed",
                    (
                        f"[GCK] 你的贡献 PR #{submission['pr_number']} "
                        "因长期未处理已自动关闭"
                    ),
                    (
                        f"你的贡献 {submission['title']} 已连续 "
                        f"{stale_days} 天没有处理，因此被自动关闭。\n\n"
                        f"PR：{submission['pr_url']}\n"
                        "你可以在编辑工作台恢复该 PR 并催促管理员处理：\n"
                        f"{user_action_url(settings, submission['id'])}\n"
                    ),
                )
                db.audit(
                    "submission.auto_closed",
                    "system",
                    user_id=submission["user_id"],
                    target=submission["pr_url"],
                    detail=f"stale_days={stale_days}",
                )
                continue

            with db.connect() as connection:
                connection.execute(
                    """
                    UPDATE submissions
                    SET pr_updated_at = ?, last_synced_at = ?
                    WHERE id = ? AND status = 'open'
                    """,
                    (
                        pull_updated.isoformat(),
                        current_iso,
                        submission["id"],
                    ),
                )
        except GitHubError as exc:
            result["errors"] += 1
            db.audit(
                "submission.sync_failed",
                "system",
                user_id=submission["user_id"],
                target=submission["pr_url"],
                detail=str(exc)[:1000],
            )
    return result
