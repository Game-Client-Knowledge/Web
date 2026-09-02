from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import re
import secrets
import sqlite3
import urllib.request
from collections import defaultdict, deque
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.parse import urlencode, urlsplit

import bleach
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Request,
    Response,
)
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from markdown_it import MarkdownIt
from pydantic import BaseModel, Field

from .analytics import (
    DEVICE_COOKIE,
    DEVICE_COOKIE_MAX_AGE,
    analytics_dashboard,
    device_hash,
    new_device_token,
    normalize_content_entries,
    normalize_star_map_seconds,
    record_visit,
    valid_device_token,
)
from .comment_agent import (
    CommentAgentError,
    call_agent_api,
    normalize_agent_completion,
    process_comment_agent_request,
    recover_comment_agent_requests,
)
from .comment_agent_config import (
    COMMENT_AGENT_ACCESS_MODES,
    COMMENT_AGENT_PROTOCOLS,
    COMMENT_AGENT_TEMPLATE_IDS,
    COMMENT_AGENT_TEMPLATES,
    DEFAULT_COMMENT_AGENT_SYSTEM_PROMPT,
    comment_agent_public_payload,
    load_comment_agent_configuration,
    save_comment_agent_configuration,
    validate_agent_base_url,
)
from .comments import contribution_graph_payload, create_comments_router
from .config import Settings
from .database import Database, utc_now
from .github import (
    MAX_EDITABLE_FILE_BYTES,
    BranchConflictError,
    GitHubClient,
    GitHubError,
)
from .mailer import send_email
from .notifications import deliver_admin_email, deliver_email
from .pr_lifecycle import (
    auto_close_days,
    parse_github_time,
    reconcile_all_pull_requests,
    user_action_url,
)
from .security import (
    TRACK_ROOTS,
    TokenCipher,
    hash_password,
    is_valid_module_root,
    normalize_email,
    normalize_username,
    password_needs_rehash,
    random_token,
    slugify,
    token_hash,
    validate_content_path,
    validate_password,
    validate_repository_path,
    verify_password,
)
from .smtp_config import (
    SMTP_TEMPLATE_IDS,
    SMTP_TEMPLATES,
    load_smtp_configuration,
    save_smtp_configuration,
    smtp_public_payload,
)
from .site_updates import (
    UpdateAlreadyRunningError,
    queue_update,
    read_release_source,
    update_status,
)
from .star_formulas import (
    DEFAULT_STAR_BRIGHTNESS_RULES,
    DEFAULT_STAR_BRIGHTNESS_TIERS,
    STAR_FORMULA_TARGETS,
    resolved_star_brightness_rules as normalize_star_brightness_rules,
    resolved_star_brightness_tiers as normalize_star_brightness_tiers,
    validate_star_formula,
)

APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
SESSION_COOKIE = "gck_editor_session"
OAUTH_STATE_COOKIE = "gck_editor_oauth_state"
MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_DRAFT_BYTES = 512 * 1024
MAX_DRAFTS = 1000
STAR_ILLUMINATION_RULE_IDS = {
    "bfs",
    "depth",
    "reverse_depth",
    "bidirectional_depth",
    "bfs_contributor_terminal",
    "depth_contributor_terminal",
    "direct_neighbors",
    "strong_component",
    "reference_depth",
    "reference_sources_depth",
}


class RegisterRequest(BaseModel):
    email: str = Field(max_length=254)
    username: str = Field(max_length=32)
    password: str = Field(max_length=256)


class LoginRequest(BaseModel):
    identifier: str = Field(max_length=254)
    password: str = Field(max_length=256)


class PasswordRequest(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(max_length=256)


class DraftRequest(BaseModel):
    path: str = Field(max_length=240)
    content: str = Field(default="", max_length=MAX_DRAFT_BYTES)
    base_content: str | None = Field(default=None, max_length=MAX_DRAFT_BYTES)
    operation: str = Field(default="upsert")
    base_sha: str | None = Field(default=None, max_length=64)
    base_revision: int | None = Field(default=None, ge=0)


class TopicRequest(BaseModel):
    root: str
    parent: str = Field(default="", max_length=180)
    slug: str = Field(max_length=80)
    title: str = Field(max_length=120)
    description: str = Field(default="", max_length=500)


class TopLevelModuleRequest(BaseModel):
    slug: str = Field(max_length=80)
    title: str = Field(min_length=1, max_length=120)
    short_title: str = Field(min_length=1, max_length=20)
    description: str = Field(default="", max_length=500)
    icon: str = Field(default="folder-kanban", max_length=40)
    accent: str = Field(default="teal", max_length=20)
    allow_code: bool = False


class PreviewRequest(BaseModel):
    content: str = Field(max_length=MAX_DRAFT_BYTES)


class SubmitChangeRequest(BaseModel):
    path: str = Field(max_length=240)
    content: str = Field(default="", max_length=MAX_DRAFT_BYTES)
    operation: str = Field(default="upsert")


class SubmitRequest(BaseModel):
    base_commit: str = Field(pattern=r"^[0-9a-fA-F]{7,40}$")
    branch: str = Field(min_length=1, max_length=240)
    commit_message: str = Field(min_length=1, max_length=180)
    pr_title: str = Field(min_length=1, max_length=180)
    pr_body: str = Field(default="", max_length=5000)
    pr_base: str = Field(default="main", max_length=80)
    draft: bool = True
    force_update: bool = False
    changes: list[SubmitChangeRequest] = Field(
        min_length=1,
        max_length=MAX_DRAFTS,
    )


class AdminApplicationRequest(BaseModel):
    message: str = Field(min_length=10, max_length=1000)


class AdminDecisionRequest(BaseModel):
    decision: str


class AnnouncementRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=5000)
    priority: int = Field(default=0, ge=0, le=100)
    display_mode: str = Field(
        default="persistent",
        pattern=r"^(persistent|once)$",
    )


class AnnouncementUpdateRequest(BaseModel):
    active: bool | None = None
    priority: int | None = Field(default=None, ge=0, le=100)
    display_mode: str | None = Field(
        default=None,
        pattern=r"^(persistent|once)$",
    )


def module_root_for_path(value: str) -> str:
    parts = value.split("/")
    if parts and parts[0] in TRACK_ROOTS and len(parts) >= 2:
        return "/".join(parts[:2])
    return parts[0] if parts else ""


def is_module_readme_path(value: str) -> bool:
    parts = value.split("/")
    if parts and parts[0] in TRACK_ROOTS:
        return len(parts) == 3 and parts[-1] == "README.md"
    return len(parts) == 2 and parts[-1] == "README.md"


class SettingsRequest(BaseModel):
    edit_policy: str
    registration_enabled: bool
    pr_auto_close_days: int = Field(ge=0, le=365)
    session_idle_days: int = Field(default=30, ge=1, le=365)
    reader_edit_mode: str = "new"
    reader_diff_enabled: bool = True
    workspace_sync_interval_seconds: int = Field(
        default=60,
        ge=15,
        le=3600,
    )
    site_auto_update_interval_minutes: int = Field(
        default=10,
        ge=0,
        le=1440,
    )


class SiteUpdateRequest(BaseModel):
    mode: str


