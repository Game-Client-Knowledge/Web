from __future__ import annotations

import asyncio
import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.github import BranchConflictError, GitHubClient, GitHubError


def test_oauth_web_origin_uses_tls_verified_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = []

    class FakeClient:
        def __init__(self, **kwargs):
            self.instance = len(
                [call for call in calls if call[0] == "client"]
            )
            calls.append(("client", kwargs, self.instance))

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def aclose(self):
            calls.append(("close", self.instance))

        async def post(self, url, **kwargs):
            calls.append(("post", url, kwargs, self.instance))
            if url.startswith("https://github.com/"):
                raise httpx.ConnectTimeout(
                    "blocked route",
                    request=httpx.Request("POST", url),
                )
            if kwargs["data"]["client_id"] == "transport-probe":
                return httpx.Response(404, json={"error": "Not Found"})
            return httpx.Response(200, json={"access_token": "oauth-token"})

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    client = GitHubClient(SimpleNamespace())

    response, origin_type = asyncio.run(
        client._oauth_token_response(
            {
                "client_id": "client-id",
                "client_secret": "client-secret",
                "code": "one-time-code",
                "redirect_uri": "https://example.test/callback",
                "code_verifier": "pkce-verifier",
            }
        )
    )

    assert response.json()["access_token"] == "oauth-token"
    assert origin_type == "verified-fallback"
    fallback_calls = [
        call for call in calls
        if call[0] == "post" and call[1].startswith("https://140.")
    ]
    probe_calls = [
        call for call in fallback_calls
        if call[2]["data"]["client_id"] == "transport-probe"
    ]
    real_calls = [
        call for call in fallback_calls
        if call[2]["data"]["client_id"] == "client-id"
    ]
    assert len(probe_calls) >= 1
    assert len(real_calls) == 1
    real_call = real_calls[0]
    winning_probe = next(
        call for call in probe_calls if call[3] == real_call[3]
    )
    assert winning_probe[2]["extensions"] == {
        "sni_hostname": "github.com"
    }
    assert winning_probe[2]["data"] == {
        "client_id": "transport-probe",
        "code": "transport-probe",
    }
    assert real_call[2]["data"]["code"] == "one-time-code"
    fallback_client = next(
        call for call in calls
        if call[0] == "client" and call[2] == real_call[3]
    )
    assert fallback_client[1]["trust_env"] is False
    assert fallback_client[1]["headers"]["Host"] == "github.com"


def test_oauth_exchange_posts_code_once_to_selected_origin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = SimpleNamespace(
        github_client_id="client-id",
        github_client_secret="client-secret",
        base_url="https://example.test/editor",
    )
    client = GitHubClient(settings)
    client._oauth_token_response = AsyncMock(
        return_value=(
            httpx.Response(200, json={"access_token": "oauth-token"}),
            "verified-fallback",
        )
    )
    monkeypatch.setattr(
        "app.github.urllib.request.urlopen",
        lambda *args, **kwargs: SimpleNamespace(read=lambda: b""),
    )

    token = asyncio.run(
        client.exchange_oauth_code("one-time-code", "pkce-verifier")
    )

    assert token == "oauth-token"
    client._oauth_token_response.assert_awaited_once()
    request = client._oauth_token_response.await_args.args[0]
    assert request["code"] == "one-time-code"
    assert request["code_verifier"] == "pkce-verifier"


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


def test_repository_blob_loads_historical_utf8_content() -> None:
    source = "# Historical\n\nBase revision.\n"
    settings = SimpleNamespace(
        github_repo="owner/repository",
        github_bot_token="bot-token",
    )
    client = GitHubClient(settings)
    client._request = AsyncMock(
        return_value=httpx.Response(
            200,
            json={
                "sha": "base-sha",
                "size": len(source.encode("utf-8")),
                "content": base64.b64encode(
                    source.encode("utf-8")
                ).decode("ascii"),
            },
        )
    )

    result = asyncio.run(
        client.repository_blob("base-sha", "user-token")
    )

    assert result == source
    request = client._request.await_args
    assert request.args[:2] == (
        "GET",
        "/repos/owner/repository/git/blobs/base-sha",
    )
    assert request.kwargs["token"] == "user-token"


