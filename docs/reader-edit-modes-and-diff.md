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
preview to in-place Markdown source editing. The document title remains in the
page header; the body exposes its literal Markdown syntax. A compact segmented
control switches between `Markdown` and the rendered preview. No save button is
mounted.

Input is written immediately to the local Current Tree and compared with the
immutable Base Tree. Reloading the same path restores that local snapshot. See
[Seamless Reader Editing and Autosave](./seamless-reader-autosave.md).

## Old mode

`old` preserves the previous behavior:

- Entering reader edit mode immediately opens a framed Markdown source editor.
- Its explicit file, close, and save controls remain available.
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

The reader does not mount a Diff toolbar. Full line Diff and local-change
removal remain available in the editor workspace. Its `Changes` pane can switch
the selected file between full-file Diff and editable Markdown without changing
back to the resource tab.
