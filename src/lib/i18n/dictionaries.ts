import { EN } from "@/lib/i18n/dict/en";
import type { Lang } from "@/lib/i18n/config";

// UI string catalog. Each namespace file exports its English strings (en)
// and its sibling .zh file the Chinese ones (zh) with identical keys
// (enforced by `Record<keyof typeof en, string>` in every .zh file), so a
// key can never exist in one language only. t("namespace.key") is fully
// typed — a typo'd key is a compile error — and English is the fallback if a
// lookup ever misses at runtime. The zh terminology glossary lives at the top
// of dict/common.ts; every namespace keeps to it.
//
// Every bundle carries English (dict/en.ts). Chinese (dict/zh.ts) is
// registered by whoever loads it: the server at start (lib/i18n/server.ts,
// instrumentation.ts), the browser through the provider a page in Chinese
// renders (components/lang-provider-zh.tsx). A page in English never
// downloads the Chinese strings.
type Namespaces = typeof EN;
export type Tables = { readonly [N in keyof Namespaces]: Readonly<Record<keyof Namespaces[N], string>> };

const tables: Partial<Record<Lang, Tables>> = { en: EN };

export function registerDictionary(lang: Lang, dictionary: Tables): void {
  tables[lang] = dictionary;
}


// "namespace.key" union across every dictionary.
export type TKey = {
  [N in keyof Namespaces & string]: `${N}.${keyof Namespaces[N] & string}`;
}[keyof Namespaces & string];

export type TParams = Record<string, string | number>;
export type TFunc = (key: TKey, params?: TParams) => string;

function interpolate(s: string, params?: TParams): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}

export function translate(lang: Lang, key: TKey, params?: TParams): string {
  const dot = key.indexOf(".");
  const ns = key.slice(0, dot) as keyof Namespaces;
  const k = key.slice(dot + 1);
  const table = tables[lang]?.[ns] as Record<string, string> | undefined;
  const fallback = EN[ns] as Record<string, string> | undefined;
  const s = table?.[k] ?? fallback?.[k] ?? key;
  return interpolate(s, params);
}

// One translator per language: the same function on every render, so an
// effect or a callback that uses t does not run again for nothing.
const translators = new Map<Lang, TFunc>();

export function translatorFor(lang: Lang): TFunc {
  let t = translators.get(lang);
  if (!t) {
    t = (key, params) => translate(lang, key, params);
    translators.set(lang, t);
  }
  return t;
}
