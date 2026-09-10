"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isImeKey } from "@/lib/ime";
import { useT } from "@/components/lang-provider";
import { CheckIcon, SparkleIcon, SpinnerIcon } from "@/components/icons";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { readNdjson } from "@/lib/ndjson";
import { type FinishPlan, warmImages } from "@/lib/finish";
import { classifyDriveFile, type DrivePickedFile } from "@/lib/drive/types";
import { isImageFile } from "@/lib/handwritten/image";
import { isMarkdownFile } from "@/lib/markdown-file";
import { captionLabel } from "@/lib/parse/figure-audit";
import type { PdfDirectives, UploadReview } from "@/lib/upload-assistant";
import { MAX_VIDEO_BYTES, MEDIA_EXTENSIONS, UPLOAD_CHUNK_BYTES } from "@/lib/video/types";
import { isMediaUrl } from "@/lib/video/types";
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

// The upload assistant (SPEC.md §15): the box that opens on every add. For a
// URL it reviews the page in a private sandbox first — what the content is,
// which caption has no figure, which linked pages are parts of the same work,
// whether to split. Every add imports the content faithfully: the box takes
// no instructions about what to keep or drop. The box drives the adds itself,
// one request per page or file, shows the progress in place, and ends on the
// final figure check. When an add lands two or more documents, the box asks
// first whether they go on separate pages or on one page as a multi upload
// (SPEC.md §22).

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

type Phase = "review" | "ready" | "adding" | "done";
type Added = { id: string; title: string };
type IngestEvent =
  | { stage: string; detail?: string }
  | { id: string; title: string; deduped: boolean; documents?: Added[] }
  | { error: string };
type IngestResult = Extract<IngestEvent, { id: string }>;

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const SINGLE_REQUEST_BYTES = 4 * 1024 * 1024;
const CHUNK_BYTES = UPLOAD_CHUNK_BYTES;
// The sentinel for "this page" in the selected set — never a real URL.
const SELF = "this-page";

// The PDF import, picked in the box (SPEC.md §16). judge: Import PDF decides —
// computer text parses to blocks, rough handwriting imports as pages and
// converts. pages: the whole PDF imports as its pages, exactly as they look,
// no text added. convert: the pages import as they are, then conversion
// writes the handwriting as text after them.
type PdfFormat = "judge" | "pages" | "convert";
const PDF_FORMATS: PdfFormat[] = ["judge", "pages", "convert"];
// An image is one page whatever it shows (SPEC.md §16): no judgment to make,
// so its pick is pages as they are, or pages + convert.
const IMAGE_FORMATS: PdfFormat[] = ["pages", "convert"];
const PDF_FORMAT_LABEL: Record<PdfFormat, TKey> = {
  judge: "panes.uploadPdfJudge",
  pages: "panes.uploadPdfPages",
  convert: "panes.uploadPdfConvert",
};
const PDF_FORMAT_NOTE: Record<PdfFormat, TKey> = {
  judge: "panes.uploadPdfJudgeNote",
  pages: "panes.uploadPdfPagesNote",
  convert: "panes.uploadPdfConvertNote",
};
const IMAGE_FORMAT_NOTE: Record<PdfFormat, TKey> = {
  judge: "panes.uploadImageConvertNote",
  pages: "panes.uploadImagePagesNote",
  convert: "panes.uploadImageConvertNote",
};

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

const REVIEW_STEPS: IngestStep[] = [
  { key: "fetch", labelKey: "panes.stepFetchingPage", status: "active" },
  { key: "extract", labelKey: "panes.stepReadingPage", status: "pending" },
  { key: "review", labelKey: "panes.stepReviewing", status: "pending" },
];

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

