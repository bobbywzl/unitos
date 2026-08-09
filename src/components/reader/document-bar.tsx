"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/api";

export type AttachedDocument = { id: string; title: string };
type LibraryDocument = { id: string; title: string; _count: { blocks: number } };

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

  async function uploadPdf(file: File) {
    setBusy("Parsing PDF…");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("notebookId", notebookId);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !json.id) throw new Error(json.error ?? "Upload failed");
      open(json.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

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
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !json.id) throw new Error(json.error ?? "Ingest failed");
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
      setLibrary((await res.json()) as LibraryDocument[]);
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
                : "bg-white text-neutral-600 hover:text-neutral-900 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:text-white"
            }`}
            title={d.title}
          >
            {d.title}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {busy && <span className="text-xs text-neutral-500">{busy}</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-neutral-500 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300"
          >
            Upload PDF
          </button>
          <button
            onClick={() => setUrlOpen(!urlOpen)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-neutral-500 dark:border-neutral-700 dark:text-neutral-300"
          >
            Add URL
          </button>
          <button
            onClick={() => void openLibrary()}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-neutral-500 dark:border-neutral-700 dark:text-neutral-300"
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
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadPdf(file);
        }}
      />

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
              <li key={d.id}>
                <button
                  onClick={() => void attach(d.id)}
                  className="w-full truncate rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {d.title} <span className="text-xs text-neutral-400">({d._count.blocks} blocks)</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
