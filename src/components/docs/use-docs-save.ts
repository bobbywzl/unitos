"use client";

import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { OWN_SAVE_EVENT, REFRESH_EVENT } from "@/components/collab/use-sync";
import { mergeRichText } from "@/lib/docs/merge";
import { newBlockId, type RichNode } from "@/lib/docs/schema";

// Saving a blank document (SPEC.md §29), the way Google Docs saves: no Save
// button. Typing marks the document unsaved; a pause of SAVE_DELAY_MS, or
// MAX_WAIT_MS of steady typing, sends the whole rich text with the revision
// it started from. One save runs at a time. A save that meets a newer
// revision merges the editor's changes over the stored copy
// (lib/docs/merge.ts) and saves again; a lost connection retries with a
// growing wait, and at once when the browser is back online. A stored copy
// goes on screen as one change outside the undo history, so Ctrl+Z takes
// back only this person's own steps. Leaving the page with unsaved changes
// tries one last save and asks the browser to warn.

export type SaveState = "saved" | "saving" | "unsaved" | "offline" | "error";

export const SAVE_DELAY_MS = 700;
export const MAX_WAIT_MS = 3_000;
/** The largest body a keepalive request may carry on unload. */
const KEEPALIVE_LIMIT = 60_000;

type Response409 = { reason?: string; rev?: number; richText?: RichNode | null; ids?: string[] };

/** Put a stored copy on screen: one step over the stretch that differs, kept
    out of the undo history; the caret maps through it. */
function applyStored(editor: Editor, json: RichNode): void {
  const next = editor.schema.nodeFromJSON(json);
  const { doc, tr } = editor.state;
  for (const [key, value] of Object.entries(next.attrs)) {
    if (JSON.stringify(doc.attrs[key]) !== JSON.stringify(value)) tr.setDocAttribute(key, value);
  }
  const start = doc.content.findDiffStart(next.content);
  if (start !== null) {
    let { a: endA, b: endB } = doc.content.findDiffEnd(next.content) ?? { a: doc.content.size, b: next.content.size };
    // Repeated nodes can put the end before the start.
    const overlap = start - Math.min(endA, endB);
    if (overlap > 0) {
      endA += overlap;
      endB += overlap;
    }
    tr.replace(start, endA, next.slice(start, endB));
  }
  if (!tr.docChanged) return;
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

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
    // The text is the stored copy again (typed and taken back): nothing to
    // send, and the page's revision still names the screen.
    if (JSON.stringify(doc) === JSON.stringify(baseRef.current)) {
      dirtyRef.current = false;
      firstDirtyAtRef.current = null;
      setState("saved");
      return;
    }
    setState("saving");
    // Typing from here on starts its own wait: steady typing saves once per MAX_WAIT_MS.
    firstDirtyAtRef.current = null;
    const run = (async () => {
      try {
        const res = await fetch(url, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ richText: doc, rev: revRef.current }),
        });
        if (res.status === 409) {
          // The server answered: the next save goes at the usual pace.
          retryRef.current = 0;
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
            // The stored copies come back with their keys reordered and their
            // default attributes left out: compare them in the editor's form.
            const normal = (json: RichNode) => editor.schema.nodeFromJSON(json).toJSON() as RichNode;
            const merged = mergeRichText(normal(baseRef.current), editor.getJSON() as RichNode, normal(body.richText));
            applyStored(editor, merged);
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
        const body = (await res.json()) as { rev: number; notebookRevs?: Record<string, number>; marksChanged?: boolean };
        window.dispatchEvent(new CustomEvent(OWN_SAVE_EVENT, { detail: body.notebookRevs ?? {} }));
        // A mark lost or found again: the page takes the stored highlights now.
        if (body.marksChanged) window.dispatchEvent(new Event(REFRESH_EVENT));
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
      const wait = retryRef.current > 0 ? Math.min(10_000, 1000 * 2 ** retryRef.current) : SAVE_DELAY_MS;
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
      setState((s) => (s === "saving" || s === "offline" ? s : "unsaved"));
      // After a failure the retry's wait stands: typing does not fire more saves.
      if (retryRef.current > 0 && timerRef.current) return;
      clearTimer();
      const waited = Date.now() - (firstDirtyAtRef.current ?? Date.now());
      timerRef.current = setTimeout(() => void save(), waited >= MAX_WAIT_MS ? 0 : SAVE_DELAY_MS);
    };
    editor.on("transaction", onUpdate);
    // Back online: save now rather than at the end of the retry's wait.
    const onOnline = () => {
      if (dirtyRef.current) void save();
    };
    window.addEventListener("online", onOnline);
    return () => {
      editor.off("transaction", onUpdate);
      window.removeEventListener("online", onOnline);
    };
  }, [editor, enabled, save]);

  // A newer stored copy arrived with the page (someone else's save, or a
  // server-side edit such as the assistant's): take it when nothing is
  // waiting to be saved here; otherwise the next save merges.
  useEffect(() => {
    if (!editor || editor.isDestroyed || rev <= revRef.current) return;
    if (dirtyRef.current || inFlightRef.current || editor.view.composing) return;
    loadingRef.current = true;
    try {
      applyStored(editor, richText);
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
        // Offline, it fails quietly: the warning still asks.
        fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
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

  /** The screen holds exactly the stored copy of revision `rev`: nothing
      waits to be saved and no save runs. */
  const matches = useCallback((rev: number) => !dirtyRef.current && !inFlightRef.current && revRef.current === rev, []);

  /** Save now and resolve once the stored copy matches the screen. */
  const flush = useCallback(async () => {
    for (let i = 0; i < 4 && (dirtyRef.current || inFlightRef.current); i++) {
      if (inFlightRef.current) await inFlightRef.current;
      if (dirtyRef.current) await save();
    }
  }, [save]);

  return { state, flush, matches };
}
