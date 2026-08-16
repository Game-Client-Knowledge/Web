from __future__ import annotations

import asyncio
import html
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

from .config import Settings
from .database import Database
from .github import GitHubClient, GitHubError
from .notifications import deliver_admin_email, deliver_email
from .security import normalize_email, random_token, token_hash

EXTERNAL_SCAN_CURSOR = "external_pr_scan_cursor"
EXTERNAL_URGE_TOKEN_DAYS = 90
WEB_EDITOR_MARKER = "Submitted from Game Client Knowledge Web Editor"


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


def external_urge_url(settings: Settings, token: str) -> str:
    return (
        f"{settings.base_url}/external-pr/urge?"
        + urlencode({"token": token})
    )


def issue_external_urge_token(
    db: Database,
    external_pr_id: int,
    *,
    now: datetime | None = None,
) -> str:
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    raw = random_token()
    with db.connect() as connection:
        connection.execute(
            """
            INSERT INTO external_pr_action_tokens(
                external_pr_id, token_hash, action, expires_at, created_at
            )
            VALUES(?, ?, 'urge', ?, ?)
            """,
            (
                external_pr_id,
                token_hash(raw),
                (current + timedelta(days=EXTERNAL_URGE_TOKEN_DAYS)).isoformat(),
                current.isoformat(),
            ),
        )
        connection.execute(
            "DELETE FROM external_pr_action_tokens WHERE expires_at <= ?",
            (current.isoformat(),),
        )
    return raw


def action_email_html(
    title: str,
    body: str,
    action_label: str | None = None,
    action_url: str | None = None,
) -> str:
    paragraphs = "".join(
        f"<p>{html.escape(part).replace(chr(10), '<br>')}</p>"
        for part in body.strip().split("\n\n")
        if part.strip()
    )
    button = ""
    if action_label and action_url:
        button = (
            '<p><a href="'
            + html.escape(action_url, quote=True)
            + '" style="display:inline-block;padding:11px 18px;'
            "background:#116b5c;color:#fff;text-decoration:none;"
            'border-radius:4px;font-weight:700">'
            + html.escape(action_label)
            + "</a></p>"
        )
    return (
        '<div style="font-family:system-ui,-apple-system,sans-serif;'
        'line-height:1.65;color:#1f2926">'
        f"<h2>{html.escape(title)}</h2>{paragraphs}{button}</div>"
    )


def valid_contributor_email(value: str | None) -> str | None:
    if not value:
        return None
    candidate = value.strip()
    if "noreply.github.com" in candidate.lower():
        return None
    try:
        return normalize_email(candidate)
    except ValueError:
        return None


async def resolve_external_contributor_email(
    db: Database,
    github: GitHubClient,
    pull: dict[str, Any],
    token: str,
) -> tuple[str | None, str | None]:
    login = str((pull.get("user") or {}).get("login") or "").strip()
    if not login:
        return None, None
    with db.connect() as connection:
        linked = connection.execute(
            """
            SELECT email FROM users
            WHERE github_login = ? COLLATE NOCASE
              AND email_verified = 1 AND status = 'active'
            """,
            (login,),
        ).fetchone()
    if linked:
        email = valid_contributor_email(linked["email"])
        if email:
            return email, "linked_account"

    try:
        profile = await github.public_user(login, token)
        email = valid_contributor_email(profile.get("email"))
        if email:
            return email, "github_profile"
    except GitHubError:
        pass

    try:
        commits = await github.pull_request_commits(
            int(pull["number"]),
            token,
        )
    except GitHubError:
        return None, None
    matching: list[str] = []
    unattributed: list[str] = []
    for commit in commits:
        email = valid_contributor_email(
            ((commit.get("commit") or {}).get("author") or {}).get("email")
        )
        if not email:
            continue
        author_login = str((commit.get("author") or {}).get("login") or "")
        if author_login.lower() == login.lower():
            matching.append(email)
        elif not author_login:
            unattributed.append(email)
    candidates = matching or unattributed
    return (candidates[0], "commit_author") if candidates else (None, None)


async def send_external_feedback(
    db: Database,
    settings: Settings,
    pull: dict[str, Any],
    event_type: str,
    subject: str,
    body: str,
    *,
    action_label: str | None = None,
    action_token: str | None = None,
) -> bool:
    email = pull.get("contributor_email")
    if not email:
        return False
    action_url = (
        external_urge_url(settings, action_token)
        if action_token
        else None
    )
    status, _error = await asyncio.to_thread(
        deliver_email,
        settings.db_path,
        settings,
        event_type,
        [email],
        subject,
        body,
        audience="external_contributor",
        external_pr_id=pull["id"],
        html_body=action_email_html(
            subject,
            body,
            action_label,
            action_url,
        ),
    )
    return status == "sent"


