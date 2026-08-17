from __future__ import annotations

from types import SimpleNamespace

from app.site_update_notifications import (
    build_failure_notice,
    failure_fingerprint,
    failure_summary,
    send_failure_notification,
)


def failure_payload() -> dict[str, object]:
    return {
        "mode": "auto",
        "stage": "audit-and-build",
        "exit_code": 1,
        "failed_command": "npm run check",
        "web_commit": "a" * 40,
        "content_commit": "b" * 40,
        "started_at": "2026-08-17T10:00:00Z",
    }


def test_failure_summary_keeps_tail_and_redacts_secrets(tmp_path) -> None:
    log_path = tmp_path / "update.log"
    log_path.write_text(
        "\n".join(
            [
                "installing dependencies",
                "token=secret-value",
                "ERROR interviews/example/README.md: relative link missing",
            ]
        ),
        encoding="utf-8",
    )

    summary = failure_summary(log_path)

    assert "relative link missing" in summary
    assert "secret-value" not in summary
    assert "token=[redacted]" in summary


def test_failure_notice_identifies_commits_stage_and_reason() -> None:
    subject, body = build_failure_notice(
        failure_payload(),
        "ERROR relative link missing",
        admin_url="https://example.test/editor/admin",
    )

    assert "bbbbbbbbbbbb" in subject
    assert "内容审计与站点构建" in body
    assert "a" * 40 in body
    assert "b" * 40 in body
    assert "ERROR relative link missing" in body
    assert "当前线上版本未被替换" in body


def test_failure_fingerprint_ignores_unrelated_log_noise() -> None:
    first = failure_fingerprint(
        failure_payload(),
        "downloaded in 10s\n/tmp/run-a/cache\nERROR relative link missing",
    )
    second = failure_fingerprint(
        failure_payload(),
        "downloaded in 20s\n/tmp/run-b/cache\nERROR relative link missing",
    )

    assert first == second


def test_sent_failure_notification_is_deduplicated(
    tmp_path,
    monkeypatch,
) -> None:
    deliveries = []

    def fake_deliver(*args, **kwargs):
        deliveries.append((args, kwargs))
        return "sent", None

    monkeypatch.setattr(
        "app.site_update_notifications.deliver_admin_email",
        fake_deliver,
    )
    log_path = tmp_path / "update.log"
    log_path.write_text(
        "ERROR interviews/example/README.md: relative link missing\n",
        encoding="utf-8",
    )
    settings = SimpleNamespace(
        base_url="https://example.test/editor",
        db_path=tmp_path / "editor.db",
    )
    dedupe_path = tmp_path / "last-notification.json"

    first = send_failure_notification(
        settings,
        failure_payload(),
        log_path=log_path,
        dedupe_path=dedupe_path,
    )
    second = send_failure_notification(
        settings,
        failure_payload(),
        log_path=log_path,
        dedupe_path=dedupe_path,
    )

    assert first["status"] == "sent"
    assert second["status"] == "duplicate"
    assert len(deliveries) == 1
    assert deliveries[0][0][2] == "site_update_failed"
    assert dedupe_path.exists()


def test_failed_delivery_is_retried(tmp_path, monkeypatch) -> None:
    delivery_count = 0

    def fake_deliver(*args, **kwargs):
        nonlocal delivery_count
        del args, kwargs
        delivery_count += 1
        return "failed", "SMTP unavailable"

    monkeypatch.setattr(
        "app.site_update_notifications.deliver_admin_email",
        fake_deliver,
    )
    log_path = tmp_path / "update.log"
    log_path.write_text("ERROR build failed\n", encoding="utf-8")
    settings = SimpleNamespace(
        base_url="https://example.test/editor",
        db_path=tmp_path / "editor.db",
    )
    dedupe_path = tmp_path / "last-notification.json"

    for _ in range(2):
        result = send_failure_notification(
            settings,
            failure_payload(),
            log_path=log_path,
            dedupe_path=dedupe_path,
        )
        assert result["status"] == "failed"

    assert delivery_count == 2
    assert not dedupe_path.exists()
