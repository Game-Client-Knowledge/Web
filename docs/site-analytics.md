# Anonymous Site Analytics

## Metrics

The administration dashboard reports:

- unique anonymous devices (UV);
- page visits (PV);
- today, rolling 7-day, rolling 30-day, rolling 365-day, and all-time totals;
- a daily UV/PV trend for the latest 14 days.

Calendar days use China Standard Time (`UTC+08:00`). Rolling periods include
the current day.

## Device identity

`POST /api/analytics/visit` sets the first-party
`gck_analytics_device` cookie when it is absent or invalid.

The cookie:

- contains a cryptographically random identifier;
- is `HttpOnly` and `SameSite=Lax`;
- is `Secure` in production;
- uses the root `/` path;
- expires after two years.

The database never stores the cookie value. It stores only its SHA-256 hash.
The tracker does not collect IP addresses, user agents, page paths, account
identities, referrers, or document content.

## Storage model

`site_analytics_daily` has one row per local calendar day and anonymous device:

```text
day + device_hash -> visit_count, first_seen_at, last_seen_at
```

Each page load increments the row in one atomic SQLite upsert. Storage growth is
therefore bounded by active devices per day instead of one database row per
page view.

The administrator overview uses `COUNT(DISTINCT device_hash)` for UV and
`SUM(visit_count)` for PV. All period and trend queries share one read
connection.

## Client behavior

`src/assets/js/site-analytics.js` runs on static site pages after the main
configuration is available. It sends one credentialed, keepalive POST per page
load and silently ignores network errors. Tracking never blocks navigation,
rendering, search, reading, or editing.

The editor and administration interfaces do not load this script and are not
included in public-site traffic.

## Verification

- `npm run test:site-analytics` checks endpoint resolution, single-send
  behavior, request credentials, keepalive behavior, and prerender handling.
- `editor/tests/test_analytics.py` checks cross-day UV/PV aggregation.
- `test_anonymous_visit_cookie_and_admin_analytics` checks cookie attributes,
  repeat visits, new devices, dashboard totals, and that raw identifiers are not
  persisted.
