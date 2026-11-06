"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { ThinkingIndicator } from "@/components/thinking";
import { HIGHLIGHT_HUES, HUE_DOT, HUE_KEY, type HighlightHue } from "@/components/reader/hues";
import { api } from "@/lib/api";
import type { PageSize } from "@/lib/handwritten/pages";
import { pageImageUrl } from "@/lib/handwritten/page-url";
import { splitStreamError, splitStreamNote } from "@/lib/derive/config";
import { regionBounds, regionPathD, strokePathD, type Region } from "@/lib/video/types";
import { VoiceTypingButton } from "@/components/voice/voice-typing-button";

// One page of a handwritten document (SPEC.md §16): the page image the page
// image route serves, the stored marks drawn over it, and Highlight & ask —
// drag the highlighter over a spot of the page: the drag paints a haze, a
// translucent band along the pointer's path, and more drags add to it; then
// ask, explain, comment, or pick a color to keep the haze as a highlight.
// The haze is what Ask, Explain, and Comment read. Ask and Explain stream
// through /api/derive (EXPLAIN with a page payload; Ask adds the question)
// and persist as annotations with a region source; Comment and the kept
// highlight post to /api/annotations. Loops drawn before the highlighter
// (kind "path" and "ellipse") still paint as loops. Clicking a mark opens
// its annotation like a text mark.

export type PageMark = {
  sourceId: string;
  noteId: string;
  kind: "explain" | "comment" | "highlight";
  color: string | null; // highlight only: the mark paints in this color
  region: Region;
};

// The band's width, in percent of the page's width: about one line of
// handwriting on a letter or A4 page.
export const STROKE_WIDTH = 4;
// The pointer's path is kept at this many points at most.
const STROKE_POINTS_MAX = 400;
// A pending region is strokes: the card opens on the first, the rest add.
type StrokeRegion = Extract<Region, { kind: "stroke" }>;
type DrawState = { points: [number, number][] };
type Pending = { region: StrokeRegion };
// asked = the question this answer ran with, null when Explain ran without
// one: what Regenerate runs again. noteId = the annotation it saved, which
// Regenerate replaces (SPEC.md §4).
type Answer = {
  content: string;
  done: boolean;
  error: string | null;
  asked: string | null;
  noteId: string | null;
};

