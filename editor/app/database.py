from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from .config import Settings
from .security import hash_password, normalize_email, normalize_username
from .star_formulas import (
    DEFAULT_STAR_BRIGHTNESS_RULES,
    DEFAULT_STAR_BRIGHTNESS_TIERS,
)


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
    email_notifications_enabled INTEGER NOT NULL DEFAULT 1,
    onboarding_completed_at TEXT,
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
    base_content TEXT,
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

CREATE TABLE IF NOT EXISTS external_pull_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_number INTEGER NOT NULL UNIQUE,
    pr_url TEXT NOT NULL,
    title TEXT NOT NULL,
    github_login TEXT NOT NULL,
    contributor_email TEXT,
    email_source TEXT,
    head_ref TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open', 'merged', 'closed')),
    is_draft INTEGER NOT NULL DEFAULT 0,
    auto_closed INTEGER NOT NULL DEFAULT 0,
    github_created_at TEXT NOT NULL,
    pr_updated_at TEXT NOT NULL,
    last_synced_at TEXT,
    closed_at TEXT,
    last_urged_at TEXT,
    urge_count INTEGER NOT NULL DEFAULT 0,
    thank_you_attempted_at TEXT,
    thank_you_sent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_pr_action_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_pr_id INTEGER NOT NULL
        REFERENCES external_pull_requests(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    action TEXT NOT NULL CHECK(action IN ('urge')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
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
    external_pr_id INTEGER REFERENCES external_pull_requests(id),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    recipients TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('sent', 'failed', 'unconfigured')),
    error_message TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_revisions (
    path TEXT PRIMARY KEY,
    commit_sha TEXT NOT NULL,
    line_count INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS line_authors (
    path TEXT NOT NULL REFERENCES content_revisions(path) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_email TEXT NOT NULL,
    github_login TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY(path, line_number)
);

CREATE TABLE IF NOT EXISTS document_contributors (
    path TEXT NOT NULL REFERENCES content_revisions(path) ON DELETE CASCADE,
    contributor_id TEXT NOT NULL,
    contributor_name TEXT NOT NULL,
    commit_count INTEGER NOT NULL DEFAULT 1,
    last_contributed_at TEXT NOT NULL,
    PRIMARY KEY(path, contributor_id)
);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    revision_sha TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    start_column INTEGER NOT NULL DEFAULT 0,
    end_column INTEGER NOT NULL DEFAULT 0,
    quote TEXT NOT NULL,
    render_segments TEXT NOT NULL DEFAULT '[]',
    author_id INTEGER NOT NULL REFERENCES users(id),
    parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    reply_to_id INTEGER REFERENCES comments(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'deleted')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_analytics_daily (
    day TEXT NOT NULL,
    device_hash TEXT NOT NULL,
    visit_count INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY(day, device_hash)
);

CREATE TABLE IF NOT EXISTS comment_mentions (
    comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY(comment_id, user_id)
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
CREATE INDEX IF NOT EXISTS idx_external_pr_status
ON external_pull_requests(status, pr_updated_at);
CREATE INDEX IF NOT EXISTS idx_external_pr_tokens_expiry
ON external_pr_action_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_line_authors_user ON line_authors(user_id);
CREATE INDEX IF NOT EXISTS idx_document_contributors_id
ON document_contributors(contributor_id, path);
CREATE INDEX IF NOT EXISTS idx_comments_path
ON comments(path, start_line, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_site_analytics_day
ON site_analytics_daily(day);
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
            if "onboarding_completed_at" not in columns:
                connection.execute(
                    "ALTER TABLE users ADD COLUMN onboarding_completed_at TEXT"
                )
            if "email_notifications_enabled" not in columns:
                connection.execute(
                    """
                    ALTER TABLE users
                    ADD COLUMN email_notifications_enabled
                    INTEGER NOT NULL DEFAULT 1
                    """
                )
            draft_columns = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info(drafts)"
                ).fetchall()
            }
            if "base_content" not in draft_columns:
                connection.execute(
                    "ALTER TABLE drafts ADD COLUMN base_content TEXT"
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
            external_columns = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info(external_pull_requests)"
                ).fetchall()
            }
            if "thank_you_attempted_at" not in external_columns:
                connection.execute(
                    """
                    ALTER TABLE external_pull_requests
                    ADD COLUMN thank_you_attempted_at TEXT
                    """
                )
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
                (
                    "external_pr_id",
                    """
                    ALTER TABLE notifications
                    ADD COLUMN external_pr_id
                    INTEGER REFERENCES external_pull_requests(id)
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
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_notifications_external_pr
                ON notifications(external_pr_id, created_at DESC)
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
            connection.execute(
                """
                INSERT INTO settings(key, value, updated_at)
                VALUES('reader_edit_mode', 'new', ?)
                ON CONFLICT(key) DO NOTHING
                """,
                (now,),
            )
            connection.execute(
                """
                INSERT INTO settings(key, value, updated_at)
                VALUES('reader_diff_enabled', '1', ?)
                ON CONFLICT(key) DO NOTHING
                """,
                (now,),
            )
            connection.execute(
                """
                INSERT INTO settings(key, value, updated_at)
                VALUES('workspace_sync_interval_seconds', '60', ?)
                ON CONFLICT(key) DO NOTHING
                """,
                (now,),
            )
            connection.execute(
                """
                INSERT INTO settings(key, value, updated_at)
                VALUES('site_auto_update_interval_minutes', '10', ?)
                ON CONFLICT(key) DO NOTHING
                """,
                (now,),
            )
            intro_duration_row = connection.execute(
                """
                SELECT value FROM settings
                WHERE key = 'home_intro_duration_ms'
                """
            ).fetchone()
            try:
                intro_duration_ms = int(
                    intro_duration_row["value"]
                    if intro_duration_row
                    else "3000"
                )
            except (TypeError, ValueError):
                intro_duration_ms = 3000
            for key, value in {
                "catalog_background_style": "circuit",
                "reader_background_style": "blueprint",
                "pointer_effect_enabled": "1",
                "home_intro_enabled": "1",
                "home_intro_duration_ms": "3000",
                "home_intro_assembly_duration_ms": str(
                    round(intro_duration_ms * 0.56)
                ),
                "home_intro_hold_duration_ms": str(
                    round(intro_duration_ms * 0.21)
                ),
                "home_intro_lock_scroll": "1",
                "home_intro_contributor_limit": "8",
                "home_background_style": "old_star_map",
                "home_content_mask_enabled": "0",
                "home_content_idle_timeout_seconds": "30",
                "home_star_scope": "hero",
                "home_star_relation_visibility": "near",
                "home_star_strong_relation_style": "solid",
                "home_star_reference_relation_style": "dashed",
                "home_star_contributor_relation_style": "solid",
                "home_star_brightness_variation_enabled": "0",
                "home_star_brightness_min": "0",
                "home_star_brightness_initial": "10",
                "home_star_brightness_max": "100",
                "home_star_brightness_variation_amount": "2",
                "home_star_brightness_transition_ms": "900",
                "home_star_brightness_interval_ms": "2400",
                "home_star_color_random_enabled": "0",
                "home_star_graph_direction": "directed",
                "home_star_illumination_rule": "bfs",
                "home_star_illumination_depth": "3",
                "home_star_selection_duration_ms": "3000",
                "home_star_label_duration_ms": "3000",
                "home_star_selected_radius_boost": "1",
                "home_star_selected_alpha_boost": "0.16",
                "home_star_selected_halo_alpha_boost": "0.18",
                "home_star_selected_glow_scale": "1.25",
                "home_star_selected_contributor_line_width": "1.4",
                "home_star_active_edge_mode": "single_path",
                "home_star_brightness_rules": json.dumps(
                    DEFAULT_STAR_BRIGHTNESS_RULES,
                    ensure_ascii=False,
                ),
                "home_star_brightness_tiers": json.dumps(
                    DEFAULT_STAR_BRIGHTNESS_TIERS,
                    ensure_ascii=False,
                ),
            }.items():
                connection.execute(
                    """
                    INSERT INTO settings(key, value, updated_at)
                    VALUES(?, ?, ?)
                    ON CONFLICT(key) DO NOTHING
                    """,
                    (key, value, now),
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
