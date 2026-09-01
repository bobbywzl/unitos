# video-editing-topbar-fixes-5qd9ya

**Intent:** Everything the reader circles — article figures, PDF figures, video spots — reaches the model completely: the visual itself attaches to the call, alongside the reader's command and the document context.

**Files:**

- `src/lib/derive/figure.ts` — one shared `figureVisual`: the `<img>` fetched (relative srcs now resolve against the document's page), decoded from a `data:` URI, or — a PDF figure — the stored page rendered to PNG (the same render the reader's figure route serves). Before, a PDF figure or a data/relative src attached nothing and the model answered blind from the caption.
- `src/app/api/derive/route.ts` — EXPLAIN on a figure uses `figureVisual`; the prompt says when the attachment is the whole PDF page.
- `src/app/api/assistant/act/route.ts` — the same `figureVisual` for a figure anchor; new optional `video` anchor (time range, region, frame — EXPLAIN's shape) so a command about a circled video spot carries the frame and the transcript over that range.
- `src/lib/prompts/types.ts`, `src/lib/prompts/explain.ts` — the `page` flag and its wording.
- `src/components/video/assistant-card.tsx` — the assistant shows a "Circled spot · 0:00–0:04" chip while a circle is open; commands capture the frame and send the spot; the chip's ✕ sends without it.
- `src/components/video/video-pane.tsx` — derives the circled spot from the open composer and passes it (with `captureFrame`) to the assistant.
- `src/lib/i18n/dict/video.ts` — the chip's two keys, en and zh.

**Decisions:**

- The visual resolves server-side in one shared function (SPEC.md §4: one pipeline) — EXPLAIN and the assistant can never diverge on what the model sees.
- A PDF figure attaches its whole rendered page, not a crop: the parse stores no figure bounds, and the prompt tells the model to read only the captioned figure.
- The circled spot binds to the assistant at send time from the live circle; clearing the chip is per-spot, so a new circle re-arms it.
- Failed fetches still degrade to caption and context, never fail the request — unchanged contract.
