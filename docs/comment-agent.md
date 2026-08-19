# Comment Agent

## Overview

Authenticated readers can mention `@Agent` in a source-anchored comment. The
editor service reads the current raw page and the comment thread, calls the
configured model API, and stores the answer as a normal second-level reply.

The feature is disabled by default. Configure it in:

```text
Editor Admin -> External Services -> Comment Agent
```

## Supported APIs

| Admin preset | Protocol | Default endpoint |
| --- | --- | --- |
| ChatGPT / OpenAI | OpenAI Compatible | `https://api.openai.com/v1` |
| DeepSeek / DS | OpenAI Compatible | `https://api.deepseek.com/v1` |
| Claude / CC | Anthropic Messages | `https://api.anthropic.com/v1` |
| Kimi / Moonshot | OpenAI Compatible | `https://api.moonshot.cn/v1` |
| Qwen | OpenAI Compatible | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Custom | Selectable | Administrator supplied |

The model ID and base URL remain editable for every preset. `CC` uses the
Anthropic Messages API; the local Claude Code application is not used as a
server API.

## Configuration

- `Enabled`: exposes `@Agent` and accepts Agent mentions.
- `Provider`: applies a known protocol, base URL, and model preset.
- `Protocol`: selects OpenAI-compatible or Anthropic request/response shapes.
- `Base URL`: excludes the final `/chat/completions` or `/messages` path.
- `Model`: provider model identifier.
- `API Key`: encrypted with `EDITOR_ENCRYPTION_KEY`.
- `Timeout`: maximum model request duration.
- `Context characters`: combined page and thread input ceiling.
- `Output tokens`: provider-side reply limit.
- `System prompt`: reply policy and domain guidance.

The API key is never returned by admin APIs, included in audit details, sent
to browsers, or added to model context. Changing provider, protocol, or base
URL requires a new key so a credential cannot be sent to another endpoint by
accident.

Custom endpoints must use HTTPS. Plain HTTP is accepted only for loopback
development addresses.

## Request Lifecycle

1. The server validates the comment, `@Agent` mention, feature switch, and
   per-user rate limit.
2. The user comment and one unique `comment_agent_requests` row are committed.
3. A background task claims the request with an atomic SQLite update.
4. The server fetches `/raw/<path>` from the configured site origin.
5. The prompt includes the content revision, selected quote, bounded page
   source, and at most 30 comments from the current thread.
6. The answer is inserted by the fixed system user ID `-1`.
7. The triggering reader receives a comment notification when email
   notifications are enabled.

Pending and running requests survive a service restart. Startup changes stale
`running` rows back to `pending`, and the application worker resumes them.
The unique trigger constraint and conditional claim prevent duplicate replies.

The reader polls only:

```text
GET /editor/api/comments/<comment-id>/agent-status
```

It does not repeatedly download the page or the full comment list.

## Trust Boundary

Page source and comments are untrusted model input. The default system prompt
instructs the model to ignore requests to reveal secrets, alter system rules,
invoke tools, or execute external operations. The Agent has no repository,
shell, database, or browser tools. It can only return text.

Provider errors exposed to readers are reduced to safe categories such as
authentication failure, rate limiting, timeout, or temporary service
unavailability.

## Verification

```bash
cd editor
python -m pytest -q
```

```bash
node scripts/test-admin-layout.js
node scripts/test-reader-comments-visual.js
```
