# Site Update Control

## Failure Analysis

Production remained on content commit `66c46eb` even though the update timer was
configured for ten-minute checks.

The timer was firing a remote snapshot build with:

```bash
npm ci --omit=dev
```

Mermaid build-time SVG generation introduced a required `playwright-core`
runtime in dev dependencies. The remote build therefore omitted a module that
the build command imports and failed before switching the production symlink.
The updater correctly kept the last valid release, but the administration UI
did not expose the failure.

The updater now installs the complete lockfile with `npm ci --include=dev`.
The explicit include remains effective even if the service environment sets
`NODE_ENV=production`. Build failures are still atomic: they update status but
never replace the current release.

`playwright-core` also remains a regular dependency so servers still running
the legacy `npm ci --omit=dev` updater can complete one recovery build, publish
this fix, and replace their installed updater script.

## Audit Gates

Every candidate release runs `npm run check` before any production symlink is
changed. The command applies two audit layers.

The source-content audit checks:

- required top-level content directories and repository conventions;
- YAML frontmatter parsing;
- exactly one H1 per Markdown document;
- heading-level continuity and closed fenced code blocks;
- relative Markdown links and directory README targets;
- duplicate generated routes;
- whether content files are included by the catalog scanner.

After the Eleventy build, the generated-site audit checks:

- every local `href` and `src` target in generated HTML;
- path traversal outside the output directory;
- whether every Mermaid block was pre-rendered to SVG.

Any audit error exits non-zero. The updater leaves the current release symlink
unchanged and records the failed candidate commits.

The updater clears inherited attribution Git environment variables inside
snapshot-only unit tests, so production metadata does not change isolated test
expectations.

## Snapshot Retrieval

Candidate releases use immutable commit snapshots. Retrieval follows this
order:

1. a validated local tarball cache under
   `/home/sourcecode/gck-builder/snapshots`;
2. an existing local bare Git mirror containing the exact commit;
3. GitHub Codeload with archive validation;
4. a bounded three-attempt `git fetch` fallback over HTTP/1.1.

The fallback prevents GitHub API or Codeload rate limits from turning a valid
content commit into a permanent deployment failure. Every extracted snapshot
is still pinned to the resolved commit SHA.

Commit metadata requests use `EDITOR_GITHUB_BOT_TOKEN` when it is configured,
avoiding the low anonymous GitHub API rate limit. The token is passed only as
an HTTP authorization header and is never written to status or build logs.

## Build Browser

Mermaid SVG pre-rendering requires a Chromium-compatible browser. The updater
installs the Playwright-pinned Chromium build under:

```text
/home/sourcecode/gck-builder/browsers
```

The cache is reused across releases. `build-mermaid-cache.js` prefers an
explicit `CHROME_PATH` or system browser and otherwise uses the executable
resolved by `playwright-core` through `PLAYWRIGHT_BROWSERS_PATH`. Browser
installation failures are reported as the `install-build-browser` stage.

## Content Statistics Cache

Contribution history is cached across immutable releases at:

```text
/home/sourcecode/gck-builder/content-statistics-v2.json
```

The cache is keyed by the full content commit. Rebuilding the same revision is a
direct hit; a linear descendant scans only the new Git range. The generated
statistics are embedded in the static homepage, so reader requests add no
runtime load to the editor service.

## Scheduling

`game-client-knowledge-update.timer` wakes the oneshot service every minute. The
updater reads `site_auto_update_interval_minutes` from the editor SQLite
settings and performs a remote check only when that interval has elapsed.

Valid values are:

- `0`: disable automatic checks;
- `1` to `1440`: check at the configured minute interval;
- default: `10`.

This split keeps systemd static while making the real network/build interval
configurable from administration.

## Manual Modes

The administration page provides two commands:

- **Update content**: resolve the latest pushed content commit and rebuild it
  with the currently deployed Web commit.
- **Update server version**: resolve and publish the latest pushed Web and
  content commits together.

The editor process never receives write access to the production release tree.
An authenticated administrator request writes:

```text
/var/lib/game-client-knowledge-editor/site-update.request
```

`game-client-knowledge-update.path` notices the file and starts the existing
restricted oneshot service. The updater removes the request, performs the
immutable snapshot build, and writes status to:

```text
/var/lib/game-client-knowledge-editor/site-update-status.json
```

The administration page polls that status while a request is queued or
running.

## Failure Notifications

When a scheduled or manual update fails, the updater captures the current
stage, failed command, candidate Web and content commits, exit code, and the
last 80 non-empty log lines. It then uses the editor notification service to
email every active administrator through the SMTP configuration saved in the
administration page.

The notification is also recorded as `site_update_failed` in the existing
notification history. Successful delivery fingerprints are stored at:

```text
/home/sourcecode/gck-builder/last-update-failure-notification.json
```

The fingerprint includes the candidate commits, stage, command, and sanitized
log summary. An identical successfully delivered failure is not emailed again
on later timer retries. A failed or unconfigured SMTP attempt is not marked as
delivered, so a later retry can still notify administrators after SMTP is
restored.

The updater invokes the notification module through:

```text
/opt/game-client-knowledge-editor/venv/bin/python
```

and therefore reuses the encrypted database SMTP password without exposing it
to the shell script or status JSON.

## Status

The status API reports:

- `idle`, `queued`, `checking`, `building`, `success`, or `failed`;
- requested mode;
- start and finish timestamps;
- target Web and content commits;
- currently deployed Web and content commits;
- a bounded diagnostic message.

Detailed errors remain in:

```bash
journalctl -u game-client-knowledge-update.service
```

## Installation

Deploy the editor first so the latest updater script is copied into the server
builder directory:

```bash
npm run deploy:editor
```

Install or refresh the root-managed service, timer, and path units:

```bash
npm run deploy:update-control
```

Then restart the editor service:

```bash
sudo systemctl restart game-client-knowledge-editor
```

Verify:

```bash
systemctl status \
  game-client-knowledge-update.service \
  game-client-knowledge-update.timer \
  game-client-knowledge-update.path
cat /var/www/game-client-knowledge/current/.release-source
```

All builds continue to use pushed immutable commit snapshots from Codeload.
Dirty local repository files are never production inputs.
