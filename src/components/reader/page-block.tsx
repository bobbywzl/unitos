"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { ThinkingIndicator } from "@/components/thinking";
import { HIGHLIGHT_HUES, HUE_DOT, HUE_KEY, type HighlightHue } from "@/components/reader/hues";
import { splitStreamError, splitStreamNote } from "@/lib/derive/config";
import { regionBounds, regionPathD, type Region } from "@/lib/video/types";

// One page of a handwritten document (SPEC.md §16): the PDF page rendered by
// the page image route, the stored marks drawn over it, and Circle & ask —
// drag a loop on the page, then ask, explain, comment, or pick a color to
// lasso highlight the circled spot. Ask and Explain stream through
// /api/derive (EXPLAIN with a page payload) and persist as annotations with a
// region source; Comment and the lasso highlight post to /api/annotations.
// Clicking a mark opens its annotation like a text mark.

export type PageMark = {
  sourceId: string;
  noteId: string;
  kind: "explain" | "comment" | "highlight";
  color: string | null; // highlight only: the loop paints in this color
  region: Region;
};

type DrawState = { points: { x: number; y: number }[] };
type Pending = { region: Region };
type Answer = { content: string; done: boolean; error: string | null };

export function PageBlock({
  documentId,
  notebookId,
  blockId,
  text,
  marks,
  canEdit,
  hint,
}: {
  documentId: string;
  notebookId: string;
  blockId: string;
  text: string; // the stored block text ("Page N") — the page label
  marks: PageMark[];
  canEdit: boolean;
  hint: boolean; // first page only: the fading Circle & ask hint
}) {
  const t = useT();
  const router = useRouter();
  const [draw, setDraw] = useState<DrawState | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<"ask" | "comment" | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hintDone, setHintDone] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // The running Ask or Explain, so Stop can abort it: the card returns to
  // the question, nothing persists.
  const askAbortRef = useRef<AbortController | null>(null);
  function stopAsk() {
    askAbortRef.current?.abort();
  }

  function percentAt(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const el = overlayRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  }

  // The drag draws a freehand loop; releasing closes it and opens the card.
  function startDraw(e: React.PointerEvent<HTMLDivElement>) {
    if (!canEdit || e.button !== 0 || busy !== null) return;
    const p = percentAt(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraw({ points: [p] });
  }
  function moveDraw(e: React.PointerEvent<HTMLDivElement>) {
    if (!draw || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const p = percentAt(e);
    if (!p) return;
    const last = draw.points[draw.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.7) return;
    setDraw({ points: [...draw.points, p] });
  }
  // The smallest stored mark under a point, for click-to-open. Marks are pure
  // paint (pointer-events none), so a loop can be drawn starting over one.
  function markAt(p: { x: number; y: number }): PageMark | null {
    const hits = marks
      .map((m) => ({ m, b: regionBounds(m.region) }))
      .filter(({ b }) => p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2)
      .sort((a, z) => (a.b.x2 - a.b.x1) * (a.b.y2 - a.b.y1) - (z.b.x2 - z.b.x1) * (z.b.y2 - z.b.y1));
    return hits[0]?.m ?? null;
  }

  function openMark(mark: PageMark) {
    window.dispatchEvent(
      new CustomEvent("dissect:open-annotation", { detail: { sourceId: mark.sourceId } }),
    );
  }

  function endDraw(e: React.PointerEvent<HTMLDivElement>) {
    if (!draw) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const raw = draw.points;
    setDraw(null);
    // A click or a tiny scribble is not a loop: open the mark under it, if any.
    const xs = raw.map((p) => p.x);
    const ys = raw.map((p) => p.y);
    if (raw.length < 6 || (Math.max(...xs) - Math.min(...xs) < 2 && Math.max(...ys) - Math.min(...ys) < 2)) {
      const at = raw[raw.length - 1] ?? raw[0];
      const mark = at ? markAt(at) : null;
      if (mark) openMark(mark);
      return;
    }
    // Cap the stored point count; the loop closes itself when rendered.
    const step = Math.max(1, Math.ceil(raw.length / 300));
    const points = raw
      .filter((_, i) => i % step === 0)
      .map((p): [number, number] => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]);
    setPending({ region: { kind: "path", points } });
    setQuestion("");
    setAnswer(null);
    setError(null);
  }

  function close() {
    if (busy === "comment") return;
    askAbortRef.current?.abort();
    setPending(null);
    setAnswer(null);
    setError(null);
  }

  // Ask streams EXPLAIN with the typed question; Explain streams it without one.
  async function ask(withQuestion: boolean) {
    if (!pending || busy !== null) return;
    const q = question.trim();
    if (withQuestion && !q) return;
    setBusy("ask");
    setError(null);
    setAnswer({ content: "", done: false, error: null });
    const controller = new AbortController();
    askAbortRef.current = controller;
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          type: "EXPLAIN",
          documentId,
          notebookId,
          page: {
            blockId,
            region: pending.region,
            question: withQuestion ? q : undefined,
          },
        }),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("common.requestFailedStatus", { status: res.status }));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const live = splitStreamNote(splitStreamError(raw).text).text;
        setAnswer({ content: live, done: false, error: null });
      }
      const { text: withoutError, error: streamError } = splitStreamError(raw);
      const { text: content } = splitStreamNote(withoutError);
      setAnswer({ content, done: true, error: streamError });
      if (!streamError) router.refresh();
    } catch (err) {
      setAnswer(null);
      // Stopped, not failed: back to the question.
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      if (askAbortRef.current === controller) askAbortRef.current = null;
      setBusy(null);
    }
  }

  // Comment saves the typed text alone; a color dot saves the lasso highlight
  // (SPEC.md §16) — the loop paints in that color, and typed text rides on it.
  async function annotate(payload: { comment?: string; color?: HighlightHue }) {
    if (!pending || busy !== null) return;
    setBusy("comment");
    setError(null);
    try {
      const res = await fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notebookId,
          documentId,
          page: { blockId, region: pending.region, ...payload },
        }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("common.requestFailedStatus", { status: res.status }));
      }
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function comment() {
    const content = question.trim();
    if (!content) return;
    await annotate({ comment: content });
  }

  async function highlight(color: HighlightHue) {
    const content = question.trim();
    await annotate({ color, ...(content ? { comment: content } : {}) });
  }

  // The card sits under the loop, clamped inside the page.
  const bounds = pending ? regionBounds(pending.region) : null;
  const cardLeft = bounds ? Math.max(16, Math.min(84, (bounds.x1 + bounds.x2) / 2)) : 50;
  const cardTop = bounds ? Math.min(96, bounds.y2 + 1.5) : 50;

  const buttonClass =
    "rounded-full bg-clay px-3.5 py-1 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40";
  const quietButtonClass =
    "rounded-full px-3 py-1 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";

  return (
    <div data-block-id={blockId} className="reader-block relative my-6">
      <p aria-hidden className="mb-1.5 text-[11px] font-bold tracking-[0.09em] text-sand-500 uppercase select-none">
        {text}
      </p>
      <div className="relative overflow-hidden rounded-xl bg-card shadow-soft">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/documents/${documentId}/page/${blockId}`}
          alt=""
          loading="lazy"
          draggable={false}
          className="block w-full select-none"
        />
        {/* Draw layer: the drag draws the loop; a plain click opens the mark
            under it. Viewers draw nothing; their click still opens marks. */}
        <div
          ref={overlayRef}
          onPointerDown={startDraw}
          onPointerMove={moveDraw}
          onPointerUp={endDraw}
          onPointerCancel={() => setDraw(null)}
          onClick={
            canEdit
              ? undefined
              : (e) => {
                  const p = percentAt(e);
                  const mark = p ? markAt(p) : null;
                  if (mark) openMark(mark);
                }
          }
          className="absolute inset-0"
          style={{ touchAction: "none", cursor: canEdit ? "crosshair" : "default" }}
        />
        {/* Stored marks and the loop being drawn. Marks carry data-source-id,
            so source chip jumps and flashes land on them like text marks. */}
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {marks.map((m) => {
            // A lasso highlight paints solid in its color; other marks keep
            // the clay glow.
            const hue =
              m.kind === "highlight" && m.color && m.color in HUE_DOT
                ? HUE_DOT[m.color as HighlightHue]
                : null;
            const shared = {
              "data-source-id": m.sourceId,
              fill: hue ? `color-mix(in srgb, ${hue} 22%, transparent)` : "rgba(246, 160, 107, 0.07)",
              stroke: hue ?? "var(--clay-400)",
              strokeWidth: 2.5,
              strokeLinejoin: "round" as const,
              vectorEffect: "non-scaling-stroke" as const,
              style: hue ? undefined : { filter: "drop-shadow(0 0 5px rgba(246, 160, 107, 0.45))" },
            };
            return m.region.kind === "ellipse" ? (
              <ellipse key={m.sourceId} cx={m.region.cx} cy={m.region.cy} rx={m.region.rx} ry={m.region.ry} {...shared} />
            ) : (
              <path key={m.sourceId} d={regionPathD(m.region.points)} {...shared} />
            );
          })}
          {draw && draw.points.length > 1 && (
            <path
              d={regionPathD(draw.points.map((p): [number, number] => [p.x, p.y]))}
              fill="rgba(246, 160, 107, 0.08)"
              stroke="var(--clay-400)"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {pending && pending.region.kind === "path" && !draw && (
            <path
              d={regionPathD(pending.region.points)}
              fill="rgba(246, 160, 107, 0.08)"
              stroke="var(--clay-400)"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {hint && canEdit && !hintDone && !pending && (
          <div
            onAnimationEnd={() => setHintDone(true)}
            className="hint-fade pointer-events-none absolute top-3 right-3 max-w-60 rounded-2xl bg-card px-4 py-2.5 text-[12px] leading-relaxed text-sand-700 shadow-lift print:hidden"
          >
            {t("panes.pageDrawHint")}
          </div>
        )}

        {pending && (
          <div
            data-selection-popover
            className="pop-in absolute z-20 w-[300px] -translate-x-1/2 rounded-2xl bg-card p-3 shadow-float print:hidden"
            style={{ left: `${cardLeft}%`, top: `${cardTop}%` }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
                {t("panes.circleAsk")}
              </span>
              <button
                onClick={close}
                disabled={busy === "comment"}
                aria-label={t("common.close")}
                className="rounded-full px-1.5 text-sand-500 hover:text-clay-800 disabled:opacity-40"
              >
                ✕
              </button>
            </div>
            {answer === null && (
              <textarea
                autoFocus
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(question.trim().length > 0);
                  }
                }}
                placeholder={t("panes.pageAskPlaceholder")}
                rows={2}
                className="mb-2 w-full resize-none rounded-xl bg-sand-100 px-3 py-2 text-[13px] outline-none placeholder:text-sand-500"
              />
            )}
            {answer !== null && (
              <div className="mb-2 max-h-56 overflow-y-auto text-[13px] leading-relaxed">
                {answer.content ? (
                  <Markdown>{answer.content}</Markdown>
                ) : (
                  <ThinkingIndicator onStop={stopAsk} />
                )}
                {answer.error && <p className="mt-1.5 text-[12px] text-red-600">{answer.error}</p>}
              </div>
            )}
            {error && <p className="mb-2 text-[12px] text-red-600">{error}</p>}
            {answer === null ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => void ask(true)}
                  disabled={busy !== null || question.trim().length === 0}
                  title={t("panes.pageAskTitle")}
                  className={buttonClass}
                >
                  {t("panes.pageAsk")}
                </button>
                <button
                  onClick={() => void ask(false)}
                  disabled={busy !== null}
                  title={t("panes.pageExplainTitle")}
                  className={quietButtonClass}
                >
                  {t("panes.pageExplain")}
                </button>
                <button
                  onClick={() => void comment()}
                  disabled={busy !== null || question.trim().length === 0}
                  title={t("panes.pageCommentTitle")}
                  className={quietButtonClass}
                >
                  {busy === "comment" ? t("common.saving") : t("panes.pageComment")}
                </button>
                <span
                  className="ml-auto flex items-center gap-1.5"
                  title={t("panes.pageHighlightTitle")}
                >
                  {HIGHLIGHT_HUES.map((color) => (
                    <button
                      key={color}
                      onClick={() => void highlight(color)}
                      disabled={busy !== null}
                      aria-label={t(HUE_KEY[color])}
                      className="size-4 rounded-full transition-transform hover:scale-110 disabled:opacity-40"
                      style={{ background: HUE_DOT[color] }}
                    />
                  ))}
                </span>
              </div>
            ) : (
              answer.done && (
                <div className="flex items-center gap-1.5">
                  <button onClick={close} className={quietButtonClass}>
                    {t("common.close")}
                  </button>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
