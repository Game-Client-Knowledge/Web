from __future__ import annotations

import json
from pathlib import Path

from .config import Settings
from .database import Database, utc_now
from .mailer import send_email
from .security import TokenCipher
from .smtp_config import load_smtp_configuration


def deliver_email(
    db_path: Path,
    settings: Settings,
    event_type: str,
    recipients: list[str],
    subject: str,
    body: str,
    *,
    audience: str,
    user_id: int | None = None,
    submission_id: int | None = None,
) -> tuple[str, str | None]:
    db = Database(db_path)
    try:
        smtp = load_smtp_configuration(
            db,
            settings,
            TokenCipher(settings.encryption_key),
        )
        status, error = send_email(
            smtp,
            recipients,
            subject,
            body,
        )
    except RuntimeError as exc:
        status, error = "failed", str(exc)[:500]
    with db.connect() as connection:
        connection.execute(
            """
            INSERT INTO notifications(
                event_type, audience, user_id, submission_id,
                subject, body, recipients, status,
                error_message, created_at
            )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_type,
                audience,
                user_id,
                submission_id,
                subject,
                body,
                json.dumps(recipients, ensure_ascii=False),
                status,
                error,
                utc_now(),
            ),
        )
    return status, error


def deliver_admin_email(
    db_path: Path,
    settings: Settings,
    event_type: str,
    subject: str,
    body: str,
    *,
    submission_id: int | None = None,
) -> tuple[str, str | None]:
    db = Database(db_path)
    with db.connect() as connection:
        recipients = [
            row["email"]
            for row in connection.execute(
                """
                SELECT email FROM users
                WHERE role = 'admin' AND status = 'active'
                ORDER BY id
                """
            ).fetchall()
        ]
    return deliver_email(
        db_path,
        settings,
        event_type,
        recipients,
        subject,
        body,
        audience="admin",
        submission_id=submission_id,
    )
