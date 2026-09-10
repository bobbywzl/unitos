"use client";

import { useEffect, useRef, useState } from "react";
import { isImeKey } from "@/lib/ime";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";
import { parseDriveFileId, type DriveAccess } from "@/lib/drive/types";
import { IMAGE_ACCEPT } from "@/lib/handwritten/image";
import { MARKDOWN_ACCEPT } from "@/lib/markdown-file";
import {
  IngestProgress,
  type IngestStep,
} from "@/components/reader/ingest-progress";
import type { UploadItem, UploadRequest } from "@/components/reader/upload-assistant";
import { isMediaUrl } from "@/lib/video/types";
import { parseYouTubeId } from "@/lib/video/youtube";

export type LibraryDocument = { id: string; title: string; _count: { blocks: number } };

export type AddTab = "pdf" | "video" | "drive" | "url" | "library";

// The file kinds the PDF tab and the video tab accept (document-bar.tsx
// drag-and-drop accepts the same).
const PDF_ACCEPT = `application/pdf,.pdf,${IMAGE_ACCEPT},${MARKDOWN_ACCEPT}`;
const VIDEO_ACCEPT =
  "video/mp4,video/webm,video/ogg,video/quicktime,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/flac,audio/ogg,.mp4,.m4v,.webm,.ogv,.ogg,.mov,.mp3,.m4a,.m4b,.aac,.wav,.flac,.oga,.opus";

// The links in a typed or pasted text: one per line or per space. A token
// that is not an http(s) link is dropped.
function parseLinks(raw: string): string[] {
  const out: string[] = [];
  for (const token of raw.split(/\s+/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      if (url.protocol === "http:" || url.protocol === "https:") out.push(trimmed);
    } catch {
      // not a link
    }
  }
  return out;
}

// One request for the queue (SPEC.md §22): a lone link keeps the URL review,
// files alone keep the files box, everything else is a batch.
function requestFor(items: UploadItem[]): UploadRequest {
  if (items.length === 1 && items[0].kind !== "file") return items[0];
  if (items.every((item) => item.kind === "file")) {
    return { kind: "files", files: items.flatMap((item) => (item.kind === "file" ? [item.file] : [])) };
  }
  return { kind: "batch", items };
}

