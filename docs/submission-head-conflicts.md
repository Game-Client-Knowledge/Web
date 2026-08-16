# Submission Head Conflicts

## Branch Construction

The submission head entered by a user is normalized and combined with the
account username:

```text
web/<normalized-username>/<normalized-custom-head>
```

For example:

```text
username: sourcecode
custom head: C++ Polymorphism
branch: web/sourcecode/c-polymorphism
```

Normalization lowercases the value, converts spaces and underscores to hyphens,
removes unsupported characters, collapses repeated hyphens, and limits the final
custom segment to 60 characters. Different input strings can therefore resolve to
the same branch.

## Conflict Detection

The server checks two independent sources:

1. **Local submission history:** `submissions.branch_name` has a unique SQLite
   index. This identifies which site user originally created the branch.
2. **GitHub branch state:** the server requests
   `GET /repos/<owner>/<repo>/git/ref/heads/<branch>`. HTTP 200 means the branch
   currently exists; HTTP 404 means it does not.

A conflict response uses HTTP 409 with structured detail:

```json
{
  "code": "branch_conflict",
  "message": "该提交头已经使用，是否覆盖原分支和 Draft PR？",
  "branch": "web/sourcecode/c-polymorphism",
  "can_overwrite": true
}
```

The editor recognizes this response and displays a confirmation prompt.

## Overwrite Authorization

Overwrite is allowed only when the local submission record belongs to the current
user. A branch that exists only on GitHub, or belongs to another site user, cannot
be overwritten through the editor. The user must choose another submission head
or ask an administrator to resolve the remote branch.

This ownership check prevents a user from claiming a manually created or another
contributor's branch merely by entering the same custom head.

## Overwrite Behavior

After confirmation, the server:

1. Revalidates every draft against the current `main` tree.
2. Creates a new commit whose parent is the current `main`.
3. Force-updates the user's existing `web/...` branch to that commit.
4. Searches for an open pull request whose head is that branch.
5. Updates and reuses the open pull request when found.
6. Creates a new Draft PR only when no open pull request exists.
7. Clears the user's drafts only after the branch and pull request operations
   succeed.

Overwriting never writes directly to `main`. Repository review and branch
protection remain in effect.

## Retry and Race Handling

A failed submission can retry the same head without confirmation when no remote
branch exists. If the branch appears between preflight and creation, the GitHub
layer returns another structured conflict. A newly inserted local submission
record is removed in that race case, so an unknown GitHub branch cannot become
owned simply through a failed attempt.
