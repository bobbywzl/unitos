"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MicIcon, StopIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { ProgressBar } from "@/components/progress-bar";
import { useOpenDocument } from "@/components/reader/open-document-context";
import { readThinking } from "@/lib/assistant/thinking";
import { readNdjson } from "@/lib/ndjson";
import type { VoiceEvent, VoiceStage } from "@/app/api/notes/voice/route";
import { flushDocument } from "@/components/docs/layer/flush";
import { isOffline } from "@/lib/offline/queue";

// The voice command (SPEC.md §6): press to record, press again to stop. The
// recording goes to /api/notes/voice with the section and the open document;
// the route transcribes it, reads it as a command over the document and the
// section's notes, and writes the notes it asks for as PENDING notes in the
// section, each quote a source; the tray shows them in the pending queue for
// the reader to read over and accept. The route streams its three stages,
// and the bottom progress bar shows them. Recording stops on its own at five
// minutes; the low bitrate keeps five minutes under the request cap.
// Offline, Command does not record: it says AI is off (SPEC.md §17). A send
// that fails keeps the recording, and Send again sends it once more, so a
// command is never spoken twice.
const MAX_SECONDS = 300;
const STAGES: VoiceStage[] = ["transcribe", "plan", "write"];
const BITS_PER_SECOND = 32_000;

// The first container this browser records: Chrome and Firefox give WebM/Opus,
// Safari gives MP4/AAC. Every transcription rung takes both.
// Whether this browser can record: false on the server and on the first
// client render, so the hydrated tree matches, then the real answer.
const noop = () => () => {};
function canRecord(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
}

function recordingMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
}

export function VoiceNoteButton({
  sectionId,
  className,
  onError,
}: {
  sectionId: string;
  className?: string;
  /** Where the reason shows when recording or transcription fails. */
  onError?: (message: string | null) => void;
}) {
  const t = useT();
  const router = useRouter();
  const documentId = useOpenDocument();
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [stage, setStage] = useState<VoiceStage>("transcribe");
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supported = useSyncExternalStore(noop, canRecord, () => false);
  // The recording whose send failed: Send again sends it.
  const [failed, setFailed] = useState<Blob | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function release() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  async function start() {
    onError?.(null);
    // The command needs a model: offline, nothing is recorded.
    if (isOffline()) {
      onError?.(t("common.offlineAi"));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError?.(t("outline.micDenied"));
      return;
    }
    const mimeType = recordingMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: BITS_PER_SECOND,
      });
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      onError?.(t("outline.voiceNoteUnsupported"));
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      release();
      void send(blob);
    };
    recorderRef.current = recorder;
    streamRef.current = stream;
    recorder.start(1000);
    setSeconds(0);
    setState("recording");
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) stop();
        return s + 1;
      });
    }, 1000);
  }

  function stop() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }

  async function send(blob: Blob) {
    setState("sending");
    setStage("transcribe");
    onError?.(null);
    try {
      if (blob.size === 0) throw new Error(t("outline.voiceNoteEmpty"));
      if (isOffline()) {
        setFailed(blob);
        throw new Error(t("common.offlineAi"));
      }
      const params = new URLSearchParams({ sectionId, thinking: readThinking() });
      if (documentId) {
        params.set("documentId", documentId);
        // A blank document's typing is saved before the command reads it.
        await flushDocument(documentId);
      }
      const res = await fetch(`/api/notes/voice?${params}`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob,
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("common.requestFailedStatus", { status: res.status }));
      }
      for await (const event of readNdjson<VoiceEvent>(res)) {
        if ("error" in event) throw new Error(event.error);
        if ("stage" in event) setStage(event.stage);
      }
      setFailed(null);
      router.refresh();
    } catch (err) {
      // The recording stays for Send again: a lost connection, a server
      // error, or an answer the route could not finish. An empty recording
      // has nothing to send again.
      if (blob.size > 0) setFailed(blob);
      onError?.(err instanceof Error ? err.message : t("outline.voiceNoteFailed"));
    } finally {
      setState("idle");
    }
  }

  if (!supported) return null;
  const base = className ?? "";
  if (state === "sending") {
    const label = t(
      stage === "transcribe"
        ? "outline.voiceNoteTranscribing"
        : stage === "plan"
          ? "outline.voiceStagePlan"
          : "outline.voiceStageWrite",
    );
    return (
      <>
        <span className={`${base} inline-flex items-center gap-1 text-sand-600 opacity-60`} data-tip={label}>
          <MicIcon size={11} />
          {t("outline.speakNote")}
        </span>
        <ProgressBar label={label} done={STAGES.indexOf(stage)} total={STAGES.length} />
      </>
    );
  }
  if (state === "recording") {
    return (
      <button
        type="button"
        onClick={stop}
        data-track="voice-note-stop"
        aria-label={t("outline.stopRecording")}
        data-tip={t("outline.stopRecording")}
        className={`${base} inline-flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-white opacity-100 hover:bg-red-600`}
      >
        <StopIcon size={10} />
        <span className="tabular-nums">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
      </button>
    );
  }
  if (failed) {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => void send(failed)}
          data-track="voice-note-send-again"
          aria-label={t("outline.sendCommandAgain")}
          data-tip={t("outline.sendCommandAgainTitle")}
          className={`${base} inline-flex items-center gap-1`}
        >
          <MicIcon size={11} />
          {t("outline.sendCommandAgain")}
        </button>
        <button
          type="button"
          onClick={() => {
            setFailed(null);
            onError?.(null);
          }}
          data-track="voice-note-discard"
          aria-label={t("outline.discardCommand")}
          data-tip={t("outline.discardCommand")}
          className="text-[11px] text-sand-500 hover:text-clay-700"
        >
          ✕
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void start()}
      data-track="voice-note"
      aria-label={t("outline.speakNote")}
      data-tip={t("outline.speakNoteTitle")}
      className={`${base} inline-flex items-center gap-1`}
    >
      <MicIcon size={11} />
      {t("outline.speakNote")}
    </button>
  );
}
