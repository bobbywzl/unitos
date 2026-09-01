"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isImeKey } from "@/lib/ime";
import type { SearchHit } from "@/lib/embeddings";
import { SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

// The project search bubble: it expands under the search icon beside the
// assistant button, half transparent over the article. Type a question or a
// phrase and the best-matching passages across every attached document list
// below, by meaning (substring matching without OPENAI_API_KEY). Clicking a
// passage opens its document and flashes the block (?block=). The bubble
// hides with the article menu once the reader scrolls. State lives here so a
// reopened bubble keeps its last query; the search icon and the open state
// live in the article menu (reader-interactions.tsx).
export function ProjectSearch({
  notebookId,
  open,
  onClose,
}: {
  notebookId: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);

  // A click outside the bubble and the search icon (both carry
  // data-project-search) closes the bubble.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-project-search]")) return;
      onClose();
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [open, onClose]);

  // The change handler resets state; this effect only debounces the fetch.
  function onQueryChange(value: string) {
    setQuery(value);
    const trimmed = value.trim();
    setBusy(trimmed.length >= 2);
    if (trimmed.length < 2) setHits(null);
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const result = await api<{ hits: SearchHit[] }>("/api/search", "POST", {
          notebookId,
          query: trimmed,
        });
        if (requestId.current === id) setHits(result.hits);
      } catch {
        if (requestId.current === id) setHits([]);
      } finally {
        if (requestId.current === id) setBusy(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [query, notebookId]);

  if (!open) return null;

  return (
    <div
      data-project-search
      className="pop-in pointer-events-auto flex w-full max-w-[400px] origin-top-left flex-col gap-2 rounded-[24px] bg-card/55 p-3 shadow-float backdrop-blur-md"
    >
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (isImeKey(e)) return;
            if (e.key === "Escape") onClose();
          }}
          placeholder={t("panes.searchProject")}
          aria-label={t("panes.searchProject")}
          className="w-full rounded-full bg-paper/70 px-4 py-2 text-[13px] outline-none placeholder:text-sand-500"
        />
        {busy && <SpinnerIcon size={16} className="shrink-0 animate-spin text-sand-500" />}
      </div>

      {hits !== null && hits.length === 0 && !busy && (
        <p className="px-1 text-[13px] text-sand-600">
          {t("panes.searchNoMatches", { query: query.trim() })}
        </p>
      )}

      {hits !== null && hits.length > 0 && (
        <div className="flex max-h-[min(420px,60vh)] flex-col overflow-y-auto">
          {hits.map((hit) => (
            <button
              key={hit.blockId}
              onClick={() => {
                onClose();
                router.push(`/n/${notebookId}?doc=${hit.documentId}&block=${hit.blockId}`);
              }}
              className="flex flex-col gap-0.5 rounded-xl px-2.5 py-2 text-left hover:bg-clay-100/70"
            >
              <span className="text-[11px] font-semibold text-clay-800">{hit.documentTitle}</span>
              <span className="line-clamp-2 text-[12.5px] leading-snug text-sand-700">
                {hit.text}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
