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

- Line 2: callback contained `code,state`, no GitHub `error`, and had the
  state cookie.
- Line 3: the first callback found a matching state and cookie.
- Line 5: GitHub token exchange responded; the controlled invalid code was
  classified as `bad_verification_code`.
- Lines 6-7: retrying the same callback retained the matching cookie but the
  state had already been deleted.
- Production access log: repeated profile binding requests reached
  `/api/auth/github?mode=bind` and returned 307 redirects.
- Production submission record 1: GitHub `POST .../git/blobs` returned 403
  `Resource not accessible by personal access token`.
- Permission probe: the write endpoint returned 403 and advertised
  `contents=write` as the required permission.

## Verification Conclusion

| ID | Status | Conclusion |
|----|--------|------------|
| A | Confirmed | State deletion occurs before token exchange succeeds |
| B | Rejected | Binding navigation reaches the server and GitHub redirect |
| C | Rejected / Secondary issue | GitHub approved the callback; an earlier exchange also hit an intermittent connect timeout |
| D | Confirmed | The generic 502 wraps a concrete GitHub permission failure |
| E | Confirmed | The configured fine-grained Bot PAT lacks Contents write permission |

## Minimal Fix

- Consume OAuth state only after token exchange succeeds.
- Preserve state across transient GitHub transport failures.
- Redirect explicit GitHub denial back to the initiating UI with readable feedback.
- Map GitHub transport failures to 503 and permission failures to 403.
- Prefer a bound user's GitHub token even when the current session began locally.
- Keep Bot submission for unbound local users; the external Bot PAT still requires
  `Contents: Read and write` and `Pull requests: Read and write`.

The existing `join-code` fine-grained PAT was updated to the least-privilege
configuration:

- Repository: `Game-Client-Knowledge/Game-Client-Knowledge` only.
- Contents: Read and write.
- Pull requests: Read and write.

The same invalid-payload permission probe changed from 403 to 422, proving that
GitHub passed authorization and reached payload validation without creating an
object.

Application post-fix verification pending deployment.

## Post-Fix Evidence

- Lines 3 and 7 of the post-fix log both report `stateFound=true` for the
  same failed callback. Pre-fix, the second lookup reported `false`.
- Line 10 reports the Bot write probe as HTTP 422 with
  `acceptedPermissions=contents=write`; pre-fix it was HTTP 403.
- Lines 12-13 record an explicit `access_denied` callback with a valid cookie
  and state. The response redirected to
  `/knowledge/?github_auth_error=access_denied`.
- Production serves the source diff bundle and editor release from Web commit
  `5249d2a`.

Awaiting user verification before removing instrumentation and debug artifacts.
