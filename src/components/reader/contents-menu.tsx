"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ContentsEntry } from "@/lib/contents";
import { useCollab } from "@/components/collab/collab-context";
import { ContentsIcon, SparkleIcon, SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";
import { StopPill } from "@/components/thinking";

// Contents (SPEC.md §26): the button at the top left of the article, in the
// article menu's place, and the list it opens — the article's parts, each a
// jump to the block it starts at. Two clicks make the contents: Contents
// opens the list, and with none stored the list asks whether to generate
// them — one line on what AI writes, the Generate contents button, and the
// disclaimer that AI-written parts may be off — and Generate contents runs
// the one model call (POST /api/documents/[documentId]/contents
// {generate: true}) and stores the parts. While it runs the button reads
// Stop: a press ends the request and the model call, and nothing is stored. Until then the list shows the
// article's own headings, when it has any. Stored parts show at once, under
// the disclaimer. A click on a part scrolls the reader to its block and
// flashes it (dissect:flash-block). The button stays at the top left of the
// pane as the article scrolls (reader-interactions.tsx articleMenu). The
// parts are kept per document for the browser tab, so a reopen shows them
// at once, and read again on every open: a re-parse gives the blocks new
// ids and carries the parts onto them (lib/contents.ts), so the kept list
// is replaced by the stored one as soon as it answers.

// generated: the parts are the stored, AI-written contents. false: the
// article's headings stand in, and nothing is stored.
type Loaded = { parts: ContentsEntry[]; generated: boolean };
const loaded = new Map<string, Loaded>();

type Answer = { parts: ContentsEntry[]; fallback: boolean };
const toLoaded = (answer: Answer): Loaded => ({ parts: answer.parts, generated: !answer.fallback });

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
  const { canEdit } = useCollab();
  // What this tab has for the document: the stored answer, or the answer
  // of the read or the generation in hand. reading is derived: open with
  // nothing to show and no failure means the read is running.
  const [fetched, setFetched] = useState<{ id: string; data: Loaded } | null>(null);
  const [readFailure, setReadFailure] = useState<{ id: string; message: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const state = fetched?.id === documentId ? fetched.data : (loaded.get(documentId) ?? null);
  const readError = readFailure?.id === documentId ? readFailure.message : null;
  const reading = open && !state && !readError;

  // The stored parts, or the headings, load when the list opens: the kept
  // answer shows at once, and the read replaces it when it lands. No model
  // call: that is Generate contents.
  useEffect(() => {
    if (!open || readError) return;
    let live = true;
    api<Answer>(`/api/documents/${documentId}/contents`, "POST", {})
      .then((answer) => {
        if (!live) return;
        const next = toLoaded(answer);
        loaded.set(documentId, next);
        setFetched({ id: documentId, data: next });
      })
      .catch((err: unknown) => {
        if (!live || loaded.has(documentId)) return;
        setReadFailure({ id: documentId, message: err instanceof Error ? err.message : t("common.requestFailed") });
      });
    return () => {
      live = false;
    };
  }, [open, documentId, readError, t]);

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

  // The generation on its way: the button's Stop ends it, and so does
  // leaving the document.
  const generateAbort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      generateAbort.current?.abort();
      generateAbort.current = null;
    },
    [documentId],
  );

  // The second click: the one model call that writes and stores the parts.
  // While it runs, a press is Stop.
  async function generate() {
    if (generating) {
      generateAbort.current?.abort();
      return;
    }
    setGenerating(true);
    setGenerateError(null);
    const controller = new AbortController();
    generateAbort.current = controller;
    try {
      const answer = await api<Answer>(
        `/api/documents/${documentId}/contents`,
        "POST",
        { generate: true },
        { signal: controller.signal },
      );
      const next = toLoaded(answer);
      loaded.set(documentId, next);
      setFetched({ id: documentId, data: next });
    } catch (err) {
      // Stopped, not failed: no message.
      if (controller.signal.aborted) return;
      setGenerateError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      if (generateAbort.current === controller) generateAbort.current = null;
      setGenerating(false);
    }
  }

  function jump(blockId: string) {
    onOpenChange(false);
    window.dispatchEvent(new CustomEvent("dissect:flash-block", { detail: { blockId } }));
  }

  const note = "px-4 text-[12px] leading-snug text-sand-600";
  const disclaimer = "px-4 text-[11px] leading-snug text-sand-500";

  const list = (parts: ContentsEntry[]) => (
    <ol className="flex max-h-[min(480px,60vh)] flex-col overflow-y-auto">
      {parts.map((part, i) => (
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
  );

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
            className="pop-in pointer-events-auto flex w-full max-w-[400px] origin-top-left flex-col gap-2 rounded-[24px] bg-card/85 py-3 shadow-float backdrop-blur-md"
          >
            {reading && (
              <p className={`flex items-center gap-2 ${note}`}>
                <SpinnerIcon size={14} className="animate-spin" />
                {t("common.loading")}
              </p>
            )}
            {readError && <p className={`${note} text-red-600`}>{readError}</p>}

            {/* Stored, AI-written parts: the disclaimer, then the list. */}
            {state?.generated && (
              <>
                <p className={disclaimer}>{t("reader.contentsDisclaimer")}</p>
                {state.parts.length > 0 ? list(state.parts) : <p className={note}>{t("reader.contentsEmpty")}</p>}
              </>
            )}

            {/* Nothing stored: ask, the Generate contents button, the
                disclaimer; the headings below, when the article has any. */}
            {state && !state.generated && (
              <>
                {canEdit ? (
                  <>
                    <p className={note}>{t("reader.contentsAsk")}</p>
                    <div className="px-4">
                      <button
                        onClick={() => void generate()}
                        data-track={generating ? "contents-stop" : "contents-generate"}
                        data-tip={t(generating ? "reader.contentsStopTitle" : "reader.contentsGenerateTitle")}
                        className="flex items-center gap-1.5 rounded-full bg-clay px-3.5 py-1.5 text-[12px] font-semibold text-clay-fg hover:bg-clay-600"
                      >
                        {generating ? <SpinnerIcon size={13} className="animate-spin" /> : <SparkleIcon size={13} />}
                        {t(generating ? "reader.contentsBuilding" : "reader.contentsGenerate")}
                        {generating && <StopPill />}
                      </button>
                    </div>
                    {generateError && (
                      <p className={`${note} text-red-600`}>{t("reader.contentsFailed", { reason: generateError })}</p>
                    )}
                    <p className={disclaimer}>{t("reader.contentsDisclaimer")}</p>
                  </>
                ) : (
                  <p className={note}>{t("reader.contentsViewer")}</p>
                )}
                {state.parts.length > 0 && (
                  <>
                    <p className={`${disclaimer} mt-1 border-t border-line pt-2`}>{t("reader.contentsHeadingsNote")}</p>
                    {list(state.parts)}
                  </>
                )}
              </>
            )}
          </nav>
        )}
      </Presence>
    </>
  );
}
