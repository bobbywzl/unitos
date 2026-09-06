"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/api";
import type { Lang } from "@/lib/i18n/config";

// Glossary definitions in the reader's language (SPEC.md §8 Phase 7). The page
// renders this when the pane's document has a glossary with an entry that has
// no definition in the reader's language: it asks the glossary route for them
// once per browser session per language, then refreshes so the hover text
// shows them. Renders nothing. A failure is silent: the term keeps its hover
// without a definition, and nothing asks again this session.
export function GlossaryLanguage({ documentId, lang }: { documentId: string; lang: Lang }) {
  const router = useRouter();
  useEffect(() => {
    const key = `unitos-glossary-lang:${documentId}:${lang}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // storage unavailable: ask once per mount
    }
    api(`/api/documents/${documentId}/glossary`, "POST", { lang })
      .then(() => router.refresh())
      .catch((err: unknown) => console.warn("Glossary language failed:", err));
  }, [documentId, lang, router]);
  return null;
}
