#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import subprocess
import tempfile
from pathlib import Path


SCRIPT = Path(__file__).with_name("sync-line-authors.py")
SPEC = importlib.util.spec_from_file_location("sync_line_authors", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load sync-line-authors.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def git(directory: Path, *arguments: str) -> str:
    return subprocess.check_output(
        ["git", *arguments],
        cwd=directory,
        text=True,
        encoding="utf-8",
    ).strip()


assert not MODULE.editable("program/README.md")
assert not MODULE.editable("planning/README.md")
assert MODULE.editable("program/knowledge/README.md")
assert MODULE.editable("planning/cases/README.md")
assert MODULE.editable("knowledge/cpp/README.md")
assert not MODULE.editable("program/.hidden/file.md")
assert not MODULE.editable("program/knowledge/image.png")

with tempfile.TemporaryDirectory(prefix="gck-attribution-") as temporary:
    root = Path(temporary)
    worktree = root / "worktree"
    bare = root / "content.git"
    worktree.mkdir()
    git(worktree, "init", "-b", "main")
    git(worktree, "config", "user.name", "Test")
    git(worktree, "config", "user.email", "test@example.com")
    for relative in (
        "program/README.md",
        "planning/README.md",
        "program/knowledge/README.md",
        "planning/cases/README.md",
    ):
        target = worktree / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"# {relative}\n", encoding="utf-8")
    git(worktree, "add", ".")
    git(worktree, "commit", "-m", "test: seed attribution paths")
    revision = git(worktree, "rev-parse", "HEAD")
    git(root, "clone", "--bare", str(worktree), str(bare))

    changed, deleted = MODULE.changed_paths(
        str(bare),
        "",
        revision,
    )
    assert deleted == []
    assert changed == [
        "planning/cases/README.md",
        "program/knowledge/README.md",
    ]

    (worktree / "program/README.md").write_text(
        "# Program updated\n",
        encoding="utf-8",
    )
    (worktree / "program/knowledge/README.md").write_text(
        "# Knowledge updated\n",
        encoding="utf-8",
    )
    git(worktree, "add", ".")
    git(worktree, "commit", "-m", "test: update track and module entries")
    next_revision = git(worktree, "rev-parse", "HEAD")
    git(bare, "fetch", str(worktree), "main:main")
    changed, deleted = MODULE.changed_paths(
        str(bare),
        revision,
        next_revision,
    )
    assert deleted == []
    assert changed == ["program/knowledge/README.md"]

print("Line attribution path checks passed")
