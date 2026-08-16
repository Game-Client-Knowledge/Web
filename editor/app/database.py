from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from .config import Settings
from .security import hash_password, normalize_email, normalize_username


SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    github_id INTEGER UNIQUE,
    github_login TEXT UNIQUE COLLATE NOCASE,
    github_email TEXT,
    github_verified INTEGER NOT NULL DEFAULT 0,
    email_verified INTEGER NOT NULL DEFAULT 0,
    github_token_encrypted TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    auth_provider TEXT NOT NULL CHECK(auth_provider IN ('local', 'github')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'login'
        CHECK(purpose IN ('login', 'bind')),
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    return_to TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    operation TEXT NOT NULL DEFAULT 'upsert' CHECK(operation IN ('upsert', 'delete')),
    content TEXT NOT NULL DEFAULT '',
    base_sha TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, path)
);

CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    auth_provider TEXT NOT NULL,
    branch_name TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    commit_sha TEXT,
    pr_number INTEGER,
    pr_url TEXT,
    status TEXT NOT NULL CHECK(status IN ('creating', 'open', 'failed', 'merged', 'closed')),
    error_message TEXT,
    pr_updated_at TEXT,
    last_synced_at TEXT,
    auto_closed INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT,
    last_urged_at TEXT,
    urge_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'admin',
    user_id INTEGER REFERENCES users(id),
    submission_id INTEGER REFERENCES submissions(id),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    recipients TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('sent', 'failed', 'unconfigured')),
    error_message TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    request_ip TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_application_pending
ON admin_applications(user_id) WHERE status = 'pending';
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self, settings: Settings) -> None:
        with self.connect() as connection:
            connection.executescript(SCHEMA)
            columns = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info(users)"
                ).fetchall()
            }
            if "email_verified" not in columns:
                connection.execute(
                    """
                    ALTER TABLE users
                    ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0
                    """
                )
                connection.execute(
                    """
                    UPDATE users SET email_verified = 1
                    WHERE github_verified = 1 OR role = 'admin'
                    """
                )
            oauth_columns = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info(oauth_states)"
                ).fetchall()
            }
            for statement in [
                (
                    "purpose",
                    """
                    ALTER TABLE oauth_states
                    ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login'
                    """,
                ),
                (
                    "user_id",
                    """
                    ALTER TABLE oauth_states
                    ADD COLUMN user_id INTEGER REFERENCES users(id)
                    """,
                ),
                (
                    "return_to",
                    "ALTER TABLE oauth_states ADD COLUMN return_to TEXT",
                ),
            ]:
                if statement[0] not in oauth_columns:
                    connection.execute(statement[1])
            submission_columns = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info(submissions)"
                ).fetchall()
            }
            for name, statement in [
                (
                    "pr_updated_at",
                    "ALTER TABLE submissions ADD COLUMN pr_updated_at TEXT",
                ),
                (
                    "last_synced_at",
                    "ALTER TABLE submissions ADD COLUMN last_synced_at TEXT",
                ),
                (
                    "auto_closed",
                    """
                    ALTER TABLE submissions
                    ADD COLUMN auto_closed INTEGER NOT NULL DEFAULT 0
                    """,
                ),
                (
                    "closed_at",
                    "ALTER TABLE submissions ADD COLUMN closed_at TEXT",
                ),
                (
                    "last_urged_at",
                    "ALTER TABLE submissions ADD COLUMN last_urged_at TEXT",
                ),
                (
                    "urge_count",
                    """
                    ALTER TABLE submissions
                    ADD COLUMN urge_count INTEGER NOT NULL DEFAULT 0
                    """,
                ),
            ]:
                if name not in submission_columns:
                    connection.execute(statement)
            notification_columns = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info(notifications)"
                ).fetchall()
            }
            for name, statement in [
                (
                    "audience",
                    """
                    ALTER TABLE notifications
                    ADD COLUMN audience TEXT NOT NULL DEFAULT 'admin'
                    """,
                ),
                (
                    "user_id",
                    """
                    ALTER TABLE notifications
                    ADD COLUMN user_id INTEGER REFERENCES users(id)
                    """,
                ),
                (
                    "submission_id",
                    """
                    ALTER TABLE notifications
                    ADD COLUMN submission_id INTEGER REFERENCES submissions(id)
                    """,
                ),
            ]:
                if name not in notification_columns:
                    connection.execute(statement)
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_submissions_status
                ON submissions(status, pr_updated_at)
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_notifications_submission
                ON notifications(submission_id, created_at DESC)
                """
            )
            now = utc_now()
            connection.execute(
                """
                INSERT INTO settings(key, value, updated_at)
                VALUES('edit_policy', ?, ?)
                ON CONFLICT(key) DO NOTHING
                """,
                (settings.default_edit_policy, now),
            )
            connection.execute(
                """
                INSERT INTO settings(key, value, updated_at)
                VALUES('registration_enabled', ?, ?)
                ON CONFLICT(key) DO NOTHING
                """,
                ("1" if settings.registration_enabled else "0", now),
            )
            connection.execute(
                """
                INSERT INTO settings(key, value, updated_at)
                VALUES('pr_auto_close_days', ?, ?)
                ON CONFLICT(key) DO NOTHING
                """,
                (str(settings.pr_auto_close_days), now),
            )

            count = connection.execute(
                "SELECT COUNT(*) AS count FROM users"
            ).fetchone()["count"]
            if count == 0:
                self._bootstrap_admin(connection, settings, now)

    @staticmethod
    def _bootstrap_admin(
        connection: sqlite3.Connection,
        settings: Settings,
        now: str,
    ) -> None:
        if not (
            settings.bootstrap_admin_email
            and settings.bootstrap_admin_username
            and settings.bootstrap_admin_password
        ):
            raise RuntimeError(
                "Bootstrap administrator credentials are required for first startup"
            )

        email = normalize_email(settings.bootstrap_admin_email)
        username = normalize_username(settings.bootstrap_admin_username)
        connection.execute(
            """
            INSERT INTO users(
                email, username, password_hash, email_verified, role,
                must_change_password, created_at, updated_at
            )
            VALUES(?, ?, ?, 1, 'admin', 1, ?, ?)
            """,
            (
                email,
                username,
                hash_password(settings.bootstrap_admin_password),
                now,
                now,
            ),
        )

    def setting(self, key: str, default: str = "") -> str:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)
            ).fetchone()
            return row["value"] if row else default

    def audit(
        self,
        action: str,
        request_ip: str,
        *,
        user_id: int | None = None,
        target: str | None = None,
        detail: str | None = None,
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO audit_log(user_id, action, target, detail, request_ip, created_at)
                VALUES(?, ?, ?, ?, ?, ?)
                """,
                (user_id, action, target, detail, request_ip, utc_now()),
            )
