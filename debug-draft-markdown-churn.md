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

Production verification:

- Web and editor release: `34a06dd`.
- Content release: `d7cc50d`.
- Production serves `markdown-preserve.js` and all cancel controls include
  `formnovalidate`.
- Production visual regression: 8 desktop/mobile scenarios, 0 errors.
- Editor service status: `active`.

Awaiting user confirmation before removing instrumentation and debug artifacts.

## Iteration: No-Op Save and Edit-Mode Latency

User feedback: saving an untouched file still creates an `M` draft, and entering
edit mode remains slow.

| ID | Hypothesis | Likelihood | Expected Evidence |
|----|------------|------------|-------------------|
| F | The source-preserving output equals the original, but the client still unconditionally calls `PUT /drafts` | High | `sourceSame=true` followed by a new draft ID |
| G | `/repository/file` and its upstream GitHub request dominate edit-mode latency | High | Source fetch time is substantially larger than Toast UI initialization |
| H | Toast UI initialization and layout dominate edit-mode latency | Medium | Editor initialization time exceeds source fetch time |
| I | The static `/raw/<path>` source is available and cacheable | High | Static source returns the same bytes without the editor API |
| J | A client-computed Git blob SHA can replace the repository-file SHA lookup | Medium | SHA-1 of `blob <bytes>\\0<content>` matches the repository tree SHA |

Pre-fix evidence:

- Reader save serialization reports `sourceSame=true`; the following save event
  still reports a draft ID, so the client reaches `PUT /drafts` even when the
  source-preserving output is unchanged.
- A draft-backed reader source opens in `26.3ms`, of which Toast UI
  initialization takes `25.8ms`.
- An isolated static `/raw/<path>` request completes in about `3.3ms`.
- With `/repository/file` delayed by `1200ms`, the reader takes about `1355ms`
  to open. A direct production-server GitHub Contents request also exceeded a
  20-second connection timeout.

| ID | Status | Conclusion |
|----|--------|------------|
| F | Confirmed | Unchanged serialized source does not prevent the draft API call |
| G | Confirmed | The GitHub-backed repository-file request dominates an uncached open |
| H | Rejected | Toast UI initializes in tens of milliseconds, not seconds |
| I | Confirmed | The deployed raw source is available locally and is fast |
| J | Confirmed | Browser SHA equals both `git hash-object` and the repository-tree blob SHA |

Minimal fix:

- Short-circuit unchanged saves before `PUT /drafts`.
- Prefetch the current deployed source in the document head.
- Cache source by deployed content version and path in `sessionStorage`.
- Compute `SHA1("blob " + byteLength + "\0" + content)` in the browser.
- Fall back to `/repository/file` when static source is missing or its computed
  blob SHA does not match the workspace repository tree.

Instrumentation remains active for post-fix comparison.

Post-fix evidence:

- Reader first open: head-prefetched static source resolves in `0.2ms`; Toast UI
  initializes in `38.1ms`; total open time is `39ms`.
- Reader reload: `sessionStorage` source resolves in `0ms`; Toast UI initializes
  in `15.8ms`; total open time is `15.9ms`.
- Workspace open: static source resolves and matches the repository-tree SHA in
  `3.5ms`; total open time is `25.9ms`.
- Reader and workspace unchanged saves both report `sourceSame=true` and
  `apiCalled=false`. Browser API counters remain `PUT /drafts=0`, and neither
  surface creates an `M` marker.
- A real one-character edit reports `sourceSame=false`, `apiCalled=true`, and
  exactly one draft PUT.
- A newly created, otherwise untouched file also performs its required first
  draft PUT, so the no-op guard does not suppress creation.
- Browser-computed SHA for `knowledge/engine/README.md` is
  `2905b7b5120687e578caeccf4a90ee962ffb2cef`, exactly matching
  `git hash-object`.

Pre-fix vs post-fix:

| Behavior | Pre-fix | Post-fix |
|----------|---------|----------|
| Unchanged save | Draft API called and an `M` draft is retained/created | Draft API skipped |
| Reader source | GitHub-backed repository API can dominate opening | Head prefetch or session cache |
| Cached reader open | About `1355ms` with a simulated `1200ms` API delay | `15.9ms` total |
| Workspace file open | Repository Contents API per file | Static raw source verified against tree SHA |

The session remains `[OPEN]` pending user confirmation; instrumentation and
debug artifacts must not be removed yet.

Pure post-fix rerun after clearing the session log:

- Lines 1-2: reader source is a head-started session-cache hit (`0ms`) and the
  complete editor opens in `16ms`.
- Lines 4-5: reader serialization equals the original source and the save exits
  with `apiCalled=false`.
- Lines 6-7: workspace source is a SHA-verified session-cache hit (`0.1ms`) and
  the complete editor opens in `9.8ms`.
- Lines 9-10: workspace serialization equals the original source and the save
  exits with `apiCalled=false`.
- Mock API counters for both reruns are `repositoryFiles=0` and `draftPuts=0`.
