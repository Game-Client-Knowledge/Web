from __future__ import annotations

import smtplib
from email.message import EmailMessage

from .smtp_config import SmtpConfiguration


def send_email(
    settings: SmtpConfiguration,
    recipients: list[str],
    subject: str,
    body: str,
) -> tuple[str, str | None]:
    if not settings.smtp_enabled:
        return "unconfigured", "SMTP 尚未配置"
    if not recipients:
        return "failed", "没有可用的管理员邮箱"

    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = ", ".join(recipients)
    message["Subject"] = subject
    message.set_content(body)

    try:
        with smtplib.SMTP(
            settings.smtp_host,
            settings.smtp_port,
            timeout=15,
        ) as client:
            if settings.smtp_starttls:
                client.starttls()
            if settings.smtp_username:
                client.login(settings.smtp_username, settings.smtp_password)
            client.send_message(message)
        return "sent", None
    except Exception as exc:
        return "failed", str(exc)[:500]
