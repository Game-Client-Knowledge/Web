from __future__ import annotations

import hashlib
import re
import secrets
from pathlib import PurePosixPath

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken

PASSWORD_HASHER = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=2,
)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,30}[A-Za-z0-9]$")
SLUG_RE = re.compile(r"[^a-z0-9-]+")
ALLOWED_ROOTS = {"knowledge", "interviews", "examples"}
MODULE_ROOT_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
RESERVED_ROOTS = {
    "deploy",
    "docs",
    "lib",
    "node_modules",
    "scripts",
    "src",
}
ALLOWED_EXTENSIONS = {
    ".md",
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".csproj",
    ".css",
    ".glsl",
    ".go",
    ".h",
    ".hpp",
    ".hlsl",
    ".html",
    ".java",
    ".js",
    ".json",
    ".kt",
    ".lua",
    ".py",
    ".rs",
    ".sh",
    ".shader",
    ".sln",
    ".swift",
    ".toml",
    ".ts",
    ".tsx",
    ".xml",
    ".yaml",
    ".yml",
}


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if len(email) > 254 or not EMAIL_RE.fullmatch(email):
        raise ValueError("请输入有效的邮箱地址")
    return email


def normalize_username(value: str) -> str:
    username = value.strip()
    if not USERNAME_RE.fullmatch(username):
        raise ValueError("用户名需为 3-32 位字母、数字、下划线或连字符")
    return username


def validate_password(value: str) -> str:
    if len(value) < 8:
        raise ValueError("密码至少需要 8 个字符")
    if len(value) > 256:
        raise ValueError("密码过长")
    return value


def hash_password(value: str) -> str:
    return PASSWORD_HASHER.hash(validate_password(value))


def verify_password(password_hash: str, value: str) -> bool:
    try:
        return PASSWORD_HASHER.verify(password_hash, value)
    except (VerifyMismatchError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    try:
        return PASSWORD_HASHER.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def random_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def slugify(value: str, fallback: str = "update") -> str:
    slug = value.strip().lower().replace("_", "-").replace(" ", "-")
    slug = SLUG_RE.sub("-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return (slug or fallback)[:60]


def is_valid_module_root(value: str) -> bool:
    return value in ALLOWED_ROOTS or bool(
        value not in RESERVED_ROOTS and MODULE_ROOT_RE.fullmatch(value)
    )


def validate_content_path(value: str) -> str:
    raw = value.strip().replace("\\", "/")
    if (
        not raw
        or raw.startswith("/")
        or any(ord(character) < 32 or ord(character) == 127 for character in raw)
    ):
        raise ValueError("内容路径无效")

    path = PurePosixPath(raw)
    if ".." in path.parts or any(part.startswith(".") for part in path.parts):
        raise ValueError("内容路径不能包含隐藏目录或上级目录")
    if len(path.parts) < 2 or not is_valid_module_root(path.parts[0]):
        raise ValueError("内容必须位于有效的顶级模块目录")
    if len(raw) > 240:
        raise ValueError("内容路径过长")

    extension = path.suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise ValueError("不支持该文件类型")
    if path.parts[0] in {"knowledge", "interviews"} and extension != ".md":
        raise ValueError("知识与面经目录只允许 Markdown 文件")
    return path.as_posix()


def make_branch_name(username: str, custom_head: str) -> str:
    user_slug = slugify(username, "user")
    head_slug = slugify(custom_head, "update")
    return f"web/{user_slug}/{head_slug}"


class TokenCipher:
    def __init__(self, key: str) -> None:
        self._fernet = Fernet(key.encode("ascii")) if key else None

    def encrypt(self, value: str) -> str:
        if not self._fernet:
            raise RuntimeError("GitHub token encryption is not configured")
        return self._fernet.encrypt(value.encode("utf-8")).decode("ascii")

    def decrypt(self, value: str) -> str:
        if not self._fernet:
            raise RuntimeError("GitHub token encryption is not configured")
        try:
            return self._fernet.decrypt(value.encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise RuntimeError("Stored GitHub token cannot be decrypted") from exc
