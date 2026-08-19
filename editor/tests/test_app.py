from __future__ import annotations

import json
import sqlite3
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.analytics import DEVICE_COOKIE
from app.config import Settings
from app.github import BranchConflictError, GitHubError, SubmissionResult
from app.main import create_app
from app.pr_lifecycle import issue_external_urge_token

TEST_BOOTSTRAP_PASSWORD = "test-bootstrap-password"
TEST_BASE_COMMIT = "a" * 40


def make_settings(tmp_path: Path, *, oauth: bool = False) -> Settings:
    return Settings(
        db_path=tmp_path / "editor.db",
        base_url="https://example.test/editor",
        cookie_secure=False,
        cookie_path="/",
        session_hours=24,
        registration_enabled=True,
        default_edit_policy="local_authenticated",
        pr_auto_close_days=7,
        pr_sync_interval_seconds=900,
        bootstrap_admin_email="sourcecode@example.test",
        bootstrap_admin_username="sourcecode",
        bootstrap_admin_password=TEST_BOOTSTRAP_PASSWORD,
        encryption_key=Fernet.generate_key().decode("ascii"),
        github_owner="Game-Client-Knowledge",
        github_repository="Game-Client-Knowledge",
        github_client_id="client-id" if oauth else "",
        github_client_secret="client-secret" if oauth else "",
        github_bot_token="test-bot-token",
        attribution_sync_token="test-sync-token",
        smtp_host="",
        smtp_port=587,
        smtp_username="",
        smtp_password="",
        smtp_from="",
        smtp_starttls=True,
        site_update_request_path=tmp_path / "site-update.request",
        site_update_status_path=tmp_path / "site-update-status.json",
        site_release_source_path=tmp_path / ".release-source",
    )


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    settings = make_settings(tmp_path)
    app = create_app(settings)
    app.state.github.repository_tree = AsyncMock(return_value=[])
    app.state.github.branch_exists = AsyncMock(return_value=False)
    with TestClient(app, base_url="http://testserver") as test_client:
        yield test_client


@pytest.fixture()
def oauth_client(tmp_path: Path) -> TestClient:
    app = create_app(make_settings(tmp_path, oauth=True))
    app.state.github.branch_exists = AsyncMock(return_value=False)
    with TestClient(app, base_url="http://testserver") as test_client:
        yield test_client


