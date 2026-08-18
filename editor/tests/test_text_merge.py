from app.text_merge import merge_text


def test_merge_text_combines_independent_line_changes() -> None:
    base = "# Topic\n\nalpha\nbeta\ngamma\n"
    local = "# Topic\n\nalpha local\nbeta\ngamma\n"
    remote = "# Topic\n\nalpha\nbeta\ngamma remote\n"

    result = merge_text(base, local, remote)

    assert result.conflicted is False
    assert result.content == (
        "# Topic\n\nalpha local\nbeta\ngamma remote\n"
    )


def test_merge_text_reports_overlapping_changes() -> None:
    base = "# Topic\n\nsame\n"
    local = "# Topic\n\nlocal\n"
    remote = "# Topic\n\nremote\n"

    result = merge_text(base, local, remote)

    assert result.conflicted is True
    assert "<<<<<<<" in result.content


def test_merge_text_fast_paths_unchanged_sides() -> None:
    base = "# Topic\n"
    local = "# Local\n"
    remote = "# Remote\n"

    assert merge_text(base, base, remote).content == remote
    assert merge_text(base, local, base).content == local
    assert merge_text(base, local, local).content == local
