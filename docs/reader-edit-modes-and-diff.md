# Reader Edit Modes and Line Diff

## Runtime settings

Administrators configure reader editing under **Editing policy**:

| Setting | Values | Behavior |
| --- | --- | --- |
| `reader_edit_mode` | `new`, `old` | Selects the reader editing experience |
| `reader_diff_enabled` | boolean | Shows or hides the client line-Diff control |

Both values are stored in the existing SQLite `settings` table and returned by
`/api/config` and `/api/bootstrap`. The defaults are `new` and `true`.

## New mode

The global edit-mode command immediately changes the current document from
preview to in-place editing. No reader toolbar, formatting toolbar, local edit
button, or save button is mounted. The editor keeps the same typography and
layout as `.prose`.

Input is written to a user- and path-scoped local buffer immediately and synced
to the server every 30 seconds when content changed. A failed or interrupted
sync leaves the local copy available for recovery on the next visit. See
[Seamless Reader Editing and Autosave](./seamless-reader-autosave.md).

## Old mode

`old` preserves the previous behavior:

- Entering reader edit mode immediately opens Toast UI.
- The framed inline editor and its existing controls remain unchanged.
- Saving remains explicit.

This provides an operational fallback while the new mode is the default.

## Diff semantics

The browser compares the draft against its `base_sha` source:

| Color | Status | Meaning |
| --- | --- | --- |
| Green | Added | A line exists only in the draft |
| Yellow | Modified | A replacement line in the draft |
| Red | Deleted | A line exists only in the base |

Unchanged lines remain visible without a status color. Diff is computed locally
with the already bundled `diff` package. The server receives no additional
content request when the deployed raw source still matches the draft base SHA.

The seamless reader does not mount a Diff toolbar. Full line Diff and draft
removal remain available in the editor workspace, where all pending files can be
reviewed together before submission.
