"use client";

import type { Editor } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
/** Meta of the change that puts a stored or merged copy on screen: someone
    else's words, not this person's typing. */
export const STORED_COPY = "docsStoredCopy";

/** The wait before the next try after `n` failed saves in a row, up to 10 s. */
export const retryWait = (n: number) => Math.min(10_000, 1000 * 2 ** n);

/** Leaving the page with a change not saved: one last save, which fails
    quietly offline, and the browser's warning. */
export function saveOnLeave(e: BeforeUnloadEvent, url: string, method: "PUT" | "PATCH", data: object): void {
  const body = JSON.stringify(data);
  if (body.length <= KEEPALIVE_LIMIT) {
    fetch(url, { method, headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  }
  e.preventDefault();
}

type Response409 = { reason?: string; rev?: number; richText?: RichNode | null; ids?: string[] };

/** The node and mark types of a stored copy that this build's schema does
    not know: a newer build wrote them. The editor would open such a copy
    empty, and a save from it would replace the text with nothing. */
export function unknownTypes(json: RichNode, schema: Schema): string[] {
  const unknown = new Set<string>();
  const walk = (node: RichNode) => {
    if (!schema.nodes[node.type]) unknown.add(node.type);
    for (const mark of node.marks ?? []) if (!schema.marks[mark.type]) unknown.add(mark.type);
    for (const child of node.content ?? []) walk(child);
  };
  walk(json);
  return [...unknown];
}

// A stored copy holds a type this build does not know: the page reloads
// once, to the newer build, and notes it for this tab. A second reload would
// loop, so the page then shows why instead; so does a browser without
// session storage. A copy that opens clears the note.
const reloadKey = (documentId: string) => `unitos-docs-reload:${documentId}`;

function reloadSpent(documentId: string): boolean {
  try {
    return sessionStorage.getItem(reloadKey(documentId)) !== null;
  } catch {
    return true;
  }
}

function reloadOnce(documentId: string): void {
  try {
    sessionStorage.setItem(reloadKey(documentId), String(Date.now()));
  } catch {
    return;
  }
  window.location.reload();
}

function clearReload(documentId: string): void {
  try {
    sessionStorage.removeItem(reloadKey(documentId));
  } catch {
    // Nothing was noted.
  }
}

/** Why the editor cannot show the stored copy: the page is reloading to a
    newer build, or it reloaded once already and did not get one. */
export type Outdated = "reloading" | "stale";

/** A node's partner in the other copy: its type and the first blockId in it,
    as the merge pairs them (lib/docs/merge.ts). */
function pairKey(node: PMNode): string {
  let id = node.attrs.blockId as string | null;
  if (!id) node.descendants((child) => !(id ??= child.attrs.blockId as string | null));
  return `${node.type.name}:${id ?? ""}`;
}

/** Make the node at `pos` (-1: the document) into `next`, touching only what
    differs, from the end backwards so the positions before stay true: a
    paragraph takes one replace of the words that differ; other children pair
    by pairKey, or in place by type when neither key is on the other side,
    and a child without a partner is removed or added whole (of two that
    moved past each other, the one that moved farther). */
function patch(tr: Transaction, node: PMNode, next: PMNode, pos: number): void {
  if (node.eq(next)) return;
  if (pos >= 0 && !node.sameMarkup(next)) tr.setNodeMarkup(pos, undefined, next.attrs, next.marks);
  const start = pos + 1;
  if (node.isTextblock) {
    const from = node.content.findDiffStart(next.content);
    if (from === null) return;
    let { a, b } = node.content.findDiffEnd(next.content) ?? { a: node.content.size, b: next.content.size };
    // Repeated letters can put the end before the start.
    const overlap = from - Math.min(a, b);
    if (overlap > 0) [a, b] = [a + overlap, b + overlap];
    tr.replaceWith(start + from, start + a, next.content.cut(from, b));
    return;
  }
  // The places of the children not walked yet, by pairKey, on each side.
  const places = (parent: PMNode) => {
    const at = new Map<string, number[]>();
    parent.forEach((child, _, k) => at.set(pairKey(child), [...(at.get(pairKey(child)) ?? []), k]));
    return at;
  };
  const [left, right] = [places(node), places(next)];
  let [i, j, end] = [node.childCount, next.childCount, start + node.content.size];
  while (i > 0 || j > 0) {
    const a = i > 0 ? node.child(i - 1) : null;
    const b = j > 0 ? next.child(j - 1) : null;
    const [ka, kb] = [a ? pairKey(a) : "", b ? pairKey(b) : ""];
    // Where b stands on screen, and a in the stored copy (-1: nowhere).
    const p = left.get(kb)?.at(-1) ?? -1;
    const q = right.get(ka)?.at(-1) ?? -1;
    if (a && b && (ka === kb || (a.type === b.type && p < 0 && q < 0))) {
      patch(tr, a, b, end - a.nodeSize);
      right.get(kb)?.pop();
      j--;
    } else if (b && (p < 0 || (q >= 0 && j - 1 - q < i - 1 - p))) {
      tr.insert(end, b);
      right.get(kb)?.pop();
      j--;
      continue;
    } else if (a) {
      tr.delete(end - a.nodeSize, end);
    }
    if (a) {
      left.get(ka)?.pop();
      end -= a.nodeSize;
      i--;
    }
  }
}

/** Put a stored copy on screen, kept out of the undo history: what is equal
    stays untouched, so the caret and the marks outside the changed words
    keep their place. */
function applyStored(editor: Editor, json: RichNode): void {
  const next = editor.schema.nodeFromJSON(json);
  const { doc } = editor.state;
  let tr = editor.state.tr;
  try {
    patch(tr, doc, next, -1);
  } catch {
    // Checked below.
  }
  // A step the schema would not take on the way: the whole text at once.
  if (!tr.doc.content.eq(next.content)) tr = editor.state.tr.replaceWith(0, doc.content.size, next.content);
  for (const [key, value] of Object.entries(next.attrs)) {
    if (JSON.stringify(doc.attrs[key]) !== JSON.stringify(value)) tr.setDocAttribute(key, value);
  }
  if (!tr.docChanged) return;
  editor.view.dispatch(tr.setMeta(STORED_COPY, true).setMeta("addToHistory", false));
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
  // A stored copy that holds a type this build does not know (a newer build
  // wrote it): the page, or a conflict's answer. The editor never shows it
  // and never saves over it; the page reloads once instead.
  const storedUnknown = useMemo(() => (editor ? unknownTypes(richText, editor.schema).length > 0 : false), [editor, richText]);
  const [conflictUnknown, setConflictUnknown] = useState(false);
  const newer = storedUnknown || conflictUnknown;
  const outdated = useMemo<Outdated | null>(() => (newer ? (reloadSpent(documentId) ? "stale" : "reloading") : null), [newer, documentId]);
  useEffect(() => {
    if (outdated === "reloading") reloadOnce(documentId);
    else if (outdated === null && editor) clearReload(documentId);
  }, [outdated, editor, documentId]);
  const live = enabled && !newer;
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
  // The first copy sent since the server last answered whose answer never
  // came: the server may hold it.
  const lostRef = useRef<RichNode | null>(null);
  // Set while a stored copy is being put on screen: that is not typing.
  const loadingRef = useRef(false);
  // The editor went away: no more tries.
  const closedRef = useRef(false);
  const url = `/api/documents/${documentId}/rich-text`;

  // The latest save, for the timers a save sets for the next one.
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const save = useCallback(async (): Promise<void> => {
    if (!editor || !live) return;
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
          } else if (body.reason === "rev" && body.richText && unknownTypes(body.richText, editor.schema).length > 0) {
            // A newer build saved it: this one cannot lay the typing over it.
            setConflictUnknown(true);
            return;
          } else if (body.reason === "rev" && body.richText && typeof body.rev === "number" && !editor.isDestroyed) {
            // The stored copies come back with their keys reordered and their
            // default attributes left out: compare them in the editor's form.
            const normal = (json: RichNode) => editor.schema.nodeFromJSON(json).toJSON() as RichNode;
            const stored = normal(body.richText);
            // The stored copy is the one whose answer was lost: nobody else's words to lay in.
            const lost = lostRef.current && JSON.stringify(normal(lostRef.current)) === JSON.stringify(stored);
            const merged = mergeRichText(lost ? stored : normal(baseRef.current), editor.getJSON() as RichNode, stored);
            applyStored(editor, merged);
            baseRef.current = body.richText;
            revRef.current = body.rev;
            lostRef.current = null;
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
        lostRef.current = null;
        if (versionRef.current === version) {
          dirtyRef.current = false;
          firstDirtyAtRef.current = null;
          setState("saved");
        }
      } catch {
        setState("offline");
        retryRef.current = Math.min(retryRef.current + 1, 5);
        lostRef.current ??= doc;
      }
    })();
    inFlightRef.current = run;
    await run;
    inFlightRef.current = null;
    if (dirtyRef.current && !closedRef.current) {
      // Typing went on, a merge needs saving, or the save failed: go again,
      // waiting longer after each failure.
      const wait = retryRef.current > 0 ? retryWait(retryRef.current) : SAVE_DELAY_MS;
      clearTimer();
      timerRef.current = setTimeout(() => void saveRef.current(), wait);
    }
  }, [editor, live, url]);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Every change marks the document unsaved and schedules a save.
  useEffect(() => {
    if (!editor || !live) return;
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
  }, [editor, live, save]);

  // A newer stored copy arrived with the page (someone else's save, or a
  // server-side edit such as the assistant's): take it when nothing is
  // waiting to be saved here; otherwise the next save merges.
  useEffect(() => {
    if (!editor || editor.isDestroyed || rev <= revRef.current || storedUnknown) return;
    if (dirtyRef.current || inFlightRef.current || editor.view.composing) return;
    loadingRef.current = true;
    try {
      applyStored(editor, richText);
    } finally {
      loadingRef.current = false;
    }
    baseRef.current = richText;
    revRef.current = rev;
  }, [editor, rev, richText, storedUnknown]);

  // Leaving with unsaved changes: one last save, and the browser's warning.
  useEffect(() => {
    if (!editor || !live) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) saveOnLeave(e, url, "PUT", { richText: editor.getJSON(), rev: revRef.current });
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [editor, live, url]);

  // The editor goes away (another document opens): one last save of what
  // waits, and no try after it.
  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dirtyRef.current) void saveRef.current();
    };
  }, []);

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

  return { state, flush, matches, outdated };
}