def test_repository_changes_returns_bounded_release_summary() -> None:
    base = "a" * 40
    head = "b" * 40
    settings = SimpleNamespace(
        github_repo="owner/repository",
        github_bot_token="bot-token",
    )
    client = GitHubClient(settings)
    client._request = AsyncMock(
        return_value=httpx.Response(
            200,
            json={
                "status": "ahead",
                "base_commit": {"sha": base},
                "merge_base_commit": {"sha": base},
                "head_commit": {"sha": head},
                "total_commits": 2,
                "commits": [
                    {
                        "sha": "c" * 40,
                        "author": {"login": "alice"},
                        "commit": {
                            "message": "Add ECS notes\n\nDetails",
                            "author": {
                                "name": "Alice",
                                "date": "2026-08-25T12:00:00Z",
                            },
                        },
                    }
                ],
                "files": [
                    {
                        "filename": "program/knowledge/ecs/new.md",
                        "status": "added",
                        "additions": 12,
                        "deletions": 0,
                        "changes": 12,
                    }
                ],
            },
        )
    )

    result = asyncio.run(client.repository_changes(base, head))

    assert result["from_revision"] == base
    assert result["to_revision"] == head
    assert result["total_commits"] == 2
    assert result["truncated"] is True
    assert result["commits"][0]["message"] == "Add ECS notes"
    assert result["commits"][0]["author"] == "alice"
    assert result["files"] == [
        {
            "path": "program/knowledge/ecs/new.md",
            "previous_path": "",
            "status": "added",
            "additions": 12,
            "deletions": 0,
            "changes": 12,
        }
    ]
    request = client._request.await_args
    assert request.args == (
        "GET",
        f"/repos/owner/repository/compare/{base}...{head}",
    )
    assert request.kwargs["token"] == "bot-token"


def test_repository_parent_revision_uses_deployed_commit() -> None:
    head = "b" * 40
    parent = "a" * 40
    settings = SimpleNamespace(
        github_repo="owner/repository",
        github_bot_token="bot-token",
    )
    client = GitHubClient(settings)
    client._request = AsyncMock(
        return_value=httpx.Response(
            200,
            json={"parents": [{"sha": parent}]},
        )
    )

    result = asyncio.run(client.repository_parent_revision(head))

    assert result == parent
    request = client._request.await_args
    assert request.args == (
        "GET",
        f"/repos/owner/repository/commits/{head}",
    )
    assert request.kwargs["token"] == "bot-token"


def test_external_pull_discovery_uses_bounded_github_queries() -> None:
    settings = SimpleNamespace(github_repo="owner/repository")
    client = GitHubClient(settings)
    client._request = AsyncMock(
        side_effect=[
            httpx.Response(200, json=[{"number": 4}]),
            httpx.Response(200, json=[{"sha": "commit"}]),
            httpx.Response(
                200,
                json={"login": "contributor", "email": "user@example.test"},
            ),
        ]
    )

    pulls = asyncio.run(
        client.list_pull_requests("token", state="all", per_page=500)
    )
    commits = asyncio.run(client.pull_request_commits(4, "token"))
    profile = asyncio.run(client.public_user("contributor", "token"))

    assert pulls == [{"number": 4}]
    assert commits == [{"sha": "commit"}]
    assert profile["email"] == "user@example.test"
    calls = client._request.await_args_list
    assert calls[0].kwargs["params"] == {
        "state": "all",
        "sort": "updated",
        "direction": "desc",
        "per_page": 100,
    }
    assert calls[1].args[1].endswith("/pulls/4/commits")
    assert calls[2].args[1].endswith("/users/contributor")


def test_submit_rejects_existing_branch_without_overwrite() -> None:
    settings = SimpleNamespace(
        github_repo="owner/repository",
        github_owner="owner",
    )
    client = GitHubClient(settings)
    client._request = AsyncMock(
        side_effect=[
            httpx.Response(
                200,
                json={
                    "status": "ahead",
                    "base_commit": {
                        "sha": "base-commit",
                        "commit": {"tree": {"sha": "base-tree"}},
                    },
                    "merge_base_commit": {"sha": "base-commit"},
                },
            ),
            httpx.Response(201, json={"sha": "blob"}),
            httpx.Response(201, json={"sha": "tree"}),
            httpx.Response(201, json={"sha": "commit"}),
            httpx.Response(422, json={"message": "Reference already exists"}),
        ]
    )

    with pytest.raises(BranchConflictError):
        asyncio.run(
            client.submit(
                token="token",
                branch="web/user/existing",
                base_commit="base-commit",
                commit_message="Existing",
                pr_title="Existing",
                pr_body="",
                pr_base="main",
                draft=True,
                changes=[
                    {
                        "path": "knowledge/cpp/existing.md",
                        "operation": "upsert",
                        "content": "# Existing\n",
                    }
                ],
                author=None,
                actor_label="user",
            )
        )


