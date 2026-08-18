# Client Workspace Tree

## Purpose

The reader and editor workspace expose one effective content tree instead of
separate repository and draft lists. A newly created topic is therefore parsed
and laid out like committed content before it is submitted.

The effective tree has three layers:

1. the immutable content snapshot embedded in the static site;
2. the authenticated user's server drafts;
3. unsynchronized per-file changes stored in browser local storage.

Later layers override earlier layers by repository path. Only metadata is
duplicated in the tree cache. File bodies remain in the existing source cache
or per-file edit buffers.

## Hierarchy

`src/assets/js/workspace-tree.js` implements the same directory convention as
the Eleventy content loader:

- a top-level `README.md` defines a module;
- a nested `README.md` defines a topic;
- the nearest ancestor directory containing `README.md` owns a file;
- child topics are rendered before directly owned files.

The module page and reader navigation are rebuilt from this effective tree.
The former flat "personal drafts" block is no longer used.

Git-style status is propagated through the tree:

- `A`: a locally or remotely added file/topic;
- `M`: a modified file, or a topic containing changed descendants;
- `D`: a deleted file/topic;
- `!`: a local change that could not be merged with a newer server draft.

## Local-First Writes

Creating a file or topic from the reader writes a versioned local buffer first.
The module tree is rebuilt immediately, so creation does not wait for GitHub or
the editor service.

Each buffer records:

- repository path;
- operation;
- current content;
- base SHA and base content;
- last known server draft revision;
- update time and conflict state.

Only dirty buffers are uploaded. The editor service does not receive the whole
tree or unchanged files.

## Synchronization

The Base Tree commit is immutable while Current Tree contains local changes.
Opening another page or workspace does not silently rebase those changes onto a
newer `main`. This allows submission to create a normal Git branch from the exact
commit the user edited.

When the workspace is clean, remote synchronization can replace Base Tree and
Current Tree with the latest `main` metadata. When it is dirty, synchronization
is deferred until the changes are submitted or released.

Page hide and browser close only persist the local Current Tree. They do not
force a network request.

## Server Load

The GitHub recursive repository tree is cached in the editor process for 60
seconds and coalesced behind an async lock. The full editor also caches tree
metadata in local storage for the configured synchronization interval.

Normal reader navigation does not request the GitHub tree while local changes
exist. It uses the static workspace metadata generated from the immutable
content commit.

## Verification

Automated checks cover:

- static metadata generation;
- local/server/base tree merging;
- nested topic reconstruction;
- status propagation;
- versioned local buffer listing;
- conditional draft polling;
- stale revision rejection;
- reader creation controls in seamless edit mode;
- a new Tencent interview topic rendered as a normal nested topic;
- desktop and mobile width/overflow constraints.
