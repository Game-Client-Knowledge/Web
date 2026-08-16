# Debug Session: oauth-submit-failures

- **Status**: [OPEN]
- **Issue**: GitHub binding fails and draft submission returns HTTP 502.
- **Debug Server**: http://192.168.31.185:7777/event
- **Log File**: .dbg/trae-debug-log-oauth-submit-failures.ndjson

## Reproduction Steps

1. Sign in with a local account.
2. Open the profile or `/editor/` workspace and select Bind GitHub.
3. Complete the GitHub authorization callback.
4. Submit the current drafts from `/editor/`.

## Hypotheses & Verification

| ID | Hypothesis | Likelihood | Effort | Expected Evidence |
|----|------------|------------|--------|-------------------|
| A | OAuth state is consumed before a retry reaches the callback | High | Low | First callback finds and deletes state; a retry does not find it |
| B | The profile binding link has no usable target or click path | Medium | Low | Missing/disabled href or no `/api/auth/github?mode=bind` request |
| C | GitHub rejects authorization or token exchange | High | Low | Callback contains `error=access_denied`, or exchange returns an error/timeout |
| D | Submission hides a specific GitHub API failure behind 502 | High | Low | Submission event includes concrete GitHub path/status/message |
| E | Bot/user token lacks repository write scope | High | Low | GitHub write endpoint returns 403 and response scopes lack write access |

## Instrumentation

- OAuth callback request shape and cookie presence.
- OAuth redirect creation and binding user.
- OAuth state lookup result.
- OAuth token exchange start/result/transport error.
- Submission token source and failure detail.
- GitHub API path, response status, and scope headers.

## Log Evidence

Pending pre-fix instrumentation run.

## Verification Conclusion

Pending.
