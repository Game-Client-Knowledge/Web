from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    db_path: Path
    base_url: str
    cookie_secure: bool
    cookie_path: str
    session_hours: int
    registration_enabled: bool
    default_edit_policy: str
    pr_auto_close_days: int
    pr_sync_interval_seconds: int
    bootstrap_admin_email: str
    bootstrap_admin_username: str
    bootstrap_admin_password: str
    encryption_key: str
    github_owner: str
    github_repository: str
    github_client_id: str
    github_client_secret: str
    github_bot_token: str
    attribution_sync_token: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_from: str
    smtp_starttls: bool

    @classmethod
    def from_env(cls) -> "Settings":
        policy = os.getenv("EDITOR_EDIT_POLICY", "github_verified").strip()
        if policy not in {"local_authenticated", "github_verified"}:
            raise RuntimeError(
                "EDITOR_EDIT_POLICY must be local_authenticated or github_verified"
            )

        return cls(
            db_path=Path(
                os.getenv(
                    "EDITOR_DB_PATH",
                    "/var/lib/game-client-knowledge-editor/editor.db",
                )
            ),
            base_url=os.getenv(
                "EDITOR_BASE_URL",
                "https://knowledge.chenyurui.top/editor",
            ).rstrip("/"),
            cookie_secure=env_bool("EDITOR_COOKIE_SECURE", True),
            cookie_path=os.getenv("EDITOR_COOKIE_PATH", "/editor"),
            session_hours=max(1, int(os.getenv("EDITOR_SESSION_HOURS", "24"))),
            registration_enabled=env_bool("EDITOR_REGISTRATION_ENABLED", True),
            default_edit_policy=policy,
            pr_auto_close_days=max(
                0,
                int(os.getenv("EDITOR_PR_AUTO_CLOSE_DAYS", "7")),
            ),
            pr_sync_interval_seconds=max(
                60,
                int(os.getenv("EDITOR_PR_SYNC_INTERVAL_SECONDS", "900")),
            ),
            bootstrap_admin_email=os.getenv(
                "EDITOR_BOOTSTRAP_ADMIN_EMAIL", ""
            ).strip().lower(),
            bootstrap_admin_username=os.getenv(
                "EDITOR_BOOTSTRAP_ADMIN_USERNAME", ""
            ).strip(),
            bootstrap_admin_password=os.getenv(
                "EDITOR_BOOTSTRAP_ADMIN_PASSWORD", ""
            ),
            encryption_key=os.getenv("EDITOR_ENCRYPTION_KEY", "").strip(),
            github_owner=os.getenv(
                "EDITOR_GITHUB_OWNER", "Game-Client-Knowledge"
            ).strip(),
            github_repository=os.getenv(
                "EDITOR_GITHUB_REPOSITORY", "Game-Client-Knowledge"
            ).strip(),
            github_client_id=os.getenv("EDITOR_GITHUB_CLIENT_ID", "").strip(),
            github_client_secret=os.getenv(
                "EDITOR_GITHUB_CLIENT_SECRET", ""
            ).strip(),
            github_bot_token=os.getenv("EDITOR_GITHUB_BOT_TOKEN", "").strip(),
            attribution_sync_token=os.getenv(
                "EDITOR_ATTRIBUTION_SYNC_TOKEN", ""
            ).strip(),
            smtp_host=os.getenv("EDITOR_SMTP_HOST", "").strip(),
            smtp_port=int(os.getenv("EDITOR_SMTP_PORT", "587")),
            smtp_username=os.getenv("EDITOR_SMTP_USERNAME", "").strip(),
            smtp_password=os.getenv("EDITOR_SMTP_PASSWORD", ""),
            smtp_from=os.getenv("EDITOR_SMTP_FROM", "").strip(),
            smtp_starttls=env_bool("EDITOR_SMTP_STARTTLS", True),
        )

    @property
    def github_oauth_enabled(self) -> bool:
        return bool(
            self.github_client_id
            and self.github_client_secret
            and self.encryption_key
        )

    @property
    def github_submission_enabled(self) -> bool:
        return bool(self.github_bot_token)

    @property
    def smtp_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_from)

    @property
    def github_repo(self) -> str:
        return f"{self.github_owner}/{self.github_repository}"
