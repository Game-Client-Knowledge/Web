from __future__ import annotations

import asyncio
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock

from cryptography.fernet import Fernet

from app.config import Settings
from app.database import Database
from app.pr_lifecycle import (
    reconcile_external_pull_requests,
    reconcile_submissions,
    resolve_external_contributor_email,
)
from app.security import hash_password


def make_settings(tmp_path: Path) -> Settings:
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
        bootstrap_admin_email="admin@example.test",
        bootstrap_admin_username="admin",
        bootstrap_admin_password="bootstrap-password",
        encryption_key=Fernet.generate_key().decode("ascii"),
        github_owner="owner",
        github_repository="repository",
        github_client_id="",
        github_client_secret="",
        github_bot_token="bot-token",
        attribution_sync_token="test-sync-token",
        smtp_host="",
        smtp_port=587,
        smtp_username="",
        smtp_password="",
        smtp_from="",
        smtp_starttls=True,
    )


def insert_open_submission(
    db: Database,
    *,
    pr_number: int,
    updated_at: str,
) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with db.connect() as connection:
        cursor = connection.execute(
            """
            INSERT INTO users(
                email, username, password_hash, email_verified,
                role, status, must_change_password, created_at, updated_at
            )
            VALUES(?, ?, ?, 1, 'user', 'active', 0, ?, ?)
            """,
            (
                f"user-{pr_number}@example.test",
                f"user-{pr_number}",
                hash_password("local-password-123"),
                now,
                now,
            ),
        )
        user_id = cursor.lastrowid
        submission = connection.execute(
            """
            INSERT INTO submissions(
                user_id, auth_provider, branch_name, title, description,
                pr_number, pr_url, status, pr_updated_at,
                created_at, updated_at
            )
            VALUES(?, 'local', ?, ?, '', ?, ?, 'open', ?, ?, ?)
            """,
            (
                user_id,
                f"web/user-{pr_number}/topic",
                f"Submission {pr_number}",
                pr_number,
                f"https://github.example/pull/{pr_number}",
                updated_at,
                now,
                now,
            ),
        )
        return int(submission.lastrowid)


def external_pull(
    number: int,
    *,
    state: str = "open",
    merged_at: str | None = None,
    updated_at: str = "2026-08-17T00:00:00Z",
    body: str = "",
    head: str = "feature/external",
) -> dict:
    return {
        "number": number,
        "html_url": f"https://github.example/pull/{number}",
        "title": f"External contribution {number}",
        "body": body,
        "state": state,
        "merged_at": merged_at,
        "draft": False,
        "created_at": "2026-08-17T00:00:00Z",
        "updated_at": updated_at,
        "user": {"login": f"contributor-{number}"},
        "head": {"ref": head},
    }


def test_reconcile_marks_merged_and_notifies_contributor(
    tmp_path: Path,
) -> None:
    settings = make_settings(tmp_path)
    db = Database(settings.db_path)
    db.initialize(settings)
    submission_id = insert_open_submission(
        db,
        pr_number=21,
        updated_at="2026-08-10T00:00:00+00:00",
    )
    github = AsyncMock()
    github.pull_request.return_value = {
        "state": "closed",
        "merged_at": "2026-08-17T01:00:00Z",
        "updated_at": "2026-08-17T01:00:00Z",
    }

    result = asyncio.run(
        reconcile_submissions(
            db,
            settings,
            github,
            now=datetime(2026, 8, 17, 1, 5, tzinfo=timezone.utc),
        )
    )

    assert result["merged"] == 1
    with db.connect() as connection:
        submission = connection.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()
        notification = connection.execute(
            """
            SELECT * FROM notifications
            WHERE submission_id = ?
            """,
            (submission_id,),
        ).fetchone()
    assert submission["status"] == "merged"
    assert notification["event_type"] == "contributor_pr_merged"
    assert notification["audience"] == "contributor"


def test_reconcile_marks_manually_closed_and_notifies_contributor(
    tmp_path: Path,
) -> None:
    settings = make_settings(tmp_path)
    db = Database(settings.db_path)
    db.initialize(settings)
    submission_id = insert_open_submission(
        db,
        pr_number=24,
        updated_at="2026-08-16T00:00:00+00:00",
    )
    github = AsyncMock()
    github.pull_request.return_value = {
        "state": "closed",
        "merged_at": None,
        "updated_at": "2026-08-17T01:00:00Z",
    }

    result = asyncio.run(
        reconcile_submissions(
            db,
            settings,
            github,
            now=datetime(2026, 8, 17, 1, 5, tzinfo=timezone.utc),
        )
    )

    assert result["closed"] == 1
    with db.connect() as connection:
        submission = connection.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()
        notification = connection.execute(
            """
            SELECT * FROM notifications
            WHERE submission_id = ?
            """,
            (submission_id,),
        ).fetchone()
    assert submission["status"] == "closed"
    assert submission["auto_closed"] == 0
    assert notification["event_type"] == "contributor_pr_closed"


