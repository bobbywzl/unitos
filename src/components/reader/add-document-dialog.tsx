"use client";

import { useEffect, useRef, useState } from "react";
import { isImeKey } from "@/lib/ime";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";
import type { DriveAccess } from "@/lib/drive/types";
import { IngestProgress, type IngestStep } from "@/components/reader/ingest-progress";

export type LibraryDocument = { id: string; title: string; _count: { blocks: number } };

// The add-document dialog: one centered window for everything that adds a
// document, opened by the dashed +. Files and a URL are the only two ways
// in — a big drop-or-choose space for files, a box for a URL beneath it —
// so the dialog never asks what kind of thing is coming in; it hands off to
// the upload box, which imports it right away. Google Drive and the library
// stay one small button each, off to the side.
export function AddDocumentDialog({
  open,
  onClose,
  busy,
  phase,
  error,
  onError,
  onAddFiles,
  fileAccept,
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
  onAddFiles: (files: File[]) => void;
  fileAccept: string;
  onImportDrive: (() => void) | null; // null: Google Drive is not configured
  // Link Google Drive (SPEC.md §14): linked shows the state — the grant's
  // access, and Link again when it reaches picked files only while the
  // deployment asks for all; canLink offers the link flow. null when Drive is
  // not configured.
  driveLink: { linked: boolean; canLink: boolean; access: DriveAccess; grant: DriveAccess | null } | null;
  onIngestUrl: (url: string) => Promise<boolean>; // true: document added and opened
  library: LibraryDocument[] | null;
  attachedIds: Set<string>;
  onOpenLibrary: () => void;
  onAttach: (documentId: string) => void;
  onRemoveFromLibrary: (documentId: string) => void;
}) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [over, setOver] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // A fresh open starts clean: no stale URL text, the library list collapsed.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setUrl("");
      setLibraryOpen(false);
    }
  }

  async function addUrl(e: React.FormEvent) {
    e.preventDefault();
    if (await onIngestUrl(url)) setUrl("");
  }

  function hasFiles(e: React.DragEvent): boolean {
    return e.dataTransfer?.types.includes("Files") ?? false;
  }

  const smallButton =
    "text-xs font-semibold text-sand-600 hover:text-clay-800 disabled:opacity-40";

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
        className="flex max-h-[85vh] w-[520px] max-w-full flex-col gap-4 overflow-y-auto rounded-[24px] bg-card p-6 shadow-float"
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

        {phase ? (
          <div className="flex min-h-[220px] flex-1 items-center justify-center">
            <IngestProgress inline fileLabel={phase.fileLabel} steps={phase.steps} />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                setOver(true);
              }}
              onDragLeave={(e) => {
                if (hasFiles(e)) setOver(false);
              }}
              onDrop={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                setOver(false);
                const dropped = [...(e.dataTransfer?.files ?? [])];
                if (dropped.length > 0) onAddFiles(dropped);
              }}
              disabled={busy}
              data-track="add-drop-zone"
              className={`flex min-h-[170px] flex-col items-center justify-center gap-1.5 rounded-[20px] border-2 border-dashed px-6 py-8 text-center text-sm font-semibold disabled:opacity-40 ${
                over
                  ? "border-clay bg-clay-100/40 text-clay-800"
                  : "border-sand-300 text-sand-800 hover:border-clay hover:bg-clay-100/40 hover:text-clay-800"
              }`}
            >
              {t("panes.dropOrChoose")}
              <span className="text-xs font-normal text-sand-500">{t("panes.dropZoneHint")}</span>
            </button>

            <form className="flex flex-col gap-1.5" onSubmit={(e) => void addUrl(e)}>
              <div className="flex items-center gap-2">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  aria-label={t("panes.documentUrl")}
                  className="min-w-0 flex-1 rounded-full bg-sand-100 px-4 py-2 text-sm outline-none placeholder:text-sand-500"
                />
                <button
                  type="submit"
                  data-track="add-url"
                  disabled={busy || !url.trim()}
                  className="shrink-0 rounded-full bg-clay px-4 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                >
                  {t("panes.ingest")}
                </button>
              </div>
              <span className="text-[11px] text-sand-500">{t("panes.urlHint")}</span>
            </form>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3">
              {onImportDrive && (
                <button
                  onClick={onImportDrive}
                  data-track="add-drive"
                  disabled={busy}
                  className={smallButton}
                >
                  {t("panes.addFromDrive")}
                </button>
              )}
              <button
                onClick={() => {
                  const next = !libraryOpen;
                  setLibraryOpen(next);
                  if (next) onOpenLibrary();
                }}
                data-track="add-library-toggle"
                aria-expanded={libraryOpen}
                className={smallButton}
              >
                {t("panes.library")}
              </button>
            </div>
            {onImportDrive && driveLink && (driveLink.linked || driveLink.canLink) && (
              <p className="-mt-2 text-[11px] text-sand-500">
                {driveLink.linked
                  ? t(
                      driveLink.grant === "all"
                        ? "panes.driveLinkedAll"
                        : driveLink.access === "all"
                          ? "panes.driveLinkedPickedRelink"
                          : "panes.driveLinkedPicked",
                    )
                  : t("panes.driveLinkFirstHint")}
              </p>
            )}

            {libraryOpen && (
              <ul className="max-h-40 flex-1 overflow-y-auto rounded-2xl bg-sand-100 p-1">
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
          </>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={fileAccept}
          className="hidden"
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            e.target.value = "";
            onError(null);
            if (picked.length > 0) onAddFiles(picked);
          }}
        />
      </div>
    </div>
    )}
    </Presence>
  );
}
