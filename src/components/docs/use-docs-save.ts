"use client";

import type { Editor, JSONContent } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { mergeRichText } from "@/lib/docs/merge";
import { newBlockId, type RichNode } from "@/lib/docs/schema";

// Saving a blank document (SPEC.md §29), the way Google Docs saves: no Save
// button. Typing marks the document unsaved; a pause of SAVE_DELAY_MS, or
// MAX_WAIT_MS of steady typing, sends the whole rich text with the revision
// it started from. One save runs at a time. A save that meets a newer
// revision merges the editor's changes over the stored copy
// (lib/docs/merge.ts) and saves again; a lost connection retries with a
// growing wait. Leaving the page with unsaved changes tries one last save
// and asks the browser to warn.

export type SaveState = "saved" | "saving" | "unsaved" | "offline" | "error";

const SAVE_DELAY_MS = 700;
const MAX_WAIT_MS = 3_000;
/** The largest body a keepalive request may carry on unload. */
const KEEPALIVE_LIMIT = 60_000;

type Response409 = { reason?: string; rev?: number; richText?: RichNode | null; ids?: string[] };

export function useDocsSave({
  documentId,
  editor,
  rev,
  richText,
  enabled,
}: {
  documentId: string;
  editor: Editor | null;
  /** The stored revision the page was rendered with. */
  rev: number;
  /** The stored rich text the page was rendered with. */
  richText: RichNode;
  enabled: boolean;
}) {
  const [state, setState] = useState<SaveState>("saved");
  const revRef = useRef(rev);
  // The copy the stored revision holds: the base a merge compares against.
  const baseRef = useRef<RichNode>(richText);
  const dirtyRef = useRef(false);
  // Bumped on every change, so a save knows whether typing went on under it.
  const versionRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstDirtyAtRef = useRef<number | null>(null);
  const retryRef = useRef(0);
  // Set while a stored copy is being put on screen: that is not typing.
  const loadingRef = useRef(false);
  const url = `/api/documents/${documentId}/rich-text`;

  // The latest save, for the timers a save sets for the next one.
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const save = useCallback(async (): Promise<void> => {
    if (!editor || !enabled) return;
    // One save at a time: every caller waits out the save that runs, and
    // the first to wake starts the next before any other can.
    while (inFlightRef.current) await inFlightRef.current;
    clearTimer();
    if (!dirtyRef.current) return;
    const version = versionRef.current;
    const doc = editor.getJSON() as RichNode;
    setState("saving");
    const run = (async () => {
      try {
        const res = await fetch(url, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ richText: doc, rev: revRef.current }),
        });
        if (res.status === 409) {
          const body = (await res.json().catch(() => ({}))) as Response409;
          if (body.reason === "ids" && body.ids && !editor.isDestroyed) {
            // A pasted paragraph carried an id another document holds.
            const clash = new Set(body.ids);
            const tr = editor.state.tr;
            editor.state.doc.descendants((node, pos) => {
              if (clash.has(node.attrs.blockId as string)) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: newBlockId() });
              }
            });
            tr.setMeta("addToHistory", false);
            editor.view.dispatch(tr);
          } else if (body.reason === "rev" && body.richText && typeof body.rev === "number" && !editor.isDestroyed) {
            const merged = mergeRichText(baseRef.current, editor.getJSON() as RichNode, body.richText);
            const { from, to } = editor.state.selection;
            editor.commands.setContent(merged as JSONContent, { emitUpdate: false });
            const max = editor.state.doc.content.size;
            editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
            baseRef.current = body.richText;
            revRef.current = body.rev;
          }
          dirtyRef.current = true;
          versionRef.current += 1;
          return;
        }
        if (!res.ok) {
          setState(res.status >= 500 ? "offline" : "error");
          retryRef.current = Math.min(retryRef.current + 1, 5);
          return;
        }
        const body = (await res.json()) as { rev: number };
        revRef.current = body.rev;
        baseRef.current = doc;
        retryRef.current = 0;
        if (versionRef.current === version) {
          dirtyRef.current = false;
          firstDirtyAtRef.current = null;
          setState("saved");
        }
      } catch {
        setState("offline");
        retryRef.current = Math.min(retryRef.current + 1, 5);
      }
    })();
    inFlightRef.current = run;
    await run;
    inFlightRef.current = null;
    if (dirtyRef.current) {
      // Typing went on, a merge needs saving, or the save failed: go again,
      // waiting longer after each failure.
      const wait = retryRef.current > 0 ? Math.min(30_000, 1000 * 2 ** retryRef.current) : SAVE_DELAY_MS;
      clearTimer();
      timerRef.current = setTimeout(() => void saveRef.current(), wait);
    }
  }, [editor, enabled, url]);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Every change marks the document unsaved and schedules a save.
  useEffect(() => {
    if (!editor || !enabled) return;
    const onUpdate = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged || loadingRef.current) return;
      dirtyRef.current = true;
      versionRef.current += 1;
      firstDirtyAtRef.current ??= Date.now();
      setState((s) => (s === "saving" ? s : "unsaved"));
      clearTimer();
      const waited = Date.now() - (firstDirtyAtRef.current ?? Date.now());
      timerRef.current = setTimeout(() => void save(), waited >= MAX_WAIT_MS ? 0 : SAVE_DELAY_MS);
    };
    editor.on("transaction", onUpdate);
    return () => {
      editor.off("transaction", onUpdate);
    };
  }, [editor, enabled, save]);

  // A newer stored copy arrived with the page (someone else's save, or a
  // server-side edit such as the assistant's): take it when nothing is
  // waiting to be saved here; otherwise the next save merges.
  useEffect(() => {
    if (!editor || editor.isDestroyed || rev <= revRef.current) return;
    if (dirtyRef.current || inFlightRef.current) return;
    const { from, to } = editor.state.selection;
    loadingRef.current = true;
    try {
      editor.commands.setContent(richText as JSONContent, { emitUpdate: false });
      const max = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
    } finally {
      loadingRef.current = false;
    }
    baseRef.current = richText;
    revRef.current = rev;
  }, [editor, rev, richText]);

  // Leaving with unsaved changes: one last save, and the browser's warning.
  useEffect(() => {
    if (!editor || !enabled) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      const body = JSON.stringify({ richText: editor.getJSON(), rev: revRef.current });
      if (body.length <= KEEPALIVE_LIMIT) {
        void fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body, keepalive: true });
      }
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [editor, enabled, url]);

  // Save what is waiting when the editor goes away (another document opens).
  useEffect(() => {
    return () => {
      if (dirtyRef.current) void save();
    };
  }, [save]);

  /** Save now and resolve once the stored copy matches the screen. */
  const flush = useCallback(async () => {
    for (let i = 0; i < 4 && (dirtyRef.current || inFlightRef.current); i++) {
      if (inFlightRef.current) await inFlightRef.current;
      if (dirtyRef.current) await save();
    }
  }, [save]);

  return { state, flush };
}
