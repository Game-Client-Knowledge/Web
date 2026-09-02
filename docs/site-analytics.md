# Anonymous Site Analytics

## Metrics

The administration dashboard reports:

- unique anonymous devices (UV);
- page visits (PV);
- per-file view counts, total reading time, and average reading time;
- contributor view and reading-time totals derived from files they contributed;
- full-screen contribution-star-map viewing time;
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
The tracker does not collect IP addresses, user agents, account identities,
referrers, or document content. It sends only repository-relative paths for
published files, view counts, and whole active-reading seconds.

## Storage model

`site_analytics_daily` has one row per local calendar day and anonymous device:

```text
day + device_hash -> visit_count, star_map_seconds, first_seen_at, last_seen_at
```

Each completed page session increments the row in one atomic SQLite upsert.
Storage growth is therefore bounded by active devices per day instead of one
database row per page view.

`content_analytics_daily` has one row per local day and published file:

```text
day + path -> view_count, reading_seconds, first_seen_at, last_seen_at
```

This table deliberately does not contain a device hash. File engagement is
anonymous aggregate data, and its storage growth is bounded by the number of
files viewed each day rather than the number of individual views.

The administrator overview uses `COUNT(DISTINCT device_hash)` for UV and
`SUM(visit_count)` for PV. Full-screen star-map time is summed from the same
daily device row. File totals use the aggregate content table.
Contributor totals are calculated at query time by joining file totals to
`document_contributors`; the browser never sends contributor identities. A
view of a shared file counts once for each contributor currently associated
with that file.

The public contribution-graph payload includes only aggregate per-file views
and reading seconds. The star map maps these totals to document/code-system
stars and attributes each distinct file to its contributors. Device hashes and
daily device rows are never exposed.

## Client behavior

`src/assets/js/site-analytics.js` runs on static site pages after the main
configuration is available. It accumulates visible-page time in memory and
sends one compact, credentialed, keepalive POST when the page is left or
frozen. There are no heartbeats. Static document, module, track, and
contribution pages report their repository path. The code workspace batches
all file switches into that same final request. The homepage also accumulates
time only while the contribution space is fully expanded.

Hidden-tab time is excluded. Contribution-space opening and closing animation
time is excluded. Reading time and star-map time are rounded to whole seconds
and capped at six hours per page session. A compact payload uses arrays and
one optional integer:

```json
{"f":[["program/knowledge/topic.md",1,83]],"s":42}
```

The three file values are path, view count, and active seconds. `s` is
full-screen star-map seconds. Non-file pages without star-map activity send the
same bodyless request used by the original PV tracker, so ordinary traffic
still generates at most one analytics request per page. Tracking silently
ignores network errors and never blocks navigation, rendering, search,
reading, or editing.

The editor and administration interfaces do not load this script and are not
included in public-site traffic.

## Verification

- `npm run test:site-analytics` checks compact batching, visible time,
  single-send behavior, request credentials, keepalive behavior, code-file
  switching, star-map state changes, and prerender handling.
- `editor/tests/test_analytics.py` checks cross-day UV/PV, file engagement,
  contributor attribution, and input bounds.
- `test_anonymous_visit_cookie_and_admin_analytics` checks cookie attributes,
  repeat visits, new devices, file aggregation, dashboard totals, and that raw
  identifiers are not persisted.
