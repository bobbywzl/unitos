"use client";

import { ACTION, ACTION_ACCEPT, CLOSE, SECTION_HEAD, TEXT_HIT } from "./graph-ui";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { GraphEdge } from "@/lib/types";
import { readGraphKeep, writeGraphKeep } from "@/components/graph/graph-keep";
import { useCollab } from "@/components/collab/collab-context";
import { NotesIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { useGraphNotes, useGraphNotesLit } from "@/components/graph/graph-notes";
import { LinkReplyCount } from "@/components/graph/link-replies";
import { ReplyThread } from "@/components/collab/reply-thread"; // [layer5]
import { ListName } from "@/components/graph/list-name"; // [lists7]
import { noteLine, type GraphNote } from "@/lib/graph/notes";
import { clipWords } from "@/lib/markdown-preview";
import { splitNote } from "@/lib/note-title";

// The Notes list beside the canvas (SPEC.md §13): a lens on the graph, not a
// second notes page. It lists the notes in focus — the note Show on graph
// opened it on (its documents lit, the links between them under it), else
// the pinned curve's notes quoting both documents, else the notes quoting
// the documents picked for Stitch, else every note that quotes two or more
// documents — grouped by section. The notes on one document fold under a
// line that shows them in place, beside a link to the notes full page
// (VIEW3-04, VIEW3-05). Hovering a row lights the documents the note quotes; a click
// reads it here, its quotes each with Jump; editing stays in the tray.
// Section filters the list and the graph: the node chips, the note curves,
// and the nodes no note of the section touches dim. The notes on no
// document of the graph close the list under Notes on the project, so a
// note saved from the graph is always found here. Accept and Reject show at
// once and come back with the error if the server refuses; a rejected note
// leaves a "Note rejected · Undo" line in its place while the list is open.

/** The header pill that opens and folds the list. */
export function NotesListToggle({
  open,
  onToggle,
  controls,
}: {
  open: boolean;
  onToggle: (e: { currentTarget: HTMLElement }) => void;
  /** The list's id (aria-controls). */
  controls?: string;
}) {
  const t = useT();
  const ctx = useGraphNotes();
  if (!ctx) return null;
  return (
    <button
      onClick={onToggle}
      data-track="graph-notes"
      aria-expanded={open}
      aria-controls={controls}
      data-tip={t("graphNotes.notesToggleTitle")}
      className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] whitespace-nowrap hover:bg-clay-100 max-md:gap-1 max-md:px-2 hover:text-clay-800 ${
        open ? "border-line bg-clay-100 text-clay-800" : ctx.sectionId ? "border-sage-400 text-sage-800" : "border-line text-sand-600"
      }`}
    >
      <NotesIcon size={13} />
      <span className="max-md:sr-only">{t("graphNotes.notes")}</span>
      <span className="rounded-full bg-sand-200 px-1.5 text-[11px] font-semibold tabular-nums text-sand-700">
        {ctx.view.notes.length + ctx.view.projectNotes.length}
      </span>
    </button>
  );
}

/** Which list of the Notes list a row is in: a rejected note keeps its place there. */
type Where = "shown" | "single" | "project";

function bySection(notes: GraphNote[]): { id: string; title: string; notes: GraphNote[] }[] {
  const groups = new Map<string, { id: string; title: string; notes: GraphNote[] }>();
  for (const g of notes) {
    const group = groups.get(g.sectionId) ?? { id: g.sectionId, title: g.sectionTitle, notes: [] };
    group.notes.push(g);
    groups.set(g.sectionId, group);
  }
  return [...groups.values()];
}

export function GraphNotesList({
  pickedIds,
  shownId,
  onClearShown,
  edges,
  onOpenLink,
  onClose,
}: {
  pickedIds: Set<string>;
  /** The note Show on graph opened the list on; null = none. */
  shownId: string | null;
  /** Back to the usual list. */
  onClearShown: () => void;
  edges: GraphEdge[];
  /** Open a link in the side panel; its Back returns here. */
  onOpenLink: (linkId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const ctx = useGraphNotes();
  const { pinnedPair } = useGraphNotesLit();
  // The open note survives a trip to a document and Back (WALK2-07); the
  // note Show on graph opened the list on opens read.
  const [openId, setOpenIdState] = useState<string | null>(
    () => shownId ?? readGraphKeep(ctx?.notebookId).noteId ?? null,
  );
  // The notes on one document, shown in place under the list.
  const [singleOpen, setSingleOpen] = useState(false);
  const every = ctx?.every;
  const shownNote = useMemo(() => {
    if (!shownId || !every) return null;
    return (
      every.notes.find((g) => g.note.id === shownId) ?? every.projectNotes.find((g) => g.note.id === shownId) ?? null
    );
  }, [shownId, every]);
  const shownDocs = shownNote?.documentIds.join(" ") ?? "";
  const setFocusLit = ctx?.setFocusLit;
  // The shown note's documents stay lit while it is shown.
  useEffect(() => {
    if (!setFocusLit || !shownDocs) return;
    setFocusLit(new Set(shownDocs.split(" ")));
    return () => setFocusLit(null);
  }, [setFocusLit, shownDocs]);
  const setOpenId = (id: string | null) => {
    setOpenIdState(id);
    writeGraphKeep(ctx?.notebookId, { noteId: id });
  };
  // Accept and Reject before the server answers: accepted rows read
  // accepted, rejected rows leave the list for an Undo line.
  const [acceptedNow, setAcceptedNow] = useState<Set<string>>(() => new Set());
  const [rejectedNow, setRejectedNow] = useState<{ g: GraphNote; where: Where }[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!ctx) return null;
  const { view } = ctx;
  const graphNotes = ctx;

  const message = (err: unknown) => (err instanceof Error ? err.message : t("common.requestFailed"));
  const without = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    next.delete(value);
    return next;
  };
  const setError = (id: string, text: string | null) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (text === null) delete next[id];
      else next[id] = text;
      return next;
    });
  async function decide(g: GraphNote, accept: boolean, where: Where) {
    const id = g.note.id;
    if (busyIds.has(id)) return;
    setBusyIds((prev) => new Set(prev).add(id));
    setError(id, null);
    if (accept) setAcceptedNow((prev) => new Set(prev).add(id));
    else setRejectedNow((prev) => [...prev.filter((r) => r.g.note.id !== id), { g, where }]);
    try {
      await (accept ? graphNotes.acceptNote(id) : graphNotes.rejectNote(id));
    } catch (err) {
      if (accept) setAcceptedNow((prev) => without(prev, id));
      else setRejectedNow((prev) => prev.filter((r) => r.g.note.id !== id));
      setError(id, message(err));
    } finally {
      setBusyIds((prev) => without(prev, id));
    }
  }
  async function undoReject(g: GraphNote) {
    const id = g.note.id;
    if (busyIds.has(id)) return;
    setBusyIds((prev) => new Set(prev).add(id));
    setError(id, null);
    try {
      await graphNotes.restoreNote(id);
      setRejectedNow((prev) => prev.filter((r) => r.g.note.id !== id));
    } catch (err) {
      setError(id, message(err));
    } finally {
      setBusyIds((prev) => without(prev, id));
    }
  }
  const rejectedIds = new Set(rejectedNow.map((r) => r.g.note.id));
  // A rejected note keeps its place (the refresh drops it from the data: it
  // goes back where its last edit sorts it), and an accepted one reads accepted.
  const live = (list: GraphNote[], where: Where) => {
    const out = list.map((g) =>
      acceptedNow.has(g.note.id) && g.note.status === "PENDING"
        ? { ...g, note: { ...g.note, status: "ACCEPTED" as const } }
        : g,
    );
    const ids = new Set(out.map((g) => g.note.id));
    for (const { g } of rejectedNow.filter((r) => r.where === where && !ids.has(r.g.note.id))) {
      const at = out.findIndex((x) => Date.parse(x.note.updatedAt) < Date.parse(g.note.updatedAt));
      out.splice(at < 0 ? out.length : at, 0, g);
    }
    return out;
  };

  const [pa, pb] = pinnedPair?.split("|") ?? [];
  const pinned = pa && pb && pa !== pb ? pinnedPair : null;
  let heading: string;
  let shown: GraphNote[];
  let single: GraphNote[] = [];
  if (shownNote) {
    heading = t("graphNotes.notesShown");
    shown = [shownNote];
  } else if (pinned) {
    heading = t("graphNotes.notesOnPair");
    shown = view.byPair.get(pinned) ?? [];
  } else if (pickedIds.size > 0) {
    heading = t("graphNotes.notesOnPick");
    const hits = (g: GraphNote) => g.documentIds.filter((id) => pickedIds.has(id)).length;
    shown = view.notes.filter((g) => hits(g) > 0).sort((x, y) => Number(hits(y) >= 2) - Number(hits(x) >= 2));
  } else {
    heading = t("graphNotes.notesAcross");
    shown = view.notes.filter((g) => g.documentIds.length >= 2);
    single = live(
      view.notes.filter((g) => g.documentIds.length < 2),
      "single",
    );
  }
  shown = live(shown, "shown");
  // Notes on no document of the graph: listed when nothing narrows the list.
  const project = shownNote || pinned || pickedIds.size > 0 ? [] : live(view.projectNotes, "project");
  // Under the shown note: the links between its documents, or the links of
  // its one document.
  const shownIds = new Set(shownNote?.documentIds ?? []);
  const shownLinks = shownNote
    ? edges
        .filter((e) =>
          shownIds.size >= 2 ? e.a !== e.b && shownIds.has(e.a) && shownIds.has(e.b) : shownIds.has(e.a) || shownIds.has(e.b),
        )
        .flatMap((e) => e.links.filter((l) => !l.provenance))
    : [];
  // [style7] VIEW7-11: the first row drawn, in the list's order.
  const firstId = (shown[0] ?? (singleOpen ? single[0] : undefined) ?? project[0])?.note.id ?? null;
  const row = (where: Where, g: GraphNote) =>
    rejectedIds.has(g.note.id) ? (
      <p
        key={g.note.id}
        data-graph-notes-rejected={g.note.id}
        className="flex flex-wrap items-center gap-1.5 rounded-xl bg-sand-100 px-3 py-1.5 text-[11.5px] text-sand-700"
      >
        <span className="min-w-0 flex-1 truncate">
          {t("outline.noteRejected")} · {noteLine(g.note)}
        </span>
        <button
          onClick={() => void undoReject(g)}
          disabled={busyIds.has(g.note.id)}
          data-track="graph-notes-undo-reject"
          className={`${ACTION} bg-card`}
        >
          {t("outline.undo")}
        </button>
        {errors[g.note.id] && <span className="w-full text-[11px] text-red-500">{errors[g.note.id]}</span>}
      </p>
    ) : (
      <NotesListRow
        key={g.note.id}
        note={g}
        open={openId === g.note.id}
        first={g.note.id === firstId}
        onToggle={() => setOpenId(openId === g.note.id ? null : g.note.id)}
        busy={busyIds.has(g.note.id)}
        error={errors[g.note.id] ?? null}
        onDecide={(accept) => void decide(g, accept, where)}
      />
    );

  return (
    <aside
      data-track-surface="graph-notes-list"
      data-graph-side-list="notes"
      id="graph-list-notes"
      tabIndex={-1}
      aria-label={t("graphNotes.notes")}
      className="menu-in absolute top-3 right-3 z-10 max-h-[calc(100%-24px)] flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-y-auto rounded-[20px] border border-line bg-card/95 p-4 shadow-float outline-none backdrop-blur-md max-[999px]:max-h-[calc(100%-76px)]"
    >
      {/* [chrome6] VIEW6-06: one head row; the list's description is the
          section field's tooltip. */}
      <div className="flex items-center gap-2">
      <ListName>{t("graphNotes.notes")}</ListName>
      <label data-tip={t("graphNotes.notesDesc")} className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-sand-600">
        {t("graphNotes.notesSection")}
        <select
          value={ctx.sectionId ?? ""}
          onChange={(e) => ctx.setSectionId(e.target.value || null)}
          data-track="graph-notes-section"
          className="min-w-0 flex-1 rounded-full border border-line bg-card px-2.5 py-1 text-[12.5px] text-ink"
        >
          <option value="">{t("graphNotes.notesSectionAll")}</option>
          {ctx.sectionChoices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
        <button
          onClick={onClose}
          data-track="graph-notes-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className={`-mr-1 ${CLOSE}`}
        >
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2">
        <p className={`flex-1 ${SECTION_HEAD}`}>{heading}</p>
        {shownNote && (
          <button
            onClick={onClearShown}
            data-track="graph-notes-shown-clear"
            className={ACTION}
          >
            {t("graphNotes.notesShownAll")}
          </button>
        )}
      </div>
      {shown.length === 0 && <p className="text-[13px] text-sand-600">{t("graphNotes.notesEmpty")}</p>}
      {bySection(shown).map((group) => (
        <div key={group.id} className="flex flex-col gap-1.5">
          <p className="text-[11.5px] font-semibold text-sage-700">{group.title}</p>
          {group.notes.map((g) => row("shown", g))}
        </div>
      ))}
      {shownNote && shownLinks.length > 0 && (
        <div data-graph-notes-links="" className="flex flex-col gap-1">
          <p className={SECTION_HEAD}>
            {shownIds.size >= 2 ? t("graphNotes.notesLinksBetween") : t("graphNotes.notesLinksOf")}
          </p>
          {shownLinks.map((l) => (
            <button
              key={l.id}
              onClick={() => onOpenLink(l.id)}
              data-track="graph-notes-link-open"
              data-graph-notes-link={l.id}
              onMouseEnter={() => ctx.setRowLit(new Set([l.fromDocumentId, l.toDocumentId]))}
              onMouseLeave={() => ctx.setRowLit(null)}
              className={`flex flex-col items-start gap-0.5 rounded-xl border bg-card px-3 py-2 text-left hover:bg-clay-100/60 ${
                l.recommended ? "border-dashed border-clay-300" : "border-line"
              }`}
            >
              <span className="text-[10.5px] text-sand-500">
                {l.fromDocumentId === l.toDocumentId
                  ? t("panes.graphLinksLoopTitle", { title: l.fromTitle })
                  : t("panes.graphLinksPairTitle", { a: l.fromTitle, b: l.toTitle })}
              </span>
              <span className="text-[12.5px] leading-snug font-semibold text-ink">
                {l.reason ?? clipWords(l.quotedText, 60)}
              </span>
              <LinkReplyCount link={l} />
            </button>
          ))}
        </div>
      )}
      {single.length > 0 && (
        <div data-graph-notes-single="" className="flex flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-sand-500">
            <span>
              {single.length === 1
                ? t("graphNotes.notesOneDocumentOne")
                : t("graphNotes.notesOneDocument", { n: single.length })}
            </span>
            <button
              onClick={() => setSingleOpen(!singleOpen)}
              aria-expanded={singleOpen}
              data-track="graph-notes-single"
              className={`${TEXT_HIT} font-semibold text-sand-700 underline-offset-2 hover:text-clay-800 hover:underline`}
            >
              {singleOpen ? t("graphNotes.notesOneDocumentHide") : t("graphNotes.notesOneDocumentShow")}
            </button>
            <span aria-hidden>·</span>
            <Link
              href={`/n/${ctx.notebookId}/notes`}
              data-track="graph-notes-full-page"
              className={`${TEXT_HIT} font-semibold text-sand-700 underline-offset-2 hover:text-clay-800 hover:underline`}
            >
              {t("graphNotes.notesFullPage")}
            </Link>
          </p>
          {singleOpen &&
            bySection(single).map((group) => (
              <div key={group.id} className="flex flex-col gap-1.5">
                <p className="text-[11.5px] font-semibold text-sage-700">{group.title}</p>
                {group.notes.map((g) => row("single", g))}
              </div>
            ))}
        </div>
      )}
      {project.length > 0 && (
        <div data-graph-notes-project="" className="flex flex-col gap-1.5">
          <p className={SECTION_HEAD}>{t("graphNotes.notesOnProject")}</p>
          {bySection(project).map((group) => (
            <div key={group.id} className="flex flex-col gap-1.5">
              <p className="text-[11.5px] font-semibold text-sage-700">{group.title}</p>
              {group.notes.map((g) => row("project", g))}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function NotesListRow({
  note: g,
  open,
  first,
  onToggle,
  busy,
  error,
  onDecide,
}: {
  note: GraphNote;
  open: boolean;
  /** The list's first row: Open in notes shows at rest. */
  first: boolean;
  onToggle: () => void;
  busy: boolean;
  error: string | null;
  onDecide: (accept: boolean) => void;
}) {
  const t = useT();
  const ctx = useGraphNotes();
  const { canEdit } = useCollab();
  if (!ctx) return null;
  const note = g.note;
  const openReplies = note.replies.filter((r) => r.resolvedById === null).length;

  return (
    <div
      data-graph-notes-row={note.id}
      onMouseEnter={() => ctx.setRowLit(new Set(g.documentIds))}
      onMouseLeave={() => ctx.setRowLit(null)}
      onFocus={() => ctx.setRowLit(new Set(g.documentIds))}
      onBlur={() => ctx.setRowLit(null)}
      className={`group/row rounded-2xl border bg-card p-3 shadow-soft ${
        note.status === "PENDING" ? "border-dashed border-clay-300" : "border-line"
      }`}
    >
      {/* [chrome6] VIEW6-06: Open in notes sits on the title row and shows on
          hover or focus (always on touch), so a row is two lines, not three.
          [style7] VIEW7-11: the list's first row shows it at rest, so a mouse
          reader sees once where a note opens. */}
      <div className="flex items-start gap-1.5">
        <button
          onClick={onToggle}
          data-track="graph-notes-expand"
          aria-expanded={open}
          className="block min-w-0 flex-1 rounded-lg text-left hover:bg-clay-100/60"
        >
          <span className="text-[12.5px] leading-snug font-semibold text-ink">{noteLine(note)}</span>
        </button>
        <button
          onClick={() => ctx.showNote(note.id)}
          data-track="graph-notes-open"
          className={`${ACTION} focus:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(pointer:coarse)]:opacity-100 ${open || first ? "" : "opacity-0"}`}
        >
          {t("graphNotes.notesOpenInNotes")}
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {g.documentIds.map((id) => (
          <span
            key={id}
            className="max-w-44 truncate rounded-full bg-sand-200 px-2 py-px text-[10.5px] font-semibold text-sand-700"
          >
            {ctx.titleOf.get(id) ?? ""}
          </span>
        ))}
        <span className="text-[10.5px] text-sand-500">
          {note.sources.length === 1
            ? t("graphNotes.notesSourceOne")
            : t("graphNotes.notesSourceMany", { n: note.sources.length })}
        </span>
        {openReplies > 0 && (
          <span className="text-[10.5px] text-sand-500">
            ·{" "}
            {openReplies === 1 ? t("graphNotes.replyCountOne") : t("graphNotes.replyCountMany", { n: openReplies })}
          </span>
        )}
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="text-[12.5px]">
            <Markdown breaks sources={note.sources} notebookId={ctx.notebookId}>
              {splitNote(note.content).body || note.content}
            </Markdown>
          </div>
          {note.sources.map((s) => (
            <div key={s.id} className="rounded-xl border border-line bg-sand-50/60 p-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-ink">{s.documentTitle}</span>
                {s.documentId && ctx.titleOf.has(s.documentId) && (
                  <button
                    onClick={() => ctx.openSource(s.documentId, s.id)}
                    data-track="graph-notes-jump"
                    data-tip={t("graphNotes.notesJumpTitle")}
                    className={ACTION}
                  >
                    {t("graphNotes.notesJump")}
                  </button>
                )}
              </div>
              <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-sand-700">
                <mark className="link-detail-quote">{s.quotedText}</mark>
              </p>
            </div>
          ))}
          {/* [layer5] The note's replies, readable here (VIEW5-03): the
              tray's thread and rules (editors reply and resolve; a viewer reads). */}
          <div
            data-graph-notes-thread={note.id}
            onKeyDownCapture={(e) => {
              // Esc in a reply box holding words only leaves the box (as on a link).
              const box = e.target;
              if (e.key !== "Escape" || !(box instanceof HTMLTextAreaElement) || box.value.trim() === "") return;
              e.stopPropagation();
              const home = box.closest<HTMLElement>("[data-graph-side-list][tabindex]");
              if (home) home.focus({ preventScroll: true });
              else box.blur();
            }}
          >
            <ReplyThread target={{ noteId: note.id }} replies={note.replies} />
          </div>
        </div>
      )}
      {note.status === "PENDING" && canEdit && (
      <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => onDecide(true)}
              disabled={busy}
              data-track="graph-notes-accept"
              className={ACTION_ACCEPT}
            >
              {t("common.accept")}
            </button>
            <button
              onClick={() => onDecide(false)}
              disabled={busy}
              data-track="graph-notes-reject"
              className={ACTION}
            >
              {t("common.reject")}
            </button>
          </span>
      </div>
      )}
      {error && <p className="mt-1.5 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
