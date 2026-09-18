# claude/brave-clarke-sc4exg

**Intent:** Let an account run Simplify on a local model served by Ollama, chosen in Settings under "Assistant on this device"; the cloud models stay the default (SPEC.md §27).

**Files:**
- `src/lib/local-model/settings.ts`: the setting in localStorage (`unitos-local-model`: the Ollama URL and the model name), the localhost-only URL check, `LOCAL_MODEL_TOOLS` (Simplify), and the store the Settings form subscribes to.
- `src/lib/local-model/ollama.ts`: the browser's calls to Ollama's OpenAI-compatible chat endpoint — the streamed answer, Test's one question — with `<think>` blocks dropped and the unreachable case reported as the `OLLAMA_ORIGINS` line to set.
- `src/lib/local-model/run.ts`: the browser-side prompt runner — the prompt stage of `/api/derive`, the local model, the store stage of `/api/derive`.
- `src/app/api/derive/route.ts`: `stage: "prompt" | "store"` and `output` on the request (the local model's tools only); the prompt stage answers the messages built for the cloud model, the store stage persists the output through the same annotation write as the cloud stream (`saveAnnotation`, one function for both); the stages need no cloud key.
- `src/components/reader/reader-interactions.tsx`: `runSimplify` runs on the local model when one is set, the card, mark, Delete, and Regenerate unchanged; `deriveInput` beside `deriveBody`.
- `src/components/settings-form.tsx`: the "Assistant on this device" section — the two fields, the localhost note, the `OLLAMA_ORIGINS` line, Test and its result, which tools run where.
- `src/lib/i18n/dict/settings.ts` (en and zh keys), `src/lib/i18n/dict/common.ts` (glossary: local model 本地模型, Assistant on this device 本设备上的助手, cloud models 云端模型), `src/lib/api.ts` (`clientLang` exported for messages outside React).
- `SPEC.md` (§4 the stages, §17 the offline note, new §27), `TIERS.md` (the local model under Unassigned).

**Decisions:**
- The server builds the prompt (the prompt stage), not the browser: the same context loading and template as the cloud path, byte-identical, with no client copy of `lib/derive/context.ts`. The cost is that a local run still needs the server for the prompt and the write, so it does not work offline yet; §27 says what offline would take.
- Simplify only. Circle & ask (EXPLAIN) reads a page image, which a text-only local model cannot; everything else has structured output a 4B-class model does not hold.
- The local output lands as the cloud output lands: an ACCEPTED note in the hidden Annotations section with one source per segment — the same Delete and Regenerate — not a PENDING note, since that is the cloud Simplify's path.
- Ollama's OpenAI-compatible endpoint, as asked, so no `think: false`; a thinking model's `<think>` block is stripped on the client instead.
- A local run records no usage row: no provider billed it.
- The tier is undecided: listed under Unassigned in TIERS.md.
