# Editor Deployment and Operations

## Production Paths

```text
/opt/game-client-knowledge-editor/
├── current -> releases/<release-id>
├── releases/
└── venv/

/var/lib/game-client-knowledge-editor/
└── editor.db

/etc/game-client-knowledge-editor.env
/etc/systemd/system/game-client-knowledge-editor.service
```

The release tree is replaceable. The SQLite data directory and environment file
must not be included in releases or backups of public static files.

## Initial Installation

Create the service directories:

```bash
sudo install -d -o sourcecode -g sourcecode \
  /opt/game-client-knowledge-editor/releases \
  /var/lib/game-client-knowledge-editor
```

Install the service definition and private environment:

```bash
sudo install -m 0644 \
  deploy/editor/game-client-knowledge-editor.service \
  /etc/systemd/system/game-client-knowledge-editor.service
sudo install -m 0600 \
  deploy/editor/editor.env.example \
  /etc/game-client-knowledge-editor.env
```

Set all bootstrap and integration values before the first start. Generate the token
encryption key with:

```bash
python3 -c \
  "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

PR lifecycle defaults can be overridden with:

```dotenv
EDITOR_PR_AUTO_CLOSE_DAYS=7
EDITOR_PR_SYNC_INTERVAL_SECONDS=900
```

The close threshold can also be changed at runtime from the administration page.
Set it to `0` there to disable automatic close.

The production bootstrap identity is:

```text
email: 2948771712@qq.com
username: sourcecode
```

The initial password is supplied out of band and intentionally excluded from Git.
The service sets `must_change_password=1`, so the first login cannot access editor
or administrator functions until the password is replaced.

Install the Nginx configuration:

```bash
sudo install -m 0644 \
  deploy/server/nginx-game-client-knowledge.conf \
  /etc/nginx/sites-available/game-client-knowledge
sudo nginx -t
sudo systemctl reload nginx
```

## Release Deployment

Only a clean Web repository whose `HEAD` equals `origin/main` can be deployed:

```bash
npm run deploy:editor
```

The script:

1. Verifies the local commit is pushed.
2. Verifies systemd is active and port `8790` belongs to its `MainPID`.
3. Archives the committed `editor/` tree.
4. Uploads an immutable release.
5. Creates or updates the Python virtual environment.
6. Imports the application as a smoke check.
7. Atomically updates `current`.
8. Retains the five newest releases.

The ownership check prevents a test or manually launched Uvicorn process from
serving a temporary database on the production port. An intentionally stopped
service requires the explicit `EDITOR_ALLOW_INACTIVE_DEPLOY=1` override.

Restart and verify:

```bash
sudo systemctl restart game-client-knowledge-editor
sudo systemctl status game-client-knowledge-editor --no-pager
curl -fsS http://127.0.0.1:8790/api/config
```

The installed unit uses `Restart=always`. Killing the worker for a controlled
reload therefore starts a new systemd-managed process with the root-owned
production environment file. `systemctl stop` still performs a deliberate stop.

Enable startup after the first successful release:

```bash
sudo systemctl daemon-reload
sudo systemctl enable game-client-knowledge-editor
```

## GitHub Configuration

The Bot token needs repository content write and pull request write permissions for:

```text
Game-Client-Knowledge/Game-Client-Knowledge
```

GitHub OAuth uses this callback:

```text
https://knowledge.chenyurui.top/editor/api/auth/github/callback
```

Create an OAuth App under the GitHub organization or the owning GitHub account:

```text
Application name:
Game Client Knowledge Editor

Homepage URL:
https://knowledge.chenyurui.top

Authorization callback URL:
https://knowledge.chenyurui.top/editor/api/auth/github/callback
```

Set:

```text
EDITOR_GITHUB_CLIENT_ID
EDITOR_GITHUB_CLIENT_SECRET
EDITOR_ENCRYPTION_KEY
```

Restart the service after changing environment secrets. Until both OAuth values
are present, GitHub login and account binding are intentionally shown as
unconfigured; the existing Bot token cannot substitute for an OAuth Client ID and
Client Secret.

Verify:

```bash
curl -fsS https://knowledge.chenyurui.top/editor/api/config
```

`github_oauth_enabled` must be `true` before GitHub login or binding can start.

The production OAuth App is registered with:

```text
Homepage:
https://knowledge.chenyurui.top

Callback:
https://knowledge.chenyurui.top/editor/api/auth/github/callback
```

Its secret remains only in `/etc/game-client-knowledge-editor.env`. The OAuth App
has been granted access under the `Game-Client-Knowledge` organization policy.

## SMTP Configuration

The recommended path is the SMTP section at:

```text
https://knowledge.chenyurui.top/editor/admin
```

It includes QQ Mail, Gmail / Google Workspace, Outlook / Microsoft 365, and
custom templates. Authorization codes are encrypted with
`EDITOR_ENCRYPTION_KEY`, are never returned to the browser, and can be verified
by sending a test email to the signed-in administrator.

Environment variables remain available as a bootstrap or recovery fallback:

```text
EDITOR_SMTP_HOST
EDITOR_SMTP_PORT
EDITOR_SMTP_USERNAME
EDITOR_SMTP_PASSWORD
EDITOR_SMTP_FROM
EDITOR_SMTP_STARTTLS
```

An administration-page configuration overrides the environment values.
Without SMTP, submissions still succeed and notification records remain available
in `/editor/admin`.

See [SMTP Configuration](smtp-configuration.md) for provider examples, production
commands, verification, and domain deliverability requirements.

See [Contributor Feedback and PR Lifecycle](contributor-feedback-and-pr-lifecycle.md)
for status polling, contributor email, automatic close, restore, and urge behavior.

## Backup and Restore

Use SQLite's online backup command while the service is running:

```bash
sudo -u sourcecode sqlite3 \
  /var/lib/game-client-knowledge-editor/editor.db \
  ".backup '/var/lib/game-client-knowledge-editor/editor-backup.db'"
```

Back up the resulting file and the environment file through the server's private
backup channel. Never place either in Git.

To restore, stop the service, replace the database with the backup, preserve
`sourcecode:sourcecode` ownership and mode `0600`, then start the service.

## Diagnostics

```bash
sudo journalctl -u game-client-knowledge-editor -n 100 --no-pager
sudo nginx -t
curl -I https://knowledge.chenyurui.top/editor/
curl -fsS http://127.0.0.1:8790/api/config
```

The public health signal is `/editor/api/config`. It contains integration status
but no secrets.
