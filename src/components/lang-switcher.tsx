"use client";

import { useRouter } from "next/navigation";
import { useLang } from "@/components/lang-provider";
import { LANGS, langLabel, writeLangCookie, type Lang } from "@/lib/i18n/config";

// Language pills. Sets the cookie and re-renders the tree server-side, so
// every surface switches at once. The billing pages (SPEC.md §24) draw the
// pills on a track in their own colors: light on a Unitos Premium page,
// night on a Unitos Ultra page.
export function LangSwitcher({ tone = "app" }: { tone?: "app" | "billing" }) {
  const router = useRouter();
  const active = useLang();

  function choose(lang: Lang) {
    if (lang === active) return;
    writeLangCookie(lang);
    router.refresh();
  }

  const pill = (lang: Lang) =>
    tone === "billing"
      ? active === lang
        ? "bg-(--bl-pill) font-bold text-(--bl-title) shadow-(--bl-pill-shadow)"
        : "font-semibold text-(--bl-muted) hover:text-(--bl-link)"
      : active === lang
        ? "bg-ink font-semibold text-paper"
        : "bg-card font-semibold text-sand-600 shadow-soft hover:text-clay-800";

  return (
    <div className={`flex gap-1 ${tone === "billing" ? "rounded-full bg-(--bl-track) p-[3px]" : ""}`}>
      {LANGS.map((lang) => (
        <button
          key={lang}
          onClick={() => choose(lang)}
          aria-pressed={active === lang}
          className={`rounded-full px-3 py-1 text-xs ${pill(lang)}`}
        >
          {langLabel(lang)}
        </button>
      ))}
    </div>
  );
}
