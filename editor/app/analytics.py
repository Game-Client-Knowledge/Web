from __future__ import annotations

import hashlib
import re
import secrets
import sqlite3
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from typing import Any

from .database import Database
from .security import validate_content_path


DEVICE_COOKIE = "gck_analytics_device"
DEVICE_COOKIE_MAX_AGE = 2 * 365 * 24 * 60 * 60
CHINA_TIMEZONE = timezone(timedelta(hours=8))
DEVICE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
MAX_CONTENT_ENTRIES = 64
MAX_CONTENT_VIEWS_PER_REQUEST = 64
MAX_READING_SECONDS_PER_REQUEST = 6 * 60 * 60
ANALYTICS_ROOT_FILES = {
    "CONTRIBUTING.md",
    "planning/README.md",
    "program/README.md",
}

PERIODS = (
    ("day", "今日", 1),
    ("week", "近 7 天", 7),
    ("month", "近 30 天", 30),
    ("year", "近 365 天", 365),
    ("all", "累计", None),
)


def new_device_token() -> str:
    return secrets.token_urlsafe(32)


def valid_device_token(value: str | None) -> bool:
    return bool(value and DEVICE_TOKEN_PATTERN.fullmatch(value))


def device_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def local_day(now: datetime | None = None) -> str:
    instant = now or datetime.now(timezone.utc)
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=timezone.utc)
    return instant.astimezone(CHINA_TIMEZONE).date().isoformat()


def normalize_content_entries(value: Any) -> list[tuple[str, int, int]]:
    if not isinstance(value, list):
        return []
    merged: dict[str, list[int]] = {}
    remaining_views = MAX_CONTENT_VIEWS_PER_REQUEST
    remaining_seconds = MAX_READING_SECONDS_PER_REQUEST
    for item in value[:MAX_CONTENT_ENTRIES]:
        if remaining_views <= 0:
            break
        if (
            not isinstance(item, list)
            or len(item) != 3
            or isinstance(item[1], bool)
            or isinstance(item[2], bool)
        ):
            continue
        try:
            raw_path = str(item[0]).strip().replace("\\", "/")
            path = (
                raw_path
                if raw_path in ANALYTICS_ROOT_FILES
                else validate_content_path(raw_path)
            )
            views = max(0, min(32, int(item[1])))
            seconds = max(0, min(remaining_seconds, int(item[2])))
        except (TypeError, ValueError):
            continue
        views = min(views, remaining_views)
        if not views:
            continue
        current = merged.setdefault(path, [0, 0])
        current[0] += views
        current[1] += seconds
        remaining_views -= views
        remaining_seconds -= seconds
    return [
        (path, totals[0], totals[1])
        for path, totals in merged.items()
    ]


def normalize_star_map_seconds(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return max(
            0,
            min(MAX_READING_SECONDS_PER_REQUEST, int(value)),
        )
    except (TypeError, ValueError):
        return 0


def record_visit(
    db: Database,
    anonymous_device_hash: str,
    *,
    content_entries: Iterable[tuple[str, int, int]] = (),
    star_map_seconds: int = 0,
    now: datetime | None = None,
) -> None:
    instant = now or datetime.now(timezone.utc)
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=timezone.utc)
    timestamp = instant.astimezone(timezone.utc).isoformat()
    day = local_day(instant)
    with db.connect() as connection:
        connection.execute(
            """
            INSERT INTO site_analytics_daily(
                day, device_hash, visit_count, star_map_seconds,
                first_seen_at, last_seen_at
            )
            VALUES(?, ?, 1, ?, ?, ?)
            ON CONFLICT(day, device_hash) DO UPDATE SET
                visit_count = visit_count + 1,
                star_map_seconds = (
                    star_map_seconds + excluded.star_map_seconds
                ),
                last_seen_at = excluded.last_seen_at
            """,
            (
                day,
                anonymous_device_hash,
                star_map_seconds,
                timestamp,
                timestamp,
            ),
        )
        for path, views, reading_seconds in content_entries:
            connection.execute(
                """
                INSERT INTO content_analytics_daily(
                    day, path, view_count, reading_seconds,
                    first_seen_at, last_seen_at
                )
                VALUES(?, ?, ?, ?, ?, ?)
                ON CONFLICT(day, path) DO UPDATE SET
                    view_count = view_count + excluded.view_count,
                    reading_seconds = (
                        reading_seconds + excluded.reading_seconds
                    ),
                    last_seen_at = excluded.last_seen_at
                """,
                (
                    day,
                    path,
                    views,
                    reading_seconds,
                    timestamp,
                    timestamp,
                ),
            )


def _period_metrics(
    connection: sqlite3.Connection,
    start_day: str | None,
    end_day: str,
) -> dict[str, int]:
    if start_day is None:
        row = connection.execute(
            """
            SELECT
                COUNT(DISTINCT device_hash) AS devices,
                COALESCE(SUM(visit_count), 0) AS visits,
                COALESCE(SUM(star_map_seconds), 0) AS star_map_seconds
            FROM site_analytics_daily
            """
        ).fetchone()
    else:
        row = connection.execute(
            """
            SELECT
                COUNT(DISTINCT device_hash) AS devices,
                COALESCE(SUM(visit_count), 0) AS visits,
                COALESCE(SUM(star_map_seconds), 0) AS star_map_seconds
            FROM site_analytics_daily
            WHERE day BETWEEN ? AND ?
            """,
            (start_day, end_day),
        ).fetchone()
    return {
        "devices": int(row["devices"] or 0),
        "visits": int(row["visits"] or 0),
        "star_map_seconds": int(row["star_map_seconds"] or 0),
    }


