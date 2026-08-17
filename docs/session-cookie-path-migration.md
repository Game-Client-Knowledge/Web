# Session Cookie Path Migration

## Incident

A manually launched recovery process temporarily served the editor with
`EDITOR_COOKIE_PATH=/`, while the production service uses `/editor`.
Browsers that logged in during that interval retained a root-path
`gck_editor_session` cookie.

After production was restored, login created the correct `/editor` cookie but
did not remove the root cookie. Requests to `/editor/...` therefore contained
two cookies with the same name:

```http
Cookie: gck_editor_session=<editor-session>;
        gck_editor_session=<legacy-root-session>
```

Starlette's cookie mapping retained one duplicate value. When it selected the
legacy token, administration, comments, and cross-page bootstrap calls appeared
logged out even though the new session was valid.

No user, submission, comment, or notification data was deleted.

## Compatibility behavior

The editor now parses all raw cookie-header values with the session-cookie name.
It tests each token against the active SQLite session table and uses the first
valid, unexpired session. This works regardless of duplicate-cookie ordering.

When the configured cookie path is not `/`, every editor response expires the
legacy root-path session and OAuth-state cookies. Login and GitHub OAuth also
perform the cleanup explicitly before setting the correct path-specific cookie.
Logout removes both paths.

This cleanup requires no browser cache reset or manual cookie deletion.

## Verification

The regression test creates:

- one valid `/editor` session token;
- one invalid legacy root token;
- both possible duplicate-header orders.

It verifies that session lookup, the administration page, comments, and a
different module's bootstrap response all remain authenticated. It also checks
that login emits both the correct `/editor` cookie and a root-path expiration.