def test_reconcile_auto_closes_stale_pull_and_offers_restore(
    tmp_path: Path,
) -> None:
    settings = make_settings(tmp_path)
    db = Database(settings.db_path)
    db.initialize(settings)
    stale_time = datetime(2026, 8, 1, tzinfo=timezone.utc)
    submission_id = insert_open_submission(
        db,
        pr_number=22,
        updated_at=stale_time.isoformat(),
    )
    github = AsyncMock()
    github.pull_request.return_value = {
        "state": "open",
        "merged_at": None,
        "updated_at": stale_time.isoformat(),
    }
    github.update_pull_state.return_value = {
        "state": "closed",
        "updated_at": "2026-08-17T01:00:00Z",
    }

    result = asyncio.run(
        reconcile_submissions(
            db,
            settings,
            github,
            now=datetime(2026, 8, 17, 1, 0, tzinfo=timezone.utc),
        )
    )

    assert result["auto_closed"] == 1
    github.update_pull_state.assert_awaited_once_with(
        22,
        "closed",
        "bot-token",
    )
    with db.connect() as connection:
        submission = connection.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()
        notification = connection.execute(
            """
            SELECT * FROM notifications
            WHERE submission_id = ?
            """,
            (submission_id,),
        ).fetchone()
    assert submission["status"] == "closed"
    assert submission["auto_closed"] == 1
    assert "长期未处理" in notification["subject"]
    assert "恢复该 PR 并催促管理员" in notification["body"]
    assert f"?submission={submission_id}" in notification["body"]


