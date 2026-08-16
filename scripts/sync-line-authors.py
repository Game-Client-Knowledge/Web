#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from pathlib import PurePosixPath


EDITABLE_EXTENSIONS = {
    ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".hpp", ".html",
    ".java", ".js", ".json", ".kt", ".lua", ".m", ".md", ".mm", ".py",
    ".rs", ".sh", ".swift", ".toml", ".ts", ".tsx", ".xml", ".yaml", ".yml",
}
MAX_BATCH_BYTES = 1_500_000


def git(repo: str, *arguments: str) -> str:
    return subprocess.check_output(
        ["git", f"--git-dir={repo}", *arguments],
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def editable(path: str) -> bool:
    parts = PurePosixPath(path).parts
    return (
        len(parts) >= 2
        and not any(part.startswith(".") for part in parts)
        and PurePosixPath(path).suffix.lower() in EDITABLE_EXTENSIONS
    )


def changed_paths(repo: str, previous: str, revision: str) -> tuple[list[str], list[str]]:
    if previous and previous != revision:
        output = git(
            repo,
            "diff",
            "--name-status",
            "--find-renames",
            previous,
            revision,
            "--",
        )
        changed: set[str] = set()
        deleted: set[str] = set()
        for line in output.splitlines():
            fields = line.split("\t")
            status = fields[0]
            if status.startswith("R") and len(fields) == 3:
                if editable(fields[1]):
                    deleted.add(fields[1])
                if editable(fields[2]):
                    changed.add(fields[2])
            elif len(fields) == 2 and status.startswith("D"):
                if editable(fields[1]):
                    deleted.add(fields[1])
            elif len(fields) == 2 and editable(fields[1]):
                changed.add(fields[1])
        return sorted(changed), sorted(deleted)

    paths = git(repo, "ls-tree", "-r", "--name-only", revision).splitlines()
    return sorted(path for path in paths if editable(path)), []


def blame_file(
    repo: str,
    revision: str,
    content_revision: str,
    path: str,
) -> dict[str, object]:
    output = git(repo, "blame", "--line-porcelain", revision, "--", path)
    lines: list[dict[str, object]] = []
    commit = ""
    author = "Unknown"
    email = ""
    final_line = 0
    header = re.compile(r"^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$")
    for raw_line in output.splitlines():
        match = header.match(raw_line)
        if match:
            commit = match.group(1)
            final_line = int(match.group(2))
        elif raw_line.startswith("author "):
            author = raw_line[7:].strip() or "Unknown"
        elif raw_line.startswith("author-mail "):
            email = raw_line[12:].strip().strip("<>")
        elif raw_line.startswith("\t"):
            lines.append(
                {
                    "line": final_line,
                    "commit": commit,
                    "name": author,
                    "email": email,
                }
            )
    return {
        "path": path,
        "commit": content_revision,
        "line_count": len(lines),
        "lines": lines,
    }


def post(url: str, token: str, payload: dict[str, object]) -> dict[str, object]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise RuntimeError(
            f"Attribution sync failed with HTTP {exc.code}: {detail}"
        ) from exc


def upload(
    url: str,
    token: str,
    revision: str,
    files: list[dict[str, object]],
    deleted: list[str],
) -> tuple[int, int]:
    batches: list[list[dict[str, object]]] = []
    current: list[dict[str, object]] = []
    current_size = 0
    for item in files:
        item_size = len(json.dumps(item, ensure_ascii=False).encode("utf-8"))
        if current and current_size + item_size > MAX_BATCH_BYTES:
            batches.append(current)
            current = []
            current_size = 0
        current.append(item)
        current_size += item_size
    if current or not batches:
        batches.append(current)

    uploaded_files = 0
    uploaded_lines = 0
    for index, batch in enumerate(batches):
        result = post(
            url,
            token,
            {
                "revision": revision,
                "files": batch,
                "deleted": deleted if index == 0 else [],
            },
        )
        uploaded_files += int(result.get("files", 0))
        uploaded_lines += int(result.get("lines", 0))
    return uploaded_files, uploaded_lines


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--content-revision", default="")
    parser.add_argument("--previous", default="")
    parser.add_argument(
        "--url",
        default=os.getenv(
            "EDITOR_ATTRIBUTION_SYNC_URL",
            "http://127.0.0.1:8790/api/internal/attribution-sync",
        ),
    )
    parser.add_argument(
        "--token",
        default=os.getenv("EDITOR_ATTRIBUTION_SYNC_TOKEN", ""),
    )
    arguments = parser.parse_args()
    paths, deleted = changed_paths(
        arguments.repo,
        arguments.previous,
        arguments.revision,
    )
    files = [
        blame_file(
            arguments.repo,
            arguments.revision,
            arguments.content_revision or arguments.revision,
            path,
        )
        for path in paths
    ]
    file_count, line_count = upload(
        arguments.url,
        arguments.token,
        arguments.content_revision or arguments.revision,
        files,
        deleted,
    )
    print(
        f"Attribution cache updated: files={file_count} "
        f"lines={line_count} deleted={len(deleted)}"
    )


if __name__ == "__main__":
    main()
