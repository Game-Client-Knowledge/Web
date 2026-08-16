from __future__ import annotations

import asyncio
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock

from cryptography.fernet import Fernet

from app.config import Settings
from app.database import Database
from app.pr_lifecycle import reconcile_submissions
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
    connection.close()
    assert {
        "pr_updated_at",
        "last_synced_at",
        "auto_closed",
        "closed_at",
        "last_urged_at",
        "urge_count",
    } <= submission_columns
    assert {"audience", "user_id", "submission_id"} <= notification_columns
