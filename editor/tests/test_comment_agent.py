from __future__ import annotations

from typing import Any

import pytest

from app.comment_agent import call_agent_api
from app.comment_agent_config import (
    CommentAgentConfiguration,
    validate_agent_base_url,
)


class FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.status_code = 200
        self.is_success = True
        self._payload = payload

    def json(self) -> dict[str, Any]:
        return self._payload


class FakeClient:
    def __init__(
        self,
        response: FakeResponse,
        observed: dict[str, Any],
        **options: Any,
    ) -> None:
        observed["client_options"] = options
        self.response = response
        self.observed = observed

    def __enter__(self) -> "FakeClient":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
    ) -> FakeResponse:
        self.observed.update(
            {"url": url, "headers": headers, "payload": json}
        )
        return self.response


def configuration(
    *,
    protocol: str,
    base_url: str,
) -> CommentAgentConfiguration:
    return CommentAgentConfiguration(
        enabled=True,
        provider="custom",
        protocol=protocol,
        base_url=base_url,
        api_key="provider-secret",
        model="provider-model",
        timeout_seconds=30,
        max_context_chars=24000,
        max_output_tokens=768,
        system_prompt="System policy",
    )


def test_openai_compatible_request_and_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: dict[str, Any] = {}
    response = FakeResponse(
        {
            "choices": [
                {"message": {"content": "OpenAI-compatible reply"}}
            ]
        }
    )
    monkeypatch.setattr(
        "app.comment_agent.httpx.Client",
        lambda **options: FakeClient(response, observed, **options),
    )

    result = call_agent_api(
        configuration(
            protocol="openai_compatible",
            base_url="https://gateway.example.test/v1",
        ),
        "System policy",
        "Reader question",
    )

    assert result == "OpenAI-compatible reply"
    assert observed["url"].endswith("/v1/chat/completions")
    assert observed["headers"]["Authorization"] == "Bearer provider-secret"
    assert observed["payload"]["model"] == "provider-model"
    assert observed["payload"]["max_tokens"] == 768
    assert observed["payload"]["messages"] == [
        {"role": "system", "content": "System policy"},
        {"role": "user", "content": "Reader question"},
    ]


def test_anthropic_request_and_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: dict[str, Any] = {}
    response = FakeResponse(
        {
            "content": [
                {"type": "text", "text": "Claude reply"},
            ]
        }
    )
    monkeypatch.setattr(
        "app.comment_agent.httpx.Client",
        lambda **options: FakeClient(response, observed, **options),
    )

    result = call_agent_api(
        configuration(
            protocol="anthropic",
            base_url="https://api.anthropic.com/v1",
        ),
        "System policy",
        "Reader question",
    )

    assert result == "Claude reply"
    assert observed["url"].endswith("/v1/messages")
    assert observed["headers"]["x-api-key"] == "provider-secret"
    assert observed["headers"]["anthropic-version"] == "2023-06-01"
    assert observed["payload"]["system"] == "System policy"
    assert observed["payload"]["messages"] == [
        {"role": "user", "content": "Reader question"}
    ]


def test_custom_agent_url_requires_https_except_loopback() -> None:
    assert (
        validate_agent_base_url("http://127.0.0.1:11434/v1/")
        == "http://127.0.0.1:11434/v1"
    )
    with pytest.raises(ValueError):
        validate_agent_base_url("http://agent.example.test/v1")
    with pytest.raises(ValueError):
        validate_agent_base_url(
            "https://user:password@agent.example.test/v1"
        )
