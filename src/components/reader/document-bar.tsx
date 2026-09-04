"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { api } from "@/lib/api";
import type { DriveConfig } from "@/lib/drive/config";
import { pickDriveFiles } from "@/lib/drive/picker-client";
import { parseDriveFileId, type DrivePickedFile } from "@/lib/drive/types";
import { isImeKey } from "@/lib/ime";
import { useCollab } from "@/components/collab/collab-context";
import { ChevronDownIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Logo } from "@/components/logo";
import { Collapse, Presence } from "@/components/presence";
import { LoadingDots, ThinkingIndicator } from "@/components/thinking";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { readNdjson } from "@/lib/ndjson";
import { isOffline, offlinePremium, queueUpload, queueWrite } from "@/lib/offline/queue";
import { PARSER_VERSION } from "@/lib/parse/types";
import { MEDIA_EXTENSIONS, isMediaUrl } from "@/lib/video/types";
import { parseYouTubeId } from "@/lib/video/youtube";
import {
  AddDocumentDialog,
  type AddTab,
  type LibraryDocument,
} from "@/components/reader/add-document-dialog";
import {
  IngestProgress,
  advanceIngestSteps,
  completeIngestSteps,
  initialIngestSteps,
  type IngestStep,
} from "@/components/reader/ingest-progress";
import { UploadAssistant, type UploadRequest } from "@/components/reader/upload-assistant";

export type AttachedDocument = {
  id: string;
  title: string;
  sourceUrl: string | null;
  parserVersion: number;
  hasFile: boolean;
  hasVideo: boolean; // video documents never re-parse (SPEC.md §11)
  handwritten: boolean; // pages, not text blocks; the menu flips the shape (SPEC.md §16)
};
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

// Video and audio files share one path: chunked upload, sniffed server-side,
// stored as a media document with the transcript machinery (SPEC.md §11).
function isMediaFile(file: File): boolean {
  return (
    file.type.startsWith("video/") ||
    file.type.startsWith("audio/") ||
    MEDIA_EXTENSIONS.test(file.name)
  );
}

