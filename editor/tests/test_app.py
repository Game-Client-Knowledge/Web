from __future__ import annotations

import sqlite3
from dataclasses import replace
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
    with TestClient(app, base_url="http://testserver") as test_client:
        yield test_client


@pytest.fixture()
def oauth_client(tmp_path: Path) -> TestClient:
    app = create_app(make_settings(tmp_path, oauth=True))
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
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["edit_policy"] == "github_verified"


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
