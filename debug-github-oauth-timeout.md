# Debug Session: github-oauth-timeout
- **Status**: [OPEN]
- **Issue**: GitHub account binding reaches the OAuth callback, then returns HTTP 503 with "无法连接 GitHub 授权服务，请重试".
- **Debug Server**: `http://127.0.0.1:7777/event` through an SSH reverse tunnel
- **Log File**: `.dbg/trae-debug-log-github-oauth-timeout.ndjson`

## Reproduction Steps
1. Sign in to the knowledge site.
2. Open account settings.
3. Select **Bind GitHub** and approve the OAuth application.
4. Observe the callback fail after approximately 25 seconds.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Direct outbound HTTPS from the server to `github.com:443` times out | High | Low | Pending |
| B | A proxy is required but missing from the systemd service environment | High | Low | Pending |
| C | DNS selects an unusable IPv6 address before IPv4 | Medium | Low | Pending |
| D | OAuth client credentials are rejected by GitHub | Low | Low | Pending |
| E | GitHub HTTP errors are incorrectly classified as transport failures | Medium | Medium | Pending |

## Log Evidence
Instrumentation points:

- `github.py:exchange_oauth_code:start`: DNS addresses, proxy variable names,
  configuration booleans, and timeout.
- `github.py:exchange_oauth_code:except`: elapsed time and exception cause chain.
- `github.py:exchange_oauth_code:response`: elapsed time, HTTP status, and
  GitHub error type without credentials.

## Verification Conclusion
Pending pre-fix and post-fix comparison.