def login(client: TestClient, identifier: str, password: str) -> dict:
    response = client.post(
        "/api/auth/login",
        json={"identifier": identifier, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()


def git_submission(
    username: str,
    head: str,
    title: str,
    changes: list[dict],
    *,
    body: str = "",
    force_update: bool = False,
) -> dict:
    return {
        "base_commit": TEST_BASE_COMMIT,
        "branch": f"web/{username}/{head}",
        "commit_message": title,
        "pr_title": title,
        "pr_body": body,
        "pr_base": "main",
        "draft": True,
        "force_update": force_update,
        "changes": changes,
    }


def test_bootstrap_admin_must_change_password(client: TestClient) -> None:
    payload = login(client, "sourcecode", TEST_BOOTSTRAP_PASSWORD)
    assert payload["user"]["role"] == "admin"
    assert payload["user"]["must_change_password"] is True

    response = client.post(
        "/api/auth/change-password",
        headers={"X-CSRF-Token": payload["csrf_token"]},
        json={
            "current_password": TEST_BOOTSTRAP_PASSWORD,
            "new_password": "a-new-strong-password",
        },
    )
    assert response.status_code == 200

    session = client.get("/api/session").json()
    assert session["user"]["must_change_password"] is False


def test_anonymous_visit_cookie_and_admin_analytics(
    client: TestClient,
) -> None:
    first = client.post("/api/analytics/visit")
    assert first.status_code == 204
    first_device = client.cookies.get(DEVICE_COOKIE)
    assert first_device
    set_cookie = first.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie

    second = client.post("/api/analytics/visit")
    assert second.status_code == 204
    assert client.cookies.get(DEVICE_COOKIE) == first_device

    client.cookies.delete(DEVICE_COOKIE)
    third = client.post("/api/analytics/visit")
    assert third.status_code == 204
    second_device = client.cookies.get(DEVICE_COOKIE)
    assert second_device and second_device != first_device

    payload = login(client, "sourcecode", TEST_BOOTSTRAP_PASSWORD)
    changed = client.post(
        "/api/auth/change-password",
        headers={"X-CSRF-Token": payload["csrf_token"]},
        json={
            "current_password": TEST_BOOTSTRAP_PASSWORD,
            "new_password": "a-new-strong-password",
        },
    )
    assert changed.status_code == 200
    overview = client.get("/api/admin/overview")
    assert overview.status_code == 200
    today = overview.json()["analytics"]["periods"][0]
    assert today["key"] == "day"
    assert today["devices"] == 2
    assert today["visits"] == 3

    with client.app.state.db.connect() as connection:
        rows = connection.execute(
            """
            SELECT device_hash, visit_count
            FROM site_analytics_daily
            ORDER BY visit_count DESC
            """
        ).fetchall()
    assert [row["visit_count"] for row in rows] == [2, 1]
    assert all(len(row["device_hash"]) == 64 for row in rows)
    assert all(first_device not in row["device_hash"] for row in rows)


def test_local_user_can_create_isolated_topic_draft(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={
            "email": "contributor@example.test",
            "username": "contributor",
            "password": "local-password-123",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    csrf = payload["csrf_token"]
    client.app.state.github.repository_tree = AsyncMock(
        return_value=[
            {
                "path": "knowledge/README.md",
                "sha": "knowledge-readme",
                "size": 100,
                "type": "blob",
            }
        ]
    )

    topic = client.post(
        "/api/topics",
        headers={"X-CSRF-Token": csrf},
        json={
            "root": "knowledge",
            "parent": "cpp",
            "slug": "polymorphism",
            "title": "C++ 多态",
            "description": "运行时与静态多态。",
        },
    )
    assert topic.status_code == 200, topic.text
    assert topic.json()["path"] == "knowledge/cpp/polymorphism/README.md"

    drafts = client.get("/api/drafts")
    assert drafts.status_code == 200
    assert [item["path"] for item in drafts.json()["items"]] == [
        "knowledge/cpp/polymorphism/README.md"
    ]


def test_user_can_create_top_level_module_and_nested_content(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "module@example.test",
            "username": "module-user",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    module = client.post(
        "/api/modules",
        headers={"X-CSRF-Token": csrf},
        json={
            "slug": "graphics",
            "title": "图形与渲染",
            "short_title": "图形",
            "description": "实时渲染知识与示例。",
            "icon": "shapes",
            "accent": "gold",
            "allow_code": True,
        },
    )
    assert module.status_code == 200, module.text
    assert module.json()["path"] == "program/graphics/README.md"
    assert 'shortTitle: "图形"' in module.json()["content"]
    assert "allowCode: true" in module.json()["content"]

    topic = client.post(
        "/api/topics",
        headers={"X-CSRF-Token": csrf},
        json={
            "root": "program/graphics",
            "parent": "",
            "slug": "rendering",
            "title": "渲染基础",
            "description": "",
        },
    )
    assert topic.status_code == 200, topic.text
    assert topic.json()["path"] == "program/graphics/rendering/README.md"

    source = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "program/graphics/rendering/demo.cpp",
            "content": "int main() { return 0; }\n",
            "operation": "upsert",
        },
    )
    assert source.status_code == 200, source.text


def test_csrf_is_required_for_draft_mutation(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={
            "email": "csrf@example.test",
            "username": "csrf-user",
            "password": "local-password-123",
        },
    )
    assert response.status_code == 200

    draft = client.put(
        "/api/drafts",
        json={
            "path": "knowledge/cpp/test/README.md",
            "content": "# Test\n",
            "operation": "upsert",
        },
    )
    assert draft.status_code == 403


def test_http_method_override_header_is_not_honored(
    client: TestClient,
) -> None:
    response = client.get(
        "/api/articles/123",
        headers={
            "Authorization": "Bearer test-token",
            "X-HTTP-Method-Override": "DELETE",
        },
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Not Found"


def test_bootstrap_returns_session_drafts_and_active_preview(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "bootstrap@example.test",
            "username": "bootstrap-user",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    saved = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "knowledge/cpp/bootstrap/README.md",
            "content": "# Bootstrap\n\nImmediate draft content.\n",
            "base_content": "# Bootstrap\n\nOriginal content.\n",
            "base_sha": "bootstrap-base-sha",
            "operation": "upsert",
        },
    )
    assert saved.status_code == 200

    response = client.get(
        "/api/bootstrap",
        params={"path": "knowledge/cpp/bootstrap/README.md"},
    )
    payload = response.json()
    assert payload["session"]["user"]["username"] == "bootstrap-user"
    assert payload["config"]["edit_policy"] == "local_authenticated"
    assert payload["config"]["reader_edit_mode"] == "new"
    assert payload["config"]["reader_diff_enabled"] is True
    assert payload["config"]["workspace_sync_interval_seconds"] == 60
    assert payload["config"]["site_auto_update_interval_minutes"] == 10
    assert payload["config"]["catalog_background_style"] == "circuit"
    assert payload["config"]["reader_background_style"] == "blueprint"
    assert payload["config"]["pointer_effect_enabled"] is True
    assert payload["config"]["home_intro_enabled"] is True
    assert payload["config"]["home_intro_mode"] == "revisit"
    assert payload["config"]["home_intro_duration_ms"] == 3000
    assert payload["config"]["home_intro_assembly_duration_ms"] == 1680
    assert payload["config"]["home_intro_hold_duration_ms"] == 630
    assert payload["config"]["home_intro_lock_scroll"] is True
    assert payload["config"]["home_intro_contributor_limit"] == 8
    assert payload["config"]["home_content_mask_enabled"] is False
    assert payload["config"]["home_content_idle_timeout_seconds"] == 30
    assert payload["config"]["home_star_graph_direction"] == "directed"
    assert payload["config"]["home_star_brightness_initial"] == 10
    assert payload["config"]["home_star_brightness_max"] == 100
    assert payload["config"]["home_star_illumination_rule"] == "bfs"
    assert payload["config"]["home_star_illumination_depth"] == 3
    assert payload["config"]["home_star_selection_duration_ms"] == 3000
    assert payload["config"]["home_star_label_duration_ms"] == 3000
    assert payload["config"]["home_star_active_edge_mode"] == "single_path"
    assert [item["path"] for item in payload["drafts"]] == [
        "knowledge/cpp/bootstrap/README.md"
    ]
    assert payload["drafts"][0]["base_content"] == (
        "# Bootstrap\n\nOriginal content.\n"
    )
    assert "Immediate draft content." in payload["active_draft_html"]


def test_line_attribution_and_comment_threads(client: TestClient) -> None:
    author = client.post(
        "/api/auth/register",
        json={
            "email": "author@example.test",
            "username": "line-author",
            "password": "local-password-123",
        },
    ).json()
    client.post(
        "/api/auth/logout",
        headers={"X-CSRF-Token": author["csrf_token"]},
    )
    commenter = client.post(
        "/api/auth/register",
        json={
            "email": "reader@example.test",
            "username": "reader",
            "password": "local-password-123",
        },
    ).json()

    sync = client.post(
        "/api/internal/attribution-sync",
        headers={"Authorization": "Bearer test-sync-token"},
        json={
            "revision": "a" * 40,
            "deleted": [],
            "files": [
                {
                    "path": "knowledge/cpp/example.md",
                    "commit": "a" * 40,
                    "line_count": 2,
                    "lines": [
                        {
                            "line": 1,
                            "commit": "b" * 40,
                            "name": "Line Author",
                            "email": "author@example.test",
                        },
                        {
                            "line": 2,
                            "commit": "c" * 40,
                            "name": "Line Author",
                            "email": "author@example.test",
                        },
                    ],
                    "contributors": [
                        {
                            "id": "legacy-line-author",
                            "name": "Legacy Line Author",
                            "email": "author@example.test",
                            "commit_count": 3,
                            "last_contributed_at": "2026-08-18T00:00:00Z",
                        },
                        {
                            "id": "renamed-line-author",
                            "name": "Renamed Line Author",
                            "email": "author@example.test",
                            "commit_count": 2,
                            "last_contributed_at": "2026-08-16T00:00:00Z",
                        }
                    ],
                },
                {
                    "path": "program/README.md",
                    "commit": "a" * 40,
                    "line_count": 1,
                    "lines": [
                        {
                            "line": 1,
                            "commit": "a" * 40,
                            "name": "Unknown",
                            "email": "external@example.test",
                        }
                    ],
                    "contributors": [
                        {
                            "id": "external-author",
                            "name": "Unknown",
                            "email": "external@example.test",
                            "commit_count": 1,
                            "last_contributed_at": "2026-08-17T00:00:00Z",
                        }
                    ],
                },
                {
                    "path": "planning/README.md",
                    "commit": "a" * 40,
                    "line_count": 1,
                    "lines": [
                        {
                            "line": 1,
                            "commit": "a" * 40,
                            "name": "Preferred External",
                            "email": "external@example.test",
                        }
                    ],
                    "contributors": [
                        {
                            "id": "external-author",
                            "name": "Preferred External",
                            "email": "external@example.test",
                            "commit_count": 2,
                            "last_contributed_at": "2026-08-19T00:00:00Z",
                        }
                    ],
                }
            ],
        },
    )
    assert sync.status_code == 200, sync.text
    graph = client.get("/api/config").json()["contribution_graph"]
    assert graph["version"] == 2
    assert graph["revision"] == "a" * 40
    assert graph["links"] == [
        {
            "path": "knowledge/cpp/example.md",
            "contributor_id": f"user:{author['user']['id']}",
            "contributor_name": "line-author",
            "commit_count": 5,
            "last_contributed_at": "2026-08-18T00:00:00Z",
        },
        {
            "path": "planning/README.md",
            "contributor_id": "external-author",
            "contributor_name": "Preferred External",
            "commit_count": 2,
            "last_contributed_at": "2026-08-19T00:00:00Z",
        },
        {
            "path": "program/README.md",
            "contributor_id": "external-author",
            "contributor_name": "Preferred External",
            "commit_count": 1,
            "last_contributed_at": "2026-08-17T00:00:00Z",
        },
    ]

    created = client.post(
        "/api/comments",
        headers={"X-CSRF-Token": commenter["csrf_token"]},
        json={
            "path": "knowledge/cpp/example.md",
            "revision_sha": "a" * 40,
            "start_line": 1,
            "end_line": 2,
            "quote": "Selected text",
            "body": "Could you clarify this?",
            "render_segments": [
                {
                    "block_start_line": 1,
                    "block_end_line": 2,
                    "start_offset": 0,
                    "end_offset": 13,
                    "quote": "Selected text",
                }
            ],
        },
    )
    assert created.status_code == 200, created.text
    root = created.json()
    assert root["start_line"] == 1
    assert root["author"]["username"] == "reader"

    listing = client.get(
        "/api/comments",
        params={"path": "knowledge/cpp/example.md"},
    ).json()
    assert listing["revision"]["commit_sha"] == "a" * 40
    assert listing["authors"][0]["start_line"] == 1
    assert listing["authors"][0]["end_line"] == 2
    assert listing["authors"][0]["author"]["user_id"] == author["user"]["id"]
    assert [item["id"] for item in listing["comments"]] == [root["id"]]

    with client.app.state.db.connect() as connection:
        notification = connection.execute(
            """
            SELECT recipients FROM notifications
            WHERE event_type = 'comment.created'
            """
        ).fetchone()
    assert "author@example.test" in notification["recipients"]

    first_reply = client.post(
        "/api/comments",
        headers={"X-CSRF-Token": commenter["csrf_token"]},
        json={
            "path": "knowledge/cpp/example.md",
            "revision_sha": "a" * 40,
            "start_line": 1,
            "end_line": 2,
            "quote": "Selected text",
            "body": "First reply",
            "parent_id": root["id"],
            "reply_to_id": root["id"],
        },
    ).json()
    nested_reply = client.post(
        "/api/comments",
        headers={"X-CSRF-Token": commenter["csrf_token"]},
        json={
            "path": "knowledge/cpp/example.md",
            "revision_sha": "a" * 40,
            "start_line": 2,
            "end_line": 2,
            "quote": "Untrusted replacement anchor",
            "body": "Displayed as another second-level reply",
            "parent_id": first_reply["id"],
            "reply_to_id": first_reply["id"],
        },
    ).json()
    assert nested_reply["parent_id"] == root["id"]
    assert nested_reply["reply_to_id"] == first_reply["id"]
    assert nested_reply["quote"] == root["quote"]
    assert nested_reply["start_line"] == root["start_line"]


def test_comment_email_preference_disables_author_mail(
    client: TestClient,
) -> None:
    author = client.post(
        "/api/auth/register",
        json={
            "email": "quiet-author@example.test",
            "username": "quiet-author",
            "password": "local-password-123",
        },
    ).json()
    preference = client.put(
        "/api/account/notification-preferences",
        headers={"X-CSRF-Token": author["csrf_token"]},
        json={"email_notifications_enabled": False},
    )
    assert preference.status_code == 200
    client.post(
        "/api/auth/logout",
        headers={"X-CSRF-Token": author["csrf_token"]},
    )
    reader = client.post(
        "/api/auth/register",
        json={
            "email": "second-reader@example.test",
            "username": "second-reader",
            "password": "local-password-123",
        },
    ).json()
    client.post(
        "/api/internal/attribution-sync",
        headers={"Authorization": "Bearer test-sync-token"},
        json={
            "revision": "d" * 40,
            "files": [
                {
                    "path": "knowledge/cpp/quiet.md",
                    "commit": "d" * 40,
                    "line_count": 1,
                    "lines": [
                        {
                            "line": 1,
                            "commit": "d" * 40,
                            "name": "Quiet Author",
                            "email": "quiet-author@example.test",
                        }
                    ],
                }
            ],
        },
    )
    response = client.post(
        "/api/comments",
        headers={"X-CSRF-Token": reader["csrf_token"]},
        json={
            "path": "knowledge/cpp/quiet.md",
            "revision_sha": "d" * 40,
            "start_line": 1,
            "end_line": 1,
            "quote": "Quiet",
            "body": "No email is expected.",
        },
    )
    assert response.status_code == 200, response.text
    with client.app.state.db.connect() as connection:
        count = connection.execute(
            """
            SELECT COUNT(*) AS count FROM notifications
            WHERE event_type = 'comment.created'
            """
        ).fetchone()["count"]
    assert count == 0


def test_onboarding_is_completed_once_per_user(client: TestClient) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "onboarding@example.test",
            "username": "onboarding-user",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    assert registered["user"]["needs_onboarding"] is True

    rejected = client.post("/api/onboarding/complete")
    assert rejected.status_code == 403

    completed = client.post(
        "/api/onboarding/complete",
        headers={"X-CSRF-Token": csrf},
    )
    assert completed.status_code == 200
    assert completed.json() == {"completed": True}
    assert client.get("/api/session").json()["user"]["needs_onboarding"] is False

    repeated = client.post(
        "/api/onboarding/complete",
        headers={"X-CSRF-Token": csrf},
    )
    assert repeated.status_code == 200
    with client.app.state.db.connect() as connection:
        columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(users)"
            ).fetchall()
        }
        audit_count = connection.execute(
            """
            SELECT COUNT(*) AS count FROM audit_log
            WHERE action = 'onboarding.completed'
            """
        ).fetchone()["count"]
    assert "onboarding_completed_at" in columns
    assert audit_count == 1

    logged_out = client.post(
        "/api/auth/logout",
        headers={"X-CSRF-Token": csrf},
    )
    assert logged_out.status_code == 204
    logged_in = login(
        client,
        "onboarding-user",
        "local-password-123",
    )
    assert logged_in["user"]["needs_onboarding"] is False


def test_preview_uses_reader_content_without_frontmatter(
    client: TestClient,
) -> None:
    client.post(
        "/api/auth/register",
        json={
            "email": "preview@example.test",
            "username": "preview-user",
            "password": "local-password-123",
        },
    )
    response = client.post(
        "/api/preview",
        json={
            "content": (
                "---\n"
                "shortTitle: Test\n"
                "allowCode: true\n"
                "---\n"
                "# Preview title\n\n"
                "Rendered body.\n\n"
                "| Item | Value |\n"
                "|---|---|\n"
                "| A | B |\n"
            )
        },
    )
    assert response.status_code == 200
    html = response.json()["html"]
    assert "shortTitle" not in html
    assert "<h1>Preview title</h1>" in html
    assert "Rendered body." in html
    assert "<table>" in html
    assert "<th>Item</th>" in html
    assert "<td>B</td>" in html


def test_file_delete_and_discard_change(client: TestClient) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "delete@example.test",
            "username": "delete-user",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]

    rejected = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "knowledge/cpp/delete/README.md",
            "content": "",
            "operation": "delete",
        },
    )
    assert rejected.status_code == 422

    deleted = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "knowledge/cpp/delete/README.md",
            "content": "ignored",
            "base_sha": "blob-sha",
            "operation": "delete",
        },
    )
    assert deleted.status_code == 200, deleted.text
    draft = deleted.json()
    assert draft["operation"] == "delete"
    assert draft["content"] == ""

    bootstrap = client.get(
        "/api/bootstrap",
        params={"path": draft["path"]},
    ).json()
    assert bootstrap["active_draft_html"] is None

    discarded = client.delete(
        f"/api/drafts/{draft['id']}",
        headers={"X-CSRF-Token": csrf},
    )
    assert discarded.status_code == 204
    assert client.get("/api/drafts").json()["items"] == []


