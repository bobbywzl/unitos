"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MicIcon, SpinnerIcon, StopIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

// A voice note (SPEC.md §6): press to record, press again to stop. The
// recording goes to /api/notes/voice, which transcribes it, cleans it, and
// lands it as a PENDING note in the section; the tray shows it at the top of
// the pending queue for the reader to read over and accept. Recording stops
// on its own at five minutes; the low bitrate keeps five minutes under the
// request cap.
const MAX_SECONDS = 300;
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
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supported = useSyncExternalStore(noop, canRecord, () => false);

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
    try {
      if (blob.size === 0) throw new Error(t("outline.voiceNoteEmpty"));
      const res = await fetch(`/api/notes/voice?sectionId=${encodeURIComponent(sectionId)}`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob,
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("common.requestFailedStatus", { status: res.status }));
      }
      router.refresh();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : t("outline.voiceNoteFailed"));
    } finally {
      setState("idle");
    }
  }

  if (!supported) return null;
  const base = className ?? "";
  if (state === "sending") {
    return (
      <span
        className={`${base} inline-flex items-center gap-1 text-sand-600`}
        data-tip={t("outline.voiceNoteTranscribing")}
      >
        <SpinnerIcon size={11} className="text-clay motion-safe:animate-spin" />
        {t("outline.voiceNoteTranscribing")}
      </span>
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
