"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { DownloadIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { BOTTOM_STATUS } from "@/components/progress-bar";
import type { AttachedDocument } from "@/components/reader/document-bar";
import { useEscapeLayer } from "@/lib/escape-layers";
import type { TKey } from "@/lib/i18n/dictionaries";

// Download (SPEC.md §15): the open document as a file, as File > Download
// gives one in Google Docs — Microsoft Word, PDF, a web page, Markdown,
// plain text, and the file as it was added where one is stored. One button
// in the header for every document.
//
// A document with rich text (a blank document, an import) is downloaded by
// the page editor's own code (docs/page/download.ts), from the page as it
// is. Every other document comes from the server
// (/api/documents/[documentId]/export), made from its blocks; its PDF is
// the web page printed, with the browser's Save as PDF.
//
// A download is the document alone: no note, annotation, comment, or reply
// goes into any file. A recording downloads as its transcript, never as its
// video or audio.

/** Opens the menu from outside the header: the phone's More menu. */
export const DOWNLOAD_OPEN_EVENT = "dissect:open-download";

type Format = "docx" | "pdf" | "html" | "md" | "txt" | "original";

const ROWS: { format: Exclude<Format, "original">; label: TKey }[] = [
  { format: "docx", label: "panes.downloadDocx" },
  { format: "pdf", label: "panes.downloadPdf" },
  { format: "html", label: "panes.downloadHtml" },
  { format: "md", label: "panes.downloadMarkdown" },
  { format: "txt", label: "panes.downloadTxt" },
];

/** The stored file's extension, where the document's kind tells it. */
const ORIGINAL_EXTENSION: Partial<Record<AttachedDocument["kind"], string>> = { pdf: ".pdf", word: ".docx", slides: ".pptx" };

/** The page editor of the pane that shows the document, when it has one. */
function pageEditorOf(documentId: string): Editor | null {
  const pane = document.querySelector(`[data-reader-root][data-document-id="${CSS.escape(documentId)}"]`);
  const body = pane?.querySelector<HTMLElement & { editor?: Editor }>("[data-docs-body]");
  return body?.editor && !body.editor.isDestroyed ? body.editor : null;
}

/** The file's name as the server sent it. */
function sentName(res: Response, fallback: string): string {
  const header = res.headers.get("Content-Disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  try {
    if (encoded) return decodeURIComponent(encoded);
  } catch {
    // The plain name, then.
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback;
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Print a web page of the document in a frame of its own: the print dialog
    saves it as a PDF. The frame runs no script. */
function printPage(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.setAttribute("aria-hidden", "true");
    Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
    frame.onload = () => {
      const page = frame.contentWindow;
      if (!page) return reject(new Error("no frame"));
      const pictures = [...(frame.contentDocument?.images ?? [])];
      // The pictures are in before the dialog opens, or the PDF has holes; no
      // picture holds it past 8 s.
      const loaded = Promise.all(pictures.map((img) => (img.complete ? null : new Promise((done) => (img.onload = img.onerror = done)))));
      void Promise.race([loaded, new Promise((done) => window.setTimeout(done, 8000))]).then(() => {
        page.focus();
        page.print();
        resolve();
        // The dialog holds the page while it is open; the frame goes after.
        window.setTimeout(() => frame.remove(), 60_000);
      });
    };
    frame.srcdoc = html;
    document.body.append(frame);
  });
}

export function DownloadMenu({ document: doc }: { document: AttachedDocument | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEscapeLayer(open, () => setOpen(false));

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(DOWNLOAD_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(DOWNLOAD_OPEN_EVENT, onOpen);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  // A line under the page says what did not work, for a moment.
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 6000);
    return () => window.clearTimeout(timer);
  }, [status]);

  if (!doc) return null;
  const base = `/api/documents/${encodeURIComponent(doc.id)}/export`;

  async function download(format: Format) {
    if (!doc || busy) return;
    setOpen(false);
    setBusy(format);
    setStatus(null);
    try {
      const editor = format === "original" ? null : pageEditorOf(doc.id);
      if (editor && format !== "original") {
        const { downloadDocument } = await import("@/components/docs/page/download");
        await downloadDocument(editor, format);
        return;
      }
      if (format === "pdf") {
        const res = await fetch(`${base}?format=html&inline=1`);
        if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "");
        setStatus(t("docsPage.choosePdf"));
        await printPage(await res.text());
        return;
      }
      const res = await fetch(`${base}?format=${format}`);
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "");
      save(await res.blob(), sentName(res, doc.title));
    } catch (err) {
      setStatus((err instanceof Error && err.message) || t("common.requestFailed"));
    } finally {
      setBusy(null);
    }
  }

  const row = "flex w-full items-center rounded-xl px-3 py-2 text-left text-[13px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 pointer-coarse:py-3";
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={busy !== null}
        data-track="download"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("panes.download")}
        data-tip={open ? undefined : t("panes.downloadTitle")}
        className={`hidden size-[34px] shrink-0 items-center justify-center rounded-full border disabled:opacity-40 md:flex ${
          open ? "border-clay-300 bg-clay-200 text-clay-800" : "border-line text-sand-600 hover:bg-clay-100 hover:text-clay-800"
        }`}
      >
        <DownloadIcon size={16} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("panes.download")}
          className="pop-in fixed inset-x-3 bottom-[calc(66px+env(safe-area-inset-bottom))] z-40 flex flex-col rounded-2xl bg-card p-1.5 shadow-float md:absolute md:inset-x-auto md:top-full md:right-0 md:bottom-auto md:mt-2 md:w-64"
        >
          <p className="px-3 pt-1.5 pb-1 text-[10.5px] font-bold tracking-[0.08em] text-sand-500 uppercase">
            {t(doc.hasVideo ? "panes.downloadTranscript" : "panes.download")}
          </p>
          {ROWS.map(({ format, label }) => (
            <button key={format} role="menuitem" onClick={() => void download(format)} data-track={`download:${format}`} className={row}>
              {t(label)}
            </button>
          ))}
          {doc.hasFile && (
            <div className="mt-1 border-t border-line pt-1">
              <button
                role="menuitem"
                onClick={() => void download("original")}
                data-track="download:original"
                data-tip={t("panes.downloadOriginalTitle")}
                className={row}
              >
                {t("panes.downloadOriginal")}
                {ORIGINAL_EXTENSION[doc.kind] ? ` (${ORIGINAL_EXTENSION[doc.kind]})` : ""}
              </button>
            </div>
          )}
          <p className="px-3 pt-1.5 pb-1.5 text-[11px] leading-snug text-sand-500">{t("panes.downloadAlone")}</p>
        </div>
      )}
      {(busy || status) && (
        <div role="status" className={`${BOTTOM_STATUS} z-40 w-max max-w-[calc(100vw-32px)] rounded-full bg-ink/90 px-3 py-1.5 text-xs text-paper`}>
          {status ?? t("panes.downloadPreparing")}
        </div>
      )}
    </div>
  );
}
