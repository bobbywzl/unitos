"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ContentsEntry } from "@/lib/contents";
import { ContentsIcon, SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";

// Contents (SPEC.md §26): the button at the top left of the article, in the
// article menu's place, and the list it opens — the article's parts, each a
// jump to the block it starts at. The parts are built the first time the
// list opens (POST /api/documents/[documentId]/contents, one model call,
// stored on the document) and answered as stored after. A click on a part
// scrolls the reader to its block and flashes it (dissect:flash-block).
// The button and the list hide with the article menu once the reader
// scrolls (reader-interactions.tsx atTop). The parts are kept per document
// for the browser tab, so a reopen shows them at once.

type Loaded = { parts: ContentsEntry[]; fallback: boolean };
const loaded = new Map<string, Loaded>();

export function ContentsMenu({
  documentId,
  open,
  onOpenChange,
}: {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  // What this tab has for the document: the stored answer, or the answer
  // of the attempt in hand. Try again starts a new attempt, which reads
  // nothing from the cache. busy is derived: open with nothing to show and
  // no failure means the request is running.
  const [fetched, setFetched] = useState<{ id: string; attempt: number; data: Loaded } | null>(null);
  const [failure, setFailure] = useState<{ id: string; attempt: number; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const state =
    fetched?.id === documentId && fetched.attempt === attempt
      ? fetched.data
      : attempt === 0
        ? (loaded.get(documentId) ?? null)
        : null;
  const error = failure?.id === documentId && failure.attempt === attempt ? failure.message : null;
  const busy = open && !state && !error;

  // The parts load when the list opens, once per document per tab.
  useEffect(() => {
    if (!open || state || error) return;
    let live = true;
    api<{ parts: ContentsEntry[]; fallback: boolean }>(`/api/documents/${documentId}/contents`, "POST", {})
      .then((result) => {
        if (!live) return;
        const next = { parts: result.parts, fallback: result.fallback };
        loaded.set(documentId, next);
        setFetched({ id: documentId, attempt, data: next });
      })
      .catch((err: unknown) => {
        if (!live) return;
        setFailure({
          id: documentId,
          attempt,
          message: err instanceof Error ? err.message : t("common.requestFailed"),
        });
      });
    return () => {
      live = false;
    };
  }, [open, documentId, attempt, state, error, t]);

  // A click outside the list and the button (both carry data-contents)
  // closes the list.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-contents]")) return;
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  function jump(blockId: string) {
    onOpenChange(false);
    window.dispatchEvent(new CustomEvent("dissect:flash-block", { detail: { blockId } }));
  }

  return (
    <>
      <button
        data-contents
        data-track="contents"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        data-tip={t("reader.contentsTitle")}
        className={`pointer-events-auto flex items-center gap-1.5 rounded-full bg-card px-3 py-2 text-[12px] font-semibold shadow-float ${
          open ? "text-clay-800" : "text-clay-800 hover:text-clay-600"
        }`}
      >
        <ContentsIcon size={13} />
        {t("reader.contents")}
      </button>
      <Presence show={open} exit="pop">
        {open && (
          <nav
            data-contents
            aria-label={t("reader.contents")}
            className="pop-in pointer-events-auto flex w-full max-w-[400px] origin-top-left flex-col rounded-[24px] bg-card/85 py-2 shadow-float backdrop-blur-md"
          >
            {busy && (
              <p className="flex items-center gap-2 px-4 py-2 text-[12.5px] text-sand-600">
                <SpinnerIcon size={14} className="animate-spin" />
                {t("reader.contentsBuilding")}
              </p>
            )}
            {!busy && error && (
              <p className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12.5px] text-red-600">
                {t("reader.contentsFailed", { reason: error })}
                <button
                  onClick={() => setAttempt((n) => n + 1)}
                  data-track="contents-retry"
                  className="rounded-full bg-sand-100 px-2.5 py-0.5 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  {t("reader.contentsRetry")}
                </button>
              </p>
            )}
            {!busy && !error && state && state.parts.length === 0 && (
              <p className="px-4 py-2 text-[12.5px] text-sand-600">{t("reader.contentsEmpty")}</p>
            )}
            {!busy && !error && state && state.parts.length > 0 && (
              <ol className="flex max-h-[min(480px,60vh)] flex-col overflow-y-auto">
                {state.parts.map((part, i) => (
                  <li key={`${part.blockId}:${i}`}>
                    <a
                      href={`#block-${part.blockId}`}
                      onClick={(e) => {
                        e.preventDefault();
                        jump(part.blockId);
                      }}
                      data-track="contents-part"
                      data-tip={t("reader.contentsPartTitle", { title: part.title })}
                      className={`block truncate py-1.5 pr-4 text-left text-[12.5px] hover:bg-clay-100/70 hover:text-clay-800 ${
                        part.level === 2 ? "pl-8 text-sand-700" : "pl-4 font-semibold text-sand-800"
                      }`}
                    >
                      {part.title}
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </nav>
        )}
      </Presence>
    </>
  );
}
