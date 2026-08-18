# Git Submission Protocol

## Model

The browser workspace is a local Git-like checkout:

- `Base Tree` is an immutable repository commit.
- `Current Tree` is the user's complete current file tree.
- A/M/D changes are derived locally from Current Tree versus Base Tree.
- Line diff rows are presentation data only and never enter the submit request.

A submission creates a commit whose parent is the Base Tree commit. The pull
request targets the current `main` branch. If `main` advanced after the Base
Tree commit, GitHub calculates mergeability and exposes any conflict in the
pull request.

## Request

```json
{
  "base_commit": "0123456789abcdef0123456789abcdef01234567",
  "branch": "web/sourcecode/update-memory-docs",
  "commit_message": "docs: update memory allocator heading",
  "pr_title": "docs: update memory allocator heading",
  "pr_body": "Updated the allocator explanation.",
  "pr_base": "main",
  "draft": true,
  "force_update": false,
  "changes": [
    {
      "path": "program/knowledge/engine/01-memory-allocators.md",
      "operation": "upsert",
      "content": "# Complete Markdown file\n..."
    },
    {
      "path": "program/knowledge/engine/obsolete.md",
      "operation": "delete",
      "content": ""
    }
  ]
}
```

The browser does not send:

- the repository tree;
- unchanged files;
- per-file Base blob SHAs;
- Base file bodies;
- line diff rows;
- patches;
- the latest `main` tree.

An upsert contains the complete current file because a Git blob is a complete
file object. This is still bounded to changed files only.

## Server Workflow

1. Authenticate the user and verify CSRF.
2. Validate branch ownership, path safety, operation values, request size, and
   duplicate paths.
3. Compare `base_commit...main` once. The resolved Base commit must equal the
   merge base, proving that it belongs to `main` history. The same response
   supplies the Base commit's tree SHA.
4. Create one blob for each upsert. Deletes use a null tree entry.
5. Create a tree based on the Base commit tree.
6. Create a commit whose sole parent is the resolved Base commit.
7. Optimistically create the user's branch. An existing ref becomes the
   branch-conflict response without a preflight GET.
8. For an authorized overwrite, directly force-update the ref and recreate it
   only if the user-owned branch was manually removed.
9. Create a Draft PR, or update the open PR owned by that branch.

The submission path does not fetch the latest recursive tree, Base blobs, or
remote file bodies. It does not run a server-side three-way merge.

## Conflict Semantics

The only Base requirement is:

```text
base_commit is an ancestor of main
```

`base_commit` does not need to equal the current `main` head. A branch created
from an older main commit is normal Git history. GitHub compares that branch
with the current PR base:

- independent changes remain mergeable;
- overlapping changes appear as a PR conflict;
- reviewers or contributors resolve the conflict through normal Git tooling.

The editor must not silently advance Base Tree while Current Tree is dirty.
Remote synchronization is deferred until the local changes are submitted or
released.

## Validation Boundary

Client validation provides immediate authoring feedback, including complete
Markdown snapshot checks. The server deliberately does not enforce document
structure, module completeness, or content merge policy during submission.

The server still enforces trust-boundary rules that cannot be delegated to an
untrusted browser:

- authentication, authorization, and CSRF;
- branch namespace ownership;
- repository path normalization and extension allowlists;
- maximum request, file, and change counts;
- duplicate path rejection;
- Base commit ancestry;
- overwrite ownership.

GitHub branch protection and pull request review remain the content acceptance
boundary.
