"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { formatTime, type TranscriptLine, type VideoAnnotationItem } from "@/lib/video/types";

// The transcript under the player (SPEC.md §11), shaped like an article:
// lines flow into indented paragraphs, split at speech gaps. Every line is
// still an anchor — click to seek, hover for the same tools the player's
// frame has — and the current line highlights and follows playback inside its
// own scroll box, so the player never moves. A paragraph opens with its time;
// a line covered by an annotation is underlined and opens it.

// When every transcription rung failed, the pane offers Paste transcript
// beside Retry: the reader copies the transcript YouTube shows them and hands
// it over — the one rung that never depends on the server's network.

// A paragraph closes at a clear speech gap, or once it is long enough and the
// line before it finished a sentence. The hard cap keeps a gapless monologue
// from becoming one wall.
const PARAGRAPH_GAP_SECONDS = 2.5;
const PARAGRAPH_BREAK_CHARS = 700;
const PARAGRAPH_MAX_CHARS = 1400;

function paragraphsOf(transcript: TranscriptLine[]): TranscriptLine[][] {
  const paragraphs: TranscriptLine[][] = [];
  let open: TranscriptLine[] = [];
  let chars = 0;
  for (const line of transcript) {
    const last = open[open.length - 1];
    const breaks =
      last !== undefined &&
      (line.startTime - last.endTime > PARAGRAPH_GAP_SECONDS ||
        chars > PARAGRAPH_MAX_CHARS ||
        (chars > PARAGRAPH_BREAK_CHARS && /[.!?。！？…”"]$/.test(last.text)));
    if (breaks) {
      paragraphs.push(open);
      open = [];
      chars = 0;
    }
    open.push(line);
    chars += line.text.length;
  }
  if (open.length > 0) paragraphs.push(open);
  return paragraphs;
}

export function Transcript({
  transcript,
  audio,
  activeLineId,
  annotations,
  pending,
  failedMessage,
  onSeek,
  onComment,
  onExplain,
  onOpenAnnotation,
  onTranscribe,
  onPaste,
  pasteHelp,
}: {
  transcript: TranscriptLine[];
  audio: boolean;
  activeLineId: string | null;
  annotations: VideoAnnotationItem[];
  pending: boolean;
  failedMessage: string | null;
  onSeek: (line: TranscriptLine) => void;
  onComment: (line: TranscriptLine) => void;
  onExplain: (line: TranscriptLine) => void;
  onOpenAnnotation: (annotation: VideoAnnotationItem) => void;
  onTranscribe: () => void;
  /** Stores a pasted transcript; resolves true when it landed. */
  onPaste: (text: string) => Promise<boolean>;
  pasteHelp: string;
}) {
  const t = useT();
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [savingPaste, setSavingPaste] = useState(false);

  async function savePaste() {
    if (savingPaste || pasteText.trim() === "") return;
    setSavingPaste(true);
    try {
      if (await onPaste(pasteText)) {
        setPasting(false);
        setPasteText("");
      }
    } finally {
      setSavingPaste(false);
    }
  }
  const listRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef(false);

  const paragraphs = useMemo(() => paragraphsOf(transcript), [transcript]);

  // The first annotation covering each line, so a line reads as annotated the
  // way a highlighted span does in the reader.
  const annotationByLine = useMemo(() => {
    const map = new Map<string, VideoAnnotationItem>();
    for (const line of transcript) {
      const hit = annotations.find((a) => a.startTime < line.endTime && a.endTime > line.startTime);
      if (hit) map.set(line.id, hit);
    }
    return map;
  }, [transcript, annotations]);

  // Follow playback by scrolling the list box only — never the page — and
  // never fighting a hand on the list.
  useEffect(() => {
    const list = listRef.current;
    if (!activeLineId || !list || hoveredRef.current) return;
    const el = list.querySelector<HTMLElement>(`[data-line-id="${activeLineId}"]`);
    if (!el) return;
    // Measure against the scroll box, not offsetTop: the line's positioned
    // wrapper would otherwise be its offsetParent and read ~0 for every line.
    const elTop = el.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const target = elTop - list.clientHeight / 2 + el.clientHeight / 2;
    list.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeLineId]);

  const action =
    "rounded-full px-2 py-0.5 text-[11px] font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800";

  return (
    <section className="mt-6">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("video.transcript")}
        </span>
        {transcript.length > 0 && (
          <span className="text-[13px] text-sand-600">{transcript.length}</span>
        )}
        {transcript.length > 0 && !pending && (
          <button
            onClick={onTranscribe}
            data-track="video-transcribe-again"
            className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
            title={t(audio ? "video.transcribeAgainTitleAudio" : "video.transcribeAgainTitle")}
          >
            {t("video.transcribeAgain")}
          </button>
        )}
      </div>

      {transcript.length > 0 ? (
        <div
          ref={listRef}
          onPointerEnter={() => (hoveredRef.current = true)}
          onPointerLeave={() => (hoveredRef.current = false)}
          className="max-h-[420px] overflow-y-auto rounded-2xl bg-card px-6 py-5 shadow-soft"
        >
          {paragraphs.map((paragraph, pi) => (
            <p
              key={paragraph[0].id}
              className={`indent-7 text-[14px] leading-[1.9] text-sand-800 ${
                pi === 0 ? "" : "mt-4"
              }`}
            >
              <button
                onClick={() => onSeek(paragraph[0])}
                data-track="video-seek"
                title={t("video.jumpHere")}
                className="mr-2 -translate-y-[1px] rounded-full bg-sand-100 px-2 py-[1px] align-middle text-[10.5px] font-semibold tabular-nums text-sand-500 hover:bg-clay-100 hover:text-clay-800"
              >
                {formatTime(paragraph[0].startTime)}
              </button>
              {paragraph.map((line) => {
                const annotated = annotationByLine.get(line.id);
                return (
                  <span key={line.id} className="group/line relative">
                    <span
                      data-line-id={line.id}
                      onClick={() => onSeek(line)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSeek(line);
                        }
                      }}
                      title={t("video.jumpHere")}
                      className={`cursor-pointer rounded-[4px] box-decoration-clone px-0.5 py-[1px] ${
                        line.id === activeLineId
                          ? "bg-clay-100 text-clay-900"
                          : "hover:bg-sand-100"
                      } ${
                        annotated
                          ? "decoration-clay-400 underline decoration-2 underline-offset-4"
                          : ""
                      }`}
                    >
                      {line.text}
                    </span>{" "}
                    {/* The line's tools, floating over the text on hover. */}
                    <span className="pointer-events-none absolute bottom-full left-0 z-10 hidden pb-1 group-hover/line:inline-flex">
                      <span className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-card px-1 py-0.5 whitespace-nowrap shadow-float">
                        <button
                          onClick={() => onComment(line)}
                          data-track="video-line-comment"
                          className={action}
                          title={t("video.commentOnLineTitle")}
                        >
                          {t("video.comment")}
                        </button>
                        <button
                          onClick={() => onExplain(line)}
                          data-track="video-line-explain"
                          className={action}
                          title={t("video.explainThisMoment")}
                        >
                          {t("video.explain")}
                        </button>
                        {annotated && (
                          <button
                            onClick={() => onOpenAnnotation(annotated)}
                            data-track="video-line-open-note"
                            className={action}
                            title={t("video.openNoteTitle")}
                          >
                            {t("video.openNote")}
                          </button>
                        )}
                      </span>
                    </span>
                  </span>
                );
              })}
            </p>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-card px-4 py-4 shadow-soft">
          {pending ? (
            <p className="flex items-center gap-2 text-[13px] text-sand-600">
              <SpinnerIcon size={14} className="shrink-0 text-clay motion-safe:animate-spin" />
              {t(audio ? "video.transcribingLongAudio" : "video.transcribingLong")}
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              <p className="text-[13px] leading-relaxed text-sand-600">
                {t("video.transcriptFailedBody")}
              </p>
              {failedMessage && <p className="text-xs text-red-500">{failedMessage}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={onTranscribe}
                  data-track="video-transcribe-retry"
                  className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600"
                >
                  {t("common.retry")}
                </button>
                {!pasting && (
                  <button
                    onClick={() => setPasting(true)}
                    data-track="video-transcript-paste"
                    title={t("video.pasteTranscriptTitle")}
                    className="rounded-full px-4 py-1.5 text-xs font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
                  >
                    {t("video.pasteTranscript")}
                  </button>
                )}
              </div>
              {pasting && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs leading-relaxed text-sand-600">{pasteHelp}</p>
                  <textarea
                    autoFocus
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={t("video.pastePlaceholder")}
                    rows={8}
                    className="w-full resize-y rounded-2xl bg-sand-100 px-3.5 py-2.5 font-mono text-xs outline-none placeholder:text-sand-500"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void savePaste()}
                      disabled={savingPaste || pasteText.trim() === ""}
                      data-track="video-transcript-paste-save"
                      className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-50"
                    >
                      {t("video.savePastedTranscript")}
                    </button>
                    <button
                      onClick={() => setPasting(false)}
                      data-track="video-transcript-paste-cancel"
                      className="rounded-full px-4 py-1.5 text-xs font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {transcript.length > 0 && failedMessage && (
        <p className="mt-2 px-1 text-xs text-red-500">{failedMessage}</p>
      )}
    </section>
  );
}