function StepList({ steps }: { steps: IngestStep[] }) {
  const t = useT();
  return (
    <ul className="flex flex-col gap-1.5">
      {steps.map((s) => (
        <li key={s.key} className="flex items-center gap-2 text-xs">
          {s.status === "done" ? (
            <CheckIcon size={12} className="shrink-0 text-sage" />
          ) : s.status === "active" ? (
            <SpinnerIcon size={12} className="shrink-0 text-clay motion-safe:animate-spin" />
          ) : (
            <span aria-hidden className="mx-[3px] size-1.5 shrink-0 rounded-full bg-sand-300" />
          )}
          <span className={s.status === "pending" ? "text-sand-500" : "font-medium text-sand-700"}>
            {t(s.labelKey)}
          </span>
        </li>
      ))}
    </ul>
  );
}

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
  const [phase, setPhase] = useState<Phase>(request.kind === "url" ? "review" : "ready");
  const [review, setReview] = useState<UploadReview | null>(null);
  const [reviewSteps, setReviewSteps] = useState<IngestStep[]>(REVIEW_STEPS);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set([SELF]));
  const [split, setSplit] = useState(false);
  const [pdfFormat, setPdfFormat] = useState<PdfFormat>("judge");
  // Where the documents go when the add lands two or more (SPEC.md §22).
  const [layout, setLayout] = useState<UploadLayout>("separate");
  const [steps, setSteps] = useState<IngestStep[] | null>(null);
  const [headline, setHeadline] = useState<string | null>(null);
  const [added, setAdded] = useState<Added[]>([]);
  // What Close opens once the add is done: the first document, or the multi upload.
  const [openTarget, setOpenTarget] = useState<OpenTarget | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const items: UploadItem[] = request.kind === "batch" ? request.items : [];
  const files =
    request.kind === "files"
      ? request.files
      : items.flatMap((item) => (item.kind === "file" ? [item.file] : []));
  const driveFiles = request.kind === "drive" ? request.files : [];
  const driveKindOf = (f: DrivePickedFile) => classifyDriveFile(f.mimeType, f.name);
  // A Drive pick that ends up as PDF bytes (a PDF, or a Doc/Sheet/Slide/Drawing
  // exported to PDF) takes the same import pick a PDF upload takes.
  const hasPdf =
    files.some((f) => !isMediaFile(f) && !isImageFile(f) && !isMarkdownFile(f)) ||
    driveFiles.some((f) => driveKindOf(f) === "pdf" || driveKindOf(f) === "export");
  // An image imports as one handwritten page (SPEC.md §16): it takes the
  // pages pick a PDF takes, never the judgment.
  const hasImage = files.some(isImageFile);
  const hasPages = hasPdf || hasImage;
  // With images alone the pick has no judge: judge reads as pages + convert.
  const shownFormat: PdfFormat = !hasPdf && pdfFormat === "judge" ? "convert" : pdfFormat;
  const hasMedia =
    request.kind === "video-url" ||
    files.some(isMediaFile) ||
    items.some((item) => item.kind === "video-url") ||
    driveFiles.some((f) => driveKindOf(f) === "media");
  const busy = phase === "adding";
  // Requests the add sends: pages picked, files picked, items queued, or the
  // one link.
  const selectedCount =
    request.kind === "url"
      ? (selected.has(SELF) ? 1 : 0) +
        (review?.pages ?? []).filter((p) => selected.has(p.url)).length
      : request.kind === "drive"
        ? Math.max(1, driveFiles.length)
        : request.kind === "batch"
          ? Math.max(1, items.length)
          : Math.max(1, files.length);
  // The save stage detail of the last add — the final figure check (SPEC.md
  // §15) — read at the end of the add: a lost figure keeps the box open.
  const saveDetailRef = useRef<string | null>(null);
  // When the running add started: the progress card's elapsed time, and the
  // early open's mark. The early open is pending until the add's first
  // document either opens early or finishes in time — never a later one.
  const [addStartedAt, setAddStartedAt] = useState(0);
  const addStartedAtRef = useRef(0);
  const earlyOpenRef = useRef<"pending" | "opened" | "off">("off");

  // ── Review (url kind): the sandbox read, on open and on Review again ──────
  // The running review, so Cancel can abort it: the box goes to ready with
  // the page itself selected, and Add still works.
  const reviewAbortRef = useRef<AbortController | null>(null);
  function stopReview() {
    reviewAbortRef.current?.abort();
  }
  async function runReview() {
    if (request.kind !== "url") return;
    setPhase("review");
    setReviewError(null);
    setError(null);
    setReviewSteps(REVIEW_STEPS);
    const controller = new AbortController();
    reviewAbortRef.current = controller;
    try {
      const res = await fetch("/api/uploads/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ notebookId, url: request.url }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? statusMessage(t, res.status));
      }
      let result: { review?: UploadReview; error?: string } | null = null;
      for await (const event of readNdjson<{ stage?: string; review?: UploadReview; error?: string }>(res)) {
        if (event.stage) {
          setReviewSteps((s) => advanceIngestSteps(s, event.stage!));
        } else {
          result = event;
        }
      }
      if (!result?.review) throw new Error(result?.error ?? t("panes.uploadCutOff"));
      const next = result.review;
      setReview(next);
      const sel = new Set<string>();
      if (next.pages.length === 0 || next.pasteThisPage) sel.add(SELF);
      for (const page of next.pages) if (page.recommended) sel.add(page.url);
      setSelected(sel);
      setSplit(next.splitProposed);
    } catch (err) {
      // Cancelled, not failed: no review, the page itself stays selected.
      if (!controller.signal.aborted) {
        setReviewError(err instanceof Error ? err.message : t("api.reviewFailed"));
      }
      setSelected(new Set([SELF]));
    } finally {
      if (reviewAbortRef.current === controller) reviewAbortRef.current = null;
    }
    setPhase("ready");
  }

  const reviewedOnce = useRef(false);
  useEffect(() => {
    if (request.kind !== "url" || reviewedOnce.current) return;
    reviewedOnce.current = true;
    void runReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // ── The adds: one streamed request per page or file, progress in the box ──
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
      setSteps((s) => (s ? advanceIngestSteps(s, "glossary") : s));
      await api(`/api/documents/${id}/glossary`, "POST", {}).catch(() => {});
      setSteps((s) => (s ? advanceIngestSteps(s, "links") : s));
      await api(`/api/documents/${id}/connect`, "POST", { notebookId }).catch(() => {});
    }
    if (visuals) {
      const progress = (done: number) =>
        setSteps((s) => (s ? advanceIngestSteps(s, "figures", `${done}/${plan.images.length}`) : s));
      progress(0);
      await warmImages(plan.images, progress);
    }
    setSteps((s) => (s ? completeIngestSteps(s) : s));
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

  async function uploadChunked(file: File, kind: "pdf" | "video", pdf: PdfDirectives) {
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
        ...(kind === "pdf" ? { pages: pdf.pages, convert: pdf.convert } : {}),
        // The box runs the scans itself, in the finishing step.
        scans: "client",
      }),
    });
  }

  // One file's add: a media file uploads in chunks as a video; a PDF over
  // the single-request size uploads in chunks; anything else goes in one
  // multipart request. Every path lands one document.
  async function addFile(file: File, pdfDirectives: PdfDirectives): Promise<Added> {
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
        ? await uploadChunked(file, "video", pdfDirectives)
        : file.size > SINGLE_REQUEST_BYTES
          ? await uploadChunked(file, "pdf", pdfDirectives)
          : await (() => {
              const form = new FormData();
              form.set("file", file);
              form.set("notebookId", notebookId);
              form.set("pages", pdfDirectives.pages ? "1" : "0");
              form.set("convert", pdfDirectives.convert ? "1" : "0");
              // The box runs the scans itself, in the finishing step.
              form.set("scans", "client");
              return fetch("/api/documents", { method: "POST", body: form });
            })(),
    );
    return { id: result.id, title: result.title };
  }

  // One link's add: the server routes YouTube links and direct media links
  // to video documents, everything else to the article parse.
  async function addLink(url: string, split: boolean): Promise<Added[]> {
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
              { url, notebookId, split, scans: "client" },
        ),
      }),
    );
    return result.documents ?? [{ id: result.id, title: result.title }];
  }

  // Documents the add will land: the split's parts, else the requests sent.
  const splitEligible =
    request.kind === "url" && review !== null && review.splitProposed && selectedCount === 1 && selected.has(SELF);
  const addCount = splitEligible && split ? review.splitParts : selectedCount;

  async function add() {
    setError(null);
    // The PDF directives (SPEC.md §16): the import pick in the box sets them;
    // judge leaves Import PDF deciding.
    const pdfDirectives: PdfDirectives =
      pdfFormat === "pages"
        ? { pages: true, convert: false }
        : pdfFormat === "convert"
          ? { pages: true, convert: true }
          : { pages: false, convert: true };
    const collected: Added[] = [];
    const failed: string[] = [];
    saveDetailRef.current = null;
    addStartedAtRef.current = Date.now();
    setAddStartedAt(addStartedAtRef.current);
    // A multi upload opens as one page once every member is in: no member
    // opens early on its own.
    const multi = layout === "multi" && addCount > 1;
    earlyOpenRef.current = multi ? "off" : "pending";

    if (request.kind === "url") {
      const pages: { url: string; title: string }[] = [
        ...(selected.has(SELF) ? [{ url: request.url, title: review?.title ?? request.url }] : []),
        ...(review?.pages ?? [])
          .filter((p) => selected.has(p.url))
          .map((p) => ({ url: p.url, title: p.title })),
      ];
      if (pages.length === 0) {
        setError(t("panes.uploadNoPagesPicked"));
        return;
      }
      setPhase("adding");
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        setHeadline(
          pages.length > 1
            ? t("panes.uploadPageProgress", { i: i + 1, total: pages.length, title: page.title })
            : null,
        );
        try {
          // Split answers the question asked about this page — never a lone
          // part page picked from the list.
          collected.push(...(await addLink(page.url, pages.length === 1 && selected.has(SELF) && split)));
        } catch (err) {
          failed.push(
            t("panes.uploadPageFailed", {
              title: page.title,
              reason: err instanceof Error ? err.message : t("panes.ingestFailed"),
            }),
          );
        }
      }
    } else if (request.kind === "drive") {
      // One import per pick, like multiple local files (SPEC.md §14). The
      // token rides each request; the PDF directives travel like every PDF
      // add.
      setPhase("adding");
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
                pages: pdfDirectives.pages,
                convert: pdfDirectives.convert,
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
    } else if (request.kind === "video-url") {
      setPhase("adding");
      try {
        collected.push(...(await addLink(request.url, false)));
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
      setPhase("adding");
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const title = item.kind === "file" ? item.file.name : item.url;
        setHeadline(
          items.length > 1 ? t("panes.uploadFileProgress", { i: i + 1, total: items.length, title }) : null,
        );
        try {
          if (item.kind === "file") collected.push(await addFile(item.file, pdfDirectives));
          else collected.push(...(await addLink(item.url, false)));
        } catch (err) {
          failed.push(
            t("panes.uploadPageFailed", {
              title,
              reason: err instanceof Error ? err.message : t("panes.uploadFailed"),
            }),
          );
        }
      }
    } else {
      setPhase("adding");
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setHeadline(
          files.length > 1
            ? t("panes.uploadFileProgress", { i: i + 1, total: files.length, title: file.name })
            : null,
        );
        try {
          collected.push(await addFile(file, pdfDirectives));
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
      setPhase("ready");
      setSteps(null);
      setError(failed.join(" ") || t("panes.uploadFailed"));
      // A hidden box comes back with the failure to read.
      if (hiddenRef.current) onShow();
      return;
    }
    setPhase("done");
    setOpenTarget(multiId ? { kind: "multi", id: multiId } : { kind: "document", id: collected[0].id });
    // Clean adds close themselves; failures stay visible until Close, and so
    // does a lost figure: a single add whose figure check found a caption
    // without a figure. A clean figure check line shows long enough to read.
    const lost =
      selectedCount === 1 &&
      (ingestCounts(saveDetailRef.current ?? "")?.captionsWithoutFigure ?? 0) > 0;
    if (failed.length === 0 && !lost) {
      setTimeout(
        () =>
          onClose(multiId ? { kind: "multi", id: multiId } : { kind: "document", id: collected[0].id }),
        collected.length > 1 || saveDetailRef.current ? 900 : 300,
      );
    } else if (hiddenRef.current) {
      // A hidden box comes back with the failure or the lost figure to read.
      onShow();
    }
  }

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

  const subject =
    request.kind === "files"
      ? files.map((f) => f.name).join(" · ")
      : request.kind === "drive"
        ? driveFiles.map((f) => f.name).join(" · ")
        : request.kind === "batch"
          ? items.map((item) => (item.kind === "file" ? item.file.name : item.url)).join(" · ")
          : request.url;
  // The final figure check (SPEC.md §15): the save step's counts of a single
  // add. A batch's last page would stand for the whole batch, so none shows.
  const saveDetail = steps?.find((s) => s.key === "save")?.detail;
  const verification =
    phase === "done" && selectedCount === 1 && saveDetail ? ingestCounts(saveDetail) : null;
  const lostFigures =
    (verification?.captionsWithoutFigure ?? 0) > 0 || (verification?.mediaLost.length ?? 0) > 0;
  // The review's figure check passes: every caption has its figure and no
  // figure waits on a browser render.
  const figuresOk =
    review !== null &&
    review.captions > 0 &&
    review.captionsWithoutFigure.length === 0 &&
    !review.scriptedFigures;

  const sectionLabel = "text-[12px] font-semibold text-sand-600";
  const pill = "rounded-full px-3.5 py-1.5 text-xs font-semibold";
  const amberNote =
    "rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200";

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
        className="flex max-h-[85vh] w-[560px] max-w-full flex-col gap-3 overflow-y-auto rounded-[24px] bg-card p-5 shadow-float"
      >
        <div className="flex items-center gap-2">
          <SparkleIcon size={16} className="shrink-0 text-clay" />
          <span className="font-display text-[17px]">{t("panes.uploadAssistant")}</span>
          <button
            onClick={() => {
              if (phase === "adding") {
                onHide();
                return;
              }
              reviewAbortRef.current?.abort();
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

        {phase === "review" && (
          <div className="flex flex-col gap-2.5">
            <p className="text-[13px] text-sand-700">{t("panes.uploadSandboxNote")}</p>
            <StepList steps={reviewSteps} />
            <button
              onClick={stopReview}
              className="self-start rounded-full border border-line px-3.5 py-1 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("common.cancel")}
            </button>
          </div>
        )}

        {phase === "ready" && (
          <div className="flex flex-col gap-3">
            {reviewError && (
              <p className={amberNote}>{t("panes.uploadReviewFailed", { reason: reviewError })}</p>
            )}

            {request.kind === "url" && review && (
              <div className="flex flex-col gap-1.5">
                {review.title && (
                  <p className="text-[13px] font-semibold text-sand-800">{review.title}</p>
                )}
                <p className="text-xs text-sand-500">
                  {review.pageEstimate > 1
                    ? t("panes.uploadPageFacts", {
                        pages: review.pageEstimate,
                        blocks: review.blockCount,
                      })
                    : t("panes.detailBlocks", { n: review.blockCount })}
                </p>
                {/* The figure check (SPEC.md §15): the audit's counts, one line
                    per caption with no figure, one when figures wait on a
                    browser render, one when every caption has its figure. */}
                <p className="text-xs text-sand-500">
                  {t("panes.uploadFigureCheck", {
                    figures: review.figures,
                    captions: review.captions,
                  })}
                </p>
                {(review.captionsWithoutFigure.length > 0 || review.mediaLost.length > 0 || review.scriptedFigures) && (
                  <ul className={`flex flex-col gap-1 ${amberNote}`}>
                    {review.captionsWithoutFigure.map((caption, i) => (
                      <li key={i}>
                        {t("panes.uploadCaptionWithoutFigure", {
                          label: captionLabel(caption) ?? caption,
                        })}
                      </li>
                    ))}
                    {review.mediaLost.length > 0 && (
                      <li>{mediaLostText(t, { media: review.media, mediaLost: review.mediaLost })}</li>
                    )}
                    {review.scriptedFigures && <li>{t("panes.uploadScriptedFigures")}</li>}
                  </ul>
                )}
                {figuresOk && <p className="text-xs text-sand-500">{t("panes.uploadFiguresOk")}</p>}
                {review.media > 0 && review.mediaLost.length === 0 && (
                  <p className="text-xs text-sand-500">{t("panes.uploadMediaOk", { n: review.media })}</p>
                )}
                {review.summary && (
                  <p className="text-[13px] leading-relaxed text-sand-700">{review.summary}</p>
                )}
                {review.advice.length > 0 && (
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-relaxed text-sand-700">
                    {review.advice.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {request.kind === "url" && !review && !reviewError && (
              <p className="text-[13px] text-sand-700">{t("panes.uploadNuanceUrl")}</p>
            )}

            {request.kind === "url" && review && review.pages.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className={sectionLabel}>
                  {t("panes.uploadPagesFound", { n: review.pages.length })}
                </span>
                <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-2xl bg-sand-100 p-2">
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 text-[13px] text-sand-800 hover:bg-clay-100">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-clay"
                      checked={selected.has(SELF)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(SELF);
                        else next.delete(SELF);
                        setSelected(next);
                      }}
                    />
                    <span>
                      {t("panes.uploadThisPage")}
                      {review.title ? ` · ${review.title}` : ""}
                    </span>
                  </label>
                  {review.pages.map((page) => (
                    <label
                      key={page.url}
                      data-tip={page.url}
                      className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 text-[13px] text-sand-800 hover:bg-clay-100"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-clay"
                        checked={selected.has(page.url)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(page.url);
                          else next.delete(page.url);
                          setSelected(next);
                        }}
                      />
                      <span>{page.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {splitEligible && (
              <div className="flex flex-col gap-1.5">
                <span className={sectionLabel}>
                  {t("panes.uploadSplitQuestion", {
                    pages: review.pageEstimate,
                    parts: review.splitParts,
                  })}
                </span>
                {review.splitReason && (
                  <p className="text-xs text-sand-500">{review.splitReason}</p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSplit(true)}
                    data-track="upload-split-yes"
                    className={`${pill} ${split ? "bg-clay text-clay-fg" : "bg-sand-100 text-sand-700 hover:bg-clay-100"}`}
                  >
                    {t("panes.uploadSplitYes", { parts: review.splitParts })}
                  </button>
                  <button
                    onClick={() => setSplit(false)}
                    data-track="upload-split-no"
                    className={`${pill} ${split ? "bg-sand-100 text-sand-700 hover:bg-clay-100" : "bg-clay text-clay-fg"}`}
                  >
                    {t("panes.uploadSplitNo")}
                  </button>
                </div>
              </div>
            )}

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

            {(request.kind === "files" || request.kind === "drive" || request.kind === "batch") && (
              <div className="flex flex-col gap-1.5">
                {request.kind === "drive" && (
                  <p className="text-[13px] text-sand-700">{t("panes.uploadNuanceDrive")}</p>
                )}
                {hasPdf && <p className="text-[13px] text-sand-700">{t("panes.uploadNuancePdf")}</p>}
                {hasImage && (
                  <p className="text-[13px] text-sand-700">{t("panes.uploadNuanceImage")}</p>
                )}
                {hasMedia && (
                  <p className="text-[13px] text-sand-700">{t("panes.uploadNuanceVideoFile")}</p>
                )}
              </div>
            )}

            {hasPages && (
              <div className="flex flex-col gap-1.5">
                <span className={sectionLabel}>
                  {t(hasPdf ? "panes.uploadPdfFormat" : "panes.uploadImageFormat")}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {(hasPdf ? PDF_FORMATS : IMAGE_FORMATS).map((format) => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => setPdfFormat(format)}
                      data-track={`upload-format:${format}`}
                      aria-pressed={shownFormat === format}
                      className={`${pill} ${shownFormat === format ? "bg-clay text-clay-fg" : "bg-sand-100 text-sand-700 hover:bg-clay-100"}`}
                    >
                      {t(PDF_FORMAT_LABEL[format])}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-sand-500">
                  {t((hasPdf ? PDF_FORMAT_NOTE : IMAGE_FORMAT_NOTE)[shownFormat])}
                </p>
              </div>
            )}
            {request.kind === "video-url" && (
              <p className="text-[13px] text-sand-700">{t("panes.uploadNuanceVideoUrl")}</p>
            )}

            {/* The layout question (SPEC.md §22): an add that lands two or more
                documents puts each on its own page, or all on one page as a
                multi upload. */}
            {addCount > 1 && (
              <div className="flex flex-col gap-1.5">
                <span className={sectionLabel}>{t("panes.uploadLayoutQuestion", { n: addCount })}</span>
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
            )}

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex items-center gap-2">
              <button
                onClick={() => void add()}
                data-track="upload-add"
                disabled={busy}
                className="rounded-full bg-clay px-5 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                {addCount > 1 ? t("panes.uploadAddCount", { n: addCount }) : t("common.add")}
              </button>
              {request.kind === "url" && (
                <>
                  <button
                    onClick={() => void runReview()}
                    data-track="upload-review-again"
                    disabled={busy}
                    className="rounded-full border border-line px-3.5 py-1.5 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                  >
                    {t("panes.uploadReviewAgain")}
                  </button>
                  <span className="text-xs text-sand-500">{t("panes.uploadReviewAgainNote")}</span>
                </>
              )}
              <button
                onClick={() => onClose(null)}
                data-track="upload-cancel"
                disabled={busy}
                className="ml-auto rounded-full px-3.5 py-1.5 text-xs text-sand-600 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
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
            {failures.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-red-500">
                {failures.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
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
          </div>
        )}
      </div>
    </div>
  );
}