// Documents in the header: one pill showing the open document, expanding a
// vertical document list on hover or click. Everything that adds one opens
// from the dashed + as the add-document dialog.
export function DocumentBar({
  notebookId,
  documents,
  activeId,
  drive,
}: {
  notebookId: string;
  documents: AttachedDocument[];
  activeId: string | null;
  drive: DriveConfig | null;
}) {
  const { canEdit } = useCollab();
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<IngestPhase | null>(null);
  const [dialog, setDialog] = useState(false);
  // The document list: opens on hover or click, closes on leave (after a
  // grace period), outside click, Escape, or opening a document.
  const listRef = useRef<HTMLDivElement>(null);
  const listCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // Per-document actions, expanded inline under the document's row.
  const [pillMenu, setPillMenu] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Opening a document is a server round trip; the pill shows it is on its way.
  const [opening, startOpening] = useTransition();

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
    startOpening(() => router.push(`/n/${notebookId}?${params.toString()}`));
  }

  // Re-parse with the current parser. Runs automatically when the open document
  // was parsed by an older pipeline, and manually from the document's actions
  // in the document list.
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
  // The running scan, so Stop can abort it.
  const connectAbortRef = useRef<AbortController | null>(null);
  function stopConnect() {
    connectAbortRef.current?.abort();
  }
  // The recommended-links scan, on demand — for documents added before the
  // scan existed (SPEC.md §13).
  async function recommendLinks(doc: AttachedDocument) {
    if (connecting) return;
    setConnecting(doc.id);
    setConnectNotice(null);
    setError(null);
    const controller = new AbortController();
    connectAbortRef.current = controller;
    try {
      const result = await api<{ linkCount: number }>(
        `/api/documents/${doc.id}/connect`,
        "POST",
        { notebookId },
        { signal: controller.signal },
      );
      setConnectNotice(
        result.linkCount > 0
          ? t("panes.recommendLinksDone", { n: result.linkCount })
          : t("panes.recommendLinksNone"),
      );
      setTimeout(() => setConnectNotice(null), 4000);
      router.refresh();
    } catch (err) {
      // Stopped, not failed: no links, no notice.
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      if (connectAbortRef.current === controller) connectAbortRef.current = null;
      setConnecting(null);
    }
  }

  // `as` flips a PDF between article and handwritten pages (SPEC.md §16) —
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
    kind: "pdf" | "url" | "video" | "youtube" | "media" | "drive",
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
      throw new Error(result && "error" in result ? result.error : t("panes.uploadCutOff"));
    }
    setPhase((p) => (p ? { ...p, steps: completeIngestSteps(p.steps) } : p));
    await sleep(250); // let the last checkmark register before the pill clears
    return result;
  }

  // Every add opens the upload assistant (SPEC.md §15): the box reviews a URL
  // in a private sandbox, takes upload instructions, and drives the add
  // itself. Google Drive picks open it too — the server fetches those files
  // at import time, so only the sandbox review has nothing to read.
  const [assistant, setAssistant] = useState<UploadRequest | null>(null);

  function openAssistant(request: UploadRequest) {
    setError(null);
    // Offline (SPEC.md §17, Unitos Premium): the box's review needs the
    // server, so the add queues instead — files by their bytes, URLs as the
    // plain ingest request — and syncs when the browser is back online.
    if (isOffline()) {
      // A Drive pick cannot queue: its token expires before any sync.
      if (request.kind === "drive") {
        setError(t("panes.driveOffline"));
        return;
      }
      if (!offlinePremium()) {
        setError(t("common.offlineReadOnly"));
        return;
      }
      const queued =
        request.kind === "files"
          ? Promise.all(request.files.map((f) => queueUpload(f, notebookId))).then(
              () => request.files.length,
            )
          : queueWrite("/api/documents", "POST", { url: request.url, notebookId }).then(() => 1);
      void queued.then((n) => {
        setConnectNotice(t("panes.uploadQueuedOffline", { n }));
        setTimeout(() => setConnectNotice(null), 4000);
      });
      if (fileRef.current) fileRef.current.value = "";
      if (videoFileRef.current) videoFileRef.current.value = "";
      setDialog(false);
      return;
    }
    setAssistant(request);
    setDialog(false);
    if (fileRef.current) fileRef.current.value = "";
    if (videoFileRef.current) videoFileRef.current.value = "";
  }

  // The dialog's URL and video forms route through the assistant, like every
  // other add path. The media-figure toast keeps the direct ingest path.
  // A pasted Google Drive link is not a readable page: with Drive linked it
  // imports server-side through the linked grant; otherwise the reader is
  // pointed at Add from Google Drive (SPEC.md §14).
  async function assistantFromUrl(raw: string): Promise<boolean> {
    const trimmed = raw.trim();
    if (!trimmed) return false;
    const driveFileId = parseDriveFileId(trimmed);
    if (driveFileId) {
      if (drive?.linked) return importDriveLink(driveFileId);
      setError(t("panes.driveLinkUseDrive"));
      return false;
    }
    openAssistant(
      parseYouTubeId(trimmed) || isMediaUrl(trimmed)
        ? { kind: "video-url", url: trimmed }
        : { kind: "url", url: trimmed },
    );
    return true;
  }

  // A pasted Drive link on a linked account: no picker, no token in the
  // browser — the server mints one from the stored grant and reads the file's
  // facts from Drive metadata. drive.file scope only reaches files this app
  // has touched; anything else fails with Drive's plain reason.
  async function importDriveLink(fileId: string): Promise<boolean> {
    setError(null);
    try {
      const result = await runIngest(t("panes.addFromDrive"), "drive", () =>
        fetch("/api/drive/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notebookId, fileId }),
        }),
      );
      setDialog(false);
      open(result.id);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("panes.uploadFailed"));
      return false;
    } finally {
      setPhase(null);
    }
  }

  // Google Drive upload (SPEC.md §14): get a token and open the picker
  // (client-only; a linked account's token comes from the server, no consent
  // popup), then hand the picks to the upload assistant box — instructions
  // and the PDF directives ride along like every add (SPEC.md §15).
  async function importFromDrive() {
    if (!drive) return;
    setError(null);
    // The picker and the imports need the server; Drive adds do not queue.
    if (isOffline()) {
      setError(t("panes.driveOffline"));
      return;
    }
    // A signed-in account that can link but has not: link first. The consent
    // returns through the sign-in redirect URI — the one Google accepts — to
    // this page with ?drive=linked, and the picker opens then, with a token
    // minted from the stored grant: no popup, nothing else to register.
    if (drive.canLink && !drive.linked) {
      const next = window.location.pathname + window.location.search;
      // A document navigation on purpose: the route answers with a redirect
      // to Google's consent page, which the client router cannot follow.
      window.location.href = new URL(
        `/api/drive/link?next=${encodeURIComponent(next)}`,
        window.location.origin,
      ).toString();
      return;
    }
    let token: string;
    let picked: DrivePickedFile[];
    try {
      const result = await pickDriveFiles({
        clientId: drive.clientId,
        apiKey: drive.apiKey,
        linked: drive.linked,
      });
      token = result.token;
      picked = result.files;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("panes.driveAuthFailed"));
      return;
    }
    if (picked.length === 0) return; // closed the picker without choosing a file
    setAssistant({ kind: "drive", token, files: picked });
    setDialog(false);
  }

  // Back from Link Google Drive: the callback returns here with ?drive=linked
  // or ?drive=link-failed. Linked, the picker opens at once — the add the
  // reader started; failed, the dialog opens on the Drive tab with the reason.
  // The param leaves the URL so a reload does not repeat it.
  const [dialogTab, setDialogTab] = useState<AddTab | null>(null);
  const driveResult = searchParams.get("drive");
  const driveResultHandled = useRef(false);
  useEffect(() => {
    if (!driveResult || driveResultHandled.current) return;
    driveResultHandled.current = true;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("drive");
    router.replace(`/n/${notebookId}${params.size > 0 ? `?${params}` : ""}`);
    /* eslint-disable react-hooks/set-state-in-effect */
    setDialogTab("drive");
    setDialog(true);
    if (driveResult === "linked") void importFromDrive();
    else setError(t("panes.driveAuthFailed"));
    /* eslint-enable react-hooks/set-state-in-effect */
    // importFromDrive and t are stable for the life of this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveResult]);

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
      openAssistant({ kind: "files", files: accepted });
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
      setDialog(false);
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

  // Fetches the library once; the dialog's Library tab calls this when it opens.
  async function openLibrary() {
    if (library) return;
    const res = await fetch("/api/documents");
    const json = await readJson<LibraryDocument[]>(res);
    if (res.ok && json) setLibrary(json);
    else setError(statusMessage(t, res.status));
  }

  async function attach(documentId: string) {
    await api(`/api/notebooks/${notebookId}/documents`, "POST", { documentId });
    setDialog(false);
    open(documentId);
    router.refresh();
  }

  async function detach(documentId: string) {
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
            data-track="document-list"
            aria-expanded={listOpen}
            aria-label={t("panes.documentList")}
            data-tip={active?.title ?? t("panes.documentList")}
            className="flex max-w-72 min-w-0 items-center gap-1.5 rounded-full bg-ink py-[7px] pr-3 pl-[15px] text-[13px] font-semibold text-paper"
          >
            <span className="truncate">{active ? active.title : t("panes.documentList")}</span>
            <span className="shrink-0 rounded-full bg-paper/20 px-1.5 text-[11px] tabular-nums">
              {opening ? <LoadingDots /> : documents.length}
            </span>
            <ChevronDownIcon
              size={13}
              className={`shrink-0 text-sand-400 transition-transform duration-150 ${
                listOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          <Presence show={listOpen} exit="menu">
          {listOpen && (
            <div className="menu-in absolute top-full left-0 z-30 mt-2 flex max-h-[min(60vh,480px)] w-80 max-w-[calc(100vw-96px)] flex-col overflow-y-auto overscroll-contain rounded-2xl bg-card py-1.5 shadow-float">
              {documents.map((d) => (
                <div key={d.id} className="flex flex-col">
                  <div className="flex items-center">
                    <button
                      onClick={() => {
                        closeList();
                        open(d.id);
                      }}
                      data-track="document-open"
                      data-active-row={d.id === activeId || undefined}
                      className={`min-w-0 flex-1 truncate px-4 py-2 text-left text-[13px] ${
                        d.id === activeId
                          ? "font-semibold text-ink"
                          : "text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                      }`}
                      data-tip={d.title}
                    >
                      {d.title}
                    </button>
                    <button
                      onClick={() => setPillMenu(pillMenu === d.id ? null : d.id)}
                      data-track="document-actions"
                      aria-label={t("panes.documentActionsFor", { title: d.title })}
                      aria-expanded={pillMenu === d.id}
                      data-tip={t("panes.documentActions")}
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
                  <Collapse open={pillMenu === d.id}>
                  {pillMenu === d.id && (
                    <div className="mx-2 mb-1.5 flex flex-col rounded-xl bg-sand-100 py-1">
                      {canEdit && !d.hasVideo && !d.handwritten && (d.sourceUrl !== null || d.hasFile) && (
                        <button
                          onClick={() => {
                            closeList();
                            void reparse(d);
                          }}
                          data-track="document-reparse"
                          disabled={phase !== null}
                          className={`${rowAction} disabled:opacity-40`}
                          data-tip={t("panes.reparseDocumentTitle")}
                        >
                          {t("panes.reparseDocument")}
                        </button>
                      )}
                      {/* The shape switch (SPEC.md §16): the escape hatch when
                          Import PDF judged this PDF wrong. */}
                      {canEdit && d.handwritten && (
                        <button
                          onClick={() => {
                            closeList();
                            void reparse(d, "article");
                          }}
                          data-track="document-parse-as-article"
                          disabled={phase !== null}
                          className={`${rowAction} disabled:opacity-40`}
                          data-tip={t("panes.parseAsArticleTitle")}
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
                          data-track="document-open-as-handwritten"
                          disabled={phase !== null}
                          className={`${rowAction} disabled:opacity-40`}
                          data-tip={t("panes.openAsHandwrittenTitle")}
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
                          data-track="document-recommend-links"
                          disabled={connecting !== null}
                          className={`${rowAction} disabled:opacity-40`}
                          data-tip={t("panes.recommendLinksTitle")}
                        >
                          {connecting === d.id ? t("common.working") : t("panes.recommendLinks")}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          closeList();
                          window.print();
                        }}
                        data-track="document-print"
                        disabled={d.id !== activeId}
                        className={`${rowAction} disabled:opacity-40`}
                        data-tip={
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
                          data-track="document-detach"
                          className="px-4 py-1.5 text-left text-[12.5px] text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          data-tip={t("panes.detachDocumentTitle")}
                        >
                          {t("panes.detachDocument")}
                        </button>
                      )}
                    </div>
                  )}
                  </Collapse>
                </div>
              ))}
            </div>
          )}
          </Presence>
        </div>
      )}

      <div className={`shrink-0 ${canEdit ? "" : "hidden"}`}>
        <button
          onClick={() => {
            setError(null);
            setDialogTab(null);
            setDialog(true);
          }}
          data-track="add-document"
          data-nudge="document"
          aria-label={t("panes.addDocument")}
          data-tip={t("panes.addDocumentTitle")}
          aria-haspopup="dialog"
          aria-expanded={dialog}
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
      </div>

      <AddDocumentDialog
        open={dialog}
        onClose={() => setDialog(false)}
        busy={phase !== null}
        phase={phase}
        error={error}
        onError={setError}
        onChoosePdf={() => fileRef.current?.click()}
        onChooseVideo={() => videoFileRef.current?.click()}
        onImportDrive={drive ? () => void importFromDrive() : null}
        driveLink={drive ? { linked: drive.linked, canLink: drive.canLink } : null}
        onIngestUrl={assistantFromUrl}
        library={library}
        attachedIds={attachedIds}
        onOpenLibrary={() => void openLibrary()}
        onAttach={(id) => void attach(id)}
        onRemoveFromLibrary={(id) => void removeFromLibrary(id)}
        initialTab={dialogTab}
      />

      {/* While the dialog is open it shows the progress and the error itself. */}
      {phase && !dialog && <IngestProgress fileLabel={phase.fileLabel} steps={phase.steps} />}
      {connecting && (
        <span className="shrink-0 rounded-full bg-card px-3 py-1 text-xs shadow-soft">
          <ThinkingIndicator label={t("panes.recommendLinksRunning")} onStop={stopConnect} />
        </span>
      )}
      {connectNotice && (
        <span className="shrink-0 rounded-full bg-sage-200 px-3 py-1 text-xs font-semibold text-sage-800">
          {connectNotice}
        </span>
      )}
      {error && !dialog && <span className="text-xs text-red-500">{error}</span>}

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length > 0) openAssistant({ kind: "files", files });
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
          if (files.length > 0) openAssistant({ kind: "files", files });
        }}
      />

      {assistant && (
        <UploadAssistant
          notebookId={notebookId}
          request={assistant}
          onClose={(docId) => {
            setAssistant(null);
            if (docId) {
              open(docId);
              router.refresh();
            }
          }}
        />
      )}

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
