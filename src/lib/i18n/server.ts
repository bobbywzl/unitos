import { cookies, headers } from "next/headers";
import {
  DEFAULT_LANG,
  isLang,
  LANG_COOKIE,
  langFromAcceptLanguage,
  type Lang,
} from "@/lib/i18n/config";
import { translatorFor, type TFunc } from "@/lib/i18n/dictionaries";

// The language a request should be served in: the cookie when present, else
// the browser's Accept-Language, else English. Safe outside a request scope
// (cron) — falls back to English there.
export async function currentLang(): Promise<Lang> {
  try {
    const c = (await cookies()).get(LANG_COOKIE)?.value;
    if (isLang(c)) return c;
    return langFromAcceptLanguage((await headers()).get("accept-language"));
  } catch {
    return DEFAULT_LANG;
  }
}

// Translator for the current request — server components and API routes.
export async function serverT(): Promise<TFunc> {
  return translatorFor(await currentLang());
}
