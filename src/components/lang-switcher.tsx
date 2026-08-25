"use client";

import { useRouter } from "next/navigation";
import { useLang } from "@/components/lang-provider";
import { LANGS, langLabel, writeLangCookie, type Lang } from "@/lib/i18n/config";

// Language pills. Sets the cookie and re-renders the tree server-side, so
// every surface switches at once.
export function LangSwitcher() {
  const router = useRouter();
  const active = useLang();

  function choose(lang: Lang) {
    if (lang === active) return;
    writeLangCookie(lang);
    router.refresh();
  }

  return (
    <div className="flex gap-1">
      {LANGS.map((lang) => (
        <button
          key={lang}
          onClick={() => choose(lang)}
          aria-pressed={active === lang}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            active === lang ? "bg-ink text-paper" : "bg-card text-sand-600 shadow-soft hover:text-clay-800"
          }`}
        >
          {langLabel(lang)}
        </button>
      ))}
    </div>
  );
}
