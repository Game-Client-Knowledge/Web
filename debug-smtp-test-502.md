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

## Verification Conclusion

Pending.
