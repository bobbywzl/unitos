"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Logo } from "@/components/logo";
import { readNdjson } from "@/lib/ndjson";
import {
  IngestProgress,
  advanceIngestSteps,
  completeIngestSteps,
  initialIngestSteps,
  type IngestStep,
} from "@/components/reader/ingest-progress";

export type AttachedDocument = { id: string; title: string };
type LibraryDocument = { id: string; title: string; _count: { blocks: number } };
type IngestPhase = { fileLabel: string; steps: IngestStep[] };
// Wire format from /api/documents: a stage event per line, then one terminal line.
type IngestEvent =
  | { stage: "parse" | "save" }
  | { id: string; title: string; deduped: boolean }
  | { error: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Platform errors (Vercel 413, crashed function) return empty or non-JSON bodies.
async function readJson<T>(res: Response): Promise<T | null> {
  return res.json().catch(() => null) as Promise<T | null>;
}

function statusMessage(status: number): string {
  if (status === 413) return "File too large for the server. Vercel caps uploads at about 4.5 MB.";
  return `Request failed (${status})`;
}

// Documents in the header (design 1a): a pill per attached document, everything
// that adds or removes one folded behind the dashed +.
export function DocumentBar({
  notebookId,
  documents,
  activeId,
}: {
  notebookId: string;
  documents: AttachedDocument[];
  activeId: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<IngestPhase | null>(null);
  const [menu, setMenu] = useState<null | "root" | "url" | "library">(null);
  const [url, setUrl] = useState("");
  const [library, setLibrary] = useState<LibraryDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (menu === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  function open(docId: string) {
    router.push(`/n/${notebookId}?doc=${docId}`);
  }

  // Drives one ingest call: seeds the 3-step pill, streams stage events into it, and
  // resolves with the terminal result. Shared by PDF upload and URL ingestion below.
  async function runIngest(
    fileLabel: string,
    receiveLabel: string,
    send: () => Promise<Response>,
  ): Promise<{ id: string; title: string; deduped: boolean }> {
    setPhase({ fileLabel, steps: initialIngestSteps(receiveLabel) });
    const res = await send();
    if (!res.ok) {
      const detail = await readJson<{ error?: string }>(res);
      throw new Error(detail?.error ?? statusMessage(res.status));
    }
    let result: IngestEvent | null = null;
    for await (const event of readNdjson<IngestEvent>(res)) {
      if ("stage" in event) {
        setPhase((p) => (p ? { ...p, steps: advanceIngestSteps(p.steps, event.stage) } : p));
      } else {
        result = event;
      }
    }
    if (!result || "error" in result) {
      throw new Error(result && "error" in result ? result.error : "Upload failed");
    }
    setPhase((p) => (p ? { ...p, steps: completeIngestSteps(p.steps) } : p));
    await sleep(250); // let the last checkmark register before the pill clears
    return result;
  }

  async function uploadPdfs(files: File[]) {
    setError(null);
    let lastId: string | null = null;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const label = files.length > 1 ? `${file.name} (${i + 1}/${files.length})` : file.name;
        const result = await runIngest(label, "Uploading", () => {
          const form = new FormData();
          form.set("file", file);
          form.set("notebookId", notebookId);
          return fetch("/api/documents", { method: "POST", body: form });
        });
        lastId = result.id;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPhase(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    if (lastId) {
      open(lastId);
      router.refresh();
    }
  }

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
      const pdfs = files.filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
      );
      if (pdfs.length === 0) {
        setError("Drop PDF files.");
        return;
      }
      void uploadPdfs(pdfs);
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

  async function addUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const result = await runIngest(trimmed, "Fetching", () =>
        fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed, notebookId }),
        }),
      );
      setUrl("");
      setMenu(null);
      open(result.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setPhase(null);
    }
  }

  async function openLibrary() {
    setMenu("library");
    if (!library) {
      const res = await fetch("/api/documents");
      const json = await readJson<LibraryDocument[]>(res);
      if (res.ok && json) setLibrary(json);
      else setError(statusMessage(res.status));
    }
  }

  async function attach(documentId: string) {
    await api(`/api/notebooks/${notebookId}/documents`, "POST", { documentId });
    setMenu(null);
    open(documentId);
    router.refresh();
  }

  async function detach(documentId: string) {
    setMenu(null);
    await api(`/api/notebooks/${notebookId}/documents/${documentId}`, "DELETE");
    router.push(`/n/${notebookId}`);
    router.refresh();
  }

  async function removeFromLibrary(documentId: string) {
    if (!confirm("Delete this document from the library?")) return;
    setError(null);
    try {
      await api(`/api/documents/${documentId}`, "DELETE");
      setLibrary((prev) => (prev ? prev.filter((d) => d.id !== documentId) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const attachedIds = new Set(documents.map((d) => d.id));
  const menuItem =
    "px-4 py-2 text-left text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800";

  return (
    <div className="flex min-w-0 items-center gap-2">
      {documents.map((d) => (
        <button
          key={d.id}
          onClick={() => open(d.id)}
          className={`max-w-56 truncate rounded-full text-[13px] ${
            d.id === activeId
              ? "bg-ink px-[15px] py-[7px] font-semibold text-paper"
              : "border border-line px-3.5 py-1.5 text-sand-700 hover:bg-clay-100 hover:text-clay-800"
          }`}
          title={d.title}
        >
          {d.title}
        </button>
      ))}

      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={() => setMenu(menu === null ? "root" : null)}
          aria-label="Add a document"
          aria-expanded={menu !== null}
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

        {menu !== null && (
          <div className="absolute left-0 z-30 mt-2 w-72 overflow-hidden rounded-2xl bg-card py-1 shadow-float">
            {menu === "root" && (
              <div className="flex flex-col">
                <button
                  onClick={() => {
                    setMenu(null);
                    fileRef.current?.click();
                  }}
                  disabled={phase !== null}
                  className={`${menuItem} disabled:opacity-40`}
                >
                  Upload PDF
                </button>
                <button onClick={() => setMenu("url")} className={menuItem}>
                  Add URL
                </button>
                <button onClick={() => void openLibrary()} className={menuItem}>
                  Library
                </button>
                {activeId && (
                  <button
                    onClick={() => void detach(activeId)}
                    className="px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                    title="Detach the open document from this work"
                  >
                    Detach open document
                  </button>
                )}
              </div>
            )}

            {menu === "url" && (
              <form
                className="flex flex-col gap-2 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addUrl();
                }}
              >
                <input
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  aria-label="Document URL"
                  className="w-full rounded-full bg-sand-100 px-4 py-2 text-sm outline-none placeholder:text-sand-500"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={phase !== null}
                    className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                  >
                    Ingest
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenu("root")}
                    className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                  >
                    Back
                  </button>
                </div>
              </form>
            )}

            {menu === "library" && (
              <ul className="max-h-64 overflow-y-auto py-1">
                {library === null && <li className="px-4 py-2 text-sm text-sand-500">Loading…</li>}
                {library !== null && library.filter((d) => !attachedIds.has(d.id)).length === 0 && (
                  <li className="px-4 py-2 text-sm text-sand-500">
                    No other documents in the library.
                  </li>
                )}
                {library
                  ?.filter((d) => !attachedIds.has(d.id))
                  .map((d) => (
                    <li key={d.id} className="flex items-center gap-1 px-1">
                      <button
                        onClick={() => void attach(d.id)}
                        className="min-w-0 flex-1 truncate rounded-full px-3 py-2 text-left text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                      >
                        {d.title}{" "}
                        <span className="text-xs text-sand-500">({d._count.blocks} blocks)</span>
                      </button>
                      <button
                        onClick={() => void removeFromLibrary(d.id)}
                        className="rounded-full px-2 py-1 text-xs text-sand-400 hover:text-red-500"
                        title="Delete from the library"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {phase && <IngestProgress fileLabel={phase.fileLabel} steps={phase.steps} />}
      {error && <span className="text-xs text-red-500">{error}</span>}

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length > 0) void uploadPdfs(files);
        }}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-paper/90 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-[28px] border-2 border-dashed border-sand-400 bg-card px-14 py-10 shadow-float">
            <Logo size={72} className="text-clay" />
            <p className="text-sm font-semibold text-sand-800">
              Drop PDFs to add them to this work
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
