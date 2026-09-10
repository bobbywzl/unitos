"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isImeKey } from "@/lib/ime";
import { useT } from "@/components/lang-provider";
import { CheckIcon } from "@/components/icons";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { readNdjson } from "@/lib/ndjson";
import { type FinishPlan, warmImages } from "@/lib/finish";
import { classifyDriveFile, type DrivePickedFile } from "@/lib/drive/types";
import { isImageFile } from "@/lib/handwritten/image";
import { isMarkdownFile } from "@/lib/markdown-file";
import { isMediaUrl, MAX_VIDEO_BYTES, MEDIA_EXTENSIONS, UPLOAD_CHUNK_BYTES } from "@/lib/video/types";
import { parseYouTubeId } from "@/lib/video/youtube";
import {
  IngestProgress,
  advanceIngestSteps,
  captionsWithoutFigureText,
  mediaLostText,
  completeIngestSteps,
  ingestCounts,
  initialIngestSteps,
  type IngestStep,
} from "@/components/reader/ingest-progress";

// The upload box: files or a URL are the only two ways in (SPEC.md §15). It
// takes what it is given and imports it right away — no kind to pick, no
// format to choose, no review before anything is saved. It shows the
// progress in place and ends on the final figure check. When an add will
// land two or more documents, the box asks first whether they go on
// separate pages or on one page as a multi upload (SPEC.md §22).

// One item of a batch add (SPEC.md §22): the add dialog queues links and
// files of every kind together, and the box adds them one after another.
export type UploadItem =
  | { kind: "url"; url: string }
  | { kind: "video-url"; url: string }
  | { kind: "file"; file: File };

export type UploadRequest =
  | { kind: "url"; url: string }
  | { kind: "video-url"; url: string }
  | { kind: "files"; files: File[] }
  // Files picked in the Google Drive picker (SPEC.md §14): the box imports
  // each pick with the token.
  | { kind: "drive"; token: string; files: DrivePickedFile[] }
  | { kind: "batch"; items: UploadItem[] };

// Where the documents of an add go (SPEC.md §22): each on its own page, as
// ever, or together on one page as a multi upload.
export type UploadLayout = "separate" | "multi";

// What the box opens when it is done: the first added document, or the
// multi upload it made.
export type OpenTarget = { kind: "document"; id: string } | { kind: "multi"; id: string };

type Phase = "ready" | "adding" | "done";
type Added = { id: string; title: string };
type IngestEvent =
  | { stage: string; detail?: string }
  | { id: string; title: string; deduped: boolean; documents?: Added[] }
  | { error: string };
type IngestResult = Extract<IngestEvent, { id: string }>;

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const SINGLE_REQUEST_BYTES = 4 * 1024 * 1024;
const CHUNK_BYTES = UPLOAD_CHUNK_BYTES;

function isMediaFile(file: File): boolean {
  return (
    file.type.startsWith("video/") ||
    file.type.startsWith("audio/") ||
    MEDIA_EXTENSIONS.test(file.name)
  );
}

// The kind label of a queued item: a web page, a video link, or the file's kind.
function uploadItemKindKey(item: UploadItem): TKey {
  if (item.kind === "url") return "panes.uploadItemPage";
  if (item.kind === "video-url") return "panes.uploadItemVideoLink";
  if (isMediaFile(item.file)) return "panes.uploadItemMediaFile";
  if (isImageFile(item.file)) return "panes.uploadItemImage";
  if (isMarkdownFile(item.file)) return "panes.uploadItemMarkdown";
  return "panes.uploadItemPdf";
}

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

function statusMessage(t: TFunc, status: number): string {
  if (status === 413) return t("panes.uploadTooLarge");
  return t("panes.requestFailedStatus", { status });
}

// An add that has run this long opens its document as soon as the document
// reads well — saved, with this share of its captions carrying their figure —
// and the finishing step runs on behind the document bar's running pill
// (SPEC.md §15). A shorter add opens complete, as before.
const EARLY_OPEN_MS = 20_000;
const EARLY_OPEN_FIGURE_SHARE = 0.9;

