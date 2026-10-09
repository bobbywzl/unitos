"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { useSpeech } from "@/components/voice/use-speech";
import { glueBefore, recognitionCtor, spokenPieces, VOICE_LANGUAGES } from "@/lib/voice-typing";
import { CloseIcon } from "@/components/docs/icons";
import { keepFocus } from "@/components/docs/menu";
import { DragIcon } from "@/components/docs/insert/icons";

// Voice typing (Ctrl+Shift+S), as Google Docs does it (SPEC.md §29, typing):
// the toolbar's microphone starts listening at once, as every other
// surface's microphone does, and opens the box at the left of the page as
// its listening card; the toolbar's microphone again, or the box's, stops. What the browser's speech service hears goes in at the caret;
// "period", "comma", "new line", and the like type what they name. The
// listening and the words are shared with every surface's microphone
// button (lib/voice-typing.ts, components/voice/use-speech.ts).

/** Types a heard phrase at the editor's caret. */
export function typeHeard(editor: Editor, phrase: string, english: boolean): void {
  const before = editor.state.selection.$from.nodeBefore?.text?.slice(-1) ?? "";
  let first = true;
  for (const piece of spokenPieces(phrase.trim(), english)) {
    if ("lineBreak" in piece) editor.chain().setHardBreak().run();
    else if ("paragraph" in piece) editor.chain().splitBlock().run();
    else editor.chain().insertContent((first ? glueBefore(before, piece.text) : "") + piece.text).run();
    first = false;
  }
}

export function VoiceTyping({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const t = useT();
  const speech = useSpeech((phrase, english) => typeHeard(editor, phrase, english));
  const { listening, status, setStatus, interim, language, stop } = speech;
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const start = () => {
    if (speech.start()) editor.commands.focus();
  };
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });

  // The box opens at the left of the page, near its top, and listening
  // starts with it: the press that opened it is the press that starts.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const page = editor.view.dom.closest<HTMLElement>("[data-docs-page]");
      const rect = page?.getBoundingClientRect();
      setPos({ left: Math.max(12, (rect?.left ?? 80) - 150), top: Math.max(80, (rect?.top ?? 120) + 24) });
      if (!recognitionCtor()) setStatus("unsupported");
      else startRef.current();
    });
    return () => {
      cancelAnimationFrame(frame);
      stop();
    };
  }, [open, editor, stop, setStatus]);

  const drag = (e: React.PointerEvent) => {
    if (!pos) return;
    const startX = e.clientX - pos.left;
    const startY = e.clientY - pos.top;
    const move = (ev: PointerEvent) => setPos({ left: ev.clientX - startX, top: ev.clientY - startY });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!open || typeof document === "undefined") return null;
  const message =
    status === "unsupported"
      ? t("docsTyping.voiceUnsupported")
      : status === "blocked"
        ? t("docsTyping.voiceBlocked")
        : status === "trouble"
          ? t("docsTyping.voiceTrouble")
          : listening
            ? interim || t("docsTyping.listening")
            : "";
  return createPortal(
    <div
      className="docs-voice"
      role="dialog"
      aria-label={t("docsTyping.voiceTyping")}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      data-edit-control
      data-docs-typing
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div className="docs-voice-head" onPointerDown={drag}>
        <DragIcon size={18} />
        <button
          type="button"
          className="docs-icon-btn"
          aria-label={t("docs.close")}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={keepFocus}
          onClick={() => {
            stop();
            onClose();
          }}
        >
          <CloseIcon size={18} />
        </button>
      </div>
      <select
        className="docs-voice-lang"
        aria-label={t("docsTyping.voiceLanguage")}
        value={language}
        onChange={(e) => speech.setLanguage(e.target.value)}
      >
        {VOICE_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={`docs-voice-mic${listening ? " docs-voice-on" : ""}`}
        aria-pressed={listening}
        aria-label={listening ? t("docsTyping.clickToStop") : t("docsTyping.clickToSpeak")}
        data-tip={listening ? t("docsTyping.clickToStop") : t("docsTyping.clickToSpeak")}
        onMouseDown={keepFocus}
        onClick={() => (listening ? stop() : start())}
        disabled={status === "unsupported"}
      >
        <svg width={40} height={40} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
          <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
        </svg>
      </button>
      {message && (
        <p className="docs-voice-status" aria-live="polite">
          {message}
        </p>
      )}
    </div>,
    document.body,
  );
}
