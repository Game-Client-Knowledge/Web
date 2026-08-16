from __future__ import annotations

import smtplib

from app.mailer import send_email
from app.smtp_config import SmtpConfiguration


class FakeSmtp:
    instance = None
    authentication_error = False

    def __init__(self, host: str, port: int, timeout: int) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout
        self.user = ""
        self.password = ""
        self.auth_calls = []
        self.login_calls = []
        self.starttls_called = False
        self.message = None
        type(self).instance = self

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        del exc_type, exc, traceback

    def starttls(self) -> None:
        self.starttls_called = True

    def auth(
        self,
        mechanism,
        authobject,
        *,
        initial_response_ok,
    ):
        self.auth_calls.append(
            (mechanism, authobject, initial_response_ok)
        )
        if self.authentication_error:
            raise smtplib.SMTPAuthenticationError(
                535,
                b"Login fail",
            )
        return 235, b"Authentication successful"

    def auth_login(self, challenge=None):
        del challenge
        return ""

    def login(self, username: str, password: str):
        self.login_calls.append((username, password))
        return 235, b"Authentication successful"

    def send_message(self, message) -> None:
        self.message = message


def smtp_configuration(provider: str) -> SmtpConfiguration:
    return SmtpConfiguration(
        enabled=True,
        provider=provider,
        smtp_host="smtp.example.test",
        smtp_port=587,
        smtp_username="sender@example.test",
        smtp_password="authorization-code",
        smtp_from="sender@example.test",
        smtp_starttls=True,
        source="database",
    )


def test_qq_mail_forces_auth_login(monkeypatch) -> None:
    monkeypatch.setattr("app.mailer.smtplib.SMTP", FakeSmtp)
    status, error = send_email(
        smtp_configuration("qq"),
        ["admin@example.test"],
        "Test",
        "Body",
    )

    client = FakeSmtp.instance
    assert (status, error) == ("sent", None)
    assert client.starttls_called is True
    assert len(client.auth_calls) == 1
    assert client.auth_calls[0][0] == "LOGIN"
    assert client.auth_calls[0][2] is False
    assert client.login_calls == []
    assert client.message["To"] == "admin@example.test"


def test_other_providers_keep_default_login(monkeypatch) -> None:
    monkeypatch.setattr("app.mailer.smtplib.SMTP", FakeSmtp)
    status, error = send_email(
        smtp_configuration("gmail"),
        ["admin@example.test"],
        "Test",
        "Body",
    )

    client = FakeSmtp.instance
    assert (status, error) == ("sent", None)
    assert client.auth_calls == []
    assert client.login_calls == [
        ("sender@example.test", "authorization-code")
    ]


def test_authentication_failure_is_actionable(monkeypatch) -> None:
    class RejectingSmtp(FakeSmtp):
        authentication_error = True

    monkeypatch.setattr("app.mailer.smtplib.SMTP", RejectingSmtp)
    status, error = send_email(
        smtp_configuration("qq"),
        ["admin@example.test"],
        "Test",
        "Body",
    )

    assert status == "failed"
    assert "SMTP 认证失败" in error
    assert "授权码" in error