def pull_status(pull: dict[str, Any]) -> str:
    if pull.get("merged_at"):
        return "merged"
    return "closed" if pull.get("state") == "closed" else "open"


def is_web_editor_pull(
    pull: dict[str, Any],
    web_pr_numbers: set[int],
) -> bool:
    number = int(pull["number"])
    body = str(pull.get("body") or "")
    head = str((pull.get("head") or {}).get("ref") or "")
    return (
        number in web_pr_numbers
        or WEB_EDITOR_MARKER in body
        or head.startswith("web/")
    )


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


async def notify_external_discovery(
    db: Database,
    settings: Settings,
    pull: dict[str, Any],
    *,
    now: datetime,
) -> None:
    email_label = (
        f"{pull['contributor_email']} ({pull['email_source']})"
        if pull.get("contributor_email")
        else "GitHub 未公开可投递邮箱"
    )
    admin_body = (
        f"检测到一个不是通过网页编辑器创建的 PR。\n\n"
        f"提交人：@{pull['github_login']}\n"
        f"邮箱：{email_label}\n"
        f"标题：{pull['title']}\n"
        f"分支：{pull['head_ref']}\n"
        f"PR：{pull['pr_url']}\n"
    )
    await asyncio.to_thread(
        deliver_admin_email,
        settings.db_path,
        settings,
        "external_pr_discovered",
        f"[GCK] 检测到外部 PR #{pull['pr_number']}",
        admin_body,
        external_pr_id=pull["id"],
        html_body=action_email_html(
            f"检测到外部 PR #{pull['pr_number']}",
            admin_body,
        ),
    )
    await send_external_thank_you(db, settings, pull, now=now)


async def send_external_thank_you(
    db: Database,
    settings: Settings,
    pull: dict[str, Any],
    *,
    now: datetime,
) -> None:
    if not pull.get("contributor_email"):
        return
    action_token = issue_external_urge_token(
        db,
        pull["id"],
        now=now,
    )
    action_url = external_urge_url(settings, action_token)
    body = (
        f"感谢你向 Game Client Knowledge 提交贡献。\n\n"
        f"标题：{pull['title']}\n"
        f"PR：{pull['pr_url']}\n\n"
        "管理员已收到处理通知。如果长时间没有进展，可以催办管理员：\n"
        f"{action_url}\n"
    )
    delivered = await send_external_feedback(
        db,
        settings,
        pull,
        "external_contributor_pr_received",
        f"[GCK] 感谢你的贡献 PR #{pull['pr_number']}",
        body,
        action_label="催办管理员",
        action_token=action_token,
    )
    with db.connect() as connection:
        connection.execute(
            """
            UPDATE external_pull_requests
            SET thank_you_attempted_at = ?,
                thank_you_sent_at = CASE WHEN ? THEN ? ELSE thank_you_sent_at END,
                updated_at = ?
            WHERE id = ?
            """,
            (
                now.isoformat(),
                1 if delivered else 0,
                now.isoformat(),
                now.isoformat(),
                pull["id"],
            ),
        )


async def notify_external_terminal_state(
    db: Database,
    settings: Settings,
    pull: dict[str, Any],
    status: str,
    *,
    stale_days: int = 0,
    now: datetime,
) -> None:
    if status == "merged":
        subject = f"[GCK] 你的贡献 PR #{pull['pr_number']} 已合并"
        body = (
            f"感谢你的贡献，{pull['title']} 已合并。\n\n"
            f"PR：{pull['pr_url']}\n"
        )
        event_type = "external_contributor_pr_merged"
        await send_external_feedback(
            db,
            settings,
            pull,
            event_type,
            subject,
            body,
        )
        return
    if status == "auto_closed":
        token = issue_external_urge_token(db, pull["id"], now=now)
        action_url = external_urge_url(settings, token)
        subject = (
            f"[GCK] 你的贡献 PR #{pull['pr_number']} "
            "因长期未处理已自动关闭"
        )
        body = (
            f"你的贡献 {pull['title']} 已连续 {stale_days} 天没有处理，"
            "因此被自动关闭。\n\n"
            f"PR：{pull['pr_url']}\n\n"
            "你仍可催办管理员，由管理员决定是否重新打开：\n"
            f"{action_url}\n"
        )
        await send_external_feedback(
            db,
            settings,
            pull,
            "external_contributor_pr_auto_closed",
            subject,
            body,
            action_label="催办管理员",
            action_token=token,
        )
        return
    await send_external_feedback(
        db,
        settings,
        pull,
        "external_contributor_pr_closed",
        f"[GCK] 你的贡献 PR #{pull['pr_number']} 已关闭",
        (
            f"你的贡献 {pull['title']} 已被关闭。\n\n"
            f"PR：{pull['pr_url']}\n"
        ),
    )


