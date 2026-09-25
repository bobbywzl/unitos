"use client";

import { getMarkRange, type Editor } from "@tiptap/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { DOCS_EVENT } from "@/components/docs/extensions";
import { DocIcon, EditIcon, LinkIcon } from "@/components/docs/icons";
import { insertFileChip, projectDocHref } from "@/components/docs/insert/actions";
import { insertContext, toast } from "@/components/docs/insert/context";
import { ArrowBackIcon, BookmarkIcon, ChevronRightIcon, CopyIcon, LinkOffIcon, TitleIcon } from "@/components/docs/insert/icons";
import { openLinkHref, placeOf, placePos, projectDocOf } from "@/components/docs/insert/links";
import { tocEntries } from "@/components/docs/insert/toc";
import { anchorAt, FloatingBox, focusSoon, useViewportTick, type Anchor } from "@/components/docs/insert/ui";

// Links in the page editor (SPEC.md §29), as Google Docs does them: Insert
// link (Ctrl+K) opens a box under the selection: the link field (and the
// Text field when no words are selected), the project's documents and this
// document's headings that match, and Headings and bookmarks. A caret in a
// link shows its bubble: the title, the site, Copy, Edit, Remove, and for
// the address of a project document, Replace URL with a chip or its title.

type Range = { from: number; to: number };
type Target = { key: string; label: string; href: string; icon: ReactNode };

/** A typed address as a link: "example.com" gains https://, an email mailto:. */
function normalizeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (value.startsWith("/") || value.startsWith("#")) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  if (/^[^\s]+\.[^\s]{2,}/.test(value)) return `https://${value}`;
  return null;
}

/** Under the words from `from` to `to`, left-aligned to their start. */
function under(editor: Editor, { from, to }: Range): Anchor | null {
  const start = anchorAt(editor, from);
  const end = anchorAt(editor, to);
  return start && end ? { left: start.left, top: start.top, bottom: Math.max(start.bottom, end.bottom) } : null;
}

/** This document's headings and bookmarks, as link targets. */
function placesOf(editor: Editor, bookmarkLabel: string): { headings: Target[]; bookmarks: Target[] } {
  const { doc } = editor.state;
  const headings = tocEntries(doc, [1, 2, 3, 4, 5, 6]).flatMap((e) =>
    e.blockId ? [{ key: e.blockId, label: e.text, href: `#heading=${e.blockId}`, icon: <TitleIcon size={18} /> }] : [],
  );
  const bookmarks: Target[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "bookmark") return true;
    const $pos = doc.resolve(pos);
    const after = $pos.parent.textBetween($pos.parentOffset + node.nodeSize, $pos.parent.content.size, " ", " ").trim();
    const id = String(node.attrs.bookmarkId ?? "");
    bookmarks.push({ key: id, label: after.slice(0, 60) || bookmarkLabel, href: `#bookmark=${id}`, icon: <BookmarkIcon size={18} /> });
    return false;
  });
  return { headings, bookmarks };
}

function TargetRows({ targets, onPick }: { targets: Target[]; onPick: (target: Target) => void }) {
  return targets.map((target) => (
    <button key={target.key} type="button" className="docs-link-row" onClick={() => onPick(target)}>
      {target.icon}
      <span>{target.label}</span>
    </button>
  ));
}

