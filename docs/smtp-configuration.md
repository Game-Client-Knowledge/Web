# SMTP Configuration

## What SMTP Is

SMTP (Simple Mail Transfer Protocol) is the standard protocol used to send
outgoing email.

The editor service uses SMTP only for administrator notifications:

- A contributor successfully creates a Draft Pull Request.
- A user submits an administrator application.

Recipients are all active users whose role is `admin`. If SMTP is unavailable,
the contribution workflow still succeeds and the notification is retained in
`/editor/admin`.

## Supported Configuration Paths

Administrators can configure SMTP directly at:

```text
https://knowledge.chenyurui.top/editor/admin
```

The page provides templates for QQ Mail, Gmail / Google Workspace, Outlook /
Microsoft 365, and custom SMTP. A template pre-fills the host, port, and STARTTLS
mode; the administrator still supplies the mailbox, sender, and provider
authorization code.

The authorization code is encrypted with `EDITOR_ENCRYPTION_KEY` before it is
stored in SQLite. Admin APIs return only whether a password is present and never
return the secret itself. Leaving the password field empty preserves the existing
encrypted value. The **Send test email** action sends only to the current
administrator's own email address.

The current mailer implementation supports:

- Plain SMTP upgraded with STARTTLS.
- Port `587` by default.
- Optional username/password authentication.

It does not currently use implicit TLS through `SMTP_SSL`, so providers that only
offer port `465` require a small code change. Prefer a provider endpoint that
supports port `587` with STARTTLS.

## Required Provider Information

Obtain the following from the email provider:

| Setting | Meaning |
| --- | --- |
| SMTP host | Provider server, such as `smtp.gmail.com` |
| SMTP port | Use `587` for the current implementation |
| Username | Usually the complete email address |
| Password | SMTP authorization code or app password, not the normal login password |
| Sender | A sender address accepted by the provider |
| STARTTLS | Keep enabled for port `587` |

Cloudflare Email Routing only receives and forwards email. It is not an outbound
SMTP service. A separate mailbox or transactional email provider is still
required.

## Environment Fallback

Secrets are stored only on the server:

```text
/etc/game-client-knowledge-editor.env
```

Do not put SMTP credentials in Git, Markdown, shell history, or chat messages.

Edit the server file:

```bash
sudoedit /etc/game-client-knowledge-editor.env
```

Environment values remain supported as a bootstrap and recovery fallback. A
configuration saved in the administration page overrides these values. Add or
update:

```dotenv
EDITOR_SMTP_HOST=smtp.example.com
EDITOR_SMTP_PORT=587
EDITOR_SMTP_USERNAME=notifications@example.com
EDITOR_SMTP_PASSWORD=provider-app-password
EDITOR_SMTP_FROM=notifications@example.com
EDITOR_SMTP_STARTTLS=true
```

Then restart the service:

```bash
sudo systemctl restart game-client-knowledge-editor
systemctl is-active game-client-knowledge-editor
```

The expected status is:

```text
active
```

## Common Provider Examples

### Gmail or Google Workspace

```dotenv
EDITOR_SMTP_HOST=smtp.gmail.com
EDITOR_SMTP_PORT=587
EDITOR_SMTP_USERNAME=notifications@example.com
EDITOR_SMTP_PASSWORD=google-app-password
EDITOR_SMTP_FROM=notifications@example.com
EDITOR_SMTP_STARTTLS=true
```

Enable two-step verification and create a Google App Password. A normal account
password should not be used.

### Outlook or Microsoft 365

```dotenv
EDITOR_SMTP_HOST=smtp.office365.com
EDITOR_SMTP_PORT=587
EDITOR_SMTP_USERNAME=notifications@example.com
EDITOR_SMTP_PASSWORD=mailbox-app-password
EDITOR_SMTP_FROM=notifications@example.com
EDITOR_SMTP_STARTTLS=true
```

SMTP AUTH must be enabled for the mailbox or tenant.

### QQ Mail

```dotenv
EDITOR_SMTP_HOST=smtp.qq.com
EDITOR_SMTP_PORT=587
EDITOR_SMTP_USERNAME=account@qq.com
EDITOR_SMTP_PASSWORD=qq-smtp-authorization-code
EDITOR_SMTP_FROM=account@qq.com
EDITOR_SMTP_STARTTLS=true
```

Use the SMTP authorization code generated in QQ Mail settings, not the QQ account
password.

Provider settings and policies can change. Confirm the host, port, authentication
method, and sender restrictions in the provider documentation.

## Verification

First verify that the server can reach the SMTP endpoint:

```bash
openssl s_client \
  -starttls smtp \
  -connect smtp.example.com:587 \
  -servername smtp.example.com \
  </dev/null
```

From the administration page, save the configuration and select **Send test
email**. A successful test is delivered to the signed-in administrator.

You can also trigger either an administrator application or a successful Draft
PR submission. Open:

```text
https://knowledge.chenyurui.top/editor/admin
```

Check **Administrator email notifications**:

- `sent`: delivery was accepted by the SMTP server.
- `failed`: inspect the stored error message.
- `unconfigured`: required SMTP settings were not loaded.

Service logs can also be inspected without printing credentials:

```bash
journalctl \
  -u game-client-knowledge-editor \
  --since "10 minutes ago" \
  --no-pager
```

## Domain Deliverability

When sending from an address under `chenyurui.top`, configure the provider's DNS
records in Cloudflare:

- SPF authorizes the provider to send for the domain.
- DKIM signs outgoing messages.
- DMARC defines recipient handling and reporting policy.

Use the exact DNS values supplied by the email provider. Without SPF and DKIM,
messages may be accepted by SMTP but delivered to spam or rejected later.
