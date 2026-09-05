import type { Lang } from "@/lib/i18n/config";

// Which of the app's two languages a text is written in (SPEC.md §19), from
// its characters alone — no model call, no network. Chinese when a fifth or
// more of the letters are CJK; English when the letters are Latin and CJK is
// rare; null when the text is neither, too short to tell, or another language.
// Dependency-free: the client decides whether to offer Translate from this.
const SAMPLE_CHARS = 4000;

export function detectLang(text: string): Lang | null {
  const sample = text.slice(0, SAMPLE_CHARS);
  let cjk = 0;
  let latin = 0;
  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x30ff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    } else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      latin++;
    }
  }
  const letters = cjk + latin;
  if (letters < 20) return null;
  if (cjk / letters >= 0.2) return "zh";
  if (latin / letters >= 0.6 && cjk / letters < 0.05) return "en";
  return null;
}

// The name of a language in the reader's language, for the Translate offer.
export function langNameIn(lang: Lang, ui: Lang): string {
  if (ui === "zh") return lang === "zh" ? "中文" : "英文";
  return lang === "zh" ? "Chinese" : "English";
}
