# Line Authors and Reader Comments

## Overview

The reader exposes cached Git line attribution and source-anchored discussion
threads without running `git blame` during page requests.

The implementation has three stages:

1. The site update job keeps a bare mirror of the content repository.
2. Changed files are blamed once and uploaded to the editor service through an
   internal token-protected endpoint.
3. Reader pages fetch the cached attribution and comments, then calculate
   rendered positions locally.

This preserves the separation between the content repository, the static site,
and the stateful editor service.

## Attribution Sync

For defense in depth, set the same random token in
`/etc/game-client-knowledge-editor.env`:

```dotenv
EDITOR_ATTRIBUTION_SYNC_TOKEN=<random-token>
```

Generate a token with:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

The `game-client-knowledge-update.service` reads this environment file. Its
update script maintains:

```text
/home/sourcecode/gck-builder/content.git
/home/sourcecode/gck-builder/last-attribution-commit
```

On the first run, all supported text files are blamed. Later runs use the
previous successful attribution commit and process only added, modified, or
renamed files. Deleted paths are removed from the cache.

If no token is configured, the endpoint accepts synchronization only from
`127.0.0.1` or `::1`. Requests forwarded from Nginx or Cloudflare retain the
external client address and are rejected. A configured token always takes
precedence and is recommended.

Uploads are split below the editor service's request limit and sent to:

```text
POST /editor/api/internal/attribution-sync
Authorization: Bearer <token>
```

The token and author email addresses are never sent to browsers. Reader
responses include only display names, GitHub handles, matched user IDs, line
ranges, and commit SHAs.

After adding the environment variable or changing the unit file:

```bash
sudo systemctl daemon-reload
sudo systemctl restart game-client-knowledge-editor
sudo systemctl start game-client-knowledge-update.service
```

## Comment Anchors

Root comments store:

- Content path and attribution revision.
- Source start/end lines and columns.
- The selected quote.
- Rendered block offsets used to recreate exact yellow underlines.

The client maps rendered Markdown blocks to source ranges and performs
selection-to-line calculation locally. A selection may cover part of one line,
multiple lines, or multiple rendered blocks. The server resolves all distinct
line authors in the resulting source range.

Comments sharing the same anchor are grouped in one rail position and use one
CSS Highlight collection, so yellow underlines are not stacked.

## Threads and Mentions

Threads have at most two visual levels:

- Root comments are visible by default.
- Replies are collapsed by default.
- A reply to another reply remains at level two and records `reply_to_id`.
- The rendered "replying to" reference jumps to the target comment.

Mention suggestions are loaded only for authenticated users and filtered in
the browser. The server verifies that each submitted mention ID has a matching
`@username` or `@github_login` in the body before notifying it.

## Email Notifications

A root comment notifies every distinct cached author in the selected line
range. A reply notifies the directly referenced comment author. Valid mentions
are added to either recipient set.

Recipients are deduplicated and each message is sent separately to avoid
disclosing addresses to other authors. The commenter is excluded.

Authenticated users can disable comment and reply email in Personal Settings.
The preference applies to line-author, reply, and mention notifications.

## Reader Behavior

The comment rail is closed by default. On desktop it opens on the right at
approximately 25% of the viewport and can be resized by dragging its left
edge. On mobile it becomes a fixed right-side panel.

Readers can:

- Select text and use the contextual comment action.
- Long-press a rendered block to comment on the block.
- Click an underlined block to focus its comment group.
- Expand replies independently.
- Expand long comments in additional segments.

Focusing another comment restores the normal collapsed length of the previous
comment. Expanded cards push later cards down to preserve anchor ordering.

## Verification

Backend coverage:

```bash
cd editor
python -m pytest -q
```

Attribution parser smoke test:

```bash
python3 scripts/sync-line-authors.py \
  --repo /path/to/content.git \
  --revision <commit> \
  --url http://127.0.0.1:8790/api/internal/attribution-sync \
  --token <token>
```

Desktop and mobile comment pane checks:

```bash
VISUAL_BASE_URL=http://127.0.0.1:8080 \
  node scripts/test-reader-comments-visual.js
```