def _period_content_metrics(
    connection: sqlite3.Connection,
    start_day: str | None,
    end_day: str,
) -> dict[str, int]:
    query = """
        SELECT
            COALESCE(SUM(view_count), 0) AS content_views,
            COALESCE(SUM(reading_seconds), 0) AS reading_seconds
        FROM content_analytics_daily
    """
    if start_day is None:
        row = connection.execute(query).fetchone()
    else:
        row = connection.execute(
            query + " WHERE day BETWEEN ? AND ?",
            (start_day, end_day),
        ).fetchone()
    return {
        "content_views": int(row["content_views"] or 0),
        "reading_seconds": int(row["reading_seconds"] or 0),
    }


def analytics_dashboard(
    db: Database,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    instant = now or datetime.now(timezone.utc)
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=timezone.utc)
    local_date = instant.astimezone(CHINA_TIMEZONE).date()
    end_day = local_date.isoformat()
    periods = []
    trend_start = local_date - timedelta(days=29)
    with db.connect() as connection:
        for key, title, days in PERIODS:
            start_day = (
                (local_date - timedelta(days=days - 1)).isoformat()
                if days is not None
                else None
            )
            periods.append(
                {
                    "key": key,
                    "title": title,
                    "start_day": start_day,
                    "end_day": end_day,
                    **_period_metrics(
                        connection,
                        start_day,
                        end_day,
                    ),
                    **_period_content_metrics(
                        connection,
                        start_day,
                        end_day,
                    ),
                }
            )
        rows = connection.execute(
            """
            SELECT
                day,
                COUNT(*) AS devices,
                COALESCE(SUM(visit_count), 0) AS visits
            FROM site_analytics_daily
            WHERE day BETWEEN ? AND ?
            GROUP BY day
            ORDER BY day
            """,
            (trend_start.isoformat(), end_day),
        ).fetchall()
        content_rows = connection.execute(
            """
            WITH paths AS (
                SELECT path FROM content_revisions
                UNION
                SELECT path FROM content_analytics_daily
            )
            SELECT
                paths.path,
                COALESCE(SUM(ca.view_count), 0) AS views,
                COALESCE(SUM(ca.reading_seconds), 0) AS reading_seconds
            FROM paths
            LEFT JOIN content_analytics_daily ca
                ON ca.path = paths.path
            GROUP BY paths.path
            ORDER BY views DESC, reading_seconds DESC, paths.path
            """
        ).fetchall()
        contributor_rows = connection.execute(
            """
            WITH paths AS (
                SELECT path FROM content_revisions
                UNION
                SELECT path FROM content_analytics_daily
            ),
            file_totals AS (
                SELECT
                    paths.path,
                    COALESCE(SUM(ca.view_count), 0) AS views,
                    COALESCE(
                        SUM(ca.reading_seconds),
                        0
                    ) AS reading_seconds
                FROM paths
                LEFT JOIN content_analytics_daily ca
                    ON ca.path = paths.path
                GROUP BY paths.path
            )
            SELECT
                dc.contributor_id,
                MAX(dc.contributor_name) AS contributor_name,
                COUNT(DISTINCT dc.path) AS file_count,
                COALESCE(SUM(file_totals.views), 0) AS views,
                COALESCE(
                    SUM(file_totals.reading_seconds),
                    0
                ) AS reading_seconds
            FROM document_contributors dc
            JOIN file_totals ON file_totals.path = dc.path
            GROUP BY dc.contributor_id
            ORDER BY
                views DESC,
                reading_seconds DESC,
                contributor_name COLLATE NOCASE
            """
        ).fetchall()
    by_day = {
        row["day"]: {
            "devices": int(row["devices"] or 0),
            "visits": int(row["visits"] or 0),
        }
        for row in rows
    }
    daily = []
    for offset in range(30):
        day = (trend_start + timedelta(days=offset)).isoformat()
        daily.append(
            {
                "day": day,
                **by_day.get(day, {"devices": 0, "visits": 0}),
            }
        )
    files = [
        {
            "path": row["path"],
            "views": int(row["views"] or 0),
            "reading_seconds": int(row["reading_seconds"] or 0),
            "average_seconds": round(
                int(row["reading_seconds"] or 0) /
                max(1, int(row["views"] or 0))
            ),
        }
        for row in content_rows
    ]
    contributors = [
        {
            "id": row["contributor_id"],
            "name": row["contributor_name"],
            "file_count": int(row["file_count"] or 0),
            "views": int(row["views"] or 0),
            "reading_seconds": int(row["reading_seconds"] or 0),
        }
        for row in contributor_rows
    ]

    return {
        "timezone": "Asia/Shanghai",
        "generated_at": instant.astimezone(timezone.utc).isoformat(),
        "periods": periods,
        "daily": daily,
        "files": files,
        "contributors": contributors,
    }
