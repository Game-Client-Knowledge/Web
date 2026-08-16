# Debug Session: draft-markdown-churn

- **Status**: [OPEN]
- **Issue**: Cancelling new-file creation triggers empty-path validation, and a
  one-character Markdown edit rewrites unrelated syntax.
- **Debug Server**: http://127.0.0.1:7778/event
- **Log File**: `.dbg/trae-debug-log-draft-markdown-churn.ndjson`

## Reproduction Steps

1. Open the editor workspace and choose **New file**.
2. Leave the repository path empty and press **Cancel**.
3. Open an existing Markdown file in visual editing mode.
4. Add one trailing space to its title and save the draft.
5. Inspect the source-level diff.

## Hypotheses & Verification

| ID | Hypothesis | Likelihood | Effort | Expected Evidence |
|----|------------|------------|--------|-------------------|
| A | The cancel button is a submit button and the handler checks native validity before branching on the submitter | High | Low | Cancel dispatches submit but handler never reaches its cancel branch |
| B | Browser constraint validation blocks the submit event entirely | High | Low | `invalid` fires for the path field and no submit event is observed |
| C | Toast UI serializes the whole Markdown document into its canonical syntax | High | Low | `getMarkdown()` already contains escaped headings, `*` bullets, and normalized tables before the API request |
| D | The backend or line-diff renderer rewrites Markdown after saving | Medium | Low | Browser payload remains original while stored draft or rendered diff changes |
| E | Live preview rendering mutates the WYSIWYG editor document before save | Low | Medium | Editor serialization changes only after preview scheduling |

## Evidence

Instrumentation added for:

- File-dialog click, invalid, and submit events.
- Workspace and reader initial Toast UI serialization.
- Workspace and reader save payloads.
- Reader change-event serialization.

Pre-fix log:

- Lines 1-5: clicking Cancel emits native `invalid` events for `path` and
  `title`; the button is `type=submit`, the form is invalid, and the submit
  handler is never entered.
- Line 6: immediately after Toast UI initialization, before any user edit,
  source length changes from 567 to 576, dash bullets become star bullets, and
  the compact table separator is reformatted.
- Line 7: the already-normalized document is sent as the draft payload, proving
  that the backend and diff renderer are not the source of the rewrite.

## Conclusion

| ID | Status | Conclusion |
|----|--------|------------|
| A | Confirmed | Cancel is implemented as a validating submit action |
| B | Confirmed | Native constraint validation prevents the cancel branch |
| C | Confirmed | Toast UI canonicalizes the complete Markdown document |
| D | Rejected | Rewriting occurs before the request reaches the backend |
| E | Rejected | Workspace reproduction has no live-preview mutation |

## Verification

Post-fix evidence:

- Cancel closes the empty new-file dialog. The handler receives
  `submitterValue=cancel` even while the form is invalid.
- Untouched workspace save: Toast UI canonical output is 576 characters, but the
  submitted source remains exactly 567 characters and matches the original.
- Single-heading workspace edit changes only the title line; numbered headings,
  dash bullets, and compact table separators remain byte-for-byte in their
  original style.
- The same single-heading test passes in the reader-integrated editor.
- Source-level diff reports only the removed and replacement title lines.

Implementation:

- Cancel controls use `formnovalidate`.
- A shared source-preserving three-way line merge compares original Markdown,
  Toast UI's initial canonical form, and the edited canonical form.
- Unchanged visual documents save the original source exactly.

Awaiting production deployment and user confirmation.
