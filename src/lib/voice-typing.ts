// Voice typing (SPEC.md §29, typing): the browser's speech service, the
// languages it listens in, and the words it types as punctuation. One
// module for every surface that takes voice typing — the page editor's
// microphone box, and the microphone button beside a note, a reply, a
// question, and every AI conversation's message box
// (components/voice/voice-typing-button.tsx). Nothing here is sent to the
// server: the browser's own speech service hears the words.

export type Recognition = {
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
export type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type RecognitionCtor = new () => Recognition;

/** The browser's speech service; null where the browser has none. */
export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const VOICE_LANGUAGES: { code: string; name: string }[] = [
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

// The language voice typing listens in: one choice per browser, the same on
// every surface. The key is the page editor's, kept so a choice made there
// before every surface had voice typing still holds.
export const VOICE_LANG_KEY = "unitos-docs-voice-lang";
export const VOICE_LANG_EVENT = "unitos:voice-lang";

export function readVoiceLanguage(appLang: string): string {
  try {
    const saved = window.localStorage.getItem(VOICE_LANG_KEY);
    if (saved && VOICE_LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {
    // Storage is off: the page's language.
  }
  return appLang === "zh" ? "zh-CN" : "en-US";
}

export function writeVoiceLanguage(code: string): void {
  try {
    window.localStorage.setItem(VOICE_LANG_KEY, code);
  } catch {
    // Storage is off: the choice holds for this page.
  }
  window.dispatchEvent(new Event(VOICE_LANG_EVENT));
}

/** The words Docs types as punctuation, in English. */
const SPOKEN: [RegExp, string][] = [
  [/\s*\bperiod\b/gi, "."],
  [/\s*\bfull stop\b/gi, "."],
  [/\s*\bcomma\b/gi, ","],
  [/\s*\bquestion mark\b/gi, "?"],
  [/\s*\bexclamation (point|mark)\b/gi, "!"],
];

export type Piece = { text: string } | { lineBreak: true } | { paragraph: true };

/** A heard phrase as what to type: text, line breaks, new paragraphs.
    "period", "comma", "new line", and the like type what they name, in
    English. */
export function spokenPieces(phrase: string, english: boolean): Piece[] {
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

/** The space to put before heard text: one when the character before the
    caret is not a space and the text does not start with punctuation. */
export function glueBefore(before: string, text: string): string {
  return before && !/\s/.test(before) && !/^[.,?!]/.test(text) ? " " : "";
}
