"use client";

import { use } from "react";
import { LangProvider } from "@/components/lang-provider";
import { registerDictionary } from "@/lib/i18n/dictionaries";

// The provider a page in Chinese renders (app/layout.tsx). The Chinese
// strings load as their own chunk the first time this renders, and register
// before any component under it renders, so every useT() under it reads
// Chinese from the first paint. A page in English renders LangProvider
// alone and never downloads the chunk: the import runs only here, not when
// this module loads (a static import would land the strings in a chunk
// every page shares).
let zhReady: Promise<void> | null = null;
function loadZh(): Promise<void> {
  zhReady ??= import("@/lib/i18n/dict/zh").then((m) => registerDictionary("zh", m.ZH));
  return zhReady;
}

export function LangProviderZh({ children }: { children: React.ReactNode }) {
  use(loadZh());
  return <LangProvider lang="zh">{children}</LangProvider>;
}
