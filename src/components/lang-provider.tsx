"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LANG, type Lang } from "@/lib/i18n/config";
import { translatorFor, type TFunc } from "@/lib/i18n/dictionaries";

const LangContext = createContext<Lang>(DEFAULT_LANG);

// The root layout reads the language cookie and provides it here, so every
// client component translates with useT() and re-renders on router.refresh().
export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

// The client-side translator: const t = useT();
export function useT(): TFunc {
  return translatorFor(useContext(LangContext));
}
