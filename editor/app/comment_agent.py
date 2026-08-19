from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote, urlsplit

import httpx

from .comment_agent_config import (
    CommentAgentConfiguration,
    load_comment_agent_configuration,
)
from .config import Settings
from .database import Database, utc_now
from .notifications import deliver_email
from .security import TokenCipher


AGENT_MENTION_RE = re.compile(
    r"(?<![A-Za-z0-9_-])@agent(?![A-Za-z0-9_-])",
    re.IGNORECASE,
)


class CommentAgentError(RuntimeError):
    pass


@dataclass(frozen=True)
class AgentCompletion:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


def has_agent_mention(body: str) -> bool:
    return bool(AGENT_MENTION_RE.search(body))


def _completion_endpoint(configuration: CommentAgentConfiguration) -> str:
    suffix = (
        "/messages"
        if configuration.protocol == "anthropic"
        else "/chat/completions"
    )
    return configuration.base_url.rstrip("/") + suffix


def _response_error(response: httpx.Response) -> str:
    if response.status_code in {401, 403}:
        return "认证失败"
    if response.status_code == 429:
        return "请求受到供应商限流"
    if response.status_code >= 500:
        return "供应商服务暂不可用"
    return f"HTTP {response.status_code}"


def _openai_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("text")
        )
    return ""


def _anthropic_text(payload: dict[str, Any]) -> str:
    content = payload.get("content")
    if not isinstance(content, list):
        return ""
    return "\n".join(
        str(item.get("text", ""))
        for item in content
        if (
            isinstance(item, dict)
            and item.get("type") == "text"
            and item.get("text")
        )
    )


