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

Entering edit mode keeps the real rendered document visible. A preview toolbar
provides:

- **Edit content** to enter the in-place visual editor.
- **Line Diff** to switch the current document between rendered Markdown and
  full source comparison.
- **Revert change** when the current file has a personal draft.

The editor removes the source H1 from the editor body and edits the existing page
title in place. The visual editor uses the same typography, heading spacing,
lists, quotes, code, and table styling as `.prose`. Source files use the same
dark code surface in preview and edit states.

Closing the editor without saving restores the last saved preview. Saving runs
the existing three-way source-preservation logic, refreshes the rendered
preview, and exposes Diff and revert actions without leaving the page.

## Old mode

`old` preserves the previous behavior:

- Entering reader edit mode immediately opens Toast UI.
- The framed inline editor and its existing controls remain unchanged.
- The new preview toolbar is not mounted.

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

## Revert

Revert deletes only the current user's draft through the existing
`DELETE /api/drafts/{id}` endpoint. The reader then reloads the published page
without the draft query parameter. It never changes `main` or another user's
workspace.
