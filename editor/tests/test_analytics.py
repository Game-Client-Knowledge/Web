from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.analytics import analytics_dashboard, record_visit
from app.database import Database, SCHEMA


def test_analytics_dashboard_aggregates_devices_and_visits(
    tmp_path,
) -> None:
    db = Database(tmp_path / "analytics.db")
    with db.connect() as connection:
        connection.executescript(SCHEMA)

    now = datetime(2026, 8, 19, 4, tzinfo=timezone.utc)
    record_visit(db, "device-a", now=now)
    record_visit(db, "device-a", now=now + timedelta(minutes=1))
    record_visit(db, "device-b", now=now + timedelta(minutes=2))
    record_visit(db, "device-a", now=now - timedelta(days=1))
    record_visit(db, "device-c", now=now - timedelta(days=8))
    record_visit(db, "device-d", now=now - timedelta(days=31))
    record_visit(db, "device-e", now=now - timedelta(days=400))

    dashboard = analytics_dashboard(db, now=now)
    periods = {
        item["key"]: (item["devices"], item["visits"])
        for item in dashboard["periods"]
    }

    assert periods == {
        "day": (2, 3),
        "week": (2, 4),
        "month": (3, 5),
        "year": (4, 6),
        "all": (5, 7),
    }
    assert dashboard["timezone"] == "Asia/Shanghai"
    assert len(dashboard["daily"]) == 30
    assert dashboard["daily"][-1] == {
        "day": "2026-08-19",
        "devices": 2,
        "visits": 3,
    }