def call_agent_api(
    configuration: CommentAgentConfiguration,
    system_prompt: str,
    user_prompt: str,
) -> AgentCompletion:
    endpoint = _completion_endpoint(configuration)
    if configuration.protocol == "anthropic":
        headers = {
            "x-api-key": configuration.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": configuration.model,
            "max_tokens": configuration.max_output_tokens,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}],
        }
    else:
        headers = {
            "Authorization": f"Bearer {configuration.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": configuration.model,
            "max_tokens": configuration.max_output_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

    try:
        with httpx.Client(
            timeout=configuration.timeout_seconds,
            follow_redirects=False,
        ) as client:
            response = client.post(endpoint, headers=headers, json=payload)
    except httpx.TimeoutException as exc:
        raise CommentAgentError("Agent API 请求超时") from exc
    except httpx.HTTPError as exc:
        raise CommentAgentError("无法连接 Agent API") from exc
    if not response.is_success:
        raise CommentAgentError(
            f"Agent API 拒绝请求：{_response_error(response)}"
        )
    try:
        response_payload = response.json()
    except ValueError as exc:
        raise CommentAgentError("Agent API 返回了无效 JSON") from exc
    if not isinstance(response_payload, dict):
        raise CommentAgentError("Agent API 返回格式无效")
    text = (
        _anthropic_text(response_payload)
        if configuration.protocol == "anthropic"
        else _openai_text(response_payload)
    ).strip()
    if not text:
        raise CommentAgentError("Agent API 未返回文本内容")
    usage = response_payload.get("usage")
    if not isinstance(usage, dict):
        usage = {}

    def usage_int(*keys: str) -> int:
        for key in keys:
            if key not in usage:
                continue
            try:
                return max(0, int(usage[key]))
            except (TypeError, ValueError):
                continue
        return 0

    input_tokens = usage_int("prompt_tokens", "input_tokens")
    output_tokens = usage_int("completion_tokens", "output_tokens")
    total_tokens = usage_int("total_tokens")
    if not total_tokens:
        total_tokens = input_tokens + output_tokens
    return AgentCompletion(
        text=text[:8000],
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
    )


def normalize_agent_completion(
    value: AgentCompletion | str,
) -> AgentCompletion:
    if isinstance(value, AgentCompletion):
        return value
    return AgentCompletion(text=str(value)[:8000])


def fetch_page_source(
    settings: Settings,
    path: str,
    revision_sha: str,
    max_context_chars: int,
) -> str:
    base = urlsplit(settings.base_url)
    origin = f"{base.scheme}://{base.netloc}"
    url = (
        f"{origin}/raw/{quote(path, safe='/')}"
        f"?v={quote(revision_sha, safe='')}"
    )
    byte_limit = 2_000_000
    chunks: list[bytes] = []
    size = 0
    try:
        with httpx.Client(timeout=20, follow_redirects=False) as client:
            with client.stream(
                "GET",
                url,
                headers={"User-Agent": "GCK-Comment-Agent/1.0"},
            ) as response:
                if not response.is_success:
                    raise CommentAgentError(
                        f"无法读取页面原文：HTTP {response.status_code}"
                    )
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > byte_limit:
                        remaining = byte_limit - (size - len(chunk))
                        if remaining > 0:
                            chunks.append(chunk[:remaining])
                        break
                    chunks.append(chunk)
    except httpx.TimeoutException as exc:
        raise CommentAgentError("读取页面原文超时") from exc
    except httpx.HTTPError as exc:
        raise CommentAgentError("无法读取页面原文") from exc
    return b"".join(chunks).decode("utf-8", errors="replace")


def _thread_text(rows: list[sqlite3.Row], trigger_id: int) -> str:
    entries = []
    for row in rows[-30:]:
        handle = "Agent" if row["is_system"] else row["username"]
        marker = "（本次提及）" if row["id"] == trigger_id else ""
        body = str(row["body"])[:2500]
        entries.append(f"@{handle}{marker}: {body}")
    return "\n".join(entries)


def _source_excerpt(
    source: str,
    start_line: int,
    end_line: int,
    budget: int,
) -> str:
    if len(source) <= budget:
        return source
    lines = source.splitlines()
    start = max(0, start_line - 1)
    end = min(len(lines), max(start + 1, end_line))
    selected = [
        (index + 1, value)
        for index, value in enumerate(lines[start:end], start=start)
    ]
    used = sum(len(value) + 12 for _, value in selected)
    left = start
    right = end
    while (left > 0 or right < len(lines)) and used < budget:
        if left > 0:
            left -= 1
            value = lines[left]
            selected.insert(0, (left + 1, value))
            used += len(value) + 12
        if right < len(lines) and used < budget:
            value = lines[right]
            selected.append((right + 1, value))
            right += 1
            used += len(value) + 12
    rendered = "\n".join(
        f"{line_number}: {value}" for line_number, value in selected
    )
    return rendered[:budget]


def build_agent_prompt(
    *,
    path: str,
    revision_sha: str,
    start_line: int,
    end_line: int,
    quote_text: str,
    source: str,
    thread_rows: list[sqlite3.Row],
    trigger_id: int,
    max_context_chars: int,
) -> str:
    thread_budget = max(1200, max_context_chars // 3)
    thread = _thread_text(thread_rows, trigger_id)[-thread_budget:]
    quote_budget = max(600, min(4000, max_context_chars // 6))
    bounded_quote = quote_text[:quote_budget]
    metadata = (
        f"文件：{path}\n"
        f"内容版本：{revision_sha}\n"
        f"评论锚点：第 {start_line}-{end_line} 行\n"
        f"选中原文：\n{bounded_quote}\n\n"
        f"当前评论线程：\n{thread}\n\n"
        "页面原文：\n"
    )
    source_budget = max(1000, max_context_chars - len(metadata))
    excerpt = _source_excerpt(
        source,
        start_line,
        end_line,
        source_budget,
    )
    return (metadata + excerpt)[:max_context_chars]


def _claim_request(
    db: Database,
    request_id: int | None,
) -> dict[str, Any] | None:
    with db.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        where = "ar.id = ?" if request_id is not None else "ar.status = 'pending'"
        parameters: tuple[Any, ...] = (
            (request_id,) if request_id is not None else ()
        )
        row = connection.execute(
            f"""
            SELECT ar.*, c.path, c.revision_sha, c.start_line, c.end_line,
                   c.quote, c.parent_id, c.author_id
            FROM comment_agent_requests ar
            JOIN comments c ON c.id = ar.trigger_comment_id
            WHERE {where} AND ar.status = 'pending'
            ORDER BY ar.created_at, ar.id
            LIMIT 1
            """,
            parameters,
        ).fetchone()
        if not row:
            return None
        now = utc_now()
        updated = connection.execute(
            """
            UPDATE comment_agent_requests
            SET status = 'running', attempts = attempts + 1,
                started_at = ?, updated_at = ?
            WHERE id = ? AND status = 'pending'
            """,
            (now, now, row["id"]),
        )
        if updated.rowcount != 1:
            return None
        return dict(row)


def _fail_request(db: Database, request_id: int, message: str) -> None:
    safe_message = " ".join(message.split())[:500] or "Agent 回复失败"
    with db.connect() as connection:
        connection.execute(
            """
            UPDATE comment_agent_requests
            SET status = 'failed', error_message = ?,
                completed_at = ?, updated_at = ?
            WHERE id = ? AND status = 'running'
            """,
            (safe_message, utc_now(), utc_now(), request_id),
        )


def _comment_url(settings: Settings, path: str, comment_id: int) -> str:
    origin = settings.base_url.split("/editor", 1)[0]
    parsed = PurePosixPath(path)
    route = (
        parsed.parent.as_posix()
        if parsed.name.lower() == "readme.md"
        else (parsed.parent / parsed.stem).as_posix()
    )
    if parsed.suffix.lower() != ".md":
        route = (parsed.parent / "files" / parsed.name).as_posix()
    return f"{origin}/{quote(route)}/?comment={comment_id}"


def _save_reply(
    db: Database,
    request_row: dict[str, Any],
    completion: AgentCompletion,
) -> tuple[int, dict[str, Any] | None]:
    now = utc_now()
    with db.connect() as connection:
        request = connection.execute(
            """
            SELECT * FROM comment_agent_requests
            WHERE id = ? AND status = 'running'
            """,
            (request_row["id"],),
        ).fetchone()
        if not request:
            raise CommentAgentError("Agent 请求状态已变化")
        trigger = connection.execute(
            """
            SELECT c.*, u.email, u.username,
                   u.email_notifications_enabled
            FROM comments c
            JOIN users u ON u.id = c.author_id
            WHERE c.id = ? AND c.status = 'active'
            """,
            (request["trigger_comment_id"],),
        ).fetchone()
        if not trigger:
            raise CommentAgentError("触发评论已不存在")
        root_id = trigger["parent_id"] or trigger["id"]
        root = connection.execute(
            """
            SELECT * FROM comments
            WHERE id = ? AND status = 'active'
            """,
            (root_id,),
        ).fetchone()
        agent = connection.execute(
            """
            SELECT id FROM users
            WHERE is_system = 1 AND status = 'active'
            ORDER BY id LIMIT 1
            """
        ).fetchone()
        if not root or not agent:
            raise CommentAgentError("评论线程或 Agent 系统账号不可用")
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
                root["path"],
                root["revision_sha"],
                root["start_line"],
                root["end_line"],
                root["start_column"],
                root["end_column"],
                root["quote"],
                root["render_segments"],
                agent["id"],
                root_id,
                trigger["id"],
                completion.text,
                now,
                now,
            ),
        )
        response_comment_id = int(cursor.lastrowid)
        connection.execute(
            """
            INSERT INTO comment_events(path, comment_id, action, created_at)
            VALUES(?, ?, 'created', ?)
            """,
            (root["path"], response_comment_id, now),
        )
        connection.execute(
            """
            UPDATE comment_agent_requests
            SET status = 'completed', response_comment_id = ?,
                input_tokens = ?, output_tokens = ?, total_tokens = ?,
                error_message = NULL, completed_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                response_comment_id,
                completion.input_tokens,
                completion.output_tokens,
                completion.total_tokens,
                now,
                now,
                request["id"],
            ),
        )
        recipient = (
            {
                "email": trigger["email"],
                "username": trigger["username"],
                "user_id": trigger["author_id"],
                "path": trigger["path"],
            }
            if trigger["email_notifications_enabled"]
            else None
        )
    return response_comment_id, recipient


def process_comment_agent_request(
    db: Database,
    settings: Settings,
    cipher: TokenCipher,
    request_id: int | None = None,
) -> bool:
    request_row = _claim_request(db, request_id)
    if not request_row:
        return False
    try:
        configuration = load_comment_agent_configuration(db, cipher)
        if not configuration.configured:
            raise CommentAgentError("评论 Agent 已关闭或配置不完整")
        source = fetch_page_source(
            settings,
            request_row["path"],
            request_row["revision_sha"],
            configuration.max_context_chars,
        )
        root_id = request_row["parent_id"] or request_row["trigger_comment_id"]
        with db.connect() as connection:
            thread_rows = connection.execute(
                """
                SELECT c.id, c.body, u.username, u.is_system
                FROM comments c
                JOIN users u ON u.id = c.author_id
                WHERE c.status = 'active'
                  AND (c.id = ? OR c.parent_id = ?)
                ORDER BY c.created_at, c.id
                """,
                (root_id, root_id),
            ).fetchall()
        prompt = build_agent_prompt(
            path=request_row["path"],
            revision_sha=request_row["revision_sha"],
            start_line=request_row["start_line"],
            end_line=request_row["end_line"],
            quote_text=request_row["quote"],
            source=source,
            thread_rows=thread_rows,
            trigger_id=request_row["trigger_comment_id"],
            max_context_chars=configuration.max_context_chars,
        )
        completion = normalize_agent_completion(
            call_agent_api(
                configuration,
                configuration.system_prompt,
                prompt,
            )
        )
        response_comment_id, recipient = _save_reply(
            db,
            request_row,
            completion,
        )
        db.audit(
            "comment_agent.completed",
            "system",
            target=str(request_row["trigger_comment_id"]),
            detail=json.dumps(
                {
                    "provider": configuration.provider,
                    "model": configuration.model,
                    "response_comment_id": response_comment_id,
                    "input_tokens": completion.input_tokens,
                    "output_tokens": completion.output_tokens,
                    "total_tokens": completion.total_tokens,
                },
                ensure_ascii=False,
            ),
        )
        if recipient:
            deliver_email(
                settings.db_path,
                settings,
                "comment.agent_reply",
                [recipient["email"]],
                "[Game Client Knowledge] Agent 回复了你的评论",
                (
                    f"Agent 回复了 {recipient['username']} 的评论。\n\n"
                    f"文件：{recipient['path']}\n"
                    f"回复：{completion.text}\n\n"
                    f"查看：{_comment_url(settings, recipient['path'], response_comment_id)}\n"
                ),
                audience="comment",
                user_id=recipient["user_id"],
            )
    except CommentAgentError as exc:
        _fail_request(db, request_row["id"], str(exc))
        db.audit(
            "comment_agent.failed",
            "system",
            target=str(request_row["trigger_comment_id"]),
            detail=str(exc)[:500],
        )
    except Exception as exc:
        _fail_request(db, request_row["id"], "Agent 处理发生内部错误")
        db.audit(
            "comment_agent.failed",
            "system",
            target=str(request_row["trigger_comment_id"]),
            detail=f"{type(exc).__name__}: {str(exc)[:400]}",
        )
    return True


def recover_comment_agent_requests(db: Database) -> None:
    now = utc_now()
    with db.connect() as connection:
        connection.execute(
            """
            UPDATE comment_agent_requests
            SET status = 'pending', started_at = NULL, updated_at = ?
            WHERE status = 'running'
            """,
            (now,),
        )
