"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang, useT } from "@/components/lang-provider";
import { CloseIcon } from "@/components/docs/icons";
import { keepFocus } from "@/components/docs/menu";
import { DragIcon } from "@/components/docs/insert/icons";

// Voice typing (Ctrl+Shift+S), as Google Docs does it (SPEC.md §29, typing):
// a small microphone box at the left of the page; a click on the microphone
// starts listening (it turns red and pulses) and a second click stops it.
// What is heard goes in at the caret, which the reader may move while it
// listens. "period", "comma", "question mark", "exclamation point", "new
// line", and "new paragraph" type what they name. The browser's speech
// service hears; where there is none, the box says so.

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const LANGUAGES: { code: string; name: string }[] = [
  { code: "en-US", name: "English (US)" },
  { code: "en-GB", name: "English (UK)" },
  { code: "zh-CN", name: "中文（简体）" },
  { code: "zh-TW", name: "中文（繁體）" },
  { code: "es-ES", name: "Español" },
  { code: "fr-FR", name: "Français" },
  { code: "de-DE", name: "Deutsch" },
  { code: "it-IT", name: "Italiano" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "ja-JP", name: "日本語" },
  { code: "ko-KR", name: "한국어" },
];

const LANG_KEY = "unitos-docs-voice-lang";

/** The words Docs types as punctuation, in English. */
const SPOKEN: [RegExp, string][] = [
  [/\s*\bperiod\b/gi, "."],
  [/\s*\bfull stop\b/gi, "."],
  [/\s*\bcomma\b/gi, ","],
  [/\s*\bquestion mark\b/gi, "?"],
  [/\s*\bexclamation (point|mark)\b/gi, "!"],
];

type Piece = { text: string } | { lineBreak: true } | { paragraph: true };

/** A heard phrase as what to type: text, line breaks, new paragraphs. */
function spokenPieces(phrase: string, english: boolean): Piece[] {
  let text = phrase;
  if (english) for (const [re, mark] of SPOKEN) text = text.replace(re, mark);
  const out: Piece[] = [];
  const parts = english ? text.split(/\s*\b(new line|new paragraph)\b\s*/i) : [text];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "new line") out.push({ lineBreak: true });
    else if (lower === "new paragraph") out.push({ paragraph: true });
    else if (part) out.push({ text: part });
  }
  return out;
}

function typeHeard(editor: Editor, phrase: string, english: boolean): void {
  const { state } = editor;
  const before = state.selection.$from.nodeBefore?.text?.slice(-1) ?? "";
  let first = true;
  for (const piece of spokenPieces(phrase.trim(), english)) {
    if ("lineBreak" in piece) editor.chain().setHardBreak().run();
    else if ("paragraph" in piece) editor.chain().splitBlock().run();
    else {
      const glue = first && before && !/\s/.test(before) && !/^[.,?!]/.test(piece.text) ? " " : "";
      editor.chain().insertContent(glue + piece.text).run();
    }
    first = false;
  }
}

export function VoiceTyping({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<"" | "unsupported" | "trouble" | "blocked">("");
  const [interim, setInterim] = useState("");
  const [language, setLanguage] = useState(() => {
    try {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(LANG_KEY) : null;
      if (saved) return saved;
    } catch {
      // Storage is off: the page's language.
    }
    return lang === "zh" ? "zh-CN" : "en-US";
  });
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false);

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    const rec = new Ctor();
    rec.lang = language;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let heard = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) typeHeard(editor, result[0].transcript, language.startsWith("en"));
        else heard += result[0].transcript;
      }
      setInterim(heard);
      setStatus("");
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantRef.current = false;
        setStatus("blocked");
      } else if (e.error !== "aborted" && e.error !== "no-speech") {
        setStatus("trouble");
      }
    };
    rec.onend = () => {
      // The service stops after a pause; listening goes on until the reader stops it.
      if (wantRef.current) {
        try {
          rec.start();
          return;
        } catch {
          // Could not restart: fall through and stop.
        }
      }
      setListening(false);
      setInterim("");
    };
    recRef.current = rec;
    wantRef.current = true;
    try {
      rec.start();
      setListening(true);
      setStatus("");
      editor.commands.focus();
    } catch {
      wantRef.current = false;
      setStatus("trouble");
    }
  }, [editor, language]);

  // The box opens at the left of the page, near its top.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const page = editor.view.dom.closest<HTMLElement>("[data-docs-page]");
      const rect = page?.getBoundingClientRect();
      setPos({ left: Math.max(12, (rect?.left ?? 80) - 150), top: Math.max(80, (rect?.top ?? 120) + 24) });
      if (!recognitionCtor()) setStatus("unsupported");
    });
    return () => {
      cancelAnimationFrame(frame);
      wantRef.current = false;
      recRef.current?.abort();
      recRef.current = null;
    };
  }, [open, editor]);

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
          className="docs-find-btn"
          aria-label={t("docsTyping.close")}
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
        onChange={(e) => {
          const next = e.target.value;
          setLanguage(next);
          try {
            window.localStorage.setItem(LANG_KEY, next);
          } catch {
            // Storage is off: the choice holds for this page.
          }
          if (listening) {
            stop();
          }
        }}
      >
        {LANGUAGES.map((l) => (
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
