# Complete Editor Snapshots

## Invariant

Every `upsert` entry in the client Current Tree contains the complete file.
Line diffs are derived metadata only. They are never used as submission
content.

For Markdown files, a complete snapshot must contain exactly one top-level
heading. The reader and workspace reject an incomplete snapshot before it can
replace a valid Current Tree entry. This is a client authoring invariant. The
submission service enforces trust-boundary constraints but does not duplicate
Markdown structure policy.

## Base hydration

Catalog entries initially contain path, SHA, and navigation metadata without
file bodies. Opening a file hydrates its Base Tree entry from the immutable
deployed content revision.

An existing Current Tree change must never hydrate the Base Tree. The editor
loads the deployed source separately whenever the Base Tree body is absent or
invalid, then overlays the local change.

## Legacy partial-cache repair

Older clients could store only a changed Markdown fragment in both trees. The
repair path:

1. loads the complete deployed file for the matching base SHA;
2. replaces the unique stale fragment with the locally edited fragment;
3. validates that the result is a complete Markdown document;
4. writes the complete result and full merge base back to the dual tree.

Repair is deliberately conservative. It runs only when the stale fragment
occurs exactly once and is substantially smaller than the complete base.
Ambiguous fragments remain untouched and submission is blocked until the user
opens and re-edits the file.

## Regression coverage

- `scripts/test-editor-document.js` covers splitting, assembly, integrity
  validation, and conservative fragment repair.
- `scripts/test-workspace-store.js` covers damaged Base/Current hydration and
  verifies that later sections remain in the submitted snapshot.
- `test_submission_forwards_complete_markdown_when_only_h2_changes` verifies
  that an H2-only edit reaches the GitHub boundary as a complete file.
- `scripts/test-editor-workspace.js` locks the client integrity check and the
  minimal Git submission mapper.
- Browser verification edits the real 121-line allocator document and checks
  that the Current Tree still contains its H1, tables, and later sections.