def test_delete_tree_returns_all_repository_files(
    client: TestClient,
) -> None:
    client.post(
        "/api/auth/register",
        json={
            "email": "delete-tree@example.test",
            "username": "delete-tree",
            "password": "local-password-123",
        },
    )
    github = client.app.state.github
    github.repository_tree = AsyncMock(
        return_value=[
            {
                "path": "graphics/topic/README.md",
                "sha": "readme-sha",
                "size": 120,
            },
            {
                "path": "graphics/topic/image.png",
                "sha": "image-sha",
                "size": 2_000_000,
            },
            {
                "path": "graphics/other/README.md",
                "sha": "other-sha",
                "size": 80,
            },
        ]
    )

    response = client.get(
        "/api/repository/delete-tree",
        params={"path": "graphics/topic", "kind": "directory"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["items"] == [
        {
            "path": "graphics/topic/README.md",
            "sha": "readme-sha",
            "size": 120,
        },
        {
            "path": "graphics/topic/image.png",
            "sha": "image-sha",
            "size": 2_000_000,
        },
    ]


def test_delete_draft_accepts_safe_non_editable_asset_path(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "delete-asset@example.test",
            "username": "delete-asset",
            "password": "local-password-123",
        },
    ).json()
    response = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": registered["csrf_token"]},
        json={
            "path": "knowledge/rendering/diagram.png",
            "content": "",
            "base_sha": "asset-sha",
            "operation": "delete",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["operation"] == "delete"


def test_draft_revision_polling_and_conflict_protection(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "revision@example.test",
            "username": "revision-user",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    created = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "knowledge/revision/README.md",
            "content": "# Revision\n",
            "base_revision": 0,
            "operation": "upsert",
        },
    )
    assert created.status_code == 200, created.text
    first = client.get("/api/drafts").json()
    assert first["changed"] is True
    assert len(first["revision"]) == 16
    unchanged = client.get(
        "/api/drafts",
        params={"revision": first["revision"]},
    ).json()
    assert unchanged == {
        "changed": False,
        "revision": first["revision"],
        "items": [],
    }

    updated = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "knowledge/revision/README.md",
            "content": "# Revision two\n",
            "base_revision": created.json()["revision"],
            "operation": "upsert",
        },
    )
    assert updated.status_code == 200, updated.text
    conflict = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "knowledge/revision/README.md",
            "content": "# Stale write\n",
            "base_revision": created.json()["revision"],
            "operation": "upsert",
        },
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "draft_revision_conflict"
    assert conflict.json()["detail"]["draft"]["content"] == "# Revision two\n"


