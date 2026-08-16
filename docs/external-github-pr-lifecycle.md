# External GitHub Pull Request Lifecycle

## Discovery

The existing PR worker now handles two independent sources:

- Web submissions stored in `submissions`.
- Pull requests created directly on GitHub and stored in
  `external_pull_requests`.

Every scheduled or administrator-triggered synchronization requests the 100 most
recently updated repository pull requests. A pull request is considered a Web
submission when at least one of these signals is present:

- its PR number already belongs to `submissions`;
- its body contains the Web editor attribution marker;
- its head branch starts with `web/`.

All other open pull requests are registered as external contributions. After the
first scan, newly created closed or merged pull requests are also registered, so
a PR that opens and closes between two polling intervals is not silently lost.
The scan cursor is persisted in SQLite.

Discovery sends an administrator email and adds the PR to the administration
page. The pending PR list combines Web and external contributions, while the
external list also shows terminal states and email-resolution results.

## Contributor email resolution

GitHub does not guarantee that another user's email is visible. The worker uses
the following ordered sources:

1. A verified local account already linked to the GitHub login.
2. The GitHub user's public profile email.
3. A matching PR commit author's email.

GitHub `noreply` addresses and syntactically invalid addresses are rejected
because they cannot receive lifecycle mail. If no deliverable address is
available, the administrator notification records that limitation; the PR
lifecycle still continues normally.

## Notifications

When a deliverable address is found, external contributors receive:

- a thank-you email when the PR is discovered;
- a merged email;
- a manually closed email;
- an automatic-timeout email.

Email delivery attempts use the existing SMTP configuration and are written to
`notifications` with `external_pr_id`. Contributor email contains both plain
text and HTML. The HTML version renders the urge action as a button.

## Timeout

External open PRs use the same administrator-configured inactivity threshold as
Web submissions. GitHub's `updated_at` controls the deadline. When the threshold
is reached, the Bot closes the PR and sets `auto_closed=1`.

External PRs are intentionally not reopened by an anonymous action. The timeout
email can urge administrators, who retain the decision to reopen the PR.

## Accountless urge

Each urge button carries a random capability token. Only its SHA-256 hash is
stored in `external_pr_action_tokens`; tokens expire after 90 days.

The email link first performs a side-effect-free `GET`:

```text
/editor/external-pr/urge?token=...
```

The loaded page then submits the token with `POST /api/external-pr/urge`.
This prevents email security scanners that prefetch links from sending false
urge notifications.

Rules:

- one urge per PR per 24 hours;
- merged PRs cannot be urged;
- manually closed PRs cannot be urged;
- open and system-auto-closed PRs can be urged;
- successful urges email all active administrators and are audited.

No site account or GitHub OAuth session is required.

## Persistence

New tables:

- `external_pull_requests`;
- `external_pr_action_tokens`.

The existing `notifications` table gains nullable `external_pr_id`. Migrations
are additive and run through the normal editor startup.

## Verification

Tests cover:

- external discovery and Web-submission exclusion;
- public-profile and commit-author email lookup;
- `noreply` filtering;
- administrator and contributor notification records;
- merge and timeout transitions;
- HTML email with plain-text fallback;
- token hashing and expiry;
- side-effect-free landing-page GET;
- anonymous POST urge and 24-hour cooldown;
- legacy database migration;
- admin rendering and accountless urge page behavior.
