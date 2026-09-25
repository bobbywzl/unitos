"use client";

import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { AnnotationMarks, annotationMarksKey, openMarkAt, type MarksMeta } from "@/components/docs/annotation-marks";
import { LinkBubble, LinkDialog } from "@/components/docs/link-dialog";
import { DOCS_EVENT, docsExtensions } from "@/components/docs/extensions";
import { docsFontsUrl } from "@/components/docs/fonts";
import { CloudDoneIcon, CloudOffIcon, CloudSyncIcon, DocIcon } from "@/components/docs/icons";
import { DocsToolbar, type DocsMode, type Zoom } from "@/components/docs/toolbar";
import { useDocsSave, type SaveState } from "@/components/docs/use-docs-save";
import { WordCountDialog } from "@/components/docs/word-count";
import { InsertLayer } from "@/components/docs/areas/insert";
import { UnitosLayer } from "@/components/docs/areas/layer";
import { PageCanvas, PageRuler } from "@/components/docs/areas/page";
import { TypingLayer } from "@/components/docs/areas/typing";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import type { Highlight } from "@/components/reader/block-view";
import { api } from "@/lib/api";
import type { PageSetup, RichNode } from "@/lib/docs/schema";

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
  // Each finished save shows the saved words once, for 3 s.
  const [finished, setFinished] = useState(0);
  const [faded, setFaded] = useState(0);
  if (last !== state) {
    setLast(state);
    if (state === "saved") setFinished((n) => n + 1);
  }
  useEffect(() => {
    if (finished === 0) return;
    const id = setTimeout(() => setFaded(finished), 3000);
    return () => clearTimeout(id);
  }, [finished]);
  const caption =
    state === "saving" || state === "unsaved"
      ? t("docs.saving")
      : state === "offline"
        ? t("docs.offlineSaving")
        : state === "error"
          ? t("docs.saveFailed")
          : finished > faded
            ? t("docsPage.savedCaption")
            : "";
  const tip = state === "saved" ? t("docs.saved") : caption;
  const Icon = state === "saved" ? CloudDoneIcon : state === "offline" || state === "error" ? CloudOffIcon : CloudSyncIcon;
  return (
    <span className={`docs-status docs-status-${state}`} data-tip={tip} aria-label={tip} role="status">
      <Icon size={20} />
      {caption && <span className="docs-status-text">{caption}</span>}
    </span>
  );
}

/** The title, Google Docs' way: a click selects it all; Enter keeps the new
    title and goes back to the text, Escape puts the old one back, leaving
    the field keeps it. An empty title is the untitled one, drawn gray. */
function TitleField({
  documentId,
  title,
  canEdit,
  onDone,
}: {
  documentId: string;
  title: string;
  canEdit: boolean;
  /** Back to the document's text. */
  onDone: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const shown = saved ?? title;
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const [prevTitle, setPrevTitle] = useState(title);
  if (prevTitle !== title) {
    setPrevTitle(title);
    setSaved(null);
  }
  const untitledText = t("docsPage.untitled");
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
    try {
      await api(`/api/documents/${documentId}`, "PATCH", { title: next });
      router.refresh();
    } catch {
      setSaved(null);
    }
  }
  const value = draft ?? shown;
  const untitled = draft === null && (shown === untitledText || shown === "Untitled document");
  return (
    <span className="docs-title-wrap" data-value={value || " "}>
      <input
        ref={inputRef}
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
  const [spellcheck, setSpellcheck] = useState(true);
  const [headerHidden, setHeaderHidden] = useState(false);

  const extensions = useMemo(
    () => [...docsExtensions({ placeholder: t("docs.typeAtToInsert") }), AnnotationMarks],
    // The extensions are built once per editor; the hint's language is the
    // page's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const editor = useEditor(
    {
      extensions,
      content: richText as JSONContent,
      editable: canEdit,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
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

  // The QA scripts drive the editor directly in development.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !editor) return;
    (window as unknown as { __docsEditor?: Editor }).__docsEditor = editor;
  }, [editor]);

  const { state: saveState, flush } = useDocsSave({
    documentId,
    editor,
    rev,
    richText,
    enabled: canEdit,
  });

  useEffect(() => {
    flushRef.current = flush;
    return () => {
      if (flushRef.current === flush) flushRef.current = null;
    };
  }, [flush, flushRef]);

  // The Unitos marks: repainted when the reader's highlights change — by
  // content, not by object. A repaint redraws the text and puts the editor's
  // selection back into the page, so a repaint for nothing would undo a
  // selection the reader is still growing with Shift+arrow.
  const marksSignature = useMemo(() => JSON.stringify(highlightsByBlock), [highlightsByBlock]);
  const paintedRef = useRef<{ editor: Editor | null; signature: string }>({ editor: null, signature: "" });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const painted = paintedRef.current;
    if (painted.editor === editor && painted.signature === marksSignature) return;
    paintedRef.current = { editor, signature: marksSignature };
    const meta: MarksMeta = { highlights: highlightsByBlock, t };
    editor.view.dispatch(editor.state.tr.setMeta(annotationMarksKey, meta).setMeta("addToHistory", false));
  }, [editor, marksSignature, highlightsByBlock, t]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(canEdit && mode === "editing");
  }, [editor, canEdit, mode]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dom.setAttribute("spellcheck", spellcheck ? "true" : "false");
  }, [editor, spellcheck]);

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
    async (source: { file: File } | { url: string }) => {
      if (!editor) return;
      if ("url" in source) {
        editor.chain().focus().setImage({ src: source.url }).run();
        return;
      }
      try {
        const res = await fetch("/api/images", { method: "POST", body: source.file });
        const body = (await res.json()) as { url?: string; error?: string };
        if (res.ok && body.url) editor.chain().focus().setImage({ src: body.url, alt: source.file.name }).run();
        else window.dispatchEvent(new CustomEvent("dissect:toast", { detail: { text: body.error ?? t("common.requestFailed") } }));
      } catch {
        window.dispatchEvent(new CustomEvent("dissect:toast", { detail: { text: t("common.requestFailed") } }));
      }
    },
    [editor, t],
  );

  // A press on a mark or a chip opens what it opens in the reader; a drag
  // over a mark is a selection like any other.
  const onPageClick = (e: React.MouseEvent) => {
    if (!editor) return;
    const target = e.target as Element;
    if (target.closest("[data-anchor-skip]")) {
      openMarkAt(target);
      return;
    }
    if (editor.state.selection.empty) openMarkAt(target);
  };

  const area: DocsAreaProps | null = editor
    ? { editor, documentId, notebookId, canEdit, editing: canEdit && mode === "editing", pageSetup, documents }
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
              onDone={() => {
                if (editor && !editor.isDestroyed) editor.commands.focus();
                else (document.activeElement as HTMLElement | null)?.blur();
              }}
            />
            {canEdit && <SaveStatus state={saveState} />}
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
            spellcheck={spellcheck}
            onSpellcheck={setSpellcheck}
            aiControls={aiControls}
            headerHidden={headerHidden}
            onToggleHeader={() => setHeaderHidden((h) => !h)}
            onInsertImage={(source) => void insertImage(source)}
          />
        )}
        {area && <PageRuler {...area} zoom={zoom} />}
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
      {editor && <LinkDialog editor={editor} />}
      {editor && <LinkBubble editor={editor} canEdit={canEdit && mode === "editing"} />}
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