def test_recent_pull_is_not_auto_closed(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    db = Database(settings.db_path)
    db.initialize(settings)
    recent = datetime(2026, 8, 16, tzinfo=timezone.utc)
    submission_id = insert_open_submission(
        db,
        pr_number=23,
        updated_at=recent.isoformat(),
    )
    github = AsyncMock()
    github.pull_request.return_value = {
        "state": "open",
        "merged_at": None,
        "updated_at": recent.isoformat(),
    }

    result = asyncio.run(
        reconcile_submissions(
            db,
            settings,
            github,
            now=recent + timedelta(days=1),
        )
    )

    assert result["auto_closed"] == 0
    github.update_pull_state.assert_not_awaited()
    with db.connect() as connection:
        submission = connection.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()
    assert submission["status"] == "open"
    assert submission["last_synced_at"]


def test_external_pull_is_discovered_and_both_audiences_are_notified(
    tmp_path: Path,
) -> None:
    settings = make_settings(tmp_path)
    db = Database(settings.db_path)
    db.initialize(settings)
    github = AsyncMock()
    github.list_pull_requests.return_value = [external_pull(80)]
    github.public_user.return_value = {
        "login": "contributor-80",
        "email": "external@example.test",
    }

    result = asyncio.run(
        reconcile_external_pull_requests(
            db,
            settings,
            github,
            now=datetime(2026, 8, 17, 1, 0, tzinfo=timezone.utc),
        )
    )

    assert result["external_discovered"] == 1
    assert result["external_checked"] == 1
    with db.connect() as connection:
        external = connection.execute(
            "SELECT * FROM external_pull_requests WHERE pr_number = 80"
        ).fetchone()
        notifications = connection.execute(
            """
            SELECT event_type, audience, recipients
            FROM notifications WHERE external_pr_id = ?
            ORDER BY id
            """,
            (external["id"],),
        ).fetchall()
        token_count = connection.execute(
            """
            SELECT COUNT(*) AS count FROM external_pr_action_tokens
            WHERE external_pr_id = ?
            """,
            (external["id"],),
        ).fetchone()["count"]
    assert external["status"] == "open"
    assert external["contributor_email"] == "external@example.test"
    assert external["email_source"] == "github_profile"
    assert [row["event_type"] for row in notifications] == [
        "external_pr_discovered",
        "external_contributor_pr_received",
    ]
    assert [row["audience"] for row in notifications] == [
        "admin",
        "external_contributor",
    ]
    assert json.loads(notifications[1]["recipients"]) == [
        "external@example.test"
    ]
    assert token_count == 1


def test_web_editor_pull_is_not_registered_as_external(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    db = Database(settings.db_path)
    db.initialize(settings)
    insert_open_submission(
        db,
        pr_number=81,
        updated_at="2026-08-17T00:00:00Z",
    )
    github = AsyncMock()
    github.list_pull_requests.return_value = [
        external_pull(81),
        external_pull(
            82,
            body=(
                "Submitted from Game Client Knowledge Web Editor by user."
            ),
        ),
        external_pull(83, head="web/user/topic"),
    ]

    result = asyncio.run(
        reconcile_external_pull_requests(db, settings, github)
    )

    assert result["external_discovered"] == 0
    with db.connect() as connection:
        count = connection.execute(
            "SELECT COUNT(*) AS count FROM external_pull_requests"
        ).fetchone()["count"]
    assert count == 0


def test_external_email_falls_back_to_matching_commit_author(
    tmp_path: Path,
) -> None:
    settings = make_settings(tmp_path)
    db = Database(settings.db_path)
    db.initialize(settings)
    github = AsyncMock()
    github.public_user.return_value = {"email": None}
    github.pull_request_commits.return_value = [
        {
            "author": {"login": "someone-else"},
            "commit": {"author": {"email": "other@example.test"}},
        },
        {
            "author": {"login": "contributor-84"},
            "commit": {
                "author": {
                    "email": "84+contributor@users.noreply.github.com"
                }
            },
        },
        {
            "author": {"login": "contributor-84"},
            "commit": {"author": {"email": "author@example.test"}},
        },
    ]

    email, source = asyncio.run(
        resolve_external_contributor_email(
            db,
            github,
            external_pull(84),
            "bot-token",
        )
    )

    assert (email, source) == ("author@example.test", "commit_author")


def test_external_pull_merge_and_timeout_follow_lifecycle(
    tmp_path: Path,
) -> None:
    settings = make_settings(tmp_path)
    db = Database(settings.db_path)
    db.initialize(settings)
    github = AsyncMock()
    first_pull = external_pull(85)
    github.list_pull_requests.return_value = [first_pull]
    github.public_user.return_value = {
        "email": "lifecycle@example.test"
    }
    asyncio.run(
        reconcile_external_pull_requests(
            db,
            settings,
            github,
            now=datetime(2026, 8, 17, 1, 0, tzinfo=timezone.utc),
        )
    )

    merged = external_pull(
        85,
        state="closed",
        merged_at="2026-08-17T02:00:00Z",
        updated_at="2026-08-17T02:00:00Z",
    )
    github.list_pull_requests.return_value = [merged]
    merged_result = asyncio.run(
        reconcile_external_pull_requests(
            db,
            settings,
            github,
            now=datetime(2026, 8, 17, 2, 5, tzinfo=timezone.utc),
        )
    )
    assert merged_result["external_merged"] == 1

    stale = external_pull(
        86,
        updated_at="2026-08-01T00:00:00Z",
    )
    github.list_pull_requests.return_value = [stale]
    github.public_user.return_value = {
        "email": "stale@example.test"
    }
    github.update_pull_state.return_value = {
        "state": "closed",
        "updated_at": "2026-08-17T03:00:00Z",
    }
    timeout_result = asyncio.run(
        reconcile_external_pull_requests(
            db,
            settings,
            github,
            now=datetime(2026, 8, 17, 3, 0, tzinfo=timezone.utc),
        )
    )
    assert timeout_result["external_discovered"] == 1
    assert timeout_result["external_auto_closed"] == 1
    github.update_pull_state.assert_awaited_with(86, "closed", "bot-token")
    with db.connect() as connection:
        events = {
            row["event_type"]
            for row in connection.execute(
                """
                SELECT event_type FROM notifications
                WHERE external_pr_id IS NOT NULL
                """
            ).fetchall()
        }
        timed_out = connection.execute(
            "SELECT * FROM external_pull_requests WHERE pr_number = 86"
        ).fetchone()
        token_count = connection.execute(
            """
            SELECT COUNT(*) AS count FROM external_pr_action_tokens
            WHERE external_pr_id = ?
            """,
            (timed_out["id"],),
        ).fetchone()["count"]
    assert "external_contributor_pr_merged" in events
    assert "external_contributor_pr_auto_closed" in events
    assert timed_out["auto_closed"] == 1
    assert token_count == 2


def test_legacy_submission_and_notification_tables_are_migrated(
    tmp_path: Path,
) -> None:
    settings = make_settings(tmp_path)
    connection = sqlite3.connect(settings.db_path)
    connection.executescript(
        """
        CREATE TABLE submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            auth_provider TEXT NOT NULL,
            branch_name TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            commit_sha TEXT,
            pr_number INTEGER,
            pr_url TEXT,
            status TEXT NOT NULL,
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            subject TEXT NOT NULL,
            body TEXT NOT NULL,
            recipients TEXT NOT NULL,
            status TEXT NOT NULL,
            error_message TEXT,
            created_at TEXT NOT NULL
        );
        """
    )
    connection.commit()
    connection.close()

    Database(settings.db_path).initialize(settings)

    connection = sqlite3.connect(settings.db_path)
    submission_columns = {
        row[1]
        for row in connection.execute(
            "PRAGMA table_info(submissions)"
        ).fetchall()
    }
    notification_columns = {
        row[1]
        for row in connection.execute(
            "PRAGMA table_info(notifications)"
        ).fetchall()
    }
    external_tables = {
        row[0]
        for row in connection.execute(
            """
            SELECT name FROM sqlite_master
            WHERE type = 'table'
            """
        ).fetchall()
    }
    connection.close()
    assert {
        "pr_updated_at",
        "last_synced_at",
        "auto_closed",
        "closed_at",
        "last_urged_at",
        "urge_count",
    } <= submission_columns
    assert {
        "audience",
        "user_id",
        "submission_id",
        "external_pr_id",
    } <= notification_columns
    assert {
        "external_pull_requests",
        "external_pr_action_tokens",
    } <= external_tables