export function PageBlock({
  documentId,
  notebookId,
  blockId,
  text,
  marks,
  size,
  canEdit,
  hint,
}: {
  documentId: string;
  notebookId: string;
  blockId: string;
  text: string; // the stored block text ("Page N") — the page label
  marks: PageMark[];
  // The stored image's pixels: the page keeps its shape before the image
  // arrives, so the browser loads pages lazily. Null = not known yet.
  size: PageSize | null;
  canEdit: boolean;
  hint: boolean; // first page only: the fading Highlight & ask hint
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
  // The page's height in units of its width, times 100: the SVG's viewBox
  // is 100 wide and this tall, so a stroke's band is as wide down the page
  // as across it. From the stored image's pixels, else the drawn page.
  const [measuredH, setMeasuredH] = useState<number | null>(null);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setMeasuredH((r.height / r.width) * 100);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const viewH = size ? (size.height / size.width) * 100 : (measuredH ?? 141);
  // Percent of the page's height → the SVG's units.
  const sy = viewH / 100;
  // The page's width over its height: how far the band reaches down the page.
  const aspect = 100 / viewH;
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

  // The drag paints a stroke; releasing adds it to the haze and opens the
  // card (or keeps it open).
  function startDraw(e: React.PointerEvent<HTMLDivElement>) {
    if (!canEdit || e.button !== 0 || busy !== null) return;
    const p = percentAt(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraw({ points: [[p.x, p.y]] });
  }
  function moveDraw(e: React.PointerEvent<HTMLDivElement>) {
    if (!draw || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const p = percentAt(e);
    if (!p) return;
    const [lx, ly] = draw.points[draw.points.length - 1];
    if (Math.hypot(p.x - lx, (p.y - ly) * sy) < 0.4) return;
    setDraw({ points: [...draw.points, [p.x, p.y]] });
  }
  // The smallest stored mark under a point, for click-to-open. Marks are pure
  // paint (pointer-events none), so a stroke can start over one.
  function markAt(p: { x: number; y: number }): PageMark | null {
    const hits = marks
      .map((m) => ({ m, b: regionBounds(m.region, aspect) }))
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
    // A click is not a stroke: open the mark under it, if any.
    const xs = raw.map(([x]) => x);
    const ys = raw.map(([, y]) => y);
    if (raw.length < 3 || (Math.max(...xs) - Math.min(...xs) < 1 && Math.max(...ys) - Math.min(...ys) < 1)) {
      const at = raw[raw.length - 1] ?? raw[0];
      const mark = at ? markAt({ x: at[0], y: at[1] }) : null;
      if (mark) openMark(mark);
      return;
    }
    // Cap the stored point count.
    const step = Math.max(1, Math.ceil(raw.length / STROKE_POINTS_MAX));
    const points = raw
      .filter((_, i) => i % step === 0)
      .map(([x, y]): [number, number] => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    // The first stroke opens the card; a stroke while the card shows the
    // question adds to the haze. A stroke after an answer starts over.
    if (pending && answer === null && pending.region.strokes.length < 40) {
      setPending({ region: { ...pending.region, strokes: [...pending.region.strokes, points] } });
      setError(null);
      return;
    }
    setPending({ region: { kind: "stroke", width: STROKE_WIDTH, strokes: [points] } });
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

  // Ask streams EXPLAIN with the typed question; Explain streams it without
  // one. asked is the question to run: null runs Explain.
  async function ask(withQuestion: boolean) {
    const q = question.trim();
    if (withQuestion && !q) return;
    await run(withQuestion ? q : null);
  }
  // replaceNoteId: the annotation this run regenerates. It goes only once the
  // new one is stored, so a failed run never loses what stands (SPEC.md §4).
  async function run(asked: string | null, replaceNoteId?: string | null) {
    if (!pending || busy !== null) return;
    setBusy("ask");
    setError(null);
    setAnswer({ content: "", done: false, error: null, asked, noteId: null });
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
            question: asked ?? undefined,
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
        setAnswer({ content: live, done: false, error: null, asked, noteId: null });
      }
      const { text: withoutError, error: streamError } = splitStreamError(raw);
      const { text: content, noteId } = splitStreamNote(withoutError);
      setAnswer({ content, done: true, error: streamError, asked, noteId });
      if (replaceNoteId && noteId) await api(`/api/notes/${replaceNoteId}`, "DELETE").catch(() => {});
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

  // The card sits under the haze, clamped inside the page.
  const bounds = pending ? regionBounds(pending.region, aspect) : null;
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
          src={pageImageUrl(documentId, blockId)}
          alt=""
          width={size?.width}
          height={size?.height}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="block h-auto w-full select-none"
        />
        {/* Draw layer: the drag paints a stroke; a plain click opens the mark
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
        {/* Stored marks and the haze being painted. Marks carry data-source-id,
            so source chip jumps and flashes land on them like text marks. The
            viewBox is in units of the page's width, so a band is as wide
            down the page as across it; the old loops scale their y into it. */}
        <svg
          aria-hidden
          viewBox={`0 0 100 ${viewH}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {marks.map((m) => {
            // A kept highlight paints in its color; Explain and Comment marks
            // keep the clay glow.
            const hue =
              m.kind === "highlight" && m.color && m.color in HUE_DOT
                ? HUE_DOT[m.color as HighlightHue]
                : null;
            const region = m.region;
            if (region.kind === "stroke") {
              return (
                <g key={m.sourceId} data-source-id={m.sourceId} className="page-haze">
                  {region.strokes.map((points, i) => (
                    <path
                      key={i}
                      d={strokePathD(points.map(([x, y]): [number, number] => [x, y * sy]))}
                      fill="none"
                      stroke={hue ?? "var(--clay-400)"}
                      strokeOpacity={hue ? 0.3 : 0.26}
                      strokeWidth={region.width}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                </g>
              );
            }
            const shared = {
              "data-source-id": m.sourceId,
              fill: hue ? `color-mix(in srgb, ${hue} 22%, transparent)` : "rgba(246, 160, 107, 0.07)",
              stroke: hue ?? "var(--clay-400)",
              strokeWidth: 2.5,
              strokeLinejoin: "round" as const,
              vectorEffect: "non-scaling-stroke" as const,
              style: hue ? undefined : { filter: "drop-shadow(0 0 5px rgba(246, 160, 107, 0.45))" },
            };
            return region.kind === "ellipse" ? (
              <ellipse key={m.sourceId} cx={region.cx} cy={region.cy * sy} rx={region.rx} ry={region.ry * sy} {...shared} />
            ) : (
              <path key={m.sourceId} d={regionPathD(region.points.map(([x, y]): [number, number] => [x, y * sy]))} {...shared} />
            );
          })}
          {/* The haze: the pending strokes, and the one under the pointer. */}
          <g className="page-haze" data-page-haze={pending || draw ? "" : undefined}>
            {pending?.region.strokes.map((points, i) => (
              <path
                key={i}
                d={strokePathD(points.map(([x, y]): [number, number] => [x, y * sy]))}
                fill="none"
                stroke="var(--clay-400)"
                strokeOpacity={0.34}
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {draw && (
              <path
                d={strokePathD(draw.points.map(([x, y]): [number, number] => [x, y * sy]))}
                fill="none"
                stroke="var(--clay-400)"
                strokeOpacity={0.34}
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </g>
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
                data-track="page-close"
                disabled={busy === "comment"}
                aria-label={t("common.close")}
                data-tip={t("common.close")}
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
                  data-track="page-ask"
                  disabled={busy !== null || question.trim().length === 0}
                  data-tip={t("panes.pageAskTitle")}
                  className={buttonClass}
                >
                  {t("panes.pageAsk")}
                </button>
                <button
                  onClick={() => void ask(false)}
                  data-track="page-explain"
                  disabled={busy !== null}
                  data-tip={t("panes.pageExplainTitle")}
                  className={quietButtonClass}
                >
                  {t("panes.pageExplain")}
                </button>
                <button
                  onClick={() => void comment()}
                  data-track="page-comment"
                  disabled={busy !== null || question.trim().length === 0}
                  data-tip={t("panes.pageCommentTitle")}
                  className={quietButtonClass}
                >
                  {busy === "comment" ? t("common.saving") : t("panes.pageComment")}
                </button>
                <VoiceTypingButton track="page-voice-typing" />
                <span
                  className="ml-auto flex items-center gap-1.5"
                  data-tip={t("panes.pageHighlightTitle")}
                >
                  {HIGHLIGHT_HUES.map((color) => (
                    <button
                      key={color}
                      onClick={() => void highlight(color)}
                      data-track={`page-highlight:${color}`}
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
                  <button
                    onClick={() => void run(answer.asked, answer.noteId)}
                    data-track="page-answer-regenerate"
                    disabled={busy !== null}
                    data-tip={t("panes.pageRegenerateTitle")}
                    className={quietButtonClass}
                  >
                    {t("common.regenerate")}
                  </button>
                  <button onClick={close} data-track="page-answer-close" className={quietButtonClass}>
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
