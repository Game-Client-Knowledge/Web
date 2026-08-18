from __future__ import annotations

import hashlib
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

from .database import Database


DEVICE_COOKIE = "gck_analytics_device"
DEVICE_COOKIE_MAX_AGE = 2 * 365 * 24 * 60 * 60
CHINA_TIMEZONE = timezone(timedelta(hours=8))
DEVICE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{32,128}$")

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


def record_visit(
    db: Database,
    anonymous_device_hash: str,
    *,
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
                day, device_hash, visit_count, first_seen_at, last_seen_at
            )
            VALUES(?, ?, 1, ?, ?)
            ON CONFLICT(day, device_hash) DO UPDATE SET
                visit_count = visit_count + 1,
                last_seen_at = excluded.last_seen_at
            """,
            (
                day,
                anonymous_device_hash,
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
                COALESCE(SUM(visit_count), 0) AS visits
            FROM site_analytics_daily
            """
        ).fetchone()
    else:
        row = connection.execute(
            """
            SELECT
                COUNT(DISTINCT device_hash) AS devices,
                COALESCE(SUM(visit_count), 0) AS visits
            FROM site_analytics_daily
            WHERE day BETWEEN ? AND ?
            """,
            (start_day, end_day),
        ).fetchone()
    return {
        "devices": int(row["devices"] or 0),
        "visits": int(row["visits"] or 0),
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

    return {
        "timezone": "Asia/Shanghai",
        "generated_at": instant.astimezone(timezone.utc).isoformat(),
        "periods": periods,
        "daily": daily,
    }
