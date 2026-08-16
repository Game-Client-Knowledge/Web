from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from .config import Settings

API_VERSION = "2022-11-28"
MAX_EDITABLE_FILE_BYTES = 512 * 1024


class GitHubError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class SubmissionResult:
    branch: str
    commit_sha: str
    pr_number: int
    pr_url: str


class GitHubClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _headers(self, token: str | None = None) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": API_VERSION,
            "User-Agent": "game-client-knowledge-editor/1.0",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        expected: tuple[int, ...] = (200,),
        **kwargs: Any,
    ) -> httpx.Response:
        async with httpx.AsyncClient(
            base_url="https://api.github.com",
            timeout=httpx.Timeout(25.0),
            follow_redirects=True,
            headers=self._headers(token),
        ) as client:
            response = await client.request(method, path, **kwargs)

        if response.status_code not in expected:
            try:
                detail = response.json().get("message", response.text)
            except Exception:
                detail = response.text
            raise GitHubError(
                f"GitHub API {method} {path} failed "
                f"(HTTP {response.status_code}): {detail}",
                status_code=409 if response.status_code in {409, 422} else 502,
            )
        return response

    async def main_reference(self, token: str | None = None) -> dict[str, Any]:
        response = await self._request(
            "GET",
            f"/repos/{self.settings.github_repo}/git/ref/heads/main",
            token=token,
        )
        return response.json()

    async def repository_tree(
        self,
        *,
        ref: str = "main",
        token: str | None = None,
    ) -> list[dict[str, Any]]:
        response = await self._request(
            "GET",
            f"/repos/{self.settings.github_repo}/git/trees/{ref}",
            token=token or self.settings.github_bot_token or None,
            params={"recursive": "1"},
        )
        return [
            item
            for item in response.json().get("tree", [])
            if item.get("type") == "blob"
        ]

    async def repository_file(self, path: str) -> dict[str, Any]:
        response = await self._request(
            "GET",
            (
                f"/repos/{self.settings.github_repo}/contents/"
                f"{quote(path, safe='/')}"
            ),
            token=self.settings.github_bot_token or None,
            params={"ref": "main"},
        )
        payload = response.json()
        if int(payload.get("size", 0)) > MAX_EDITABLE_FILE_BYTES:
            raise GitHubError("文件超过在线编辑大小限制", 413)
        try:
            encoded = "".join(str(payload.get("content", "")).split())
            content = base64.b64decode(
                encoded,
                validate=True,
            ).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError) as exc:
            raise GitHubError("文件不是可编辑的 UTF-8 文本", 422) from exc
        return {
            "path": path,
            "sha": payload["sha"],
            "content": content,
            "html_url": payload.get("html_url"),
        }

    async def user_profile(self, token: str) -> dict[str, Any]:
        response = await self._request("GET", "/user", token=token)
        return response.json()

    async def user_emails(self, token: str) -> list[dict[str, Any]]:
        response = await self._request("GET", "/user/emails", token=token)
        return response.json()

    async def exchange_oauth_code(
        self,
        code: str,
        code_verifier: str,
    ) -> str:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(20.0),
            headers={
                "Accept": "application/json",
                "User-Agent": "game-client-knowledge-editor/1.0",
            },
        ) as client:
            response = await client.post(
                "https://github.com/login/oauth/access_token",
                data={
                    "client_id": self.settings.github_client_id,
                    "client_secret": self.settings.github_client_secret,
                    "code": code,
                    "redirect_uri": (
                        f"{self.settings.base_url}/api/auth/github/callback"
                    ),
                    "code_verifier": code_verifier,
                },
            )
        payload = response.json()
        token = payload.get("access_token")
        if response.status_code != 200 or not token:
            raise GitHubError(
                f"GitHub OAuth exchange failed: "
                f"{payload.get('error_description', payload.get('error', 'unknown error'))}"
            )
        return str(token)

    async def submit(
        self,
        *,
        token: str,
        branch: str,
        title: str,
        description: str,
        changes: list[dict[str, Any]],
        author: dict[str, str] | None,
        actor_label: str,
        expected_parent_sha: str,
    ) -> SubmissionResult:
        repo_path = f"/repos/{self.settings.github_repo}"

        existing = await self._request(
            "GET",
            f"{repo_path}/git/ref/heads/{branch}",
            token=token,
            expected=(200, 404),
        )
        if existing.status_code == 200:
            raise GitHubError(f"分支 {branch} 已存在，请更换提交头", 409)

        main_ref = await self.main_reference(token)
        parent_sha = main_ref["object"]["sha"]
        if parent_sha != expected_parent_sha:
            raise GitHubError("main 已发生变化，请重新检查草稿后提交", 409)
        parent_commit = await self._request(
            "GET",
            f"{repo_path}/git/commits/{parent_sha}",
            token=token,
        )
        base_tree = parent_commit.json()["tree"]["sha"]

        tree_entries: list[dict[str, Any]] = []
        for change in changes:
            if change["operation"] == "delete":
                tree_entries.append(
                    {
                        "path": change["path"],
                        "mode": "100644",
                        "type": "blob",
                        "sha": None,
                    }
                )
                continue

            blob = await self._request(
                "POST",
                f"{repo_path}/git/blobs",
                token=token,
                expected=(201,),
                json={"content": change["content"], "encoding": "utf-8"},
            )
            tree_entries.append(
                {
                    "path": change["path"],
                    "mode": "100644",
                    "type": "blob",
                    "sha": blob.json()["sha"],
                }
            )

        tree = await self._request(
            "POST",
            f"{repo_path}/git/trees",
            token=token,
            expected=(201,),
            json={"base_tree": base_tree, "tree": tree_entries},
        )
        commit_payload: dict[str, Any] = {
            "message": title,
            "tree": tree.json()["sha"],
            "parents": [parent_sha],
        }
        if author:
            commit_payload["author"] = author

        commit = await self._request(
            "POST",
            f"{repo_path}/git/commits",
            token=token,
            expected=(201,),
            json=commit_payload,
        )
        commit_sha = commit.json()["sha"]

        await self._request(
            "POST",
            f"{repo_path}/git/refs",
            token=token,
            expected=(201,),
            json={"ref": f"refs/heads/{branch}", "sha": commit_sha},
        )

        pr_body = (
            f"{description.strip()}\n\n"
            "---\n"
            f"Submitted from Game Client Knowledge Web Editor by {actor_label}.\n"
            f"Branch: `{branch}`"
        ).strip()
        try:
            pull = await self._request(
                "POST",
                f"{repo_path}/pulls",
                token=token,
                expected=(201,),
                json={
                    "title": title,
                    "body": pr_body,
                    "head": branch,
                    "base": "main",
                    "draft": True,
                },
            )
        except GitHubError:
            try:
                await self._request(
                    "DELETE",
                    f"{repo_path}/git/refs/heads/{branch}",
                    token=token,
                    expected=(204,),
                )
            except GitHubError:
                pass
            raise
        payload = pull.json()
        return SubmissionResult(
            branch=branch,
            commit_sha=commit_sha,
            pr_number=int(payload["number"]),
            pr_url=str(payload["html_url"]),
        )
