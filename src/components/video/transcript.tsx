"use client";

import { useState } from "react";
import { SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

// The transcript under the player (SPEC.md §11), shaped like an article. The
// lines themselves render through the reader (reader.tsx TranscriptBody): they
// are the document's blocks, so every text tool of an article works on them —
// the selection toolbar, marks, links. This file keeps the transcript's frame:
// the header above the lines, and the states shown when there are no lines.

// When every transcription rung failed, the pane offers Paste transcript
// beside Retry: the reader copies the transcript YouTube shows them and hands
// it over — the one rung that never depends on the server's network.

export function TranscriptHeader({
  count,
  audio,
  pending,
  onTranscribe,
}: {
  count: number;
  audio: boolean;
  pending: boolean;
  onTranscribe: () => void;
}) {
  const t = useT();
  return (
    <div className="mt-6 mb-2.5 flex items-center gap-2">
      <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
        {t("video.transcript")}
      </span>
      {count > 0 && <span className="text-[13px] text-sand-600">{count}</span>}
      {count > 0 && !pending && (
        <button
          onClick={onTranscribe}
          data-track="video-transcribe-again"
          className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
          data-tip={t(audio ? "video.transcribeAgainTitleAudio" : "video.transcribeAgainTitle")}
        >
          {t("video.transcribeAgain")}
        </button>
      )}
    </div>
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