def test_admin_can_switch_to_github_required_policy(client: TestClient) -> None:
    payload = login(client, "sourcecode", TEST_BOOTSTRAP_PASSWORD)
    csrf = payload["csrf_token"]
    changed = client.post(
        "/api/auth/change-password",
        headers={"X-CSRF-Token": csrf},
        json={
            "current_password": TEST_BOOTSTRAP_PASSWORD,
            "new_password": "a-new-strong-password",
        },
    ).json()

    response = client.put(
        "/api/admin/settings",
        headers={"X-CSRF-Token": changed["csrf_token"]},
        json={
            "edit_policy": "github_verified",
            "registration_enabled": True,
            "pr_auto_close_days": 14,
            "reader_edit_mode": "old",
            "reader_diff_enabled": False,
            "workspace_sync_interval_seconds": 120,
            "site_auto_update_interval_minutes": 30,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["edit_policy"] == "github_verified"
    assert response.json()["pr_auto_close_days"] == 14
    assert response.json()["reader_edit_mode"] == "old"
    assert response.json()["reader_diff_enabled"] is False
    assert response.json()["workspace_sync_interval_seconds"] == 120
    assert response.json()["site_auto_update_interval_minutes"] == 30
    config = client.get("/api/config").json()
    assert config["reader_edit_mode"] == "old"
    assert config["reader_diff_enabled"] is False
    assert config["workspace_sync_interval_seconds"] == 120
    assert config["site_auto_update_interval_minutes"] == 30

    invalid = client.put(
        "/api/admin/settings",
        headers={"X-CSRF-Token": changed["csrf_token"]},
        json={
            "edit_policy": "github_verified",
            "registration_enabled": True,
            "pr_auto_close_days": 14,
            "reader_edit_mode": "unsupported",
            "reader_diff_enabled": True,
        },
    )
    assert invalid.status_code == 422


def test_admin_can_queue_and_observe_site_updates(
    client: TestClient,
) -> None:
    payload = login(client, "sourcecode", TEST_BOOTSTRAP_PASSWORD)
    changed = client.post(
        "/api/auth/change-password",
        headers={"X-CSRF-Token": payload["csrf_token"]},
        json={
            "current_password": TEST_BOOTSTRAP_PASSWORD,
            "new_password": "a-new-strong-password",
        },
    ).json()
    csrf = changed["csrf_token"]
    settings = client.app.state.settings
    settings.site_release_source_path.write_text(
        "web=" + "a" * 40 + "\ncontent=" + "b" * 40 + "\n",
        encoding="utf-8",
    )

    initial = client.get("/api/admin/site-update")
    assert initial.status_code == 200
    assert initial.json()["deployed_web_commit"] == "a" * 40
    assert initial.json()["deployed_content_commit"] == "b" * 40
    assert initial.json()["queued"] is False

    queued = client.post(
        "/api/admin/site-update",
        headers={"X-CSRF-Token": csrf},
        json={"mode": "content"},
    )
    assert queued.status_code == 200, queued.text
    assert queued.json()["queued"] is True
    assert queued.json()["mode"] == "content"
    request = json.loads(
        settings.site_update_request_path.read_text(encoding="utf-8")
    )
    assert request["mode"] == "content"
    status = client.get("/api/admin/site-update").json()
    assert status["state"] == "queued"
    assert status["queued"] is True
    assert status["queued_mode"] == "content"

    duplicate = client.post(
        "/api/admin/site-update",
        headers={"X-CSRF-Token": csrf},
        json={"mode": "site"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "已有站点更新正在排队或执行"
    request = json.loads(
        settings.site_update_request_path.read_text(encoding="utf-8")
    )
    assert request["mode"] == "content"

    settings.site_update_request_path.unlink()
    settings.site_update_status_path.write_text(
        json.dumps({"state": "failed"}),
        encoding="utf-8",
    )
    invalid = client.post(
        "/api/admin/site-update",
        headers={"X-CSRF-Token": csrf},
        json={"mode": "database"},
    )
    assert invalid.status_code == 422


def test_admin_can_configure_client_visual_effects(
    client: TestClient,
) -> None:
    payload = login(client, "sourcecode", TEST_BOOTSTRAP_PASSWORD)
    changed = client.post(
        "/api/auth/change-password",
        headers={"X-CSRF-Token": payload["csrf_token"]},
        json={
            "current_password": TEST_BOOTSTRAP_PASSWORD,
            "new_password": "a-new-strong-password",
        },
    ).json()
    csrf = changed["csrf_token"]

    response = client.put(
        "/api/admin/visual-settings",
        headers={"X-CSRF-Token": csrf},
        json={
            "catalog_background_style": "constellation",
            "reader_background_style": "clean",
            "pointer_effect_enabled": False,
            "home_intro_enabled": False,
            "home_intro_mode": "first",
            "home_intro_assembly_duration_ms": 2600,
            "home_intro_hold_duration_ms": 900,
            "home_intro_lock_scroll": False,
            "home_intro_contributor_limit": 10,
            "home_background_style": "contribution_star_map",
            "home_content_mask_enabled": True,
            "home_content_idle_timeout_seconds": 45,
            "home_star_scope": "full",
            "home_star_relation_visibility": "hidden",
            "home_star_strong_relation_style": "glow",
            "home_star_reference_relation_style": "dashed",
            "home_star_contributor_relation_style": "solid",
            "home_star_graph_direction": "undirected",
            "home_star_illumination_rule": "reverse_depth",
            "home_star_active_edge_mode": "minimal_tree",
            "home_star_illumination_depth": 4,
            "home_star_selection_duration_ms": 4500,
            "home_star_label_duration_ms": 6500,
            "home_star_brightness_variation_enabled": True,
            "home_star_brightness_min": 5,
            "home_star_brightness_initial": 25,
            "home_star_brightness_max": 80,
            "home_star_brightness_variation_amount": 4.5,
            "home_star_brightness_transition_ms": 1200,
            "home_star_brightness_interval_ms": 3000,
            "home_star_color_random_enabled": True,
            "home_star_brightness_rules": [
                {
                    "id": "contributor-formula",
                    "name": "静星公式",
                    "enabled": True,
                    "target": "contributor",
                    "formula": (
                        "current_brightness + "
                        "sin(pi / 2) * activity_7_count"
                    ),
                },
                {
                    "id": "document-formula",
                    "name": "动星公式",
                    "enabled": False,
                    "target": "document",
                    "formula": (
                        "min(max_brightness, current_brightness + "
                        "(reference_count ^ 2) % 7)"
                    ),
                },
            ],
            "home_star_brightness_tiers": [
                {
                    "id": "red",
                    "name": "红矮星",
                    "min_brightness": 25,
                },
                {
                    "id": "brown",
                    "name": "褐矮星",
                    "min_brightness": 0,
                },
            ],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "catalog_background_style": "constellation",
        "reader_background_style": "clean",
        "pointer_effect_enabled": False,
        "home_intro_enabled": True,
        "home_intro_mode": "first",
        "home_intro_duration_ms": 4190,
        "home_intro_assembly_duration_ms": 2600,
        "home_intro_hold_duration_ms": 900,
        "home_intro_lock_scroll": False,
        "home_intro_contributor_limit": 10,
        "home_background_style": "contribution_star_map",
        "home_content_mask_enabled": True,
        "home_content_idle_timeout_seconds": 45,
        "home_star_scope": "full",
        "home_star_relation_visibility": "hidden",
        "home_star_strong_relation_style": "glow",
        "home_star_reference_relation_style": "dashed",
        "home_star_contributor_relation_style": "solid",
        "home_star_graph_direction": "undirected",
        "home_star_illumination_rule": "reverse_depth",
        "home_star_active_edge_mode": "minimal_tree",
        "home_star_illumination_depth": 4,
        "home_star_selection_duration_ms": 4500,
        "home_star_label_duration_ms": 6500,
        "home_star_brightness_variation_enabled": True,
        "home_star_brightness_min": 5,
        "home_star_brightness_initial": 25,
        "home_star_brightness_max": 80,
        "home_star_brightness_variation_amount": 4.5,
        "home_star_brightness_transition_ms": 1200,
        "home_star_brightness_interval_ms": 3000,
        "home_star_color_random_enabled": True,
        "home_star_brightness_rules": [
            {
                "id": "contributor-formula",
                "name": "静星公式",
                "enabled": True,
                "target": "contributor",
                "formula": (
                    "current_brightness + "
                    "sin(pi / 2) * activity_7_count"
                ),
            },
            {
                "id": "document-formula",
                "name": "动星公式",
                "enabled": False,
                "target": "document",
                "formula": (
                    "min(max_brightness, current_brightness + "
                    "(reference_count ^ 2) % 7)"
                ),
            },
        ],
        "home_star_brightness_tiers": [
            {
                "id": "red",
                "name": "红矮星",
                "min_brightness": 25,
            },
            {
                "id": "brown",
                "name": "褐矮星",
                "min_brightness": 0,
            },
        ],
    }
    config = client.get("/api/config").json()
    assert config["catalog_background_style"] == "constellation"
    assert config["reader_background_style"] == "clean"
    assert config["pointer_effect_enabled"] is False
    assert config["home_intro_enabled"] is True
    assert config["home_intro_mode"] == "first"
    assert config["home_intro_duration_ms"] == 4190
    assert config["home_intro_assembly_duration_ms"] == 2600
    assert config["home_intro_hold_duration_ms"] == 900
    assert config["home_intro_lock_scroll"] is False
    assert config["home_intro_contributor_limit"] == 10
    assert config["home_background_style"] == "contribution_star_map"
    assert config["home_content_mask_enabled"] is True
    assert config["home_content_idle_timeout_seconds"] == 45
    assert config["home_star_scope"] == "full"
    assert config["home_star_relation_visibility"] == "hidden"
    assert config["home_star_strong_relation_style"] == "glow"
    assert config["home_star_graph_direction"] == "undirected"
    assert (
        config["home_star_illumination_rule"]
        == "reverse_depth"
    )
    assert config["home_star_active_edge_mode"] == "minimal_tree"
    assert config["home_star_illumination_depth"] == 4
    assert config["home_star_selection_duration_ms"] == 4500
    assert config["home_star_label_duration_ms"] == 6500
    assert config["home_star_brightness_variation_enabled"] is True
    assert config["home_star_brightness_min"] == 5
    assert config["home_star_brightness_initial"] == 25
    assert config["home_star_brightness_max"] == 80
    assert config["home_star_brightness_variation_amount"] == 4.5
    assert config["home_star_brightness_rules"][0] == {
        "id": "contributor-formula",
        "name": "静星公式",
        "enabled": True,
        "target": "contributor",
        "formula": (
            "current_brightness + sin(pi / 2) * activity_7_count"
        ),
    }
    assert config["home_star_brightness_tiers"] == [
        {"id": "brown", "name": "褐矮星", "min_brightness": 0},
        {"id": "red", "name": "红矮星", "min_brightness": 25},
    ]

    legacy_timing = client.put(
        "/api/admin/visual-settings",
        headers={"X-CSRF-Token": csrf},
        json={
            "catalog_background_style": "constellation",
            "reader_background_style": "clean",
            "pointer_effect_enabled": False,
            "home_intro_enabled": True,
            "home_intro_mode": "first",
            "home_intro_duration_ms": 5000,
            "home_intro_lock_scroll": False,
            "home_intro_contributor_limit": 10,
        },
    )
    assert legacy_timing.status_code == 200, legacy_timing.text
    assert legacy_timing.json()["home_intro_duration_ms"] == 5000
    assert (
        legacy_timing.json()["home_intro_assembly_duration_ms"] == 2800
    )
    assert legacy_timing.json()["home_intro_hold_duration_ms"] == 1050
    assert client.get("/api/config").json()[
        "home_content_idle_timeout_seconds"
    ] == 45

    invalid_catalog = client.put(
        "/api/admin/visual-settings",
        headers={"X-CSRF-Token": csrf},
        json={
            "catalog_background_style": "unsupported",
            "reader_background_style": "blueprint",
            "pointer_effect_enabled": True,
            "home_intro_enabled": True,
        },
    )
    assert invalid_catalog.status_code == 422

    invalid_reader = client.put(
        "/api/admin/visual-settings",
        headers={"X-CSRF-Token": csrf},
        json={
            "catalog_background_style": "circuit",
            "reader_background_style": "unsupported",
            "pointer_effect_enabled": True,
            "home_intro_enabled": True,
        },
    )
    assert invalid_reader.status_code == 422

    invalid_timing = client.put(
        "/api/admin/visual-settings",
        headers={"X-CSRF-Token": csrf},
        json={
            "catalog_background_style": "circuit",
            "reader_background_style": "blueprint",
            "pointer_effect_enabled": True,
            "home_intro_enabled": True,
            "home_intro_duration_ms": 900,
            "home_intro_assembly_duration_ms": 400,
            "home_intro_hold_duration_ms": 10001,
            "home_intro_lock_scroll": True,
            "home_intro_contributor_limit": 11,
        },
    )
    assert invalid_timing.status_code == 422

    invalid_idle_timeout = client.put(
        "/api/admin/visual-settings",
        headers={"X-CSRF-Token": csrf},
        json={
            "home_content_idle_timeout_seconds": 3601,
        },
    )
    assert invalid_idle_timeout.status_code == 422

    invalid_mode = client.put(
        "/api/admin/visual-settings",
        headers={"X-CSRF-Token": csrf},
        json={
            "catalog_background_style": "circuit",
            "reader_background_style": "blueprint",
            "pointer_effect_enabled": True,
            "home_intro_enabled": True,
            "home_intro_mode": "sometimes",
        },
    )
    assert invalid_mode.status_code == 422

    invalid_illumination = client.put(
        "/api/admin/visual-settings",
        headers={"X-CSRF-Token": csrf},
        json={
            "catalog_background_style": "circuit",
            "reader_background_style": "blueprint",
            "pointer_effect_enabled": True,
            "home_intro_enabled": True,
            "home_star_illumination_rule": "recursive_everything",
        },
    )
    assert invalid_illumination.status_code == 422

    invalid_graph_direction = client.put(
        "/api/admin/visual-settings",
        headers={"X-CSRF-Token": csrf},
        json={
            "catalog_background_style": "circuit",
            "reader_background_style": "blueprint",
            "pointer_effect_enabled": True,
            "home_intro_enabled": True,
            "home_star_graph_direction": "sideways",
        },
    )
    assert invalid_graph_direction.status_code == 422

    invalid_brightness_range = client.put(
        "/api/admin/visual-settings",
        headers={"X-CSRF-Token": csrf},
        json={
            "catalog_background_style": "circuit",
            "reader_background_style": "blueprint",
            "pointer_effect_enabled": True,
            "home_intro_enabled": True,
            "home_star_brightness_initial": 81,
            "home_star_brightness_max": 80,
        },
    )
    assert invalid_brightness_range.status_code == 422

    invalid_formula = client.put(
        "/api/admin/visual-settings",
        headers={"X-CSRF-Token": csrf},
        json={
            "catalog_background_style": "circuit",
            "reader_background_style": "blueprint",
            "pointer_effect_enabled": True,
            "home_intro_enabled": True,
            "home_star_brightness_rules": [
                {
                    "id": "unsafe",
                    "name": "非法公式",
                    "target": "document",
                    "formula": "star.value + unknown",
                }
            ],
        },
    )
    assert invalid_formula.status_code == 422
    assert "亮度规则" in invalid_formula.json()["detail"]

    duplicate_tiers = client.put(
        "/api/admin/visual-settings",
        headers={"X-CSRF-Token": csrf},
        json={
            "catalog_background_style": "circuit",
            "reader_background_style": "blueprint",
            "pointer_effect_enabled": True,
            "home_intro_enabled": True,
            "home_star_brightness_tiers": [
                {
                    "id": "one",
                    "name": "等级一",
                    "min_brightness": 10,
                },
                {
                    "id": "two",
                    "name": "等级二",
                    "min_brightness": 10,
                },
            ],
        },
    )
    assert duplicate_tiers.status_code == 422

    invalid_active_edges = client.put(
        "/api/admin/visual-settings",
        headers={"X-CSRF-Token": csrf},
        json={
            "catalog_background_style": "circuit",
            "reader_background_style": "blueprint",
            "pointer_effect_enabled": True,
            "home_intro_enabled": True,
            "home_star_active_edge_mode": "random_lines",
        },
    )
    assert invalid_active_edges.status_code == 422


def test_admin_can_save_encrypted_smtp_configuration(
    client: TestClient,
) -> None:
    payload = login(client, "sourcecode", TEST_BOOTSTRAP_PASSWORD)
    changed = client.post(
        "/api/auth/change-password",
        headers={"X-CSRF-Token": payload["csrf_token"]},
        json={
            "current_password": TEST_BOOTSTRAP_PASSWORD,
            "new_password": "a-new-strong-password",
        },
    ).json()
    csrf = changed["csrf_token"]

    overview = client.get("/api/admin/overview").json()
    assert {
        template["id"] for template in overview["smtp_templates"]
    } == {"qq", "gmail", "outlook", "custom"}
    assert overview["smtp"]["configured"] is False

    authorization_code = "qq-smtp-authorization-code"
    saved = client.put(
        "/api/admin/smtp",
        headers={"X-CSRF-Token": csrf},
        json={
            "enabled": True,
            "provider": "qq",
            "host": "smtp.qq.com",
            "port": 587,
            "username": "sourcecode@qq.com",
            "password": authorization_code,
            "from_address": "sourcecode@qq.com",
            "starttls": True,
        },
    )
    assert saved.status_code == 200, saved.text
    configuration = saved.json()
    assert configuration["configured"] is True
    assert configuration["password_set"] is True
    assert "password" not in configuration

    database = client.app.state.db
    with database.connect() as connection:
        encrypted = connection.execute(
            """
            SELECT value FROM settings
            WHERE key = 'smtp_password_encrypted'
            """
        ).fetchone()["value"]
        audit_details = [
            row["detail"]
            for row in connection.execute(
                "SELECT detail FROM audit_log WHERE detail IS NOT NULL"
            ).fetchall()
        ]
    assert encrypted != authorization_code
    assert client.app.state.cipher.decrypt(encrypted) == authorization_code
    assert all(authorization_code not in detail for detail in audit_details)

    retained = client.put(
        "/api/admin/smtp",
        headers={"X-CSRF-Token": csrf},
        json={
            "enabled": True,
            "provider": "qq",
            "host": "smtp.qq.com",
            "port": 587,
            "username": "sourcecode@qq.com",
            "password": "",
            "from_address": "sourcecode@qq.com",
            "starttls": True,
        },
    )
    assert retained.status_code == 200, retained.text
    with database.connect() as connection:
        retained_encrypted = connection.execute(
            """
            SELECT value FROM settings
            WHERE key = 'smtp_password_encrypted'
            """
        ).fetchone()["value"]
    assert retained_encrypted == encrypted

    changed_username = client.put(
        "/api/admin/smtp",
        headers={"X-CSRF-Token": csrf},
        json={
            "enabled": True,
            "provider": "gmail",
            "host": "smtp.gmail.com",
            "port": 587,
            "username": "different@gmail.com",
            "password": "",
            "from_address": "different@gmail.com",
            "starttls": True,
        },
    )
    assert changed_username.status_code == 422

    disabled_username_change = client.put(
        "/api/admin/smtp",
        headers={"X-CSRF-Token": csrf},
        json={
            "enabled": False,
            "provider": "gmail",
            "host": "smtp.gmail.com",
            "port": 587,
            "username": "different@gmail.com",
            "password": "",
            "from_address": "different@gmail.com",
            "starttls": True,
        },
    )
    assert disabled_username_change.status_code == 422


def test_admin_smtp_test_uses_saved_configuration(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = login(client, "sourcecode", TEST_BOOTSTRAP_PASSWORD)
    changed = client.post(
        "/api/auth/change-password",
        headers={"X-CSRF-Token": payload["csrf_token"]},
        json={
            "current_password": TEST_BOOTSTRAP_PASSWORD,
            "new_password": "a-new-strong-password",
        },
    ).json()
    csrf = changed["csrf_token"]
    saved = client.put(
        "/api/admin/smtp",
        headers={"X-CSRF-Token": csrf},
        json={
            "enabled": True,
            "provider": "gmail",
            "host": "smtp.gmail.com",
            "port": 587,
            "username": "sender@gmail.com",
            "password": "gmail-app-password",
            "from_address": "sender@gmail.com",
            "starttls": True,
        },
    )
    assert saved.status_code == 200, saved.text

    observed = {}

    def fake_send_email(configuration, recipients, subject, body):
        observed.update(
            {
                "configuration": configuration,
                "recipients": recipients,
                "subject": subject,
                "body": body,
            }
        )
        return "sent", None

    monkeypatch.setattr("app.main.send_email", fake_send_email)
    tested = client.post(
        "/api/admin/smtp/test",
        headers={"X-CSRF-Token": csrf},
    )
    assert tested.status_code == 200, tested.text
    assert tested.json() == {
        "status": "sent",
        "recipient": "sourcecode@example.test",
    }
    assert observed["recipients"] == ["sourcecode@example.test"]
    assert observed["configuration"].provider == "gmail"
    assert observed["configuration"].smtp_password == "gmail-app-password"
    assert "SMTP 配置测试" in observed["subject"]


def test_admin_page_requires_ready_admin(client: TestClient) -> None:
    response = client.get("/admin", follow_redirects=False)
    assert response.status_code == 307

    payload = login(client, "sourcecode", TEST_BOOTSTRAP_PASSWORD)
    csrf = payload["csrf_token"]
    response = client.get("/admin", follow_redirects=False)
    assert response.status_code == 307

    client.post(
        "/api/auth/change-password",
        headers={"X-CSRF-Token": csrf},
        json={
            "current_password": TEST_BOOTSTRAP_PASSWORD,
            "new_password": "a-new-strong-password",
        },
    )
    response = client.get("/admin", follow_redirects=False)
    assert response.status_code == 200


def test_legacy_root_cookie_cannot_override_editor_session(
    tmp_path: Path,
) -> None:
    settings = replace(make_settings(tmp_path), cookie_path="/editor")
    app = create_app(settings)
    app.state.github.list_pull_requests = AsyncMock(return_value=[])
    with TestClient(app, base_url="http://testserver") as client:
        response = client.post(
            "/api/auth/login",
            json={
                "identifier": "sourcecode",
                "password": TEST_BOOTSTRAP_PASSWORD,
            },
        )
        assert response.status_code == 200
        set_cookies = response.headers.get_list("set-cookie")
        editor_cookie = next(
            value
            for value in set_cookies
            if "gck_editor_session=" in value
            and "Path=/editor" in value
            and "Max-Age=86400" in value
        )
        session_token = editor_cookie.split(
            "gck_editor_session=",
            1,
        )[1].split(";", 1)[0]
        assert any(
            "gck_editor_session=" in value
            and "Path=/" in value
            and "Max-Age=0" in value
            for value in set_cookies
        )
        with app.state.db.connect() as connection:
            connection.execute(
                """
                UPDATE users SET must_change_password = 0
                WHERE username = 'sourcecode'
                """
            )

        duplicate_cookie = (
            f"gck_editor_session={session_token}; "
            "gck_editor_session=stale-root-cookie"
        )
        session = client.get(
            "/api/session",
            headers={"Cookie": duplicate_cookie},
        )
        assert session.json()["authenticated"] is True
        assert session.json()["user"]["username"] == "sourcecode"

        reverse_order = client.get(
            "/api/session",
            headers={
                "Cookie": (
                    "gck_editor_session=stale-root-cookie; "
                    f"gck_editor_session={session_token}"
                )
            },
        )
        assert reverse_order.json()["authenticated"] is True

        admin = client.get(
            "/admin",
            headers={"Cookie": duplicate_cookie},
            follow_redirects=False,
        )
        assert admin.status_code == 200
        comments = client.get(
            "/api/comments",
            params={"path": "knowledge/ecs/01-fundamentals.md"},
            headers={"Cookie": duplicate_cookie},
        )
        assert comments.json()["can_comment"] is True
        bootstrap = client.get(
            "/api/bootstrap",
            params={"path": "knowledge/cpp/01-cpp98.md"},
            headers={"Cookie": duplicate_cookie},
        )
        assert bootstrap.json()["session"]["authenticated"] is True


def test_drafts_are_isolated_by_user(client: TestClient) -> None:
    first = client.post(
        "/api/auth/register",
        json={
            "email": "first@example.test",
            "username": "first-user",
            "password": "local-password-123",
        },
    ).json()
    draft = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": first["csrf_token"]},
        json={
            "path": "knowledge/cpp/first/README.md",
            "content": "# First\n",
            "operation": "upsert",
        },
    )
    assert draft.status_code == 200

    second = client.post(
        "/api/auth/register",
        json={
            "email": "second@example.test",
            "username": "second-user",
            "password": "local-password-123",
        },
    )
    assert second.status_code == 200
    assert client.get("/api/drafts").json()["items"] == []


def test_local_submission_uses_user_author_and_base_commit(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "author@example.test",
            "username": "author-user",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]

    github = client.app.state.github
    github.submit = AsyncMock(
        return_value=SubmissionResult(
            branch="web/author-user/add-author",
            commit_sha="commit-sha",
            pr_number=42,
            pr_url="https://github.example/pr/42",
        )
    )

    response = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=git_submission(
            "author-user",
            "add-author",
            "docs: add author topic",
            [
                {
                    "path": "knowledge/cpp/author/README.md",
                    "content": "# Author\n",
                    "operation": "upsert",
                }
            ],
            body="Test submission",
        ),
    )
    assert response.status_code == 200, response.text
    assert response.json()["branch"] == "web/author-user/add-author"

    call = github.submit.await_args.kwargs
    assert call["author"] == {
        "name": "author-user",
        "email": "web-editor+2@users.noreply.chenyurui.top",
    }
    assert call["base_commit"] == TEST_BASE_COMMIT


def test_submission_keeps_base_commit_and_does_not_premerge_main(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "merge-submit@example.test",
            "username": "merge-submit",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    path = "knowledge/cpp/merge-submit.md"
    local = "# Topic\n\nalpha local\n\nmiddle\n\ngamma\n"

    github = client.app.state.github
    github.main_reference = AsyncMock()
    github.repository_tree = AsyncMock()
    github.repository_blob = AsyncMock()
    github.submit = AsyncMock(
        return_value=SubmissionResult(
            branch="web/merge-submit/auto-merge",
            commit_sha="merged-commit",
            pr_number=81,
            pr_url="https://github.example/pr/81",
        )
    )

    response = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=git_submission(
            "merge-submit",
            "base-commit",
            "docs: keep historical base",
            [{"path": path, "content": local, "operation": "upsert"}],
        ),
    )

    assert response.status_code == 200, response.text
    change = github.submit.await_args.kwargs["changes"][0]
    assert change["content"] == local
    assert github.submit.await_args.kwargs["base_commit"] == TEST_BASE_COMMIT
    github.main_reference.assert_not_awaited()
    github.repository_tree.assert_not_awaited()
    github.repository_blob.assert_not_awaited()


def test_submission_accepts_client_workspace_changes_without_server_drafts(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "local-tree@example.test",
            "username": "local-tree",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    github = client.app.state.github
    github.main_reference = AsyncMock(
        return_value={"object": {"sha": "latest-main"}}
    )
    github.repository_tree = AsyncMock(return_value=[])
    github.submit = AsyncMock(
        return_value=SubmissionResult(
            branch="web/local-tree/client-workspace",
            commit_sha="client-workspace-commit",
            pr_number=82,
            pr_url="https://github.example/pr/82",
        )
    )

    response = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=git_submission(
            "local-tree",
            "client-workspace",
            "docs: submit local workspace",
            [
                {
                    "path": "knowledge/cpp/local-tree/README.md",
                    "content": "# Local tree\n",
                    "operation": "upsert",
                }
            ],
        ),
    )

    assert response.status_code == 200, response.text
    changes = github.submit.await_args.kwargs["changes"]
    assert changes[0]["path"] == "knowledge/cpp/local-tree/README.md"
    assert changes[0]["content"] == "# Local tree\n"


def test_submission_keeps_server_security_boundaries(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "protocol-security@example.test",
            "username": "protocol-security",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    github = client.app.state.github
    github.submit = AsyncMock()
    valid_change = {
        "path": "knowledge/cpp/security.md",
        "content": "# Security\n",
        "operation": "upsert",
    }

    wrong_namespace = git_submission(
        "protocol-security",
        "safe",
        "docs: security",
        [valid_change],
    )
    wrong_namespace["branch"] = "web/another-user/safe"
    response = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=wrong_namespace,
    )
    assert response.status_code == 422

    wrong_base = git_submission(
        "protocol-security",
        "safe",
        "docs: security",
        [valid_change],
    )
    wrong_base["pr_base"] = "release"
    response = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=wrong_base,
    )
    assert response.status_code == 422

    duplicate = git_submission(
        "protocol-security",
        "safe",
        "docs: security",
        [valid_change, valid_change],
    )
    response = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=duplicate,
    )
    assert response.status_code == 422
    assert "重复" in response.text
    github.submit.assert_not_awaited()


def test_submission_forwards_markdown_without_server_structure_validation(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "partial-tree@example.test",
            "username": "partial-tree",
            "password": "local-password-123",
        },
    ).json()
    client.app.state.github.submit = AsyncMock(
        return_value=SubmissionResult(
            branch="web/partial-tree/partial-workspace",
            commit_sha="partial-commit",
            pr_number=84,
            pr_url="https://github.example/pr/84",
        )
    )
    response = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": registered["csrf_token"]},
        json=git_submission(
            "partial-tree",
            "partial-workspace",
            "docs: client validates Markdown",
            [
                {
                    "path": "knowledge/cpp/partial.md",
                    "content": "## 1. 只有被修改的一行\n",
                    "operation": "upsert",
                }
            ],
        ),
    )

    assert response.status_code == 200, response.text
    change = client.app.state.github.submit.await_args.kwargs["changes"][0]
    assert change["content"] == "## 1. 只有被修改的一行\n"


