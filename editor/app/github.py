from __future__ import annotations

import base64
import binascii
import json
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx

from .config import Settings

API_VERSION = "2022-11-28"
MAX_EDITABLE_FILE_BYTES = 512 * 1024
OAUTH_WEB_FALLBACK_IPS = (
    "140.82.112.4",
    "140.82.113.4",
    "140.82.114.4",
    "140.82.116.4",
    "140.82.121.4",
)


class GitHubError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class BranchConflictError(GitHubError):
    def __init__(self, branch: str) -> None:
        super().__init__(f"分支 {branch} 已存在", 409)
        self.branch = branch


@dataclass(frozen=True)
class SubmissionResult:
    branch: str
    commit_sha: str
    pr_number: int
    pr_url: str
    pr_updated_at: str | None = None


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
        try:
            async with httpx.AsyncClient(
                base_url="https://api.github.com",
                timeout=httpx.Timeout(25.0),
                follow_redirects=True,
                headers=self._headers(token),
            ) as client:
                response = await client.request(method, path, **kwargs)
        except httpx.RequestError as exc:
            raise GitHubError(
                "GitHub API 暂时无法连接，请稍后重试",
                status_code=503,
            ) from exc

        # #region debug-point E:github-response
        exec("try:\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.185:7777/event',data=json.dumps({'sessionId':'oauth-submit-failures','runId':'post-fix','hypothesisId':'E','location':'github.py:_request','msg':'[DEBUG] GitHub API response','data':{'method':method,'path':path,'status':response.status_code,'oauthScopes':response.headers.get('X-OAuth-Scopes'),'acceptedScopes':response.headers.get('X-Accepted-OAuth-Scopes'),'rateRemaining':response.headers.get('X-RateLimit-Remaining')},'ts':int(datetime.now(timezone.utc).timestamp()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
        # #endregion
        if response.status_code not in expected:
            try:
                detail = response.json().get("message", response.text)
            except Exception:
                detail = response.text
            if (
                response.status_code == 403
                and "personal access token" in str(detail).lower()
            ):
                detail = (
                    "提交 token 缺少仓库写权限；请授予 "
                    "Contents: Read and write 与 Pull requests: Read and write"
                )
            raise GitHubError(
                f"GitHub API {method} {path} failed "
                f"(HTTP {response.status_code}): {detail}",
                status_code=(
                    409
                    if response.status_code in {409, 422}
                    else response.status_code
                    if response.status_code in {401, 403, 404, 429}
                    else 502
                ),
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

    async def branch_exists(
        self,
        branch: str,
        token: str,
    ) -> bool:
        response = await self._request(
            "GET",
            (
                f"/repos/{self.settings.github_repo}/git/ref/heads/"
                f"{quote(branch, safe='/')}"
            ),
            token=token,
            expected=(200, 404),
        )
        return response.status_code == 200

    async def pull_request(
        self,
        number: int,
        token: str,
    ) -> dict[str, Any]:
        response = await self._request(
            "GET",
            f"/repos/{self.settings.github_repo}/pulls/{number}",
            token=token,
        )
        return response.json()

    async def list_pull_requests(
        self,
        token: str,
        *,
        state: str = "all",
        per_page: int = 100,
    ) -> list[dict[str, Any]]:
        if state not in {"open", "closed", "all"}:
            raise ValueError("Pull request state must be open, closed, or all")
        response = await self._request(
            "GET",
            f"/repos/{self.settings.github_repo}/pulls",
            token=token,
            params={
                "state": state,
                "sort": "updated",
                "direction": "desc",
                "per_page": max(1, min(100, per_page)),
            },
        )
        return list(response.json())

    async def pull_request_commits(
        self,
        number: int,
        token: str,
    ) -> list[dict[str, Any]]:
        response = await self._request(
            "GET",
            f"/repos/{self.settings.github_repo}/pulls/{number}/commits",
            token=token,
            params={"per_page": 100},
        )
        return list(response.json())

    async def public_user(
        self,
        login: str,
        token: str,
    ) -> dict[str, Any]:
        response = await self._request(
            "GET",
            f"/users/{quote(login, safe='')}",
            token=token,
        )
        return response.json()

    async def update_pull_state(
        self,
        number: int,
        state: str,
        token: str,
    ) -> dict[str, Any]:
        if state not in {"open", "closed"}:
            raise ValueError("Pull request state must be open or closed")
        response = await self._request(
            "PATCH",
            f"/repos/{self.settings.github_repo}/pulls/{number}",
            token=token,
            json={"state": state},
        )
        return response.json()

    async def user_profile(self, token: str) -> dict[str, Any]:
        response = await self._request("GET", "/user", token=token)
        return response.json()

    async def user_emails(self, token: str) -> list[dict[str, Any]]:
        response = await self._request("GET", "/user/emails", token=token)
        return response.json()

    async def _oauth_token_response(
        self,
        data: dict[str, str],
    ) -> tuple[httpx.Response, str]:
        candidates = [
            ("https://github.com", {}, {}),
            *[
                (
                    f"https://{address}",
                    {"Host": "github.com"},
                    {"sni_hostname": "github.com"},
                )
                for address in OAUTH_WEB_FALLBACK_IPS
            ],
        ]
        for origin, headers, extensions in candidates:
            selected = False
            try:
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(5.0),
                    trust_env=False,
                    headers={
                        "Accept": "application/json",
                        "User-Agent": "game-client-knowledge-editor/1.0",
                        **headers,
                    },
                ) as client:
                    response = await client.post(
                        f"{origin}/login/oauth/access_token",
                        data={
                            "client_id": "transport-probe",
                            "code": "transport-probe",
                        },
                        extensions=extensions,
                    )
                    selected = response.status_code < 500
                    if selected:
                        response = await client.post(
                            f"{origin}/login/oauth/access_token",
                            data=data,
                            extensions=extensions,
                        )
            except httpx.RequestError:
                if selected:
                    raise
                continue
            if selected:
                return (
                    response,
                    "domain"
                    if origin == "https://github.com"
                    else "verified-fallback",
                )
        raise GitHubError(
            "无法连接 GitHub 授权服务，请重试",
            status_code=503,
        )

    async def exchange_oauth_code(
        self,
        code: str,
        code_verifier: str,
    ) -> str:
        # #region debug-point A-C:oauth-transport-start
        import time as _oauth_debug_time
        _oauth_debug_started = _oauth_debug_time.monotonic()
        exec("try:\n import os,socket\n _oauth_addresses=sorted({item[4][0] for item in socket.getaddrinfo('github.com',443,type=socket.SOCK_STREAM)})\n _oauth_proxy_keys=sorted(key for key in os.environ if 'proxy' in key.lower())\n urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:7777/event',data=json.dumps({'sessionId':'github-oauth-timeout','runId':'post-fix','hypothesisId':'A,B,C','location':'github.py:exchange_oauth_code:start','msg':'[DEBUG] OAuth transport starting','data':{'addresses':_oauth_addresses,'proxyKeys':_oauth_proxy_keys,'clientIdConfigured':bool(self.settings.github_client_id),'clientSecretConfigured':bool(self.settings.github_client_secret),'probeTimeoutSeconds':3},'ts':int(datetime.now(timezone.utc).timestamp()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
        # #endregion
        # #region debug-point C:oauth-exchange-start
        exec("try:\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.185:7777/event',data=json.dumps({'sessionId':'oauth-submit-failures','runId':'post-fix','hypothesisId':'C','location':'github.py:exchange_oauth_code','msg':'[DEBUG] OAuth token exchange started','data':{'baseUrl':self.settings.base_url},'ts':int(datetime.now(timezone.utc).timestamp()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
        # #endregion
        try:
            response, origin_type = await self._oauth_token_response(
                {
                    "client_id": self.settings.github_client_id,
                    "client_secret": self.settings.github_client_secret,
                    "code": code,
                    "redirect_uri": (
                        f"{self.settings.base_url}/api/auth/github/callback"
                    ),
                    "code_verifier": code_verifier,
                }
            )
            # #region debug-point A:oauth-origin-selected
            exec("try:\n urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:7777/event',data=json.dumps({'sessionId':'github-oauth-timeout','runId':'post-fix','hypothesisId':'A','location':'github.py:exchange_oauth_code:origin','msg':'[DEBUG] OAuth web origin selected','data':{'originType':origin_type,'elapsedMs':round((_oauth_debug_time.monotonic()-_oauth_debug_started)*1000)},'ts':int(datetime.now(timezone.utc).timestamp()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
            # #endregion
        except Exception as exc:
            # #region debug-point A-C-E:oauth-transport-error
            exec("try:\n _cause=exc.__cause__\n urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:7777/event',data=json.dumps({'sessionId':'github-oauth-timeout','runId':'post-fix','hypothesisId':'A,B,C,E','location':'github.py:exchange_oauth_code:except','msg':'[DEBUG] OAuth transport failed','data':{'elapsedMs':round((_oauth_debug_time.monotonic()-_oauth_debug_started)*1000),'errorType':type(exc).__name__,'error':str(exc)[:300],'causeType':type(_cause).__name__ if _cause else None,'cause':str(_cause)[:300] if _cause else None},'ts':int(datetime.now(timezone.utc).timestamp()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
            # #endregion
            # #region debug-point C:oauth-exchange-error
            exec("try:\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.185:7777/event',data=json.dumps({'sessionId':'oauth-submit-failures','runId':'post-fix','hypothesisId':'C','location':'github.py:exchange_oauth_code-except','msg':'[DEBUG] OAuth token exchange transport error','data':{'errorType':type(exc).__name__,'error':str(exc)[:300]},'ts':int(datetime.now(timezone.utc).timestamp()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
            # #endregion
            if isinstance(exc, (httpx.RequestError, GitHubError)):
                raise GitHubError(
                    "无法连接 GitHub 授权服务，请重试",
                    status_code=503,
                ) from exc
            raise
        # #region debug-point D-E:oauth-transport-response
        exec("try:\n _payload=response.json()\n urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:7777/event',data=json.dumps({'sessionId':'github-oauth-timeout','runId':'post-fix','hypothesisId':'D,E','location':'github.py:exchange_oauth_code:response','msg':'[DEBUG] OAuth transport received response','data':{'elapsedMs':round((_oauth_debug_time.monotonic()-_oauth_debug_started)*1000),'status':response.status_code,'hasAccessToken':bool(_payload.get('access_token')),'error':_payload.get('error')},'ts':int(datetime.now(timezone.utc).timestamp()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
        # #endregion
        # #region debug-point C:oauth-exchange-response
        exec("try:\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.185:7777/event',data=json.dumps({'sessionId':'oauth-submit-failures','runId':'post-fix','hypothesisId':'C','location':'github.py:exchange_oauth_code-response','msg':'[DEBUG] OAuth token exchange response','data':{'status':response.status_code,'hasAccessToken':bool(response.json().get('access_token')),'error':response.json().get('error')},'ts':int(datetime.now(timezone.utc).timestamp()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
        # #endregion
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
        overwrite: bool = False,
    ) -> SubmissionResult:
        repo_path = f"/repos/{self.settings.github_repo}"

        existing = await self._request(
            "GET",
            f"{repo_path}/git/ref/heads/{quote(branch, safe='/')}",
            token=token,
            expected=(200, 404),
        )
        branch_exists = existing.status_code == 200
        if branch_exists and not overwrite:
            raise BranchConflictError(branch)

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

        if branch_exists:
            await self._request(
                "PATCH",
                (
                    f"{repo_path}/git/refs/heads/"
                    f"{quote(branch, safe='/')}"
                ),
                token=token,
                json={"sha": commit_sha, "force": True},
            )
        else:
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
        pull = None
        if overwrite:
            open_pulls = await self._request(
                "GET",
                f"{repo_path}/pulls",
                token=token,
                params={
                    "head": f"{self.settings.github_owner}:{branch}",
                    "state": "open",
                },
            )
            matches = open_pulls.json()
            if matches:
                pull_number = int(matches[0]["number"])
                pull = await self._request(
                    "PATCH",
                    f"{repo_path}/pulls/{pull_number}",
                    token=token,
                    json={"title": title, "body": pr_body},
                )
        if pull is None:
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
                if not branch_exists:
                    try:
                        await self._request(
                            "DELETE",
                            (
                                f"{repo_path}/git/refs/heads/"
                                f"{quote(branch, safe='/')}"
                            ),
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
            pr_updated_at=payload.get("updated_at"),
        )
