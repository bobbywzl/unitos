"use client";

import { useEffect, useRef, useState } from "react";
import { SpinnerIcon } from "@/components/icons";
import { useLang, useT } from "@/components/lang-provider";
import { htmlLangOf, type Lang } from "@/lib/i18n/config";
import { detectLang, langNameIn } from "@/lib/translate/detect";

// The Translate offer (SPEC.md §19): shown when the reader's language is not
// the document's — a Chinese document open in the English reader, an English
// transcript in the Chinese reader. One click translates the whole document
// through DeepL; each block's translation then reads under the block, and
// the choice is remembered per document in this browser.
type Status = "idle" | "loading" | "shown" | "hidden";

function storageKey(documentId: string): string {
  return `unitos-translate-${documentId}`;
}

function remembered(documentId: string): boolean {
  try {
    return localStorage.getItem(storageKey(documentId)) === "on";
  } catch {
    return false;
  }
}

function remember(documentId: string, on: boolean) {
  try {
    if (on) localStorage.setItem(storageKey(documentId), "on");
    else localStorage.removeItem(storageKey(documentId));
  } catch {
    // A blocked store only loses the memory of the choice.
  }
}

export function TranslationBar({
  documentId,
  text,
  available,
  onTranslations,
}: {
  documentId: string;
  /** The document's text, or enough of it to tell its language. */
  text: string;
  /** DEEPL_API_KEY is set on the server. */
  available: boolean;
  onTranslations: (translations: Record<string, string> | null) => void;
}) {
  const ui = useLang();
  const t = useT();
  const detected = detectLang(text);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<Record<string, string> | null>(null);
  const offer = available && detected !== ui;

  // A document translated before shows its translation again on open, from
  // the cache — no DeepL call.
  useEffect(() => {
    if (!offer || !remembered(documentId)) return;
    let cancelled = false;
    const restore = async () => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/documents/${documentId}/translate?lang=${ui}`);
        const body = (await res.json().catch(() => null)) as
          | { translations?: Record<string, string>; complete?: boolean }
          | null;
        if (cancelled) return;
        if (res.ok && body?.translations && body.complete) {
          cache.current = body.translations;
          onTranslations(body.translations);
          setStatus("shown");
        } else {
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("idle");
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, ui, offer]);

  if (!offer) return null;

  async function translate() {
    if (status === "loading") return;
    setError(null);
    if (cache.current) {
      onTranslations(cache.current);
      setStatus("shown");
      remember(documentId, true);
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch(`/api/documents/${documentId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: ui }),
      });
      const body = (await res.json().catch(() => null)) as
        | { translations?: Record<string, string>; error?: string }
        | null;
      if (!res.ok || !body?.translations) {
        throw new Error(body?.error ?? t("common.requestFailedStatus", { status: res.status }));
      }
      cache.current = body.translations;
      onTranslations(body.translations);
      setStatus("shown");
      remember(documentId, true);
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : t("panes.translateFailed"));
    }
  }

  function hide() {
    onTranslations(null);
    setStatus("hidden");
    remember(documentId, false);
  }

  const target = langNameIn(ui, ui);
  const pill =
    "rounded-full bg-clay px-3 py-1 text-[11.5px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40";
  const quiet = "rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800";

  return (
    <div
      data-translation-bar
      className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl bg-card px-3.5 py-2 text-[12.5px] text-sand-700 shadow-soft print:hidden"
    >
      <span>
        {detected
          ? t("panes.documentIsIn", { language: langNameIn(detected, ui) })
          : t("panes.documentOtherLanguage")}
      </span>
      {status === "loading" ? (
        <span className="flex items-center gap-1.5 text-sand-600">
          <SpinnerIcon size={12} className="text-clay motion-safe:animate-spin" />
          {t("panes.translating")}
        </span>
      ) : status === "shown" ? (
        <>
          <span className="text-sand-500">{t("panes.translatedBy")}</span>
          <button onClick={hide} data-track="translate-hide" className={quiet}>
            {t("panes.hideTranslation")}
          </button>
        </>
      ) : (
        <button
          onClick={() => void translate()}
          data-track="translate"
          data-tip={t("panes.translateTitle", { language: target })}
          className={pill}
        >
          {status === "hidden"
            ? t("panes.showTranslation")
            : t("panes.translateTo", { language: target })}
        </button>
      )}
      {error && <span className="text-red-500">{error}</span>}
    </div>
  );
}

// One block's translation, under the block (SPEC.md §19).
export function TranslationLine({ text, lang }: { text: string; lang: Lang }) {
  return (
    <p className="translation-line" lang={htmlLangOf(lang)} data-translation>
      {text}
    </p>
  );
}
