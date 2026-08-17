# Workspace Deletion

## Scope

Authenticated editors can delete content at three levels from both the reader
workspace and the standalone editor:

- one file;
- one topic directory, including nested topics;
- one top-level module, including all descendants.

Deletion is a draft operation. No button directly changes `main`.

## Client Flow

The reader workspace keeps the existing client-first behavior:

1. Resolve the selected file or directory against the effective workspace tree.
2. Request the immutable `main` tree entries and blob SHAs for that scope.
3. Remove unsaved local additions immediately because they do not exist on
   `main`.
4. Store one local `delete` buffer for each existing repository file.
5. Render the file and ancestor topics with Git `D` state.
6. Upload only those dirty buffers through the configured workspace sync
   interval.

The delete control changes to **Undo deletion** after every repository file in
its scope has a `D` operation. Undo clears both local buffers and already
synchronized server drafts.

## Repository Assets

Directory deletion includes every Git blob below the selected path, not only
Markdown or browser-editable source files. This prevents hidden images or
other assets from keeping a supposedly deleted module alive.

Paths are validated as relative repository paths. Hidden paths, parent
traversal, reserved application roots, control characters, and absolute paths
are rejected.

## Top-Level Modules

Deleting only a top-level `README.md` is invalid because it would leave an
orphaned directory. Submission validation permits top-level module deletion
only when every remote blob in that module is included in the same delete
change set.

Top-level module deletion requires a second confirmation in the client.

## Submission

Each delete draft retains the original blob SHA. Before creating a commit, the
server checks that:

- the file still exists;
- its SHA still matches the editor's base SHA;
- a deleted top-level module contains no undeleted remote files.

The GitHub tree commit then writes `sha: null` for every deleted path. The
normal Draft PR review process remains unchanged.
