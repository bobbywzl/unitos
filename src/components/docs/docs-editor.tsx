"use client";

import "./docs.css";
// After the page's styles, where Tiptap put its own sheet: its rules win a tie.
import "./css/prosemirror.css";
import type { JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { importLineParts } from "@/components/docs/import-line";
import { usePageStatusCarries } from "@/components/save-indicator";
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
import { CollapsedView, type PageCollapse } from "@/components/docs/layer/collapse";
import { showLeftOff } from "@/components/docs/layer/left-off";
import { registerDocumentFlush } from "@/components/docs/layer/flush";
import { useKeepPlace } from "@/components/docs/page/keep-place";
import { ReflowBar, useReflow } from "@/components/docs/page/reflow";
import { showTranslations } from "@/components/docs/layer/reading";
import { SuggestLayer } from "@/components/docs/suggest/layer";
import { PageBanner, PageCanvas, PageRuler } from "@/components/docs/areas/page";
import { StatusPopup } from "@/components/docs/page/status-popup";
import { scrollParent } from "@/components/docs/page/geometry";
import { PAGE_EVENT, drawnSetup, pageStore, useOutlineRoom, useSaveState } from "@/components/docs/page/store";
import { TypingLayer } from "@/components/docs/areas/typing";
import { VersionHistory, VersionHistoryButton } from "@/components/docs/versions/version-history";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import type { Highlight } from "@/components/reader/block-view";
import { api } from "@/lib/api";
import { inlineText } from "@/lib/docs/blocks";
import { keepingKeysFor, takeEarlyKeys } from "@/lib/docs/early-keys";
import type { PageSetup, RichNode } from "@/lib/docs/schema";
import type { PageRange } from "@/lib/pdf-pages";
import { POSITION_HOLD_MS, READING_LINE_PX } from "@/lib/reading-position";
import { readSaveState, readSaveTouched, readUnconfirmed, subscribeSaveState } from "@/lib/save-state";

// The page editor (SPEC.md §29): a blank document is written here the way a
// Google Doc is written — a title row, the toolbar, and white pages on a gray
// canvas, one continuous rich text with no blocks to click into. An import
// opens here too, in Viewing, with its import line after the title. The Unitos
// layer sits on top: the reader's selection toolbar and cards (the reader
// interactions around this component), the marks of notes and annotations
// (annotation-marks.tsx), and the paragraph index every AI tool reads, kept
// in step by each save (use-docs-save.ts).

const FONTS_LINK_ID = "unitos-docs-fonts";

/** A pane narrower than this starts with the title row hidden. */
const NARROW_PANE = 600;
/** A pane shorter than this (a phone held sideways) hides the title row
    too, and reads pageless with no ruler, as a narrow one does. */
const SHORT_PANE = 500;

/** An import (SPEC.md §29): a document made from a PDF, a web page, a
    Markdown or text file, or a Word file, as the page sends it. origin: the
    address, or "" for an uploaded file; pages: a PDF's page count;
    pdfPages: the PDF's pages the reader chose at the add (SPEC.md §15),
    null for every page; importRev: the revision the import or its last
    re-parse stored (a re-parse builds the page editor anew); edited:
    changed since then (richTextRev > importRev); shared: attached to a
    project another account owns, so Editing and Suggesting are off. */
export type Imported = {
  kind: "pdf" | "url" | "markdown" | "docx";
  origin: string;
  pages: number | null;
  pdfPages?: PageRange[] | null;
  importRev: number;
  edited: boolean;
  shared: boolean;
};

/** What the page sends for a document whose rich text holds figure objects
    or page labels: an import, or a copy of one (File > Make a copy).
    figures: the media of its figure objects, by id; pageLabels: the PDF's
    own names for its pages. */
export type DocsMedia = {
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

/** The import line, after an import's title (importLineParts). Muted, the
    accent on hover. */
function ImportLine({ imported }: { imported: Imported }) {
  const t = useT();
  const parts: ReactNode[] = importLineParts(imported, t).map((part) =>
    part.href ? (
      <a
        key="site"
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        data-tip={part.href}
        data-track="docs:import-origin"
        className="rounded-sm underline-offset-2 hover:text-clay-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
      >
        {part.text}
      </a>
    ) : (
      <span key={part.text}>{part.text}</span>
    ),
  );
  // A narrow title row (a phone, a split pane, the tray beside a small
  // window) keeps its room for the title.
  return (
    <span className="hidden shrink-0 items-center gap-1.5 pl-1 text-[12.5px] whitespace-nowrap text-sand-600 @min-[560px]:flex">
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

/** A value the toolbar's row shows that changes apart from the row: the
    save state, the Unitos tools. The row is built once for it; the value's
    own small part redraws when it changes (a save, the reader's toolbox
    opening above the page) — on a long row a rebuild costs more than a
    frame. */
type Live<T> = { get: () => T; set: (value: T) => void; subscribe: (onChange: () => void) => () => void };

function useLive<T>(value: T): Live<T> {
  const [live] = useState<Live<T>>(() => {
    let current = value;
    const listeners = new Set<() => void>();
    return {
      get: () => current,
      set: (next) => {
        if (Object.is(next, current)) return;
        current = next;
        for (const listener of listeners) listener();
      },
      subscribe: (onChange) => {
        listeners.add(onChange);
        return () => {
          listeners.delete(onChange);
        };
      },
    };
  });
  useLayoutEffect(() => live.set(value), [live, value]);
  return live;
}

function useLiveValue<T>(live: Live<T>): T {
  return useSyncExternalStore(live.subscribe, live.get, live.get);
}

function LiveSlot({ live }: { live: Live<ReactNode> }) {
  return <>{useLiveValue(live)}</>;
}

/** The document's status at the toolbar row's right end, as Google Docs
    shows it: the arrows and "Saving…" while a change waits or saves, then
    the cloud with a check and "Saved to Unitos" for 3 s, then the cloud
    alone. A lost connection or a failed save reads in words until it
    clears. It carries the app's failed writes too (notes, annotations), so
    the app's own line in the top bar hides while this one is on screen: a
    write that did not land always shows, in one place. The app's writes in
    flight are not drawn here — a note's draft waiting for its save would
    leave this cloud spinning over a document that is saved. */
function SaveStatus({ live }: { live: Live<SaveState> }) {
  const t = useT();
  const textState = useLiveValue(live);
  usePageStatusCarries();
  const appState = useSyncExternalStore(subscribeSaveState, readSaveState, () => "saved" as const);
  const appTouched = useSyncExternalStore(subscribeSaveState, readSaveTouched, () => false);
  const appUnconfirmed = useSyncExternalStore(subscribeSaveState, readUnconfirmed, () => false);
  // A note or an annotation that did not save: Not saved, in the app's
  // words, until its retry lands; the document's own failure reads as the
  // document's.
  const app = textState === "saved" && ((appTouched && appState === "failed") || appUnconfirmed);
  const state: SaveState = app ? "error" : textState;
  // The words only while a save is in trouble: on the toolbar's row a
  // caption that came and went with every save would move the controls
  // beside it. The symbol says saving and saved, and a press tells the
  // state in words.
  const caption =
    state === "offline" ? t("docs.offlineSaving") : app ? t("outline.saveFailed") : state === "error" ? t("docs.saveFailed") : "";
  const spoken =
    state === "saved"
      ? t("docs.saved")
      : state === "saving" || state === "unsaved"
        ? t("docs.saving")
        : caption;
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
        aria-label={`${t("docsPage.documentStatus")}: ${spoken}`}
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
      {open && <StatusPopup state={state} app={app} anchorRef={buttonRef} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Where the caret goes when the page opens scrolled, or leaves Viewing
    with the caret out of view: the start of the block at the reading line
    (READING_LINE_PX under the pane's top), or, when that start is under the
    title row and the toolbar, the start of the block's first line in view,
    or of the next block when no line of it is in view whole. Null at the
    top of the document. */
function readingCaret(editor: Editor, pane: HTMLElement): number | null {
  if (pane.scrollTop < 1) return null;
  const view = editor.view;
  const paneTop = pane.getBoundingClientRect().top;
  const header = editor.view.dom.closest("[data-docs-editor]")?.querySelector(".docs-header");
  const shown = Math.max(paneTop, header?.getBoundingClientRect().bottom ?? paneTop);
  const box = view.dom.getBoundingClientRect();
  const at = (top: number) => view.posAtCoords({ left: box.left + 1, top })?.pos ?? null;
  const hit = at(Math.max(paneTop + READING_LINE_PX, shown) + 2);
  if (hit === null) return null;
  const $hit = view.state.doc.resolve(hit);
  if (!$hit.parent.isTextblock) return null;
  const start = $hit.start();
  if (view.coordsAtPos(start).top >= shown - 1) return start;
  // The block began above the view: its first line in view, whole. Half a
  // line under the text's box is the next line (the line's box runs lower).
  const line = view.coordsAtPos(hit);
  const next = line.top >= shown - 1 ? hit : at(line.bottom + (line.bottom - line.top) / 2);
  if (next !== null && view.state.doc.resolve(next).parent === $hit.parent && view.coordsAtPos(next).top >= shown - 1) return next;
  // The block's line under the header was its last: the next block's start.
  let after: number | null = null;
  view.state.doc.nodesBetween($hit.after(), view.state.doc.content.size, (node, pos) => {
    if (after !== null) return false;
    if (node.isTextblock) after = pos + 1;
    return !node.isTextblock;
  });
  return after !== null && view.coordsAtPos(after).top >= shown - 1 ? after : hit;
}

/** The caret, or the selection's head, shows in the pane under the header. */
function caretInView(editor: Editor, pane: HTMLElement): boolean {
  const paneRect = pane.getBoundingClientRect();
  const header = editor.view.dom.closest("[data-docs-editor]")?.querySelector(".docs-header");
  const top = Math.max(paneRect.top, header?.getBoundingClientRect().bottom ?? paneRect.top);
  try {
    const caret = editor.view.coordsAtPos(editor.state.selection.head);
    return caret.bottom > top && caret.top < paneRect.bottom;
  } catch {
    return false;
  }
}

/** While the reading position holds the pane (the pages still settling
    under it, POSITION_HOLD_MS at most), the caret follows it; the reader's
    first press, key, wheel, or touch, or a selection the reader made, ends
    that. Returns the cleanup. */
function caretAtReadingPosition(editor: Editor): () => void {
  const pane = scrollParent(editor.view.dom);
  if (!pane) return () => {};
  let own = false;
  const place = () => {
    if (editor.isDestroyed) return;
    const pos = readingCaret(editor, pane);
    const sel = editor.state.selection;
    if (pos === null || (sel.empty && sel.from === pos)) return;
    own = true;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)).setMeta("addToHistory", false));
    own = false;
  };
  let frame = 0;
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(() => ((frame = 0), place()));
  };
  const onSelection = () => {
    if (!own) stop();
  };
  // A key types at the caret placed for the pane as it stands now.
  const onKey = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    place();
    stop();
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    pane.removeEventListener("scroll", onScroll);
    pane.removeEventListener("pointerdown", stop, true);
    pane.removeEventListener("wheel", stop);
    pane.removeEventListener("touchmove", stop);
    editor.view.dom.removeEventListener("keydown", onKey, true);
    editor.off("selectionUpdate", onSelection);
    editor.off("blur", stop);
  };
  // Now, and once the page has the focus (the focus command waits a frame).
  place();
  frame = requestAnimationFrame(() => ((frame = 0), place()));
  pane.addEventListener("scroll", onScroll, { passive: true });
  pane.addEventListener("pointerdown", stop, true);
  pane.addEventListener("wheel", stop, { passive: true });
  pane.addEventListener("touchmove", stop, { passive: true });
  editor.view.dom.addEventListener("keydown", onKey, true);
  editor.on("selectionUpdate", onSelection);
  editor.on("blur", stop);
  const timer = setTimeout(stop, POSITION_HOLD_MS);
  return stop;
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
  media = null,
  footer,
  banner,
  translations = null,
  collapse = null,
  leftOffBlockId = null,
  split = false,
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
  /** The media of its figure objects and its page labels: an import's, or
      a copy's; null when it has neither. */
  media?: DocsMedia | null;
  /** Under the pages, under the header: an import's References section. */
  footer?: ReactNode;
  /** Over the first page: the Translate bar (SPEC.md §19). */
  banner?: ReactNode;
  /** Translation text per block id, each read under its paragraph. */
  translations?: Record<string, string> | null;
  /** Collapse (SPEC.md §28): the cores, in Viewing (layer/collapse.tsx);
      null while the document has none. */
  collapse?: PageCollapse | null;
  /** The block of the reading position the document opened with: the
      left-off mark stands above it (layer/left-off.ts). */
  leftOffBlockId?: string | null;
  /** A pane of a split view, whose pane header names the document
      (reader-interactions.tsx draws the header when this is true). */
  split?: boolean;
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
  const [chosenMode, setModeState] = useState<DocsMode>(openedIn);
  // An import that another account's project takes in while it is open
  // leaves Editing and Suggesting at once.
  const mode: DocsMode = locked ? "viewing" : chosenMode;
  const [zoom, setZoom] = useState<Zoom>(100);
  const [headerHidden, setHeaderHidden] = useState(false);
  // A pane too narrow for the page (a phone, a narrow split), too short
  // (a phone held sideways), or one of a split view (whose pane header
  // names the document) starts with the title row hidden: 44 px of the
  // screen above the first line go to the words, and the title, the status
  // and the version clock stay reachable (the title in the document pill,
  // the pane header and File > Rename, the status and the clock in the
  // toolbar's row).
  const shellRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  // Narrow or short, as measured; a split pane is tight from its first frame.
  const [measuredTight, setMeasuredTight] = useState(false);
  const tight = measuredTight || split;
  const [tightWas, setTightWas] = useState(false);
  if (tight !== tightWas) {
    setTightWas(tight);
    setHeaderHidden(tight);
  }
  // View > Full screen: the title row, the toolbar, and the rulers hide,
  // as in Google Docs; Esc brings them back.
  const [fullScreen, setFullScreen] = useState(false);
  // The header or footer being edited: the toolbar formats its text.
  const [hfEditor, setHfEditor] = useState<Editor | null>(null);

  // The figures and page labels of an import or its copy, and an import's
  // page count, reach its figure objects, its page starts, and the scroll
  // tip through the extensions. The figures' map is the editor's own: the
  // media each later page brings joins it before a newer stored copy is
  // drawn (a restored version can name media the first page did not send).
  const [figures] = useState<Record<string, FigureMediaView>>(() => ({ ...media?.figures }));
  useLayoutEffect(() => {
    if (media) Object.assign(figures, media.figures);
  }, [figures, media]);
  const extensions = useMemo(
    () =>
      docsExtensions(
        imported || media ? { documentId, figures, pageLabels: media?.pageLabels ?? null, pages: imported?.pages } : undefined,
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
      // ProseMirror's styles come with the page's (css/prosemirror.css).
      injectCSS: false,
      // Docs' own autocorrect formats typing (ext/typing.ts); a paste only links addresses.
      enableInputRules: false,
      enablePasteRules: ["link"],
      editorProps: {
        attributes: {
          class: "docs-prose",
          // Unitos draws the spelling squiggles (typing/proofing.ts); a
          // paragraph that does not read as English turns the browser's
          // check back on for itself.
          spellcheck: "false",
          "aria-label": t("docs.documentBody"),
          "data-docs-body": "",
        },
      },
    },
    [documentId],
  );

  // The pane's width, measured once the shell stands (the shell is drawn
  // after the editor is built, so this waits for it).
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const pane = scrollParent(shell);
    const measure = () => {
      const isNarrow = shell.clientWidth > 0 && shell.clientWidth < NARROW_PANE;
      const short = pane !== null && pane.clientHeight > 0 && pane.clientHeight < SHORT_PANE;
      // A short pane (a phone held sideways) reads as a narrow one does:
      // pageless, with no ruler; the page's margins and the ruler would
      // leave the words a third of the screen.
      setNarrow(isNarrow || short);
      setMeasuredTight(isNarrow || short);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    if (pane) observer.observe(pane);
    return () => observer.disconnect();
  }, [editor]);

  // A document opens with the caret at the page's start, as in Google Docs,
  // unless something else already has the focus. A document that opens at
  // the reading position (reader-interactions.tsx holds it while the pages
  // settle) has the caret there: at the start of the block at the reading
  // line, so the first key types where the reader looks and the pane stays.
  // In Viewing the page takes no focus: the pending queue's keys reach the
  // notes tray. A new blank document puts the keys typed while it was being
  // made at its start (lib/docs/early-keys.ts), as typing.
  useEffect(() => {
    if (!editor || !writable || openedIn === "viewing") return;
    if (!keepingKeysFor(documentId) && document.activeElement !== document.body) return;
    const early = takeEarlyKeys(documentId);
    if (early) {
      editor.chain().focus("start", { scrollIntoView: false }).insertContent({ type: "text", text: early }).run();
      return;
    }
    editor.commands.focus("start", { scrollIntoView: false });
    return caretAtReadingPosition(editor);
  }, [editor, writable, openedIn, documentId]);

  // The mode: an import keeps the reader's choice. On a locked import only
  // Viewing is left, and a key or a command that asks for another mode says
  // why. A mode the page passes into for the reader (`passing`: the
  // assistant's suggestions landing in Viewing) is not kept, and the keys
  // stay where they are.
  const passingRef = useRef(false);
  // The mode Collapse pressed in Editing or Suggesting left for Viewing:
  // Collapse off goes back to it, unless the reader chose a mode since.
  const collapseLeftRef = useRef<DocsMode | null>(null);
  const chosenModeRef = useRef(chosenMode);
  useEffect(() => {
    chosenModeRef.current = chosenMode;
  }, [chosenMode]);
  const setMode = useCallback(
    (next: DocsMode, passing = false, collapse = false) => {
      if (locked && next !== "viewing") {
        if (editor && !editor.isDestroyed) toast(t("api.importShared"), editor);
        return;
      }
      if (collapse) {
        if (chosenModeRef.current !== "viewing") collapseLeftRef.current = chosenModeRef.current;
      } else if (!passing) collapseLeftRef.current = null;
      passingRef.current = passing;
      setModeState(next);
      if (isImport && !passing) storeMode(documentId, next);
    },
    [locked, editor, t, isImport, documentId],
  );
  // Collapse off: back to the mode Collapse left, the caret where it was.
  const collapseOn = collapse?.on ?? false;
  const collapseOnRef = useRef(collapseOn);
  useEffect(() => {
    const was = collapseOnRef.current;
    collapseOnRef.current = collapseOn;
    const back = collapseLeftRef.current;
    if (!was || collapseOn || !back) return;
    collapseLeftRef.current = null;
    if (chosenModeRef.current === "viewing") setMode(back);
  }, [collapseOn, setMode]);

  // A document in pages may be read pageless (page/reflow.tsx): a view of
  // this browser; the document's page setup stays as it is (the page store
  // keeps the saved setup apart from the drawn page). A PDF import offers it
  // in Viewing with its bar, and Editing and Suggesting draw its pages; a
  // pane too narrow for the page (a phone) or too short for it (a phone
  // held sideways) reads pageless at once in every mode, with no bar — the
  // pages there are drawn at 42%, or leave six lines of words, where no one
  // reads or writes them — and Search the menus > View keeps Show pages.
  const paged = !pageSetup.pageless;
  const pdfPages = imported?.kind === "pdf" && paged;
  const [reflowChoice, chooseReflow] = useReflow(editor, documentId, pdfPages || (paged && narrow));
  const reflowing = (pdfPages && mode === "viewing") || (paged && narrow);
  const reflowed = reflowing && (reflowChoice === "pageless" || (narrow && reflowChoice === null));
  // The drawn setup: what the page, the frame, and the toolbar draw. It is
  // never handed to what saves.
  const shownSetup = useMemo(() => drawnSetup(pageSetup, reflowed), [reflowed, pageSetup]);
  useLayoutEffect(() => {
    if (!editor) return;
    const store = pageStore(editor, documentId, pageSetup);
    if (store.get().reflowed !== reflowed) store.set({ reflowed });
  }, [editor, documentId, pageSetup, reflowed]);
  // Pages to pageless and back keep the block at the reading line in view.
  useKeepPlace(editor, shownSetup.pageless ? "pageless" : "pages");

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
  // The save state and the Unitos tools reach the toolbar's row on their
  // own (useLive): a save, or a render of the reader around the page (its
  // toolbox opening), redraws them, not the whole row.
  const saveLive = useLive(shownSaveState);
  const aiLive = useLive<ReactNode>(aiControls ?? null);
  const hasAi = Boolean(aiControls);
  // The outline button stands beside the text column when the margin has
  // the room for it; else the toolbar's row carries it (areas/page.tsx).
  const outlineRoom = useOutlineRoom(editor, documentId, pageSetup);

  useEffect(() => {
    const settle = async () => {
      await flush();
    };
    flushRef.current = settle;
    return () => {
      if (flushRef.current === settle) flushRef.current = null;
    };
  }, [flush, flushRef]);
  // Version history and the voice command save this page's typing first
  // (layer/flush.ts), and learn whether the save went through.
  useEffect(() => (writable ? registerDocumentFlush(documentId, flush) : undefined), [writable, documentId, flush]);

  // The left-off mark above the block the reader left off at.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !leftOffBlockId) return;
    return showLeftOff(editor, leftOffBlockId, t("reader.leftOffHere"));
  }, [editor, leftOffBlockId, t]);

  // The document's translations, each under its paragraph while the page is
  // read (layer/reading.ts).
  useEffect(() => {
    if (editor) showTranslations(editor, translations);
  }, [editor, translations]);

  // The Unitos marks: repainted when the reader's highlights change — by
  // content, not by object — and when a new stored revision is on screen
  // (someone else's words, whose marks the server moved). A repaint redraws
  // the text and puts the editor's selection back into the page, so a
  // repaint for nothing would undo a selection the reader is still growing
  // with Shift+arrow. The highlights' offsets are the stored copy's: a
  // repaint waits until the screen holds that copy (typing saved, the page's
  // revision caught up); meanwhile the painted marks move with the typing.
  const marksSignature = useMemo(() => JSON.stringify(highlightsByBlock), [highlightsByBlock]);
  const paintedRef = useRef<{ editor: Editor | null; signature: string; rev: number; editing: boolean }>({
    editor: null,
    signature: "",
    rev: -1,
    editing: false,
  });
  // The marks' tips say how a mark opens in the mode the page is in.
  const marksEditing = writable && mode !== "viewing";
  // The marks made on this screen and painted ahead of the stored copy.
  const aheadRef = useRef(new Set<string>());
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const painted = paintedRef.current;
    if (painted.editor === editor && painted.signature === marksSignature && painted.rev === rev && painted.editing === marksEditing) return;
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
        const meta: MarksMeta = { highlights: ahead, t, add: true, editing: marksEditing };
        editor.view.dispatch(editor.state.tr.setMeta(annotationMarksKey, meta).setMeta("addToHistory", false));
      }
      // Saved, but the page's revision is behind (its own saves need no
      // refresh): ask for the stored copy's highlights.
      if (saveState === "saved") window.dispatchEvent(new Event(REFRESH_EVENT));
      return;
    }
    aheadRef.current.clear();
    paintedRef.current = { editor, signature: marksSignature, rev, editing: marksEditing };
    const meta: MarksMeta = { highlights: highlightsByBlock, t, editing: marksEditing };
    editor.view.dispatch(editor.state.tr.setMeta(annotationMarksKey, meta).setMeta("addToHistory", false));
  }, [editor, marksSignature, highlightsByBlock, t, matches, rev, saveState, marksEditing]);

  // A switch to Editing or Suggesting gives the page the keys at its caret,
  // the selection kept and the pane where it is. A caret out of view (an
  // import read in Viewing keeps it at the start) goes to the start of the
  // block at the reading line first, so the first key types where the
  // reader looks.
  const modeRef = useRef(mode);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // A change only: setEditable draws the whole page again, and on a long
    // import's first frame that is a second of nothing (EDGE14-08).
    const editable = writable && mode !== "viewing";
    if (editor.isEditable !== editable) editor.setEditable(editable);
    const switched = modeRef.current !== mode;
    modeRef.current = mode;
    const passing = passingRef.current;
    passingRef.current = false;
    if (!switched || !writable || mode === "viewing" || passing) return;
    const pane = scrollParent(editor.view.dom);
    if (pane && !caretInView(editor, pane)) {
      const pos = readingCaret(editor, pane);
      if (pos !== null) {
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)).setMeta("addToHistory", false));
      }
    }
    editor.commands.focus(undefined, { scrollIntoView: false });
  }, [editor, writable, mode]);

  // The header shows while the reader is in the document: a press or the
  // focus in this pane's page editor or card column, or in one of the
  // editor's menus and dialogs. A press or the focus in the other pane, or
  // in this pane outside the page (the Extract page), fades it away
  // (css/layer.css). The notes tray and the app's top bar work on the open
  // document: a press there leaves the header as it is.
  const [away, setAway] = useState(false);
  useEffect(() => {
    const pane = editor?.view.dom.closest("[data-reader-root]");
    if (!pane) return;
    const onEnter = (e: Event) => {
      if (!(e.target instanceof Element)) return;
      const own = e.target.closest("[data-reader-root]");
      if (!own) {
        // One of the page editor's menus or dialogs, drawn over the app.
        if (e.target.closest("[data-edit-control]")) setAway(false);
        return;
      }
      setAway(own !== pane || (e.target !== pane && !e.target.closest("[data-docs-editor], [data-docs-column]")));
    };
    document.addEventListener("pointerdown", onEnter, true);
    document.addEventListener("focusin", onEnter);
    return () => {
      document.removeEventListener("pointerdown", onEnter, true);
      document.removeEventListener("focusin", onEnter);
    };
  }, [editor]);

  // Full screen from its command (page/commands.ts); an Esc no one else
  // took brings the header back.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const on = () => {
      setFullScreen(true);
      toast(t("docsPage.fullScreenHint"), editor);
    };
    dom.addEventListener(PAGE_EVENT.fullScreen, on);
    return () => dom.removeEventListener(PAGE_EVENT.fullScreen, on);
  }, [editor, t]);
  useEffect(() => {
    if (!fullScreen) return;
    // The page cancels every Esc it gets (ProseMirror), so an open menu or
    // dialog, not the cancel, says the key was someone else's.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing || document.querySelector("[data-docs-menu], [role='dialog']")) return;
      setFullScreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  const insertImage = useCallback(
    (source: { file: File } | { url: string }) => {
      if (editor) insertImageFrom(editor, source);
    },
    [editor],
  );

  // A press on a chip opens what it opens in the reader; so does a press on
  // a mark in Viewing (while the reader writes, a click on marked words
  // places the caret: annotation-marks.tsx). A drag over a mark is a
  // selection like any other. A click inside the selection is a plain click
  // (a drag ends at its edge): the page, taking the focus, put its old
  // selection back. The mark opens and the caret goes there.
  const onPageClick = useCallback(
    (e: React.MouseEvent) => {
      if (!editor) return;
      const target = e.target as Element;
      if (target.closest("[data-anchor-skip]")) {
        openMarkAt(target, { x: e.clientX, y: e.clientY });
        return;
      }
      if (editor.isEditable) return;
      const { from, to, empty } = editor.state.selection;
      const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? -1;
      if ((empty || (e.detail === 1 && at > from && at < to)) && openMarkAt(target, { x: e.clientX, y: e.clientY }) && !empty) {
        editor.commands.setTextSelection(at);
      }
    },
    [editor],
  );

  // The areas take a locked import as a page they may not edit: no
  // suggestions to settle, no version to restore. They get the saved setup
  // and whether its pages are drawn pageless, never a drawn setup to save.
  const editing = writable && mode !== "viewing";
  const area = useMemo<DocsAreaProps | null>(
    () => (editor ? { editor, documentId, notebookId, canEdit: writable, projectEditor: canEdit, editing, pageSetup, reflowed, documents } : null),
    [editor, documentId, notebookId, writable, canEdit, editing, pageSetup, reflowed, documents],
  );

  // Every save changes the save state, which redraws the title row and the
  // status alone: the toolbar and the pages are built again only when their
  // own inputs change (on a long document one rebuild costs more than a
  // frame).
  // The toolbar keeps the reader's own role: on a locked import it still
  // offers Add comment, and the mode menu says why the other modes are off.
  const chrome = useMemo(
    () =>
      area && (
        <ModeLock.Provider value={locked ? "api.importShared" : null}>
          <DocsToolbar
            editor={area.editor}
            header={hfEditor}
            mode={mode}
            onMode={setMode}
            canEdit={canEdit}
            zoom={zoom}
            onZoom={setZoom}
            pageless={shownSetup.pageless}
            aiControls={hasAi ? <LiveSlot live={aiLive} /> : undefined}
            headerHidden={headerHidden}
            onToggleHeader={() => setHeaderHidden((h) => !h)}
            narrowPane={!outlineRoom}
            status={
              <>
                {writable && <SaveStatus live={saveLive} />}
                <VersionHistoryButton editor={area.editor} />
              </>
            }
            onInsertImage={insertImage}
          />
          {!narrow && <PageRuler {...area} />}
        </ModeLock.Provider>
      ),
    [area, hfEditor, mode, setMode, locked, canEdit, zoom, shownSetup.pageless, hasAi, aiLive, headerHidden, insertImage, writable, saveLive, outlineRoom, narrow],
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
        <DocsFrame title={title} pageSetup={shownSetup} split={split} />
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
    <div
      ref={shellRef}
      className="docs-shell"
      data-docs-editor
      data-docs-mode={mode}
      data-import={imported?.kind}
      data-reflow={reflowing ? (reflowed ? "pageless" : "pages") : undefined}
      data-full-screen={fullScreen || undefined}
    >
      <div className="docs-header" data-edit-control data-away={away || undefined}>
        {!headerHidden && !fullScreen && (
          <div className="docs-title-row @container">
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
          </div>
        )}
        {/* Hidden, not taken away, in full screen: the toolbar's keys still answer. */}
        <div style={{ display: fullScreen ? "none" : "contents" }}>{chrome}</div>
      </div>
      <PageBanner.Provider
        value={
          reflowing && !narrow ? (
            <>
              <ReflowBar
                editor={editor}
                documentId={documentId}
                setup={pageSetup}
                choice={reflowChoice}
                reflowed={reflowed}
                onChoose={chooseReflow}
              />
              {banner}
            </>
          ) : (
            banner
          )
        }
      >
        {pages}
      </PageBanner.Provider>
      <CollapsedView editor={editor} collapse={collapse} highlightsByBlock={highlightsByBlock} editing={editing} />
      {footer}
    </div>
  );
}
