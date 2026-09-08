**Intent:** A Browserless plan that refuses the 300 s session timeout with 400 still connects: the endpoint as configured is tried next, and the capture reports if the session ends before it is done.

**Files:**
- `src/lib/browser.ts`: `launchBrowser` retries the connection without the appended `timeout` when the first attempt fails with 400; any other failure is thrown as before.

**Decisions:**
- Retry rather than drop the timeout for everyone: a plan that allows it gets the long session the capture needs; one that does not gets its default and a clear reason in the reader if the capture is cut.
- Not verified against Browserless with a valid token (none in the sandbox): a bad token answers 401 on both hosts, so the production 400 is either the plan's cap or the legacy `chrome.browserless.io` host; the user is asked to switch to the regional endpoint.