class StarBrightnessRuleRequest(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    name: str = Field(min_length=1, max_length=80)
    enabled: bool = True
    target: str
    formula: str = Field(min_length=1, max_length=500)


class StarBrightnessTierRequest(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    name: str = Field(min_length=1, max_length=80)
    min_brightness: float = Field(ge=0, le=100)
    max_count: int | None = Field(default=None, ge=0, le=10000)


class VisualSettingsRequest(BaseModel):
    catalog_background_style: str = "circuit"
    reader_background_style: str = "blueprint"
    pointer_effect_enabled: bool = True
    home_intro_enabled: bool = True
    home_intro_mode: str = ""
    home_intro_duration_ms: int = Field(default=3000, ge=1500, le=10000)
    home_intro_assembly_duration_ms: int | None = Field(
        default=None,
        ge=500,
        le=10000,
    )
    home_intro_hold_duration_ms: int | None = Field(
        default=None,
        ge=0,
        le=10000,
    )
    home_intro_lock_scroll: bool = True
    home_intro_contributor_limit: int = Field(default=8, ge=1, le=10)
    home_background_style: str = "old_star_map"
    home_content_mask_enabled: bool = False
    home_content_idle_timeout_seconds: int = Field(
        default=30,
        ge=0,
        le=3600,
    )
    home_star_scope: str = "hero"
    home_star_render_mode: str = "2d"
    home_star_experience_mode: str = "immersive"
    home_star_portal_collapsed_structure: str = "octahedron"
    home_star_portal_expanded_structure: str = "3d-drift"
    home_star_portal_rotation_speed: float = Field(
        default=2.6,
        ge=0,
        le=30,
    )
    home_star_portal_size_percent: float = Field(
        default=34,
        ge=10,
        le=100,
    )
    home_star_portal_brightness_percent: float = Field(
        default=42,
        ge=10,
        le=100,
    )
    home_star_relation_visibility: str = "near"
    home_star_strong_relation_style: str = "solid"
    home_star_reference_relation_style: str = "dashed"
    home_star_contributor_relation_style: str = "solid"
    home_star_hover_info_enabled: bool = True
    home_star_hover_relations_enabled: bool = True
    home_star_hover_relation_opacity_percent: float = Field(
        default=6,
        ge=1,
        le=25,
    )
    home_star_brightness_variation_enabled: bool = False
    home_star_brightness_min: float = Field(
        default=0.0,
        ge=0,
        le=100,
    )
    home_star_brightness_initial: float = Field(
        default=10.0,
        ge=0,
        le=100,
    )
    home_star_brightness_max: float = Field(
        default=100.0,
        ge=1,
        le=100,
    )
    home_star_brightness_variation_amount: float = Field(
        default=2.0,
        ge=0,
        le=20,
    )
    home_star_brightness_transition_ms: int = Field(
        default=900,
        ge=100,
        le=10000,
    )
    home_star_brightness_interval_ms: int = Field(
        default=2400,
        ge=200,
        le=30000,
    )
    home_star_color_random_enabled: bool = False
    home_star_graph_direction: str = "directed"
    home_star_illumination_rule: str = "bfs"
    home_star_illumination_depth: int = Field(default=3, ge=1, le=20)
    home_star_selection_duration_ms: int = Field(
        default=3000,
        ge=500,
        le=60000,
    )
    home_star_label_duration_ms: int = Field(
        default=3000,
        ge=500,
        le=60000,
    )
    home_star_selected_radius_boost: float = Field(
        default=1.0,
        ge=0,
        le=4,
    )
    home_star_selected_alpha_boost: float = Field(
        default=0.16,
        ge=0,
        le=0.5,
    )
    home_star_selected_halo_alpha_boost: float = Field(
        default=0.18,
        ge=0,
        le=0.5,
    )
    home_star_selected_glow_scale: float = Field(
        default=1.25,
        ge=1,
        le=3,
    )
    home_star_selected_contributor_line_width: float = Field(
        default=1.4,
        ge=0.5,
        le=4,
    )
    home_star_3d_min_depth: float = Field(
        default=280,
        ge=100,
        le=1000,
    )
    home_star_3d_halo_max_css_size: float = Field(
        default=200,
        ge=40,
        le=600,
    )
    home_star_3d_core_max_css_size: float = Field(
        default=36,
        ge=8,
        le=120,
    )
    home_star_3d_spike_max_css_size: float = Field(
        default=240,
        ge=40,
        le=800,
    )
    home_star_3d_pulse_max_css_size: float = Field(
        default=36,
        ge=8,
        le=120,
    )
    home_star_3d_field_enabled: bool = True
    home_star_3d_field_star_count: int = Field(
        default=320,
        ge=0,
        le=5000,
    )
    home_star_3d_dust_enabled: bool = True
    home_star_3d_dust_star_count: int = Field(
        default=1920,
        ge=0,
        le=3000,
    )
    home_star_3d_cluster_enabled: bool = True
    home_star_3d_cluster_star_count: int = Field(
        default=422,
        ge=0,
        le=800,
    )
    home_star_3d_stream_enabled: bool = True
    home_star_3d_stream_star_count: int = Field(
        default=326,
        ge=0,
        le=700,
    )
    home_star_3d_nebula_enabled: bool = True
    home_star_3d_nebula_star_count: int = Field(
        default=212,
        ge=0,
        le=500,
    )
    home_star_3d_background_brightness_percent: float = Field(
        default=220,
        ge=0,
        le=400,
    )
    home_star_3d_dust_brightness_percent: float = Field(
        default=260,
        ge=0,
        le=500,
    )
    home_star_3d_background_size_percent: float = Field(
        default=160,
        ge=25,
        le=300,
    )
    home_star_3d_structure_motion_percent: float = Field(
        default=100,
        ge=0,
        le=200,
    )
    home_star_active_edge_mode: str = "single_path"
    home_star_brightness_rules: list[StarBrightnessRuleRequest] = Field(
        default_factory=lambda: [
            StarBrightnessRuleRequest(**item)
            for item in DEFAULT_STAR_BRIGHTNESS_RULES
        ],
        max_length=50,
    )
    home_star_brightness_tiers: list[StarBrightnessTierRequest] = Field(
        default_factory=lambda: [
            StarBrightnessTierRequest(**item)
            for item in DEFAULT_STAR_BRIGHTNESS_TIERS
        ],
        min_length=1,
        max_length=20,
    )


class ExternalUrgeRequest(BaseModel):
    token: str = Field(min_length=20, max_length=256)


class SmtpSettingsRequest(BaseModel):
    enabled: bool
    provider: str = Field(max_length=32)
    host: str = Field(default="", max_length=255)
    port: int = Field(default=587, ge=1, le=65535)
    username: str = Field(default="", max_length=254)
    password: str = Field(default="", max_length=512)
    from_address: str = Field(default="", max_length=254)
    starttls: bool = True


class CommentAgentSettingsRequest(BaseModel):
    enabled: bool
    provider: str = Field(max_length=32)
    protocol: str = Field(max_length=32)
    base_url: str = Field(max_length=500)
    api_key: str = Field(default="", max_length=2000)
    model: str = Field(min_length=1, max_length=200)
    timeout_seconds: int = Field(default=45, ge=5, le=180)
    max_context_chars: int = Field(default=24000, ge=4000, le=100000)
    max_output_tokens: int = Field(default=1200, ge=128, le=8192)
    system_prompt: str = Field(
        default=DEFAULT_COMMENT_AGENT_SYSTEM_PROMPT,
        min_length=1,
        max_length=4000,
    )
    access_mode: str = "all"
    whitelist_user_ids: list[int] = Field(
        default_factory=list,
        max_length=1000,
    )


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, limit: int, window_seconds: int) -> bool:
        now = datetime.now(timezone.utc).timestamp()
        cutoff = now - window_seconds
        with self._lock:
            entries = self._hits[key]
            while entries and entries[0] < cutoff:
                entries.popleft()
            if len(entries) >= limit:
                return False
            entries.append(now)
            return True


MARKDOWN = MarkdownIt(
    "commonmark",
    {"html": False, "linkify": True},
).enable("table")
ALLOWED_TAGS = set(bleach.sanitizer.ALLOWED_TAGS) | {
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "pre",
    "code",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "hr",
}
MARKDOWN_PREVIEW_BLOCKS = {
    "blockquote_open": "blockquote",
    "bullet_list_open": "list",
    "code_block": "code",
    "fence": "code",
    "heading_open": "heading",
    "hr": "separator",
    "ordered_list_open": "list",
    "paragraph_open": "paragraph",
    "table_open": "table",
}


def request_ip(request: Request) -> str:
    return (
        request.headers.get("cf-connecting-ip")
        or (request.client.host if request.client else "unknown")
    )[:64]


def public_user(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "email": row["email"],
        "username": row["username"],
        "github_login": row["github_login"],
        "github_email": row["github_email"],
        "github_verified": bool(row["github_verified"]),
        "email_verified": bool(row["email_verified"]),
        "role": row["role"],
        "status": row["status"],
        "must_change_password": bool(row["must_change_password"]),
        "email_notifications_enabled": bool(
            row["email_notifications_enabled"]
        ),
        "needs_onboarding": not bool(row["onboarding_completed_at"]),
    }


def can_edit(user: dict[str, Any], policy: str) -> bool:
    if user["role"] == "admin":
        return True
    if policy == "local_authenticated":
        return True
    return bool(user["github_verified"])


def safe_return_path(value: str | None) -> str | None:
    if not value:
        return None
    path = value.strip()
    if (
        not path.startswith("/")
        or path.startswith("//")
        or "\\" in path
        or len(path) > 500
        or any(ord(character) < 32 for character in path)
    ):
        return None
    return path


def validate_markdown(path: str, content: str) -> list[str]:
    if not path.endswith(".md"):
        return []
    errors: list[str] = []
    h1_count = 0
    in_fence = False
    fence_count = 0
    previous_heading = 0
    for line in content.splitlines():
        if line.strip().startswith("```"):
            in_fence = not in_fence
            fence_count += 1
            continue
        if in_fence:
            continue
        match = re.match(r"^(#{1,6})\s+\S", line)
        if not match:
            continue
        level = len(match.group(1))
        if level == 1:
            h1_count += 1
        if previous_heading and level > previous_heading + 1:
            errors.append(f"标题层级从 H{previous_heading} 跳到 H{level}")
        previous_heading = level
    if h1_count != 1:
        errors.append(f"Markdown 需要且只能有一个一级标题，当前为 {h1_count} 个")
    if fence_count % 2:
        errors.append("代码围栏未闭合")
    return errors


def render_markdown_preview(content: str) -> str:
    frontmatter = re.match(
        r"\A---\r?\n.*?\r?\n---(?:\r?\n|$)",
        content,
        flags=re.DOTALL,
    )
    source_offset = (
        frontmatter.group(0).count("\n")
        if frontmatter
        else 0
    )
    preview_content = (
        content[frontmatter.end():]
        if frontmatter
        else content
    )
    tokens = MARKDOWN.parse(preview_content)
    for token in tokens:
        source_map = token.map
        block_kind = MARKDOWN_PREVIEW_BLOCKS.get(token.type)
        if (
            token.level != 0
            or not source_map
            or not block_kind
        ):
            continue
        token.attrSet("data-md-block", "")
        token.attrSet(
            "data-source-start",
            str(source_map[0] + source_offset),
        )
        token.attrSet(
            "data-source-end",
            str(source_map[1] + source_offset),
        )
        token.attrSet("data-source-kind", block_kind)
    rendered = MARKDOWN.renderer.render(
        tokens,
        MARKDOWN.options,
        {},
    )
    return bleach.clean(
        rendered,
        tags=ALLOWED_TAGS,
        attributes={
            "*": [
                "data-md-block",
                "data-source-start",
                "data-source-end",
                "data-source-kind",
            ],
            "a": ["href", "title", "rel"],
            "code": ["class"],
        },
        protocols={"https", "http", "mailto"},
        strip=True,
    )


def deliver_notification(
    db_path: Path,
    settings: Settings,
    event_type: str,
    subject: str,
    body: str,
) -> None:
    deliver_admin_email(
        db_path,
        settings,
        event_type,
        subject,
        body,
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    db = Database(settings.db_path)
    db.initialize(settings)
    github = GitHubClient(settings)
    cipher = TokenCipher(settings.encryption_key)
    rate_limiter = SlidingWindowLimiter()
    pr_sync_lock: asyncio.Lock | None = None

    async def run_pr_sync() -> dict[str, int]:
        nonlocal pr_sync_lock
        if pr_sync_lock is None:
            pr_sync_lock = asyncio.Lock()
        async with pr_sync_lock:
            return await reconcile_all_pull_requests(
                db,
                settings,
                github,
            )

    async def pr_sync_worker() -> None:
        await asyncio.sleep(5)
        while True:
            try:
                await run_pr_sync()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                db.audit(
                    "submission.sync_worker_failed",
                    "system",
                    detail=str(exc)[:1000],
                )
            await asyncio.sleep(settings.pr_sync_interval_seconds)

    async def comment_agent_worker() -> None:
        await asyncio.sleep(2)
        while True:
            try:
                processed = await asyncio.to_thread(
                    process_comment_agent_request,
                    db,
                    settings,
                    cipher,
                )
                if not processed:
                    await asyncio.sleep(5)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                db.audit(
                    "comment_agent.worker_failed",
                    "system",
                    detail=str(exc)[:1000],
                )
                await asyncio.sleep(5)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        recover_comment_agent_requests(db)
        pr_task = asyncio.create_task(pr_sync_worker())
        agent_task = asyncio.create_task(comment_agent_worker())
        application.state.pr_sync_task = pr_task
        application.state.comment_agent_task = agent_task
        try:
            yield
        finally:
            pr_task.cancel()
            agent_task.cancel()
            for task in (pr_task, agent_task):
                with suppress(asyncio.CancelledError):
                    await task

    app = FastAPI(
        title="Game Client Knowledge Editor",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.db = db
    app.state.github = github
    app.state.cipher = cipher
    app.state.run_pr_sync = run_pr_sync
    app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")

    @app.middleware("http")
    async def security_middleware(request: Request, call_next):
        if request.url.path.endswith("/api/auth/github/callback"):
            # #region debug-point A:callback-request
            exec("try:\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.185:7777/event',data=json.dumps({'sessionId':'oauth-submit-failures','runId':'post-fix','hypothesisId':'A','location':'main.py:security_middleware','msg':'[DEBUG] OAuth callback request','data':{'queryKeys':sorted(request.query_params.keys()),'hasError':bool(request.query_params.get('error')),'error':request.query_params.get('error'),'hasStateCookie':bool(request.cookies.get(OAUTH_STATE_COOKIE))},'ts':int(datetime.now(timezone.utc).timestamp()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
            # #endregion
        try:
            content_length = int(
                request.headers.get("content-length", "0") or "0"
            )
        except ValueError:
            return JSONResponse(
                {"detail": "Content-Length 无效"},
                status_code=400,
            )
        if content_length > MAX_REQUEST_BYTES:
            return JSONResponse({"detail": "请求内容过大"}, status_code=413)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https://avatars.githubusercontent.com; "
            "connect-src 'self'; "
            "base-uri 'none'; "
            "frame-ancestors 'self'; "
            "form-action 'self' https://github.com"
        )
        refresh_token = getattr(
            request.state,
            "session_refresh_token",
            None,
        )
        if refresh_token:
            response.set_cookie(
                SESSION_COOKIE,
                refresh_token,
                max_age=request.state.session_refresh_max_age,
                secure=settings.cookie_secure,
                httponly=True,
                samesite="lax",
                path=settings.cookie_path,
            )
        if settings.cookie_path != "/":
            response.delete_cookie(
                SESSION_COOKIE,
                path="/",
                secure=settings.cookie_secure,
                httponly=True,
                samesite="lax",
            )
            response.delete_cookie(
                OAUTH_STATE_COOKIE,
                path="/",
                secure=settings.cookie_secure,
                httponly=True,
                samesite="lax",
            )
        return response

    @app.exception_handler(GitHubError)
    async def github_error_handler(
        request: Request,
        exc: GitHubError,
    ) -> JSONResponse:
        del request
        return JSONResponse(
            {"detail": str(exc)},
            status_code=exc.status_code,
        )

    def request_cookie_values(request: Request, name: str) -> list[str]:
        # Browsers order longer-path cookies first. Starlette's cookie mapping
        # keeps the last duplicate, which can select a stale legacy root cookie.
        values: list[str] = []
        for item in request.headers.get("cookie", "").split(";"):
            key, separator, value = item.strip().partition("=")
            if separator and key == name and value:
                values.append(value)
        return values

    def session_idle_days() -> int:
        try:
            value = int(db.setting("session_idle_days", "30"))
        except (TypeError, ValueError):
            value = 30
        return max(1, min(365, value))

    def session_max_age() -> int:
        return session_idle_days() * 24 * 60 * 60

    def read_session(request: Request) -> dict[str, Any] | None:
        tokens = request_cookie_values(request, SESSION_COOKIE)
        if not tokens:
            return None
        now_value = datetime.now(timezone.utc)
        now = now_value.isoformat()
        lifetime = timedelta(days=session_idle_days())
        refresh_interval = min(timedelta(hours=12), lifetime / 2)
        with db.connect() as connection:
            for token in tokens:
                row = connection.execute(
                    """
                    SELECT s.id AS session_id, s.csrf_token, s.auth_provider,
                           s.expires_at, u.*
                    FROM sessions s
                    JOIN users u ON u.id = s.user_id
                    WHERE s.token_hash = ? AND s.expires_at > ?
                    """,
                    (token_hash(token), now),
                ).fetchone()
                if not row or row["status"] != "active":
                    continue
                expires_at = datetime.fromisoformat(row["expires_at"])
                target_expiry = now_value + lifetime
                should_refresh = (
                    expires_at
                    <= target_expiry - refresh_interval
                    or expires_at > target_expiry
                )
                if should_refresh:
                    expires_at = target_expiry
                    connection.execute(
                        """
                        UPDATE sessions
                        SET expires_at = ?, last_seen_at = ?
                        WHERE id = ?
                        """,
                        (
                            expires_at.isoformat(),
                            now,
                            row["session_id"],
                        ),
                    )
                    request.state.session_refresh_token = token
                    request.state.session_refresh_max_age = int(
                        lifetime.total_seconds()
                    )
                else:
                    connection.execute(
                        "UPDATE sessions SET last_seen_at = ? WHERE id = ?",
                        (now, row["session_id"]),
                    )
                return dict(row)
        return None

    def require_user(request: Request) -> dict[str, Any]:
        user = read_session(request)
        if not user:
            raise HTTPException(status_code=401, detail="请先登录")
        return user

    def require_ready_user(request: Request) -> dict[str, Any]:
        user = require_user(request)
        if user["must_change_password"]:
            raise HTTPException(status_code=403, detail="首次登录需要先修改密码")
        return user

    def require_editor(request: Request) -> dict[str, Any]:
        user = require_ready_user(request)
        policy = db.setting("edit_policy", settings.default_edit_policy)
        if not can_edit(user, policy):
            raise HTTPException(status_code=403, detail="当前策略要求绑定并验证 GitHub")
        return user

    def require_admin(request: Request) -> dict[str, Any]:
        user = require_ready_user(request)
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="需要管理员权限")
        return user

    def verify_csrf(
        user: dict[str, Any],
        x_csrf_token: str | None,
    ) -> None:
        if not x_csrf_token or not secrets.compare_digest(
            user["csrf_token"], x_csrf_token
        ):
            raise HTTPException(status_code=403, detail="CSRF 校验失败")

    def create_session(
        connection: sqlite3.Connection,
        user_id: int,
        auth_provider: str,
    ) -> tuple[str, str]:
        raw = random_token()
        csrf = random_token()
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=session_idle_days())
        connection.execute(
            """
            INSERT INTO sessions(
                token_hash, csrf_token, user_id, auth_provider,
                expires_at, created_at, last_seen_at
            )
            VALUES(?, ?, ?, ?, ?, ?, ?)
            """,
            (
                token_hash(raw),
                csrf,
                user_id,
                auth_provider,
                expires_at.isoformat(),
                now.isoformat(),
                now.isoformat(),
            ),
        )
        return raw, csrf

    def auth_response(
        row: sqlite3.Row | dict[str, Any],
        session_token: str,
        csrf: str,
        provider: str,
    ) -> JSONResponse:
        user = public_user(row)
        policy = db.setting("edit_policy", settings.default_edit_policy)
        response = JSONResponse(
            {
                "user": user,
                "csrf_token": csrf,
                "auth_provider": provider,
                "can_edit": can_edit(user, policy),
                "edit_policy": policy,
            }
        )
        response.set_cookie(
            SESSION_COOKIE,
            session_token,
            max_age=session_max_age(),
            secure=settings.cookie_secure,
            httponly=True,
            samesite="lax",
            path=settings.cookie_path,
        )
        return response

    def admin_notification(
        background_tasks: BackgroundTasks,
        event_type: str,
        subject: str,
        body: str,
    ) -> None:
        background_tasks.add_task(
            deliver_notification,
            settings.db_path,
            settings,
            event_type,
            subject,
            body,
        )

    def contributor_notification(
        background_tasks: BackgroundTasks,
        user: dict[str, Any],
        submission_id: int,
        event_type: str,
        subject: str,
        body: str,
    ) -> bool:
        if not user["email_verified"]:
            return False
        background_tasks.add_task(
            deliver_email,
            settings.db_path,
            settings,
            event_type,
            [user["email"]],
            subject,
            body,
            audience="contributor",
            user_id=user["id"],
            submission_id=submission_id,
        )
        return True

    base_url_parts = urlsplit(settings.base_url)
    site_origin = (
        f"{base_url_parts.scheme}://{base_url_parts.netloc}"
    )

    def browser_return_url(path: str | None) -> str:
        return f"{site_origin}{path}" if path else f"{settings.base_url}/"

    def smtp_configuration():
        return load_smtp_configuration(db, settings, cipher)

    def comment_agent_configuration():
        return load_comment_agent_configuration(db, cipher)

    app.include_router(
        create_comments_router(
            db,
            settings,
            read_session,
            require_ready_user,
            verify_csrf,
            rate_limiter.allow,
            cipher,
        )
    )

    def resolved_home_intro_mode() -> str:
        mode = db.setting("home_intro_mode", "")
        if mode in {"off", "always", "revisit", "first"}:
            return mode
        return (
            "revisit"
            if db.setting("home_intro_enabled", "1") == "1"
            else "off"
        )

    def resolved_home_intro_timing() -> dict[str, int]:
        def setting_int(key: str, default: int) -> int:
            try:
                return int(db.setting(key, str(default)))
            except (TypeError, ValueError):
                return default

        total = max(
            1500,
            min(
                20320,
                setting_int("home_intro_duration_ms", 3000),
            ),
        )
        assembly = max(
            500,
            min(
                10000,
                setting_int(
                    "home_intro_assembly_duration_ms",
                    round(total * 0.56),
                ),
            ),
        )
        hold = max(
            0,
            min(
                10000,
                setting_int(
                    "home_intro_hold_duration_ms",
                    round(total * 0.21),
                ),
            ),
        )
        scroll = max(320, total - assembly - hold)
        return {
            "home_intro_duration_ms": assembly + hold + scroll,
            "home_intro_assembly_duration_ms": assembly,
            "home_intro_hold_duration_ms": hold,
            "home_intro_scroll_duration_ms": scroll,
        }

    def resolved_star_brightness_rules() -> list[dict[str, Any]]:
        try:
            parsed = json.loads(
                db.setting(
                    "home_star_brightness_rules",
                    json.dumps(DEFAULT_STAR_BRIGHTNESS_RULES),
                )
            )
        except (TypeError, json.JSONDecodeError):
            parsed = DEFAULT_STAR_BRIGHTNESS_RULES
        return normalize_star_brightness_rules(parsed)

    def resolved_star_brightness_tiers(
        minimum: float,
        maximum: float,
    ) -> list[dict[str, Any]]:
        try:
            parsed = json.loads(
                db.setting(
                    "home_star_brightness_tiers",
                    json.dumps(DEFAULT_STAR_BRIGHTNESS_TIERS),
                )
            )
        except (TypeError, json.JSONDecodeError):
            parsed = DEFAULT_STAR_BRIGHTNESS_TIERS
        return normalize_star_brightness_tiers(
            parsed,
            minimum,
            maximum,
        )

    def star_visual_payload() -> dict[str, Any]:
        def setting_int(key: str, default: int) -> int:
            try:
                return int(db.setting(key, str(default)))
            except (TypeError, ValueError):
                return default

        def setting_float(key: str, default: float) -> float:
            try:
                return float(db.setting(key, str(default)))
            except (TypeError, ValueError):
                return default

        illumination_rule = db.setting(
            "home_star_illumination_rule", "bfs"
        )
        if illumination_rule not in STAR_ILLUMINATION_RULE_IDS:
            illumination_rule = "bfs"
        graph_direction = db.setting(
            "home_star_graph_direction", "directed"
        )
        if graph_direction not in {"directed", "undirected"}:
            graph_direction = "directed"
        brightness_max = max(
            1,
            min(
                100,
                setting_float("home_star_brightness_max", 100),
            ),
        )
        brightness_min = max(
            0,
            min(
                brightness_max,
                setting_float("home_star_brightness_min", 0),
            ),
        )
        brightness_initial = max(
            brightness_min,
            min(
                brightness_max,
                setting_float("home_star_brightness_initial", 10),
            ),
        )
        active_edge_mode = db.setting(
            "home_star_active_edge_mode", "single_path"
        )
        if active_edge_mode not in {
            "full",
            "minimal_tree",
            "single_path",
        }:
            active_edge_mode = "single_path"
        experience_mode = db.setting(
            "home_star_experience_mode",
            "immersive",
        )
        if experience_mode not in {
            "immersive",
            "contribution_portal",
        }:
            experience_mode = "immersive"
        collapsed_structure = db.setting(
            "home_star_portal_collapsed_structure",
            "octahedron",
        )
        if collapsed_structure not in {
            "match_expanded",
            "octahedron",
            "sphere",
            "cube",
            "3d",
            "3d-drift",
            "3d-drift-anchored",
            "3d-galaxy",
            "3d-orbit",
            "3d-spiral",
            "3d-nebula",
            "3d-clusters",
            "3d-shell",
        }:
            collapsed_structure = "octahedron"
        expanded_structure = db.setting(
            "home_star_portal_expanded_structure",
            "3d-drift",
        )
        if expanded_structure not in {
            "3d",
            "3d-drift",
            "3d-drift-anchored",
            "3d-galaxy",
            "3d-orbit",
            "3d-spiral",
            "3d-nebula",
            "3d-clusters",
            "3d-shell",
        }:
            expanded_structure = "3d-drift"
        return {
            "home_background_style": db.setting(
                "home_background_style", "old_star_map"
            ),
            "home_content_mask_enabled": (
                db.setting("home_content_mask_enabled", "0") == "1"
            ),
            "home_content_idle_timeout_seconds": max(
                0,
                min(
                    3600,
                    setting_int(
                        "home_content_idle_timeout_seconds", 30
                    ),
                ),
            ),
            "home_star_scope": db.setting("home_star_scope", "hero"),
            "home_star_render_mode": db.setting(
                "home_star_render_mode", "2d"
            ),
            "home_star_experience_mode": experience_mode,
            "home_star_portal_collapsed_structure": (
                collapsed_structure
            ),
            "home_star_portal_expanded_structure": (
                expanded_structure
            ),
            "home_star_portal_rotation_speed": max(
                0,
                min(
                    30,
                    setting_float(
                        "home_star_portal_rotation_speed",
                        2.6,
                    ),
                ),
            ),
            "home_star_portal_size_percent": max(
                10,
                min(
                    100,
                    setting_float(
                        "home_star_portal_size_percent",
                        34,
                    ),
                ),
            ),
            "home_star_portal_brightness_percent": max(
                10,
                min(
                    100,
                    setting_float(
                        "home_star_portal_brightness_percent",
                        42,
                    ),
                ),
            ),
            "home_star_relation_visibility": db.setting(
                "home_star_relation_visibility", "near"
            ),
            "home_star_strong_relation_style": db.setting(
                "home_star_strong_relation_style", "solid"
            ),
            "home_star_reference_relation_style": db.setting(
                "home_star_reference_relation_style", "dashed"
            ),
            "home_star_contributor_relation_style": db.setting(
                "home_star_contributor_relation_style", "solid"
            ),
            "home_star_hover_info_enabled": (
                db.setting("home_star_hover_info_enabled", "1") == "1"
            ),
            "home_star_hover_relations_enabled": (
                db.setting("home_star_hover_relations_enabled", "1") == "1"
            ),
            "home_star_hover_relation_opacity_percent": max(
                1,
                min(
                    25,
                    setting_float(
                        "home_star_hover_relation_opacity_percent",
                        6,
                    ),
                ),
            ),
            "home_star_brightness_variation_enabled": (
                db.setting(
                    "home_star_brightness_variation_enabled", "0"
                )
                == "1"
            ),
            "home_star_brightness_initial": brightness_initial,
            "home_star_brightness_min": brightness_min,
            "home_star_brightness_max": brightness_max,
            "home_star_brightness_variation_amount": max(
                0,
                min(
                    20,
                    setting_float(
                        "home_star_brightness_variation_amount", 2
                    ),
                ),
            ),
            "home_star_brightness_transition_ms": max(
                100,
                min(
                    10000,
                    setting_int(
                        "home_star_brightness_transition_ms", 900
                    ),
                ),
            ),
            "home_star_brightness_interval_ms": max(
                200,
                min(
                    30000,
                    setting_int(
                        "home_star_brightness_interval_ms", 2400
                    ),
                ),
            ),
            "home_star_color_random_enabled": (
                db.setting("home_star_color_random_enabled", "0") == "1"
            ),
            "home_star_graph_direction": graph_direction,
            "home_star_illumination_rule": illumination_rule,
            "home_star_illumination_depth": max(
                1,
                min(
                    20,
                    setting_int("home_star_illumination_depth", 3),
                ),
            ),
            "home_star_selection_duration_ms": max(
                500,
                min(
                    60000,
                    setting_int("home_star_selection_duration_ms", 3000),
                ),
            ),
            "home_star_label_duration_ms": max(
                500,
                min(
                    60000,
                    setting_int("home_star_label_duration_ms", 3000),
                ),
            ),
            "home_star_selected_radius_boost": max(
                0,
                min(
                    4,
                    setting_float("home_star_selected_radius_boost", 1),
                ),
            ),
            "home_star_selected_alpha_boost": max(
                0,
                min(
                    0.5,
                    setting_float("home_star_selected_alpha_boost", 0.16),
                ),
            ),
            "home_star_selected_halo_alpha_boost": max(
                0,
                min(
                    0.5,
                    setting_float(
                        "home_star_selected_halo_alpha_boost",
                        0.18,
                    ),
                ),
            ),
            "home_star_selected_glow_scale": max(
                1,
                min(
                    3,
                    setting_float("home_star_selected_glow_scale", 1.25),
                ),
            ),
            "home_star_selected_contributor_line_width": max(
                0.5,
                min(
                    4,
                    setting_float(
                        "home_star_selected_contributor_line_width",
                        1.4,
                    ),
                ),
            ),
            "home_star_3d_min_depth": max(
                100,
                min(
                    1000,
                    setting_float("home_star_3d_min_depth", 280),
                ),
            ),
            "home_star_3d_halo_max_css_size": max(
                40,
                min(
                    600,
                    setting_float(
                        "home_star_3d_halo_max_css_size",
                        200,
                    ),
                ),
            ),
            "home_star_3d_core_max_css_size": max(
                8,
                min(
                    120,
                    setting_float(
                        "home_star_3d_core_max_css_size",
                        36,
                    ),
                ),
            ),
            "home_star_3d_spike_max_css_size": max(
                40,
                min(
                    800,
                    setting_float(
                        "home_star_3d_spike_max_css_size",
                        240,
                    ),
                ),
            ),
            "home_star_3d_pulse_max_css_size": max(
                8,
                min(
                    120,
                    setting_float(
                        "home_star_3d_pulse_max_css_size",
                        36,
                    ),
                ),
            ),
            "home_star_3d_field_enabled": (
                db.setting("home_star_3d_field_enabled", "1") == "1"
            ),
            "home_star_3d_field_star_count": max(
                0,
                min(
                    5000,
                    setting_int("home_star_3d_field_star_count", 320),
                ),
            ),
            "home_star_3d_dust_enabled": (
                db.setting("home_star_3d_dust_enabled", "1") == "1"
            ),
            "home_star_3d_dust_star_count": max(
                0,
                min(
                    3000,
                    setting_int(
                        "home_star_3d_dust_star_count",
                        1920,
                    ),
                ),
            ),
            "home_star_3d_cluster_enabled": (
                db.setting("home_star_3d_cluster_enabled", "1") == "1"
            ),
            "home_star_3d_cluster_star_count": max(
                0,
                min(
                    800,
                    setting_int(
                        "home_star_3d_cluster_star_count",
                        422,
                    ),
                ),
            ),
            "home_star_3d_stream_enabled": (
                db.setting("home_star_3d_stream_enabled", "1") == "1"
            ),
            "home_star_3d_stream_star_count": max(
                0,
                min(
                    700,
                    setting_int(
                        "home_star_3d_stream_star_count",
                        326,
                    ),
                ),
            ),
            "home_star_3d_nebula_enabled": (
                db.setting("home_star_3d_nebula_enabled", "1") == "1"
            ),
            "home_star_3d_nebula_star_count": max(
                0,
                min(
                    500,
                    setting_int(
                        "home_star_3d_nebula_star_count",
                        212,
                    ),
                ),
            ),
            "home_star_3d_background_brightness_percent": max(
                0,
                min(
                    400,
                    setting_float(
                        "home_star_3d_background_brightness_percent",
                        220,
                    ),
                ),
            ),
            "home_star_3d_dust_brightness_percent": max(
                0,
                min(
                    500,
                    setting_float(
                        "home_star_3d_dust_brightness_percent",
                        260,
                    ),
                ),
            ),
            "home_star_3d_background_size_percent": max(
                25,
                min(
                    300,
                    setting_float(
                        "home_star_3d_background_size_percent",
                        160,
                    ),
                ),
            ),
            "home_star_3d_structure_motion_percent": max(
                0,
                min(
                    200,
                    setting_float(
                        "home_star_3d_structure_motion_percent",
                        100,
                    ),
                ),
            ),
            "home_star_active_edge_mode": active_edge_mode,
            "home_star_brightness_rules": resolved_star_brightness_rules(),
            "home_star_brightness_tiers": resolved_star_brightness_tiers(
                brightness_min,
                brightness_max,
            ),
        }

    def config_payload() -> dict[str, Any]:
        intro_mode = resolved_home_intro_mode()
        intro_timing = resolved_home_intro_timing()
        return {
            "registration_enabled": (
                db.setting("registration_enabled", "1") == "1"
            ),
            "github_oauth_enabled": settings.github_oauth_enabled,
            "github_submission_enabled": settings.github_submission_enabled,
            "edit_policy": db.setting(
                "edit_policy", settings.default_edit_policy
            ),
            "reader_edit_mode": db.setting("reader_edit_mode", "new"),
            "reader_diff_enabled": (
                db.setting("reader_diff_enabled", "1") == "1"
            ),
            "workspace_sync_interval_seconds": int(
                db.setting("workspace_sync_interval_seconds", "60")
            ),
            "session_idle_days": session_idle_days(),
            "site_auto_update_interval_minutes": int(
                db.setting("site_auto_update_interval_minutes", "10")
            ),
            "catalog_background_style": db.setting(
                "catalog_background_style", "circuit"
            ),
            "reader_background_style": db.setting(
                "reader_background_style", "blueprint"
            ),
            "pointer_effect_enabled": (
                db.setting("pointer_effect_enabled", "1") == "1"
            ),
            "home_intro_enabled": intro_mode != "off",
            "home_intro_mode": intro_mode,
            "home_intro_duration_ms": intro_timing[
                "home_intro_duration_ms"
            ],
            "home_intro_assembly_duration_ms": intro_timing[
                "home_intro_assembly_duration_ms"
            ],
            "home_intro_hold_duration_ms": intro_timing[
                "home_intro_hold_duration_ms"
            ],
            "home_intro_lock_scroll": (
                db.setting("home_intro_lock_scroll", "1") == "1"
            ),
            "home_intro_contributor_limit": int(
                db.setting("home_intro_contributor_limit", "8")
            ),
            **star_visual_payload(),
            "contribution_graph": contribution_graph_payload(db),
            "repository": settings.github_repo,
        }

    def session_payload(row: dict[str, Any] | None) -> dict[str, Any]:
        if not row:
            return {"authenticated": False}
        user = public_user(row)
        policy = db.setting("edit_policy", settings.default_edit_policy)
        return {
            "authenticated": True,
            "user": user,
            "csrf_token": row["csrf_token"],
            "auth_provider": row["auth_provider"],
            "can_edit": can_edit(user, policy),
            "edit_policy": policy,
        }

    def user_drafts(user_id: int) -> list[dict[str, Any]]:
        with db.connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT id, path, operation, content, base_sha,
                           base_content, revision, created_at, updated_at
                    FROM drafts WHERE user_id = ?
                    ORDER BY updated_at DESC
                    """,
                    (user_id,),
                ).fetchall()
            ]

    def drafts_revision(drafts: list[dict[str, Any]]) -> str:
        fingerprint = "\n".join(
            (
                f"{draft['id']}:{draft['revision']}:"
                f"{draft['updated_at']}:{draft['operation']}"
            )
            for draft in sorted(drafts, key=lambda item: item["id"])
        )
        return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:16]

    @app.get("/")
    async def editor_page():
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/admin")
    async def admin_page(request: Request):
        user = read_session(request)
        if (
            not user
            or user["role"] != "admin"
            or user["must_change_password"]
        ):
            return RedirectResponse(f"{settings.base_url}/")
        return FileResponse(STATIC_DIR / "admin.html")

    @app.get("/external-pr/urge")
    async def external_pr_urge_page():
        return FileResponse(STATIC_DIR / "external-urge.html")

    @app.post("/api/external-pr/urge")
    async def urge_external_pull_request(
        payload: ExternalUrgeRequest,
        request: Request,
        background_tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        capability_hash = token_hash(payload.token)
        if not rate_limiter.allow(
            f"external-urge:{request_ip(request)}",
            20,
            3600,
        ):
            raise HTTPException(status_code=429, detail="催办请求过多")
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        cutoff = (now - timedelta(hours=24)).isoformat()
        with db.connect() as connection:
            external = connection.execute(
                """
                SELECT p.*
                FROM external_pr_action_tokens t
                JOIN external_pull_requests p ON p.id = t.external_pr_id
                WHERE t.token_hash = ? AND t.action = 'urge'
                  AND t.expires_at > ?
                """,
                (capability_hash, now_iso),
            ).fetchone()
            if not external:
                raise HTTPException(
                    status_code=404,
                    detail="催办链接无效或已过期",
                )
            if external["status"] == "merged":
                raise HTTPException(status_code=409, detail="该 PR 已合并")
            if (
                external["status"] == "closed"
                and not external["auto_closed"]
            ):
                raise HTTPException(status_code=409, detail="该 PR 已关闭")
            changed = connection.execute(
                """
                UPDATE external_pull_requests
                SET last_urged_at = ?, urge_count = urge_count + 1,
                    updated_at = ?
                WHERE id = ?
                  AND (last_urged_at IS NULL OR last_urged_at <= ?)
                """,
                (
                    now_iso,
                    now_iso,
                    external["id"],
                    cutoff,
                ),
            )
            if changed.rowcount == 0:
                raise HTTPException(
                    status_code=429,
                    detail="每个 PR 每 24 小时只能催办一次",
                )
        background_tasks.add_task(
            deliver_admin_email,
            settings.db_path,
            settings,
            "external_pull_request_urged",
            f"[GCK] 外部贡献者催办 PR #{external['pr_number']}",
            (
                f"GitHub 用户：@{external['github_login']}\n"
                f"标题：{external['title']}\n"
                f"状态：{external['status']}"
                f"{'（系统自动关闭）' if external['auto_closed'] else ''}\n"
                f"PR：{external['pr_url']}\n"
            ),
            external_pr_id=external["id"],
        )
        db.audit(
            "external_pr.urged",
            request_ip(request),
            target=external["pr_url"],
            detail=f"github_login={external['github_login']}",
        )
        return {
            "pr_number": external["pr_number"],
            "status": external["status"],
            "message": "已通知管理员处理该 PR",
            "last_urged_at": now_iso,
            "urge_count": int(external["urge_count"]) + 1,
        }

    @app.get("/api/config")
    async def config() -> dict[str, Any]:
        return config_payload()

    @app.post("/api/analytics/visit")
    async def analytics_visit(request: Request) -> Response:
        content_entries = []
        star_map_seconds = 0
        body = await request.body()
        if body and len(body) <= 24 * 1024:
            try:
                payload = json.loads(body)
            except (TypeError, ValueError):
                payload = {}
            if isinstance(payload, dict):
                content_entries = normalize_content_entries(
                    payload.get("f")
                )
                star_map_seconds = normalize_star_map_seconds(
                    payload.get("s")
                )
        raw_device = request.cookies.get(DEVICE_COOKIE)
        new_device = not valid_device_token(raw_device)
        if new_device:
            raw_device = new_device_token()
        anonymous_device_hash = device_hash(raw_device)
        limiter_key = (
            f"analytics:new:{request_ip(request)}"
            if new_device
            else f"analytics:device:{anonymous_device_hash}"
        )
        if rate_limiter.allow(limiter_key, 120, 60):
            record_visit(
                db,
                anonymous_device_hash,
                content_entries=content_entries,
                star_map_seconds=star_map_seconds,
            )
        response = Response(status_code=204)
        if new_device:
            response.set_cookie(
                DEVICE_COOKIE,
                raw_device,
                max_age=DEVICE_COOKIE_MAX_AGE,
                secure=settings.cookie_secure,
                httponly=True,
                samesite="lax",
                path="/",
            )
        return response

    @app.get("/api/session")
    async def session(request: Request) -> dict[str, Any]:
        return session_payload(read_session(request))

    @app.get("/api/bootstrap")
    async def bootstrap(
        request: Request,
        path: str | None = None,
    ) -> dict[str, Any]:
        row = read_session(request)
        session_data = session_payload(row)
        drafts: list[dict[str, Any]] = []
        active_draft = None
        if row and not row["must_change_password"]:
            policy = session_data["edit_policy"]
            user = session_data["user"]
            if can_edit(user, policy):
                drafts = user_drafts(row["id"])
                if path:
                    try:
                        normalized_path = validate_content_path(path)
                    except ValueError:
                        normalized_path = ""
                    active_draft = next(
                        (
                            draft
                            for draft in drafts
                            if draft["path"] == normalized_path
                        ),
                        None,
                    )
        return {
            "config": config_payload(),
            "session": session_data,
            "drafts": drafts,
            "draft_revision": drafts_revision(drafts),
            "active_draft_html": (
                render_markdown_preview(active_draft["content"])
                if active_draft
                and active_draft["operation"] == "upsert"
                and active_draft["path"].endswith(".md")
                else None
            ),
        }

    @app.post("/api/auth/register")
    async def register(
        payload: RegisterRequest,
        request: Request,
    ) -> JSONResponse:
        ip = request_ip(request)
        if not rate_limiter.allow(f"register:{ip}", 5, 3600):
            raise HTTPException(status_code=429, detail="注册请求过多")
        if db.setting("registration_enabled", "1") != "1":
            raise HTTPException(status_code=403, detail="当前已关闭注册")

        try:
            email = normalize_email(payload.email)
            username = normalize_username(payload.username)
            password_hash = hash_password(payload.password)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        now = utc_now()
        try:
            with db.connect() as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO users(
                        email, username, password_hash, created_at, updated_at
                    )
                    VALUES(?, ?, ?, ?, ?)
                    """,
                    (email, username, password_hash, now, now),
                )
                user_id = cursor.lastrowid
                row = connection.execute(
                    "SELECT * FROM users WHERE id = ?", (user_id,)
                ).fetchone()
                raw, csrf = create_session(connection, user_id, "local")
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=409,
                detail="邮箱或用户名已被使用",
            ) from exc

        db.audit("user.register", ip, user_id=user_id, target=email)
        return auth_response(row, raw, csrf, "local")

    @app.post("/api/auth/login")
    async def login(
        payload: LoginRequest,
        request: Request,
    ) -> JSONResponse:
        ip = request_ip(request)
        if not rate_limiter.allow(f"login:{ip}", 10, 900):
            raise HTTPException(status_code=429, detail="登录失败次数过多")

        identifier = payload.identifier.strip()
        with db.connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM users
                WHERE lower(email) = lower(?) OR lower(username) = lower(?)
                """,
                (identifier, identifier),
            ).fetchone()
            if (
                not row
                or not row["password_hash"]
                or not verify_password(row["password_hash"], payload.password)
                or row["status"] != "active"
            ):
                db.audit("auth.login_failed", ip, target=identifier[:120])
                raise HTTPException(status_code=401, detail="账号或密码错误")
            if password_needs_rehash(row["password_hash"]):
                connection.execute(
                    "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                    (hash_password(payload.password), utc_now(), row["id"]),
                )
            raw, csrf = create_session(connection, row["id"], "local")

        db.audit("auth.login", ip, user_id=row["id"], target="local")
        return auth_response(row, raw, csrf, "local")

    @app.post("/api/auth/logout")
    async def logout(
        request: Request,
        x_csrf_token: str | None = Header(default=None),
    ) -> Response:
        row = require_user(request)
        verify_csrf(row, x_csrf_token)
        with db.connect() as connection:
            connection.execute(
                "DELETE FROM sessions WHERE id = ?", (row["session_id"],)
            )
        response = Response(status_code=204)
        response.delete_cookie(SESSION_COOKIE, path=settings.cookie_path)
        return response

    @app.post("/api/auth/change-password")
    async def change_password(
        payload: PasswordRequest,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
    ) -> JSONResponse:
        row = require_user(request)
        verify_csrf(row, x_csrf_token)
        if not row["password_hash"] or not verify_password(
            row["password_hash"], payload.current_password
        ):
            raise HTTPException(status_code=401, detail="当前密码错误")
        try:
            new_hash = hash_password(payload.new_password)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        with db.connect() as connection:
            connection.execute(
                """
                UPDATE users
                SET password_hash = ?, must_change_password = 0, updated_at = ?
                WHERE id = ?
                """,
                (new_hash, utc_now(), row["id"]),
            )
            connection.execute(
                "DELETE FROM sessions WHERE user_id = ?",
                (row["id"],),
            )
            updated = connection.execute(
                "SELECT * FROM users WHERE id = ?",
                (row["id"],),
            ).fetchone()
            raw, csrf = create_session(
                connection,
                row["id"],
                row["auth_provider"],
            )
        db.audit(
            "auth.password_changed",
            request_ip(request),
            user_id=row["id"],
        )
        return auth_response(
            updated,
            raw,
            csrf,
            row["auth_provider"],
        )

    @app.post("/api/onboarding/complete")
    async def complete_onboarding(
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        user: dict[str, Any] = Depends(require_ready_user),
    ) -> dict[str, bool]:
        verify_csrf(user, x_csrf_token)
        now = utc_now()
        with db.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE users
                SET onboarding_completed_at = ?, updated_at = ?
                WHERE id = ? AND onboarding_completed_at IS NULL
                """,
                (now, now, user["id"]),
            )
        if cursor.rowcount:
            db.audit(
                "onboarding.completed",
                request_ip(request),
                user_id=user["id"],
            )
        return {"completed": True}

    @app.get("/api/auth/github")
    async def github_login(
        request: Request,
        mode: str = "login",
        return_to: str | None = None,
    ):
        if not settings.github_oauth_enabled:
            raise HTTPException(status_code=503, detail="GitHub OAuth 尚未配置")
        if mode not in {"login", "bind"}:
            raise HTTPException(status_code=422, detail="GitHub 认证模式无效")
        binding_user = (
            require_ready_user(request)
            if mode == "bind"
            else None
        )
        return_path = safe_return_path(return_to)
        # #region debug-point B:oauth-start
        exec("try:\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.185:7777/event',data=json.dumps({'sessionId':'oauth-submit-failures','runId':'post-fix','hypothesisId':'B','location':'main.py:github_login','msg':'[DEBUG] OAuth redirect created','data':{'mode':mode,'bindingUserId':binding_user['id'] if binding_user else None,'returnPath':return_path,'hasSessionCookie':bool(request.cookies.get(SESSION_COOKIE))},'ts':int(datetime.now(timezone.utc).timestamp()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
        # #endregion
        state = random_token()
        verifier = random_token()
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).decode("ascii").rstrip("=")
        now = datetime.now(timezone.utc)
        with db.connect() as connection:
            connection.execute(
                """
                INSERT INTO oauth_states(
                    state_hash, code_verifier, purpose, user_id,
                    return_to, expires_at, created_at
                )
                VALUES(?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    token_hash(state),
                    verifier,
                    mode,
                    binding_user["id"] if binding_user else None,
                    return_path,
                    (now + timedelta(minutes=10)).isoformat(),
                    now.isoformat(),
                ),
            )
            connection.execute(
                "DELETE FROM oauth_states WHERE expires_at <= ?",
                (now.isoformat(),),
            )
        query = urlencode(
            {
                "client_id": settings.github_client_id,
                "redirect_uri": f"{settings.base_url}/api/auth/github/callback",
                "scope": "read:user user:email public_repo",
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        response = RedirectResponse(
            f"https://github.com/login/oauth/authorize?{query}"
        )
        response.set_cookie(
            OAUTH_STATE_COOKIE,
            state,
            max_age=600,
            secure=settings.cookie_secure,
            httponly=True,
            samesite="lax",
            path=settings.cookie_path,
        )
        return response

    @app.get("/api/auth/github/callback")
    async def github_callback(
        request: Request,
        code: str | None = None,
        state: str | None = None,
        error: str | None = None,
    ):
        if not state:
            raise HTTPException(status_code=400, detail="OAuth state 缺失")
        cookie_states = request_cookie_values(request, OAUTH_STATE_COOKIE)
        cookie_state = next(
            (
                value
                for value in cookie_states
                if secrets.compare_digest(value, state)
            ),
            None,
        )
        if not cookie_state:
            raise HTTPException(
                status_code=400,
                detail="OAuth 请求与当前浏览器不匹配",
            )
        now = utc_now()
        with db.connect() as connection:
            oauth = connection.execute(
                """
                SELECT * FROM oauth_states
                WHERE state_hash = ? AND expires_at > ?
                """,
                (token_hash(state), now),
            ).fetchone()
        # #region debug-point A:state-lookup
        exec("try:\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.185:7777/event',data=json.dumps({'sessionId':'oauth-submit-failures','runId':'post-fix','hypothesisId':'A','location':'main.py:github_callback','msg':'[DEBUG] OAuth state lookup','data':{'stateFound':bool(oauth),'purpose':oauth['purpose'] if oauth else None,'bindingUserId':oauth['user_id'] if oauth else None,'cookieMatches':bool(cookie_state and secrets.compare_digest(cookie_state,state))},'ts':int(datetime.now(timezone.utc).timestamp()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
        # #endregion
        if not oauth:
            raise HTTPException(status_code=400, detail="OAuth state 已失效")
        if error:
            with db.connect() as connection:
                connection.execute(
                    "DELETE FROM oauth_states WHERE state_hash = ?",
                    (token_hash(state),),
                )
            target = browser_return_url(oauth["return_to"])
            separator = "&" if "?" in target else "?"
            response = RedirectResponse(
                f"{target}{separator}{urlencode({'github_auth_error': error})}"
            )
            response.delete_cookie(
                OAUTH_STATE_COOKIE,
                path=settings.cookie_path,
            )
            return response
        if not code:
            raise HTTPException(status_code=400, detail="OAuth code 缺失")
        binding_user = None
        if oauth["purpose"] == "bind":
            binding_user = read_session(request)
            if (
                not binding_user
                or binding_user["must_change_password"]
                or binding_user["id"] != oauth["user_id"]
            ):
                raise HTTPException(
                    status_code=401,
                    detail="发起绑定的登录会话已失效",
                )

        token = await github.exchange_oauth_code(code, oauth["code_verifier"])
        with db.connect() as connection:
            connection.execute(
                "DELETE FROM oauth_states WHERE state_hash = ?",
                (token_hash(state),),
            )
        profile = await github.user_profile(token)
        emails = await github.user_emails(token)
        verified = [item for item in emails if item.get("verified")]
        primary = next(
            (item for item in verified if item.get("primary")),
            verified[0] if verified else None,
        )
        if not primary:
            raise HTTPException(
                status_code=403,
                detail="GitHub 账号没有可用的已验证邮箱",
            )

        email = normalize_email(str(primary["email"]))
        github_id = int(profile["id"])
        github_login = str(profile["login"]).strip()
        github_username = slugify(github_login, "github-user")
        if len(github_username) < 3:
            github_username = f"{github_username}-gh"
        encrypted_token = cipher.encrypt(token)
        now = utc_now()

        with db.connect() as connection:
            if binding_user:
                owner = connection.execute(
                    """
                    SELECT id FROM users
                    WHERE (github_id = ? OR lower(github_login) = lower(?))
                      AND id != ?
                    """,
                    (github_id, github_login, binding_user["id"]),
                ).fetchone()
                if owner:
                    raise HTTPException(
                        status_code=409,
                        detail="该 GitHub 账号已绑定其他用户",
                    )
                target = connection.execute(
                    "SELECT * FROM users WHERE id = ? AND status = 'active'",
                    (binding_user["id"],),
                ).fetchone()
                if not target:
                    raise HTTPException(status_code=404, detail="用户不存在")
                if target["github_id"] not in {None, github_id}:
                    raise HTTPException(
                        status_code=409,
                        detail="当前账号已绑定其他 GitHub 账号，请先解绑",
                    )
                connection.execute(
                    """
                    UPDATE users
                    SET github_id = ?, github_login = ?, github_email = ?,
                        github_verified = 1,
                        email_verified = CASE
                            WHEN lower(email) = lower(?) THEN 1
                            ELSE email_verified
                        END,
                        github_token_encrypted = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        github_id,
                        github_login,
                        email,
                        email,
                        encrypted_token,
                        now,
                        binding_user["id"],
                    ),
                )
                user_id = binding_user["id"]
                row = connection.execute(
                    "SELECT * FROM users WHERE id = ?",
                    (user_id,),
                ).fetchone()
            else:
                github_owner = connection.execute(
                    "SELECT * FROM users WHERE github_id = ?",
                    (github_id,),
                ).fetchone()
                email_owner = connection.execute(
                    """
                    SELECT * FROM users WHERE lower(email) = lower(?)
                    """,
                    (email,),
                ).fetchone()
                if (
                    github_owner
                    and email_owner
                    and github_owner["id"] != email_owner["id"]
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="GitHub 身份与邮箱分别属于不同账号，请联系管理员",
                    )
                row = github_owner or email_owner
                if row and row["github_id"] not in {None, github_id}:
                    raise HTTPException(
                        status_code=409,
                        detail="该邮箱账号已绑定其他 GitHub 身份",
                    )
                if row:
                    connection.execute(
                        """
                        UPDATE users
                        SET github_id = ?, github_login = ?, github_email = ?,
                            github_verified = 1, email_verified = 1,
                            github_token_encrypted = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            github_id,
                            github_login,
                            email,
                            encrypted_token,
                            now,
                            row["id"],
                        ),
                    )
                    user_id = row["id"]
                else:
                    candidate = github_username
                    suffix = 1
                    while connection.execute(
                        "SELECT 1 FROM users WHERE lower(username) = lower(?)",
                        (candidate,),
                    ).fetchone():
                        suffix += 1
                        candidate = f"{github_username[:27]}-{suffix}"
                    cursor = connection.execute(
                        """
                        INSERT INTO users(
                            email, username, github_id, github_login,
                            github_email, github_verified, email_verified,
                            github_token_encrypted, created_at, updated_at
                        )
                        VALUES(?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
                        """,
                        (
                            email,
                            candidate,
                            github_id,
                            github_login,
                            email,
                            encrypted_token,
                            now,
                            now,
                        ),
                    )
                    user_id = cursor.lastrowid
                row = connection.execute(
                    "SELECT * FROM users WHERE id = ?", (user_id,)
                ).fetchone()
                raw, csrf = create_session(connection, user_id, "github")

        db.audit(
            "auth.github_bound" if binding_user else "auth.github",
            request_ip(request),
            user_id=user_id,
            target=github_login,
        )
        response = RedirectResponse(
            browser_return_url(oauth["return_to"])
        )
        if not binding_user:
            response.set_cookie(
                SESSION_COOKIE,
                raw,
                max_age=session_max_age(),
                secure=settings.cookie_secure,
                httponly=True,
                samesite="lax",
                path=settings.cookie_path,
            )
        response.delete_cookie(
            OAUTH_STATE_COOKIE,
            path=settings.cookie_path,
        )
        return response

    @app.post("/api/auth/github/unlink")
    async def github_unlink(
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        user: dict[str, Any] = Depends(require_ready_user),
    ) -> dict[str, bool]:
        verify_csrf(user, x_csrf_token)
        if not user["password_hash"]:
            raise HTTPException(
                status_code=409,
                detail="GitHub 是当前账号唯一登录方式，不能解绑",
            )
        with db.connect() as connection:
            connection.execute(
                """
                UPDATE users
                SET github_id = NULL, github_login = NULL,
                    github_email = NULL, github_verified = 0,
                    github_token_encrypted = NULL, updated_at = ?
                WHERE id = ?
                """,
                (utc_now(), user["id"]),
            )
        db.audit(
            "auth.github_unlinked",
            request_ip(request),
            user_id=user["id"],
        )
        return {"ok": True}

    @app.get("/api/repository/tree")
    async def repository_tree(
        refresh: bool = False,
        user: dict[str, Any] = Depends(require_editor),
    ) -> dict[str, Any]:
        del user
        reference, tree = await asyncio.gather(
            github.main_reference(),
            github.repository_tree(force=refresh),
        )
        items = []
        for item in tree:
            if int(item.get("size", 0)) > MAX_EDITABLE_FILE_BYTES:
                continue
            try:
                path = validate_content_path(item["path"])
            except ValueError:
                continue
            items.append(
                {
                    "path": path,
                    "sha": item["sha"],
                    "size": item.get("size", 0),
                }
            )
        revision = str(reference["object"]["sha"])
        contribution_graph = contribution_graph_payload(db)
        graph_revision = str(contribution_graph.get("revision") or "")
        graph_matches_tree = bool(
            graph_revision
            and (
                graph_revision.startswith(revision)
                or revision.startswith(graph_revision)
            )
        )
        return {
            "revision": revision,
            "items": items,
            "contribution_graph": (
                contribution_graph if graph_matches_tree else None
            ),
        }

    @app.get("/api/repository/update-announcement")
    async def repository_update_announcement(
        from_revision: str | None = None,
        user: dict[str, Any] = Depends(require_ready_user),
    ) -> dict[str, Any]:
        del user
        if from_revision and not re.fullmatch(
            r"[0-9a-fA-F]{7,40}",
            from_revision,
        ):
            raise HTTPException(
                status_code=422,
                detail="本地内容版本格式无效",
            )
        deployed = read_release_source(
            settings.site_release_source_path
        )
        to_revision = str(deployed.get("content") or "")
        if not re.fullmatch(r"[0-9a-fA-F]{40}", to_revision):
            reference = await github.main_reference()
            to_revision = str(reference["object"]["sha"])
        if not from_revision:
            from_revision = await github.repository_parent_revision(
                to_revision
            )
        if to_revision.startswith(from_revision) or (
            len(from_revision) == 40 and from_revision == to_revision
        ):
            return {
                "from_revision": from_revision,
                "to_revision": to_revision,
                "total_commits": 0,
                "commits": [],
                "files": [],
                "truncated": False,
            }
        return await github.repository_changes(
            from_revision,
            to_revision,
        )

    @app.get("/api/announcements/latest")
    async def latest_announcement(
        user: dict[str, Any] = Depends(require_ready_user),
    ) -> dict[str, Any]:
        del user
        with db.connect() as connection:
            row = connection.execute(
                """
                SELECT a.id, a.title, a.body, a.priority, a.display_mode,
                       a.published_at,
                       u.username AS published_by
                FROM announcements a
                JOIN users u ON u.id = a.created_by
                WHERE a.active = 1
                ORDER BY a.priority DESC, a.published_at DESC, a.id DESC
                LIMIT 1
                """
            ).fetchone()
        return {"announcement": dict(row) if row else None}

    @app.get("/api/announcements")
    async def active_announcements(
        user: dict[str, Any] = Depends(require_ready_user),
    ) -> dict[str, Any]:
        del user
        with db.connect() as connection:
            rows = connection.execute(
                """
                SELECT a.id, a.title, a.body, a.priority, a.display_mode,
                       a.published_at,
                       u.username AS published_by
                FROM announcements a
                JOIN users u ON u.id = a.created_by
                WHERE a.active = 1
                ORDER BY a.priority DESC, a.published_at DESC, a.id DESC
                LIMIT 20
                """
            ).fetchall()
        return {"items": [dict(row) for row in rows]}

    @app.get("/api/repository/file")
    async def repository_file(
        path: str,
        user: dict[str, Any] = Depends(require_editor),
    ) -> dict[str, Any]:
        del user
        try:
            normalized = validate_content_path(path)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return await github.repository_file(normalized)

    @app.get("/api/repository/delete-tree")
    async def repository_delete_tree(
        path: str,
        kind: str = "directory",
        user: dict[str, Any] = Depends(require_editor),
    ) -> dict[str, Any]:
        del user
        if kind not in {"file", "directory"}:
            raise HTTPException(status_code=422, detail="删除目标类型无效")
        try:
            normalized = validate_repository_path(
                path,
                allow_module_root=kind == "directory",
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        tree = await github.repository_tree()
        prefix = normalized.rstrip("/") + "/"
        items = []
        for item in tree:
            candidate = str(item.get("path") or "")
            matches = (
                candidate == normalized
                if kind == "file"
                else candidate.startswith(prefix)
            )
            if not matches:
                continue
            try:
                safe_path = validate_repository_path(candidate)
            except ValueError:
                continue
            items.append(
                {
                    "path": safe_path,
                    "sha": item["sha"],
                    "size": item.get("size", 0),
                }
            )
        if not items:
            raise HTTPException(status_code=404, detail="删除目标在 main 分支中不存在")
        return {"items": items}

    @app.get("/api/drafts")
    async def list_drafts(
        revision: str | None = None,
        user: dict[str, Any] = Depends(require_editor),
    ) -> dict[str, Any]:
        drafts = user_drafts(user["id"])
        current_revision = drafts_revision(drafts)
        return {
            "changed": revision != current_revision,
            "revision": current_revision,
            "items": drafts if revision != current_revision else [],
        }

    @app.put("/api/drafts")
    async def save_draft(
        payload: DraftRequest,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        user: dict[str, Any] = Depends(require_editor),
    ) -> dict[str, Any]:
        verify_csrf(user, x_csrf_token)
        try:
            path = (
                validate_repository_path(payload.path)
                if payload.operation == "delete"
                else validate_content_path(payload.path)
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if payload.operation not in {"upsert", "delete"}:
            raise HTTPException(status_code=422, detail="草稿操作无效")
        if payload.operation == "delete" and not payload.base_sha:
            raise HTTPException(
                status_code=422,
                detail="只能删除 main 分支中已存在的文件",
            )
        if len(payload.content.encode("utf-8")) > MAX_DRAFT_BYTES:
            raise HTTPException(status_code=413, detail="单个草稿超过大小限制")
        errors = (
            validate_markdown(path, payload.content)
            if payload.operation == "upsert"
            else []
        )
        if errors:
            raise HTTPException(status_code=422, detail=errors)

        now = utc_now()
        with db.connect() as connection:
            count = connection.execute(
                "SELECT COUNT(*) AS count FROM drafts WHERE user_id = ?",
                (user["id"],),
            ).fetchone()["count"]
            existing = connection.execute(
                "SELECT * FROM drafts WHERE user_id = ? AND path = ?",
                (user["id"], path),
            ).fetchone()
            if payload.base_revision is not None:
                if (
                    existing
                    and existing["revision"] != payload.base_revision
                ):
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": "draft_revision_conflict",
                            "draft": dict(existing),
                        },
                    )
                if not existing and payload.base_revision > 0:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": "draft_revision_conflict",
                            "draft": None,
                        },
                    )
            if not existing and count >= MAX_DRAFTS:
                raise HTTPException(status_code=413, detail="草稿文件数量已达上限")
            next_content = (
                "" if payload.operation == "delete" else payload.content
            )
            if (
                existing
                and existing["operation"] == payload.operation
                and existing["content"] == next_content
                and existing["base_sha"] == payload.base_sha
                and (
                    payload.base_content is None
                    or existing["base_content"] == payload.base_content
                )
            ):
                return dict(existing)
            connection.execute(
                """
                INSERT INTO drafts(
                    user_id, path, operation, content, base_sha,
                    base_content, revision, created_at, updated_at
                )
                VALUES(?, ?, ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(user_id, path) DO UPDATE SET
                    operation = excluded.operation,
                    content = excluded.content,
                    base_sha = excluded.base_sha,
                    base_content = COALESCE(
                        drafts.base_content,
                        excluded.base_content
                    ),
                    revision = drafts.revision + 1,
                    updated_at = excluded.updated_at
                """,
                (
                    user["id"],
                    path,
                    payload.operation,
                    next_content,
                    payload.base_sha,
                    payload.base_content,
                    now,
                    now,
                ),
            )
            row = connection.execute(
                "SELECT * FROM drafts WHERE user_id = ? AND path = ?",
                (user["id"], path),
            ).fetchone()
        db.audit(
            "draft.saved",
            request_ip(request),
            user_id=user["id"],
            target=path,
        )
        return dict(row)

    @app.delete("/api/drafts/{draft_id}")
    async def delete_draft(
        draft_id: int,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        user: dict[str, Any] = Depends(require_editor),
    ) -> Response:
        verify_csrf(user, x_csrf_token)
        with db.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM drafts WHERE id = ? AND user_id = ?",
                (draft_id, user["id"]),
            )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="草稿不存在")
        db.audit(
            "draft.deleted",
            request_ip(request),
            user_id=user["id"],
            target=str(draft_id),
        )
        return Response(status_code=204)

    @app.post("/api/modules")
    async def create_top_level_module(
        payload: TopLevelModuleRequest,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        user: dict[str, Any] = Depends(require_editor),
    ) -> dict[str, Any]:
        verify_csrf(user, x_csrf_token)
        slug = slugify(payload.slug, "")
        if not slug or not is_valid_module_root(slug):
            raise HTTPException(status_code=422, detail="顶级模块目录名无效")
        if payload.accent not in {"teal", "orange", "gold"}:
            raise HTTPException(status_code=422, detail="模块颜色无效")
        if payload.icon not in {
            "book-open",
            "braces",
            "folder-kanban",
            "gamepad-2",
            "messages-square",
            "network",
            "shapes",
        }:
            raise HTTPException(status_code=422, detail="模块图标无效")

        path = f"program/{slug}/README.md"
        tree = await github.repository_tree()
        if any(item["path"] == path for item in tree):
            raise HTTPException(status_code=409, detail="远端已存在该程序模块")
        description = payload.description.strip() or (
            f"{payload.title.strip()} 的知识内容与阅读导航。"
        )
        content = (
            "---\n"
            f"shortTitle: {json.dumps(payload.short_title.strip(), ensure_ascii=False)}\n"
            f"icon: {json.dumps(payload.icon)}\n"
            f"accent: {json.dumps(payload.accent)}\n"
            f"allowCode: {'true' if payload.allow_code else 'false'}\n"
            "---\n"
            f"# {payload.title.strip()}\n\n"
            f"{description}\n\n"
            "## 内容导航\n\n"
            "在此模块下创建子目录和 Markdown，网站会自动生成导航。\n"
        )
        now = utc_now()
        with db.connect() as connection:
            occupied = connection.execute(
                "SELECT user_id FROM drafts WHERE path = ?",
                (path,),
            ).fetchone()
            if occupied:
                raise HTTPException(
                    status_code=409,
                    detail="已有用户创建了同名程序模块草稿",
                )
            count = connection.execute(
                "SELECT COUNT(*) AS count FROM drafts WHERE user_id = ?",
                (user["id"],),
            ).fetchone()["count"]
            if count >= MAX_DRAFTS:
                raise HTTPException(
                    status_code=413,
                    detail="草稿文件数量已达上限",
                )
            cursor = connection.execute(
                """
                INSERT INTO drafts(
                    user_id, path, operation, content, base_sha,
                    revision, created_at, updated_at
                )
                VALUES(?, ?, 'upsert', ?, NULL, 1, ?, ?)
                """,
                (user["id"], path, content, now, now),
            )
            row = connection.execute(
                "SELECT * FROM drafts WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
        db.audit(
            "module.created",
            request_ip(request),
            user_id=user["id"],
            target=path,
        )
        return dict(row)

    @app.post("/api/topics")
    async def create_topic(
        payload: TopicRequest,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        user: dict[str, Any] = Depends(require_editor),
    ) -> dict[str, Any]:
        verify_csrf(user, x_csrf_token)
        tree = await github.repository_tree()
        module_roots = {
            module_root_for_path(item["path"])
            for item in tree
            if is_module_readme_path(item["path"])
        }
        with db.connect() as connection:
            for row in connection.execute(
                """
                SELECT path FROM drafts
                WHERE user_id = ? AND operation = 'upsert'
                """,
                (user["id"],),
            ).fetchall():
                if is_module_readme_path(row["path"]):
                    module_roots.add(module_root_for_path(row["path"]))
        if payload.root not in module_roots:
            raise HTTPException(status_code=422, detail="内容模块不存在")
        slug = slugify(payload.slug, "")
        if not slug:
            raise HTTPException(status_code=422, detail="专题目录名无效")
        parent_parts = [
            slugify(part, "")
            for part in payload.parent.strip("/").split("/")
            if part.strip()
        ]
        if any(not part for part in parent_parts):
            raise HTTPException(status_code=422, detail="父目录无效")
        path = "/".join([payload.root, *parent_parts, slug, "README.md"])
        try:
            path = validate_content_path(path)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        description = payload.description.strip()
        content = f"# {payload.title.strip()}\n\n"
        if description:
            content += f"{description}\n\n"
        content += "## 阅读导航\n\n请在此处补充章节入口和推荐阅读顺序。\n"

        if any(item["path"] == path for item in tree):
            raise HTTPException(status_code=409, detail="远端仓库中已存在该专题")
        now = utc_now()
        try:
            with db.connect() as connection:
                count = connection.execute(
                    "SELECT COUNT(*) AS count FROM drafts WHERE user_id = ?",
                    (user["id"],),
                ).fetchone()["count"]
                if count >= MAX_DRAFTS:
                    raise HTTPException(
                        status_code=413,
                        detail="草稿文件数量已达上限",
                    )
                connection.execute(
                    """
                    INSERT INTO drafts(
                        user_id, path, operation, content, base_sha,
                        revision, created_at, updated_at
                    )
                    VALUES(?, ?, 'upsert', ?, NULL, 1, ?, ?)
                    """,
                    (user["id"], path, content, now, now),
                )
                row = connection.execute(
                    "SELECT * FROM drafts WHERE user_id = ? AND path = ?",
                    (user["id"], path),
                ).fetchone()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="草稿中已存在该专题") from exc
        db.audit(
            "topic.created",
            request_ip(request),
            user_id=user["id"],
            target=path,
        )
        return dict(row)

    @app.post("/api/preview")
    async def preview(
        payload: PreviewRequest,
        user: dict[str, Any] = Depends(require_editor),
    ) -> dict[str, str]:
        del user
        return {"html": render_markdown_preview(payload.content)}

    @app.post("/api/submit")
    async def submit(
        payload: SubmitRequest,
        request: Request,
        background_tasks: BackgroundTasks,
        x_csrf_token: str | None = Header(default=None),
        user: dict[str, Any] = Depends(require_editor),
    ) -> dict[str, Any]:
        verify_csrf(user, x_csrf_token)
        branch = payload.branch.strip()
        expected_prefix = f"web/{slugify(user['username'], 'user')}/"
        branch_tail = branch.removeprefix(expected_prefix)
        if (
            not branch.startswith(expected_prefix)
            or not branch_tail
            or slugify(branch_tail, "") != branch_tail
        ):
            raise HTTPException(
                status_code=422,
                detail="提交分支必须位于当前用户的 web/ 命名空间",
            )
        if payload.pr_base != "main":
            raise HTTPException(
                status_code=422,
                detail="Pull Request 目标分支必须是 main",
            )
        drafts = [item.model_dump() for item in payload.changes]
        with db.connect() as connection:
            previous = connection.execute(
                """
                SELECT id, user_id, status, pr_number, pr_url
                FROM submissions
                WHERE branch_name = ?
                """,
                (branch,),
            ).fetchone()
        seen_paths: set[str] = set()
        for draft in drafts:
            try:
                draft["path"] = (
                    validate_repository_path(draft["path"])
                    if draft["operation"] == "delete"
                    else validate_content_path(draft["path"])
                )
            except ValueError as exc:
                raise HTTPException(
                    status_code=422,
                    detail=str(exc),
                ) from exc
            if draft["operation"] not in {"upsert", "delete"}:
                raise HTTPException(
                    status_code=422,
                    detail=f"{draft['path']} 的更改操作无效",
                )
            if draft["path"] in seen_paths:
                raise HTTPException(
                    status_code=422,
                    detail=f"{draft['path']} 在提交中重复出现",
                )
            seen_paths.add(draft["path"])
        if previous and previous["user_id"] != user["id"]:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "branch_conflict",
                    "message": "该提交头与其他用户的分支冲突，请更换提交头",
                    "branch": branch,
                    "can_overwrite": False,
                },
            )
        if (
            previous
            and previous["status"] != "failed"
            and not payload.force_update
        ):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "branch_conflict",
                    "message": "该提交头已经使用，是否覆盖原分支和 Draft PR？",
                    "branch": branch,
                    "can_overwrite": True,
                },
            )
        if payload.force_update and not previous:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "branch_conflict",
                    "message": "无法确认该分支属于当前用户，不能覆盖",
                    "branch": branch,
                    "can_overwrite": False,
                },
            )

        encrypted = user["github_token_encrypted"]
        if user["github_verified"] and encrypted:
            token_source = "github-user"
            try:
                submit_token = cipher.decrypt(encrypted)
            except RuntimeError as exc:
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "服务器无法解密已保存的 GitHub 凭证；"
                        "绑定信息仍在，请联系管理员检查加密密钥"
                    ),
                ) from exc
            author = None
            actor = f"@{user['github_login']} (GitHub)"
        elif user["auth_provider"] == "github":
            encrypted = user["github_token_encrypted"]
            if not encrypted:
                raise HTTPException(
                    status_code=403,
                    detail="GitHub 登录令牌不可用",
                )
            try:
                submit_token = cipher.decrypt(encrypted)
            except RuntimeError as exc:
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "服务器无法解密已保存的 GitHub 凭证；"
                        "请联系管理员检查加密密钥"
                    ),
                ) from exc
            token_source = "github-user"
            author = None
            actor = f"@{user['github_login']} (GitHub)"
        else:
            if not settings.github_bot_token:
                raise HTTPException(
                    status_code=503,
                    detail="服务器提交 Bot 尚未配置",
                )
            token_source = "bot"
            submit_token = settings.github_bot_token
            author_email = (
                user["email"]
                if user["email_verified"]
                else (
                    f"web-editor+{user['id']}"
                    "@users.noreply.chenyurui.top"
                )
            )
            author = {
                "name": user["username"],
                "email": author_email,
            }
            verification = "" if user["email_verified"] else " (unverified email)"
            actor = (
                f"{user['username']} <{user['email']}>"
                f"{verification}"
            )

        def github_credential_hint() -> str:
            if token_source == "github-user":
                return (
                    "GitHub 令牌已失效（可能已被撤销或过期），"
                    "请在账号菜单中刷新 GitHub 授权"
                )
            return (
                "服务器提交 Bot 令牌已失效，请联系站点管理员更新 "
                "EDITOR_GITHUB_BOT_TOKEN"
            )

        # #region debug-point D:submit-start
        exec("try:\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.185:7777/event',data=json.dumps({'sessionId':'oauth-submit-failures','runId':'post-fix','hypothesisId':'D','location':'main.py:submit','msg':'[DEBUG] Submission started','data':{'userId':user['id'],'authProvider':user['auth_provider'],'tokenSource':token_source,'draftCount':len(drafts),'branch':branch},'ts':int(datetime.now(timezone.utc).timestamp()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
        # #endregion
        now = utc_now()
        created_submission = previous is None
        with db.connect() as connection:
            if previous:
                submission_id = previous["id"]
                connection.execute(
                    """
                    UPDATE submissions
                    SET auth_provider = ?, title = ?, description = ?,
                        status = 'creating', commit_sha = NULL,
                        error_message = NULL, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        user["auth_provider"],
                        payload.pr_title.strip(),
                        payload.pr_body.strip(),
                        now,
                        submission_id,
                    ),
                )
            else:
                cursor = connection.execute(
                    """
                    INSERT INTO submissions(
                        user_id, auth_provider, branch_name, title, description,
                        status, created_at, updated_at
                    )
                    VALUES(?, ?, ?, ?, ?, 'creating', ?, ?)
                    """,
                    (
                        user["id"],
                        user["auth_provider"],
                        branch,
                        payload.pr_title.strip(),
                        payload.pr_body.strip(),
                        now,
                        now,
                    ),
                )
                submission_id = cursor.lastrowid

        try:
            result = await github.submit(
                token=submit_token,
                branch=branch,
                base_commit=payload.base_commit,
                commit_message=payload.commit_message.strip(),
                pr_title=payload.pr_title.strip(),
                pr_body=payload.pr_body,
                pr_base=payload.pr_base,
                draft=payload.draft,
                changes=drafts,
                author=author,
                actor_label=actor,
                force_update=payload.force_update,
            )
        except BranchConflictError as exc:
            can_overwrite = bool(
                previous and previous["user_id"] == user["id"]
            )
            with db.connect() as connection:
                if created_submission:
                    connection.execute(
                        "DELETE FROM submissions WHERE id = ?",
                        (submission_id,),
                    )
                else:
                    connection.execute(
                        """
                        UPDATE submissions
                        SET status = 'failed', error_message = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (str(exc), utc_now(), submission_id),
                    )
            db.audit(
                "submission.branch_conflict",
                request_ip(request),
                user_id=user["id"],
                target=branch,
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "branch_conflict",
                    "message": (
                        "GitHub 已存在该提交头，是否覆盖原分支？"
                        if can_overwrite
                        else "GitHub 已存在同名分支，请更换提交头"
                    ),
                    "branch": branch,
                    "can_overwrite": can_overwrite,
                },
            ) from exc
        except GitHubError as exc:
            # #region debug-point D:submit-failed
            exec("try:\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.185:7777/event',data=json.dumps({'sessionId':'oauth-submit-failures','runId':'post-fix','hypothesisId':'D','location':'main.py:submit-except','msg':'[DEBUG] Submission failed','data':{'statusCode':exc.status_code,'error':str(exc)[:500],'branch':branch},'ts':int(datetime.now(timezone.utc).timestamp()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
            # #endregion
            with db.connect() as connection:
                connection.execute(
                    """
                    UPDATE submissions
                    SET status = 'failed', error_message = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (str(exc)[:1000], utc_now(), submission_id),
                )
            db.audit(
                "submission.failed",
                request_ip(request),
                user_id=user["id"],
                target=branch,
                detail=str(exc)[:1000],
            )
            raise HTTPException(
                status_code=exc.status_code,
                detail=(
                    github_credential_hint()
                    if exc.status_code == 401
                    else str(exc)
                ),
            ) from exc

        completed_at = utc_now()
        with db.connect() as connection:
            connection.execute(
                """
                UPDATE submissions
                SET status = 'open', commit_sha = ?, pr_number = ?,
                    pr_url = ?, pr_updated_at = ?, last_synced_at = ?,
                    auto_closed = 0, closed_at = NULL, updated_at = ?
                WHERE id = ?
                """,
                (
                    result.commit_sha,
                    result.pr_number,
                    result.pr_url,
                    result.pr_updated_at or completed_at,
                    completed_at,
                    completed_at,
                    submission_id,
                ),
            )

        db.audit(
            (
                "submission.overwritten"
                if payload.force_update
                else "submission.created"
            ),
            request_ip(request),
            user_id=user["id"],
            target=result.pr_url,
            detail=branch,
        )
        admin_notification(
            background_tasks,
            "pull_request",
            f"[GCK] 新的内容提交 #{result.pr_number}",
            (
                f"提交人：{actor}\n"
                f"标题：{payload.pr_title.strip()}\n"
                f"分支：{branch}\n"
                f"PR：{result.pr_url}\n"
            ),
        )
        feedback_email_queued = contributor_notification(
            background_tasks,
            user,
            submission_id,
            (
                "contributor_submission_updated"
                if payload.force_update
                else "contributor_submission_received"
            ),
            (
                f"[GCK] 感谢你的贡献：PR #{result.pr_number} "
                f"{'已更新' if payload.force_update else '已创建'}"
            ),
            (
                "感谢你为 Game Client Knowledge 提交内容。\n\n"
                f"标题：{payload.pr_title.strip()}\n"
                f"PR：{result.pr_url}\n\n"
                "PR 被合并、关闭或因长期未处理自动关闭时，"
                "系统会继续发送邮件通知。\n"
                "查看状态或催办：\n"
                f"{user_action_url(settings, submission_id)}\n"
            ),
        )
        return {
            "id": submission_id,
            "branch": result.branch,
            "commit_sha": result.commit_sha,
            "pr_number": result.pr_number,
            "pr_url": result.pr_url,
            "overwritten": payload.force_update,
            "feedback_email_queued": feedback_email_queued,
        }

    @app.get("/api/submissions")
    async def submissions(
        user: dict[str, Any] = Depends(require_ready_user),
    ) -> dict[str, Any]:
        with db.connect() as connection:
            rows = connection.execute(
                """
                SELECT id, branch_name, title, commit_sha, pr_number,
                       pr_url, status, error_message, pr_updated_at,
                       last_synced_at, auto_closed, closed_at,
                       last_urged_at, urge_count, created_at, updated_at
                FROM submissions
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT 50
                """,
                (user["id"],),
            ).fetchall()
        return {"items": [dict(row) for row in rows]}

    @app.post("/api/submissions/{submission_id}/urge")
    async def urge_submission(
        submission_id: int,
        request: Request,
        background_tasks: BackgroundTasks,
        x_csrf_token: str | None = Header(default=None),
        user: dict[str, Any] = Depends(require_ready_user),
    ) -> dict[str, Any]:
        verify_csrf(user, x_csrf_token)
        with db.connect() as connection:
            submission = connection.execute(
                """
                SELECT * FROM submissions
                WHERE id = ? AND user_id = ?
                """,
                (submission_id, user["id"]),
            ).fetchone()
        if not submission:
            raise HTTPException(status_code=404, detail="提交记录不存在")
        if submission["status"] != "open":
            raise HTTPException(status_code=409, detail="只能催办正在处理的 PR")

        now = datetime.now(timezone.utc)
        last_urged = parse_github_time(submission["last_urged_at"])
        if last_urged and now - last_urged < timedelta(hours=24):
            raise HTTPException(
                status_code=429,
                detail="每个 PR 每 24 小时只能催办一次",
            )
        now_iso = now.isoformat()
        with db.connect() as connection:
            connection.execute(
                """
                UPDATE submissions
                SET last_urged_at = ?, urge_count = urge_count + 1,
                    updated_at = ?
                WHERE id = ? AND user_id = ?
                """,
                (now_iso, now_iso, submission_id, user["id"]),
            )
        admin_notification(
            background_tasks,
            "pull_request_urged",
            f"[GCK] 用户催办 PR #{submission['pr_number']}",
            (
                f"提交人：{user['username']} <{user['email']}>\n"
                f"标题：{submission['title']}\n"
                f"PR：{submission['pr_url']}\n"
            ),
        )
        db.audit(
            "submission.urged",
            request_ip(request),
            user_id=user["id"],
            target=submission["pr_url"],
        )
        return {
            "id": submission_id,
            "status": "open",
            "last_urged_at": now_iso,
            "urge_count": int(submission["urge_count"]) + 1,
        }

    @app.post("/api/submissions/{submission_id}/restore-and-urge")
    async def restore_and_urge_submission(
        submission_id: int,
        request: Request,
        background_tasks: BackgroundTasks,
        x_csrf_token: str | None = Header(default=None),
        user: dict[str, Any] = Depends(require_ready_user),
    ) -> dict[str, Any]:
        verify_csrf(user, x_csrf_token)
        if not settings.github_bot_token:
            raise HTTPException(
                status_code=503,
                detail="服务器提交 Bot 尚未配置",
            )
        with db.connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM submissions
                WHERE id = ? AND user_id = ?
                """,
                (submission_id, user["id"]),
            ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="提交记录不存在")
        submission = dict(row)
        if submission["status"] != "closed" or not submission["auto_closed"]:
            raise HTTPException(
                status_code=409,
                detail="只有系统自动关闭的 PR 可以恢复",
            )

        pull = await github.update_pull_state(
            submission["pr_number"],
            "open",
            settings.github_bot_token,
        )
        now_iso = utc_now()
        pr_updated_at = pull.get("updated_at") or now_iso
        with db.connect() as connection:
            connection.execute(
                """
                UPDATE submissions
                SET status = 'open', auto_closed = 0, closed_at = NULL,
                    pr_updated_at = ?, last_synced_at = ?,
                    last_urged_at = ?, urge_count = urge_count + 1,
                    updated_at = ?
                WHERE id = ? AND user_id = ?
                """,
                (
                    pr_updated_at,
                    now_iso,
                    now_iso,
                    now_iso,
                    submission_id,
                    user["id"],
                ),
            )
        admin_notification(
            background_tasks,
            "pull_request_restored_and_urged",
            f"[GCK] 用户恢复并催办 PR #{submission['pr_number']}",
            (
                f"提交人：{user['username']} <{user['email']}>\n"
                f"标题：{submission['title']}\n"
                f"PR：{submission['pr_url']}\n"
            ),
        )
        contributor_notification(
            background_tasks,
            user,
            submission_id,
            "contributor_pr_restored",
            f"[GCK] PR #{submission['pr_number']} 已恢复",
            (
                f"你的贡献 {submission['title']} 已重新打开，"
                "并已通知管理员处理。\n\n"
                f"PR：{submission['pr_url']}\n"
            ),
        )
        db.audit(
            "submission.restored_and_urged",
            request_ip(request),
            user_id=user["id"],
            target=submission["pr_url"],
        )
        return {
            "id": submission_id,
            "status": "open",
            "auto_closed": False,
            "last_urged_at": now_iso,
            "urge_count": int(submission["urge_count"]) + 1,
        }

    @app.post("/api/admin-applications")
    async def apply_admin(
        payload: AdminApplicationRequest,
        request: Request,
        background_tasks: BackgroundTasks,
        x_csrf_token: str | None = Header(default=None),
        user: dict[str, Any] = Depends(require_ready_user),
    ) -> dict[str, Any]:
        verify_csrf(user, x_csrf_token)
        if user["role"] == "admin":
            raise HTTPException(status_code=409, detail="已经是管理员")
        try:
            with db.connect() as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO admin_applications(user_id, message, created_at)
                    VALUES(?, ?, ?)
                    """,
                    (user["id"], payload.message.strip(), utc_now()),
                )
                application_id = cursor.lastrowid
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="已有待处理申请") from exc
        db.audit(
            "admin_application.created",
            request_ip(request),
            user_id=user["id"],
            target=str(application_id),
        )
        admin_notification(
            background_tasks,
            "admin_application",
            "[GCK] 新的管理员申请",
            (
                f"申请人：{user['username']} <{user['email']}>\n"
                f"申请说明：{payload.message.strip()}\n"
                f"管理后台：{settings.base_url}/admin\n"
            ),
        )
        return {"id": application_id, "status": "pending"}

    @app.get("/api/admin/overview")
    async def admin_overview(
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        del admin
        with db.connect() as connection:
            users = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT id, email, username, github_login, github_verified,
                           email_verified, role, status,
                           must_change_password, created_at
                    FROM users
                    WHERE is_system = 0
                    ORDER BY created_at DESC LIMIT 200
                    """
                ).fetchall()
            ]
            applications = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT a.*, u.email, u.username
                    FROM admin_applications a
                    JOIN users u ON u.id = a.user_id
                    ORDER BY a.created_at DESC LIMIT 100
                    """
                ).fetchall()
            ]
            submissions = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT s.*, u.email, u.username
                    FROM submissions s
                    JOIN users u ON u.id = s.user_id
                    ORDER BY s.created_at DESC LIMIT 100
                    """
                ).fetchall()
            ]
            external_pull_requests = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT * FROM external_pull_requests
                    ORDER BY created_at DESC LIMIT 100
                    """
                ).fetchall()
            ]
            notifications = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT * FROM notifications
                    ORDER BY created_at DESC LIMIT 100
                    """
                ).fetchall()
            ]
            announcements = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT a.id, a.title, a.body, a.active, a.priority,
                           a.display_mode, a.published_at,
                           u.username AS published_by
                    FROM announcements a
                    JOIN users u ON u.id = a.created_by
                    ORDER BY a.active DESC, a.priority DESC,
                             a.published_at DESC, a.id DESC
                    LIMIT 50
                    """
                ).fetchall()
            ]
            comment_agent_usage = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT u.id AS user_id, u.username, u.email,
                           COUNT(ar.id) AS request_count,
                           COALESCE(SUM(ar.input_tokens), 0) AS input_tokens,
                           COALESCE(SUM(ar.output_tokens), 0) AS output_tokens,
                           COALESCE(SUM(ar.total_tokens), 0) AS total_tokens
                    FROM users u
                    LEFT JOIN comment_agent_requests ar
                        ON ar.requested_by = u.id
                    WHERE u.is_system = 0
                    GROUP BY u.id
                    ORDER BY total_tokens DESC, u.username COLLATE NOCASE
                    """
                ).fetchall()
            ]
        smtp = smtp_configuration()
        comment_agent = comment_agent_configuration()
        intro_mode = resolved_home_intro_mode()
        intro_timing = resolved_home_intro_timing()
        return {
            "users": users,
            "applications": applications,
            "submissions": submissions,
            "external_pull_requests": external_pull_requests,
            "notifications": notifications,
            "announcements": announcements,
            "analytics": analytics_dashboard(db),
            "settings": {
                "edit_policy": db.setting(
                    "edit_policy", settings.default_edit_policy
                ),
                "registration_enabled": (
                    db.setting("registration_enabled", "1") == "1"
                ),
                "pr_auto_close_days": auto_close_days(db, settings),
                "reader_edit_mode": db.setting("reader_edit_mode", "new"),
                "reader_diff_enabled": (
                    db.setting("reader_diff_enabled", "1") == "1"
                ),
                "workspace_sync_interval_seconds": int(
                    db.setting("workspace_sync_interval_seconds", "60")
                ),
                "session_idle_days": session_idle_days(),
                "site_auto_update_interval_minutes": int(
                    db.setting("site_auto_update_interval_minutes", "10")
                ),
                "catalog_background_style": db.setting(
                    "catalog_background_style", "circuit"
                ),
                "reader_background_style": db.setting(
                    "reader_background_style", "blueprint"
                ),
                "pointer_effect_enabled": (
                    db.setting("pointer_effect_enabled", "1") == "1"
                ),
                "home_intro_enabled": intro_mode != "off",
                "home_intro_mode": intro_mode,
                "home_intro_duration_ms": intro_timing[
                    "home_intro_duration_ms"
                ],
                "home_intro_assembly_duration_ms": intro_timing[
                    "home_intro_assembly_duration_ms"
                ],
                "home_intro_hold_duration_ms": intro_timing[
                    "home_intro_hold_duration_ms"
                ],
                "home_intro_lock_scroll": (
                    db.setting("home_intro_lock_scroll", "1") == "1"
                ),
                "home_intro_contributor_limit": int(
                    db.setting("home_intro_contributor_limit", "8")
                ),
                **star_visual_payload(),
                "smtp_enabled": smtp.smtp_enabled,
                "github_oauth_enabled": settings.github_oauth_enabled,
                "github_submission_enabled": settings.github_submission_enabled,
            },
            "site_update": update_status(
                settings.site_update_status_path,
                settings.site_release_source_path,
                settings.site_update_request_path,
            ),
            "smtp": smtp_public_payload(smtp),
            "smtp_templates": SMTP_TEMPLATES,
            "comment_agent": comment_agent_public_payload(comment_agent),
            "comment_agent_templates": COMMENT_AGENT_TEMPLATES,
            "comment_agent_usage": comment_agent_usage,
        }

    @app.post("/api/admin/applications/{application_id}")
    async def decide_admin_application(
        application_id: int,
        payload: AdminDecisionRequest,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        verify_csrf(admin, x_csrf_token)
        if payload.decision not in {"approved", "rejected"}:
            raise HTTPException(status_code=422, detail="审批结果无效")
        now = utc_now()
        with db.connect() as connection:
            application = connection.execute(
                """
                SELECT * FROM admin_applications
                WHERE id = ? AND status = 'pending'
                """,
                (application_id,),
            ).fetchone()
            if not application:
                raise HTTPException(status_code=404, detail="待处理申请不存在")
            connection.execute(
                """
                UPDATE admin_applications
                SET status = ?, reviewed_by = ?, reviewed_at = ?
                WHERE id = ?
                """,
                (payload.decision, admin["id"], now, application_id),
            )
            if payload.decision == "approved":
                connection.execute(
                    "UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?",
                    (now, application["user_id"]),
                )
        db.audit(
            f"admin_application.{payload.decision}",
            request_ip(request),
            user_id=admin["id"],
            target=str(application_id),
        )
        return {"id": application_id, "status": payload.decision}

    @app.post("/api/admin/users/{user_id}/verify-email")
    async def verify_user_email(
        user_id: int,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        verify_csrf(admin, x_csrf_token)
        with db.connect() as connection:
            user = connection.execute(
                "SELECT id, email FROM users WHERE id = ? AND status = 'active'",
                (user_id,),
            ).fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="用户不存在")
            connection.execute(
                """
                UPDATE users
                SET email_verified = 1, updated_at = ?
                WHERE id = ?
                """,
                (utc_now(), user_id),
            )
        db.audit(
            "user.email_verified",
            request_ip(request),
            user_id=admin["id"],
            target=str(user_id),
            detail=user["email"],
        )
        return {"id": user_id, "email_verified": True}

    @app.put("/api/admin/settings")
    async def update_settings(
        payload: SettingsRequest,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        verify_csrf(admin, x_csrf_token)
        if payload.edit_policy not in {
            "local_authenticated",
            "github_verified",
        }:
            raise HTTPException(status_code=422, detail="编辑策略无效")
        if payload.reader_edit_mode not in {"old", "new"}:
            raise HTTPException(status_code=422, detail="阅读器编辑模式无效")
        now = utc_now()
        with db.connect() as connection:
            for key, value in {
                "edit_policy": payload.edit_policy,
                "registration_enabled": (
                    "1" if payload.registration_enabled else "0"
                ),
                "pr_auto_close_days": str(payload.pr_auto_close_days),
                "session_idle_days": str(payload.session_idle_days),
                "reader_edit_mode": payload.reader_edit_mode,
                "reader_diff_enabled": (
                    "1" if payload.reader_diff_enabled else "0"
                ),
                "workspace_sync_interval_seconds": str(
                    payload.workspace_sync_interval_seconds
                ),
                "site_auto_update_interval_minutes": str(
                    payload.site_auto_update_interval_minutes
                ),
            }.items():
                connection.execute(
                    """
                    INSERT INTO settings(key, value, updated_by, updated_at)
                    VALUES(?, ?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_by = excluded.updated_by,
                        updated_at = excluded.updated_at
                    """,
                    (key, value, admin["id"], now),
                )
        db.audit(
            "settings.updated",
            request_ip(request),
            user_id=admin["id"],
            detail=json.dumps(payload.model_dump(), ensure_ascii=False),
        )
        return {
            "edit_policy": payload.edit_policy,
            "registration_enabled": payload.registration_enabled,
            "pr_auto_close_days": payload.pr_auto_close_days,
            "session_idle_days": payload.session_idle_days,
            "reader_edit_mode": payload.reader_edit_mode,
            "reader_diff_enabled": payload.reader_diff_enabled,
            "workspace_sync_interval_seconds": (
                payload.workspace_sync_interval_seconds
            ),
            "site_auto_update_interval_minutes": (
                payload.site_auto_update_interval_minutes
            ),
        }

    @app.put("/api/admin/visual-settings")
    async def update_visual_settings(
        payload: VisualSettingsRequest,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        verify_csrf(admin, x_csrf_token)
        if payload.catalog_background_style not in {
            "clean",
            "circuit",
            "constellation",
        }:
            raise HTTPException(status_code=422, detail="目录背景样式无效")
        if payload.reader_background_style not in {
            "clean",
            "blueprint",
            "constellation",
        }:
            raise HTTPException(status_code=422, detail="阅读背景样式无效")
        intro_mode = payload.home_intro_mode or (
            "revisit" if payload.home_intro_enabled else "off"
        )
        if intro_mode not in {"off", "always", "revisit", "first"}:
            raise HTTPException(status_code=422, detail="入场动画策略无效")
        if payload.home_background_style not in {
            "old_star_map",
            "contribution_star_map",
        }:
            raise HTTPException(status_code=422, detail="主页背景样式无效")
        if payload.home_star_scope not in {"hero", "full"}:
            raise HTTPException(status_code=422, detail="主页星图范围无效")
        if payload.home_star_render_mode not in {
            "2d",
            "2d-webgl",
            "3d",
            "3d-drift",
            "3d-drift-anchored",
            "3d-galaxy",
            "3d-orbit",
            "3d-spiral",
            "3d-nebula",
            "3d-clusters",
            "3d-shell",
        }:
            raise HTTPException(status_code=422, detail="主页星图渲染模式无效")
        if payload.home_star_experience_mode not in {
            "immersive",
            "contribution_portal",
        }:
            raise HTTPException(status_code=422, detail="主页星图体验模式无效")
        if payload.home_star_portal_collapsed_structure not in {
            "match_expanded",
            "octahedron",
            "sphere",
            "cube",
            "3d",
            "3d-drift",
            "3d-drift-anchored",
            "3d-galaxy",
            "3d-orbit",
            "3d-spiral",
            "3d-nebula",
            "3d-clusters",
            "3d-shell",
        }:
            raise HTTPException(status_code=422, detail="贡献空间微缩结构无效")
        if payload.home_star_portal_expanded_structure not in {
            "3d",
            "3d-drift",
            "3d-drift-anchored",
            "3d-galaxy",
            "3d-orbit",
            "3d-spiral",
            "3d-nebula",
            "3d-clusters",
            "3d-shell",
        }:
            raise HTTPException(status_code=422, detail="贡献空间展开结构无效")
        if payload.home_star_relation_visibility not in {
            "always",
            "near",
            "hidden",
        }:
            raise HTTPException(status_code=422, detail="星图联系显示模式无效")
        relation_styles = {
            payload.home_star_strong_relation_style,
            payload.home_star_reference_relation_style,
            payload.home_star_contributor_relation_style,
        }
        if not relation_styles.issubset({"solid", "dashed", "glow"}):
            raise HTTPException(status_code=422, detail="星图联系样式无效")
        if (
            payload.home_star_illumination_rule
            not in STAR_ILLUMINATION_RULE_IDS
        ):
            raise HTTPException(status_code=422, detail="星图点亮规则无效")
        if payload.home_star_graph_direction not in {
            "directed",
            "undirected",
        }:
            raise HTTPException(status_code=422, detail="星图方向模式无效")
        if (
            payload.home_star_brightness_min
            > payload.home_star_brightness_initial
            or payload.home_star_brightness_min
            > payload.home_star_brightness_max
            or payload.home_star_brightness_initial
            > payload.home_star_brightness_max
        ):
            raise HTTPException(
                status_code=422,
                detail="星图亮度必须满足最小值不大于初始值和最大值",
            )
        if payload.home_star_active_edge_mode not in {
            "full",
            "minimal_tree",
            "single_path",
        }:
            raise HTTPException(
                status_code=422,
                detail="主动点亮关系视觉无效",
            )
        rule_ids: set[str] = set()
        for index, rule in enumerate(payload.home_star_brightness_rules, 1):
            if rule.id in rule_ids or rule.target not in STAR_FORMULA_TARGETS:
                raise HTTPException(
                    status_code=422,
                    detail=f"第 {index} 条星图亮度规则无效",
                )
            try:
                validate_star_formula(rule.formula)
            except ValueError as error:
                raise HTTPException(
                    status_code=422,
                    detail=f"第 {index} 条亮度规则：{error}",
                ) from error
            rule_ids.add(rule.id)
        tier_ids: set[str] = set()
        tier_thresholds: set[float] = set()
        for tier in payload.home_star_brightness_tiers:
            if (
                tier.id in tier_ids
                or tier.min_brightness in tier_thresholds
            ):
                raise HTTPException(
                    status_code=422,
                    detail="星星等级 ID 或亮度阈值无效",
                )
            tier_ids.add(tier.id)
            tier_thresholds.add(tier.min_brightness)
        current_timing = resolved_home_intro_timing()
        split_timing = (
            payload.home_intro_assembly_duration_ms is not None
            or payload.home_intro_hold_duration_ms is not None
        )
        if split_timing:
            assembly_duration_ms = (
                payload.home_intro_assembly_duration_ms
                if payload.home_intro_assembly_duration_ms is not None
                else current_timing["home_intro_assembly_duration_ms"]
            )
            hold_duration_ms = (
                payload.home_intro_hold_duration_ms
                if payload.home_intro_hold_duration_ms is not None
                else current_timing["home_intro_hold_duration_ms"]
            )
            total_duration_ms = (
                assembly_duration_ms
                + hold_duration_ms
                + current_timing["home_intro_scroll_duration_ms"]
            )
        else:
            total_duration_ms = payload.home_intro_duration_ms
            assembly_duration_ms = round(total_duration_ms * 0.56)
            hold_duration_ms = round(total_duration_ms * 0.21)
        now = utc_now()
        values = {
            "catalog_background_style": payload.catalog_background_style,
            "reader_background_style": payload.reader_background_style,
            "pointer_effect_enabled": (
                "1" if payload.pointer_effect_enabled else "0"
            ),
            "home_intro_enabled": "0" if intro_mode == "off" else "1",
            "home_intro_mode": intro_mode,
            "home_intro_duration_ms": str(total_duration_ms),
            "home_intro_assembly_duration_ms": str(
                assembly_duration_ms
            ),
            "home_intro_hold_duration_ms": str(hold_duration_ms),
            "home_intro_lock_scroll": (
                "1" if payload.home_intro_lock_scroll else "0"
            ),
            "home_intro_contributor_limit": str(
                payload.home_intro_contributor_limit
            ),
            "home_background_style": payload.home_background_style,
            "home_star_scope": payload.home_star_scope,
            "home_star_render_mode": payload.home_star_render_mode,
            "home_star_experience_mode": (
                payload.home_star_experience_mode
            ),
            "home_star_portal_collapsed_structure": (
                payload.home_star_portal_collapsed_structure
            ),
            "home_star_portal_expanded_structure": (
                payload.home_star_portal_expanded_structure
            ),
            "home_star_portal_rotation_speed": str(
                payload.home_star_portal_rotation_speed
            ),
            "home_star_portal_size_percent": str(
                payload.home_star_portal_size_percent
            ),
            "home_star_portal_brightness_percent": str(
                payload.home_star_portal_brightness_percent
            ),
            "home_star_relation_visibility": (
                payload.home_star_relation_visibility
            ),
            "home_star_strong_relation_style": (
                payload.home_star_strong_relation_style
            ),
            "home_star_reference_relation_style": (
                payload.home_star_reference_relation_style
            ),
            "home_star_contributor_relation_style": (
                payload.home_star_contributor_relation_style
            ),
            "home_star_hover_info_enabled": (
                "1" if payload.home_star_hover_info_enabled else "0"
            ),
            "home_star_hover_relations_enabled": (
                "1" if payload.home_star_hover_relations_enabled else "0"
            ),
            "home_star_hover_relation_opacity_percent": str(
                payload.home_star_hover_relation_opacity_percent
            ),
            "home_star_brightness_variation_enabled": (
                "1"
                if payload.home_star_brightness_variation_enabled
                else "0"
            ),
            "home_star_brightness_initial": str(
                payload.home_star_brightness_initial
            ),
            "home_star_brightness_min": str(
                payload.home_star_brightness_min
            ),
            "home_star_brightness_max": str(
                payload.home_star_brightness_max
            ),
            "home_star_brightness_variation_amount": str(
                payload.home_star_brightness_variation_amount
            ),
            "home_star_brightness_transition_ms": str(
                payload.home_star_brightness_transition_ms
            ),
            "home_star_brightness_interval_ms": str(
                payload.home_star_brightness_interval_ms
            ),
            "home_star_color_random_enabled": (
                "1" if payload.home_star_color_random_enabled else "0"
            ),
            "home_star_graph_direction": (
                payload.home_star_graph_direction
            ),
            "home_star_illumination_rule": (
                payload.home_star_illumination_rule
            ),
            "home_star_illumination_depth": str(
                payload.home_star_illumination_depth
            ),
            "home_star_selection_duration_ms": str(
                payload.home_star_selection_duration_ms
            ),
            "home_star_label_duration_ms": str(
                payload.home_star_label_duration_ms
            ),
            "home_star_selected_radius_boost": str(
                payload.home_star_selected_radius_boost
            ),
            "home_star_selected_alpha_boost": str(
                payload.home_star_selected_alpha_boost
            ),
            "home_star_selected_halo_alpha_boost": str(
                payload.home_star_selected_halo_alpha_boost
            ),
            "home_star_selected_glow_scale": str(
                payload.home_star_selected_glow_scale
            ),
            "home_star_selected_contributor_line_width": str(
                payload.home_star_selected_contributor_line_width
            ),
            "home_star_3d_min_depth": str(
                payload.home_star_3d_min_depth
            ),
            "home_star_3d_halo_max_css_size": str(
                payload.home_star_3d_halo_max_css_size
            ),
            "home_star_3d_core_max_css_size": str(
                payload.home_star_3d_core_max_css_size
            ),
            "home_star_3d_spike_max_css_size": str(
                payload.home_star_3d_spike_max_css_size
            ),
            "home_star_3d_pulse_max_css_size": str(
                payload.home_star_3d_pulse_max_css_size
            ),
            "home_star_3d_field_enabled": (
                "1" if payload.home_star_3d_field_enabled else "0"
            ),
            "home_star_3d_field_star_count": str(
                payload.home_star_3d_field_star_count
            ),
            "home_star_3d_dust_enabled": (
                "1" if payload.home_star_3d_dust_enabled else "0"
            ),
            "home_star_3d_dust_star_count": str(
                payload.home_star_3d_dust_star_count
            ),
            "home_star_3d_cluster_enabled": (
                "1" if payload.home_star_3d_cluster_enabled else "0"
            ),
            "home_star_3d_cluster_star_count": str(
                payload.home_star_3d_cluster_star_count
            ),
            "home_star_3d_stream_enabled": (
                "1" if payload.home_star_3d_stream_enabled else "0"
            ),
            "home_star_3d_stream_star_count": str(
                payload.home_star_3d_stream_star_count
            ),
            "home_star_3d_nebula_enabled": (
                "1" if payload.home_star_3d_nebula_enabled else "0"
            ),
            "home_star_3d_nebula_star_count": str(
                payload.home_star_3d_nebula_star_count
            ),
            "home_star_3d_background_brightness_percent": str(
                payload.home_star_3d_background_brightness_percent
            ),
            "home_star_3d_dust_brightness_percent": str(
                payload.home_star_3d_dust_brightness_percent
            ),
            "home_star_3d_background_size_percent": str(
                payload.home_star_3d_background_size_percent
            ),
            "home_star_3d_structure_motion_percent": str(
                payload.home_star_3d_structure_motion_percent
            ),
            "home_star_active_edge_mode": (
                payload.home_star_active_edge_mode
            ),
            "home_star_brightness_rules": json.dumps(
                [
                    rule.model_dump()
                    for rule in payload.home_star_brightness_rules
                ],
                ensure_ascii=False,
            ),
            "home_star_brightness_tiers": json.dumps(
                [
                    tier.model_dump(exclude_none=True)
                    for tier in sorted(
                        payload.home_star_brightness_tiers,
                        key=lambda item: item.min_brightness,
                    )
                ],
                ensure_ascii=False,
            ),
        }
        mask_field = "home_content_mask_enabled"
        if mask_field in payload.model_fields_set:
            values[mask_field] = (
                "1" if payload.home_content_mask_enabled else "0"
            )
        idle_field = "home_content_idle_timeout_seconds"
        if idle_field in payload.model_fields_set:
            values[idle_field] = str(
                payload.home_content_idle_timeout_seconds
            )
        with db.connect() as connection:
            for key, value in values.items():
                connection.execute(
                    """
                    INSERT INTO settings(key, value, updated_by, updated_at)
                    VALUES(?, ?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_by = excluded.updated_by,
                        updated_at = excluded.updated_at
                    """,
                    (key, value, admin["id"], now),
                )
        response_payload = {
            **payload.model_dump(),
            "home_star_brightness_tiers": [
                tier.model_dump(exclude_none=True)
                for tier in payload.home_star_brightness_tiers
            ],
            "home_intro_enabled": intro_mode != "off",
            "home_intro_mode": intro_mode,
            "home_intro_duration_ms": total_duration_ms,
            "home_intro_assembly_duration_ms": assembly_duration_ms,
            "home_intro_hold_duration_ms": hold_duration_ms,
        }
        if mask_field not in payload.model_fields_set:
            response_payload.pop(mask_field, None)
        if idle_field not in payload.model_fields_set:
            response_payload.pop(idle_field, None)
        db.audit(
            "visual_settings.updated",
            request_ip(request),
            user_id=admin["id"],
            detail=json.dumps(response_payload, ensure_ascii=False),
        )
        return response_payload

    @app.post("/api/admin/submissions/sync")
    async def sync_submission_statuses(
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, int]:
        verify_csrf(admin, x_csrf_token)
        result = await run_pr_sync()
        db.audit(
            "submission.sync_requested",
            request_ip(request),
            user_id=admin["id"],
            detail=json.dumps(result, ensure_ascii=False),
        )
        return result

    @app.get("/api/admin/site-update")
    async def site_update_state(
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        del admin
        return update_status(
            settings.site_update_status_path,
            settings.site_release_source_path,
            settings.site_update_request_path,
        )

    @app.post("/api/admin/announcements")
    async def publish_announcement(
        payload: AnnouncementRequest,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        verify_csrf(admin, x_csrf_token)
        title = payload.title.strip()
        body = payload.body.strip()
        if not title or not body:
            raise HTTPException(status_code=422, detail="公告标题和正文不能为空")
        published_at = utc_now()
        with db.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO announcements(
                    title, body, created_by, active, priority,
                    display_mode, published_at, created_at, updated_at
                )
                VALUES(?, ?, ?, 1, ?, ?, ?, ?, ?)
                """,
                (
                    title,
                    body,
                    admin["id"],
                    payload.priority,
                    payload.display_mode,
                    published_at,
                    published_at,
                    published_at,
                ),
            )
            announcement_id = int(cursor.lastrowid)
        db.audit(
            "announcement.published",
            request_ip(request),
            user_id=admin["id"],
            target=str(announcement_id),
            detail=title,
        )
        return {
            "id": announcement_id,
            "title": title,
            "body": body,
            "active": True,
            "priority": payload.priority,
            "display_mode": payload.display_mode,
            "published_by": admin["username"],
            "published_at": published_at,
        }

    @app.patch("/api/admin/announcements/{announcement_id}")
    async def update_announcement(
        announcement_id: int,
        payload: AnnouncementUpdateRequest,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        verify_csrf(admin, x_csrf_token)
        assignments = []
        values: list[Any] = []
        if payload.active is not None:
            assignments.append("active = ?")
            values.append(1 if payload.active else 0)
        if payload.priority is not None:
            assignments.append("priority = ?")
            values.append(payload.priority)
        if payload.display_mode is not None:
            assignments.append("display_mode = ?")
            values.append(payload.display_mode)
        if not assignments:
            raise HTTPException(status_code=422, detail="没有可更新的公告字段")
        assignments.append("updated_at = ?")
        values.append(utc_now())
        values.append(announcement_id)
        with db.connect() as connection:
            updated = connection.execute(
                f"""
                UPDATE announcements
                SET {", ".join(assignments)}
                WHERE id = ?
                """,
                values,
            )
        if not updated.rowcount:
            raise HTTPException(status_code=404, detail="公告不存在")
        db.audit(
            "announcement.updated",
            request_ip(request),
            user_id=admin["id"],
            target=str(announcement_id),
            detail=payload.model_dump_json(exclude_none=True),
        )
        return {"ok": True}

    @app.delete("/api/admin/announcements/{announcement_id}")
    async def delete_announcement(
        announcement_id: int,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        verify_csrf(admin, x_csrf_token)
        with db.connect() as connection:
            announcement = connection.execute(
                """
                SELECT title
                FROM announcements
                WHERE id = ?
                """,
                (announcement_id,),
            ).fetchone()
            if not announcement:
                raise HTTPException(status_code=404, detail="公告不存在")
            connection.execute(
                "DELETE FROM announcements WHERE id = ?",
                (announcement_id,),
            )
        db.audit(
            "announcement.deleted",
            request_ip(request),
            user_id=admin["id"],
            target=str(announcement_id),
            detail=announcement["title"],
        )
        return {"ok": True}

    @app.post("/api/admin/site-update")
    async def request_site_update(
        payload: SiteUpdateRequest,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        verify_csrf(admin, x_csrf_token)
        try:
            queued = queue_update(
                settings.site_update_request_path,
                settings.site_update_status_path,
                mode=payload.mode,
                requested_by=admin["id"],
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except UpdateAlreadyRunningError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        db.audit(
            "site_update.requested",
            request_ip(request),
            user_id=admin["id"],
            target=payload.mode,
            detail=json.dumps(queued, ensure_ascii=False),
        )
        return {
            "queued": True,
            **queued,
        }

    @app.put("/api/admin/comment-agent")
    async def update_comment_agent_settings(
        payload: CommentAgentSettingsRequest,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, object]:
        verify_csrf(admin, x_csrf_token)
        if payload.provider not in COMMENT_AGENT_TEMPLATE_IDS:
            raise HTTPException(status_code=422, detail="Agent 供应商无效")
        if payload.protocol not in COMMENT_AGENT_PROTOCOLS:
            raise HTTPException(status_code=422, detail="Agent API 协议无效")
        if payload.access_mode not in COMMENT_AGENT_ACCESS_MODES:
            raise HTTPException(status_code=422, detail="Agent 使用范围无效")
        try:
            base_url = validate_agent_base_url(payload.base_url)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        model = payload.model.strip()
        system_prompt = payload.system_prompt.strip()
        current = comment_agent_configuration()
        endpoint_changed = (
            payload.provider != current.provider
            or payload.protocol != current.protocol
            or base_url != current.base_url
        )
        if endpoint_changed and current.api_key and not payload.api_key:
            raise HTTPException(
                status_code=422,
                detail="切换 Agent 供应商、协议或地址时必须填写新的 API Key",
            )
        effective_key = payload.api_key or (
            "" if endpoint_changed else current.api_key
        )
        if payload.enabled and not effective_key:
            raise HTTPException(
                status_code=422,
                detail="启用评论 Agent 前必须配置 API Key",
            )
        whitelist_user_ids = sorted(set(payload.whitelist_user_ids))
        if whitelist_user_ids:
            placeholders = ",".join("?" for _ in whitelist_user_ids)
            with db.connect() as connection:
                valid_ids = {
                    row["id"]
                    for row in connection.execute(
                        f"""
                        SELECT id FROM users
                        WHERE status = 'active'
                          AND is_system = 0
                          AND id IN ({placeholders})
                        """,
                        whitelist_user_ids,
                    ).fetchall()
                }
            if valid_ids != set(whitelist_user_ids):
                raise HTTPException(
                    status_code=422,
                    detail="Agent 白名单包含无效用户",
                )
        try:
            save_comment_agent_configuration(
                db,
                cipher,
                admin_id=admin["id"],
                enabled=payload.enabled,
                provider=payload.provider,
                protocol=payload.protocol,
                base_url=base_url,
                api_key=payload.api_key,
                model=model,
                timeout_seconds=payload.timeout_seconds,
                max_context_chars=payload.max_context_chars,
                max_output_tokens=payload.max_output_tokens,
                system_prompt=system_prompt,
                access_mode=payload.access_mode,
                whitelist_user_ids=whitelist_user_ids,
            )
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail="服务未配置可用的密钥，无法保存 Agent API Key",
            ) from exc
        db.audit(
            "comment_agent.settings_updated",
            request_ip(request),
            user_id=admin["id"],
            detail=json.dumps(
                {
                    "enabled": payload.enabled,
                    "provider": payload.provider,
                    "protocol": payload.protocol,
                    "base_url": base_url,
                    "model": model,
                    "timeout_seconds": payload.timeout_seconds,
                    "max_context_chars": payload.max_context_chars,
                    "max_output_tokens": payload.max_output_tokens,
                    "access_mode": payload.access_mode,
                    "whitelist_user_count": len(whitelist_user_ids),
                    "api_key_changed": bool(payload.api_key),
                },
                ensure_ascii=False,
            ),
        )
        return comment_agent_public_payload(
            comment_agent_configuration()
        )

    @app.post("/api/admin/comment-agent/test")
    def test_comment_agent_settings(
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, str]:
        verify_csrf(admin, x_csrf_token)
        configuration = comment_agent_configuration()
        if not configuration.configured:
            raise HTTPException(
                status_code=409,
                detail="请先保存并启用评论 Agent",
            )
        try:
            completion = normalize_agent_completion(
                call_agent_api(
                    configuration,
                    (
                        "Reply with a short confirmation that the API is "
                        "available. Do not include secrets."
                    ),
                    "请回复：连接成功",
                )
            )
        except CommentAgentError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        db.audit(
            "comment_agent.test",
            request_ip(request),
            user_id=admin["id"],
            target=configuration.provider,
            detail=json.dumps(
                {
                    "model": configuration.model,
                    "reply_length": len(completion.text),
                    "total_tokens": completion.total_tokens,
                },
                ensure_ascii=False,
            ),
        )
        return {
            "status": "ok",
            "provider": configuration.provider,
            "model": configuration.model,
        }

    @app.put("/api/admin/smtp")
    async def update_smtp_settings(
        payload: SmtpSettingsRequest,
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, object]:
        verify_csrf(admin, x_csrf_token)
        if payload.provider not in SMTP_TEMPLATE_IDS:
            raise HTTPException(status_code=422, detail="SMTP 模板无效")

        host = payload.host.strip().lower()
        username = payload.username.strip()
        password = payload.password
        from_address = payload.from_address.strip()
        if host and (
            "://" in host
            or "/" in host
            or any(character.isspace() for character in host)
        ):
            raise HTTPException(status_code=422, detail="SMTP 主机格式无效")
        if any(character in username for character in "\r\n"):
            raise HTTPException(status_code=422, detail="SMTP 用户名格式无效")
        if from_address:
            try:
                from_address = normalize_email(from_address)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc

        current = smtp_configuration()
        if (
            username != current.smtp_username
            and current.smtp_password
            and not password
        ):
            raise HTTPException(
                status_code=422,
                detail="SMTP 登录账号变化时必须填写新的授权码或应用密码",
            )
        if payload.enabled:
            if not host:
                raise HTTPException(status_code=422, detail="请填写 SMTP 主机")
            if not from_address:
                raise HTTPException(status_code=422, detail="请填写发件邮箱")
            if (
                username
                and not password
                and (
                    not current.smtp_password
                    or username != current.smtp_username
                )
            ):
                raise HTTPException(
                    status_code=422,
                    detail="请为当前 SMTP 用户名填写授权码或应用密码",
                )

        try:
            save_smtp_configuration(
                db,
                cipher,
                admin_id=admin["id"],
                enabled=payload.enabled,
                provider=payload.provider,
                host=host,
                port=payload.port,
                username=username,
                password=password,
                from_address=from_address,
                starttls=payload.starttls,
            )
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail="服务未配置可用的密钥，无法保存 SMTP 授权码",
            ) from exc

        db.audit(
            "smtp.settings_updated",
            request_ip(request),
            user_id=admin["id"],
            detail=json.dumps(
                {
                    "enabled": payload.enabled,
                    "provider": payload.provider,
                    "host": host,
                    "port": payload.port,
                    "username": username,
                    "from_address": from_address,
                    "starttls": payload.starttls,
                    "password_changed": bool(password),
                },
                ensure_ascii=False,
            ),
        )
        return smtp_public_payload(smtp_configuration())

    @app.post("/api/admin/smtp/test")
    def test_smtp_settings(
        request: Request,
        x_csrf_token: str | None = Header(default=None),
        admin: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, str]:
        verify_csrf(admin, x_csrf_token)
        if not rate_limiter.allow(f"smtp-test:{admin['id']}", 5, 600):
            raise HTTPException(status_code=429, detail="SMTP 测试请求过多")

        smtp = smtp_configuration()
        if not smtp.smtp_enabled:
            raise HTTPException(status_code=409, detail="请先保存并启用 SMTP")
        status, error = send_email(
            smtp,
            [admin["email"]],
            "[GCK] SMTP 配置测试",
            (
                "Game Client Knowledge 编辑系统 SMTP 配置测试成功。\n\n"
                f"模板：{smtp.provider}\n"
                f"服务器：{smtp.smtp_host}:{smtp.smtp_port}\n"
            ),
        )
        db.audit(
            "smtp.test",
            request_ip(request),
            user_id=admin["id"],
            target=admin["email"],
            detail=json.dumps(
                {"status": status, "error": error},
                ensure_ascii=False,
            ),
        )
        if status != "sent":
            raise HTTPException(
                status_code=502,
                detail=f"SMTP 测试失败：{error or '邮件服务器未接受请求'}",
            )
        return {"status": status, "recipient": admin["email"]}

    return app
