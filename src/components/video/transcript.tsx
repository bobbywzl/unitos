"use client";

import { useState } from "react";
import { SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

// The transcript under the player (SPEC.md §11), in article form. The lines
// themselves render through the reader (reader.tsx TranscriptBody): they are
// the document's blocks, so every text tool of an article works on them — the
// selection toolbar, marks, links. This file keeps the transcript's frame: the
// view bar above the lines, and the states shown when there are no lines.

// When every transcription rung failed, the pane offers Paste transcript
// beside Retry: the reader copies the transcript YouTube shows them and hands
// it over — the one rung that never depends on the server's network.

// The view bar over the text under the player (SPEC.md §11): one tab per view
// — the transcription, and the formalized article once there is one — and the
// active view's actions on the right. The tabs are the text's title: whichever
// tab is lit names what is under the bar.
export function ViewBar({
  views,
  view,
  onView,
  actions,
}: {
  views: { id: string; label: string }[];
  view: string;
  onView: (id: string) => void;
  actions: React.ReactNode;
}) {
  return (
    <div className="mt-7 mb-3 flex items-center gap-1">
      {views.map((v) => (
        <button
          key={v.id}
          onClick={() => onView(v.id)}
          data-track={`media-view-${v.id}`}
          aria-pressed={v.id === view}
          className={
            v.id === view
              ? "rounded-full bg-clay-100 px-3 py-1 text-[12px] font-bold text-clay-800"
              : "rounded-full px-3 py-1 text-[12px] font-semibold text-sand-600 hover:bg-sand-100 hover:text-clay-800"
          }
        >
          {v.label}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-1">{actions}</div>
    </div>
  );
}

// The view bar's actions while the transcription shows: Detect speakers, then
// Transcribe again. Detect speakers reads the recording again and says who
// speaks each line; a transcription finds them on its own, so this is for a
// transcript that landed before, or one that was pasted.
export function TranscriptActions({
  audio,
  busy,
  note,
  onTranscribe,
  onDetectSpeakers,
}: {
  audio: boolean;
  /** The speakers pass is running: its own label stands in for the button. */
  busy: boolean;
  /** What the last speakers run said — the count, or why it found nothing. */
  note: string | null;
  onTranscribe: () => void;
  onDetectSpeakers: (() => void) | null;
}) {
  const t = useT();
  const action =
    "rounded-full px-2 py-0.5 text-[11px] font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800";
  return (
    <>
      {note && <span className="px-1 text-[11px] text-sand-500">{note}</span>}
      {busy ? (
        <span className="flex items-center gap-1.5 px-2 text-[11px] font-semibold text-sand-600">
          <SpinnerIcon size={11} className="text-clay motion-safe:animate-spin" />
          {t("video.detectingSpeakers")}
        </span>
      ) : (
        onDetectSpeakers && (
          <button
            onClick={onDetectSpeakers}
            data-track="video-detect-speakers"
            className={action}
            data-tip={t("video.detectSpeakersTitle")}
          >
            {t("video.detectSpeakers")}
          </button>
        )
      )}
      <button
        onClick={onTranscribe}
        data-track="video-transcribe-again"
        className={action}
        data-tip={t(audio ? "video.transcribeAgainTitleAudio" : "video.transcribeAgainTitle")}
      >
        {t("video.transcribeAgain")}
      </button>
    </>
  );
}

// No lines yet: transcribing, or failed with Retry and Paste transcript.
export function TranscriptEmpty({
  audio,
  pending,
  failedMessage,
  onTranscribe,
  onPaste,
  pasteHelp,
}: {
  audio: boolean;
  pending: boolean;
  failedMessage: string | null;
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

  return (
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
                data-tip={t("video.pasteTranscriptTitle")}
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
  );
}
