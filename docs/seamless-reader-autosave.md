# Seamless Reader Editing and Autosave

## Interaction model

The `new` reader mode has a single editing command: the global **Edit / Exit**
button in the site header.

Entering edit mode immediately opens the current document in place. The reader
does not add a file toolbar, save button, or local edit button. The title remains
in the article header. The body opens as literal Markdown source, including
headings, lists, links, tables, code fences, and Mermaid fences. A compact
`Markdown / Preview` segmented control renders the current full-file snapshot
on demand.

The published preview remains visible until the editor is initialized. The DOM
swap happens only after the editable document is ready, which prevents a blank
loading state. Exiting edit mode preserves the original rendered DOM when the
serialized source is unchanged. This avoids replacing a published page with a
draft-styled preview merely because the editor was opened and closed. When
local content actually differs from the rendered source, exit renders that
latest content back into the normal preview without requiring a server save.

Links remain navigable in preview mode. The build exposes the existing
source-path-to-reader-route index to the client, so relative Markdown targets
such as `./02-details.md` open the corresponding reader page instead of a raw
`.md` URL. Standard HTTP, HTTPS, mail, telephone, and same-page links retain
their normal destinations.

The `old` mode remains available as an administrative fallback and retains its
explicit file, close, and save controls.

## Local workspace

Every content change is serialized immediately into `localStorage`. Trees are
isolated by user ID and repository:

```text
gck-workspace-base:v1:<encoded-user-id>:<encoded-repository>
gck-workspace-current:v1:<encoded-user-id>:<encoded-repository>
```

Current Tree entries contain only:

- repository path;
- content;
- base Git blob SHA;
- client update timestamp.

Authentication tokens, CSRF values, email addresses, and GitHub credentials are
never stored in the editor buffer.

Malformed or mismatched records are removed during read. Storage failures do
not block the current editing session, but the page reports that the change is
only available in memory.

## Base Tree and Current Tree

Reader editing never writes a server-side draft. The browser stores:

- an immutable Base Tree received from the current content commit;
- a Current Tree cloned from that base and changed locally;
- a derived line Diff between both trees.

Every valid input event replaces the complete file in Current Tree. The
workspace reads the same local tree immediately. Remote synchronization updates
Base Tree only when no local changes exist or after the merge workflow accepts
the new baseline.

## Markdown source preservation

The browser edits Markdown source directly. Editing `## 1.xxx` to `## 1.yyy`
therefore produces exactly:

```markdown
## 1.yyy
```

No WYSIWYG serialization step can add `1\.` escapes or rebuild tables and
lists. The title/body split is reassembled as one complete Markdown snapshot
before validation and storage.

## Verification

Automated checks cover:

- user- and path-isolated local buffers;
- invalid buffer cleanup;
- numeric heading preservation;
- no server draft writes;
- offline reload and local recovery;
- Current Tree and line Diff updates after every input;
- Markdown source auto-height on desktop and mobile;
- no Toast UI runtime dependency;
- unchanged edit-mode round trips preserve the exact rendered DOM;
- unchanged round trips create no preview request, buffer, or draft write;
- relative Markdown links in preview navigate to generated reader routes;
- preview rendering after real edits when edit mode exits;
- desktop and mobile horizontal overflow;
- preservation of the explicit toolbar in `old` mode.
