# Contributor Feedback and PR Lifecycle

## Feedback Events

The editor sends contributor-facing email only to a verified account email.
Unverified local accounts can still submit according to the active edit policy,
but do not receive lifecycle email until an administrator verifies the address.

Email events are:

| Event | Trigger |
| --- | --- |
| Thank-you | A Draft PR is created or an owned submission branch is overwritten |
| Merged | GitHub reports a non-null `merged_at` |
| Closed | GitHub reports `state=closed` without a merge |
| Auto-closed | An open PR has no GitHub activity for the configured number of days |
| Restored | The contributor restores a PR that was auto-closed |

Every delivery attempt is retained in `notifications` with its audience, user,
submission, recipients, status, and error. SMTP failure does not roll back the
GitHub operation.

## Status Synchronization

Production runs one Uvicorn worker and starts one asynchronous PR synchronization
task. The default interval is 900 seconds:

```dotenv
EDITOR_PR_SYNC_INTERVAL_SECONDS=900
```

The task reads only submissions currently marked `open`, fetches each GitHub pull
request through the server Bot token, and updates:

- PR status (`open`, `merged`, or `closed`).
- GitHub's `updated_at` timestamp.
- Last synchronization time.
- Automatic-close marker and close time.

Administrators can also run the same synchronization immediately from the
**Pending PRs** section. Concurrent scheduled and manual runs share a process-local
lock.

## Automatic Close

The default threshold is seven days. Administrators can change it from the editor
administration page. A value of `0` disables automatic close.

The threshold is measured from GitHub's PR `updated_at`, not the local submission
creation time. New commits, review activity, or other GitHub updates therefore
postpone automatic close.

When the threshold is reached:

1. The Bot changes the GitHub PR state to `closed`.
2. The local submission is marked `closed` with `auto_closed=1`.
3. The contributor receives an email explicitly stating that long-term inactivity
   caused the automatic close.
4. The email links to the contributor's editor workspace and the corresponding
   submission.

## Restore and Urge

The editor provides two authenticated actions:

- **Urge:** Available for an open PR. It emails all active administrators.
- **Restore and urge:** Available only for a PR closed by this automatic policy.
  The Bot reopens the GitHub PR and then emails all active administrators.

An open PR can be urged at most once per 24 hours. The cooldown is stored in
SQLite, so it survives service restarts.

Users can restore only their own submissions. A manually closed or merged PR
cannot be reopened through this endpoint.

## Administration

The administration page shows a dedicated pending list containing every open PR:

- Contributor and title.
- GitHub PR number and link.
- Days since the last GitHub activity.
- Remaining days before automatic close.

The general submissions list remains available for open, merged, closed, creating,
and failed records.
