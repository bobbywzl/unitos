"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MicIcon, StopIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import type { PhoneNote, PhoneProject, PhoneSection } from "@/components/phone/phone-app";
import { VoiceTypingButton } from "@/components/voice/voice-typing-button";
import { api } from "@/lib/api";
import { clientAppShell } from "@/lib/app-shell";
import { clearNoteDraft, draftHoldsWords, readNoteDraft, writeNoteDraft } from "@/lib/note-drafts";
import { newNoteId } from "@/lib/notes/client-id";
import { saveNoteText } from "@/lib/notes/save-text";
import { clearPhoneDraft, readPhoneDraft, readPhoneSection, writePhoneDraft, writePhoneSection } from "@/lib/phone-draft";
import { recognitionCtor } from "@/lib/voice-typing";

// The phone page's Notes tab (SPEC.md §33): the section, its notes, and the
// note box. A note is typed or spoken, and Add note writes it at the top of
// the section through the notes route, so it is the same note the notes tray
// and the notes full page show. A press on a note opens it to edit.

type SentNote = PhoneNote & { sectionId: string; queued: boolean };

const noop = () => () => {};

/** Voice by recording: where the browser cannot hear speech itself. */
const RECORD_MAX_SECONDS = 120;
const RECORD_BITS_PER_SECOND = 32_000;

function recordingMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
}

