from __future__ import annotations

import json
import re
import secrets
import sqlite3
from collections.abc import Callable
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from pydantic import BaseModel, Field

from .config import Settings
from .database import Database, utc_now
from .notifications import deliver_email
from .security import validate_content_path


class AttributionLine(BaseModel):
    line: int = Field(ge=1)
    commit: str = Field(min_length=7, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(default="", max_length=254)


class AttributionFile(BaseModel):
    path: str = Field(max_length=240)
    commit: str = Field(min_length=7, max_length=64)
    line_count: int = Field(ge=0)
    lines: list[AttributionLine] = Field(max_length=10000)


class AttributionSyncRequest(BaseModel):
    revision: str = Field(min_length=7, max_length=64)
    files: list[AttributionFile] = Field(max_length=100)
    deleted: list[str] = Field(default_factory=list, max_length=1000)


class RenderSegment(BaseModel):
    block_start_line: int = Field(ge=1)
    block_end_line: int = Field(ge=1)
    start_offset: int = Field(ge=0)
    end_offset: int = Field(ge=0)
    quote: str = Field(default="", max_length=4000)


class CommentRequest(BaseModel):
    path: str = Field(max_length=240)
    revision_sha: str = Field(min_length=7, max_length=64)
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    start_column: int = Field(default=0, ge=0, le=100000)
    end_column: int = Field(default=0, ge=0, le=100000)
    quote: str = Field(min_length=1, max_length=8000)
    render_segments: list[RenderSegment] = Field(default_factory=list, max_length=100)
    body: str = Field(min_length=1, max_length=8000)
    parent_id: int | None = Field(default=None, ge=1)
    reply_to_id: int | None = Field(default=None, ge=1)
    mention_user_ids: list[int] = Field(default_factory=list, max_length=50)


class NotificationPreferenceRequest(BaseModel):
    email_notifications_enabled: bool


def _github_login(email: str) -> str | None:
    match = re.fullmatch(
        r"(?:\d+\+)?([^@]+)@users\.noreply\.github\.com",
        email.lower(),
    )
    return match.group(1) if match else None


def _public_comment(row: sqlite3.Row, mentions: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "path": row["path"],
        "revision_sha": row["revision_sha"],
        "start_line": row["start_line"],
        "end_line": row["end_line"],
        "start_column": row["start_column"],
        "end_column": row["end_column"],
        "quote": row["quote"],
        "render_segments": json.loads(row["render_segments"]),
        "body": row["body"],
        "parent_id": row["parent_id"],
        "reply_to_id": row["reply_to_id"],
        "author": {
            "id": row["author_id"],
            "username": row["username"],
            "github_login": row["github_login"],
        },
        "mentions": mentions,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _author_ranges(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    ranges: list[dict[str, Any]] = []
    for row in rows:
        author = {
            "name": row["author_name"],
            "github_login": row["github_login"],
            "user_id": row["user_id"],
        }
        if (
            ranges
            and ranges[-1]["end_line"] + 1 == row["line_number"]
            and ranges[-1]["author"] == author
        ):
            ranges[-1]["end_line"] = row["line_number"]
            continue
        ranges.append(
            {
                "start_line": row["line_number"],
                "end_line": row["line_number"],
                "commit": row["commit_sha"],
                "author": author,
            }
        )
    return ranges


def _comment_url(settings: Settings, path: str, comment_id: int) -> str:
    origin = settings.base_url.split("/editor", 1)[0]
    parsed = PurePosixPath(path)
    if parsed.suffix.lower() == ".md":
        route = (
            parsed.parent.as_posix()
            if parsed.name.lower() == "readme.md"
            else (parsed.parent / parsed.stem).as_posix()
        )
    else:
        route = (parsed.parent / "files" / parsed.name).as_posix()
    return f"{origin}/{quote(route)}/?comment={comment_id}"


def create_comments_router(
    db: Database,
    settings: Settings,
    read_session: Callable[[Request], dict[str, Any] | None],
    require_ready_user: Callable[[Request], dict[str, Any]],
    verify_csrf: Callable[[dict[str, Any], str | None], None],
    rate_limit: Callable[[str, int, int], bool],
) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.post("/internal/attribution-sync")
    def sync_attribution(
        payload: AttributionSyncRequest,
        authorization: str | None = Header(default=None),
    ) -> dict[str, int]:
        expected = settings.attribution_sync_token
        supplied = (
            authorization.removeprefix("Bearer ").strip()
            if authorization and authorization.startswith("Bearer ")
            else ""
        )
        if not expected or not secrets.compare_digest(expected, supplied):
            raise HTTPException(status_code=401, detail="同步令牌无效")

        files = 0
        lines = 0
        now = utc_now()
        with db.connect() as connection:
            for raw_path in payload.deleted:
                try:
                    path = validate_content_path(raw_path)
                except ValueError as exc:
                    raise HTTPException(status_code=422, detail=str(exc)) from exc
                connection.execute(
                    "DELETE FROM content_revisions WHERE path = ?",
                    (path,),
                )

            for item in payload.files:
                try:
                    path = validate_content_path(item.path)
                except ValueError as exc:
                    raise HTTPException(status_code=422, detail=str(exc)) from exc
                if len(item.lines) != item.line_count:
                    raise HTTPException(
                        status_code=422,
                        detail=f"{path} 的行数与归属记录不一致",
                    )
                connection.execute(
                    """
                    INSERT INTO content_revisions(path, commit_sha, line_count, updated_at)
                    VALUES(?, ?, ?, ?)
                    ON CONFLICT(path) DO UPDATE SET
                        commit_sha = excluded.commit_sha,
                        line_count = excluded.line_count,
                        updated_at = excluded.updated_at
                    """,
                    (path, item.commit, item.line_count, now),
                )
                connection.execute(
                    "DELETE FROM line_authors WHERE path = ?",
                    (path,),
                )
                for line in item.lines:
                    email = line.email.strip().lower()
                    login = _github_login(email)
                    user = connection.execute(
                        """
                        SELECT id FROM users
                        WHERE status = 'active' AND (
                            lower(email) = ?
                            OR lower(COALESCE(github_email, '')) = ?
                            OR (
                                ? != ''
                                AND lower(COALESCE(github_login, '')) = ?
                            )
                        )
                        ORDER BY github_verified DESC, id
                        LIMIT 1
                        """,
                        (
                            email,
                            email,
                            (login or "").lower(),
                            (login or "").lower(),
                        ),
                    ).fetchone()
                    connection.execute(
                        """
                        INSERT INTO line_authors(
                            path, line_number, commit_sha, author_name,
                            author_email, github_login, user_id
                        )
                        VALUES(?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            path,
                            line.line,
                            line.commit,
                            line.name,
                            email,
                            login,
                            user["id"] if user else None,
                        ),
                    )
                files += 1
                lines += len(item.lines)
        return {"files": files, "lines": lines, "deleted": len(payload.deleted)}

    @router.get("/comments")
    def comments(request: Request, path: str) -> dict[str, Any]:
        try:
            normalized = validate_content_path(path)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        session = read_session(request)
        with db.connect() as connection:
            revision = connection.execute(
                "SELECT commit_sha, line_count FROM content_revisions WHERE path = ?",
                (normalized,),
            ).fetchone()
            author_rows = connection.execute(
                """
                SELECT la.line_number, la.commit_sha, la.author_name,
                       la.github_login, COALESCE(la.user_id, u.id) AS user_id
                FROM line_authors la
                LEFT JOIN users u ON u.status = 'active' AND (
                    lower(u.email) = lower(la.author_email)
                    OR lower(COALESCE(u.github_email, '')) =
                       lower(la.author_email)
                    OR (
                        la.github_login IS NOT NULL
                        AND lower(COALESCE(u.github_login, '')) =
                            lower(la.github_login)
                    )
                )
                WHERE la.path = ?
                GROUP BY la.path, la.line_number
                ORDER BY la.line_number
                """,
                (normalized,),
            ).fetchall()
            rows = connection.execute(
                """
                SELECT c.*, u.username, u.github_login
                FROM comments c
                JOIN users u ON u.id = c.author_id
                WHERE c.path = ? AND c.status = 'active'
                ORDER BY c.start_line, c.created_at, c.id
                """,
                (normalized,),
            ).fetchall()
            mention_rows = connection.execute(
                """
                SELECT cm.comment_id, u.id, u.username, u.github_login
                FROM comment_mentions cm
                JOIN users u ON u.id = cm.user_id
                JOIN comments c ON c.id = cm.comment_id
                WHERE c.path = ? AND c.status = 'active'
                ORDER BY u.username
                """,
                (normalized,),
            ).fetchall()
        mentions: dict[int, list[dict[str, Any]]] = {}
        for row in mention_rows:
            mentions.setdefault(row["comment_id"], []).append(
                {
                    "id": row["id"],
                    "username": row["username"],
                    "github_login": row["github_login"],
                }
            )
        return {
            "path": normalized,
            "revision": dict(revision) if revision else None,
            "authors": _author_ranges(author_rows),
            "comments": [
                _public_comment(row, mentions.get(row["id"], []))
                for row in rows
            ],
            "can_comment": bool(
                session and not session["must_change_password"]
            ),
        }

    @router.get("/comment-members")
    def comment_members(request: Request) -> dict[str, Any]:
        require_ready_user(request)
        with db.connect() as connection:
            rows = connection.execute(
                """
                SELECT id, username, github_login
                FROM users WHERE status = 'active'
                ORDER BY username COLLATE NOCASE
                LIMIT 1000
                """
            ).fetchall()
        return {"items": [dict(row) for row in rows]}

    @router.put("/account/notification-preferences")
    def update_notification_preferences(
        payload: NotificationPreferenceRequest,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
    ) -> dict[str, bool]:
        user = require_ready_user(request)
        verify_csrf(user, x_csrf_token)
        with db.connect() as connection:
            connection.execute(
                """
                UPDATE users
                SET email_notifications_enabled = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    1 if payload.email_notifications_enabled else 0,
                    utc_now(),
                    user["id"],
                ),
            )
        return {
            "email_notifications_enabled":
                payload.email_notifications_enabled
        }

    @router.post("/comments")
    def create_comment(
        payload: CommentRequest,
        request: Request,
        background_tasks: BackgroundTasks,
        x_csrf_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        user = require_ready_user(request)
        verify_csrf(user, x_csrf_token)
        if not rate_limit(f"comment:{user['id']}", 30, 3600):
            raise HTTPException(status_code=429, detail="评论提交过于频繁")
        try:
            path = validate_content_path(payload.path)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if payload.end_line < payload.start_line:
            raise HTTPException(status_code=422, detail="评论行范围无效")
        body = payload.body.strip()
        quote = payload.quote.strip()
        now = utc_now()
        recipients: set[str] = set()

        with db.connect() as connection:
            revision = connection.execute(
                "SELECT * FROM content_revisions WHERE path = ?",
                (path,),
            ).fetchone()
            if not revision:
                raise HTTPException(status_code=409, detail="作者归属尚未同步")
            if payload.end_line > revision["line_count"]:
                raise HTTPException(status_code=422, detail="评论行超出文档范围")

            parent_id = payload.parent_id
            reply_to_id = payload.reply_to_id
            parent = None
            reply_to = None
            if parent_id:
                parent = connection.execute(
                    """
                    SELECT c.*, u.email, u.email_notifications_enabled
                    FROM comments c JOIN users u ON u.id = c.author_id
                    WHERE c.id = ? AND c.path = ? AND c.status = 'active'
                    """,
                    (parent_id, path),
                ).fetchone()
                if not parent:
                    raise HTTPException(status_code=404, detail="上级评论不存在")
                if parent["parent_id"]:
                    parent_id = parent["parent_id"]
            if reply_to_id:
                reply_to = connection.execute(
                    """
                    SELECT c.*, u.email, u.email_notifications_enabled
                    FROM comments c JOIN users u ON u.id = c.author_id
                    WHERE c.id = ? AND c.path = ? AND c.status = 'active'
                    """,
                    (reply_to_id, path),
                ).fetchone()
                if not reply_to:
                    raise HTTPException(status_code=404, detail="回复目标不存在")
                parent_id = reply_to["parent_id"] or reply_to["id"]
            elif parent:
                reply_to = parent

            anchor = None
            if parent_id:
                anchor = connection.execute(
                    """
                    SELECT * FROM comments
                    WHERE id = ? AND path = ? AND status = 'active'
                    """,
                    (parent_id, path),
                ).fetchone()
            start_line = anchor["start_line"] if anchor else payload.start_line
            end_line = anchor["end_line"] if anchor else payload.end_line
            start_column = (
                anchor["start_column"] if anchor else payload.start_column
            )
            end_column = anchor["end_column"] if anchor else payload.end_column
            anchored_quote = anchor["quote"] if anchor else quote
            render_segments = (
                anchor["render_segments"]
                if anchor
                else json.dumps(
                    [
                        segment.model_dump()
                        for segment in payload.render_segments
                    ],
                    ensure_ascii=False,
                )
            )
            cursor = connection.execute(
                """
                INSERT INTO comments(
                    path, revision_sha, start_line, end_line,
                    start_column, end_column, quote, render_segments,
                    author_id, parent_id, reply_to_id, body,
                    created_at, updated_at
                )
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    path,
                    payload.revision_sha,
                    start_line,
                    end_line,
                    start_column,
                    end_column,
                    anchored_quote,
                    render_segments,
                    user["id"],
                    parent_id,
                    reply_to["id"] if reply_to else None,
                    body,
                    now,
                    now,
                ),
            )
            comment_id = int(cursor.lastrowid)

            mention_ids = sorted(
                set(payload.mention_user_ids) - {user["id"]}
            )
            mentioned = []
            if mention_ids:
                placeholders = ",".join("?" for _ in mention_ids)
                candidates = connection.execute(
                    f"""
                    SELECT id, username, github_login, email,
                           email_notifications_enabled
                    FROM users
                    WHERE status = 'active' AND id IN ({placeholders})
                    """,
                    mention_ids,
                ).fetchall()
                mentioned = [
                    row
                    for row in candidates
                    if (
                        f"@{row['username']}" in body
                        or (
                            row["github_login"]
                            and f"@{row['github_login']}" in body
                        )
                    )
                ]
                connection.executemany(
                    """
                    INSERT OR IGNORE INTO comment_mentions(comment_id, user_id)
                    VALUES(?, ?)
                    """,
                    [(comment_id, row["id"]) for row in mentioned],
                )

            if parent_id:
                if (
                    reply_to
                    and reply_to["author_id"] != user["id"]
                    and reply_to["email_notifications_enabled"]
                ):
                    recipients.add(reply_to["email"])
            else:
                author_rows = connection.execute(
                    """
                    SELECT la.author_email, MAX(u.id) AS user_id,
                           MIN(COALESCE(
                               u.email_notifications_enabled, 1
                           )) AS email_notifications_enabled
                    FROM line_authors la
                    LEFT JOIN users u ON u.status = 'active' AND (
                        u.id = la.user_id
                        OR lower(u.email) = lower(la.author_email)
                        OR lower(COALESCE(u.github_email, '')) =
                           lower(la.author_email)
                        OR (
                            la.github_login IS NOT NULL
                            AND lower(COALESCE(u.github_login, '')) =
                                lower(la.github_login)
                        )
                    )
                    WHERE la.path = ?
                      AND la.line_number BETWEEN ? AND ?
                    GROUP BY la.author_email
                    """,
                    (path, payload.start_line, payload.end_line),
                ).fetchall()
                for author in author_rows:
                    if (
                        author["author_email"]
                        and author["author_email"].lower()
                        != user["email"].lower()
                        and (
                            author["user_id"] is None
                            or author["email_notifications_enabled"]
                        )
                    ):
                        recipients.add(author["author_email"])

            for mentioned_user in mentioned:
                if mentioned_user["email_notifications_enabled"]:
                    recipients.add(mentioned_user["email"])

            created = connection.execute(
                """
                SELECT c.*, u.username, u.github_login
                FROM comments c JOIN users u ON u.id = c.author_id
                WHERE c.id = ?
                """,
                (comment_id,),
            ).fetchone()

        recipients.discard(user["email"])
        for recipient in sorted(recipients):
            action = "回复了评论" if parent_id else "对内容提出了评论"
            background_tasks.add_task(
                deliver_email,
                settings.db_path,
                settings,
                "comment.reply" if parent_id else "comment.created",
                [recipient],
                f"[Game Client Knowledge] {user['username']} {action}",
                (
                    f"{user['username']} {action}\n\n"
                    f"文件：{path}\n"
                    f"行范围：{start_line}-{end_line}\n"
                    f"原文：{anchored_quote}\n\n"
                    f"评论：{body}\n\n"
                    f"查看：{_comment_url(settings, path, comment_id)}\n"
                ),
                audience="comment",
                user_id=user["id"],
            )
        return _public_comment(
            created,
            [
                {
                    "id": row["id"],
                    "username": row["username"],
                    "github_login": row["github_login"],
                }
                for row in mentioned
            ],
        )

    return router
