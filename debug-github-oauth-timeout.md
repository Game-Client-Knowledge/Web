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
| A | Direct outbound HTTPS from the server to `github.com:443` times out | High | Low | Confirmed: line 1 resolved only `20.205.243.166`; line 2 timed out after 20.863 s |
| B | A proxy is required but missing from the systemd service environment | High | Low | Rejected: line 1 reported no proxy environment keys |
| C | DNS selects an unusable IPv6 address before IPv4 | Medium | Low | Rejected: line 1 contained only one IPv4 address |
| D | OAuth client credentials are rejected by GitHub | Low | Low | Rejected: no HTTP response was received, so credentials were not evaluated |
| E | GitHub HTTP errors are incorrectly classified as transport failures | Medium | Medium | Rejected: line 2 recorded an actual HTTPX `ReadTimeout` and cause |

## Log Evidence
Instrumentation points:

- `github.py:exchange_oauth_code:start`: DNS addresses, proxy variable names,
  configuration booleans, and timeout.
- `github.py:exchange_oauth_code:except`: elapsed time and exception cause chain.
- `github.py:exchange_oauth_code:response`: elapsed time, HTTP status, and
  GitHub error type without credentials.

Pre-fix evidence:

- Line 1: `github.com` resolved only to `20.205.243.166`; no proxy variables
  were present and OAuth credentials were configured.
- Line 2: the actual HTTPX operation failed with `ReadTimeout` after
  `20863 ms`.
- Independent probes showed the selected `20.205.243.166:443` path timing out,
  while several other GitHub web frontend addresses completed TLS in
  approximately `0.4` to `2.6` seconds.

## Verification Conclusion
Root cause confirmed: the server's DNS-selected GitHub web frontend address is
unreachable through the current gateway. The OAuth callback cannot exchange
its code because it never receives an HTTP response.

Minimal fix:

1. Probe the normal `github.com` origin without sending the one-time code.
2. If that route is unavailable, probe a bounded set of GitHub web frontend
   addresses.
3. Require normal certificate validation with `github.com` as TLS SNI and the
   HTTP Host value.
4. Send the OAuth code exactly once to the selected reachable origin.

Post-fix evidence is pending.
