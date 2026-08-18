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
assert MODULE.editable("program/README.md", include_track_readmes=True)
assert MODULE.editable("planning/README.md", include_track_readmes=True)
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

    compatible, deleted = MODULE.changed_paths(
        str(bare),
        "",
        revision,
    )
    assert deleted == []
    assert compatible == [
        "planning/cases/README.md",
        "program/knowledge/README.md",
    ]
    changed, deleted = MODULE.changed_paths(
        str(bare),
        "",
        revision,
        include_track_readmes=True,
    )
    assert deleted == []
    assert changed == [
        "planning/README.md",
        "planning/cases/README.md",
        "program/README.md",
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
    git(worktree, "config", "user.name", "Renamed Test")
    git(worktree, "add", ".")
    git(worktree, "commit", "-m", "test: update track and module entries")
    next_revision = git(worktree, "rev-parse", "HEAD")
    git(bare, "fetch", str(worktree), "main:main")
    changed, deleted = MODULE.changed_paths(
        str(bare),
        revision,
        next_revision,
        include_track_readmes=True,
    )
    assert deleted == []
    assert changed == [
        "program/README.md",
        "program/knowledge/README.md",
    ]
    canonical_names = MODULE.canonical_contributor_names(
        str(bare),
        next_revision,
    )
    identity = MODULE.contributor_id("Test", "test@example.com")
    assert canonical_names[identity] == "Renamed Test"
    old_file_contributors = MODULE.contributors_for_file(
        str(bare),
        next_revision,
        "planning/cases/README.md",
        canonical_names,
    )
    assert old_file_contributors == [
        {
            "id": identity,
            "name": "Renamed Test",
            "email": "test@example.com",
            "commit_count": 1,
            "last_contributed_at":
                old_file_contributors[0]["last_contributed_at"],
        }
    ]

assert (
    MODULE.contributor_id("SourceCode", "same@example.com")
    == MODULE.contributor_id("Renamed", "same@example.com")
)
assert (
    MODULE.contributor_id(
        "GitHub Name",
        "123+Example@users.noreply.github.com",
    )
    == MODULE.contributor_id(
        "Another Name",
        "456+example@users.noreply.github.com",
    )
)

print("Line attribution path checks passed")
