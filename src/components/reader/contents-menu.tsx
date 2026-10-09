"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ContentsEntry } from "@/lib/contents";
import { useEscapeLayer } from "@/lib/escape-layers";
import { useCollab } from "@/components/collab/collab-context";
import { ContentsIcon, SparkleIcon, SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";
import { StopPill } from "@/components/thinking";

// Contents (SPEC.md §26): the button at the top left of the article, in the
// article menu's place, and the list it opens — the article's parts, each a
// jump to the block it starts at. Two clicks make the contents: Contents
// opens the list, and with none stored it shows the article's own headings
// first and Generate contents as one row at the foot (what AI does and the
// disclaimer in its tooltip); with no headings it asks whether to generate
// them — one line on what AI writes, the Generate contents button, and the
// disclaimer that AI-written parts may be off. Generate contents runs
// the one model call (POST /api/documents/[documentId]/contents
// {generate: true}) and stores the parts. While it runs the button reads
// Stop: a press ends the request and the model call, and nothing is
// stored. Stored parts show at once, under
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

/** The article's own headings, read from the page (block-view.tsx draws a
    HEADING block as h1–h6 with its id): what the read answers when nothing
    is stored, so the list draws at the press instead of after the read. A
    first heading that stands above every other heading is the title, as
    lib/contents.ts reads it. */
function headingsOnPage(documentId: string): ContentsEntry[] | null {
  if (typeof document === "undefined") return null;
  const root = document.querySelector(`[data-document-id="${CSS.escape(documentId)}"]`);
  if (!root) return null;
  const blocks = [...root.querySelectorAll<HTMLElement>("[data-block-id]")];
  const depth = (el: HTMLElement) => (/^H([1-6])$/.exec(el.tagName) ? Number(el.tagName[1]) : null);
  const headings = blocks.filter((el) => depth(el) !== null && (el.textContent ?? "").trim() !== "");
  const top = blocks[0] && depth(blocks[0]) !== null ? blocks[0] : null;
  const title = top && headings.slice(1).every((el) => depth(el)! > depth(top)!) ? top : null;
  const out: ContentsEntry[] = [];
  let hasTop = false;
  for (const el of headings) {
    if (el === title) continue;
    const level: 1 | 2 = depth(el)! >= 3 && hasTop ? 2 : 1;
    if (level === 1) hasTop = true;
    out.push({ title: (el.textContent ?? "").trim().slice(0, 200), blockId: el.dataset.blockId ?? "", level });
    if (out.length >= 80) break;
  }
  return out.length > 0 ? out : null;
}

/** A document's contents for this tab, read when `open` turns on, and
    Generate contents: the Contents menu's, and the page editor's tabs &
    outlines panel's (docs/page/outline.tsx). */
export function useContents(documentId: string, open: boolean) {
  const t = useT();
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

  return { state, reading, readError, generating, generateError, generate };
}

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
  const contents = useContents(documentId, open);
  const { readError, generating, generateError, generate } = contents;
  // Before the first read of this tab lands, the headings on the page stand
  // in: the list draws at the press, with no Loading row.
  const onPage = useMemo(
    () => (open && !contents.state ? headingsOnPage(documentId) : null),
    [open, contents.state, documentId],
  );
  const state = contents.state ?? (onPage ? { parts: onPage, generated: false } : null);
  const reading = contents.reading && !onPage;

  // A click outside the list and the button (both carry data-contents)
  // closes the list.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-contents]")) return;
      onOpenChange(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [open, onOpenChange]);
  // Escape closes the list as one layer (lib/escape-layers.ts).
  useEscapeLayer(open, () => onOpenChange(false));

  // A part lands on the core of a collapsed block (SPEC.md §28).
  function jump(blockId: string) {
    onOpenChange(false);
    window.dispatchEvent(new CustomEvent("dissect:flash-block", { detail: { blockId, part: true } }));
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
            className="pop-in pointer-events-auto flex w-full max-w-[400px] origin-top-left flex-col gap-2 rounded-[24px] bg-card py-3 shadow-float"
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

            {/* Nothing stored, the article has headings: the headings
                first, for the reader who came to jump, then Generate
                contents as one row at the foot, what AI does and the
                disclaimer in its tooltip (NAV13-07). */}
            {state && !state.generated && state.parts.length > 0 && (
              <>
                {list(state.parts)}
                <div className="border-t border-line px-2 pt-2">
                  {canEdit ? (
                    <button
                      onClick={() => void generate()}
                      data-track={generating ? "contents-stop" : "contents-generate"}
                      data-tip={
                        generating
                          ? t("reader.contentsStopTitle")
                          : `${t("reader.contentsGenerateTitle")} ${t("reader.contentsDisclaimer")}`
                      }
                      className="flex w-full items-center gap-1.5 rounded-full px-2 py-1.5 text-left text-[12px] font-semibold text-clay-800 hover:bg-clay-100/70"
                    >
                      {generating ? <SpinnerIcon size={13} className="animate-spin" /> : <SparkleIcon size={13} />}
                      {t(generating ? "reader.contentsBuilding" : "reader.contentsGenerate")}
                      {generating && <StopPill />}
                    </button>
                  ) : (
                    <p className="px-2 text-[11px] leading-snug text-sand-500">{t("reader.contentsViewer")}</p>
                  )}
                  {generateError && (
                    <p className="px-2 pt-1 text-[12px] leading-snug text-red-600">
                      {t("reader.contentsFailed", { reason: generateError })}
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Nothing stored, no headings: the ask, the Generate contents
                button, the disclaimer. */}
            {state && !state.generated && state.parts.length === 0 &&
              (canEdit ? (
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
              ))}
          </nav>
        )}
      </Presence>
    </>
  );
}
