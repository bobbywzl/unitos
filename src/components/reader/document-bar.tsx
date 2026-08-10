"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Logo } from "@/components/logo";

export type AttachedDocument = { id: string; title: string };
type LibraryDocument = { id: string; title: string; _count: { blocks: number } };

// Platform errors (Vercel 413, crashed function) return empty or non-JSON bodies.
async function readJson<T>(res: Response): Promise<T | null> {
  return res.json().catch(() => null) as Promise<T | null>;
}

function statusMessage(status: number): string {
  if (status === 413) return "File too large for the server. Vercel caps uploads at about 4.5 MB.";
  return `Request failed (${status})`;
}

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
  const [busy, setBusy] = useState<string | null>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState<LibraryDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function open(docId: string) {
    router.push(`/n/${notebookId}?doc=${docId}`);
  }

  async function uploadPdfs(files: File[]) {
    setError(null);
    let lastId: string | null = null;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setBusy(files.length > 1 ? `Parsing ${file.name} (${i + 1}/${files.length})…` : `Parsing ${file.name}…`);
        const form = new FormData();
        form.set("file", file);
        form.set("notebookId", notebookId);
        const res = await fetch("/api/documents", { method: "POST", body: form });
        const json = await readJson<{ id?: string; error?: string }>(res);
        if (!res.ok || !json?.id) throw new Error(json?.error ?? statusMessage(res.status));
        lastId = json.id;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    if (lastId) {
      open(lastId);
      router.refresh();
    }
  }

  // Drag-and-drop PDF upload: dropping anywhere on the page adds to this notebook.
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
    setBusy("Fetching URL…");
    setError(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, notebookId }),
      });
      const json = await readJson<{ id?: string; error?: string }>(res);
      if (!res.ok || !json?.id) throw new Error(json?.error ?? statusMessage(res.status));
      setUrl("");
      setUrlOpen(false);
      open(json.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setBusy(null);
    }
  }

  async function openLibrary() {
    setLibraryOpen(!libraryOpen);
    if (!library) {
      const res = await fetch("/api/documents");
      const json = await readJson<LibraryDocument[]>(res);
      if (res.ok && json) setLibrary(json);
      else setError(statusMessage(res.status));
    }
  }

  async function attach(documentId: string) {
    await api(`/api/notebooks/${notebookId}/documents`, "POST", { documentId });
    setLibraryOpen(false);
    open(documentId);
    router.refresh();
  }

  async function detach(documentId: string) {
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

  return (
    <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex flex-wrap items-center gap-2">
        {documents.map((d) => (
          <button
            key={d.id}
            onClick={() => open(d.id)}
            className={`max-w-56 truncate rounded-md px-2.5 py-1 text-sm ${
              d.id === activeId
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "bg-white text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
            }`}
            title={d.title}
          >
            {d.title}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {busy && <span className="animate-pulse text-xs text-neutral-500">{busy}</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
          >
            Upload PDF
          </button>
          <button
            onClick={() => setUrlOpen(!urlOpen)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
          >
            Add URL
          </button>
          <button
            onClick={() => void openLibrary()}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
          >
            Library
          </button>
          {activeId && (
            <button
              onClick={() => void detach(activeId)}
              className="text-xs text-neutral-400 hover:text-red-500"
              title="Detach the open document from this notebook"
            >
              Detach
            </button>
          )}
        </div>
      </div>

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
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-white/90 backdrop-blur-sm dark:bg-neutral-950/90">
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-neutral-400 bg-white px-14 py-10 shadow-lg dark:border-neutral-500 dark:bg-neutral-900">
            <Logo size={72} className="text-neutral-800 dark:text-neutral-200" />
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              Drop PDFs to add them to this notebook
            </p>
          </div>
        </div>
      )}

      {urlOpen && (
        <form
          className="mt-2 flex gap-2"
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
            className="w-96 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button type="submit" disabled={busy !== null} className="text-sm text-neutral-600 disabled:opacity-40 dark:text-neutral-300">
            Ingest
          </button>
        </form>
      )}

      {libraryOpen && library && (
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-md border border-neutral-200 bg-white p-1 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          {library.filter((d) => !attachedIds.has(d.id)).length === 0 && (
            <li className="px-2 py-1 text-neutral-500">No other documents in the library.</li>
          )}
          {library
            .filter((d) => !attachedIds.has(d.id))
            .map((d) => (
              <li key={d.id} className="flex items-center gap-1">
                <button
                  onClick={() => void attach(d.id)}
                  className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {d.title} <span className="text-xs text-neutral-400">({d._count.blocks} blocks)</span>
                </button>
                <button
                  onClick={() => void removeFromLibrary(d.id)}
                  className="rounded px-1.5 py-1 text-xs text-neutral-400 hover:text-red-500"
                  title="Delete from the library"
                >
                  ✕
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
