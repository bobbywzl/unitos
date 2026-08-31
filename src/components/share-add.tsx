"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readNdjson } from "@/lib/ndjson";
import { parseYouTubeId } from "@/lib/video/youtube";
import { useT } from "@/components/lang-provider";
import {
  advanceIngestSteps,
  completeIngestSteps,
  initialIngestSteps,
  IngestProgress,
  type IngestStep,
} from "@/components/reader/ingest-progress";

export type SharePayload =
  | { kind: "url"; url: string }
  | { kind: "file"; uploadId: string; filename: string; fileKind: "pdf" | "video" };

type IngestEvent = { stage: string; detail?: string } | { id: string } | { error: string };

// The share landing form: what arrived, which project it goes to, Add. Runs
// the same ingestion as the reader's header (URL → /api/documents; staged
// file → /api/uploads/complete) and opens the document when it lands.
export function ShareAdd({
  projects,
  payload,
}: {
  projects: { id: string; title: string }[];
  payload: SharePayload;
}) {
  const t = useT();
  const router = useRouter();
  const [notebookId, setNotebookId] = useState(projects[0].id);
  const [steps, setSteps] = useState<IngestStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const label = payload.kind === "url" ? payload.url : payload.filename;

  async function add() {
    setError(null);
    const stepKind =
      payload.kind === "url"
        ? parseYouTubeId(payload.url)
          ? "youtube"
          : "url"
        : payload.fileKind;
    setSteps(initialIngestSteps(stepKind));
    try {
      const res =
        payload.kind === "url"
          ? await fetch("/api/documents", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: payload.url, notebookId }),
            })
          : await fetch("/api/uploads/complete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                uploadId: payload.uploadId,
                filename: payload.filename,
                notebookId,
                kind: payload.fileKind,
              }),
            });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("common.requestFailedStatus", { status: res.status }));
      }
      let result: IngestEvent | null = null;
      for await (const event of readNdjson<IngestEvent>(res)) {
        if ("stage" in event) {
          setSteps((prev) => (prev ? advanceIngestSteps(prev, event.stage, event.detail) : prev));
        } else {
          result = event;
        }
      }
      if (!result || "error" in result) {
        throw new Error(result && "error" in result ? result.error : t("panes.uploadFailed"));
      }
      setSteps((prev) => (prev ? completeIngestSteps(prev) : prev));
      router.push(`/n/${notebookId}?doc=${result.id}`);
      router.refresh();
    } catch (err) {
      setSteps(null);
      setError(err instanceof Error ? err.message : t("panes.ingestFailed"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-2xl bg-card px-4 py-3 text-sm break-all shadow-soft">{label}</p>
      <select
        value={notebookId}
        onChange={(e) => setNotebookId(e.target.value)}
        aria-label={t("works.shareAddChoose")}
        disabled={steps !== null}
        className="w-full rounded-full bg-card px-4 py-2.5 text-sm shadow-soft outline-none"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      {steps === null ? (
        <button
          onClick={() => void add()}
          className="rounded-full bg-clay px-5 py-2.5 text-sm font-semibold text-clay-fg hover:bg-clay-600"
        >
          {t("common.add")}
        </button>
      ) : (
        <IngestProgress fileLabel={label} steps={steps} />
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