// Does the saved document read well enough to open before its finishing
// step is done? The save stage's figure check says: the figures that loaded
// against the captions left without one. No check: nothing speaks against it.
function readsWell(saveDetail: string | null): boolean {
  const counts = saveDetail ? ingestCounts(saveDetail) : null;
  if (!counts) return true;
  if (counts.mediaLost.length > 0) return false;
  const captions = counts.figures + counts.captionsWithoutFigure;
  return captions === 0 || counts.figures / captions >= EARLY_OPEN_FIGURE_SHARE;
}

// The finishing step (SPEC.md §15), after the save: the scans the box runs
// itself, then the visuals loaded into the browser's cache.
const FINISH_STEPS: IngestStep[] = [
  { key: "glossary", labelKey: "panes.stepGlossary", status: "pending" },
  { key: "links", labelKey: "panes.stepLinks", status: "pending" },
  { key: "figures", labelKey: "panes.stepFigures", status: "pending" },
];

export function UploadAssistant({
  notebookId,
  request,
  hidden,
  onHide,
  onShow,
  onOpenEarly,
  onClose,
}: {
  notebookId: string;
  request: UploadRequest;
  // Hidden while its add runs on (SPEC.md §15): the box keeps its state and
  // its work; the document bar shows the running pill instead.
  hidden: boolean;
  onHide: () => void;
  // The box asks to be shown again: the add ended with something to read.
  onShow: () => void;
  // The add has run EARLY_OPEN_MS and its first document reads well: open it
  // now and hide the box; the finishing step runs on. onClose follows with
  // the same id once the box is done.
  onOpenEarly: (docId: string) => void;
  // Called once the box is done: the first added document or the multi
  // upload to open, or null.
  onClose: (target: OpenTarget | null) => void;
}) {
  const t = useT();
  const hiddenRef = useRef(hidden);
  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);
  const items: UploadItem[] = request.kind === "batch" ? request.items : [];
  const files = request.kind === "files" ? request.files : [];
  const driveFiles = request.kind === "drive" ? request.files : [];
  const driveKindOf = (f: DrivePickedFile) => classifyDriveFile(f.mimeType, f.name);
  // What this add creates: one document per file, Drive pick, or queued
  // item, one for a URL.
  const itemCount =
    request.kind === "drive"
      ? Math.max(1, driveFiles.length)
      : request.kind === "files"
        ? Math.max(1, files.length)
        : request.kind === "batch"
          ? Math.max(1, items.length)
          : 1;
  // Two or more documents ask where they go before anything imports
  // (SPEC.md §22); one imports right away.
  const [phase, setPhase] = useState<Phase>(itemCount > 1 ? "ready" : "adding");
  const [layout, setLayout] = useState<UploadLayout>("separate");
  const [steps, setSteps] = useState<IngestStep[] | null>(null);
  const [headline, setHeadline] = useState<string | null>(null);
  const [added, setAdded] = useState<Added[]>([]);
  // What Close opens once the add is done: the first document, or the multi upload.
  const [openTarget, setOpenTarget] = useState<OpenTarget | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const subject =
    request.kind === "files"
      ? files.map((f) => f.name).join(" · ")
      : request.kind === "drive"
        ? driveFiles.map((f) => f.name).join(" · ")
        : request.kind === "batch"
          ? items.map((item) => (item.kind === "file" ? item.file.name : item.url)).join(" · ")
          : request.url;
  // The save stage detail of the last add — the final figure check (SPEC.md
  // §15) — read at the end of the add: a lost figure keeps the box open.
  const saveDetailRef = useRef<string | null>(null);
  // When the running add started: the progress card's elapsed time, and the
  // early open's mark. The early open is pending until the add's first
  // document either opens early or finishes in time — never a later one.
  const [addStartedAt, setAddStartedAt] = useState(0);
  const addStartedAtRef = useRef(0);
  const earlyOpenRef = useRef<"pending" | "opened" | "off">("off");

  // ── The adds: one streamed request per file or Drive pick, progress in the box ──
  async function streamIngest(res: Response): Promise<IngestResult> {
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(detail?.error ?? statusMessage(t, res.status));
    }
    let result: IngestEvent | null = null;
    for await (const event of readNdjson<IngestEvent>(res)) {
      if ("stage" in event) {
        if (event.stage === "save" && event.detail) saveDetailRef.current = event.detail;
        setSteps((s) => (s ? advanceIngestSteps(s, event.stage, event.detail) : s));
      } else result = event;
    }
    if (!result || "error" in result) {
      throw new Error(result && "error" in result ? result.error : t("panes.uploadCutOff"));
    }
    setSteps((s) => (s ? completeIngestSteps(s) : s));
    return result;
  }

  // ── The finishing step (SPEC.md §15): the document opens complete ─────────
  // What the server left to this box — the glossary and recommended-links
  // scans of a text document — runs now, then every visual the reader will
  // request loads once into the browser's cache. A scan that fails leaves the
  // add standing: the document is saved, and the scan can run again from the
  // document list.
  async function finishDocument(id: string) {
    let plan: FinishPlan;
    try {
      const res = await fetch(`/api/documents/${id}/finish`);
      if (!res.ok) return;
      plan = (await res.json()) as FinishPlan;
    } catch {
      return;
    }
    const scan = plan.scans === "client";
    const visuals = plan.images.length > 0;
    if (!scan && !visuals) return;
    const finishSteps = FINISH_STEPS.filter((s) => (s.key === "figures" ? visuals : scan));
    setSteps((s) => [...completeIngestSteps(s ?? []), ...finishSteps]);
    if (scan) {
      try {
        await Promise.all([
          fetch(`/api/documents/${id}/finish`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scan: "glossary" }),
          }),
          fetch(`/api/documents/${id}/finish`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scan: "links" }),
          }),
        ]);
      } catch {
        // Best-effort: the document stands as it is.
      }
      setSteps((s) => (s ? advanceIngestSteps(s, "glossary") : s));
      setSteps((s) => (s ? advanceIngestSteps(s, "links") : s));
    }
    if (visuals) {
      let done = 0;
      await warmImages(plan.images, () => {
        done++;
        setSteps((s) =>
          s
            ? advanceIngestSteps(s, "figures", `${done}/${plan.images.length}`)
            : s,
        );
      });
    }
  }

  async function ingestAndFinish(res: Response): Promise<IngestResult> {
    const result = await streamIngest(res);
    const documents = result.documents ?? [{ id: result.id, title: result.title }];
    // The document is saved and reads well: past the mark it opens now; before
    // it, a timer opens it at the mark should the finishing step still run.
    let earlyTimer: ReturnType<typeof setTimeout> | null = null;
    if (earlyOpenRef.current === "pending") {
      const first = documents[0];
      if (first && readsWell(saveDetailRef.current)) {
        const openEarly = () => {
          if (earlyOpenRef.current !== "pending") return;
          earlyOpenRef.current = "opened";
          onOpenEarly(first.id);
        };
        const left = EARLY_OPEN_MS - (Date.now() - addStartedAtRef.current);
        if (left <= 0) openEarly();
        else earlyTimer = setTimeout(openEarly, left);
      } else earlyOpenRef.current = "off";
    }
    try {
      for (const doc of documents) await finishDocument(doc.id);
    } finally {
      if (earlyTimer) clearTimeout(earlyTimer);
      if (earlyOpenRef.current === "pending") earlyOpenRef.current = "off";
    }
    return result;
  }

  async function uploadChunked(file: File, kind: "pdf" | "video"): Promise<Response> {
    const uploadId = crypto.randomUUID();
    const totalLabel = megabytes(file.size);
    for (let sent = 0; sent < file.size; sent += CHUNK_BYTES) {
      const index = Math.floor(sent / CHUNK_BYTES);
      const res = await fetch(`/api/uploads?uploadId=${uploadId}&index=${index}`, {
        method: "POST",
        body: file.slice(sent, sent + CHUNK_BYTES),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? statusMessage(t, res.status));
      }
      setSteps((s) =>
        s
          ? advanceIngestSteps(
              s,
              "receive",
              t("panes.uploadProgress", {
                sent: megabytes(Math.min(sent + CHUNK_BYTES, file.size)),
                total: totalLabel,
              }),
            )
          : s,
      );
    }
    return fetch("/api/uploads/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId,
        filename: file.name,
        notebookId,
        kind,
        // The box runs the scans itself, in the finishing step.
        scans: "client",
      }),
    });
  }

  // One file's add: a media file uploads in chunks as a video; a PDF over
  // the single-request size uploads in chunks; anything else goes in one
  // multipart request. Every path lands one document.
  async function addFile(file: File): Promise<Added> {
    const media = isMediaFile(file);
    if (media && file.size > MAX_VIDEO_BYTES) {
      throw new Error(t("panes.fileTooLarge", { name: file.name, mb: 200 }));
    }
    if (!media && file.size > MAX_PDF_BYTES) {
      throw new Error(t("panes.fileTooLarge", { name: file.name, mb: 50 }));
    }
    setSteps(initialIngestSteps(media ? "video" : "pdf"));
    const result = await ingestAndFinish(
      media
        ? await uploadChunked(file, "video")
        : file.size > SINGLE_REQUEST_BYTES
          ? await uploadChunked(file, "pdf")
          : await (() => {
              const form = new FormData();
              form.set("file", file);
              form.set("notebookId", notebookId);
              // The box runs the scans itself, in the finishing step.
              form.set("scans", "client");
              return fetch("/api/documents", { method: "POST", body: form });
            })(),
    );
    return { id: result.id, title: result.title };
  }

  // One link's add: the server routes YouTube links and direct media links
  // to video documents, everything else to the article parse.
  async function addLink(url: string): Promise<Added[]> {
    const video = parseYouTubeId(url) || isMediaUrl(url);
    setSteps(initialIngestSteps(video ? (parseYouTubeId(url) ? "youtube" : "media") : "url"));
    const result = await ingestAndFinish(
      await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          video
            ? { url, notebookId }
            : // The box runs the scans itself, in the finishing step.
              { url, notebookId, scans: "client" },
        ),
      }),
    );
    return result.documents ?? [{ id: result.id, title: result.title }];
  }

  // ── The add itself: runs at once for one document; after the layout
  // question for two or more ──────────────────────────────────────────────
  const startedRef = useRef(false);
  async function runAdd() {
    setError(null);
    setPhase("adding");
    const collected: Added[] = [];
    const failed: string[] = [];
    saveDetailRef.current = null;
    addStartedAtRef.current = Date.now();
    setAddStartedAt(addStartedAtRef.current);
    // A multi upload opens as one page once every member is in: no member
    // opens early on its own.
    const multi = layout === "multi" && itemCount > 1;
    earlyOpenRef.current = multi ? "off" : "pending";

    if (request.kind === "url" || request.kind === "video-url") {
      try {
        collected.push(...(await addLink(request.url)));
      } catch (err) {
        failed.push(
          t("panes.uploadPageFailed", {
            title: request.url,
            reason: err instanceof Error ? err.message : t("panes.ingestFailed"),
          }),
        );
      }
    } else if (request.kind === "batch") {
      // A batch (SPEC.md §22): links and files of every kind, one request
      // each, in the order the dialog queued them.
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const title = item.kind === "file" ? item.file.name : item.url;
        setHeadline(
          items.length > 1 ? t("panes.uploadFileProgress", { i: i + 1, total: items.length, title }) : null,
        );
        try {
          if (item.kind === "file") collected.push(await addFile(item.file));
          else collected.push(...(await addLink(item.url)));
        } catch (err) {
          failed.push(
            t("panes.uploadPageFailed", {
              title,
              reason: err instanceof Error ? err.message : t("panes.uploadFailed"),
            }),
          );
        }
      }
    } else if (request.kind === "drive") {
      // One import per pick, like multiple local files (SPEC.md §14). The
      // token rides each request.
      for (let i = 0; i < driveFiles.length; i++) {
        const file = driveFiles[i];
        const kind = driveKindOf(file);
        setHeadline(
          driveFiles.length > 1
            ? t("panes.uploadFileProgress", { i: i + 1, total: driveFiles.length, title: file.name })
            : null,
        );
        if (kind === "unsupported") {
          failed.push(t("panes.driveUnsupportedFile", { name: file.name }));
          continue;
        }
        if (kind === "media" && file.sizeBytes !== null && file.sizeBytes > MAX_VIDEO_BYTES) {
          failed.push(t("panes.fileTooLarge", { name: file.name, mb: 200 }));
          continue;
        }
        if (kind === "pdf" && file.sizeBytes !== null && file.sizeBytes > MAX_PDF_BYTES) {
          failed.push(t("panes.fileTooLarge", { name: file.name, mb: 50 }));
          continue;
        }
        setSteps(initialIngestSteps(kind === "media" ? "media" : "drive"));
        try {
          const result = await ingestAndFinish(
            await fetch("/api/drive/import", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${request.token}`,
              },
              body: JSON.stringify({
                notebookId,
                fileId: file.id,
                name: file.name,
                mimeType: file.mimeType,
                // The box runs the scans itself, in the finishing step.
                scans: "client",
              }),
            }),
          );
          collected.push({ id: result.id, title: result.title });
        } catch (err) {
          failed.push(
            t("panes.uploadPageFailed", {
              title: file.name,
              reason: err instanceof Error ? err.message : t("panes.uploadFailed"),
            }),
          );
        }
      }
    } else {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setHeadline(
          files.length > 1
            ? t("panes.uploadFileProgress", { i: i + 1, total: files.length, title: file.name })
            : null,
        );
        try {
          collected.push(await addFile(file));
        } catch (err) {
          failed.push(
            t("panes.uploadPageFailed", {
              title: file.name,
              reason: err instanceof Error ? err.message : t("panes.uploadFailed"),
            }),
          );
        }
      }
    }

    // A multi upload (SPEC.md §22): the documents that landed become one
    // page. With one document there is nothing to put together, so it opens
    // on its own like every add.
    let multiId: string | null = null;
    if (multi && collected.length > 1) {
      setHeadline(t("panes.uploadMakingMulti"));
      try {
        const made = await api<{ id: string }>("/api/multi", "POST", {
          notebookId,
          documentIds: collected.map((d) => d.id),
        });
        multiId = made.id;
      } catch (err) {
        failed.push(err instanceof Error ? err.message : t("panes.uploadFailed"));
      }
    }

    setAdded(collected);
    setFailures(failed);
    setHeadline(null);
    if (collected.length === 0) {
      setPhase("done");
      setSteps(null);
      setError(failed.join(" ") || t("panes.uploadFailed"));
      if (hiddenRef.current) onShow();
      return;
    }
    setPhase("done");
    const target: OpenTarget = multiId
      ? { kind: "multi", id: multiId }
      : { kind: "document", id: collected[0].id };
    setOpenTarget(target);
    // Clean adds close themselves; failures stay visible until Close, and so
    // does a lost figure: a single add whose figure check found a caption
    // without a figure. A clean figure check line shows long enough to read.
    const lost =
      itemCount === 1 &&
      (ingestCounts(saveDetailRef.current ?? "")?.captionsWithoutFigure ?? 0) > 0;
    if (failed.length === 0 && !lost) {
      setTimeout(() => onClose(target), collected.length > 1 || saveDetailRef.current ? 900 : 300);
    } else if (hiddenRef.current) {
      // A hidden box comes back with the failure or the lost figure to read.
      onShow();
    }
  }

  useEffect(() => {
    if (startedRef.current || itemCount > 1) return;
    startedRef.current = true;
    void runAdd();
    // Runs once, for the request this box was opened with; two or more
    // documents wait for the layout question's Add.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape and the backdrop close the box; while an add runs they hide it
  // instead — the add runs on, the document bar shows it running.
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isImeKey(e)) return;
      e.stopPropagation();
      if (phase === "adding") onHide();
      else onClose(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, hidden]);

  // The final figure check (SPEC.md §15): the save step's counts of a single
  // add. A batch's last page would stand for the whole batch, so none shows.
  const saveDetail = steps?.find((s) => s.key === "save")?.detail;
  const verification =
    phase === "done" && itemCount === 1 && saveDetail ? ingestCounts(saveDetail) : null;
  const lostFigures =
    (verification?.captionsWithoutFigure ?? 0) > 0 || (verification?.mediaLost.length ?? 0) > 0;

  const amberNote =
    "rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200";
  const sectionLabel = "text-[12px] font-semibold text-sand-600";
  const pill = "rounded-full px-3.5 py-1.5 text-xs font-semibold";

  if (hidden) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={() => (phase === "adding" ? onHide() : onClose(null))}
      role="dialog"
      aria-modal
      aria-label={t("panes.uploadAssistant")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[480px] max-w-full flex-col gap-3 overflow-y-auto rounded-[24px] bg-card p-5 shadow-float"
      >
        <div className="flex items-center gap-2">
          <span className="font-display text-[17px]">{t("panes.uploadAssistant")}</span>
          <button
            onClick={() => {
              if (phase === "adding") {
                onHide();
                return;
              }
              onClose(null);
            }}
            data-track={phase === "adding" ? "upload-hide" : "upload-close"}
            aria-label={t(phase === "adding" ? "panes.uploadHide" : "common.close")}
            data-tip={t(phase === "adding" ? "panes.uploadHide" : "common.close")}
            className="ml-auto flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
          >
            ✕
          </button>
        </div>
        <p className="truncate text-xs text-sand-500" data-tip={subject}>
          {subject}
        </p>

        {phase === "ready" && (
          <div className="flex flex-col gap-3">
            {request.kind === "batch" && (
              <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-2xl bg-sand-100 p-2">
                {items.map((item, i) => (
                  <li key={i} className="truncate px-2 py-1 text-[13px] text-sand-800">
                    <span className="mr-2 rounded-full bg-sand-200 px-2 py-0.5 text-[11px] font-semibold text-sand-600">
                      {t(uploadItemKindKey(item))}
                    </span>
                    {item.kind === "file" ? item.file.name : item.url}
                  </li>
                ))}
              </ul>
            )}
            {/* The layout question (SPEC.md §22): an add that lands two or more
                documents puts each on its own page, or all on one page as a
                multi upload. */}
            <div className="flex flex-col gap-1.5">
              <span className={sectionLabel}>{t("panes.uploadLayoutQuestion", { n: itemCount })}</span>
              <div className="flex flex-wrap items-center gap-2">
                {(["separate", "multi"] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => setLayout(choice)}
                    data-track={`upload-layout:${choice}`}
                    aria-pressed={layout === choice}
                    className={`${pill} ${layout === choice ? "bg-clay text-clay-fg" : "bg-sand-100 text-sand-700 hover:bg-clay-100"}`}
                  >
                    {t(choice === "separate" ? "panes.uploadLayoutSeparate" : "panes.uploadLayoutMulti")}
                  </button>
                ))}
              </div>
              <p className="text-xs text-sand-500">
                {t(layout === "separate" ? "panes.uploadLayoutSeparateNote" : "panes.uploadLayoutMultiNote")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  startedRef.current = true;
                  void runAdd();
                }}
                data-track="upload-add"
                className="rounded-full bg-clay px-5 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600"
              >
                {t("panes.uploadAddCount", { n: itemCount })}
              </button>
              <button
                onClick={() => onClose(null)}
                data-track="upload-cancel"
                className="ml-auto rounded-full px-3.5 py-1.5 text-xs text-sand-600 hover:bg-clay-100 hover:text-clay-800"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}

        {phase === "adding" && (
          <div className="flex flex-col gap-2.5">
            {steps && (
              <IngestProgress inline fileLabel={headline ?? subject} steps={steps} startedAt={addStartedAt} />
            )}
          </div>
        )}

        {phase === "done" && (
          <div className="flex flex-col gap-2.5">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-sand-800">
              <CheckIcon size={14} className="text-sage" />
              {added.length > 1
                ? t("panes.uploadAddedCount", { n: added.length })
                : (added[0]?.title ?? t("common.done"))}
            </p>
            {verification && (
              <p className={lostFigures ? amberNote : "text-xs text-sand-500"}>
                {[
                  t("panes.uploadFiguresLoaded", { n: verification.figures }),
                  verification.captionsWithoutFigure > 0
                    ? captionsWithoutFigureText(t, verification.captionsWithoutFigure)
                    : t("panes.uploadEveryCaptionHasFigure"),
                  ...(verification.mediaLost.length > 0
                    ? [mediaLostText(t, verification)]
                    : verification.media > 0
                      ? [t("panes.uploadEveryMediaLoaded", { n: verification.media })]
                      : []),
                ].join(" · ")}
              </p>
            )}
            {(failures.length > 0 || lostFigures) && (
              <>
                {failures.length > 0 && (
                  <ul className="flex flex-col gap-1 text-xs text-red-500">
                    {failures.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
                <button
                  onClick={() => onClose(openTarget)}
                  data-track="upload-done"
                  className="self-start rounded-full bg-clay px-5 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600"
                >
                  {t("common.close")}
                </button>
              </>
            )}
            {error && failures.length === 0 && <p className="text-xs text-red-500">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
