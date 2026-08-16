from __future__ import annotations

from dataclasses import dataclass

from .config import Settings
from .database import Database, utc_now
from .security import TokenCipher

SMTP_TEMPLATES = [
    {
        "id": "qq",
        "label": "QQ 邮箱",
        "host": "smtp.qq.com",
        "port": 587,
        "starttls": True,
    },
    {
        "id": "gmail",
        "label": "Gmail / Google Workspace",
        "host": "smtp.gmail.com",
        "port": 587,
        "starttls": True,
    },
    {
        "id": "outlook",
        "label": "Outlook / Microsoft 365",
        "host": "smtp.office365.com",
        "port": 587,
        "starttls": True,
    },
    {
        "id": "custom",
        "label": "自定义 SMTP",
        "host": "",
        "port": 587,
        "starttls": True,
    },
]
SMTP_TEMPLATE_IDS = {item["id"] for item in SMTP_TEMPLATES}


@dataclass(frozen=True)
class SmtpConfiguration:
    enabled: bool
    provider: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_from: str
    smtp_starttls: bool
    source: str

    @property
    def smtp_enabled(self) -> bool:
        return bool(
            self.enabled
            and self.smtp_host
            and self.smtp_from
            and (not self.smtp_username or self.smtp_password)
        )


def environment_smtp(settings: Settings) -> SmtpConfiguration:
    return SmtpConfiguration(
        enabled=settings.smtp_enabled,
        provider="custom",
        smtp_host=settings.smtp_host,
        smtp_port=settings.smtp_port,
        smtp_username=settings.smtp_username,
        smtp_password=settings.smtp_password,
        smtp_from=settings.smtp_from,
        smtp_starttls=settings.smtp_starttls,
        source="environment" if settings.smtp_enabled else "unconfigured",
    )


def load_smtp_configuration(
    db: Database,
    settings: Settings,
    cipher: TokenCipher,
) -> SmtpConfiguration:
    fallback = environment_smtp(settings)
    with db.connect() as connection:
        values = {
            row["key"]: row["value"]
            for row in connection.execute(
                """
                SELECT key, value FROM settings
                WHERE key LIKE 'smtp_%'
                """
            ).fetchall()
        }
    if "smtp_enabled" not in values:
        return fallback

    encrypted_password = values.get("smtp_password_encrypted", "")
    password = (
        cipher.decrypt(encrypted_password)
        if encrypted_password
        else fallback.smtp_password
    )
    try:
        port = int(values.get("smtp_port", fallback.smtp_port))
    except (TypeError, ValueError):
        port = fallback.smtp_port

    provider = values.get("smtp_provider", fallback.provider)
    if provider not in SMTP_TEMPLATE_IDS:
        provider = "custom"
    return SmtpConfiguration(
        enabled=values.get("smtp_enabled") == "1",
        provider=provider,
        smtp_host=values.get("smtp_host", fallback.smtp_host),
        smtp_port=port,
        smtp_username=values.get(
            "smtp_username",
            fallback.smtp_username,
        ),
        smtp_password=password,
        smtp_from=values.get("smtp_from", fallback.smtp_from),
        smtp_starttls=(
            values.get(
                "smtp_starttls",
                "1" if fallback.smtp_starttls else "0",
            )
            == "1"
        ),
        source="database",
    )


def smtp_public_payload(configuration: SmtpConfiguration) -> dict[str, object]:
    return {
        "enabled": configuration.enabled,
        "configured": configuration.smtp_enabled,
        "provider": configuration.provider,
        "host": configuration.smtp_host,
        "port": configuration.smtp_port,
        "username": configuration.smtp_username,
        "from_address": configuration.smtp_from,
        "starttls": configuration.smtp_starttls,
        "password_set": bool(configuration.smtp_password),
        "source": configuration.source,
    }


def save_smtp_configuration(
    db: Database,
    cipher: TokenCipher,
    *,
    admin_id: int,
    enabled: bool,
    provider: str,
    host: str,
    port: int,
    username: str,
    password: str,
    from_address: str,
    starttls: bool,
) -> None:
    values = {
        "smtp_enabled": "1" if enabled else "0",
        "smtp_provider": provider,
        "smtp_host": host,
        "smtp_port": str(port),
        "smtp_username": username,
        "smtp_from": from_address,
        "smtp_starttls": "1" if starttls else "0",
    }
    if password:
        values["smtp_password_encrypted"] = cipher.encrypt(password)

    now = utc_now()
    with db.connect() as connection:
        for key, value in values.items():
            connection.execute(
                """
                INSERT INTO settings(key, value, updated_by, updated_at)
                VALUES(?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_by = excluded.updated_by,
                    updated_at = excluded.updated_at
                """,
                (key, value, admin_id, now),
            )
