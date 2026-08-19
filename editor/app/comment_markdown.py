from __future__ import annotations

import bleach
from markdown_it import MarkdownIt


COMMENT_MARKDOWN = MarkdownIt(
    "commonmark",
    {"html": False, "linkify": True, "breaks": True},
).enable("strikethrough")

COMMENT_TAGS = {
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "li",
    "ol",
    "p",
    "pre",
    "strong",
    "ul",
}


def render_comment_markdown(value: str) -> str:
    rendered = COMMENT_MARKDOWN.render(value.strip())
    return bleach.clean(
        rendered,
        tags=COMMENT_TAGS,
        attributes={"a": ["href", "title", "rel"]},
        protocols={"http", "https", "mailto"},
        strip=True,
    )