def test_submission_forwards_complete_markdown_when_only_h2_changes(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "complete-tree@example.test",
            "username": "complete-tree",
            "password": "local-password-123",
        },
    ).json()
    path = "program/knowledge/engine/01-memory-allocators.md"
    base = (
        "# 内存分配器与分配器上下文\n\n导言。\n\n"
        "## 1. 为什么引擎要自定义分配器\n\n正文。\n\n"
        "## 2. 各策略要点\n\n后续完整内容。\n"
    )
    current = base.replace(
        "## 1. 为什么引擎要自定义分配器",
        "## 1. 为什么引擎要自定义分配器追加文字",
    )
    github = client.app.state.github
    github.submit = AsyncMock(
        return_value=SubmissionResult(
            branch="web/complete-tree/change-h2",
            commit_sha="complete-file-commit",
            pr_number=83,
            pr_url="https://github.example/pr/83",
        )
    )

    response = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": registered["csrf_token"]},
        json=git_submission(
            "complete-tree",
            "change-h2",
            "docs: change h2",
            [{"path": path, "content": current, "operation": "upsert"}],
        ),
    )

    assert response.status_code == 200, response.text
    submitted = github.submit.await_args.kwargs["changes"][0]["content"]
    assert submitted == current
    assert submitted.startswith("# 内存分配器与分配器上下文\n")
    assert "## 2. 各策略要点" in submitted
    assert "后续完整内容。" in submitted


