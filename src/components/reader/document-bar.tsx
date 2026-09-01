"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isImeKey } from "@/lib/ime";
import { useCollab } from "@/components/collab/collab-context";
import { ChevronDownIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Logo } from "@/components/logo";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { readNdjson } from "@/lib/ndjson";
import { PARSER_VERSION } from "@/lib/parse/types";
import {
  MAX_VIDEO_BYTES,
  MEDIA_EXTENSIONS,
  UPLOAD_CHUNK_BYTES,
  isMediaUrl,
} from "@/lib/video/types";
import { parseYouTubeId } from "@/lib/video/youtube";
import {
  IngestProgress,
  advanceIngestSteps,
  completeIngestSteps,
  initialIngestSteps,
  type IngestStep,
} from "@/components/reader/ingest-progress";

export type AttachedDocument = {
  id: string;
  title: string;
  sourceUrl: string | null;
  parserVersion: number;
  hasFile: boolean;
  hasVideo: boolean; // video documents never re-parse (SPEC.md §11)
  handwritten: boolean; // pages, not text blocks; the menu flips the shape (SPEC.md §14)
};
type LibraryDocument = { id: string; title: string; _count: { blocks: number } };
type IngestPhase = { fileLabel: string; steps: IngestStep[] };
// Wire format from /api/documents: a stage event per line, then one terminal line.
type IngestEvent =
  | { stage: string; detail?: string }
  | { id: string; title: string; deduped: boolean }
  | { error: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Platform errors (Vercel 413, crashed function) return empty or non-JSON bodies.
async function readJson<T>(res: Response): Promise<T | null> {
  return res.json().catch(() => null) as Promise<T | null>;
}

function statusMessage(t: TFunc, status: number): string {
  if (status === 413) return t("panes.uploadTooLarge");
  return t("panes.requestFailedStatus", { status });
}

// Vercel caps a request body at about 4.5 MB, so bigger files upload in chunks
// (/api/uploads) and /api/uploads/complete assembles them. The server caps
// assembled PDFs at 50 MB and videos at 200 MB. Videos always take the chunked
// path — one code path, and the server keeps the staged chunks as the stored
// video bytes.
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const SINGLE_REQUEST_BYTES = 4 * 1024 * 1024;
const CHUNK_BYTES = UPLOAD_CHUNK_BYTES;

// Video and audio files share one path: chunked upload, sniffed server-side,
// stored as a media document with the transcript machinery (SPEC.md §11).
function isMediaFile(file: File): boolean {
  return (
    file.type.startsWith("video/") ||
    file.type.startsWith("audio/") ||
    MEDIA_EXTENSIONS.test(file.name)
  );
}

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

// Documents in the header: one pill showing the open document, expanding a
// vertical document list on hover or click. Everything that adds or removes
// one stays folded behind the dashed +.
export function DocumentBar({
  notebookId,
  documents,
  activeId,
}: {
  notebookId: string;
  documents: AttachedDocument[];
  activeId: string | null;
}) {
  const { canEdit } = useCollab();
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<IngestPhase | null>(null);
  const [menu, setMenu] = useState<null | "root" | "url" | "video" | "library">(null);
  // The document list: opens on hover or click, closes on leave (after a
  // grace period), outside click, Escape, or opening a document.
  const listRef = useRef<HTMLDivElement>(null);
  const listCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // Per-document actions, expanded inline under the document's row.
  const [pillMenu, setPillMenu] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [library, setLibrary] = useState<LibraryDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (menu === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImeKey(e)) setMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  // Hover keeps the list open across the gap between pill and list; leaving
  // both closes it after a grace period.
  function openList() {
    if (listCloseTimer.current) {
      clearTimeout(listCloseTimer.current);
      listCloseTimer.current = null;
    }
    setListOpen(true);
  }
  function closeList() {
    if (listCloseTimer.current) {
      clearTimeout(listCloseTimer.current);
      listCloseTimer.current = null;
    }
    setListOpen(false);
    setPillMenu(null);
  }
  function scheduleCloseList() {
    if (listCloseTimer.current) clearTimeout(listCloseTimer.current);
    listCloseTimer.current = setTimeout(closeList, 220);
  }
  useEffect(() => () => {
    if (listCloseTimer.current) clearTimeout(listCloseTimer.current);
  }, []);

  useEffect(() => {
    if (!listOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!listRef.current?.contains(e.target as Node)) closeList();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImeKey(e)) closeList();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [listOpen]);

  // The open document's row is the visible one when the list opens.
  useEffect(() => {
    if (!listOpen) return;
    listRef.current
      ?.querySelector<HTMLElement>("[data-active-row]")
      ?.scrollIntoView({ block: "nearest" });
  }, [listOpen]);

  // Opening a document keeps the reader view: view and doc2 ride along.
  function open(docId: string) {
    const params = new URLSearchParams();
    params.set("doc", docId);
    const view = searchParams.get("view");
    const doc2 = searchParams.get("doc2");
    if (view) params.set("view", view);
    if (doc2) params.set("doc2", doc2);
    router.push(`/n/${notebookId}?${params.toString()}`);
  }

  // Re-parse with the current parser. Runs automatically when the open document
  // was parsed by an older pipeline, and manually from the + menu.
  const reparseAttempted = useRef(new Set<string>());
  const active = documents.find((d) => d.id === activeId) ?? null;
  const activeStale =
    active !== null &&
    !active.hasVideo &&
    !active.handwritten &&
    (active.sourceUrl !== null || active.hasFile) &&
    active.parserVersion < PARSER_VERSION;

  // Manual re-parse: the progress card shows, errors show.
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectNotice, setConnectNotice] = useState<string | null>(null);
  // The recommended-links scan, on demand — for documents added before the
  // scan existed (SPEC.md §13).
  async function recommendLinks(doc: AttachedDocument) {
    if (connecting) return;
    setConnecting(doc.id);
    setConnectNotice(null);
    setError(null);
    try {
      const result = await api<{ linkCount: number }>(`/api/documents/${doc.id}/connect`, "POST", {
        notebookId,
      });
      setConnectNotice(
        result.linkCount > 0
          ? t("panes.recommendLinksDone", { n: result.linkCount })
          : t("panes.recommendLinksNone"),
      );
      setTimeout(() => setConnectNotice(null), 4000);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setConnecting(null);
    }
  }

  // `as` flips a PDF between article and handwritten pages (SPEC.md §14) —
  // the escape hatch when Import PDF judged it wrong. Absent = plain re-parse.
  async function reparse(doc: AttachedDocument, as?: "article" | "handwritten") {
    setError(null);
    try {
      await runIngest(doc.title, doc.sourceUrl && !as ? "url" : "pdf", () =>
        fetch(`/api/documents/${doc.id}/reparse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(as ? { as } : {}),
        }),
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("panes.reparseFailed"));
    } finally {
      setPhase(null);
    }
  }

  // Automatic upgrade re-parse: the document already reads fine, so no
  // progress card and no error banner — the reader never waits on it. Success
  // swaps the upgraded blocks in with a refresh; failure logs and leaves the
  // old parse standing until the next open tries again.
  async function reparseSilently(doc: AttachedDocument) {
    try {
      const res = await fetch(`/api/documents/${doc.id}/reparse`, { method: "POST" });
      if (!res.ok || !res.body) return;
      let result: IngestEvent | null = null;
      for await (const event of readNdjson<IngestEvent>(res)) {
        if (!("stage" in event)) result = event;
      }
      if (result && "id" in result) router.refresh();
      else if (result && "error" in result) console.warn("[reparse] upgrade failed:", result.error);
    } catch (err) {
      console.warn("[reparse] upgrade failed:", err);
    }
  }

  useEffect(() => {
    if (!activeStale || active === null || phase !== null) return;
    if (reparseAttempted.current.has(active.id)) return;
    reparseAttempted.current.add(active.id);
    void reparseSilently(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeStale]);

  // Drives one ingest call: seeds the progress card, streams stage events into it,
  // and resolves with the terminal result. Shared by PDF upload and URL ingestion below.
  // send gets an emit callback so a chunked upload can report progress before the
  // server response starts streaming.
  async function runIngest(
    fileLabel: string,
    kind: "pdf" | "url" | "video" | "youtube" | "media",
    send: (emit: (stage: string, detail?: string) => void) => Promise<Response>,
  ): Promise<{ id: string; title: string; deduped: boolean }> {
    setPhase({ fileLabel, steps: initialIngestSteps(kind) });
    const emit = (stage: string, detail?: string) =>
      setPhase((p) => (p ? { ...p, steps: advanceIngestSteps(p.steps, stage, detail) } : p));
    const res = await send(emit);
    if (!res.ok) {
      const detail = await readJson<{ error?: string }>(res);
      throw new Error(detail?.error ?? statusMessage(t, res.status));
    }
    let result: IngestEvent | null = null;
    for await (const event of readNdjson<IngestEvent>(res)) {
      if ("stage" in event) {
        emit(event.stage, event.detail);
      } else {
        result = event;
      }
    }
    if (!result || "error" in result) {
      throw new Error(result && "error" in result ? result.error : t("panes.uploadFailed"));
    }
    setPhase((p) => (p ? { ...p, steps: completeIngestSteps(p.steps) } : p));
    await sleep(250); // let the last checkmark register before the pill clears
    return result;
  }

  // Chunked upload for files past the single-request cap. Sends slices to
  // /api/uploads, reports progress on the receive step, then asks
  // /api/uploads/complete to assemble and ingest — its response streams the
  // same stage events as /api/documents.
  async function uploadChunked(
    file: File,
    kind: "pdf" | "video",
    emit: (stage: string, detail?: string) => void,
  ) {
    const uploadId = crypto.randomUUID();
    const totalLabel = megabytes(file.size);
    for (let sent = 0; sent < file.size; sent += CHUNK_BYTES) {
      const index = Math.floor(sent / CHUNK_BYTES);
      const res = await fetch(`/api/uploads?uploadId=${uploadId}&index=${index}`, {
        method: "POST",
        body: file.slice(sent, sent + CHUNK_BYTES),
      });
      if (!res.ok) {
        const detail = await readJson<{ error?: string }>(res);
        throw new Error(detail?.error ?? statusMessage(t, res.status));
      }
      emit(
        "receive",
        t("panes.uploadProgress", {
          sent: megabytes(Math.min(sent + CHUNK_BYTES, file.size)),
          total: totalLabel,
        }),
      );
    }
    return fetch("/api/uploads/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId, filename: file.name, notebookId, kind }),
    });
  }

  async function uploadFiles(files: File[]) {
    setError(null);
    let lastId: string | null = null;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const media = isMediaFile(file);
        if (media && file.size > MAX_VIDEO_BYTES) {
          throw new Error(t("panes.fileTooLarge", { name: file.name, mb: 200 }));
        }
        if (!media && file.size > MAX_PDF_BYTES) {
          throw new Error(t("panes.fileTooLarge", { name: file.name, mb: 50 }));
        }
        const label = files.length > 1 ? `${file.name} (${i + 1}/${files.length})` : file.name;
        const result = await runIngest(label, media ? "video" : "pdf", (emit) => {
          if (media) return uploadChunked(file, "video", emit);
          if (file.size > SINGLE_REQUEST_BYTES) return uploadChunked(file, "pdf", emit);
          const form = new FormData();
          form.set("file", file);
          form.set("notebookId", notebookId);
          return fetch("/api/documents", { method: "POST", body: form });
        });
        lastId = result.id;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("panes.uploadFailed"));
    } finally {
      setPhase(null);
      if (fileRef.current) fileRef.current.value = "";
      if (videoFileRef.current) videoFileRef.current.value = "";
    }
    if (lastId) {
      open(lastId);
      router.refresh();
    }
  }

  // Drag-and-drop PDF upload: dropping anywhere on the page adds to this work.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      const accepted = files.filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf") || isMediaFile(f),
      );
      if (accepted.length === 0) {
        setError(t("panes.dropPdfOrVideo"));
        return;
      }
      void uploadFiles(accepted);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  // One ingest path for every link: the server routes YouTube links and
  // direct media file links to video documents, everything else to the
  // article parse; this only picks the matching progress steps. Returns
  // whether the document was added and opened.
  async function ingestFromUrl(raw: string): Promise<boolean> {
    const trimmed = raw.trim();
    if (!trimmed) return false;
    setError(null);
    try {
      const kind = parseYouTubeId(trimmed) ? "youtube" : isMediaUrl(trimmed) ? "media" : "url";
      const result = await runIngest(trimmed, kind, () =>
        fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed, notebookId }),
        }),
      );
      open(result.id);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("panes.ingestFailed"));
      return false;
    } finally {
      setPhase(null);
    }
  }

  // The reader's media-figure toast sends its player link here: same ingest
  // path, same progress card, wherever the link comes from.
  useEffect(() => {
    const onAddUrl = (e: Event) => {
      const { url: raw } = (e as CustomEvent<{ url: string }>).detail;
      if (typeof raw === "string" && phase === null) void ingestFromUrl(raw);
    };
    window.addEventListener("dissect:add-document-url", onAddUrl);
    return () => window.removeEventListener("dissect:add-document-url", onAddUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId, phase]);

  async function addUrl() {
    if (await ingestFromUrl(url)) {
      setUrl("");
      setMenu(null);
    }
  }

  // The Upload video menu takes a YouTube link or a direct video or audio
  // file link; files go through the file picker beside it.
  async function addYouTube() {
    const trimmed = videoUrl.trim();
    if (!trimmed) return;
    if (!parseYouTubeId(trimmed) && !isMediaUrl(trimmed)) {
      setError(t("panes.notVideoLink"));
      return;
    }
    if (await ingestFromUrl(trimmed)) {
      setVideoUrl("");
      setMenu(null);
    }
  }

  async function openLibrary() {
    setMenu("library");
    if (!library) {
      const res = await fetch("/api/documents");
      const json = await readJson<LibraryDocument[]>(res);
      if (res.ok && json) setLibrary(json);
      else setError(statusMessage(t, res.status));
    }
  }

  async function attach(documentId: string) {
    await api(`/api/notebooks/${notebookId}/documents`, "POST", { documentId });
    setMenu(null);
    open(documentId);
    router.refresh();
  }

  async function detach(documentId: string) {
    setMenu(null);
    closeList();
    await api(`/api/notebooks/${notebookId}/documents/${documentId}`, "DELETE");
    if (documentId === activeId) router.push(`/n/${notebookId}`);
    router.refresh();
  }

  async function removeFromLibrary(documentId: string) {
    if (!confirm(t("panes.confirmDeleteFromLibrary"))) return;
    setError(null);
    try {
      await api(`/api/documents/${documentId}`, "DELETE");
      setLibrary((prev) => (prev ? prev.filter((d) => d.id !== documentId) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("panes.deleteFailed"));
    }
  }

  const attachedIds = new Set(documents.map((d) => d.id));
  const menuItem =
    "px-4 py-2 text-left text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800";
  const rowAction =
    "px-4 py-1.5 text-left text-[12.5px] text-sand-600 hover:bg-clay-100 hover:text-clay-800";

  return (
    <div className="flex min-w-0 items-center gap-2">
      {documents.length > 0 && (
        <div
          ref={listRef}
          className="relative min-w-0"
          onMouseEnter={openList}
          onMouseLeave={scheduleCloseList}
        >
          <button
            onClick={openList}
            aria-expanded={listOpen}
            aria-label={t("panes.documentList")}
            title={active?.title ?? t("panes.documentList")}
            className="flex max-w-72 min-w-0 items-center gap-1.5 rounded-full bg-ink py-[7px] pr-3 pl-[15px] text-[13px] font-semibold text-paper"
          >
            <span className="truncate">{active ? active.title : t("panes.documentList")}</span>
            <span className="shrink-0 rounded-full bg-paper/20 px-1.5 text-[11px] tabular-nums">
              {documents.length}
            </span>
            <ChevronDownIcon
              size={13}
              className={`shrink-0 text-sand-400 transition-transform duration-150 ${
                listOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {listOpen && (
            <div className="absolute top-full left-0 z-30 mt-2 flex max-h-[min(60vh,480px)] w-80 max-w-[calc(100vw-96px)] flex-col overflow-y-auto overscroll-contain rounded-2xl bg-card py-1.5 shadow-float">
              {documents.map((d) => (
                <div key={d.id} className="flex flex-col">
                  <div className="flex items-center">
                    <button
                      onClick={() => {
                        closeList();
                        open(d.id);
                      }}
                      data-active-row={d.id === activeId || undefined}
                      className={`min-w-0 flex-1 truncate px-4 py-2 text-left text-[13px] ${
                        d.id === activeId
                          ? "font-semibold text-ink"
                          : "text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                      }`}
                      title={d.title}
                    >
                      {d.title}
                    </button>
                    <button
                      onClick={() => setPillMenu(pillMenu === d.id ? null : d.id)}
                      aria-label={t("panes.documentActionsFor", { title: d.title })}
                      aria-expanded={pillMenu === d.id}
                      title={t("panes.documentActions")}
                      className="mr-2 flex size-6 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden
                      >
                        <circle cx="12" cy="5" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="12" cy="19" r="2" />
                      </svg>
                    </button>
                  </div>
                  {pillMenu === d.id && (
                    <div className="mx-2 mb-1.5 flex flex-col rounded-xl bg-sand-100 py-1">
                      {canEdit && !d.hasVideo && !d.handwritten && (d.sourceUrl !== null || d.hasFile) && (
                        <button
                          onClick={() => {
                            closeList();
                            void reparse(d);
                          }}
                          disabled={phase !== null}
                          className={`${rowAction} disabled:opacity-40`}
                          title={t("panes.reparseDocumentTitle")}
                        >
                          {t("panes.reparseDocument")}
                        </button>
                      )}
                      {/* The shape switch (SPEC.md §14): the escape hatch when
                          Import PDF judged this PDF wrong. */}
                      {canEdit && d.handwritten && (
                        <button
                          onClick={() => {
                            closeList();
                            void reparse(d, "article");
                          }}
                          disabled={phase !== null}
                          className={`${rowAction} disabled:opacity-40`}
                          title={t("panes.parseAsArticleTitle")}
                        >
                          {t("panes.parseAsArticle")}
                        </button>
                      )}
                      {canEdit && !d.hasVideo && !d.handwritten && d.hasFile && (
                        <button
                          onClick={() => {
                            closeList();
                            void reparse(d, "handwritten");
                          }}
                          disabled={phase !== null}
                          className={`${rowAction} disabled:opacity-40`}
                          title={t("panes.openAsHandwrittenTitle")}
                        >
                          {t("panes.openAsHandwritten")}
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => {
                            closeList();
                            void recommendLinks(d);
                          }}
                          disabled={connecting !== null}
                          className={`${rowAction} disabled:opacity-40`}
                          title={t("panes.recommendLinksTitle")}
                        >
                          {connecting === d.id ? t("common.working") : t("panes.recommendLinks")}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          closeList();
                          window.print();
                        }}
                        disabled={d.id !== activeId}
                        className={`${rowAction} disabled:opacity-40`}
                        title={
                          d.id === activeId
                            ? t("panes.printDocumentTitle")
                            : t("panes.printDocumentOpenFirst")
                        }
                      >
                        {t("panes.printDocument")}
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => void detach(d.id)}
                          className="px-4 py-1.5 text-left text-[12.5px] text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          title={t("panes.detachDocumentTitle")}
                        >
                          {t("panes.detachDocument")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={menuRef} className={`relative shrink-0 ${canEdit ? "" : "hidden"}`}>
        <button
          onClick={() => setMenu(menu === null ? "root" : null)}
          aria-label={t("panes.addDocument")}
          aria-expanded={menu !== null}
          className="flex size-8 items-center justify-center rounded-full border border-dashed border-sand-400 text-sand-600 hover:bg-clay-100 hover:text-clay-800"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </button>

        {menu !== null && (
          <div className="absolute left-0 z-30 mt-2 w-72 overflow-hidden rounded-2xl bg-card py-1 shadow-float">
            {menu === "root" && (
              <div className="flex flex-col">
                <button
                  onClick={() => {
                    setMenu(null);
                    fileRef.current?.click();
                  }}
                  disabled={phase !== null}
                  className={`${menuItem} disabled:opacity-40`}
                >
                  {t("panes.uploadPdf")}
                </button>
                <button onClick={() => setMenu("video")} className={menuItem}>
                  {t("panes.uploadVideo")}
                </button>
                <button onClick={() => setMenu("url")} className={menuItem}>
                  {t("panes.addUrl")}
                </button>
                <button onClick={() => void openLibrary()} className={menuItem}>
                  {t("panes.library")}
                </button>
              </div>
            )}

            {menu === "video" && (
              <div className="flex flex-col gap-2 p-3">
                <button
                  onClick={() => {
                    setMenu(null);
                    videoFileRef.current?.click();
                  }}
                  disabled={phase !== null}
                  className="rounded-full bg-clay px-4 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                >
                  {t("panes.chooseVideoFile")}
                </button>
                <span className="text-center text-[11px] text-sand-500">
                  {t("panes.videoHint")}
                </span>
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addYouTube();
                  }}
                >
                  <input
                    autoFocus
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=…"
                    aria-label={t("panes.youtubeLink")}
                    className="w-full rounded-full bg-sand-100 px-4 py-2 text-sm outline-none placeholder:text-sand-500"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={phase !== null}
                      className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                    >
                      {t("panes.addVideo")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMenu("root")}
                      className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                    >
                      {t("panes.back")}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {menu === "url" && (
              <form
                className="flex flex-col gap-2 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addUrl();
                }}
              >
                <input
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  aria-label={t("panes.documentUrl")}
                  className="w-full rounded-full bg-sand-100 px-4 py-2 text-sm outline-none placeholder:text-sand-500"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={phase !== null}
                    className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                  >
                    {t("panes.ingest")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenu("root")}
                    className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                  >
                    {t("panes.back")}
                  </button>
                </div>
              </form>
            )}

            {menu === "library" && (
              <ul className="max-h-64 overflow-y-auto py-1">
                {library === null && (
                  <li className="px-4 py-2 text-sm text-sand-500">{t("common.loading")}</li>
                )}
                {library !== null && library.filter((d) => !attachedIds.has(d.id)).length === 0 && (
                  <li className="px-4 py-2 text-sm text-sand-500">
                    {t("panes.noOtherDocuments")}
                  </li>
                )}
                {library
                  ?.filter((d) => !attachedIds.has(d.id))
                  .map((d) => (
                    <li key={d.id} className="flex items-center gap-1 px-1">
                      <button
                        onClick={() => void attach(d.id)}
                        className="min-w-0 flex-1 truncate rounded-full px-3 py-2 text-left text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                      >
                        {d.title}{" "}
                        <span className="text-xs text-sand-500">
                          {t("panes.blockCount", { n: d._count.blocks })}
                        </span>
                      </button>
                      <button
                        onClick={() => void removeFromLibrary(d.id)}
                        className="rounded-full px-2 py-1 text-xs text-sand-400 hover:text-red-500"
                        title={t("panes.deleteFromLibrary")}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {phase && <IngestProgress fileLabel={phase.fileLabel} steps={phase.steps} />}
      {connectNotice && (
        <span className="shrink-0 rounded-full bg-sage-200 px-3 py-1 text-xs font-semibold text-sage-800">
          {connectNotice}
        </span>
      )}
      {error && <span className="text-xs text-red-500">{error}</span>}

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length > 0) void uploadFiles(files);
        }}
      />
      <input
        ref={videoFileRef}
        type="file"
        accept="video/mp4,video/webm,video/ogg,video/quicktime,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/flac,audio/ogg,.mp4,.m4v,.webm,.ogv,.ogg,.mov,.mp3,.m4a,.m4b,.aac,.wav,.flac,.oga,.opus"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length > 0) void uploadFiles(files);
        }}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-paper/90 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-[28px] border-2 border-dashed border-sand-400 bg-card px-14 py-10 shadow-float">
            <Logo size={72} className="text-clay" />
            <p className="text-sm font-semibold text-sand-800">
              {t("panes.dropToAdd")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
