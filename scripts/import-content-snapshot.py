#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import subprocess
import tempfile


def git(
    repo: str,
    *arguments: str,
    worktree: str | None = None,
    index: str | None = None,
    environment: dict[str, str] | None = None,
    quiet: bool = False,
) -> str:
    command = ["git", f"--git-dir={repo}"]
    if worktree:
        command.append(f"--work-tree={worktree}")
    command.extend(arguments)
    env = os.environ.copy()
    if index:
        env["GIT_INDEX_FILE"] = index
    if environment:
        env.update(environment)
    return subprocess.check_output(
        command,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        stderr=subprocess.DEVNULL if quiet else None,
    ).strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--worktree", required=True)
    parser.add_argument("--upstream-revision", required=True)
    parser.add_argument("--author-name", required=True)
    parser.add_argument("--author-email", required=True)
    parser.add_argument("--authored-at", required=True)
    arguments = parser.parse_args()

    reference = f"refs/gck-upstream/{arguments.upstream_revision}"
    try:
        print(
            git(
                arguments.repo,
                "rev-parse",
                "--verify",
                reference,
                quiet=True,
            )
        )
        return
    except subprocess.CalledProcessError:
        pass

    try:
        parent = git(
            arguments.repo,
            "rev-parse",
            "--verify",
            "refs/heads/main",
            quiet=True,
        )
    except subprocess.CalledProcessError:
        parent = ""

    descriptor, index_path = tempfile.mkstemp()
    os.close(descriptor)
    os.unlink(index_path)
    try:
        if parent:
            git(
                arguments.repo,
                "read-tree",
                parent,
                index=index_path,
            )
        else:
            git(
                arguments.repo,
                "read-tree",
                "--empty",
                index=index_path,
            )
        git(
            arguments.repo,
            "add",
            "-A",
            "--",
            ".",
            worktree=arguments.worktree,
            index=index_path,
        )
        tree = git(
            arguments.repo,
            "write-tree",
            index=index_path,
        )
    finally:
        if os.path.exists(index_path):
            os.unlink(index_path)

    identity = {
        "GIT_AUTHOR_NAME": arguments.author_name,
        "GIT_AUTHOR_EMAIL": arguments.author_email,
        "GIT_AUTHOR_DATE": arguments.authored_at,
        "GIT_COMMITTER_NAME": arguments.author_name,
        "GIT_COMMITTER_EMAIL": arguments.author_email,
        "GIT_COMMITTER_DATE": arguments.authored_at,
    }
    commit_arguments = ["commit-tree", tree]
    if parent:
        commit_arguments.extend(["-p", parent])
    commit = subprocess.check_output(
        ["git", f"--git-dir={arguments.repo}", *commit_arguments],
        input=f"Import upstream snapshot {arguments.upstream_revision}\n",
        text=True,
        encoding="utf-8",
        env={**os.environ, **identity},
    ).strip()
    git(arguments.repo, "update-ref", "refs/heads/main", commit)
    git(arguments.repo, "update-ref", reference, commit)
    print(commit)


if __name__ == "__main__":
    main()
