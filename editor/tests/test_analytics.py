from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.analytics import (
    analytics_dashboard,
    normalize_content_entries,
    record_visit,
)
from app.database import Database, SCHEMA


def test_analytics_dashboard_aggregates_devices_and_visits(
    tmp_path,
) -> None:
    db = Database(tmp_path / "analytics.db")
    now = datetime(2026, 8, 19, 4, tzinfo=timezone.utc)
    with db.connect() as connection:
        connection.executescript(SCHEMA)
        connection.executemany(
            """
            INSERT INTO content_revisions(
                path, commit_sha, line_count, updated_at
            )
            VALUES(?, ?, ?, ?)
            """,
            [
                ("program/knowledge/a.md", "a" * 40, 10, now.isoformat()),
                ("program/knowledge/b.md", "b" * 40, 20, now.isoformat()),
                ("program/knowledge/c.md", "c" * 40, 30, now.isoformat()),
            ],
        )
        connection.executemany(
            """
            INSERT INTO document_contributors(
                path, contributor_id, contributor_name,
                commit_count, last_contributed_at
            )
            VALUES(?, ?, ?, ?, ?)
            """,
            [
                (
                    "program/knowledge/a.md",
                    "alice",
                    "Alice",
                    2,
                    now.isoformat(),
                ),
                (
                    "program/knowledge/b.md",
                    "alice",
                    "Alice",
                    1,
                    now.isoformat(),
                ),
                (
                    "program/knowledge/b.md",
                    "bob",
                    "Bob",
                    1,
                    now.isoformat(),
                ),
                (
                    "program/knowledge/c.md",
                    "charlie",
                    "Charlie",
                    1,
                    now.isoformat(),
                ),
            ],
        )

    record_visit(
        db,
        "device-a",
        content_entries=[("program/knowledge/a.md", 1, 120)],
        now=now,
    )
    record_visit(
        db,
        "device-a",
        content_entries=[
            ("program/knowledge/a.md", 1, 60),
            ("program/knowledge/b.md", 1, 30),
        ],
        now=now + timedelta(minutes=1),
    )
    record_visit(
        db,
        "device-b",
        content_entries=[("program/knowledge/b.md", 1, 90)],
        now=now + timedelta(minutes=2),
    )
    record_visit(
        db,
        "device-a",
        content_entries=[("program/knowledge/a.md", 1, 45)],
        now=now - timedelta(days=1),
    )
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
    today = dashboard["periods"][0]
    assert today["content_views"] == 4
    assert today["reading_seconds"] == 300
    assert dashboard["files"] == [
        {
            "path": "program/knowledge/a.md",
            "views": 3,
            "reading_seconds": 225,
            "average_seconds": 75,
        },
        {
            "path": "program/knowledge/b.md",
            "views": 2,
            "reading_seconds": 120,
            "average_seconds": 60,
        },
        {
            "path": "program/knowledge/c.md",
            "views": 0,
            "reading_seconds": 0,
            "average_seconds": 0,
        },
    ]
    assert dashboard["contributors"] == [
        {
            "id": "alice",
            "name": "Alice",
            "file_count": 2,
            "views": 5,
            "reading_seconds": 345,
        },
        {
            "id": "bob",
            "name": "Bob",
            "file_count": 1,
            "views": 2,
            "reading_seconds": 120,
        },
        {
            "id": "charlie",
            "name": "Charlie",
            "file_count": 1,
            "views": 0,
            "reading_seconds": 0,
        },
    ]


def test_normalize_content_entries_is_compact_and_bounded() -> None:
    assert normalize_content_entries(
        [
            ["program/knowledge/a.md", 1, 20],
            ["program/knowledge/a.md", 2, 30],
            ["program/README.md", 1, 10],
            ["CONTRIBUTING.md", 1, 15],
            ["../private.md", 1, 100],
            ["program/knowledge/b.md", True, 20],
        ]
    ) == [
        ("program/knowledge/a.md", 3, 50),
        ("program/README.md", 1, 10),
        ("CONTRIBUTING.md", 1, 15),
    ]
    bounded = normalize_content_entries(
        [
            [f"program/knowledge/{index}.md", 32, 20_000]
            for index in range(100)
        ]
    )
    assert len(bounded) == 2
    assert sum(item[1] for item in bounded) == 64
    assert sum(item[2] for item in bounded) == 6 * 60 * 60