def test_submission_leaves_main_conflicts_for_pull_request(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "merge-conflict@example.test",
            "username": "merge-conflict",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    path = "knowledge/cpp/merge-conflict.md"

    github = client.app.state.github
    github.repository_tree = AsyncMock()
    github.repository_blob = AsyncMock()
    github.submit = AsyncMock(
        return_value=SubmissionResult(
            branch="web/merge-conflict/conflict",
            commit_sha="conflicting-branch-commit",
            pr_number=85,
            pr_url="https://github.example/pr/85",
        )
    )

    response = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=git_submission(
            "merge-conflict",
            "conflict",
            "docs: conflicting changes",
            [
                {
                    "path": path,
                    "content": "# Topic\n\nlocal\n",
                    "operation": "upsert",
                }
            ],
        ),
    )

    assert response.status_code == 200, response.text
    github.submit.assert_awaited_once()
    github.repository_tree.assert_not_awaited()
    github.repository_blob.assert_not_awaited()


def test_same_user_can_confirm_submission_branch_overwrite(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "overwrite@example.test",
            "username": "overwrite-user",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    github = client.app.state.github
    github.submit = AsyncMock(
        return_value=SubmissionResult(
            branch="web/overwrite-user/reusable-head",
            commit_sha="first-commit",
            pr_number=51,
            pr_url="https://github.example/pr/51",
        )
    )

    first_changes = [
        {
            "path": "knowledge/cpp/overwrite-first.md",
            "content": "# First\n",
            "operation": "upsert",
        }
    ]
    first_submit = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=git_submission(
            "overwrite-user",
            "reusable-head",
            "docs: first submission",
            first_changes,
        ),
    )
    assert first_submit.status_code == 200, first_submit.text

    second_changes = [
        {
            "path": "knowledge/cpp/overwrite-second.md",
            "content": "# Second\n",
            "operation": "upsert",
        }
    ]
    conflict = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=git_submission(
            "overwrite-user",
            "reusable-head",
            "docs: replacement submission",
            second_changes,
        ),
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == {
        "code": "branch_conflict",
        "message": "该提交头已经使用，是否覆盖原分支和 Draft PR？",
        "branch": "web/overwrite-user/reusable-head",
        "can_overwrite": True,
    }
    assert github.submit.await_count == 1

    github.submit.return_value = SubmissionResult(
        branch="web/overwrite-user/reusable-head",
        commit_sha="replacement-commit",
        pr_number=51,
        pr_url="https://github.example/pr/51",
    )
    overwritten = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=git_submission(
            "overwrite-user",
            "reusable-head",
            "docs: replacement submission",
            second_changes,
            force_update=True,
        ),
    )
    assert overwritten.status_code == 200, overwritten.text
    assert overwritten.json()["overwritten"] is True
    assert overwritten.json()["pr_number"] == 51
    assert github.submit.await_args.kwargs["force_update"] is True


