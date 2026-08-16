from __future__ import annotations

import pytest

from app.security import (
    make_branch_name,
    normalize_email,
    normalize_username,
    validate_content_path,
)


def test_identity_normalization() -> None:
    assert normalize_email(" User@Example.COM ") == "user@example.com"
    assert normalize_username("sourcecode") == "sourcecode"


@pytest.mark.parametrize(
    "path",
    [
        "../secret.md",
        "/knowledge/cpp/a.md",
        "knowledge/.hidden/a.md",
        "scripts/topic/README.md",
        "Invalid Root/topic/README.md",
        "knowledge/cpp/main.cpp",
        "knowledge/cpp/bad\nname.md",
    ],
)
def test_rejects_unsafe_content_paths(path: str) -> None:
    with pytest.raises(ValueError):
        validate_content_path(path)


def test_accepts_expected_paths() -> None:
    assert (
        validate_content_path("knowledge/cpp/polymorphism/README.md")
        == "knowledge/cpp/polymorphism/README.md"
    )
    assert (
        validate_content_path("examples/cpp/polymorphism/main.cpp")
        == "examples/cpp/polymorphism/main.cpp"
    )
    assert (
        validate_content_path("graphics/rendering/README.md")
        == "graphics/rendering/README.md"
    )


def test_branch_name_is_namespaced_and_sanitized() -> None:
    assert (
        make_branch_name("Source_Code", "C++ Polymorphism / Draft")
        == "web/source-code/c-polymorphism-draft"
    )
