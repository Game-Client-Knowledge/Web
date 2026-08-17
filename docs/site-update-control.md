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