async def reconcile_external_pull_requests(
    db: Database,
    settings: Settings,
    github: GitHubClient,
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    result = {
        "external_checked": 0,
        "external_discovered": 0,
        "external_merged": 0,
        "external_closed": 0,
        "external_auto_closed": 0,
        "external_errors": 0,
    }
    token = settings.github_bot_token
    if not token:
        return result
    current_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    current_iso = current_time.isoformat()
    stale_days = auto_close_days(db, settings)
    try:
        pulls = await github.list_pull_requests(token, state="all", per_page=100)
    except GitHubError as exc:
        result["external_errors"] += 1
        db.audit(
            "external_pr.scan_failed",
            "system",
            detail=str(exc)[:1000],
        )
        return result

    pull_by_number = {int(item["number"]): item for item in pulls}
    with db.connect() as connection:
        web_pr_numbers = {
            int(row["pr_number"])
            for row in connection.execute(
                "SELECT pr_number FROM submissions WHERE pr_number IS NOT NULL"
            ).fetchall()
        }
        known_external = {
            int(row["pr_number"])
            for row in connection.execute(
                "SELECT pr_number FROM external_pull_requests"
            ).fetchall()
        }
        cursor_value = db.setting(EXTERNAL_SCAN_CURSOR, "")
    scan_cursor = parse_github_time(cursor_value)

    for payload in reversed(pulls):
        number = int(payload["number"])
        if number in known_external or is_web_editor_pull(
            payload,
            web_pr_numbers,
        ):
            continue
        status = pull_status(payload)
        created_at = parse_github_time(payload.get("created_at"))
        if status != "open" and (
            scan_cursor is None
            or created_at is None
            or created_at <= scan_cursor
        ):
            continue
        login = str((payload.get("user") or {}).get("login") or "unknown")
        email, email_source = await resolve_external_contributor_email(
            db,
            github,
            payload,
            token,
        )
        pr_updated = (
            parse_github_time(payload.get("updated_at"))
            or created_at
            or current_time
        )
        github_created = created_at or current_time
        with db.connect() as connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO external_pull_requests(
                    pr_number, pr_url, title, github_login,
                    contributor_email, email_source, head_ref,
                    status, is_draft, auto_closed,
                    github_created_at, pr_updated_at, last_synced_at,
                    closed_at, created_at, updated_at
                )
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
                """,
                (
                    number,
                    payload.get("html_url") or "",
                    str(payload.get("title") or f"PR #{number}")[:500],
                    login[:100],
                    email,
                    email_source,
                    str((payload.get("head") or {}).get("ref") or "")[:240],
                    status,
                    1 if payload.get("draft") else 0,
                    github_created.isoformat(),
                    pr_updated.isoformat(),
                    current_iso,
                    current_iso if status != "open" else None,
                    current_iso,
                    current_iso,
                ),
            )
            if cursor.rowcount == 0:
                continue
            external_id = int(cursor.lastrowid)
            row = dict(
                connection.execute(
                    "SELECT * FROM external_pull_requests WHERE id = ?",
                    (external_id,),
                ).fetchone()
            )
        known_external.add(number)
        result["external_discovered"] += 1
        await notify_external_discovery(
            db,
            settings,
            row,
            now=current_time,
        )
        if status == "merged":
            result["external_merged"] += 1
            await notify_external_terminal_state(
                db,
                settings,
                row,
                "merged",
                now=current_time,
            )
        elif status == "closed":
            result["external_closed"] += 1
            await notify_external_terminal_state(
                db,
                settings,
                row,
                "closed",
                now=current_time,
            )
        db.audit(
            "external_pr.discovered",
            "system",
            target=row["pr_url"],
            detail=f"github_login={login};email_source={email_source or 'none'}",
        )

    with db.connect() as connection:
        connection.execute(
            """
            INSERT INTO settings(key, value, updated_at)
            VALUES(?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            """,
            (EXTERNAL_SCAN_CURSOR, current_iso, current_iso),
        )
        open_pulls = [
            dict(row)
            for row in connection.execute(
                """
                SELECT * FROM external_pull_requests
                WHERE status = 'open'
                ORDER BY id
                """
            ).fetchall()
        ]

    for external in open_pulls:
        result["external_checked"] += 1
        try:
            payload = pull_by_number.get(external["pr_number"])
            if payload is None:
                payload = await github.pull_request(
                    external["pr_number"],
                    token,
                )
            if not external.get("contributor_email"):
                email, email_source = await resolve_external_contributor_email(
                    db,
                    github,
                    payload,
                    token,
                )
                if email:
                    external["contributor_email"] = email
                    external["email_source"] = email_source
                    with db.connect() as connection:
                        connection.execute(
                            """
                            UPDATE external_pull_requests
                            SET contributor_email = ?, email_source = ?,
                                updated_at = ?
                            WHERE id = ?
                            """,
                            (
                                email,
                                email_source,
                                current_iso,
                                external["id"],
                            ),
                        )
                    if not external.get("thank_you_sent_at"):
                        await send_external_thank_you(
                            db,
                            settings,
                            external,
                            now=current_time,
                        )
                        external["thank_you_attempted_at"] = current_iso
            last_thank_attempt = parse_github_time(
                external.get("thank_you_attempted_at")
            )
            retry_thank_you = (
                external.get("contributor_email")
                and not external.get("thank_you_sent_at")
                and (
                    last_thank_attempt is None
                    or current_time - last_thank_attempt >= timedelta(hours=24)
                )
            )
            if retry_thank_you:
                await send_external_thank_you(
                    db,
                    settings,
                    external,
                    now=current_time,
                )
                external["thank_you_attempted_at"] = current_iso
            status = pull_status(payload)
            pull_updated = (
                parse_github_time(payload.get("updated_at"))
                or parse_github_time(external.get("pr_updated_at"))
                or current_time
            )
            if status in {"merged", "closed"}:
                with db.connect() as connection:
                    changed = connection.execute(
                        """
                        UPDATE external_pull_requests
                        SET status = ?, auto_closed = 0, closed_at = ?,
                            pr_updated_at = ?, last_synced_at = ?, updated_at = ?
                        WHERE id = ? AND status = 'open'
                        """,
                        (
                            status,
                            current_iso,
                            pull_updated.isoformat(),
                            current_iso,
                            current_iso,
                            external["id"],
                        ),
                    )
                if changed.rowcount:
                    result[f"external_{status}"] += 1
                    await notify_external_terminal_state(
                        db,
                        settings,
                        external,
                        status,
                        now=current_time,
                    )
                continue

            stale = (
                stale_days > 0
                and current_time - pull_updated >= timedelta(days=stale_days)
            )
            if stale:
                closed = await github.update_pull_state(
                    external["pr_number"],
                    "closed",
                    token,
                )
                closed_updated = (
                    parse_github_time(closed.get("updated_at"))
                    or current_time
                )
                with db.connect() as connection:
                    changed = connection.execute(
                        """
                        UPDATE external_pull_requests
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
                            external["id"],
                        ),
                    )
                if changed.rowcount:
                    result["external_auto_closed"] += 1
                    await notify_external_terminal_state(
                        db,
                        settings,
                        external,
                        "auto_closed",
                        stale_days=stale_days,
                        now=current_time,
                    )
                continue
            with db.connect() as connection:
                connection.execute(
                    """
                    UPDATE external_pull_requests
                    SET pr_updated_at = ?, last_synced_at = ?
                    WHERE id = ? AND status = 'open'
                    """,
                    (
                        pull_updated.isoformat(),
                        current_iso,
                        external["id"],
                    ),
                )
        except GitHubError as exc:
            result["external_errors"] += 1
            db.audit(
                "external_pr.sync_failed",
                "system",
                target=external["pr_url"],
                detail=str(exc)[:1000],
            )
    return result


async def reconcile_all_pull_requests(
    db: Database,
    settings: Settings,
    github: GitHubClient,
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    web = await reconcile_submissions(
        db,
        settings,
        github,
        now=now,
    )
    external = await reconcile_external_pull_requests(
        db,
        settings,
        github,
        now=now,
    )
    return {**web, **external}
