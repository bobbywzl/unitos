"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { HistoryEntry } from "@/lib/types";
import type { Person } from "@/lib/person";
import { CollabProvider, useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { ReplyThread } from "@/components/collab/reply-thread";
import { useLang, useT } from "@/components/lang-provider";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { markdownPreview } from "@/lib/markdown-preview";
import { api } from "@/lib/api";
import { refreshWhenOnline } from "@/lib/offline/queue";

// One page of History rows (lib/history/list.ts HISTORY_PAGE): a first page
// this long may have older rows under it.
const HISTORY_PAGE = 100;
// How long Restore waits for the page's data before the tray switches.
const REFRESH_WAIT_MS = 8000;

const KIND_KEY: Record<HistoryEntry["kind"], TKey> = {
  TEXT_EDIT: "panes.historyTextEdit",
  BLOCK_ADD: "panes.historyBlockAdd",
  BLOCK_REMOVE: "panes.historyBlockRemove",
  BLOCK_MOVE: "panes.historyBlockMove",
  FORMAT: "panes.historyFormat",
  STYLE: "panes.historyStyle",
  LINE_JOIN: "panes.historyLineJoin",
  LINE_SPLIT: "panes.historyLineSplit",
  SPEAKER: "panes.historySpeaker",
  LINK_ADD: "panes.historyLinkAdd",
  LINK_REMOVE: "panes.historyLinkRemove",
  NOTE_REMOVE: "panes.historyNoteRemove",
  SECTION_REMOVE: "panes.historySectionRemove",
  DOCUMENT_DETACH: "panes.historyDocumentDetach",
  NOTE_MERGE: "panes.historyNoteMerge",
  REPARSE: "panes.historyReparse",
};

const REMOVALS = new Set<HistoryEntry["kind"]>([
  "BLOCK_REMOVE",
  "LINK_REMOVE",
  "NOTE_REMOVE",
  "SECTION_REMOVE",
  "DOCUMENT_DETACH",
]);

// FORMAT and STYLE meta values are wire data; these map them to display
// labels. Unknown values show raw.
const FORMAT_KEY: Record<string, TKey> = {
  paragraph: "panels.formatParagraph",
  h1: "panels.formatH1",
  h2: "panels.formatH2",
  h3: "panels.formatH3",
  list: "panels.formatList",
  numbered: "panels.formatNumbered",
  code: "panels.formatCode",
};
const STYLE_KEY: Record<string, TKey> = {
  bold: "panels.styleBold",
  italic: "panels.styleItalic",
  underline: "panels.styleUnderline",
  "color-ink": "panels.styleColorInk",
  "color-clay": "panels.styleColorClay",
  "color-sage": "panels.styleColorSage",
  "color-gold": "panels.styleColorGold",
  "color-plum": "panels.styleColorPlum",
};

function formatLabel(t: TFunc, kind: string | null | undefined): string {
  if (kind === undefined || kind === null) return "?";
  const key = FORMAT_KEY[kind];
  return key ? t(key) : kind;
}

function styleLabel(t: TFunc, style: string | undefined): string {
  if (style === undefined) return t("panels.styleFallback");
  if (style.startsWith("color:")) return t("panels.styleColorCustom");
  if (style.startsWith("highlight:")) return t("panels.styleHighlight");
  const key = STYLE_KEY[style];
  return key ? t(key) : style;
}

type HistoryItem = { kind: "entry"; entry: HistoryEntry } | { kind: "run"; entries: HistoryEntry[] };

// Consecutive small edits by one person in one document fold into one
// item; a single small edit stands as itself.
function foldRuns(entries: HistoryEntry[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  let run: HistoryEntry[] = [];
  const flush = () => {
    if (run.length > 1) items.push({ kind: "run", entries: run });
    else if (run.length === 1) items.push({ kind: "entry", entry: run[0] });
    run = [];
  };
  for (const entry of entries) {
    const last = run[run.length - 1];
    if (entry.trivial && (!last || (last.userId === entry.userId && last.documentTitle === entry.documentTitle))) {
      run.push(entry);
      continue;
    }
    flush();
    if (entry.trivial) run.push(entry);
    else items.push({ kind: "entry", entry });
  }
  flush();
  return items;
}

/** History's scope: the whole project, or the open document's edits (what
    the rail's Edits tab listed before it folded into History), remembered
    per browser. */
type HistoryScope = "project" | "document";
const SCOPE_STORE = "unitos-history-scope";
const scopeListeners = new Set<() => void>();
function subscribeScope(onChange: () => void) {
  scopeListeners.add(onChange);
  return () => scopeListeners.delete(onChange);
}
function readScope(): HistoryScope {
  try {
    return localStorage.getItem(SCOPE_STORE) === "document" ? "document" : "project";
  } catch {
    return "project"; // storage unavailable: the whole project
  }
}
function writeScope(next: HistoryScope) {
  try {
    localStorage.setItem(SCOPE_STORE, next);
  } catch {
    // storage unavailable: the pick does not hold
  }
  for (const fn of scopeListeners) fn();
}

type OlderPages = {
  rows: HistoryEntry[];
  people: Record<string, Person>;
  more: boolean | null;
  loading: boolean;
  error: boolean;
};
const NO_OLDER: OlderPages = { rows: [], people: {}, more: null, loading: false, error: false };

// History (SPEC.md §12), a tab of the tray opened from the header's History
// button: every edit and deletion in the project, newest first, each row
// signed by the account that did it; This document narrows it to the open
// document's edits. A person's badge narrows the rows to their actions. An
// edit's row locates the edit, keeps its replies, and, in the open
// document, its Revert or Restore.
export function HistoryPanel({
  history,
  documentHistory,
  documentId,
  liveBlockIds,
}: {
  history: HistoryEntry[];
  documentHistory: HistoryEntry[];
  /** The open document, or null when the project has none. */
  documentId: string | null;
  /** The open document's blocks: an edit there reverts while its block is. */
  liveBlockIds: string[];
}) {
  const t = useT();
  const lang = useLang();
  const collab = useCollab();
  const { authOn, people, canEdit } = collab;
  const router = useRouter();
  const { notebookId } = useParams<{ notebookId: string }>();
  const storedScope = useSyncExternalStore(subscribeScope, readScope, () => "project" as const);
  const scope: HistoryScope = documentId ? storedScope : "project";
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  // The folded runs of small edits the reader opened, by their first entry.
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  // One action in flight at a time (Restore, Add back, Revert, Restore a
  // paragraph): the row's id, the rows done in this visit, and the last
  // failure, by row.
  const [working, setWorking] = useState<string | null>(null);
  const [doneHere, setDoneHere] = useState<Set<string>>(new Set());
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  // Show older (SPEC.md §12): the pages read under the first one, per scope.
  const [olderByScope, setOlderByScope] = useState<Record<HistoryScope, OlderPages>>({
    project: NO_OLDER,
    document: NO_OLDER,
  });
  const older = olderByScope[scope];
  // Restore waits for the page's data to have the note back (the row
  // reads restored in the refreshed History), so the tray switches to Notes
  // with the note there (NAV13-05); REFRESH_WAIT_MS at most.
  const waiting = useRef<{ entryId: string; done: () => void } | null>(null);
  useEffect(() => {
    const wait = waiting.current;
    if (!wait) return;
    const row = [...history, ...documentHistory].find((e) => e.id === wait.entryId);
    if (row?.restored) {
      waiting.current = null;
      wait.done();
    }
  }, [history, documentHistory]);
  // refresh: false when a refresh is already on its way (the notes' own,
  // on dissect:note-back).
  const refreshUntilRestored = (entryId: string, refresh = true) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        if (waiting.current?.entryId === entryId) waiting.current = null;
        resolve();
      }, REFRESH_WAIT_MS);
      waiting.current = { entryId, done };
      if (refresh) router.refresh();
    });
  const setOlder = (patch: (prev: OlderPages) => OlderPages) =>
    setOlderByScope((prev) => ({ ...prev, [scope]: patch(prev[scope]) }));

  const live = new Set(liveBlockIds);
  const first = scope === "document" ? documentHistory : history;
  // Every row the panel holds: the first page as the server last drew it,
  // then the older pages, each row once.
  const firstIds = new Set(first.map((e) => e.id));
  const all = [...first, ...older.rows.filter((e) => !firstIds.has(e.id))];
  const more = older.more ?? first.length >= HISTORY_PAGE;
  // A removed paragraph that was restored is back: its Restore hides.
  const restoredParagraphs = new Set(
    [...documentHistory, ...all]
      .map((e) => (e.kind === "BLOCK_ADD" ? e.edit?.meta?.restoredFrom : undefined))
      .filter((id): id is string => !!id),
  );

  async function act(entry: HistoryEntry, run: () => Promise<unknown>, failed: TKey) {
    if (working) return;
    setWorking(entry.id);
    setRowError(null);
    try {
      await run();
      setDoneHere((prev) => new Set(prev).add(entry.id));
    } catch (err) {
      setRowError({ id: entry.id, message: err instanceof Error ? err.message : t(failed) });
    } finally {
      setWorking(null);
    }
  }

  // Restore of a removed note (lib/notes/removed.ts).
  const restoreNote = (entry: HistoryEntry) =>
    act(
      entry,
      async () => {
        const done = await api<{ noteId?: unknown }>(`/api/notebooks/${notebookId}/history/${entry.id}`, "POST");
        const detail = typeof done?.noteId === "string" ? { noteId: done.noteId } : null;
        // The notes take it back at once (a tab that deleted it hides it
        // until told) and refresh the page's data; that one refresh is the
        // wait: the row says Loading until the note is in the data, then
        // the tray switches to Notes with the note there.
        if (detail) window.dispatchEvent(new CustomEvent("dissect:note-back", { detail }));
        await refreshUntilRestored(entry.id, !detail);
        if (detail) {
          // The reader repaints its marks, and the tray shows it.
          window.dispatchEvent(new CustomEvent("dissect:note-restored", { detail }));
          window.dispatchEvent(new CustomEvent("dissect:show-note", { detail }));
        }
      },
      "panes.historyRestoreFailed",
    );

  // Add back (SPEC.md §12): the removed document returns to the project
  // with the project's work on it (lib/documents/detach.ts), as Library does.
  const addBack = (entry: HistoryEntry) =>
    act(
      entry,
      async () => {
        await api(`/api/notebooks/${notebookId}/documents`, "POST", { documentId: entry.addBackDocumentId });
        router.refresh();
      },
      "panes.historyRestoreFailed",
    );

  // Revert an edit of the open document: the paragraph takes its words from
  // before the edit.
  const revert = (entry: HistoryEntry) =>
    act(
      entry,
      async () => {
        await api(`/api/blocks/${entry.blockId}`, "PATCH", { text: entry.edit?.before });
        refreshWhenOnline(router);
      },
      "panels.revertFailed",
    );

  // Restore a removed paragraph of the open document, into its place.
  const restoreParagraph = (entry: HistoryEntry) =>
    act(
      entry,
      async () => {
        await api("/api/blocks/restore", "POST", { editId: entry.id });
        router.refresh();
      },
      "panels.restoreFailed",
    );

  const loadOlder = async () => {
    if (!notebookId || older.loading) return;
    const last = all[all.length - 1];
    if (!last) return;
    setOlder((prev) => ({ ...prev, loading: true, error: false }));
    try {
      const q = new URLSearchParams({ beforeAt: last.createdAt, beforeId: last.id });
      if (scope === "document" && documentId) q.set("documentId", documentId);
      const res = await fetch(`/api/notebooks/${notebookId}/history?${q}`);
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as { entries: HistoryEntry[]; more: boolean; people: Record<string, Person> };
      setOlder((prev) => ({
        rows: [...prev.rows, ...page.entries],
        people: { ...prev.people, ...page.people },
        more: page.more,
        loading: false,
        error: false,
      }));
    } catch {
      setOlder((prev) => ({ ...prev, loading: false, error: true }));
    }
  };

  const dateLocale = lang === "zh" ? "zh-CN" : undefined;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(dateLocale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const olderPeople = { ...olderByScope.project.people, ...olderByScope.document.people };
  const personOf = (id: string | null): Person | undefined => (id ? (people[id] ?? olderPeople[id]) : undefined);
  const nameOf = (id: string | null) => personOf(id)?.name ?? (authOn ? "?" : t("panes.historyYou"));
  const authors = [...new Set(all.map((e) => e.userId).filter((id): id is string => !!id))]
    .map((id) => personOf(id))
    .filter((p) => p !== undefined);
  const shown = personFilter ? all.filter((e) => e.userId === personFilter) : all;

  // Locate: an edit in the open document whose block is there flashes the
  // block in place; any other edit opens its document at the block (the
  // block of a removal is gone: the document opens). A removed note,
  // section, or document has nowhere to go.
  const locateOf = (entry: HistoryEntry): (() => void) | null => {
    if (!entry.documentId || !notebookId) return null;
    const blockId = entry.blockId ?? null;
    if (entry.documentId === documentId && blockId && live.has(blockId) && entry.kind !== "BLOCK_REMOVE") {
      return () => window.dispatchEvent(new CustomEvent("dissect:flash-block", { detail: { blockId } }));
    }
    const block = blockId && entry.kind !== "BLOCK_REMOVE" ? `&block=${blockId}` : "";
    const href = `/n/${notebookId}?doc=${entry.documentId}${block}`;
    return () => router.push(href);
  };

  // What an edit changed, as the row's words: the words before struck and
  // the words after, a format's two names, a style and its words, a move's
  // new place. A deletion's words are struck; any other row shows its
  // snippet as the reader sees the text (markdown markers off).
  const struck = "text-sand-500 line-through decoration-sand-400";
  const words = (entry: HistoryEntry): React.ReactNode => {
    const edit = entry.edit;
    const meta = edit?.meta ?? null;
    if (edit) {
      switch (entry.kind) {
        case "TEXT_EDIT":
        case "LINE_JOIN":
        case "LINE_SPLIT":
          return (
            <>
              {edit.before && <span className={struck}>{markdownPreview(edit.before)}</span>}
              {edit.before && edit.after ? " " : null}
              {edit.after && markdownPreview(edit.after)}
            </>
          );
        case "FORMAT":
          return `${meta?.quotedText ? `${meta.quotedText} · ` : ""}${formatLabel(t, meta?.from)} → ${formatLabel(t, meta?.to)}`;
        case "STYLE":
          return t(meta?.on === false ? "panels.styleRemoved" : "panels.styleApplied", {
            style: styleLabel(t, meta?.style),
            text: meta?.quotedText ?? "",
          });
        case "SPEAKER":
          return `${meta?.quotedText ?? ""} · ${meta?.from || t("panels.speakerNone")} → ${meta?.to || t("panels.speakerNone")}`;
        case "BLOCK_MOVE":
          return `${markdownPreview(edit.after ?? "")} · ${
            meta?.movedAfter ? t("panels.movedAfter", { text: meta.movedAfter }) : t("panels.movedToStart")
          }`;
        case "LINK_ADD":
        case "LINK_REMOVE":
          return (
            <>
              <span className={entry.kind === "LINK_REMOVE" ? struck : ""}>{meta?.quotedText ?? ""}</span>
              {` → ${meta?.toTitle ?? t("panels.documentFallback")}`}
            </>
          );
        case "REPARSE":
          return t("panels.reparseKeptText");
        default:
          break;
      }
    }
    const snippet = entry.content ? markdownPreview(entry.content) : "";
    if (!snippet) return null;
    return REMOVALS.has(entry.kind) ? <span className={struck}>{snippet}</span> : snippet;
  };

  const actionButton =
    "shrink-0 rounded-full border border-line px-2.5 py-0.5 text-[11px] font-semibold text-clay-800 hover:bg-clay-100 disabled:opacity-60 pointer-coarse:px-3.5 pointer-coarse:py-2";
  const doneLabel = "shrink-0 text-[11px] font-semibold text-sage-700";

  // The one action a row carries, at the right of its name line: Restore a
  // removed note or section, Add back a removed document, and — in the open document,
  // for editors — Revert an edit or Restore a removed paragraph.
  const actionOf = (entry: HistoryEntry): React.ReactNode => {
    const busy = working === entry.id;
    if (entry.restorable) {
      if (entry.restored || doneHere.has(entry.id)) {
        return <span className={doneLabel}>{t("panes.historyRestoredLabel")}</span>;
      }
      if (!canEdit) return null;
      return (
        <button
          type="button"
          onClick={() => void restoreNote(entry)}
          disabled={working !== null}
          data-track="history-restore"
          data-tip={t(entry.kind === "SECTION_REMOVE" ? "panes.historyRestoreSectionTitle" : "panes.historyRestoreTitle")}
          className={actionButton}
        >
          {busy ? t("common.loading") : t("panes.historyRestore")}
        </button>
      );
    }
    if (entry.addBackDocumentId) {
      if (doneHere.has(entry.id)) return <span className={doneLabel}>{t("panes.historyAddedBack")}</span>;
      if (!canEdit) return null;
      return (
        <button
          type="button"
          onClick={() => void addBack(entry)}
          disabled={working !== null}
          data-track="history-add-back"
          data-tip={t("panes.historyAddBackTitle")}
          className={actionButton}
        >
          {busy ? t("common.loading") : t("panes.historyAddBack")}
        </button>
      );
    }
    if (!entry.edit || entry.documentId !== documentId || !canEdit) return null;
    const blockLive = !!entry.blockId && live.has(entry.blockId);
    if (entry.kind === "TEXT_EDIT" && entry.edit.before !== null && blockLive) {
      return (
        <button
          type="button"
          onClick={() => void revert(entry)}
          disabled={working !== null}
          data-track="edit-revert"
          data-tip={t("panels.revertTitle")}
          className={actionButton}
        >
          {busy ? t("panels.reverting") : t("panels.revert")}
        </button>
      );
    }
    if (entry.kind === "BLOCK_REMOVE" && !blockLive && !restoredParagraphs.has(entry.id) && !doneHere.has(entry.id)) {
      return (
        <button
          type="button"
          onClick={() => void restoreParagraph(entry)}
          disabled={working !== null}
          data-track="edit-restore"
          data-tip={t("panels.restoreTitle")}
          className={actionButton}
        >
          {busy ? t("panels.restoring") : t("panels.restore")}
        </button>
      );
    }
    return null;
  };

  // Under the words: the document (when the rows span the project) and the
  // time, on one line.
  const placeLine = (entry: HistoryEntry) => (
    <span className="flex min-w-0 gap-1.5 text-[10px] text-sand-500">
      {entry.documentTitle && scope === "project" && <span className="truncate">{entry.documentTitle}</span>}
      <span suppressHydrationWarning className="shrink-0">
        {when(entry.createdAt)}
      </span>
    </span>
  );
  const badge = (id: string | null) => {
    const person = personOf(id);
    return person ? (
      <PersonBadge person={person} size={20} />
    ) : (
      <span className="size-5 shrink-0 rounded-full border border-dashed border-sand-400" />
    );
  };

  // One entry as a row: the badge, the person and what they did, the
  // action at the right; under it the words, then the place line; under an
  // edit, its replies. A row with a place locates it on a press.
  const row = (entry: HistoryEntry) => {
    const locate = locateOf(entry);
    const text = words(entry);
    const body = (
      <>
        <span className="block truncate text-[12px]">
          {/* Without sign-in every entry is the local reader's. */}
          <span className="font-semibold">{nameOf(entry.userId)}</span>{" "}
          <span className="text-sand-600">{t(KIND_KEY[entry.kind] ?? "panes.historyTextEdit")}</span>
        </span>
        {text && <span className="line-clamp-2 text-[11.5px] text-sand-700">{text}</span>}
        {placeLine(entry)}
      </>
    );
    // An edit's discussion: every edit that has one, and every edit of the
    // open document, where the Edits tab offered Reply.
    const thread =
      entry.edit && (entry.edit.replies.length > 0 || entry.documentId === documentId) ? (
        <ReplyThread target={{ blockEditId: entry.id }} replies={entry.edit.replies} />
      ) : null;
    return (
      <div key={entry.id} data-history-row={entry.id} className="flex items-start gap-2.5">
        {badge(entry.userId)}
        <div className="min-w-0 flex-1">
          {locate ? (
            <button
              type="button"
              onClick={locate}
              data-track="history-open"
              data-tip={t("panes.historyOpenTitle")}
              className="-mx-1.5 -my-0.5 flex w-[calc(100%+12px)] flex-col rounded-lg px-1.5 py-0.5 text-left hover:bg-clay-100"
            >
              {body}
            </button>
          ) : (
            <div className="flex flex-col">{body}</div>
          )}
          {rowError?.id === entry.id && <p className="text-[11px] text-clay-700">{rowError.message}</p>}
          {thread}
        </div>
        {actionOf(entry)}
      </div>
    );
  };

  // A finger gets a 36 px target (NAV13-12); a mouse the small pill.
  const pill = "rounded-full px-3 py-1 text-[11.5px] font-semibold pointer-coarse:py-2.5";
  return (
    // Older pages' people sign their rows and their replies too.
    <CollabProvider value={{ ...collab, people: { ...olderPeople, ...people } }}>
      <div data-history-panel className="flex flex-col gap-3">
        {(documentId || authors.length > 1) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {documentId && (
              <div className="flex rounded-full border border-line p-0.5" role="group" aria-label={t("panes.history")}>
                {(["project", "document"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => writeScope(s)}
                    data-track={`history-scope:${s}`}
                    aria-pressed={scope === s}
                    data-tip={t(s === "project" ? "panes.historyScopeProjectTitle" : "panes.historyScopeDocumentTitle")}
                    className={`${pill} ${scope === s ? "bg-clay-100 text-clay-800" : "text-sand-600 hover:text-clay-800"}`}
                  >
                    {t(s === "project" ? "panes.historyScopeProject" : "panes.historyScopeDocument")}
                  </button>
                ))}
              </div>
            )}
            {authors.length > 1 && (
              <span className="ml-auto flex items-center gap-1">
                {authors.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPersonFilter(personFilter === p.id ? null : p.id)}
                    data-track="history-person"
                    aria-pressed={personFilter === p.id}
                    aria-label={p.name}
                    data-tip={p.name}
                    className={`rounded-full ${personFilter === p.id ? "ring-2 ring-clay-500" : "opacity-70 hover:opacity-100"}`}
                  >
                    <PersonBadge person={p} size={20} />
                  </button>
                ))}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {shown.length === 0 && (
            <p className="text-[13px] text-sand-600">
              {t(scope === "document" ? "panes.historyDocumentEmpty" : "panes.historyEmpty")}
            </p>
          )}
          {foldRuns(shown).map((item) => {
            if (item.kind === "entry") return row(item.entry);
            // A run of small edits by one person in one document, folded
            // into one row (SPEC.md §12); Show opens it.
            const head = item.entries[0];
            const opened = openRuns.has(head.id);
            return (
              <div key={`run-${head.id}`} className="flex flex-col gap-2.5">
                <div className="flex items-start gap-2.5">
                  {badge(head.userId)}
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[12px]">
                      <span className="font-semibold">{nameOf(head.userId)}</span>{" "}
                      <span className="text-sand-600">{t("panes.historySmallEdits", { n: item.entries.length })}</span>
                    </span>
                    {placeLine(head)}
                  </div>
                  <button
                    onClick={() =>
                      setOpenRuns((prev) => {
                        const next = new Set(prev);
                        if (opened) next.delete(head.id);
                        else next.add(head.id);
                        return next;
                      })
                    }
                    data-track="history-small-edits"
                    aria-expanded={opened}
                    className="shrink-0 text-[11px] font-semibold text-clay-700 hover:text-clay-800"
                  >
                    {t(opened ? "panes.historyHideSmall" : "panes.historyShowSmall")}
                  </button>
                </div>
                {opened && <div className="flex flex-col gap-2.5 pl-4">{item.entries.map(row)}</div>}
              </div>
            );
          })}
          {more && (
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={older.loading}
                data-track="history-older"
                className="rounded-full border border-line px-3 py-1 text-[11.5px] font-semibold text-clay-800 hover:bg-clay-100 disabled:opacity-60"
              >
                {older.loading ? t("common.loading") : t("panes.historyOlder")}
              </button>
              {older.error && <span className="text-[11px] text-clay-700">{t("panes.historyOlderFailed")}</span>}
            </div>
          )}
        </div>
      </div>
    </CollabProvider>
  );
}