def test_unknown_remote_branch_cannot_be_overwritten(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "remote-conflict@example.test",
            "username": "remote-conflict",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    github = client.app.state.github
    github.submit = AsyncMock(
        side_effect=BranchConflictError(
            "web/remote-conflict/occupied"
        )
    )
    conflict = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=git_submission(
            "remote-conflict",
            "occupied",
            "docs: remote conflict",
            [
                {
                    "path": "knowledge/cpp/remote-conflict.md",
                    "content": "# Remote conflict\n",
                    "operation": "upsert",
                }
            ],
        ),
    )
    assert conflict.status_code == 409
    detail = conflict.json()["detail"]
    assert detail["code"] == "branch_conflict"
    assert detail["can_overwrite"] is False
    github.submit.assert_awaited_once()


def test_submission_queues_verified_contributor_thank_you(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "feedback@example.test",
            "username": "feedback-user",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    user_id = registered["user"]["id"]
    with client.app.state.db.connect() as connection:
        connection.execute(
            "UPDATE users SET email_verified = 1 WHERE id = ?",
            (user_id,),
        )
    draft = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "knowledge/cpp/feedback.md",
            "content": "# Feedback\n",
            "operation": "upsert",
        },
    )
    assert draft.status_code == 200

    github = client.app.state.github
    github.submit = AsyncMock(
        return_value=SubmissionResult(
            branch="web/feedback-user/feedback",
            commit_sha="feedback-commit",
            pr_number=61,
            pr_url="https://github.example/pr/61",
        )
    )
    submitted = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=git_submission(
            "feedback-user",
            "feedback",
            "docs: feedback",
            [
                {
                    "path": "knowledge/cpp/feedback.md",
                    "content": "# Feedback\n",
                    "operation": "upsert",
                }
            ],
        ),
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["feedback_email_queued"] is True
    submission_id = submitted.json()["id"]
    with client.app.state.db.connect() as connection:
        notification = connection.execute(
            """
            SELECT * FROM notifications
            WHERE submission_id = ?
              AND event_type = 'contributor_submission_received'
            """,
            (submission_id,),
        ).fetchone()
    assert notification["audience"] == "contributor"
    assert "感谢你的贡献" in notification["subject"]


