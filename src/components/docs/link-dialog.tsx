"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { DOCS_EVENT } from "@/components/docs/extensions";
import { CloseIcon, EditIcon, LinkIcon } from "@/components/docs/icons";

// Links in the page editor (SPEC.md §29), as Google Docs does them: Insert
// link (Ctrl+K) opens a small box under the selection with the text and the
// link; a caret inside a link shows the link bubble under it — the address,
// Copy link, Edit link, Remove link.

/** A typed address as a link: "example.com" gains https://, an email mailto:. */
export function normalizeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (value.startsWith("/") || value.startsWith("#")) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  if (/^[^\s]+\.[^\s]{2,}/.test(value)) return `https://${value}`;
  return null;
}

type Box = { top: number; left: number };

function boxUnder(editor: Editor, pos: number): Box {
  const coords = editor.view.coordsAtPos(pos);
  return { top: coords.bottom + 8, left: Math.max(8, Math.min(coords.left, window.innerWidth - 380)) };
}

export function LinkDialog({ editor }: { editor: Editor }) {
  const t = useT();
  const [box, setBox] = useState<Box | null>(null);
  const [text, setText] = useState("");
  const [href, setHref] = useState("");
  const [hadText, setHadText] = useState(false);
  const hrefRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onOpen = () => {
      if (!editor.isEditable) return;
      if (editor.state.selection.empty && editor.isActive("link")) {
        editor.chain().extendMarkRange("link").run();
      }
      const { from, to } = editor.state.selection;
      const selected = editor.state.doc.textBetween(from, to, " ");
      setText(selected);
      setHadText(selected.length > 0);
      setHref((editor.getAttributes("link").href as string | undefined) ?? "");
      setBox(boxUnder(editor, to));
      requestAnimationFrame(() => (selected ? hrefRef.current : textRef.current)?.focus());
    };
    window.addEventListener(DOCS_EVENT.link, onOpen);
    return () => window.removeEventListener(DOCS_EVENT.link, onOpen);
  }, [editor]);

  const close = () => {
    setBox(null);
    editor.commands.focus();
  };
  const apply = () => {
    const link = normalizeHref(href);
    if (!link) return;
    const words = text.trim() ? text : href.trim();
    const { from, to } = editor.state.selection;
    const current = editor.state.doc.textBetween(from, to, " ");
    if (!hadText || words !== current) {
      editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, { type: "text", text: words, marks: [{ type: "link", attrs: { href: link } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: link }).run();
    }
    setBox(null);
  };

  if (!box || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="docs-popup docs-link-dialog"
      style={{ top: box.top, left: box.left }}
      data-edit-control
      data-selection-popover
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label className="docs-field-row">
          <span className="docs-field-icon" aria-hidden>
            <span className="docs-field-text-glyph">T</span>
          </span>
          <input
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("docs.linkText")}
            aria-label={t("docs.linkText")}
            className="docs-field"
          />
        </label>
        <label className="docs-field-row">
          <span className="docs-field-icon" aria-hidden>
            <LinkIcon size={18} />
          </span>
          <input
            ref={hrefRef}
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder={t("docs.linkAddress")}
            aria-label={t("docs.linkAddress")}
            className="docs-field"
          />
          <button type="submit" className="docs-button-primary" disabled={!normalizeHref(href)}>
            {t("docs.apply")}
          </button>
        </label>
      </form>
      <button type="button" onClick={close} aria-label={t("docs.close")} className="docs-popup-close">
        <CloseIcon size={16} />
      </button>
    </div>,
    document.body,
  );
}

export function LinkBubble({ editor, canEdit }: { editor: Editor; canEdit: boolean }) {
  const t = useT();
  const [state, setState] = useState<{ href: string; box: Box } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const update = () => {
      const { selection } = editor.state;
      if (!editor.isFocused || !selection.empty || !editor.isActive("link")) {
        setState(null);
        return;
      }
      const href = editor.getAttributes("link").href as string | undefined;
      if (!href) {
        setState(null);
        return;
      }
      // The bubble sits under the start of the link the caret is in.
      const $pos = selection.$from;
      let start = $pos.pos;
      const linkType = editor.schema.marks.link;
      while (start > $pos.start() && linkType.isInSet(editor.state.doc.resolve(start - 1).marks())) start -= 1;
      setState({ href, box: boxUnder(editor, start) });
      setCopied(false);
    };
    // A press on the bubble itself blurs the editor for a moment; the bubble
    // waits before it decides the caret has left.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onBlur = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(update, 150);
    };
    editor.on("selectionUpdate", update);
    editor.on("focus", update);
    editor.on("blur", onBlur);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off("selectionUpdate", update);
      editor.off("focus", update);
      editor.off("blur", onBlur);
    };
  }, [editor]);

  if (!state || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="docs-popup docs-link-bubble"
      style={{ top: state.box.top, left: state.box.left }}
      data-edit-control
      onMouseDown={(e) => e.preventDefault()}
    >
      <a href={state.href} target="_blank" rel="noopener noreferrer" className="docs-link-bubble-href">
        {state.href}
      </a>
      <button
        type="button"
        className="docs-tb-btn"
        aria-label={copied ? t("docs.linkCopied") : t("docs.copyLink")}
        data-tip={copied ? t("docs.linkCopied") : t("docs.copyLink")}
        onClick={() => {
          void navigator.clipboard.writeText(state.href).then(() => setCopied(true));
        }}
      >
        <LinkIcon size={18} />
      </button>
      {canEdit && (
        <>
          <button
            type="button"
            className="docs-tb-btn"
            aria-label={t("docs.editLink")}
            data-tip={t("docs.editLink")}
            onClick={() => window.dispatchEvent(new CustomEvent(DOCS_EVENT.link))}
          >
            <EditIcon size={18} />
          </button>
          <button
            type="button"
            className="docs-tb-btn"
            aria-label={t("docs.removeLink")}
            data-tip={t("docs.removeLink")}
            onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}
          >
            <CloseIcon size={18} />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
