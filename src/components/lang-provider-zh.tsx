"use client";

import { LangProvider } from "@/components/lang-provider";
import { ZH } from "@/lib/i18n/dict/zh";
import { registerDictionary } from "@/lib/i18n/dictionaries";

// The provider a page in Chinese renders (app/layout.tsx): its module
// carries the Chinese strings and registers them as it loads, before any
// component under it renders, so every useT() under it reads Chinese from
// the first paint. A page in English renders LangProvider alone and never
// downloads this module.
registerDictionary("zh", ZH);

export function LangProviderZh({ children }: { children: React.ReactNode }) {
  return <LangProvider lang="zh">{children}</LangProvider>;
}
