# kimi-k3-migration-audit-dzv431

**Intent:** Replace every Claude Opus and Claude Fable call with Kimi K3 (Moonshot AI), keeping the derivation pipeline one code path, and report which model each AI feature uses.

**Files:**

- `package.json`, `package-lock.json` — `@ai-sdk/anthropic` out, `@ai-sdk/moonshotai` in; `ai` bumped 7.0.58 → 7.0.93 so the provider packages dedupe to one version.
- `src/lib/kimi.ts` (new) — the one Kimi client: key from `KIMI_API_KEY` or `MOONSHOT_API_KEY`, `KIMI_BASE_URL` override, `kimiConfigured()` for every key check, `kimiOptions(effort)` for the reasoning effort, and `webSearchTool`: Moonshot's official web-search tool run through the Formula API (`moonshot/web-search:latest`), $0.005 per search.
- `src/lib/derive/config.ts` — every model constant is `kimi-k3`; `DERIVATION_EFFORT` added (`high` everywhere, `max` for ANALYZE); `MAX_OUTPUT_TOKENS` raised because Kimi K3 counts reasoning tokens against the ceiling (Moonshot asks for 16000 or more).
- `src/lib/derive/json-call.ts` — optional `effort`, passed as the provider option on every JSON call.
- `src/app/api/derive/route.ts`, `src/app/api/assistant/route.ts`, `src/app/api/assistant/act/route.ts`, `src/lib/glossary.ts`, `src/lib/connect.ts`, `src/lib/handwritten/classify.ts`, `src/lib/handwritten/convert.ts`, `src/lib/upload-assistant.ts`, `src/lib/parse/structure.ts`, `src/app/api/documents/[documentId]/connect/route.ts`, `src/app/api/documents/[documentId]/glossary/route.ts` — `anthropic(model)` → `kimi(model)`, `ANTHROPIC_API_KEY` checks → `kimiConfigured()`, Anthropic `cacheControl` provider options removed (Moonshot caches prefixes on its own), per-call output ceilings raised, image parts sent as AI SDK `file` parts (the `image` part is deprecated in `ai` 7.0.93).
- `src/app/api/assistant/route.ts` — web access: `anthropic.tools.webSearch_20260209` → `web_search` function tool with `isStepCount(6)` (five searches, then the answer); the source-part listing is gone because Moonshot returns the search result encrypted, readable by the model alone.
- `src/lib/usage.ts` — `kimi-k3` at $3 in / $0.30 cache hit / $15 out; Claude rows removed; provider `moonshot`; cache write priced as plain input (no write premium at Moonshot).
- `src/app/admin/page.tsx`, `src/lib/i18n/dict/admin.ts` — the service row is `KIMI_API_KEY` (`svcKimi`).
- `src/lib/i18n/dict/api.ts` — key messages say `KIMI_API_KEY`; the unused `webSources` heading removed.
- `src/lib/i18n/dict/legal.ts`, `src/lib/legal.ts` — `pAiAnthropic` → `pAiMoonshot`; the training sentence states Moonshot's terms (it may use API content to improve its models unless a restriction is agreed); the services list names Moonshot AI.
- `src/lib/i18n/dict/signin.ts` — the beta note names Kimi tokens.
- `prisma/schema.prisma`, `src/app/admin/usage/page.tsx` — provider comments name `moonshot`. No migration: the column is a free string.
- `.env.example`, `.env.local.example`, `README.md`, `SPEC.md` (§2, §7), `TIERS.md` — Kimi K3, `KIMI_API_KEY`, `KIMI_BASE_URL`, Moonshot's automatic caching, $0.005 per web search.
- `scripts/qa/mock-anthropic.mjs` → `scripts/qa/mock-kimi.mjs` — the same prompt-sniffing answers behind Moonshot's OpenAI-compatible `/v1/chat/completions` (streaming and not) plus the Formula `tools` and `fibers` endpoints for the web-search loop; `scripts/qa/ui-ai-tools.mjs`, `ui-motion-stop.mjs`, `verify-summary-simplify.mjs`, `ui-handwritten.mjs`, `.claude/skills/unitoscompareloop/SKILL.md`, `.claude/commands/importcompare.md` — env notes read `KIMI_API_KEY=mock KIMI_BASE_URL=http://localhost:3399/v1`.

**Decisions:**

- Key name: the owner said "the Kimi API key" without naming the variable. The client reads `KIMI_API_KEY` first and `MOONSHOT_API_KEY` (the provider's own name) second. If Vercel holds it under another name, rename it there or add one line to `kimiApiKey()`.
- One model, two efforts: Opus and Fable had split the work by capability. Kimi K3 is one model, so the split became reasoning effort: `high` for the reader's tools and the parse tier (Fable's default effort was high too), `max` only for ANALYZE, whose comment already accepted a slow answer over a misread number. `max` everywhere would be Moonshot's default and the slowest.
- Web access: Moonshot documents two channels. `$web_search` (`builtin_function`) is marked "being updated, not recommended"; the Formula API official tool is the one Moonshot recommends for `kimi-k3`, so that is the one built. The search result comes back encrypted, so the answer's own links are the only sources shown; the prompt already demands them.
- Output ceilings roughly doubled or tripled: Moonshot's guidance is that `max_completion_tokens` covers reasoning plus answer and should be at least 16000. Ceilings are caps, not spend.
- `ai` bumped within 7.x so `@ai-sdk/provider` resolves to one version; the bump deprecated the `image` content part, so the four image call sites send `file` parts.
- Verified: `tsc --noEmit`, `eslint`, `next build` pass; the mock ran end to end through the real provider (reasoning effort and `max_completion_tokens` on the wire, an image as a data URL, the web-search tool loop with the fiber result echoed back as a tool message). No live Kimi call was made: no key in this environment.
