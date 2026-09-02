"use client";

import { useEffect, useState } from "react";
import { isImeKey } from "@/lib/ime";
import { useT } from "@/components/lang-provider";
import {
  IngestProgress,
  type IngestStep,
} from "@/components/reader/ingest-progress";
import { isMediaUrl } from "@/lib/video/types";
import { parseYouTubeId } from "@/lib/video/youtube";

export type LibraryDocument = { id: string; title: string; _count: { blocks: number } };

type AddTab = "pdf" | "video" | "drive" | "url" | "library";

// The add-document dialog: one centered window for everything that adds a
// document, opened by the dashed +. The upload types span the top panel as
// tabs; under them sits the upload space for the chosen type — replaced by
// the progress card while an ingest runs — then the upload assistant note.
// Choosing content hands off to the upload assistant box (SPEC.md §15),
// which reviews it and drives the add; Google Drive and Library skip the box.
export function AddDocumentDialog({
  open,
  onClose,
  busy,
  phase,
  error,
  onError,
  onChoosePdf,
  onChooseVideo,
  onImportDrive,
  driveLink,
  onIngestUrl,
  library,
  attachedIds,
  onOpenLibrary,
  onAttach,
  onRemoveFromLibrary,
}: {
  open: boolean;
  onClose: () => void;
  busy: boolean; // an ingest is running
  phase: { fileLabel: string; steps: IngestStep[] } | null;
  error: string | null;
  onError: (message: string | null) => void;
  onChoosePdf: () => void;
  onChooseVideo: () => void;
  onImportDrive: (() => void) | null; // null: Google Drive is not configured, no tab
  // Link Google Drive (SPEC.md §14): linked shows the state; canLink offers
  // the link flow. null when Drive is not configured.
  driveLink: { linked: boolean; canLink: boolean } | null;
  onIngestUrl: (url: string) => Promise<boolean>; // true: document added and opened
  library: LibraryDocument[] | null;
  attachedIds: Set<string>;
  onOpenLibrary: () => void;
  onAttach: (documentId: string) => void;
  onRemoveFromLibrary: (documentId: string) => void;
}) {
  const t = useT();
  const [tab, setTabState] = useState<AddTab>("pdf");
  const [url, setUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

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

  if (!open) return null;

  function setTab(next: AddTab) {
    setTabState(next);
    onError(null);
    if (next === "library") onOpenLibrary();
  }

  // Where the Link Google Drive callback returns to: this workspace.
  function currentPath(): string {
    if (typeof window === "undefined") return "/";
    return window.location.pathname + window.location.search;
  }

  async function addUrl(e: React.FormEvent) {
    e.preventDefault();
    if (await onIngestUrl(url)) setUrl("");
  }

  // Takes a YouTube link or a direct video or audio file link; files go
  // through the choose button above.
  async function addVideo(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = videoUrl.trim();
    if (!trimmed) return;
    if (!parseYouTubeId(trimmed) && !isMediaUrl(trimmed)) {
      onError(t("panes.notVideoLink"));
      return;
    }
    if (await onIngestUrl(trimmed)) setVideoUrl("");
  }

  const tabs: { key: AddTab; label: string }[] = [
    { key: "pdf", label: t("panes.uploadPdf") },
    { key: "video", label: t("panes.uploadVideo") },
    ...(onImportDrive
      ? [{ key: "drive" as const, label: t("panes.addFromDrive") }]
      : []),
    { key: "url", label: t("panes.addUrl") },
    { key: "library", label: t("panes.library") },
  ];
  const chooseArea =
    "flex flex-1 flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-sand-300 px-6 py-8 text-sm font-semibold text-sand-800 hover:border-clay hover:bg-clay-100/40 hover:text-clay-800 disabled:opacity-40";
  const submit =
    "shrink-0 rounded-full bg-clay px-4 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40";
  const urlInput =
    "min-w-0 flex-1 rounded-full bg-sand-100 px-4 py-2 text-sm outline-none placeholder:text-sand-500";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={t("panes.addDocument")}
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
            className="ml-auto flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
          >
            ✕
          </button>
        </div>

        <div
          role="tablist"
          aria-label={t("panes.addDocument")}
          className="flex w-full gap-1 rounded-full bg-sand-100 p-1"
        >
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              data-track={`add-tab:${key}`}
              title={label}
              className={`min-w-0 flex-auto truncate rounded-full px-2 py-1.5 text-[12.5px] ${
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
              <button onClick={onChoosePdf} data-track="add-choose-pdf" disabled={busy} className={chooseArea}>
                {t("panes.choosePdf")}
              </button>
              <span className="text-center text-[11px] text-sand-500">{t("panes.pdfHint")}</span>
            </div>
          ) : tab === "video" ? (
            <div className="flex flex-1 flex-col gap-2">
              <button onClick={onChooseVideo} data-track="add-choose-video" disabled={busy} className={chooseArea}>
                {t("panes.chooseVideoFile")}
              </button>
              <span className="text-center text-[11px] text-sand-500">{t("panes.videoHint")}</span>
              <form className="flex items-center gap-2" onSubmit={(e) => void addVideo(e)}>
                <input
                  autoFocus
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  aria-label={t("panes.youtubeLink")}
                  className={urlInput}
                />
                <button type="submit" data-track="add-video-url" disabled={busy} className={submit}>
                  {t("panes.addVideo")}
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
                  {t("panes.driveLinked")}
                </span>
              ) : driveLink?.canLink ? (
                <a
                  href={`/api/drive/link?next=${encodeURIComponent(currentPath())}`}
                  className="self-center rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  {t("panes.driveLink")}
                </a>
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
                <button type="submit" data-track="add-url" disabled={busy} className={submit}>
                  {t("panes.ingest")}
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
                      title={t("panes.deleteFromLibrary")}
                    >
                      ✕
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <span className="text-[13px] font-semibold text-sand-800">
            {t("panes.uploadAssistant")}
          </span>
          <p className="text-xs text-sand-500">{t("panes.uploadAssistantHint")}</p>
        </div>
      </div>
    </div>
  );
}
