"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isImeKey } from "@/lib/ime";
import type { SearchHit } from "@/lib/embeddings";
import { SearchIcon, SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

// Project search in the workspace header: type a question or a phrase and the
// best-matching passages across every attached document list below, by
// meaning (substring matching without OPENAI_API_KEY). Clicking a passage
// opens its document and flashes the block (?block=).
export function ProjectSearch({ notebookId }: { notebookId: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [open]);

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

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        aria-label={t("panes.searchProject")}
        aria-expanded={open}
        title={t("panes.searchProjectTitle")}
        className={`flex size-[38px] items-center justify-center rounded-full hover:bg-clay-100 hover:text-clay-800 ${open ? "bg-clay-100 text-clay-800" : "text-sand-600"}`}
      >
        <SearchIcon size={18} />
      </button>

      {open && (
        <div className="absolute top-[46px] right-0 z-40 flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2 rounded-2xl bg-card p-3 shadow-float">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (isImeKey(e)) return;
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder={t("panes.searchProject")}
              aria-label={t("panes.searchProject")}
              className="w-full rounded-full bg-paper px-4 py-2 text-[13px] outline-none placeholder:text-sand-500"
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
                    setOpen(false);
                    router.push(`/n/${notebookId}?doc=${hit.documentId}&block=${hit.blockId}`);
                  }}
                  className="flex flex-col gap-0.5 rounded-xl px-2.5 py-2 text-left hover:bg-clay-100"
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
      )}
    </div>
  );
}
