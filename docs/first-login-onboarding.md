# First-login Onboarding

## Behavior

Authenticated users see a four-step contribution guide when
`users.onboarding_completed_at` is empty:

1. Read the content and directory conventions.
2. Request a GitHub Organization invitation and accept it.
3. Enter or exit reader edit mode from the header.
4. Review `A/M/D` drafts and create one Draft Pull Request.

The same guide is available on the knowledge website and in the full editor, so
the first authenticated surface is covered. Bootstrap administrators complete
their mandatory password change before the guide appears.

## Persistence

The completion flag is stored per user in SQLite, not in browser storage. This
prevents the guide from reappearing after a device or browser change.

The schema migration adds:

```sql
users.onboarding_completed_at TEXT NULL
```

Existing users receive the guide once after this feature is deployed. New local
and GitHub users receive it on their first ready session.

## API

```text
POST /api/onboarding/complete
X-CSRF-Token: <session token>
```

The endpoint requires an authenticated user who has completed any mandatory
password change. It is idempotent and records one `onboarding.completed` audit
event when the timestamp changes from empty to completed.

Both **Complete guide** and **Skip guide** call this endpoint. Escape does not
dismiss the modal, which avoids silently losing the guide without persisting
the user's decision.
