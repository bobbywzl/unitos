import { admin } from "@/lib/i18n/dict/admin";
import { api } from "@/lib/i18n/dict/api";
import { assistant } from "@/lib/i18n/dict/assistant";
import { common } from "@/lib/i18n/dict/common";
import { outline } from "@/lib/i18n/dict/outline";
import { panels } from "@/lib/i18n/dict/panels";
import { panes } from "@/lib/i18n/dict/panes";
import { reader } from "@/lib/i18n/dict/reader";
import { settings } from "@/lib/i18n/dict/settings";
import { signin } from "@/lib/i18n/dict/signin";
import { video } from "@/lib/i18n/dict/video";
import { works } from "@/lib/i18n/dict/works";
import type { Lang } from "@/lib/i18n/config";

// UI string catalog. Each namespace file exports { en, zh } with identical
// keys (enforced by `zh: Record<keyof typeof en, string>` in every file), so
// a key can never exist in one language only. t("namespace.key") is fully
// typed — a typo'd key is a compile error — and English is the fallback if a
// lookup ever misses at runtime. The zh terminology glossary lives at the top
// of dict/common.ts; every namespace keeps to it.
const NAMESPACES = {
  common,
  signin,
  works,
  outline,
  reader,
  assistant,
  panels,
  panes,
  video,
  settings,
  admin,
  api,
} as const;

type Namespaces = typeof NAMESPACES;

// "namespace.key" union across every dictionary.
export type TKey = {
  [N in keyof Namespaces & string]: `${N}.${keyof Namespaces[N]["en"] & string}`;
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
  const table = NAMESPACES[ns] as { en: Record<string, string>; zh: Record<string, string> };
  const s = table?.[lang]?.[k] ?? table?.en?.[k] ?? key;
  return interpolate(s, params);
}

export function translatorFor(lang: Lang): TFunc {
  return (key, params) => translate(lang, key, params);
}
