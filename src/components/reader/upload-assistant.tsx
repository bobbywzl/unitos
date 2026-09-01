"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isImeKey } from "@/lib/ime";
import { useT } from "@/components/lang-provider";
import { CheckIcon, SparkleIcon, SpinnerIcon } from "@/components/icons";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { readNdjson } from "@/lib/ndjson";
import type { InstructionCheck, InstructionReply, UploadReview } from "@/lib/upload-assistant";
import { MAX_VIDEO_BYTES, MEDIA_EXTENSIONS, UPLOAD_CHUNK_BYTES } from "@/lib/video/types";
import { parseYouTubeId } from "@/lib/video/youtube";
import {
  advanceIngestSteps,
  completeIngestSteps,
  initialIngestSteps,
  type IngestStep,
} from "@/components/reader/ingest-progress";

// The upload assistant (SPEC.md §14): the box that opens on every add. For a
// URL it reviews the page in a private sandbox first — what the content is,
// which linked pages are parts of the same work, whether to split — and for
// every kind it takes upload instructions and answers each one honestly
// before anything is saved. The box drives the adds itself, one request per
// page or file, and shows the progress in place.

export type UploadRequest =
  | { kind: "url"; url: string }
  | { kind: "video-url"; url: string }
  | { kind: "files"; files: File[] };

type Phase = "review" | "ready" | "adding" | "done";
type Added = { id: string; title: string };
type CheckState = InstructionCheck & { text: string };
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

function statusMessage(t: TFunc, status: number): string {
  if (status === 413) return t("panes.uploadTooLarge");
  return t("panes.requestFailedStatus", { status });
}