def test_auto_closed_submission_can_be_restored_and_urged(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "restore@example.test",
            "username": "restore-user",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    user_id = registered["user"]["id"]
    now = datetime.now(timezone.utc)
    with client.app.state.db.connect() as connection:
        cursor = connection.execute(
            """
            INSERT INTO submissions(
                user_id, auth_provider, branch_name, title, description,
                pr_number, pr_url, status, auto_closed, closed_at,
                created_at, updated_at
            )
            VALUES(?, 'local', ?, ?, '', 62, ?, 'closed', 1, ?, ?, ?)
            """,
            (
                user_id,
                "web/restore-user/restore",
                "Restore contribution",
                "https://github.example/pr/62",
                now.isoformat(),
                now.isoformat(),
                now.isoformat(),
            ),
        )
        submission_id = cursor.lastrowid

    github = client.app.state.github
    github.update_pull_state = AsyncMock(
        return_value={
            "state": "open",
            "updated_at": now.isoformat(),
        }
    )
    restored = client.post(
        f"/api/submissions/{submission_id}/restore-and-urge",
        headers={"X-CSRF-Token": csrf},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["status"] == "open"
    github.update_pull_state.assert_awaited_once_with(
        62,
        "open",
        "test-bot-token",
    )

    limited = client.post(
        f"/api/submissions/{submission_id}/urge",
        headers={"X-CSRF-Token": csrf},
    )
    assert limited.status_code == 429

    old_urge = (now - timedelta(hours=25)).isoformat()
    with client.app.state.db.connect() as connection:
        connection.execute(
            "UPDATE submissions SET last_urged_at = ? WHERE id = ?",
            (old_urge, submission_id),
        )
    urged = client.post(
        f"/api/submissions/{submission_id}/urge",
        headers={"X-CSRF-Token": csrf},
    )
    assert urged.status_code == 200, urged.text
    assert urged.json()["urge_count"] == 2
    with client.app.state.db.connect() as connection:
        events = {
            row["event_type"]
            for row in connection.execute(
                """
                SELECT event_type FROM notifications
                WHERE event_type LIKE 'pull_request_%'
                """
            ).fetchall()
        }
    assert "pull_request_restored_and_urged" in events
    assert "pull_request_urged" in events


def test_external_contributor_can_urge_without_an_account(
    client: TestClient,
) -> None:
    now = datetime.now(timezone.utc)
    with client.app.state.db.connect() as connection:
        cursor = connection.execute(
            """
            INSERT INTO external_pull_requests(
                pr_number, pr_url, title, github_login,
                contributor_email, email_source, head_ref,
                status, is_draft, auto_closed,
                github_created_at, pr_updated_at,
                created_at, updated_at
            )
            VALUES(
                91, 'https://github.example/pull/91', 'External PR',
                'outside-user', 'outside@example.test', 'github_profile',
                'feature/outside', 'open', 0, 0, ?, ?, ?, ?
            )
            """,
            (
                now.isoformat(),
                now.isoformat(),
                now.isoformat(),
                now.isoformat(),
            ),
        )
        external_id = cursor.lastrowid
    token = issue_external_urge_token(
        client.app.state.db,
        external_id,
        now=now,
    )

    landing = client.get(
        "/external-pr/urge",
        params={"token": token},
    )
    assert landing.status_code == 200
    assert "正在通知管理员" in landing.text
    with client.app.state.db.connect() as connection:
        before = connection.execute(
            "SELECT urge_count FROM external_pull_requests WHERE id = ?",
            (external_id,),
        ).fetchone()["urge_count"]
    assert before == 0, "GET must not trigger email-scanner side effects"

    urged = client.post(
        "/api/external-pr/urge",
        json={"token": token},
    )
    assert urged.status_code == 200, urged.text
    assert urged.json()["urge_count"] == 1
    limited = client.post(
        "/api/external-pr/urge",
        json={"token": token},
    )
    assert limited.status_code == 429

    with client.app.state.db.connect() as connection:
        notification = connection.execute(
            """
            SELECT * FROM notifications
            WHERE external_pr_id = ?
              AND event_type = 'external_pull_request_urged'
            """,
            (external_id,),
        ).fetchone()
    assert notification["audience"] == "admin"
    assert "outside-user" in notification["body"]


def test_submission_preserves_file_delete_operation(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "delete-submit@example.test",
            "username": "delete-submit",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    path = "knowledge/cpp/obsolete/README.md"

    github = client.app.state.github
    github.submit = AsyncMock(
        return_value=SubmissionResult(
            branch="web/delete-submit/remove-obsolete",
            commit_sha="commit-sha",
            pr_number=43,
            pr_url="https://github.example/pr/43",
        )
    )

    response = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=git_submission(
            "delete-submit",
            "remove-obsolete",
            "docs: remove obsolete topic",
            [{"path": path, "content": "", "operation": "delete"}],
        ),
    )
    assert response.status_code == 200, response.text
    changes = github.submit.await_args.kwargs["changes"]
    assert changes[0]["path"] == path
    assert changes[0]["operation"] == "delete"


def test_submission_leaves_module_deletion_policy_to_client_and_review(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "delete-module@example.test",
            "username": "delete-module",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    path = "graphics/README.md"
    github = client.app.state.github
    github.submit = AsyncMock(
        return_value=SubmissionResult(
            branch="web/delete-module/remove-module-readme",
            commit_sha="module-delete-commit",
            pr_number=86,
            pr_url="https://github.example/pr/86",
        )
    )

    response = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=git_submission(
            "delete-module",
            "remove-module-readme",
            "docs: remove module readme",
            [{"path": path, "content": "", "operation": "delete"}],
        ),
    )
    assert response.status_code == 200, response.text
    github.submit.assert_awaited_once()


def test_submission_allows_complete_top_level_module_deletion(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "delete-complete-module@example.test",
            "username": "delete-complete-module",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    files = {
        "graphics/README.md",
        "graphics/topic/README.md",
        "graphics/topic/diagram.png",
    }

    github = client.app.state.github
    github.submit = AsyncMock(
        return_value=SubmissionResult(
            branch="web/delete-complete-module/remove-graphics",
            commit_sha="commit-sha",
            pr_number=44,
            pr_url="https://github.example/pr/44",
        )
    )

    response = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=git_submission(
            "delete-complete-module",
            "remove-graphics",
            "docs: remove graphics module",
            [
                {"path": path, "content": "", "operation": "delete"}
                for path in files
            ],
        ),
    )
    assert response.status_code == 200, response.text
    changes = github.submit.await_args.kwargs["changes"]
    assert {item["path"] for item in changes} == set(files)
    assert all(item["operation"] == "delete" for item in changes)


def test_admin_can_verify_local_email(client: TestClient) -> None:
    registered = client.post(
        "/api/auth/register",
        json={
            "email": "verify@example.test",
            "username": "verify-user",
            "password": "local-password-123",
        },
    ).json()
    user_id = registered["user"]["id"]
    assert registered["user"]["email_verified"] is False

    admin = login(client, "sourcecode", TEST_BOOTSTRAP_PASSWORD)
    csrf = admin["csrf_token"]
    changed = client.post(
        "/api/auth/change-password",
        headers={"X-CSRF-Token": csrf},
        json={
            "current_password": TEST_BOOTSTRAP_PASSWORD,
            "new_password": "a-new-strong-password",
        },
    ).json()
    response = client.post(
        f"/api/admin/users/{user_id}/verify-email",
        headers={"X-CSRF-Token": changed["csrf_token"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["email_verified"] is True


def test_github_oauth_state_is_bound_to_browser(
    oauth_client: TestClient,
) -> None:
    start = oauth_client.get("/api/auth/github", follow_redirects=False)
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    oauth_client.cookies.delete("gck_editor_oauth_state")

    rejected = oauth_client.get(
        "/api/auth/github/callback",
        params={"code": "attacker-code", "state": state},
        follow_redirects=False,
    )
    assert rejected.status_code == 400

    start = oauth_client.get("/api/auth/github", follow_redirects=False)
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    github = oauth_client.app.state.github
    github.exchange_oauth_code = AsyncMock(return_value="github-token")
    github.user_profile = AsyncMock(
        return_value={"id": 1234, "login": "verified-user"}
    )
    github.user_emails = AsyncMock(
        return_value=[
            {
                "email": "verified@example.test",
                "verified": True,
                "primary": True,
            }
        ]
    )

    accepted = oauth_client.get(
        "/api/auth/github/callback",
        params={"code": "valid-code", "state": state},
        follow_redirects=False,
    )
    assert accepted.status_code == 307
    session = oauth_client.get("/api/session").json()
    assert session["user"]["github_verified"] is True
    assert session["user"]["email_verified"] is True


def test_github_oauth_state_survives_exchange_transport_failure(
    oauth_client: TestClient,
) -> None:
    start = oauth_client.get("/api/auth/github", follow_redirects=False)
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    github = oauth_client.app.state.github
    github.exchange_oauth_code = AsyncMock(
        side_effect=GitHubError("GitHub OAuth unavailable", 503)
    )

    failed = oauth_client.get(
        "/api/auth/github/callback",
        params={"code": "retryable-code", "state": state},
        follow_redirects=False,
    )
    assert failed.status_code == 503

    github.exchange_oauth_code = AsyncMock(return_value="github-token")
    github.user_profile = AsyncMock(
        return_value={"id": 4321, "login": "retry-user"}
    )
    github.user_emails = AsyncMock(
        return_value=[
            {
                "email": "retry@example.test",
                "verified": True,
                "primary": True,
            }
        ]
    )
    retried = oauth_client.get(
        "/api/auth/github/callback",
        params={"code": "retryable-code", "state": state},
        follow_redirects=False,
    )
    assert retried.status_code == 307


def test_github_oauth_denial_returns_to_reader(
    oauth_client: TestClient,
) -> None:
    start = oauth_client.get(
        "/api/auth/github",
        params={"return_to": "/knowledge/cpp/"},
        follow_redirects=False,
    )
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    denied = oauth_client.get(
        "/api/auth/github/callback",
        params={"error": "access_denied", "state": state},
        follow_redirects=False,
    )
    assert denied.status_code == 307
    assert denied.headers["location"] == (
        "https://example.test/knowledge/cpp/?github_auth_error=access_denied"
    )

    replayed = oauth_client.get(
        "/api/auth/github/callback",
        params={"error": "access_denied", "state": state},
        follow_redirects=False,
    )
    assert replayed.status_code == 400


def test_local_account_can_explicitly_bind_and_unlink_github(
    oauth_client: TestClient,
) -> None:
    registered = oauth_client.post(
        "/api/auth/register",
        json={
            "email": "local@example.test",
            "username": "local-user",
            "password": "local-password-123",
        },
    ).json()
    csrf = registered["csrf_token"]
    github = oauth_client.app.state.github
    github.exchange_oauth_code = AsyncMock(return_value="github-token")
    github.user_profile = AsyncMock(
        return_value={"id": 9876, "login": "bound-user"}
    )
    github.user_emails = AsyncMock(
        return_value=[
            {
                "email": "github@example.test",
                "verified": True,
                "primary": True,
            }
        ]
    )

    start = oauth_client.get(
        "/api/auth/github",
        params={
            "mode": "bind",
            "return_to": "/knowledge/cpp/",
        },
        follow_redirects=False,
    )
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    callback = oauth_client.get(
        "/api/auth/github/callback",
        params={"code": "bind-code", "state": state},
        follow_redirects=False,
    )
    assert callback.status_code == 307
    assert callback.headers["location"] == "https://example.test/knowledge/cpp/"

    session = oauth_client.get("/api/session").json()
    assert session["user"]["email"] == "local@example.test"
    assert session["user"]["email_verified"] is False
    assert session["user"]["github_login"] == "bound-user"
    assert session["user"]["github_email"] == "github@example.test"
    assert session["user"]["github_verified"] is True

    draft = oauth_client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "knowledge/cpp/bound-user.md",
            "content": "# Bound user\n",
            "operation": "upsert",
        },
    )
    assert draft.status_code == 200
    github.submit = AsyncMock(
        return_value=SubmissionResult(
            branch="web/local-user/bound-submit",
            commit_sha="commit-sha",
            pr_number=44,
            pr_url="https://github.example/pr/44",
        )
    )
    submitted = oauth_client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json=git_submission(
            "local-user",
            "bound-submit",
            "docs: bound submit",
            [
                {
                    "path": "knowledge/cpp/bound-user.md",
                    "content": "# Bound user\n",
                    "operation": "upsert",
                }
            ],
        ),
    )
    assert submitted.status_code == 200, submitted.text
    assert github.submit.await_args.kwargs["token"] == "github-token"
    assert github.submit.await_args.kwargs["author"] is None

    unlinked = oauth_client.post(
        "/api/auth/github/unlink",
        headers={"X-CSRF-Token": csrf},
    )
    assert unlinked.status_code == 200
    session = oauth_client.get("/api/session").json()
    assert session["user"]["github_login"] is None
    assert session["user"]["github_verified"] is False


def test_github_bind_rejects_unsafe_return_path(
    oauth_client: TestClient,
) -> None:
    oauth_client.post(
        "/api/auth/register",
        json={
            "email": "return@example.test",
            "username": "return-user",
            "password": "local-password-123",
        },
    )
    github = oauth_client.app.state.github
    github.exchange_oauth_code = AsyncMock(return_value="github-token")
    github.user_profile = AsyncMock(
        return_value={"id": 6789, "login": "return-github"}
    )
    github.user_emails = AsyncMock(
        return_value=[
            {
                "email": "return-github@example.test",
                "verified": True,
                "primary": True,
            }
        ]
    )
    start = oauth_client.get(
        "/api/auth/github",
        params={"mode": "bind", "return_to": "/\\attacker.example/path"},
        follow_redirects=False,
    )
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    callback = oauth_client.get(
        "/api/auth/github/callback",
        params={"code": "bind-code", "state": state},
        follow_redirects=False,
    )
    assert callback.headers["location"] == "https://example.test/editor/"


def test_existing_oauth_state_table_is_migrated(tmp_path: Path) -> None:
    database_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(database_path)
    connection.execute(
        """
        CREATE TABLE oauth_states (
            state_hash TEXT PRIMARY KEY,
            code_verifier TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    connection.commit()
    connection.close()

    create_app(replace(make_settings(tmp_path), db_path=database_path))

    connection = sqlite3.connect(database_path)
    columns = {
        row[1]
        for row in connection.execute(
            "PRAGMA table_info(oauth_states)"
        ).fetchall()
    }
    connection.close()
    assert {"purpose", "user_id", "return_to"} <= columns
