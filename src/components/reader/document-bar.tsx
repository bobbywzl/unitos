"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { api } from "@/lib/api";
import type { DriveConfig } from "@/lib/drive/config";
import { pickDriveFiles } from "@/lib/drive/picker-client";
import { parseDriveFileId, type DrivePickedFile } from "@/lib/drive/types";
import { IMAGE_ACCEPT, isImageFile } from "@/lib/handwritten/image";
import { isImeKey } from "@/lib/ime";
import { useCollab } from "@/components/collab/collab-context";
import { reportError } from "@/lib/error-log";
import { ChevronDownIcon, SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { clipWords } from "@/lib/markdown-preview";
import { Logo } from "@/components/logo";
import { Collapse, Presence } from "@/components/presence";
import { LoadingDots, ThinkingIndicator } from "@/components/thinking";
import { usePageFileDrop } from "@/components/reader/use-page-file-drop";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { readNdjson } from "@/lib/ndjson";
import { isOffline, offlinePremium, queueUpload, queueWrite } from "@/lib/offline/queue";
import { PARSER_VERSION } from "@/lib/parse/types";
import { MEDIA_EXTENSIONS, isMediaUrl } from "@/lib/video/types";
import { parseYouTubeId } from "@/lib/video/youtube";
import {
  AddDocumentDialog,
  type LibraryDocument,
} from "@/components/reader/add-document-dialog";
import {
  IngestProgress,
  advanceIngestSteps,
  completeIngestSteps,
  initialIngestSteps,
  type IngestStep,
} from "@/components/reader/ingest-progress";
import {
  MovingFigureIcon,
  registerFigureCaptureHandler,
  setFigureCapture,
  useFigureCapture,
} from "@/components/reader/figure-capture";
import { setRevealFlag } from "@/components/reader/reveal";
import { UploadAssistant, uploadItemTitle, type UploadRequest } from "@/components/reader/upload-assistant";
import { isMarkdownFile, MARKDOWN_ACCEPT } from "@/lib/markdown-file";

export type AttachedDocument = {
  id: string;
  title: string;
  sourceUrl: string | null;
  parserVersion: number;
  hasFile: boolean;
  pdf: boolean; // the stored file is a PDF: Re-parse asks which shape (SPEC.md §16)
  hasVideo: boolean; // re-parses by transcribing again (SPEC.md §11)
  handwritten: boolean; // pages, not text blocks; the menu flips the shape (SPEC.md §16)
  // The browser render for scripted figures (Document.figureRenderAt,
  // figureRenderError): none has run, or when the last ran and why it did
  // not deliver (SPEC.md §15).
  figureRenderAt: string | null;
  figureRenderError: string | null;
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

// The automatic upgrade re-parse runs once per document per parser version
// per browser in this window. Each run is a full parse on the server, so a
// reload while one runs, or after one failed, must not start another; the
// document's actions in the list still re-parse on demand.
const REPARSE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
function reparseKey(documentId: string): string {
  return `unitos:reparse:${documentId}:${PARSER_VERSION}`;
}
function reparseDue(documentId: string): boolean {
  try {
    const at = Number(localStorage.getItem(reparseKey(documentId)) ?? 0);
    return !(at > 0 && Date.now() - at < REPARSE_COOLDOWN_MS);
  } catch {
    return true;
  }
}
function markReparse(documentId: string): void {
  try {
    localStorage.setItem(reparseKey(documentId), String(Date.now()));
  } catch {
    // storage unavailable: the next page load may try again
  }
}

// The save stage's figure check ({figures, captionsWithoutFigure,
// scriptedFigures, renderError, media, mediaLost}; lib/parse/ingest.ts
// saveDetail): the captions left without their figure, the media the parse
// did not load, and why.
type FigureOutcome = {
  captions: string[];
  scriptedFigures: boolean;
  renderError: string | null;
  mediaLost: string[];
};

function figureOutcome(detail: string): FigureOutcome | null {
  if (!detail.startsWith("{")) return null;
  try {
    const raw = JSON.parse(detail) as {
      captionsWithoutFigure?: unknown;
      scriptedFigures?: unknown;
      renderError?: unknown;
      mediaLost?: unknown;
    };
    return {
      captions: Array.isArray(raw.captionsWithoutFigure)
        ? raw.captionsWithoutFigure.filter((c): c is string => typeof c === "string")
        : [],
      scriptedFigures: raw.scriptedFigures === true,
      renderError: typeof raw.renderError === "string" && raw.renderError ? raw.renderError : null,
      mediaLost: Array.isArray(raw.mediaLost) ? raw.mediaLost.filter((n): n is string => typeof n === "string") : [],
    };
  } catch {
    return null;
  }
}

// The figure check as one line, or null when every caption has its figure,
// every media of the page loaded, and the browser render, if one ran,
// delivered. A render that failed with every caption beside a figure is
// worth the line too: the chart the scripts animate stayed as the page's
// static drawing.
function figureNotice(t: TFunc, detail: string): string | null {
  const outcome = figureOutcome(detail);
  if (!outcome) return null;
  if (outcome.captions.length === 0) {
    if (outcome.mediaLost.length > 0) return t("panes.reparseMediaLost", { names: outcome.mediaLost.join(", ") });
    return outcome.renderError ? t("panes.reparseRenderFailed", { reason: outcome.renderError }) : null;
  }
  const labels = outcome.captions.map((c) => c.split(/[.:]\s/)[0].slice(0, 24)).join(", ");
  return [
    t("panes.reparseCaptionsWithoutFigure", { labels }),
    ...(outcome.mediaLost.length > 0 ? [t("panes.reparseMediaLost", { names: outcome.mediaLost.join(", ") })] : []),
    ...(outcome.scriptedFigures ? [t("panes.uploadScriptedFigures")] : []),
    ...(outcome.renderError ? [t("panes.reparseRenderFailed", { reason: outcome.renderError })] : []),
  ].join(" ");
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

// Every file the add-document dialog's drop zone takes: PDF, image, video and
// audio, Markdown — one accept list, since the dialog does not ask which kind
// is coming in.
const VIDEO_ACCEPT =
  "video/mp4,video/webm,video/ogg,video/quicktime,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/flac,audio/ogg,.mp4,.m4v,.webm,.ogv,.ogg,.mov,.mp3,.m4a,.m4b,.aac,.wav,.flac,.oga,.opus";
const UPLOAD_FILE_ACCEPT = `application/pdf,.pdf,${IMAGE_ACCEPT},${MARKDOWN_ACCEPT},${VIDEO_ACCEPT}`;

// Documents in the header: one pill showing the open document, expanding a
// vertical document list on hover or click. Everything that adds one opens
// from the dashed + as the add-document dialog.
export function DocumentBar({
  notebookId,
  title,
  documents,
  activeId,
  drive,
  figureGaps,
  browserConfigured,
}: {
  notebookId: string;
  // The project's title: a project with no document yet asks for it in the
  // add-document dialog (SPEC.md §15).
  title: string;
  documents: AttachedDocument[];
  activeId: string | null;
  drive: DriveConfig | null;
  // The open document's captions left without their figure, by label
  // (lib/parse/figure-audit.ts captionGaps), and whether this deployment
  // has a browser to render them with (SPEC.md §15).
  figureGaps: string[];
  browserConfigured: boolean;
}) {
  const { canEdit } = useCollab();
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  // Every error the bar shows also lands in the error log, on the open
  // document: the reader lists them under Extract
  // (article-errors.tsx).
  useEffect(() => {
    if (error) reportError(error, activeId);
  }, [error, activeId]);
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

  // A document just added opens with the reveal (reveal.tsx): the flag is
  // set before the open, the reader takes it on mount.
  function openAdded(docId: string) {
    setRevealFlag(docId);
    open(docId);
    router.refresh();
  }

  // Re-parse with the current parser: the reader asks for it, from the
  // document's actions in the document list. A document parsed by an older
  // pipeline is marked in the list and left as it is until then — a re-parse
  // is a full import on the import's model, and a parser release would
  // otherwise re-import the whole library as the reader opened it, at no
  // request of theirs.
  const reparseAttempted = useRef(new Set<string>());
  const active = documents.find((d) => d.id === activeId) ?? null;
  const isStale = (d: AttachedDocument) =>
    !d.hasVideo && !d.handwritten && (d.sourceUrl !== null || d.hasFile) && d.parserVersion < PARSER_VERSION;
  // The open document's figures a browser render can bring over: captions
  // left without their figure on a page, while a browser is configured. One
  // run on open when no render has run for the document yet — a browser
  // configured after the add brings the figures over on the next open; Try
  // again in the reader runs another (figure-capture.tsx).
  const activeGap =
    active !== null &&
    !active.hasVideo &&
    !active.handwritten &&
    active.sourceUrl !== null &&
    figureGaps.length > 0;
  const activeNeedsCapture = activeGap && browserConfigured && active.figureRenderAt === null;
  const capture = useFigureCapture(active?.id);
  const captureRunning = useRef(false);

  // The bar's passing notice: a comparison filed, an add queued offline.
  const [notice, setNotice] = useState<string | null>(null);
  // Compare two documents (SPEC.md §4): the open document against this one.
  // One PENDING note of agreements, disagreements, and what only one covers
  // lands in the notes tray; the notice says where.
  // A video or audio document re-parses by transcribing again (SPEC.md
  // §11): the lines are replaced. The pane shows the run once the refresh
  // lands; a 409 is a run already going.
  const [transcribing, setTranscribing] = useState<string | null>(null);
  async function transcribeAgain(doc: AttachedDocument) {
    if (transcribing) return;
    setTranscribing(doc.id);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/transcribe`, { method: "POST" });
      if (!res.ok && res.status !== 409) {
        const detail = await readJson<{ error?: string }>(res);
        throw new Error(detail?.error ?? statusMessage(t, res.status));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("panes.reparseFailed"));
    } finally {
      setTranscribing(null);
    }
  }

  // What a re-parse can read again: the video, the stored file, or the URL.
  function canReparse(doc: AttachedDocument): boolean {
    return doc.hasVideo || doc.hasFile || doc.sourceUrl !== null;
  }

  // Re-parse on a PDF asks which shape first (SPEC.md §16): the row folds
  // open to the two choices for this document.
  const [reparseChoice, setReparseChoice] = useState<string | null>(null);

  // Manual re-parse: in the document's own shape, or as the shape the reader
  // chose for a PDF (`as`). The progress card shows, errors show.
  async function reparse(doc: AttachedDocument, as?: "article" | "handwritten") {
    setError(null);
    // The figure's place in the reader moves while the re-parse runs; the
    // refresh brings the outcome the document stores.
    const figures = activeGap && doc.id === active?.id;
    if (figures) setFigureCapture({ documentId: doc.id, status: "running", error: null });
    try {
      await runIngest(doc.title, doc.sourceUrl ? "url" : "pdf", () =>
        fetch(`/api/documents/${doc.id}/reparse`, {
          method: "POST",
          ...(as
            ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ as }) }
            : {}),
        }),
      );
      router.refresh();
      if (figures) setFigureCapture(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("panes.reparseFailed");
      setError(message);
      if (figures) setFigureCapture({ documentId: doc.id, status: "failed", error: message });
    } finally {
      setPhase(null);
    }
  }

  // Automatic upgrade re-parse: the document already reads fine, so no
  // progress card — the reader never waits on it. Success swaps the upgraded
  // blocks in with a refresh; failure goes to the error log and leaves the
  // old parse standing until the cooldown passes.
  //
  // `figures`: the run is bringing a figure over (activeGap) — the figure's
  // place in the reader moves while it runs, and says why when the figure
  // still did not come through (figure-capture.tsx).
  async function reparseSilently(doc: AttachedDocument, figures = false) {
    if (figures) {
      if (captureRunning.current) return;
      captureRunning.current = true;
      setFigureCapture({ documentId: doc.id, status: "running", error: null });
    }
    const failed = (detail: string | null) => {
      reportError(
        detail ? `${t("panes.reparseFailed")}: ${detail}` : t("panes.reparseFailed"),
        doc.id,
      );
      if (figures) setFigureCapture({ documentId: doc.id, status: "failed", error: detail });
    };
    try {
      const res = await fetch(`/api/documents/${doc.id}/reparse`, { method: "POST" });
      // 409: another tab or a reload is already running this re-parse; its
      // outcome reaches this tab with the refresh.
      if (res.status === 409) {
        if (figures) setFigureCapture(null);
        return;
      }
      if (!res.ok || !res.body) {
        const detail = await readJson<{ error?: string }>(res);
        failed(detail?.error ?? statusMessage(t, res.status));
        return;
      }
      let result: IngestEvent | null = null;
      let saveDetail: string | null = null;
      for await (const event of readNdjson<IngestEvent>(res)) {
        if ("stage" in event) {
          if (event.stage === "save" && event.detail) saveDetail = event.detail;
        } else result = event;
      }
      if (result && "id" in result) {
        router.refresh();
        // A figure the re-parse could not load is worth a line: the caption
        // stands alone, and when the page draws it with scripts, the fix is
        // a browser for the deployment — or the render's own error says
        // what went wrong (SPEC.md §15).
        const notice = saveDetail ? figureNotice(t, saveDetail) : null;
        if (notice) reportError(notice, doc.id);
        if (figures) {
          const outcome = saveDetail ? figureOutcome(saveDetail) : null;
          if (outcome && outcome.captions.length > 0) {
            setFigureCapture({ documentId: doc.id, status: "failed", error: outcome.renderError });
          } else setFigureCapture(null);
        }
      } else failed(result && "error" in result ? result.error : t("panes.uploadCutOff"));
    } catch (err) {
      failed(err instanceof Error ? err.message : null);
    } finally {
      if (figures) captureRunning.current = false;
    }
  }

  useEffect(() => {
    if (active === null || phase !== null) return;
    if (!activeNeedsCapture) return;
    if (reparseAttempted.current.has(active.id)) return;
    if (isOffline() || !reparseDue(active.id)) {
      // A figure run held back: the figure's place says so, with Try again.
      setFigureCapture({ documentId: active.id, status: "failed", error: null });
      return;
    }
    reparseAttempted.current.add(active.id);
    markReparse(active.id);
    void reparseSilently(active, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeNeedsCapture]);

  // The reader's Try again, at the figure's place.
  useEffect(() => {
    if (active === null || !activeGap) return;
    return registerFigureCaptureHandler(active.id, () => {
      markReparse(active.id);
      void reparseSilently(active, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, activeGap]);

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
  // One box at a time: an add that arrives while one runs waits here and
  // starts when the running one closes, so neither replaces the other. The
  // run counter keys the box, so each request mounts a fresh one.
  const [pending, setPending] = useState<UploadRequest[]>([]);
  const [assistantRun, setAssistantRun] = useState(0);
  // The box hidden while its add runs on (SPEC.md §15): the header shows the
  // running pill instead, and clicking the pill brings the box back.
  const [assistantHidden, setAssistantHidden] = useState(false);
  // The document the box opened before its finishing step was done (SPEC.md
  // §15): the pill says the add is finishing, and the close that ends the
  // add refreshes the open document instead of opening it again.
  const [assistantOpened, setAssistantOpened] = useState<string | null>(null);
  const assistantSubject = !assistant
    ? ""
    : assistant.kind === "files" || assistant.kind === "drive"
      ? assistant.files.map((f) => f.name).join(" · ")
      : assistant.kind === "batch"
        ? assistant.items.map(uploadItemTitle).join(" · ")
        : assistant.url;

  function startAssistant(request: UploadRequest) {
    setAssistant(request);
    setAssistantRun((n) => n + 1);
    setAssistantHidden(false);
  }

  function openAssistant(request: UploadRequest) {
    setError(null);
    // Offline (SPEC.md §17, Unitos Premium): the box's review needs the
    // server, so the add queues instead — files by their bytes, URLs as the
    // plain ingest request — and syncs when the browser is back online.
    if (isOffline()) {
      // A Drive pick cannot queue: its token expires before any sync.
      if (
        request.kind === "drive" ||
        (request.kind === "batch" && request.items.some((item) => item.kind === "drive-file"))
      ) {
        setError(t("panes.driveOffline"));
        return;
      }
      if (!offlinePremium()) {
        setError(t("common.offlineReadOnly"));
        return;
      }
      // A batch queues item by item; every item opens on its own page after
      // the sync.
      const items =
        request.kind === "files"
          ? request.files.map((file) => ({ kind: "file" as const, file }))
          : request.kind === "batch"
            ? request.items
            : [request];
      const queued = Promise.all(
        items.map((item) =>
          item.kind === "file"
            ? queueUpload(item.file, notebookId)
            : item.kind === "drive-file"
              ? Promise.resolve()
              : queueWrite("/api/documents", "POST", { url: item.url, notebookId }),
        ),
      ).then(() => items.length);
      void queued.then((n) => {
        setNotice(t("panes.uploadQueuedOffline", { n }));
        setTimeout(() => setNotice(null), 4000);
      });
      setDialog(false);
      return;
    }
    setDialog(false);
    if (assistant) {
      // A box is running: this add waits its turn (one box at a time).
      setPending((queue) => [...queue, request]);
      setNotice(t("panes.uploadQueuedBehind"));
      setTimeout(() => setNotice(null), 4000);
      return;
    }
    startAssistant(request);
  }

  // A pasted Google Drive link is not a readable page: with Drive linked it
  // imports server-side through the linked grant; otherwise the reader is
  // pointed at Add from Google Drive (SPEC.md §14). Every other link goes
  // through the dialog's queue and the upload assistant box.
  async function driveLinkFromUrl(raw: string): Promise<boolean> {
    const driveFileId = parseDriveFileId(raw.trim());
    if (!driveFileId) return false;
    if (drive?.linked) return importDriveLink(driveFileId);
    setError(t("panes.driveLinkUseDrive"));
    return false;
  }

  // A pasted Drive link on a linked account: no picker, no token in the
  // browser — the server mints one from the stored grant and reads the file's
  // facts from Drive metadata. An all-files grant reaches any file the
  // account can read; a picked-files grant reaches picked files only, and the
  // server says so.
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
      openAdded(result.id);
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
  // popup). The picks and the token come back for the dialog's queue; null
  // = nothing picked, or a failure the dialog shows.
  async function pickFromDrive(): Promise<{ token: string; files: DrivePickedFile[] } | null> {
    if (!drive) return null;
    setError(null);
    // The picker and the imports need the server; Drive adds do not queue.
    if (isOffline()) {
      setError(t("panes.driveOffline"));
      return null;
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
      return null;
    }
    try {
      const result = await pickDriveFiles({
        clientId: drive.clientId,
        apiKey: drive.apiKey,
        linked: drive.linked,
        access: drive.access,
      });
      // Closed the picker without choosing a file: nothing to queue.
      return result.files.length > 0 ? result : null;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("panes.driveAuthFailed"));
      return null;
    }
  }

  // Back from Link Google Drive: the picker opens on its own, and the picks
  // go straight to the box (the dialog's queue is gone with the page load).
  async function importFromDrive() {
    const picked = await pickFromDrive();
    if (picked) openAssistant({ kind: "drive", token: picked.token, files: picked.files });
  }

  // Back from Link Google Drive: the callback returns here with ?drive=linked
  // or ?drive=link-failed. Linked, the picker opens at once — the add the
  // reader started; failed, the dialog opens with the reason. The param
  // leaves the URL so a reload does not repeat it.
  const driveResult = searchParams.get("drive");
  const driveResultHandled = useRef(false);
  useEffect(() => {
    if (!driveResult || driveResultHandled.current) return;
    driveResultHandled.current = true;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("drive");
    router.replace(`/n/${notebookId}${params.size > 0 ? `?${params}` : ""}`);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (driveResult === "linked") void importFromDrive();
    else {
      setDialog(true);
      setError(t("panes.driveAuthFailed"));
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // importFromDrive and t are stable for the life of this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveResult]);

  // A new project opens on the add-document dialog: New project on the
  // dashboard pushes ?add=1, so the first thing the project asks for is a
  // document. The param leaves the URL so a reload does not repeat it.
  const addParam = searchParams.get("add");
  const addParamHandled = useRef(false);
  useEffect(() => {
    if (addParam !== "1" || addParamHandled.current || !canEdit) return;
    addParamHandled.current = true;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("add");
    router.replace(`/n/${notebookId}${params.size > 0 ? `?${params}` : ""}`);
    setError(null);
    setDialog(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addParam, canEdit]);

  // Drag-and-drop upload — PDFs, images, Markdown, video and audio files:
  // dropping anywhere on the page adds to this work (use-page-file-drop.ts).
  // A drop of files the work cannot take opens the add-document dialog with
  // the reason: the error shows there, and the dialog's drop zone is where
  // the next try goes.
  const dragging = usePageFileDrop({
    enabled: canEdit,
    onDrop: (files) => {
      const accepted = files.filter(
        (f) =>
          f.type === "application/pdf" ||
          f.name.toLowerCase().endsWith(".pdf") ||
          isImageFile(f) ||
          isMarkdownFile(f) ||
          isMediaFile(f),
      );
      if (accepted.length === 0) {
        setError(t("panes.dropPdfOrVideo"));
        setDialog(true);
        return;
      }
      openAssistant({ kind: "files", files: accepted });
    },
  });

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
      openAdded(result.id);
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

  // Delete document: the document leaves the project and the library
  // (DELETE /api/documents/[documentId]; refused while notes cite it).
  async function deleteDocument(documentId: string) {
    closeList();
    if (!confirm(t("panes.confirmDeleteDocument"))) return;
    setError(null);
    try {
      await api(`/api/documents/${documentId}`, "DELETE");
      if (documentId === activeId) router.push(`/n/${notebookId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("panes.deleteFailed"));
    }
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
            className="flex max-w-[min(50vw,32rem)] min-w-0 items-center gap-1.5 rounded-full bg-ink py-[7px] pr-3 pl-[15px] text-[13px] font-semibold text-paper"
          >
            <span className="overflow-hidden whitespace-nowrap">{active ? clipWords(active.title, 56) : t("panes.documentList")}</span>
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
                      className={`min-w-0 flex-1 overflow-hidden px-4 py-2 text-left text-[13px] whitespace-nowrap ${
                        d.id === activeId
                          ? "font-semibold text-ink"
                          : "text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                      }`}
                      data-tip={isStale(d) ? t("panes.reparseStaleTitle") : d.title}
                    >
                      {clipWords(d.title, 44)}
                      {isStale(d) && (
                        <span className="ml-1.5 text-[11px] font-normal text-sand-500">
                          {t("panes.reparseStale")}
                        </span>
                      )}
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
                      {/* Re-parse, on every document: a video or audio
                          document transcribes again, a handwritten one
                          re-makes its pages and converts again, a text one
                          parses its file or URL again. A document with no
                          source (pasted text, a generated document) has
                          nothing to parse again; the row says so. */}
                      {canEdit && (
                        <button
                          onClick={() => {
                            // A PDF asks which shape first: the row opens
                            // the two choices instead of running.
                            if (d.pdf && !d.hasVideo) {
                              setReparseChoice(reparseChoice === d.id ? null : d.id);
                              return;
                            }
                            closeList();
                            void (d.hasVideo ? transcribeAgain(d) : reparse(d));
                          }}
                          data-track="document-reparse"
                          disabled={phase !== null || transcribing !== null || !canReparse(d)}
                          aria-expanded={d.pdf && !d.hasVideo ? reparseChoice === d.id : undefined}
                          className={`${rowAction} disabled:opacity-40`}
                          data-tip={
                            d.hasVideo
                              ? t("panes.reparseVideoTitle")
                              : canReparse(d)
                                ? t("panes.reparseDocumentTitle")
                                : t("panes.reparseNoSource")
                          }
                        >
                          {t("panes.reparseDocument")}
                        </button>
                      )}
                      {canEdit && d.pdf && !d.hasVideo && reparseChoice === d.id && (
                        <div className="flex flex-col border-y border-line bg-sand-50/60 py-1">
                          <p className="px-4 pb-0.5 text-[11px] text-sand-500">{t("panes.reparseChoose")}</p>
                          {(["handwritten", "article"] as const).map((as) => {
                            const current = as === "handwritten" ? d.handwritten : !d.handwritten;
                            return (
                              <button
                                key={as}
                                onClick={() => {
                                  setReparseChoice(null);
                                  closeList();
                                  void reparse(d, as);
                                }}
                                data-track={`document-reparse-${as}`}
                                disabled={phase !== null || transcribing !== null}
                                className={`${rowAction} flex items-center gap-2 pl-6 disabled:opacity-40`}
                                data-tip={t(
                                  as === "handwritten" ? "panes.reparseAsHandwrittenTitle" : "panes.reparseAsArticleTitle",
                                )}
                              >
                                <span>{t(as === "handwritten" ? "panes.reparseAsHandwritten" : "panes.reparseAsArticle")}</span>
                                {current && (
                                  <span className="rounded-full border border-line px-1.5 text-[10px] text-sand-500">
                                    {t("panes.reparseCurrentShape")}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
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
                          onClick={() => void deleteDocument(d.id)}
                          data-track="document-delete"
                          className="px-4 py-1.5 text-left text-[12.5px] text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          data-tip={t("panes.deleteDocumentTitle")}
                        >
                          {t("panes.deleteDocument")}
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
            setDialog(true);
          }}
          data-track="add-document"
          // The onboarding nudge on + waits for the first document: a new
          // project opens on the dialog, so the nudge would sit behind it.
          data-nudge={documents.length > 0 && !dialog ? "document" : undefined}
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
        onSubmit={openAssistant}
        fileAccept={UPLOAD_FILE_ACCEPT}
        projectTitle={
          documents.length === 0
            ? {
                title,
                untitled: t("works.untitledProject"),
                onSave: async (next) => {
                  await api(`/api/notebooks/${notebookId}`, "PATCH", { title: next });
                  router.refresh();
                },
              }
            : null
        }
        onImportDrive={drive ? pickFromDrive : null}
        driveLink={
          drive
            ? { linked: drive.linked, canLink: drive.canLink, access: drive.access, grant: drive.grant }
            : null
        }
        onDriveLink={driveLinkFromUrl}
        library={library}
        attachedIds={attachedIds}
        onOpenLibrary={() => void openLibrary()}
        onAttach={(id) => void attach(id)}
        onRemoveFromLibrary={(id) => void removeFromLibrary(id)}
      />

      {/* The add running on behind a hidden box (SPEC.md §15). */}
      {assistant && assistantHidden && (
        <button
          onClick={() => setAssistantHidden(false)}
          data-track="upload-running"
          data-tip={t(assistantOpened ? "panes.uploadFinishingTip" : "panes.uploadRunningTip")}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-medium text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
        >
          <SpinnerIcon size={12} className="shrink-0 text-clay motion-safe:animate-spin" />
          <span className="max-w-[14rem] truncate">
            {t(assistantOpened ? "panes.uploadFinishing" : "panes.uploadRunning", { title: assistantSubject })}
          </span>
        </button>
      )}
      {/* While the dialog is open it shows the progress and the error itself. */}
      {phase && !dialog && <IngestProgress fileLabel={phase.fileLabel} steps={phase.steps} />}
      {transcribing && (
        <span className="shrink-0 rounded-full bg-card px-3 py-1 text-xs shadow-soft">
          <ThinkingIndicator label={t("video.transcribing")} />
        </span>
      )}
      {notice && capture?.status !== "running" && (
        <span className="shrink-0 rounded-full bg-sage-200 px-3 py-1 text-xs font-semibold text-sage-800">
          {notice}
        </span>
      )}
      {capture?.status === "running" && (
        <span
          role="status"
          aria-live="polite"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-sage-200 px-3 py-1 text-xs font-semibold text-sage-800"
        >
          <MovingFigureIcon size={14} />
          <span className="thinking-label">{t("panes.figureMoving", { label: figureGaps.join(", ") })}</span>
        </span>
      )}

      {assistant && (
        <UploadAssistant
          key={assistantRun}
          notebookId={notebookId}
          request={assistant}
          hidden={assistantHidden}
          onHide={() => setAssistantHidden(true)}
          onShow={() => setAssistantHidden(false)}
          onOpenEarly={(docId) => {
            setAssistantOpened(docId);
            setAssistantHidden(true);
            openAdded(docId);
          }}
          onClose={(target) => {
            const opened = assistantOpened;
            setAssistantOpened(null);
            // The next add waiting its turn starts now; none: the box goes.
            const [next, ...rest] = pending;
            setPending(rest);
            if (next) startAssistant(next);
            else {
              setAssistant(null);
              setAssistantHidden(false);
            }
            if (target && target.id !== opened) openAdded(target.id);
            // Opened early: the glossary and links the finishing step wrote
            // arrive with a refresh.
            else if (target) router.refresh();
          }}
        />
      )}

      {/* No backdrop blur: a blur over the whole page re-draws on every
          drag frame, and the drag stutters. A tint is enough. */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-paper/85">
          <div className="pop-in flex flex-col items-center gap-3 rounded-[28px] border-2 border-dashed border-clay bg-card px-14 py-10 shadow-float">
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
