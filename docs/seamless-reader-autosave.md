# Seamless Reader Editing and Autosave

## Interaction model

The `new` reader mode has a single editing command: the global **Edit / Exit**
button in the site header.

Entering edit mode immediately opens the current document in place. The reader
does not add a preview toolbar, file toolbar, save button, or local edit button.
Toast UI's formatting toolbar and code-block language control are also hidden.
The title and document body keep the same dimensions, typography, spacing,
lists, quotes, code blocks, and tables used by the rendered reader.

The published preview remains visible until the editor is initialized. The DOM
swap happens only after the editable document is ready, which prevents a blank
loading state. Exiting edit mode renders the latest local content back into the
normal preview without requiring a server save.

The `old` mode remains available as an administrative fallback and retains its
explicit file, close, and save controls.

## Local buffer

Every content change is serialized immediately into `localStorage`. Buffers are
isolated by both user ID and repository path:

```text
gck-reader-buffer:v1:<encoded-user-id>:<encoded-path>
```

Each record contains only:

- content;
- base Git blob SHA;
- last known server draft revision;
- client update timestamp.

Authentication tokens, CSRF values, email addresses, and GitHub credentials are
never stored in the editor buffer.

Malformed or mismatched records are removed during read. Storage failures do
not block editing; the client keeps the current value in memory and attempts an
immediate server sync.

## Server synchronization

While an in-place editor is open, the client checks for pending content every
30 seconds. It calls `PUT /api/drafts` only when serialized content differs from
the last server version.

Synchronization uses content snapshots:

1. The request captures the exact local and canonical Markdown versions.
2. Input made while that request is in flight remains a newer local snapshot.
3. A successful response clears the buffer only when no newer input exists.
4. Failed requests leave the local buffer intact for the next interval.

When a page becomes hidden or receives `pagehide`, the client also attempts a
`keepalive` sync. Browser and payload limits can prevent that request from
finishing, so local persistence remains the recovery source. Reopening the same
path as the same user restores the local snapshot before the editor is shown.

## Markdown source preservation

Toast UI canonicalizes numeric heading prefixes such as:

```markdown
## 1. Overview
```

to:

```markdown
## 1\. Overview
```

The source-preservation layer now normalizes that editor-only escape before
computing the three-way line merge. Editing `## 1.xxx` to `## 1.yyy` therefore
produces exactly:

```markdown
## 1.yyy
```

Normalization is limited to numeric prefixes at ATX heading starts and skips
fenced code blocks. Ordered lists, prose, links, and code content are unchanged.

## Verification

Automated checks cover:

- user- and path-isolated local buffers;
- invalid buffer cleanup;
- numeric heading escape normalization;
- no server request before the synchronization interval;
- offline reload and local recovery;
- one server update after 30 seconds;
- buffer removal after a successful update;
- preview-to-edit typography and heading-position equality;
- no reader, inline, Toast UI, or save toolbar in `new` mode;
- preview rendering when edit mode exits;
- desktop and mobile horizontal overflow;
- preservation of the explicit toolbar in `old` mode.
