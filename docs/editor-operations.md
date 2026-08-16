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
2. Archives the committed `editor/` tree.
3. Uploads an immutable release.
4. Creates or updates the Python virtual environment.
5. Imports the application as a smoke check.
6. Atomically updates `current`.
7. Retains the five newest releases.

Restart and verify:

```bash
sudo systemctl restart game-client-knowledge-editor
sudo systemctl status game-client-knowledge-editor --no-pager
curl -fsS http://127.0.0.1:8790/api/config
```

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

Set:

```text
EDITOR_GITHUB_CLIENT_ID
EDITOR_GITHUB_CLIENT_SECRET
EDITOR_ENCRYPTION_KEY
```

Restart the service after changing environment secrets.

## SMTP Configuration

Set:

```text
EDITOR_SMTP_HOST
EDITOR_SMTP_PORT
EDITOR_SMTP_USERNAME
EDITOR_SMTP_PASSWORD
EDITOR_SMTP_FROM
EDITOR_SMTP_STARTTLS
```

Without SMTP, submissions still succeed and notification records remain available
in `/editor/admin`.

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