export function LinkDialog({ editor }: { editor: Editor }) {
  const t = useT();
  const [range, setRange] = useState<Range | null>(null);
  const [text, setText] = useState("");
  const [href, setHref] = useState("");
  const [showText, setShowText] = useState(true);
  const [places, setPlaces] = useState(false);
  const hrefRef = useRef<HTMLInputElement>(null);
  useViewportTick(range !== null);

  useEffect(() => {
    const onOpen = () => {
      if (!editor.isEditable) return;
      if (editor.state.selection.empty && editor.isActive("link")) editor.chain().extendMarkRange("link").run();
      const { from, to } = editor.state.selection;
      const selected = editor.state.doc.textBetween(from, to, " ");
      const current = (editor.getAttributes("link").href as string | undefined) ?? "";
      setText(selected);
      setHref(current);
      // Selected words keep their words; a new link or an edited one shows Text.
      setShowText(!selected || Boolean(current));
      setPlaces(false);
      setRange({ from, to });
    };
    window.addEventListener(DOCS_EVENT.link, onOpen);
    return () => window.removeEventListener(DOCS_EVENT.link, onOpen);
  }, [editor]);

  useEffect(() => {
    if (range) focusSoon(hrefRef.current);
  }, [range]);

  const close = () => {
    setRange(null);
    editor.commands.focus();
  };

  /** Link the selection, or the typed words, or the target's own title. */
  const put = (target: string, title: string) => {
    const { from, to } = editor.state.selection;
    const current = editor.state.doc.textBetween(from, to, " ");
    const words = text.trim() || current || title;
    const chain = editor.chain().focus();
    if (words === current) chain.setLink({ href: target }).run();
    else chain.insertContentAt({ from, to }, { type: "text", text: words, marks: [{ type: "link", attrs: { href: target } }] }).run();
    setRange(null);
  };

  const anchor = range && under(editor, range);
  if (!anchor) return null;
  const ctx = insertContext(editor);
  const link = normalizeHref(href);
  const query = (href.trim() || (showText ? "" : text)).toLowerCase();
  const suggestions: Target[] =
    query && !link
      ? [
          ...(ctx?.documents ?? [])
            .filter((d) => d.id !== ctx?.documentId && d.title.toLowerCase().includes(query))
            .map((d) => ({ key: d.id, label: d.title, href: projectDocHref(ctx?.notebookId ?? "", d.id), icon: <DocIcon size={18} /> })),
          ...placesOf(editor, t("docsInsert.bookmark")).headings.filter((h) => h.label.toLowerCase().includes(query)),
        ].slice(0, 8)
      : [];
  const pick = (target: Target) => put(target.href, target.label);
  const all = places ? placesOf(editor, t("docsInsert.bookmark")) : null;

  return (
    <FloatingBox anchor={anchor} gap={8} className="docs-link-box" label={t("docs.insertLink")} onDismiss={close}>
      {all ? (
        <div className="docs-link-places">
          <div className="docs-link-places-head">
            <button type="button" className="docs-icon-btn" aria-label={t("docsInsert.back")} data-tip={t("docsInsert.back")} onClick={() => setPlaces(false)}>
              <ArrowBackIcon />
            </button>
            <span>{t("docsInsert.headingsAndBookmarks")}</span>
          </div>
          {all.headings.length + all.bookmarks.length === 0 && <p className="docs-link-empty">{t("docsInsert.noPlaces")}</p>}
          {all.headings.length > 0 && <div className="docs-link-section">{t("docsInsert.headings")}</div>}
          <TargetRows targets={all.headings} onPick={pick} />
          {all.bookmarks.length > 0 && <div className="docs-link-section">{t("docsInsert.bookmarks")}</div>}
          <TargetRows targets={all.bookmarks} onPick={pick} />
        </div>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (link) put(link, href.trim());
            }}
          >
            {showText && (
              <label className="docs-field-row">
                <span className="docs-field-icon" aria-hidden>
                  <span className="docs-field-text-glyph">T</span>
                </span>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("docs.linkText")} aria-label={t("docs.linkText")} className="docs-field" />
              </label>
            )}
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
              <button type="submit" className="docs-button-primary" disabled={!link}>
                {t("docs.apply")}
              </button>
            </label>
          </form>
          {suggestions.length > 0 && (
            <div className="docs-link-suggest">
              <TargetRows targets={suggestions} onPick={pick} />
            </div>
          )}
          <button type="button" className="docs-link-row docs-link-foot" onClick={() => setPlaces(true)}>
            <TitleIcon size={18} />
            <span>{t("docsInsert.headingsAndBookmarks")}</span>
            <ChevronRightIcon size={18} />
          </button>
        </>
      )}
    </FloatingBox>
  );
}

