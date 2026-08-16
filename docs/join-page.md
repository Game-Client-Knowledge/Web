# Join Page

## Purpose

The Join page at [join.chenyurui.top](https://join.chenyurui.top) creates GitHub
Organization invitations for Game Client Knowledge contributors.

The knowledge website links to it from:

- The desktop primary navigation.
- The mobile navigation menu.
- The homepage contribution section.

## Ownership boundary

The Join application is an independent FastAPI service on the production server:

```text
Cloudflare Tunnel
-> join.chenyurui.top
-> 127.0.0.1:8787
-> github-org-invite.service
```

The business API and secrets remain in `/opt/github-org-invite`. This repository
tracks only the public page template at [`deploy/join/index.html`](../deploy/join/index.html).
The template calls the existing `/api/config` and `/api/invite` endpoints without
changing their contract.

## Deployment

After the one-time server bootstrap, deploy the page with:

```bash
npm run deploy:join
```

The command rejects a dirty Web working tree and requires local `HEAD` to equal the
pushed `origin/main` commit before uploading.

The command uploads a timestamped release under
`/var/www/github-org-invite-page/releases/`, atomically updates `current`, and
retains the five newest releases. FastAPI reads the page through a server-side
symlink, so the application process does not need to restart.

The command accepts the same connection overrides as the main site deployment:

```text
DEPLOY_HOST
DEPLOY_KEY
JOIN_RELEASE_ROOT
```

## Verification

Verify the public page and API without sending an invitation:

```bash
curl -fsS https://join.chenyurui.top/api/health
curl -fsS https://join.chenyurui.top/api/config
curl -fsS -o /dev/null -w '%{http_code}\n' https://join.chenyurui.top/
```

Submission feedback should be tested with browser request interception. Do not use
production usernames or Join codes for visual regression tests.

## Rollback

List releases:

```bash
find /var/www/github-org-invite-page/releases -mindepth 1 -maxdepth 1 -type d
```

Rollback by changing the `current` symlink to a previous release. The original
pre-versioned page is also retained on the server as a timestamped `.bak` file.