// The add-document dialog: one centered window for everything that adds a
// document, opened by the dashed +. The upload types span the top panel as
// tabs; under them sits the upload space for the chosen type — replaced by
// the progress card while an ingest runs — then the list of what is queued
// and the upload assistant note. Links and files of every kind queue
// together (SPEC.md §22): Enter after a link queues it, choosing files
// queues them, and Continue hands the queue to the upload assistant box
// (SPEC.md §15), which reviews it and drives the add. Google Drive and
// Library skip the box.
export function AddDocumentDialog({
  open,
  onClose,
  busy,
  phase,
  error,
  onError,
  onSubmit,
  onImportDrive,
  driveLink,
  onDriveLink,
  library,
  attachedIds,
  onOpenLibrary,
  onAttach,
  onRemoveFromLibrary,
  initialTab,
}: {
  open: boolean;
  onClose: () => void;
  busy: boolean; // an ingest is running
  phase: { fileLabel: string; steps: IngestStep[] } | null;
  error: string | null;
  onError: (message: string | null) => void;
  // The queue goes to the upload assistant box.
  onSubmit: (request: UploadRequest) => void;
  onImportDrive: (() => void) | null; // null: Google Drive is not configured, no tab
  // Link Google Drive (SPEC.md §14): linked shows the state — the grant's
  // access, and Link again when it reaches picked files only while the
  // deployment asks for all; canLink offers the link flow. null when Drive is
  // not configured.
  driveLink: { linked: boolean; canLink: boolean; access: DriveAccess; grant: DriveAccess | null } | null;
  // A pasted Google Drive link imports on its own, outside the queue
  // (SPEC.md §14). Returns whether the import started.
  onDriveLink: (url: string) => Promise<boolean>;
  library: LibraryDocument[] | null;
  attachedIds: Set<string>;
  onOpenLibrary: () => void;
  onAttach: (documentId: string) => void;
  onRemoveFromLibrary: (documentId: string) => void;
  // Set: the dialog opens on this tab (back from Link Google Drive, the Drive
  // tab). Null: it opens where it was last.
  initialTab?: AddTab | null;
}) {
  const t = useT();
  // The dialog opens on URL, the first tab.
  const [tab, setTabState] = useState<AddTab>("url");
  // Opening on the requested tab: adjust during render (the Presence
  // pattern), so the first frame of the open dialog already shows it.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open && initialTab) setTabState(initialTab);
  }
  const [url, setUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  // The queue: what Continue hands to the box, in the order it was added.
  const [items, setItems] = useState<UploadItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);

  function queue(next: UploadItem[]) {
    if (next.length === 0) return;
    onError(null);
    setItems((current) => [...current, ...next]);
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, i) => i !== index));
  }

  function queueFiles(files: File[]) {
    queue(files.map((file) => ({ kind: "file" as const, file })));
    if (fileRef.current) fileRef.current.value = "";
    if (videoFileRef.current) videoFileRef.current.value = "";
  }

  function submit() {
    if (items.length === 0) return;
    onSubmit(requestFor(items));
    setItems([]);
    setUrl("");
    setVideoUrl("");
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImeKey(e)) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  function setTab(next: AddTab) {
    setTabState(next);
    onError(null);
    if (next === "library") onOpenLibrary();
  }

  // Enter after a link queues it (several links at once queue each). A
  // Google Drive link imports on its own. A video link queues as a video.
  async function addUrl(e: React.FormEvent) {
    e.preventDefault();
    const links = parseLinks(url);
    if (links.length === 0) {
      if (url.trim()) onError(t("panes.notLink"));
      return;
    }
    if (links.length === 1 && parseDriveFileId(links[0])) {
      if (await onDriveLink(links[0])) setUrl("");
      return;
    }
    queue(
      links.map((link) =>
        parseYouTubeId(link) || isMediaUrl(link)
          ? { kind: "video-url" as const, url: link }
          : { kind: "url" as const, url: link },
      ),
    );
    setUrl("");
  }

  // Takes a YouTube link or a direct video or audio file link; files go
  // through the choose button above.
  function addVideo(e: React.FormEvent) {
    e.preventDefault();
    const links = parseLinks(videoUrl);
    if (links.length === 0 || links.some((link) => !parseYouTubeId(link) && !isMediaUrl(link))) {
      onError(t("panes.notVideoLink"));
      return;
    }
    queue(links.map((link) => ({ kind: "video-url" as const, url: link })));
    setVideoUrl("");
  }

  // Tab order: URL, PDF or image, Video or audio, Google Drive, Library.
  const tabs: { key: AddTab; label: string }[] = [
    { key: "url", label: t("panes.addUrl") },
    { key: "pdf", label: t("panes.uploadPdf") },
    { key: "video", label: t("panes.uploadVideo") },
    ...(onImportDrive
      ? [{ key: "drive" as const, label: t("panes.tabDrive") }]
      : []),
    { key: "library", label: t("panes.library") },
  ];
  const chooseArea =
    "flex flex-1 flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-sand-300 px-6 py-8 text-sm font-semibold text-sand-800 hover:border-clay hover:bg-clay-100/40 hover:text-clay-800 disabled:opacity-40";
  const submitButton =
    "shrink-0 rounded-full bg-clay px-4 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40";
  const urlInput =
    "min-w-0 flex-1 rounded-full bg-sand-100 px-4 py-2 text-sm outline-none placeholder:text-sand-500";

  return (
    <Presence show={open} exit="dialog">
    {open && (
    <div
      className="dialog-in fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={t("panes.addDocument")}
      data-nudge-pause
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[600px] max-w-full flex-col gap-4 overflow-y-auto rounded-[24px] bg-card p-6 shadow-float"
      >
        <div className="flex items-center">
          <span className="font-display text-[20px]">{t("panes.addDocument")}</span>
          <button
            onClick={onClose}
            data-track="add-dialog-close"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className="ml-auto flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
          >
            ✕
          </button>
        </div>

        <div
          role="tablist"
          aria-label={t("panes.addDocument")}
          className="flex w-full gap-1 overflow-x-auto rounded-full bg-sand-100 p-1"
        >
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              data-track={`add-tab:${key}`}
              className={`flex-auto rounded-full px-2 py-1.5 text-[12.5px] whitespace-nowrap ${
                tab === key
                  ? "bg-card font-semibold text-clay-800 shadow-soft"
                  : "text-sand-600 hover:text-clay-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex min-h-[280px] flex-col">
          {phase ? (
            <div className="flex flex-1 items-center justify-center">
              <IngestProgress inline fileLabel={phase.fileLabel} steps={phase.steps} />
            </div>
          ) : tab === "pdf" ? (
            <div className="flex flex-1 flex-col gap-2">
              <button onClick={() => fileRef.current?.click()} data-track="add-choose-pdf" disabled={busy} className={chooseArea}>
                {t("panes.choosePdf")}
              </button>
              <span className="text-center text-[11px] text-sand-500">{t("panes.pdfHint")}</span>
            </div>
          ) : tab === "video" ? (
            <div className="flex flex-1 flex-col gap-2">
              <button onClick={() => videoFileRef.current?.click()} data-track="add-choose-video" disabled={busy} className={chooseArea}>
                {t("panes.chooseVideoFile")}
              </button>
              <span className="text-center text-[11px] text-sand-500">{t("panes.videoHint")}</span>
              <form className="flex items-center gap-2" onSubmit={addVideo}>
                <input
                  autoFocus
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  aria-label={t("panes.youtubeLink")}
                  className={urlInput}
                />
                <button type="submit" data-track="add-video-url" disabled={busy} className={submitButton}>
                  {t("panes.queueLink")}
                </button>
              </form>
            </div>
          ) : tab === "drive" ? (
            <div className="flex flex-1 flex-col gap-2">
              <button onClick={onImportDrive ?? undefined} data-track="add-drive" disabled={busy} className={chooseArea}>
                {t("panes.addFromDrive")}
              </button>
              <span className="text-center text-[11px] text-sand-500">{t("panes.driveHint")}</span>
              {driveLink?.linked ? (
                <span className="text-center text-[11px] text-sand-500">
                  {t(
                    driveLink.grant === "all"
                      ? "panes.driveLinkedAll"
                      : driveLink.access === "all"
                        ? "panes.driveLinkedPickedRelink"
                        : "panes.driveLinkedPicked",
                  )}
                </span>
              ) : driveLink?.canLink ? (
                <span className="text-center text-[11px] text-sand-500">
                  {t("panes.driveLinkFirstHint")}
                </span>
              ) : null}
            </div>
          ) : tab === "url" ? (
            <form className="flex flex-1 flex-col gap-2" onSubmit={(e) => void addUrl(e)}>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  aria-label={t("panes.documentUrl")}
                  className={urlInput}
                />
                <button type="submit" data-track="add-url" disabled={busy} className={submitButton}>
                  {t("panes.queueLink")}
                </button>
              </div>
              <span className="text-[11px] text-sand-500">{t("panes.urlHint")}</span>
            </form>
          ) : (
            <ul className="flex-1 overflow-y-auto">
              {library === null && (
                <li className="px-3 py-2 text-sm text-sand-500">{t("common.loading")}</li>
              )}
              {library !== null &&
                library.filter((d) => !attachedIds.has(d.id)).length === 0 && (
                  <li className="px-3 py-2 text-sm text-sand-500">
                    {t("panes.noOtherDocuments")}
                  </li>
                )}
              {library
                ?.filter((d) => !attachedIds.has(d.id))
                .map((d) => (
                  <li key={d.id} className="flex items-center gap-1">
                    <button
                      onClick={() => onAttach(d.id)}
                      data-track="add-library-attach"
                      data-tip={t("panes.attachTitle")}
                      className="min-w-0 flex-1 truncate rounded-full px-3 py-2 text-left text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                    >
                      {d.title}{" "}
                      <span className="text-xs text-sand-500">
                        {t("panes.blockCount", { n: d._count.blocks })}
                      </span>
                    </button>
                    <button
                      onClick={() => onRemoveFromLibrary(d.id)}
                      data-track="add-library-delete"
                      className="rounded-full px-2 py-1 text-xs text-sand-400 hover:text-red-500"
                      data-tip={t("panes.deleteFromLibrary")}
                    >
                      ✕
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        {/* The queue (SPEC.md §22): every link and file waiting for Continue. */}
        {items.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <span className="text-[13px] font-semibold text-sand-800">
              {t("panes.queuedCount", { n: items.length })}
            </span>
            <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-2xl bg-sand-100 p-2">
              {items.map((item, i) => (
                <li key={i} className="flex items-center gap-2 px-2 py-1 text-[13px] text-sand-800">
                  <span className="min-w-0 flex-1 truncate">
                    {item.kind === "file" ? item.file.name : item.url}
                  </span>
                  <button
                    onClick={() => removeItem(i)}
                    data-track="add-queue-remove"
                    aria-label={t("common.remove")}
                    data-tip={t("common.remove")}
                    className="shrink-0 rounded-full px-2 py-0.5 text-xs text-sand-400 hover:text-red-500"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-sand-500">{t("panes.queueHint")}</p>
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-line pt-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[13px] font-semibold text-sand-800">
              {t("panes.uploadAssistant")}
            </span>
            <p className="text-xs text-sand-500">{t("panes.uploadAssistantHint")}</p>
          </div>
          <button
            onClick={submit}
            data-track="add-continue"
            disabled={busy || items.length === 0}
            className={submitButton}
          >
            {items.length > 1 ? t("panes.continueWithCount", { n: items.length }) : t("panes.continue")}
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={PDF_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => queueFiles([...(e.target.files ?? [])])}
        />
        <input
          ref={videoFileRef}
          type="file"
          accept={VIDEO_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => queueFiles([...(e.target.files ?? [])])}
        />
      </div>
    </div>
    )}
    </Presence>
  );
}