export function PhoneNotes({ project, sections }: { project: PhoneProject; sections: PhoneSection[] }) {
  const t = useT();
  // The section the account last wrote in is kept in this browser: read
  // once the page runs here, so the server's render and the first one agree.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const [picked, setPicked] = useState<string | null>(null);
  const [sent, setSent] = useState<SentNote[]>([]);
  const [editing, setEditing] = useState<PhoneNote | null>(null);

  const stored = mounted ? readPhoneSection(project.id) : null;
  const sectionId =
    [picked, stored].find((id) => id !== null && sections.some((s) => s.id === id)) ?? sections[0]?.id ?? null;
  const section = sections.find((s) => s.id === sectionId) ?? null;

  if (!section) return <p className="px-5 py-6 text-[15px] text-sand-700">{t("phone.noNotes")}</p>;

  // A note just added shows at once, above the stored ones, until the page's
  // next read carries it.
  const known = new Set(section.notes.map((n) => n.id));
  const shown: (PhoneNote & { queued?: boolean })[] = [
    ...sent.filter((n) => n.sectionId === section.id && !known.has(n.id)),
    ...section.notes,
  ];

  return (
    <>
      {sections.length > 1 && (
        <div className="shrink-0 px-4 pt-3">
          <select
            aria-label={t("phone.section")}
            value={section.id}
            onChange={(e) => {
              setPicked(e.target.value);
              writePhoneSection(project.id, e.target.value);
            }}
            className="w-full truncate rounded-full bg-card px-3.5 py-2 text-[14px] font-semibold text-sand-800 shadow-soft"
          >
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <ul className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-4 py-3">
        {shown.length === 0 && <li className="py-6 text-center text-[14px] text-sand-600">{t("phone.noNotes")}</li>}
        {shown.map((note) => (
          <li key={note.id}>
            <button
              type="button"
              data-phone-note={note.id}
              disabled={!project.canEdit || note.queued}
              onClick={() => setEditing(note)}
              className="block w-full rounded-2xl bg-card px-4 py-3 text-left shadow-soft"
            >
              {(note.pending || note.queued) && (
                <span className="mb-1 block text-[11px] font-semibold tracking-wide text-clay-800 uppercase">
                  {note.queued ? t("phone.waitsForNetwork") : t("phone.pending")}
                </span>
              )}
              <div className="max-h-[9.5em] overflow-hidden text-[15px] leading-relaxed">
                <Markdown breaks>{note.content}</Markdown>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {project.canEdit ? (
        mounted && (
          <NoteBox
            // The box is the section's: its draft is read when the section opens.
            key={section.id}
            projectId={project.id}
            sectionId={section.id}
            onAdded={(note) => setSent((list) => [note, ...list])}
          />
        )
      ) : (
        <p className="shrink-0 border-t border-line px-5 py-3 text-[13px] text-sand-700">{t("phone.viewerNotes")}</p>
      )}

      {editing && <NoteEdit note={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** The note box: a draft kept as it is typed, the microphone, and Add note. */
function NoteBox({
  projectId,
  sectionId,
  onAdded,
}: {
  projectId: string;
  sectionId: string;
  onAdded: (note: SentNote) => void;
}) {
  const t = useT();
  const router = useRouter();
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [draft] = useState(() => readPhoneDraft(sectionId));
  const [text, setText] = useState(draft?.content ?? "");
  // The id the note takes: chosen at the first send and kept with the draft,
  // so a send tried again makes the same note.
  const createId = useRef<string | null>(draft?.createId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keep = (value: string) => {
    setText(value);
    writePhoneDraft(sectionId, { content: value, ...(createId.current ? { createId: createId.current } : {}) });
  };

  async function add() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    const id = createId.current ?? newNoteId();
    createId.current = id;
    writePhoneDraft(sectionId, { content: text, createId: id });
    try {
      const answer = await api<{ queued?: boolean }>("/api/notes", "POST", { id, sectionId, content, top: true });
      // Stored, or waiting in the offline queue, which holds it from here on.
      clearPhoneDraft(sectionId);
      createId.current = null;
      setText("");
      onAdded({ id, content, pending: false, sectionId, queued: answer?.queued === true });
      router.refresh();
    } catch {
      setError(t("phone.notAdded"));
    } finally {
      setBusy(false);
    }
  }

  // The words the microphone heard go where the caret is, like typed ones.
  const append = (heard: string) => {
    const box = boxRef.current;
    const value = box?.value ?? text;
    const glue = value && !/\s$/.test(value) ? " " : "";
    keep(`${value}${glue}${heard}`);
    box?.focus();
  };

  // In the app the web view records and the server writes the words out;
  // a browser that hears speech itself types them as they are said.
  const hears = !clientAppShell() && recognitionCtor() !== null;

  return (
    <div className="shrink-0 border-t border-line bg-paper px-4 pt-2.5 pb-2.5">
      {error && (
        <p role="alert" className="mb-1.5 text-[13px] font-medium text-red-600">
          {error}
        </p>
      )}
      <textarea
        ref={boxRef}
        data-phone-box
        value={text}
        onChange={(e) => keep(e.target.value)}
        placeholder={t("phone.notePlaceholder")}
        rows={3}
        maxLength={50_000}
        className="block max-h-[38vh] min-h-[84px] w-full resize-none rounded-2xl bg-card px-4 py-3 text-[16px] leading-relaxed shadow-soft"
      />
      <div className="mt-2 flex items-center gap-2">
        {hears ? (
          <VoiceTypingButton
            field={boxRef}
            size={18}
            track="phone-voice"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-sand-800 shadow-soft"
          />
        ) : (
          <RecordButton projectId={projectId} onText={append} onError={setError} />
        )}
        <button
          type="button"
          data-track="phone-add-note"
          onClick={add}
          disabled={!text.trim() || busy}
          className="h-11 flex-1 rounded-full bg-clay px-5 text-[15px] font-semibold text-white disabled:opacity-50"
        >
          {busy ? t("phone.adding") : t("phone.addNote")}
        </button>
      </div>
    </div>
  );
}

/** Speak a note: the recording goes to the server, which answers its words. */
function RecordButton({
  projectId,
  onText,
  onError,
}: {
  projectId: string;
  onText: (text: string) => void;
  onError: (message: string | null) => void;
}) {
  const t = useT();
  const [state, setState] = useState<"idle" | "recording" | "writing">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The page goes away mid-recording: the microphone is let go.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
        recorder.stream.getTracks().forEach((track) => track.stop());
      }
    },
    [],
  );

  async function write(blob: Blob) {
    if (blob.size === 0) {
      onError(t("phone.heardNothing"));
      setState("idle");
      return;
    }
    setState("writing");
    try {
      const res = await fetch(`/api/speech/transcribe?notebookId=${encodeURIComponent(projectId)}`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob,
      });
      const answer = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!res.ok) onError(answer?.error ?? t("phone.heardNothing"));
      else if (!answer?.text) onError(t("phone.heardNothing"));
      else onText(answer.text);
    } catch {
      onError(t("common.offlineAi"));
    } finally {
      setState("idle");
    }
  }

  async function start() {
    onError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError(t("phone.cannotRecord"));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError(t("phone.micDenied"));
      return;
    }
    const mimeType = recordingMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: RECORD_BITS_PER_SECOND,
      });
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      onError(t("phone.cannotRecord"));
      return;
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (timerRef.current) clearTimeout(timerRef.current);
      void write(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
    };
    recorderRef.current = recorder;
    recorder.start();
    setState("recording");
    timerRef.current = setTimeout(() => recorder.state !== "inactive" && recorder.stop(), RECORD_MAX_SECONDS * 1000);
  }

  const stop = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const label = state === "recording" ? t("phone.stopSpeaking") : state === "writing" ? t("phone.transcribing") : t("phone.speak");
  return (
    <button
      type="button"
      data-track="phone-record"
      aria-label={label}
      disabled={state === "writing"}
      onClick={state === "recording" ? stop : start}
      className={`flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full shadow-soft ${
        state === "recording" ? "bg-red-600 px-4 text-white" : "w-11 bg-card text-sand-800"
      } ${state === "writing" ? "w-auto px-4 opacity-70" : ""}`}
    >
      {state === "recording" ? <StopIcon size={14} /> : <MicIcon size={18} />}
      {state !== "idle" && <span className="text-[13px] font-semibold">{label}</span>}
    </button>
  );
}

/** A note opened to edit: its text in one box, Save and Cancel. */
function NoteEdit({ note, onClose }: { note: PhoneNote; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  // Words typed here before and not saved (a failed save, a closed app) come back.
  const [text, setText] = useState(() => {
    const draft = readNoteDraft(note.id);
    return draft && draftHoldsWords(draft) ? draft.content : note.content;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const content = text.trim();
    if (!content || busy) return;
    if (content === note.content.trim()) {
      clearNoteDraft(note.id);
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await saveNoteText(note.id, content, note.content);
      // A save that waits in the offline queue keeps its draft there.
      if (!saved.queued) clearNoteDraft(note.id);
      router.refresh();
      if (saved.conflict) {
        setText(saved.content);
        setError(t("phone.mergedWithOther"));
        setBusy(false);
        return;
      }
      onClose();
    } catch {
      setError(t("phone.notSaved"));
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label={t("phone.editNote")}
      className="fixed inset-0 z-50 mx-auto flex max-w-[640px] flex-col bg-paper"
      style={{ height: "var(--phone-height, 100dvh)" }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 pt-[calc(10px+env(safe-area-inset-top))] pb-2.5">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-2 text-[15px] font-semibold text-sand-700"
        >
          {t("phone.cancel")}
        </button>
        <span className="flex-1 text-center text-[15px] font-semibold">{t("phone.editNote")}</span>
        <button
          type="button"
          data-track="phone-save-note"
          onClick={save}
          disabled={!text.trim() || busy}
          className="rounded-full bg-clay px-4 py-2 text-[15px] font-semibold text-white disabled:opacity-50"
        >
          {busy ? t("phone.saving") : t("phone.save")}
        </button>
      </div>
      {error && (
        <p role="alert" className="shrink-0 px-5 pt-2 text-[13px] font-medium text-red-600">
          {error}
        </p>
      )}
      <textarea
        data-phone-edit
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          writeNoteDraft(note.id, e.target.value, note.content);
        }}
        maxLength={50_000}
        className="min-h-0 flex-1 resize-none bg-paper px-5 py-4 text-[16px] leading-relaxed outline-none"
      />
    </div>
  );
}