const REVIEW_STEPS: IngestStep[] = [
  { key: "fetch", labelKey: "panes.stepFetchingPage", status: "active" },
  { key: "extract", labelKey: "panes.stepReadingPage", status: "pending" },
  { key: "review", labelKey: "panes.stepReviewing", status: "pending" },
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

// One reply per instruction: what the assistant will do, or honestly cannot.
function ReplyList({ replies }: { replies: InstructionReply[] }) {
  if (replies.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {replies.map((r, i) => (
        <li key={i} className="flex items-start gap-2 text-xs" title={r.instruction}>
          {r.willFollow ? (
            <CheckIcon size={12} className="mt-0.5 shrink-0 text-sage" />
          ) : (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              aria-hidden
              className="mt-0.5 shrink-0 text-sand-400"
            >
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          )}
          <span className={r.willFollow ? "text-sand-700" : "text-sand-500"}>{r.reply}</span>
        </li>
      ))}
    </ul>
  );
}

export function UploadAssistant({
  notebookId,
  request,
  onClose,
}: {
  notebookId: string;
  request: UploadRequest;
  // Called once the box is done: the first added document to open, or null.
  onClose: (openDocId: string | null) => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>(request.kind === "url" ? "review" : "ready");
  const [review, setReview] = useState<UploadReview | null>(null);
  const [reviewSteps, setReviewSteps] = useState<IngestStep[]>(REVIEW_STEPS);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set([SELF]));
  const [split, setSplit] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [check, setCheck] = useState<CheckState | null>(null);
  const [checking, setChecking] = useState(false);
  const [steps, setSteps] = useState<IngestStep[] | null>(null);
  const [headline, setHeadline] = useState<string | null>(null);
  const [added, setAdded] = useState<Added[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const files = request.kind === "files" ? request.files : [];
  const hasPdf = files.some((f) => !isMediaFile(f));
  const hasMedia = request.kind === "video-url" || files.some(isMediaFile);
  const busy = phase === "adding" || checking;

  // ── Review (url kind): the sandbox read, on open and on Review again ──────
  async function runReview(withInstructions: string) {
    if (request.kind !== "url") return;
    setPhase("review");
    setReviewError(null);
    setError(null);
    setReviewSteps(REVIEW_STEPS);
    try {
      const res = await fetch("/api/uploads/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notebookId,
          url: request.url,
          instructions: withInstructions,
        }),
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
      if (!result?.review) throw new Error(result?.error ?? t("api.reviewFailed"));
      const next = result.review;
      setReview(next);
      const sel = new Set<string>();
      if (next.pages.length === 0 || next.pasteThisPage) sel.add(SELF);
      for (const page of next.pages) if (page.recommended) sel.add(page.url);
      setSelected(sel);
      setSplit(next.splitProposed);
      if (withInstructions) {
        setCheck({ text: withInstructions, replies: next.replies, feasible: next.feasible });
      }
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : t("api.reviewFailed"));
      setSelected(new Set([SELF]));
    }
    setPhase("ready");
  }

  const reviewedOnce = useRef(false);
  useEffect(() => {
    if (request.kind !== "url" || reviewedOnce.current) return;
    reviewedOnce.current = true;
    void runReview("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // ── Instructions check: before any content is added, each instruction gets
  // an honest answer; only the feasible part travels to ingest ──────────────
  async function ensureCheck(): Promise<string> {
    const text = instructions.trim();
    if (!text) return "";
    if (check && check.text === text) return check.feasible;
    setChecking(true);
    try {
      const kind =
        request.kind === "url" ? "url" : request.kind === "video-url" || !hasPdf ? "video" : "pdf";
      const result = await api<{ check: InstructionCheck }>("/api/uploads/review", "POST", {
        notebookId,
        kind,
        instructions: text,
      });
      setCheck({ text, ...result.check });
      return result.check.feasible;
    } catch {
      const fallback: CheckState = {
        text,
        replies: [{ instruction: text, willFollow: false, reply: t("api.instructionsUnchecked") }],
        feasible: "",
      };
      setCheck(fallback);
      return "";
    } finally {
      setChecking(false);
    }
  }

  // ── The adds: one streamed request per page or file, progress in the box ──
  async function streamIngest(res: Response): Promise<IngestResult> {
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(detail?.error ?? statusMessage(t, res.status));
    }
    let result: IngestEvent | null = null;
    for await (const event of readNdjson<IngestEvent>(res)) {
      if ("stage" in event) setSteps((s) => (s ? advanceIngestSteps(s, event.stage, event.detail) : s));
      else result = event;
    }
    if (!result || "error" in result) {
      throw new Error(result && "error" in result ? result.error : t("panes.uploadFailed"));
    }
    setSteps((s) => (s ? completeIngestSteps(s) : s));
    return result;
  }

  async function uploadChunked(file: File, kind: "pdf" | "video", instructionsText: string) {
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
        instructions: kind === "pdf" ? instructionsText : "",
      }),
    });
  }

  async function add() {
    setError(null);
    const feasible = await ensureCheck();
    const collected: Added[] = [];
    const failed: string[] = [];

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
        setSteps(initialIngestSteps("url"));
        try {
          const result = await streamIngest(
            await fetch("/api/documents", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                url: page.url,
                notebookId,
                instructions: feasible,
                // Split answers the question asked about this page — never a
                // lone part page picked from the list.
                split: pages.length === 1 && selected.has(SELF) && split,
              }),
            }),
          );
          collected.push(...(result.documents ?? [{ id: result.id, title: result.title }]));
        } catch (err) {
          failed.push(
            t("panes.uploadPageFailed", {
              title: page.title,
              reason: err instanceof Error ? err.message : t("panes.ingestFailed"),
            }),
          );
        }
      }
    } else if (request.kind === "video-url") {
      setPhase("adding");
      setSteps(initialIngestSteps(parseYouTubeId(request.url) ? "youtube" : "media"));
      try {
        const result = await streamIngest(
          await fetch("/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: request.url, notebookId }),
          }),
        );
        collected.push({ id: result.id, title: result.title });
      } catch (err) {
        failed.push(
          t("panes.uploadPageFailed", {
            title: request.url,
            reason: err instanceof Error ? err.message : t("panes.ingestFailed"),
          }),
        );
      }
    } else {
      setPhase("adding");
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const media = isMediaFile(file);
        setHeadline(
          files.length > 1
            ? t("panes.uploadFileProgress", { i: i + 1, total: files.length, title: file.name })
            : null,
        );
        if (media && file.size > MAX_VIDEO_BYTES) {
          failed.push(t("panes.fileTooLarge", { name: file.name, mb: 200 }));
          continue;
        }
        if (!media && file.size > MAX_PDF_BYTES) {
          failed.push(t("panes.fileTooLarge", { name: file.name, mb: 50 }));
          continue;
        }
        setSteps(initialIngestSteps(media ? "video" : "pdf"));
        try {
          const result = await streamIngest(
            media
              ? await uploadChunked(file, "video", feasible)
              : file.size > SINGLE_REQUEST_BYTES
                ? await uploadChunked(file, "pdf", feasible)
                : await (() => {
                    const form = new FormData();
                    form.set("file", file);
                    form.set("notebookId", notebookId);
                    form.set("instructions", feasible);
                    return fetch("/api/documents", { method: "POST", body: form });
                  })(),
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
    }

    setAdded(collected);
    setFailures(failed);
    setHeadline(null);
    if (collected.length === 0) {
      setPhase("ready");
      setSteps(null);
      setError(failed.join(" ") || t("panes.uploadFailed"));
      return;
    }
    setPhase("done");
    // Clean adds close themselves; failures stay visible until Close.
    if (failed.length === 0) {
      setTimeout(() => onClose(collected[0].id), collected.length > 1 ? 900 : 300);
    }
  }

  // Escape and the backdrop close the box, except while an add is running.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImeKey(e) && phase !== "adding") {
        e.stopPropagation();
        onClose(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const selectedCount =
    request.kind === "url"
      ? (selected.has(SELF) ? 1 : 0) +
        (review?.pages ?? []).filter((p) => selected.has(p.url)).length
      : Math.max(1, files.length);
  const splitEligible =
    request.kind === "url" && review !== null && review.splitProposed && selectedCount === 1 && selected.has(SELF);
  const addCount = splitEligible && split ? review.splitParts : selectedCount;
  const subject =
    request.kind === "files"
      ? files.map((f) => f.name).join(" · ")
      : request.url;

  const sectionLabel = "text-[12px] font-semibold text-sand-600";
  const pill = "rounded-full px-3.5 py-1.5 text-xs font-semibold";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={() => phase !== "adding" && onClose(null)}
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
          {phase !== "adding" && (
            <button
              onClick={() => onClose(null)}
              aria-label={t("common.close")}
              className="ml-auto flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
            >
              ✕
            </button>
          )}
        </div>
        <p className="truncate text-xs text-sand-500" title={subject}>
          {subject}
        </p>

        {phase === "review" && (
          <div className="flex flex-col gap-2.5">
            <p className="text-[13px] text-sand-700">{t("panes.uploadSandboxNote")}</p>
            <StepList steps={reviewSteps} />
          </div>
        )}

        {phase === "ready" && (
          <div className="flex flex-col gap-3">
            {reviewError && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                {t("panes.uploadReviewFailed", { reason: reviewError })}
              </p>
            )}

            {request.kind === "url" && review && (
              <div className="flex flex-col gap-1.5">
                {review.title && (
                  <p className="text-[13px] font-semibold text-sand-800">{review.title}</p>
                )}
                <p className="text-xs text-sand-500">
                  {t("panes.uploadPageFacts", {
                    pages: review.pageEstimate,
                    blocks: review.blockCount,
                  })}
                </p>
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
                      title={page.url}
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
                    className={`${pill} ${split ? "bg-clay text-clay-fg" : "bg-sand-100 text-sand-700 hover:bg-clay-100"}`}
                  >
                    {t("panes.uploadSplitYes", { parts: review.splitParts })}
                  </button>
                  <button
                    onClick={() => setSplit(false)}
                    className={`${pill} ${split ? "bg-sand-100 text-sand-700 hover:bg-clay-100" : "bg-clay text-clay-fg"}`}
                  >
                    {t("panes.uploadSplitNo")}
                  </button>
                </div>
              </div>
            )}

            {request.kind === "files" && (
              <div className="flex flex-col gap-1.5">
                {hasPdf && <p className="text-[13px] text-sand-700">{t("panes.uploadNuancePdf")}</p>}
                {hasMedia && (
                  <p className="text-[13px] text-sand-700">{t("panes.uploadNuanceVideoFile")}</p>
                )}
              </div>
            )}
            {request.kind === "video-url" && (
              <p className="text-[13px] text-sand-700">{t("panes.uploadNuanceVideoUrl")}</p>
            )}

            <div className="flex flex-col gap-1.5">
              <label className={sectionLabel} htmlFor="upload-instructions">
                {t("panes.uploadInstructionsLabel")}
              </label>
              <textarea
                id="upload-instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={t("panes.uploadInstructionsPlaceholder")}
                rows={2}
                className="w-full resize-y rounded-2xl bg-sand-100 px-4 py-2.5 text-sm outline-none placeholder:text-sand-500"
              />
              {hasMedia && !hasPdf && request.kind !== "url" && (
                <p className="text-xs text-sand-500">{t("api.instructionsVideo")}</p>
              )}
              {check && <ReplyList replies={check.replies} />}
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex items-center gap-2">
              <button
                onClick={() => void add()}
                disabled={busy}
                className="rounded-full bg-clay px-5 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                {checking
                  ? t("panes.uploadInstructionsChecking")
                  : addCount > 1
                    ? t("panes.uploadAddCount", { n: addCount })
                    : t("common.add")}
              </button>
              {request.kind === "url" && (
                <button
                  onClick={() => void runReview(instructions.trim())}
                  disabled={busy}
                  className="rounded-full border border-line px-3.5 py-1.5 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                >
                  {t("panes.uploadReviewAgain")}
                </button>
              )}
              <button
                onClick={() => onClose(null)}
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
            {headline && <p className="text-[13px] font-semibold text-sand-800">{headline}</p>}
            {steps && <StepList steps={steps} />}
            {check && <ReplyList replies={check.replies} />}
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
            {failures.length > 0 && (
              <>
                <ul className="flex flex-col gap-1 text-xs text-red-500">
                  {failures.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                <button
                  onClick={() => onClose(added[0]?.id ?? null)}
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
