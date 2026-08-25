// Language primitives shared by server (layout, API routes) and client
// (LangProvider). Keep this file dependency-free — it is imported from both
// worlds, including the edge middleware.
//
// The reader's choice lives in a readable cookie (dissect-lang), set by the
// language switcher. The root layout reads it to render <html lang> before
// any fetch; a first visit falls back to the browser's Accept-Language.

export type Lang = "en" | "zh";

export const LANGS: readonly Lang[] = ["en", "zh"] as const;
export const DEFAULT_LANG: Lang = "en";
export const LANG_COOKIE = "dissect-lang";
// One year — a preference cookie, not a session.
export const LANG_COOKIE_MAX_AGE = 365 * 24 * 3600;

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "zh";
}

// Value for the <html lang> attribute.
export function htmlLangOf(lang: Lang): string {
  return lang === "zh" ? "zh-CN" : "en";
}

// Human-readable name of a language, in that language (for the switcher).
export function langLabel(lang: Lang): string {
  return lang === "zh" ? "中文" : "English";
}

// Client-side cookie write for the language switcher; call only in the browser.
export function writeLangCookie(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`;
}

// First-visit default from the Accept-Language header; any cookie wins over this.
export function langFromAcceptLanguage(header: string | null | undefined): Lang {
  if (!header) return DEFAULT_LANG;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase();
    if (!tag) continue;
    if (tag === "zh" || tag.startsWith("zh-")) return "zh";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return DEFAULT_LANG;
}
