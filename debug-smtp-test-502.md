# Debug Session: smtp-test-502

- **Status**: [OPEN]
- **Issue**: The administrator SMTP test returns HTTP 502 for a QQ Mail account.
- **Debug Server**: `http://192.168.31.10:7777/event`
- **Log File**: `.dbg/trae-debug-log-smtp-test-502.ndjson`

## Reproduction Steps

1. Open `/editor/admin`.
2. Select the QQ Mail SMTP template.
3. Save the mailbox and authorization code.
4. Select **Send test email**.
5. Observe HTTP 502.

## Hypotheses & Verification

| ID | Hypothesis | Likelihood | Effort | Expected Evidence |
|----|------------|------------|--------|-------------------|
| A | Stored SMTP username or secret differs from the submitted values | High | Low | QQ returns SMTP `535` while the persisted username/provider do not match |
| B | The server cannot establish STARTTLS to `smtp.qq.com:587` | Medium | Low | Timeout, connection refusal, DNS, or TLS exception |
| C | QQ SMTP is disabled or the authorization code is invalid/revoked | High | Low | Network and TLS succeed, then QQ returns authentication rejection |
| D | The envelope sender is rejected because it differs from the authenticated mailbox | Medium | Low | Authentication succeeds, then `MAIL FROM` receives a 5xx response |
| E | The backend records a specific SMTP error but the UI exposes only generic HTTP 502 | Medium | Low | `smtp.test` audit detail contains a concrete error |

## Log Evidence

Instrumentation points:

- A: Effective provider, endpoint, TLS mode, account domain, sender match, and
  credential presence without secret values.
- B: STARTTLS completed.
- C: SMTP authentication completed.
- D: SMTP server accepted the message.
- E: Failure stage, exception type, SMTP status code, and sanitized server
  response.

Pre-fix evidence:

- Line 1: QQ template, `smtp.qq.com:587`, STARTTLS, username, sender, and
  encrypted credential presence are all complete; username and sender match.
- Line 2: STARTTLS is established successfully.
- Line 3: Python's default login path is disconnected during authentication
  with `SMTPServerDisconnected: Connection unexpectedly closed`.
- A protocol probe confirms QQ advertises both `LOGIN` and `PLAIN`.
- Forcing `AUTH LOGIN` with the same stored credential reaches QQ and receives
  SMTP `535 Login fail`. QQ's response identifies an abnormal account, disabled
  SMTP service, invalid authorization code, frequency limiting, or temporary
  provider failure.

## Verification Conclusion

| ID | Status | Conclusion |
|----|--------|------------|
| A | Rejected | Persisted endpoint and account fields are complete and consistent |
| B | Rejected | TCP and STARTTLS succeed |
| C | Confirmed | QQ rejects the account/service/authorization state with SMTP 535 |
| D | Rejected as current cause | Authentication fails before `MAIL FROM` |
| E | Confirmed | Default `AUTH PLAIN` disconnect hides QQ's actionable 535 response |

Minimal fix:

- Force `AUTH LOGIN` for the QQ provider.
- Convert SMTP 535 into an actionable Chinese authentication message.
- Retain all instrumentation for post-fix comparison.

Post-fix evidence after clearing the session log:

- Line 1: The effective QQ configuration remains complete and consistent.
- Line 2: STARTTLS still succeeds.
- Line 3: The QQ-specific `AUTH LOGIN` path now receives SMTP `535` instead of
  losing the connection. The provider response says the account is abnormal,
  SMTP is disabled, the authorization code is incorrect, login frequency is
  limited, or QQ is temporarily busy.
- The application returns the actionable Chinese message:
  `SMTP 认证失败：请确认邮箱已开启 SMTP 服务，账号与授权码匹配，并避免短时间重复测试`.

Pre-fix vs post-fix:

| Behavior | Pre-fix | Post-fix |
|----------|---------|----------|
| QQ authentication mechanism | Python default prefers `AUTH PLAIN` | QQ template forces `AUTH LOGIN` |
| Provider response | Connection closed without SMTP status | Explicit SMTP `535` |
| Administrator feedback | Generic HTTP 502 / connection closed | Actionable authentication guidance |
| Email delivery | Failed before authentication | Still blocked by QQ account/service/authorization state |

The code-level compatibility issue is fixed and deployed in `df1b80d`. Final
delivery requires enabling SMTP in QQ Mail and replacing the exposed
authorization code. The session remains `[OPEN]` pending that external
verification.
