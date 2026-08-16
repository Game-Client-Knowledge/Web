from __future__ import annotations

import asyncio
import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.github import BranchConflictError, GitHubClient


def test_repository_file_accepts_github_wrapped_base64() -> None:
    source = "# Existing file\n\nGitHub wraps Base64 output.\n"
    payload = {
        "path": "knowledge/cpp/a file/README.md",
        "sha": "blob-sha",
        "size": len(source.encode("utf-8")),
        "content": base64.encodebytes(source.encode("utf-8")).decode("ascii"),
        "html_url": "https://github.example/file",
    }
    settings = SimpleNamespace(
        github_repo="owner/repository",
        github_bot_token="token",
    )
    client = GitHubClient(settings)
    client._request = AsyncMock(
        return_value=httpx.Response(200, json=payload)
    )

    result = asyncio.run(
        client.repository_file("knowledge/cpp/a file/README.md")
    )

    assert result["content"] == source
    assert client._request.await_args.args[1].endswith(
        "/contents/knowledge/cpp/a%20file/README.md"
    )


def test_submit_rejects_existing_branch_without_overwrite() -> None:
    settings = SimpleNamespace(
        github_repo="owner/repository",
        github_owner="owner",
    )
    client = GitHubClient(settings)
    client._request = AsyncMock(
        return_value=httpx.Response(200, json={"object": {"sha": "old"}})
    )

    with pytest.raises(BranchConflictError):
        asyncio.run(
            client.submit(
                token="token",
                branch="web/user/existing",
                title="Existing",
                description="",
                changes=[],
                author=None,
                actor_label="user",
                expected_parent_sha="main",
            )
        )


def test_submit_overwrites_branch_and_reuses_open_pull_request() -> None:
    settings = SimpleNamespace(
        github_repo="owner/repository",
        github_owner="owner",
    )
    client = GitHubClient(settings)
    client._request = AsyncMock(
        side_effect=[
            httpx.Response(200, json={"object": {"sha": "old-commit"}}),
            httpx.Response(200, json={"object": {"sha": "main-commit"}}),
            httpx.Response(200, json={"tree": {"sha": "base-tree"}}),
            httpx.Response(201, json={"sha": "new-blob"}),
            httpx.Response(201, json={"sha": "new-tree"}),
            httpx.Response(201, json={"sha": "new-commit"}),
            httpx.Response(200, json={"object": {"sha": "new-commit"}}),
            httpx.Response(200, json=[{"number": 73}]),
            httpx.Response(
                200,
                json={
                    "number": 73,
                    "html_url": "https://github.example/pull/73",
                },
            ),
        ]
    )

    result = asyncio.run(
        client.submit(
            token="token",
            branch="web/user/existing",
            title="Replacement",
            description="Updated content",
            changes=[
                {
                    "path": "knowledge/cpp/example.md",
                    "operation": "upsert",
                    "content": "# Example\n",
                }
            ],
            author=None,
            actor_label="user",
            expected_parent_sha="main-commit",
            overwrite=True,
        )
    )

    assert result.commit_sha == "new-commit"
    assert result.pr_number == 73
    calls = client._request.await_args_list
    ref_update = calls[6]
    assert ref_update.args[0] == "PATCH"
    assert ref_update.args[1].endswith(
        "/git/refs/heads/web/user/existing"
    )
    assert ref_update.kwargs["json"] == {
        "sha": "new-commit",
        "force": True,
    }
    pull_lookup = calls[7]
    assert pull_lookup.args[:2] == (
        "GET",
        "/repos/owner/repository/pulls",
    )
    assert pull_lookup.kwargs["params"] == {
        "head": "owner:web/user/existing",
        "state": "open",
    }
    pull_update = calls[8]
    assert pull_update.args[:2] == (
        "PATCH",
        "/repos/owner/repository/pulls/73",
    )
