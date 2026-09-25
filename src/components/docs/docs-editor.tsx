"use client";

import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { REFRESH_EVENT } from "@/components/collab/use-sync";
import { annotationMarksKey, openMarkAt, type MarksMeta } from "@/components/docs/annotation-marks";
import { LinkBubble, LinkDialog } from "@/components/docs/link-dialog";
import { DOCS_EVENT, docsExtensions } from "@/components/docs/extensions";
import { docsFontsUrl } from "@/components/docs/fonts";
import { CloudDoneIcon, CloudOffIcon, CloudSyncIcon, DocIcon } from "@/components/docs/icons";
import { DocsToolbar, type DocsMode, type Zoom } from "@/components/docs/toolbar";
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
import { LANGS } from "@/lib/i18n/config";
import { translatorFor } from "@/lib/i18n/dictionaries";

// The page editor (SPEC.md §29): a blank document is written here the way a
// Google Doc is written — a title row, the toolbar, and white pages on a gray
// canvas, one continuous rich text with no blocks to click into. The Unitos
// layer sits on top: the reader's selection toolbar and cards (the reader
// interactions around this component), the marks of notes and annotations
// (annotation-marks.tsx), and the paragraph index every AI tool reads, kept
// in step by each save (use-docs-save.ts).

const FONTS_LINK_ID = "unitos-docs-fonts";

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

/** A new blank document's title, in every language. */
const UNTITLED = new Set(LANGS.flatMap((lang) => (["docsPage.untitled", "panes.untitledDocument"] as const).map((key) => translatorFor(lang)(key))));

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
}) {
  const t = useT();
  useDocsFonts();
  const [mode, setMode] = useState<DocsMode>("editing");
  const [zoom, setZoom] = useState<Zoom>(100);
  const [headerHidden, setHeaderHidden] = useState(false);

  const extensions = useMemo(() => docsExtensions(), []);
  const editor = useEditor(
    {
      extensions,
      content: richText as JSONContent,
      editable: canEdit,
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
  // unless something else already has the focus.
  useEffect(() => {
    if (editor && canEdit && document.activeElement === document.body) {
      editor.commands.focus("start", { scrollIntoView: false });
    }
  }, [editor, canEdit]);

  // The QA scripts drive the editor directly in development.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !editor) return;
    (window as unknown as { __docsEditor?: Editor }).__docsEditor = editor;
  }, [editor]);

  const { state: saveState, flush, matches } = useDocsSave({
    documentId,
    editor,
    rev,
    richText,
    enabled: canEdit,
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
  // content, not by object. A repaint redraws the text and puts the editor's
  // selection back into the page, so a repaint for nothing would undo a
  // selection the reader is still growing with Shift+arrow. The highlights'
  // offsets are the stored copy's: a repaint waits until the screen holds
  // that copy (typing saved, the page's revision caught up); meanwhile the
  // painted marks move with the typing.
  const marksSignature = useMemo(() => JSON.stringify(highlightsByBlock), [highlightsByBlock]);
  const paintedRef = useRef<{ editor: Editor | null; signature: string }>({ editor: null, signature: "" });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const painted = paintedRef.current;
    if (painted.editor === editor && painted.signature === marksSignature) return;
    if (!matches(rev)) {
      // Saved, but the page's revision is behind (its own saves need no
      // refresh): ask for the stored copy's highlights.
      if (saveState === "saved") window.dispatchEvent(new Event(REFRESH_EVENT));
      return;
    }
    paintedRef.current = { editor, signature: marksSignature };
    const meta: MarksMeta = { highlights: highlightsByBlock, t };
    editor.view.dispatch(editor.state.tr.setMeta(annotationMarksKey, meta).setMeta("addToHistory", false));
  }, [editor, marksSignature, highlightsByBlock, t, matches, rev, saveState]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(canEdit && mode !== "viewing");
  }, [editor, canEdit, mode]);

  // Ctrl+Shift+F hides the title row, as Google Docs' compact mode does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setHeaderHidden((h) => !h);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);


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
  const onPageClick = (e: React.MouseEvent) => {
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
  };

  const area: DocsAreaProps | null = editor
    ? { editor, documentId, notebookId, canEdit, editing: canEdit && mode !== "viewing", pageSetup, documents }
    : null;

  return (
    <div className="docs-shell" data-docs-editor data-docs-mode={mode}>
      <div className="docs-header" data-edit-control>
        {!headerHidden && (
          <div className="docs-title-row">
            <DocIcon size={26} className="docs-title-icon" />
            <TitleField
              documentId={documentId}
              title={title}
              canEdit={canEdit}
              firstLine={editor && saveState === "saved" ? firstLineOf(editor) : ""}
              onDone={() => {
                if (editor && !editor.isDestroyed) editor.commands.focus();
                else (document.activeElement as HTMLElement | null)?.blur();
              }}
            />
            {canEdit && <SaveStatus state={shownSaveState} />}
            {editor && <VersionHistoryButton editor={editor} />}
          </div>
        )}
        {editor && (
          <DocsToolbar
            editor={editor}
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
        )}
        {area && <PageRuler {...area} />}
      </div>
      {area ? (
        <PageCanvas {...area} zoom={zoom} onZoom={setZoom} onPageClick={onPageClick}>
          <EditorContent editor={editor} />
        </PageCanvas>
      ) : (
        <div className="docs-canvas" />
      )}
      {area && <InsertLayer {...area} />}
      {area && <TypingLayer {...area} />}
      {area && <UnitosLayer {...area} />}
      {area && <SuggestLayer {...area} suggesting={mode === "suggesting"} />}
      {area && <VersionHistory key={documentId} {...area} />}
      {editor && <LinkDialog editor={editor} />}
      {editor && <LinkBubble editor={editor} canEdit={canEdit && mode !== "viewing"} />}
      {editor && <WordCountDialog editor={editor} />}
      <CommentRelay documentId={documentId} editor={editor} />
    </div>
  );
}

/** Add comment (the toolbar's button, Ctrl+Alt+M) opens the reader's Comment
    tool on the selection: a comment in Unitos is an annotation. */
function CommentRelay({ documentId, editor }: { documentId: string; editor: Editor | null }) {
  useEffect(() => {
    const onComment = () => {
      if (!editor) return;
      window.dispatchEvent(new CustomEvent("docs:comment-selection", { detail: { documentId } }));
    };
    window.addEventListener(DOCS_EVENT.comment, onComment);
    return () => window.removeEventListener(DOCS_EVENT.comment, onComment);
  }, [documentId, editor]);
  return null;
}
