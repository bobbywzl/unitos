"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MicIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { useSpeech } from "@/components/voice/use-speech";
import { glueBefore, spokenPieces, VOICE_LANGUAGES } from "@/lib/voice-typing";

const STATUS_MS = 5000;

// Voice typing beside a text box (SPEC.md §29, typing): a microphone button
// that types what the browser's speech service hears at the box's caret, as
// the page editor's microphone box does in a document. A click starts
// listening, a second click stops it; listening goes on through pauses.
// "period", "comma", "new line", and the like type what they name, in
// English. While it listens, a small card over the button shows the words
// heard so far and the language it listens in; the language is one choice
// per browser, picked in the page editor's microphone box, else the app's
// language. The card takes no clicks, so a card or a menu the box sits in
// never reads a click on it as a click outside. The words go in as typing does — the box's
// own input event — so every box keeps its draft, its undo, and its save as
// for typed words.

type Field = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

const FIELD_SELECTOR = 'textarea, input:not([type]), input[type="text"], input[type="search"], [contenteditable]:not([contenteditable="false"])';

/** The box the button types into: the one it is given, else the nearest box
    in the button's own surroundings. */
function findField(button: HTMLElement | null, field?: RefObject<Field | null>): Field | null {
  if (field) return field.current;
  for (let el = button?.parentElement ?? null; el; el = el.parentElement) {
    const found = el.querySelector<HTMLElement>(FIELD_SELECTOR);
    if (found) return found;
  }
  return null;
}

const isTextField = (el: Field): el is HTMLTextAreaElement | HTMLInputElement =>
  el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;

/** The character before the caret. */
function charBefore(el: Field): string {
  if (isTextField(el)) {
    const at = el.selectionStart ?? el.value.length;
    return el.value.slice(at - 1, at);
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return "";
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(sel.anchorNode!, sel.anchorOffset);
  return range.toString().slice(-1);
}

/** Types text at the caret as typing does. A browser that refuses the
    command gets the text set in place, with the input event the box listens
    for. */
function insert(el: Field, text: string): void {
  if (document.execCommand("insertText", false, text)) return;
  if (isTextField(el)) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.setRangeText(text, start, end, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function typeHeardInto(el: Field, phrase: string, english: boolean): void {
  if (!el.isConnected || (isTextField(el) && (el.disabled || el.readOnly))) return;
  if (document.activeElement !== el) el.focus();
  const singleLine = el instanceof HTMLInputElement;
  let first = true;
  for (const piece of spokenPieces(phrase.trim(), english)) {
    if ("text" in piece) {
      insert(el, (first ? glueBefore(charBefore(el), piece.text) : "") + piece.text);
    } else if (singleLine) {
      insert(el, " ");
    } else if (isTextField(el)) {
      insert(el, "lineBreak" in piece ? "\n" : "\n\n");
    } else {
      document.execCommand("lineBreak" in piece ? "insertLineBreak" : "insertParagraph");
    }
    first = false;
  }
}

export function VoiceTypingButton({
  field,
  size = 13,
  className = "",
  track = "voice-typing",
}: {
  /** The box to type into; without it, the nearest box to the button. */
  field?: RefObject<Field | null>;
  size?: number;
  className?: string;
  track?: string;
}) {
  const t = useT();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const targetRef = useRef<Field | null>(null);
  const speech = useSpeech((phrase, english) => {
    const el = targetRef.current;
    if (el) typeHeardInto(el, phrase, english);
  });
  const { listening, status, interim } = speech;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const showCard = listening || status !== "";

  // The card sits over the button while it shows, and follows it on scroll.
  useEffect(() => {
    if (!showCard) return;
    const place = () => setRect(buttonRef.current?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [showCard]);

  // Trouble shows for a moment, then the card goes.
  const { setStatus } = speech;
  useEffect(() => {
    if (listening || !status) return;
    const timer = window.setTimeout(() => setStatus(""), STATUS_MS);
    return () => window.clearTimeout(timer);
  }, [listening, status, setStatus]);

  // The box left the page (a card closed, a message sent and the box went):
  // the microphone turns off.
  useEffect(() => {
    if (!listening) return;
    const timer = window.setInterval(() => {
      if (targetRef.current && !targetRef.current.isConnected) speech.stop();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [listening, speech]);

  function toggle() {
    if (listening) {
      speech.stop();
      return;
    }
    const el = findField(buttonRef.current, field);
    if (!el) return;
    targetRef.current = el;
    if (speech.start()) el.focus();
  }

  const message =
    status === "unsupported"
      ? t("docsTyping.voiceUnsupported")
      : status === "blocked"
        ? t("docsTyping.voiceBlocked")
        : status === "trouble"
          ? t("docsTyping.voiceTrouble")
          : interim || t("docsTyping.listening");
  const label = listening ? t("docsTyping.clickToStop") : t("docsTyping.clickToSpeak");

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        data-track={track}
        aria-pressed={listening}
        aria-label={`${t("docsTyping.voiceTyping")}: ${label}`}
        data-tip={`${t("docsTyping.voiceTyping")}: ${label}`}
        className={`flex shrink-0 items-center justify-center rounded-full ${
          listening ? "voice-typing-on bg-red-500 text-white" : "text-sand-600 hover:bg-clay-100 hover:text-clay-800"
        } ${className || "size-7"}`}
      >
        <MicIcon size={size} />
      </button>
      {showCard &&
        rect &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed z-[80] flex w-60 flex-col gap-1 rounded-xl border border-line bg-card p-2.5 text-[12px] text-ink shadow-float"
            style={{
              left: Math.max(8, Math.min(rect.left + rect.width / 2 - 120, window.innerWidth - 248)),
              top: rect.top > 120 ? rect.top - 8 : rect.bottom + 8,
              transform: rect.top > 120 ? "translateY(-100%)" : undefined,
            }}
          >
            <p className={`line-clamp-3 ${status ? "text-red-600" : interim ? "text-ink" : "text-sand-600"}`}>{message}</p>
            <p className="text-[11px] text-sand-500">
              {VOICE_LANGUAGES.find((l) => l.code === speech.language)?.name ?? speech.language}
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