/** A link's full address; the link itself when it has none. */
function absolute(href: string): string {
  try {
    return new URL(href, window.location.href).toString();
  } catch {
    return href;
  }
}

/** The site a web link goes to, as the bubble names it. */
function siteOf(href: string): string {
  try {
    const url = new URL(href, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname : "";
  } catch {
    return "";
  }
}

export function LinkBubble({ editor, canEdit }: { editor: Editor; canEdit: boolean }) {
  const t = useT();
  const [shown, setShown] = useState<{ href: string } & Range>({ href: "", from: 0, to: 0 });
  useViewportTick(Boolean(shown.href));

  useEffect(() => {
    const update = () => {
      const { selection } = editor.state;
      const href = editor.getAttributes("link").href as string | undefined;
      const range = selection.empty ? getMarkRange(selection.$from, editor.schema.marks.link) : undefined;
      setShown(editor.isFocused && href && range ? { href, ...range } : { href: "", from: 0, to: 0 });
    };
    // A press on the bubble blurs the editor for a moment; the bubble
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

  const { href, from, to } = shown;
  const anchor = href ? under(editor, { from, to: from }) : null;
  if (!anchor) return null;
  const ctx = insertContext(editor);
  const place = placeOf(href);
  const docId = ctx ? projectDocOf(href, ctx.notebookId) : null;
  const doc = docId ? ctx?.documents.find((d) => d.id === docId) : undefined;
  let title = href;
  if (place) {
    const at = placePos(editor.state.doc, place);
    title = place.kind === "bookmark" || at === null ? t("docsInsert.bookmark") : editor.state.doc.resolve(at).parent.textContent;
  } else if (doc) {
    title = doc.title;
  }
  const site = place || doc ? "" : siteOf(href);
  // A project document's pasted address offers its chip or its title.
  const asUrl = canEdit && doc && ctx && editor.state.doc.textBetween(from, to) === href;
  const button = (label: string, icon: ReactNode, onClick: () => void) => (
    <button type="button" className="docs-tb-btn" aria-label={label} data-tip={label} onClick={onClick}>
      {icon}
    </button>
  );

  return (
    <FloatingBox anchor={anchor} gap={8} className="docs-link-bar" label={title}>
      <div className="docs-link-bar-main">
        {doc ? <DocIcon /> : place ? <BookmarkIcon /> : <LinkIcon />}
        <span className="docs-link-bar-text">
          <a
            href={absolute(href)}
            onClick={(e) => {
              e.preventDefault();
              openLinkHref(editor, href, ctx);
            }}
          >
            {title}
          </a>
          {site && <span className="docs-link-bar-site">{site}</span>}
        </span>
        {button(t("docs.copyLink"), <CopyIcon size={18} />, () => void navigator.clipboard.writeText(absolute(href)).then(() => toast(t("docs.linkCopied"))))}
        {canEdit && button(t("docs.editLink"), <EditIcon size={18} />, () => window.dispatchEvent(new CustomEvent(DOCS_EVENT.link)))}
        {canEdit && button(t("docs.removeLink"), <LinkOffIcon size={18} />, () => editor.chain().focus().extendMarkRange("link").unsetLink().run())}
      </div>
      {asUrl && (
        <div className="docs-link-prompt">
          <span>{t("docsInsert.replaceUrl")}</span>
          <button type="button" className="docs-text-btn" onClick={() => insertFileChip(editor, doc, ctx.notebookId, { from, to })}>
            {t("docsInsert.chip")}
          </button>
          <button
            type="button"
            className="docs-text-btn"
            onClick={() => editor.chain().focus().insertContentAt({ from, to }, { type: "text", text: doc.title, marks: [{ type: "link", attrs: { href } }] }).run()}
          >
            {t("docsInsert.link")}
          </button>
        </div>
      )}
    </FloatingBox>
  );
}
