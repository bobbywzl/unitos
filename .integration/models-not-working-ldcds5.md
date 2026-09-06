# models-not-working-ldcds5

**Intent:** Make a failed Kimi K3 call report its reason instead of "The model returned an empty response", and keep the connection alive while Kimi K3 reasons in silence before its first text byte.

**Files:**

- `src/lib/derive/text-stream.ts` (new) — `streamTextTo`: the one reader of a streamed text derivation. Reads the AI SDK's `fullStream` (its `textStream` drops error parts, so a failed call — bad key, no balance, rate limit, rejected request — ended as an empty stream), throws with the reason on an error part, sends a heartbeat space every 5 s until the first text delta (Kimi K3's reasoning sends no text, and an idle connection dies at proxies), and throws when the stream ends with no text because the output budget ran out or the model declined.
- `src/app/api/derive/route.ts` — EXPLAIN, SIMPLIFY, ANALYZE, SUMMARIZE, and ASK stream through `streamTextTo`; the stream has a `cancel` flag so a heartbeat after the reader left sends nothing.
- `src/app/api/assistant/route.ts` — the assistant's answer streams through `streamTextTo`; the search count moves to its `onPart`.
- `src/lib/derive/json-call.ts` — a `length` finish (the reasoning spent the output budget) reports the budget instead of "Output was not valid JSON", on the first call and the retry.
- `src/lib/derive/config.ts` — `splitStreamError` drops the heartbeat spaces with the text's leading whitespace, so every client shows clean text.
- `src/components/reader/reader-interactions.tsx`, `src/components/assistant/assistant-panel.tsx` — the four stream consumers that appended raw chunks now accumulate the raw stream and show `splitStreamError(raw).text`, the pattern page-block, video-pane, and ask-panel already used; the bubble and card keep their thinking indicator through the heartbeats.
- `src/lib/i18n/dict/api.ts` — `outputBudgetSpent`, `modelDeclined`, both languages.
- `scripts/qa/mock-kimi.mjs` — QA failure modes: `MOCK_KIMI_FAIL=401`, `MOCK_KIMI_FAIL=length`, `MOCK_KIMI_DELAY_MS`.
- `SPEC.md` — §4 step 3 records the text stream protocol.

**Decisions:**

- Heartbeat spaces, not a new token: the DISTILL and FORMALIZE streams already send spaces, and one `trimStart` in `splitStreamError` handles every client. Markdown would read four leading spaces as a code block, so the clients never render the raw stream.
- A text stream cut mid-answer by the budget still shows what arrived; only an answer with no text at all reports the budget. The JSON path reports the budget on any `length` finish: cut JSON never validates.
- The output budgets (`MAX_OUTPUT_TOKENS`) are unchanged: no live Kimi K3 call was possible here, so there is no measurement of how long its reasoning runs at `high`.
- Verified against the mock: `tsc --noEmit`, `eslint`; SUMMARIZE, EXPLAIN, SALIENCE, and the assistant's answer in normal mode; the invalid-key, budget-spent, and 12 s silent-reasoning modes over curl (the reason arrives in-band, heartbeats arrive at 5 s and 10 s, the stored summary and annotation carry no leading space); a Playwright run of the Recommended card (clean text after a heartbeat, the API's reason after a 401). No live Kimi or Anthropic call was made: no key in this environment.
