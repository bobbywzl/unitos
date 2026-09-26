"use client";

import "./docs.css";
import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { REFRESH_EVENT } from "@/components/collab/use-sync";
import { annotationMarksKey, openMarkAt, type MarksMeta } from "@/components/docs/annotation-marks";
import { LinkBubble, LinkDialog } from "@/components/docs/link-dialog";
import { docsExtensions, type FigureMediaView } from "@/components/docs/extensions";
import { docsFontsUrl } from "@/components/docs/fonts";
import { DocsFrame, UNTITLED } from "@/components/docs/frame";
import { CloudDoneIcon, CloudOffIcon, CloudSyncIcon, DocIcon } from "@/components/docs/icons";
import { toast } from "@/components/docs/insert/context";
import { DocsToolbar } from "@/components/docs/toolbar";
import { ModeLock, type DocsMode } from "@/components/docs/toolbar/mode";
import type { Zoom } from "@/components/docs/toolbar/zoom";
import { useDocsSave, type SaveState } from "@/components/docs/use-docs-save";
import { WordCountDialog } from "@/components/docs/word-count";
import { insertImageFrom } from "@/components/docs/insert/image";
import { InsertLayer } from "@/components/docs/areas/insert";
import { UnitosLayer } from "@/components/docs/areas/layer";
import { SuggestLayer } from "@/components/docs/suggest/layer";
import { PageCanvas, PageRuler } from "@/components/docs/areas/page";
import { StatusPopup } from "@/components/docs/page/status-popup";
import { useSaveState } from "@/components/docs/page/store";
import { TypingLayer } from "@/components/docs/areas/typing";
import { VersionHistory, VersionHistoryButton } from "@/components/docs/versions/version-history";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import type { Highlight } from "@/components/reader/block-view";
import { api } from "@/lib/api";
import { inlineText } from "@/lib/docs/blocks";
import type { PageSetup, RichNode } from "@/lib/docs/schema";

// The page editor (SPEC.md §29): a blank document is written here the way a
// Google Doc is written — a title row, the toolbar, and white pages on a gray
// canvas, one continuous rich text with no blocks to click into. An import
// opens here too, in Viewing, with its import line after the title. The Unitos
// layer sits on top: the reader's selection toolbar and cards (the reader
// interactions around this component), the marks of notes and annotations
// (annotation-marks.tsx), and the paragraph index every AI tool reads, kept
// in step by each save (use-docs-save.ts).

const FONTS_LINK_ID = "unitos-docs-fonts";

/** An import (SPEC.md §29): a document made from a PDF, a web page, or a
    Markdown or text file, as the page sends it. origin: the address, or ""
    for an uploaded file; pages: a PDF's page count; importRev: the revision
    the import or its last re-parse stored (a re-parse builds the page
    editor anew); edited: changed since then (richTextRev > importRev);
    shared: attached to a project another account owns, so Editing and
    Suggesting are off; figures: the media of its figure objects, by id;
    pageLabels: the PDF's own names for its pages. */
export type Imported = {
  kind: "pdf" | "url" | "markdown";
  origin: string;
  pages: number | null;
  importRev: number;
  edited: boolean;
  shared: boolean;
  figures: Record<string, FigureMediaView>;
  pageLabels: string[] | null;
};

// An import opens in Viewing; the mode the reader picks is kept per
// document in this browser.
const modeKey = (documentId: string) => `unitos-docs-mode:${documentId}`;

function storedMode(documentId: string): DocsMode {
  try {
    const mode = localStorage.getItem(modeKey(documentId));
    return mode === "editing" || mode === "suggesting" ? mode : "viewing";
  } catch {
    return "viewing";
  }
}

function storeMode(documentId: string, mode: DocsMode): void {
  try {
    localStorage.setItem(modeKey(documentId), mode);
  } catch {
    // Kept for this visit only.
  }
}

/** The site of an address, without "www.". */
function siteOf(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./, "");
  } catch {
    return address;
  }
}

/** Where an import came from, after its title: "Imported from" the site, a
    link to the page; a PDF and its page count; or a text file. Muted, the
    accent on hover. */
