# First-login Onboarding

## Behavior

Authenticated users see a seven-step contribution guide when
`users.onboarding_completed_at` is empty:

1. Understand account policy and the immutable Base Tree / editable Current
   Tree model.
2. Edit an existing complete document from the reader or workspace.
3. Create a top-level module, nested topic, or content file at the correct
   hierarchy.
4. Comment on a document or selected source passage, reply, and mention users.
5. Review local `A/M/D` changes and full-file line diffs.
6. Create the user branch, commit, and Draft Pull Request.
7. Track personal submissions and inspect cumulative or seven-day contribution
   statistics.

The same guide is available on the knowledge website and in the full editor, so
the first authenticated surface is covered. Bootstrap administrators complete
their mandatory password change before the guide appears.

After completion, the guide remains available without changing the completion
timestamp:

- **Personal settings -> Contribution guide** on the knowledge site.
- **Contribution guide** in the editor workspace heading.

Manual review closes locally and does not call the completion endpoint again.

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

During first login, both **Complete guide** and **Skip guide** call this
endpoint. Escape does not dismiss that mandatory first presentation. A manually
reopened guide uses **Close guide**, supports Escape, and does not call this
endpoint.