def test_pull_request_base_commit_must_be_main_ancestor() -> None:
    settings = SimpleNamespace(github_repo="owner/repository")
    client = GitHubClient(settings)
    client._request = AsyncMock(
        return_value=httpx.Response(
            200,
            json={
                "status": "diverged",
                "base_commit": {
                    "sha": "feature-commit",
                    "commit": {"tree": {"sha": "feature-tree"}},
                },
                "merge_base_commit": {"sha": "older-common-commit"},
            },
        )
    )

    with pytest.raises(GitHubError, match="不属于 main 的历史"):
        asyncio.run(
            client.pull_request_base_commit(
                "feature-commit",
                "main",
                "token",
            )
        )


def test_submit_creates_branch_from_historical_main_commit() -> None:
    settings = SimpleNamespace(
        github_repo="owner/repository",
        github_owner="owner",
    )
    client = GitHubClient(settings)
    client._request = AsyncMock(
        side_effect=[
            httpx.Response(
                200,
                json={
                    "status": "ahead",
                    "ahead_by": 3,
                    "base_commit": {
                        "sha": "historical-main",
                        "commit": {"tree": {"sha": "historical-tree"}},
                    },
                    "merge_base_commit": {"sha": "historical-main"},
                },
            ),
            httpx.Response(201, json={"sha": "changed-blob"}),
            httpx.Response(201, json={"sha": "changed-tree"}),
            httpx.Response(201, json={"sha": "branch-commit"}),
            httpx.Response(201, json={"object": {"sha": "branch-commit"}}),
            httpx.Response(
                201,
                json={
                    "number": 74,
                    "html_url": "https://github.example/pull/74",
                },
            ),
        ]
    )

    result = asyncio.run(
        client.submit(
            token="token",
            branch="web/user/historical-base",
            base_commit="historical-main",
            commit_message="docs: edit from historical base",
            pr_title="Historical base edit",
            pr_body="Let GitHub report conflicts.",
            pr_base="main",
            draft=True,
            changes=[
                {
                    "path": "knowledge/cpp/example.md",
                    "operation": "upsert",
                    "content": "# Example changed\n",
                }
            ],
            author=None,
            actor_label="user",
        )
    )

    assert result.commit_sha == "branch-commit"
    calls = client._request.await_args_list
    tree_call = calls[2]
    assert tree_call.kwargs["json"]["base_tree"] == "historical-tree"
    commit_call = calls[3]
    assert commit_call.kwargs["json"]["parents"] == ["historical-main"]
    pr_call = calls[5]
    assert pr_call.kwargs["json"] == {
        "title": "Historical base edit",
        "body": (
            "Let GitHub report conflicts.\n\n---\n"
            "Submitted from Game Client Knowledge Web Editor by user.\n"
            "Branch: `web/user/historical-base`"
        ),
        "head": "web/user/historical-base",
        "base": "main",
        "draft": True,
    }


def test_submit_overwrites_branch_and_reuses_open_pull_request() -> None:
    settings = SimpleNamespace(
        github_repo="owner/repository",
        github_owner="owner",
    )
    client = GitHubClient(settings)
    client._request = AsyncMock(
        side_effect=[
            httpx.Response(
                200,
                json={
                    "status": "ahead",
                    "base_commit": {
                        "sha": "base-commit",
                        "commit": {"tree": {"sha": "base-tree"}},
                    },
                    "merge_base_commit": {"sha": "base-commit"},
                },
            ),
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
            base_commit="base-commit",
            commit_message="Replacement",
            pr_title="Replacement PR",
            pr_body="Updated content",
            pr_base="main",
            draft=True,
            changes=[
                {
                    "path": "knowledge/cpp/example.md",
                    "operation": "upsert",
                    "content": "# Example\n",
                }
            ],
            author=None,
            actor_label="user",
            force_update=True,
        )
    )

    assert result.commit_sha == "new-commit"
    assert result.pr_number == 73
    calls = client._request.await_args_list
    compare = calls[0]
    assert compare.args[:2] == (
        "GET",
        "/repos/owner/repository/compare/base-commit...main",
    )
    assert compare.kwargs["params"] == {"per_page": 1, "page": 2}
    ref_update = calls[4]
    assert ref_update.args[0] == "PATCH"
    assert ref_update.args[1].endswith(
        "/git/refs/heads/web/user/existing"
    )
    assert ref_update.kwargs["json"] == {
        "sha": "new-commit",
        "force": True,
    }
    pull_lookup = calls[5]
    assert pull_lookup.args[:2] == (
        "GET",
        "/repos/owner/repository/pulls",
    )
    assert pull_lookup.kwargs["params"] == {
        "head": "owner:web/user/existing",
        "state": "open",
    }
    pull_update = calls[6]
    assert pull_update.args[:2] == (
        "PATCH",
        "/repos/owner/repository/pulls/73",
    )
    assert pull_update.kwargs["json"]["title"] == "Replacement PR"
