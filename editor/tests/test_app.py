from __future__ import annotations

import sqlite3
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.config import Settings
from app.github import GitHubError, SubmissionResult
from app.main import create_app

TEST_BOOTSTRAP_PASSWORD = "test-bootstrap-password"


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
        smtp_host="",
        smtp_port=587,
        smtp_username="",
        smtp_password="",
        smtp_from="",
        smtp_starttls=True,
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
    assert module.json()["path"] == "graphics/README.md"
    assert 'shortTitle: "图形"' in module.json()["content"]
    assert "allowCode: true" in module.json()["content"]

    topic = client.post(
        "/api/topics",
        headers={"X-CSRF-Token": csrf},
        json={
            "root": "graphics",
            "parent": "",
            "slug": "rendering",
            "title": "渲染基础",
            "description": "",
        },
    )
    assert topic.status_code == 200, topic.text
    assert topic.json()["path"] == "graphics/rendering/README.md"

    source = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "graphics/rendering/demo.cpp",
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
    assert [item["path"] for item in payload["drafts"]] == [
        "knowledge/cpp/bootstrap/README.md"
    ]
    assert "Immediate draft content." in payload["active_draft_html"]


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
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["edit_policy"] == "github_verified"
    assert response.json()["pr_auto_close_days"] == 14


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


def test_local_submission_uses_user_author_and_expected_main(
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
    draft = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "knowledge/cpp/author/README.md",
            "content": "# Author\n",
            "operation": "upsert",
        },
    )
    assert draft.status_code == 200

    github = client.app.state.github
    github.main_reference = AsyncMock(
        return_value={"object": {"sha": "main-commit-sha"}}
    )
    github.repository_tree = AsyncMock(return_value=[])
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
        json={
            "custom_head": "add-author",
            "title": "docs: add author topic",
            "description": "Test submission",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["branch"] == "web/author-user/add-author"
    assert client.get("/api/drafts").json()["items"] == []

    call = github.submit.await_args.kwargs
    assert call["author"] == {
        "name": "author-user",
        "email": "web-editor+2@users.noreply.chenyurui.top",
    }
    assert call["expected_parent_sha"] == "main-commit-sha"


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
    github.main_reference = AsyncMock(
        return_value={"object": {"sha": "main-commit-sha"}}
    )
    github.repository_tree = AsyncMock(return_value=[])
    github.submit = AsyncMock(
        return_value=SubmissionResult(
            branch="web/overwrite-user/reusable-head",
            commit_sha="first-commit",
            pr_number=51,
            pr_url="https://github.example/pr/51",
        )
    )

    first_draft = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "knowledge/cpp/overwrite-first.md",
            "content": "# First\n",
            "operation": "upsert",
        },
    )
    assert first_draft.status_code == 200
    first_submit = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json={
            "custom_head": "reusable-head",
            "title": "docs: first submission",
            "description": "",
        },
    )
    assert first_submit.status_code == 200, first_submit.text

    second_draft = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "knowledge/cpp/overwrite-second.md",
            "content": "# Second\n",
            "operation": "upsert",
        },
    )
    assert second_draft.status_code == 200
    conflict = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json={
            "custom_head": "reusable-head",
            "title": "docs: replacement submission",
            "description": "",
        },
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == {
        "code": "branch_conflict",
        "message": "该提交头已经使用，是否覆盖原分支和 Draft PR？",
        "branch": "web/overwrite-user/reusable-head",
        "can_overwrite": True,
    }
    assert github.submit.await_count == 1

    github.branch_exists = AsyncMock(return_value=True)
    github.submit.return_value = SubmissionResult(
        branch="web/overwrite-user/reusable-head",
        commit_sha="replacement-commit",
        pr_number=51,
        pr_url="https://github.example/pr/51",
    )
    overwritten = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json={
            "custom_head": "reusable-head",
            "title": "docs: replacement submission",
            "description": "",
            "overwrite": True,
        },
    )
    assert overwritten.status_code == 200, overwritten.text
    assert overwritten.json()["overwritten"] is True
    assert overwritten.json()["pr_number"] == 51
    assert github.submit.await_args.kwargs["overwrite"] is True
    assert client.get("/api/drafts").json()["items"] == []


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
    draft = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": "knowledge/cpp/remote-conflict.md",
            "content": "# Remote conflict\n",
            "operation": "upsert",
        },
    )
    assert draft.status_code == 200

    github = client.app.state.github
    github.branch_exists = AsyncMock(return_value=True)
    github.submit = AsyncMock()
    conflict = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json={
            "custom_head": "occupied",
            "title": "docs: remote conflict",
            "description": "",
        },
    )
    assert conflict.status_code == 409
    detail = conflict.json()["detail"]
    assert detail["code"] == "branch_conflict"
    assert detail["can_overwrite"] is False
    github.submit.assert_not_awaited()


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
    github.main_reference = AsyncMock(
        return_value={"object": {"sha": "main-commit-sha"}}
    )
    github.repository_tree = AsyncMock(return_value=[])
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
        json={
            "custom_head": "feedback",
            "title": "docs: feedback",
            "description": "",
        },
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
    deleted = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": path,
            "content": "",
            "base_sha": "blob-sha",
            "operation": "delete",
        },
    )
    assert deleted.status_code == 200

    github = client.app.state.github
    github.main_reference = AsyncMock(
        return_value={"object": {"sha": "main-commit-sha"}}
    )
    github.repository_tree = AsyncMock(
        return_value=[{"path": path, "sha": "blob-sha", "type": "blob"}]
    )
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
        json={
            "custom_head": "remove-obsolete",
            "title": "docs: remove obsolete topic",
            "description": "",
        },
    )
    assert response.status_code == 200, response.text
    changes = github.submit.await_args.kwargs["changes"]
    assert changes[0]["path"] == path
    assert changes[0]["operation"] == "delete"


def test_submission_rejects_top_level_module_readme_deletion(
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
    deleted = client.put(
        "/api/drafts",
        headers={"X-CSRF-Token": csrf},
        json={
            "path": path,
            "content": "",
            "base_sha": "module-readme-sha",
            "operation": "delete",
        },
    )
    assert deleted.status_code == 200

    github = client.app.state.github
    github.main_reference = AsyncMock(
        return_value={"object": {"sha": "main-commit-sha"}}
    )
    github.repository_tree = AsyncMock(
        return_value=[
            {
                "path": path,
                "sha": "module-readme-sha",
                "type": "blob",
            }
        ]
    )
    github.submit = AsyncMock()

    response = client.post(
        "/api/submit",
        headers={"X-CSRF-Token": csrf},
        json={
            "custom_head": "remove-module-readme",
            "title": "docs: remove module readme",
            "description": "",
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"] == (
        "不能删除顶级模块 README.md；该文件用于模块发现和导航"
    )
    github.submit.assert_not_awaited()


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
    github.main_reference = AsyncMock(
        return_value={"object": {"sha": "main-commit-sha"}}
    )
    github.repository_tree = AsyncMock(return_value=[])
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
        json={
            "custom_head": "bound-submit",
            "title": "docs: bound submit",
            "description": "",
        },
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