function ImportLine({ imported }: { imported: Imported }) {
  const t = useT();
  const parts: ReactNode[] = [];
  if (imported.origin) {
    parts.push(
      <a
        key="site"
        href={imported.origin}
        target="_blank"
        rel="noopener noreferrer"
        data-tip={imported.origin}
        data-track="docs:import-origin"
        className="rounded-sm underline-offset-2 hover:text-clay-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
      >
        {t("docsPage.importedFrom", { site: siteOf(imported.origin) })}
      </a>,
    );
  }
  if (imported.kind === "pdf") {
    const n = imported.pages;
    parts.push(<span key="pdf">{n ? t("docsPage.importPdf", { n, s: n === 1 ? "" : "s" }) : "PDF"}</span>);
  } else if (imported.kind === "markdown" && !imported.origin) {
    parts.push(<span key="file">{t("docsPage.importTextFile")}</span>);
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 pl-1 text-[12.5px] whitespace-nowrap text-sand-600">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden>·</span>}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

function useDocsFonts() {
  useEffect(() => {
    if (document.getElementById(FONTS_LINK_ID)) return;
    const link = document.createElement("link");
    link.id = FONTS_LINK_ID;
    link.rel = "stylesheet";
    link.href = docsFontsUrl();
    document.head.appendChild(link);
  }, []);
}

/** The document's status beside the title, as Google Docs shows it: the
    arrows and "Saving…" while a change waits or saves, then the cloud with a
    check and "Saved to Unitos" for 3 s, then the cloud alone. A lost
    connection or a failed save reads in words until it clears. */
function SaveStatus({ state }: { state: SaveState }) {
  const t = useT();
  const [last, setLast] = useState(state);
  // Each finished save shows the saved words for 3 s.
  const [justSaved, setJustSaved] = useState(false);
  if (last !== state) {
    setLast(state);
    setJustSaved(state === "saved");
  }
  useEffect(() => {
    if (!justSaved) return;
    const id = setTimeout(() => setJustSaved(false), 3000);
    return () => clearTimeout(id);
  }, [justSaved]);
  const caption =
    state === "saving" || state === "unsaved"
      ? t("docs.saving")
      : state === "offline"
        ? t("docs.offlineSaving")
        : state === "error"
          ? t("docs.saveFailed")
          : justSaved
            ? t("docsPage.savedCaption")
            : "";
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const Icon = state === "saved" ? CloudDoneIcon : state === "offline" || state === "error" ? CloudOffIcon : CloudSyncIcon;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`docs-status docs-status-${state}`}
        data-tip={open ? undefined : t("docsPage.documentStatus")}
        aria-label={`${t("docsPage.documentStatus")}: ${state === "saved" ? t("docs.saved") : caption}`}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon size={20} />
        {caption && (
          <span className="docs-status-text" aria-live="polite">
            {caption}
          </span>
        )}
      </button>
      {open && <StatusPopup state={state} anchorRef={buttonRef} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The first line's words once a line follows it, else "". */
function firstLineOf(editor: Editor): string {
  let lines = 0;
  let first = "";
  editor.state.doc.descendants((node) => {
    if (lines > 1 || !node.isTextblock) return lines < 2;
    if (lines++ === 0) first = inlineText(node.toJSON() as RichNode).replace(/\s+/g, " ").trim();
    return false;
  });
  return lines > 1 ? first.slice(0, 200) : "";
}

/** The title, Google Docs' way: a click selects it all; Enter keeps the new
    title and goes back to the text, Escape puts the old one back, leaving
    the field keeps it. An empty title is the untitled one, drawn gray. An
    untitled document takes its first line as its title once the line is
    done, until the reader names it. */
function TitleField({
  documentId,
  title,
  canEdit,
  firstLine,
  onDone,
}: {
  documentId: string;
  title: string;
  canEdit: boolean;
  /** The finished first line on a save, else "". */
  firstLine: string;
  /** Back to the document's text. */
  onDone: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const shown = saved ?? title;
  const cancelRef = useRef(false);
  const [prevTitle, setPrevTitle] = useState(title);
  if (prevTitle !== title) {
    setPrevTitle(title);
    setSaved(null);
  }
  const untitledText = t("docsPage.untitled");
  const save = (next: string) => api(`/api/documents/${documentId}`, "PATCH", { title: next }).then(() => router.refresh());
  async function commit() {
    const typed = (draft ?? shown).trim();
    setDraft(null);
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    const next = typed || untitledText;
    if (next === shown) return;
    setSaved(next);
    await save(next).catch(() => setSaved(null));
  }
  useEffect(() => {
    if (canEdit && firstLine && draft === null && UNTITLED.has(shown)) void save(firstLine).then(() => setSaved(firstLine), () => {});
    // On each save that holds the first line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstLine]);
  const value = draft ?? shown;
  const untitled = draft === null && UNTITLED.has(shown);
  return (
    <span className="docs-title-wrap" data-value={value || " "}>
      <input
        value={value}
        readOnly={!canEdit}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => canEdit && e.currentTarget.select()}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onDone();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelRef.current = true;
            onDone();
          }
        }}
        aria-label={t("docs.renameTitle")}
        data-tip={canEdit ? t("docs.renameTitle") : shown}
        className={`docs-title-input${untitled ? " docs-title-untitled" : ""}`}
        // As wide as its text (the wrap's copy sets the width).
        size={1}
      />
    </span>
  );
}

export function DocsEditor({
  documentId,
  notebookId,
  documents,
  title,
  richText,
  rev,
  pageSetup,
  canEdit,
  highlightsByBlock,
  flushRef,
  aiControls,
  imported = null,
  footer,
}: {
  documentId: string;
  notebookId: string;
  /** The project's documents, for links and file chips. */
  documents: { id: string; title: string }[];
  title: string;
  richText: RichNode;
  rev: number;
  pageSetup: PageSetup;
  canEdit: boolean;
  highlightsByBlock: Record<string, Highlight[]>;
  /** The reader saves the editor's typing before it stores an anchor. */
  flushRef: React.MutableRefObject<(() => Promise<void>) | null>;
  /** The Unitos tools that sit at the toolbar's right end (Extract). */
  aiControls?: ReactNode;
  /** An import; null for a blank document. */
  imported?: Imported | null;
  /** Under the pages, under the header: an import's References section. */
  footer?: ReactNode;
}) {
  const t = useT();
  useDocsFonts();
  const isImport = imported !== null;
  // An import attached to a project another account owns: an edit would
  // change their import too, so Editing and Suggesting are off.
  const locked = imported?.shared === true;
  const writable = canEdit && !locked;
  // A blank document opens in Editing; an import in Viewing, or in the mode
  // the reader last chose for it here.
  const [openedIn] = useState<DocsMode>(() => (!imported ? "editing" : writable ? storedMode(documentId) : "viewing"));
  const [mode, setModeState] = useState<DocsMode>(openedIn);
  const [zoom, setZoom] = useState<Zoom>(100);
  const [headerHidden, setHeaderHidden] = useState(false);
  // The header or footer being edited: the toolbar formats its text.
  const [hfEditor, setHfEditor] = useState<Editor | null>(null);

  // The figures, page labels, and page count of an import reach its figure
  // objects, its page starts, and the scroll tip through the extensions.
  const extensions = useMemo(
    () =>
      docsExtensions(
        imported ? { documentId, figures: imported.figures, pageLabels: imported.pageLabels, pages: imported.pages } : undefined,
      ),
    // Once per document: the editor is built once per document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documentId],
  );
  const editor = useEditor(
    {
      extensions,
      content: richText as JSONContent,
      editable: writable && openedIn !== "viewing",
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      // Docs' own autocorrect formats typing (ext/typing.ts); a paste only links addresses.
      enableInputRules: false,
      enablePasteRules: ["link"],
      editorProps: {
        attributes: {
          class: "docs-prose",
          spellcheck: "true",
          "aria-label": t("docs.documentBody"),
          "data-docs-body": "",
        },
      },
    },
    [documentId],
  );

  // A document opens with the caret at the page's start, as in Google Docs,
  // unless something else already has the focus. In Viewing the page takes
  // no focus: the pending queue's keys reach the notes tray.
  useEffect(() => {
    if (editor && writable && openedIn !== "viewing" && document.activeElement === document.body) {
      editor.commands.focus("start", { scrollIntoView: false });
    }
  }, [editor, writable, openedIn]);

  // The mode: an import keeps the reader's choice. On a locked import only
  // Viewing is left, and a key or a command that asks for another mode says
  // why.
  const setMode = useCallback(
    (next: DocsMode) => {
      if (locked && next !== "viewing") {
        if (editor && !editor.isDestroyed) toast(t("docs.importShared"), editor);
        return;
      }
      setModeState(next);
      if (isImport) storeMode(documentId, next);
    },
    [locked, editor, t, isImport, documentId],
  );

  // The QA scripts drive the editor directly in development.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !editor) return;
    (window as unknown as { __docsEditor?: Editor }).__docsEditor = editor;
  }, [editor]);

  const { state: saveState, flush, matches, outdated } = useDocsSave({
    documentId,
    editor,
    rev,
    richText,
    enabled: writable,
  });
  // The header's and footer's saves show in the same status.
  const shownSaveState = useSaveState(editor, documentId, pageSetup, saveState);

  useEffect(() => {
    flushRef.current = flush;
    return () => {
      if (flushRef.current === flush) flushRef.current = null;
    };
  }, [flush, flushRef]);

  // The Unitos marks: repainted when the reader's highlights change — by
  // content, not by object — and when a new stored revision is on screen
  // (someone else's words, whose marks the server moved). A repaint redraws
  // the text and puts the editor's selection back into the page, so a
  // repaint for nothing would undo a selection the reader is still growing
  // with Shift+arrow. The highlights' offsets are the stored copy's: a
  // repaint waits until the screen holds that copy (typing saved, the page's
  // revision caught up); meanwhile the painted marks move with the typing.
  const marksSignature = useMemo(() => JSON.stringify(highlightsByBlock), [highlightsByBlock]);
  const paintedRef = useRef<{ editor: Editor | null; signature: string; rev: number }>({ editor: null, signature: "", rev: -1 });
  // The marks made on this screen and painted ahead of the stored copy.
  const aheadRef = useRef(new Set<string>());
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const painted = paintedRef.current;
    if (painted.editor === editor && painted.signature === marksSignature && painted.rev === rev) return;
    if (!matches(rev)) {
      // A mark made on this screen and not stored yet (a new comment or
      // highlight) paints at once from its anchor, which reads the screen.
      const ahead: Record<string, Highlight[]> = {};
      for (const [blockId, list] of Object.entries(highlightsByBlock)) {
        for (const h of list) {
          const key = `${blockId}:${h.start}:${h.end}`;
          if (h.kind !== "anchor" || h.sourceId || aheadRef.current.has(key)) continue;
          aheadRef.current.add(key);
          (ahead[blockId] ??= []).push(h);
        }
      }
      if (Object.keys(ahead).length > 0) {
        const meta: MarksMeta = { highlights: ahead, t, add: true };
        editor.view.dispatch(editor.state.tr.setMeta(annotationMarksKey, meta).setMeta("addToHistory", false));
      }
      // Saved, but the page's revision is behind (its own saves need no
      // refresh): ask for the stored copy's highlights.
      if (saveState === "saved") window.dispatchEvent(new Event(REFRESH_EVENT));
      return;
    }
    aheadRef.current.clear();
    paintedRef.current = { editor, signature: marksSignature, rev };
    const meta: MarksMeta = { highlights: highlightsByBlock, t };
    editor.view.dispatch(editor.state.tr.setMeta(annotationMarksKey, meta).setMeta("addToHistory", false));
  }, [editor, marksSignature, highlightsByBlock, t, matches, rev, saveState]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(writable && mode !== "viewing");
  }, [editor, writable, mode]);

  // The header shows while the reader is in the document: a press or the
  // focus in this pane's page editor or card column, or in one of the
  // editor's menus and dialogs. A press or the focus anywhere else (the notes
  // tray, the app's top bar, the Extract page) fades it away (css/layer.css).
  const [away, setAway] = useState(false);
  useEffect(() => {
    const pane = editor?.view.dom.closest("[data-reader-root]");
    if (!pane) return;
    const onEnter = (e: Event) => {
      if (!(e.target instanceof Element)) return;
      const own = e.target.closest("[data-reader-root]");
      setAway(
        own
          ? own !== pane || (e.target !== pane && !e.target.closest("[data-docs-editor], [data-docs-column]"))
          : !e.target.closest("[data-edit-control]"),
      );
    };
    document.addEventListener("pointerdown", onEnter, true);
    document.addEventListener("focusin", onEnter);
    return () => {
      document.removeEventListener("pointerdown", onEnter, true);
      document.removeEventListener("focusin", onEnter);
    };
  }, [editor]);

  const insertImage = useCallback(
    (source: { file: File } | { url: string }) => {
      if (editor) insertImageFrom(editor, source);
    },
    [editor],
  );

  // A press on a mark or a chip opens what it opens in the reader; a drag
  // over a mark is a selection like any other. A click inside the selection
  // is a plain click (a drag ends at its edge): the page, taking the focus,
  // put its old selection back. The mark opens and the caret goes there.
  const onPageClick = useCallback(
    (e: React.MouseEvent) => {
      if (!editor) return;
      const target = e.target as Element;
      if (target.closest("[data-anchor-skip]")) {
        openMarkAt(target);
        return;
      }
      const { from, to, empty } = editor.state.selection;
      const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? -1;
      if ((empty || (e.detail === 1 && at > from && at < to)) && openMarkAt(target) && !empty) {
        editor.commands.setTextSelection(at);
      }
    },
    [editor],
  );

  // The areas take a locked import as a page they may not edit: no
  // suggestions to settle, no version to restore.
  const editing = writable && mode !== "viewing";
  const area = useMemo<DocsAreaProps | null>(
    () => (editor ? { editor, documentId, notebookId, canEdit: writable, editing, pageSetup, documents } : null),
    [editor, documentId, notebookId, writable, editing, pageSetup, documents],
  );

  // Every save changes the save state, which redraws the title row alone:
  // the toolbar and the pages are built again only when their own inputs
  // change (on a long document one rebuild costs more than a frame).
  // The toolbar keeps the reader's own role: on a locked import it still
  // offers Add comment, and the mode menu says why the other modes are off.
  const chrome = useMemo(
    () =>
      area && (
        <ModeLock.Provider value={locked ? "docs.importShared" : null}>
          <DocsToolbar
            editor={area.editor}
            header={hfEditor}
            mode={mode}
            onMode={setMode}
            canEdit={canEdit}
            zoom={zoom}
            onZoom={setZoom}
            pageless={pageSetup.pageless}
            aiControls={aiControls}
            headerHidden={headerHidden}
            onToggleHeader={() => setHeaderHidden((h) => !h)}
            onInsertImage={insertImage}
          />
          <PageRuler {...area} />
        </ModeLock.Provider>
      ),
    [area, hfEditor, mode, setMode, locked, canEdit, zoom, pageSetup.pageless, aiControls, headerHidden, insertImage],
  );
  const pages = useMemo(
    () =>
      area && (
        <>
          <PageCanvas {...area} zoom={zoom} onZoom={setZoom} onPageClick={onPageClick} onHeaderEditor={setHfEditor}>
            <EditorContent editor={area.editor} />
          </PageCanvas>
          <InsertLayer {...area} />
          <TypingLayer {...area} />
          <UnitosLayer {...area} imported={isImport} />
          <SuggestLayer {...area} suggesting={mode === "suggesting"} />
          <VersionHistory key={documentId} {...area} />
          <LinkDialog editor={area.editor} />
          <LinkBubble editor={area.editor} canEdit={editing} />
          <WordCountDialog editor={area.editor} />
        </>
      ),
    [area, zoom, onPageClick, mode, documentId, editing, isImport],
  );

  // Until the editor stands, the frame the reader drew while this code
  // loaded. A stored copy this build cannot show keeps the frame: the page
  // reloads to the newer build, or says why once it did.
  if (!editor || outdated) {
    return (
      <>
        <DocsFrame title={title} pageSetup={pageSetup} />
        {outdated === "stale" && (
          <p
            role="alert"
            className="absolute top-[150px] left-1/2 z-10 w-[min(440px,calc(100%-32px))] -translate-x-1/2 rounded-2xl bg-card px-4 py-3 text-[13px] leading-relaxed text-sand-700 shadow-float"
          >
            {t("docs.newerContent")}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="docs-shell" data-docs-editor data-docs-mode={mode} data-import={imported?.kind}>
      <div className="docs-header" data-edit-control data-away={away || undefined}>
        {!headerHidden && (
          <div className="docs-title-row">
            <DocIcon size={26} className="docs-title-icon" />
            <TitleField
              documentId={documentId}
              title={title}
              canEdit={writable}
              firstLine={saveState === "saved" ? firstLineOf(editor) : ""}
              onDone={() => {
                if (!editor.isDestroyed) editor.commands.focus();
                else (document.activeElement as HTMLElement | null)?.blur();
              }}
            />
            {imported && <ImportLine imported={imported} />}
            {writable && <SaveStatus state={shownSaveState} />}
            <VersionHistoryButton editor={editor} />
          </div>
        )}
        {chrome}
      </div>
      {pages}
      {footer}
    </div>
  );
}
