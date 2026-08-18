from __future__ import annotations

import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class TextMergeResult:
    content: str
    conflicted: bool


def merge_text(base: str, local: str, remote: str) -> TextMergeResult:
    if local == remote:
        return TextMergeResult(local, False)
    if local == base:
        return TextMergeResult(remote, False)
    if remote == base:
        return TextMergeResult(local, False)

    with tempfile.TemporaryDirectory(prefix="gck-merge-") as directory:
        root = Path(directory)
        local_path = root / "local.md"
        base_path = root / "base.md"
        remote_path = root / "remote.md"
        local_path.write_text(local, encoding="utf-8")
        base_path.write_text(base, encoding="utf-8")
        remote_path.write_text(remote, encoding="utf-8")
        result = subprocess.run(
            [
                "git",
                "merge-file",
                "--stdout",
                "--diff3",
                str(local_path),
                str(base_path),
                str(remote_path),
            ],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )

    if result.returncode == 0:
        return TextMergeResult(result.stdout, False)
    if result.returncode == 1:
        return TextMergeResult(result.stdout, True)
    raise RuntimeError(
        "git merge-file failed: "
        + (result.stderr.strip() or f"exit {result.returncode}")
    )
