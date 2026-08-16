from __future__ import annotations

import asyncio
import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx

from app.github import GitHubClient


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
