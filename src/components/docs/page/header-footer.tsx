"use client";

import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLang, useT } from "@/components/lang-provider";
import { DocsFontFamily, fontStack } from "@/components/docs/fonts";
import { DropDownIcon } from "@/components/docs/icons";
import { DropdownPanel, MenuItem } from "@/components/docs/menu";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { DEFAULT_HF_MARGIN_PT, formatLength, lengthUnitFor, parseLength, type PageFrame } from "@/components/docs/page/geometry";
import { PAGE_EVENT, usePageState, type HeaderArea, type PageStore } from "@/components/docs/page/store";
import type { PageSetup, RichNode } from "@/lib/docs/schema";

// Headers, footers, and page numbers (SPEC.md §29), Google Docs': the header
// starts 0.5 in below the page's top edge and the footer ends 0.5 in above
// its bottom; a header taller than the top margin pushes the text down. A
// double-click in a page's top or bottom margin edits the header or the
// footer in place, with Docs' bar at its inner edge: the label, Different
// first page, and Options (Header format, Page numbers, Remove header).
// Escape or a press in the text leaves. The header and footer are the page
// setup's rich text; a page number field draws each page's number.

type Slot = "header" | "footer" | "firstHeader" | "firstFooter";

/** Which of the setup's headers or footers page `page` shows. */
export function slotFor(setup: PageSetup, area: HeaderArea, page: number): Slot {
  if (setup.differentFirst && page === 0) return area === "header" ? "firstHeader" : "firstFooter";
  return area;
}

export function hasText(doc: RichNode | null | undefined): boolean {
  if (!doc) return false;
  const walk = (n: RichNode): boolean =>
    (n.type === "text" && !!n.text?.trim()) || n.type === "pageNumber" || n.type === "pageCount" || (n.content ?? []).some(walk);
  return walk(doc);
}

type FieldContext = { page: number; pages: number; start: number };

function markStyle(attrs: Record<string, unknown> | undefined): CSSProperties {
  const style: CSSProperties = {};
  if (typeof attrs?.color === "string") style.color = attrs.color;
  if (typeof attrs?.fontSize === "string") style.fontSize = attrs.fontSize;
  if (typeof attrs?.fontFamily === "string") style.fontFamily = fontStack(attrs.fontFamily);
  return style;
}

function inline(node: RichNode, key: number, ctx: FieldContext): ReactNode {
  if (node.type === "hardBreak") return <br key={key} />;
  if (node.type === "pageNumber" || node.type === "pageCount") {
    return (
      <span key={key} className="docs-hf-field">
        {node.type === "pageNumber" ? ctx.start + ctx.page : ctx.pages}
      </span>
    );
  }
  if (node.type !== "text") return (node.content ?? []).map((c, i) => inline(c, i, ctx));
  let out: ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") out = <strong>{out}</strong>;
    else if (mark.type === "italic") out = <em>{out}</em>;
    else if (mark.type === "underline") out = <u>{out}</u>;
    else if (mark.type === "strike") out = <s>{out}</s>;
    else if (mark.type === "subscript") out = <sub>{out}</sub>;
    else if (mark.type === "superscript") out = <sup>{out}</sup>;
    else if (mark.type === "textStyle") out = <span style={markStyle(mark.attrs)}>{out}</span>;
  }
  return <span key={key}>{out}</span>;
}

/** A header's or a footer's rich text, drawn for one page. */
export function HeaderFooterText({ doc, ctx }: { doc: RichNode; ctx: FieldContext }) {
  return (
    <>
      {(doc.content ?? []).map((block, i) => {
        const align = block.attrs?.textAlign;
        const content = block.content ?? [];
        return (
          <p key={i} style={typeof align === "string" ? { textAlign: align as CSSProperties["textAlign"] } : undefined}>
            {content.length > 0 ? content.map((c, j) => inline(c, j, ctx)) : <br />}
          </p>
        );
      })}
    </>
  );
}

/** The page number and page count fields in the header editor: each draws
    the number of the page being edited. */
function fieldNode(name: "pageNumber" | "pageCount") {
  const attr = name === "pageNumber" ? "data-page-number" : "data-page-count";
  return Node.create<{ value: () => string }>({
    name,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addOptions() {
      return { value: () => "1" };
    },
    parseHTML() {
      return [{ tag: `span[${attr}]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["span", mergeAttributes(HTMLAttributes, { [attr]: "", class: "docs-hf-field" })];
    },
    addNodeView() {
      return () => {
        const dom = document.createElement("span");
        dom.className = "docs-hf-field";
        dom.contentEditable = "false";
        dom.textContent = this.options.value();
        return { dom };
      };
    },
  });
}

const EMPTY_DOC: RichNode = { type: "doc", content: [{ type: "paragraph" }] };

/** The header or footer being edited, in place on its page. */
function HeaderEditor({
  doc,
  ctx,
  onChange,
  onExit,
}: {
  doc: RichNode;
  ctx: FieldContext;
  onChange: (doc: RichNode) => void;
  onExit: () => void;
}) {
  const changeRef = useRef(onChange);
  const exitRef = useRef(onExit);
  useEffect(() => {
    changeRef.current = onChange;
    exitRef.current = onExit;
  }, [onChange, onExit]);
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          listKeymap: false,
          codeBlock: false,
          code: false,
          horizontalRule: false,
          dropcursor: false,
          gapcursor: false,
          trailingNode: false,
          link: false,
        }),
        TextStyle,
        Color,
        FontSize,
        DocsFontFamily,
        Subscript,
        Superscript,
        TextAlign.configure({ types: ["paragraph"], alignments: ["left", "center", "right", "justify"] }),
        fieldNode("pageNumber").configure({ value: () => String(ctx.start + ctx.page) }),
        fieldNode("pageCount").configure({ value: () => String(ctx.pages) }),
      ],
      content: doc as JSONContent,
      immediatelyRender: false,
      editorProps: {
        attributes: { class: "docs-hf-prose", spellcheck: "true" },
        handleKeyDown: (_view, event) => {
          if (event.key === "Escape") {
            exitRef.current();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: e }) => changeRef.current(e.getJSON() as RichNode),
    },
    [],
  );
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.focus("end");
    // Page count (Search the menus) goes in at the caret.
    const insert = () => editor.chain().focus().insertContent({ type: "pageCount" }).run();
    window.addEventListener(PAGE_EVENT.pageCount, insert);
    return () => window.removeEventListener(PAGE_EVENT.pageCount, insert);
  }, [editor]);
  return <EditorContent editor={editor} />;
}

/** Put a right-aligned page number in a header or footer, once. */
function withPageNumber(doc: RichNode | null | undefined): RichNode {
  const base = doc && (doc.content?.length ?? 0) > 0 ? doc : EMPTY_DOC;
  const has = (n: RichNode): boolean => n.type === "pageNumber" || (n.content ?? []).some(has);
  if (has(base)) return base;
  const blocks = (base.content ?? []).filter((b) => (b.content?.length ?? 0) > 0);
  return { type: "doc", content: [...blocks, { type: "paragraph", attrs: { textAlign: "right" }, content: [{ type: "pageNumber" }] }] };
}

/** Headers and footers as they sit on the page, and the one being edited. */
export function HeaderFooterLayer({
  store,
  frame,
  pages,
  area: bodyArea,
}: {
  store: PageStore;
  frame: PageFrame;
  pages: number;
  /** Page i's text top and bottom, px from the page's top. */
  area: (page: number) => { top: number; bottom: number };
}) {
  const t = useT();
  const setup = usePageState(store, (s) => s.setup);
  const editing = usePageState(store, (s) => s.editing);
  const [menuOpen, setMenuOpen] = useState(false);
  const optionsRef = useRef<HTMLButtonElement>(null);
  // The edited header's or footer's height, so the bar never covers it.
  const editRef = useRef<HTMLDivElement>(null);
  const [textHeight, setTextHeight] = useState(20);
  useEffect(() => {
    const el = editRef.current;
    if (!el) return;
    const measure = () => setTextHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing]);

  // Leaving saves what changed, and so does closing the document mid-edit.
  useEffect(() => {
    if (!editing) return;
    const start = store.get().setup;
    return () => {
      const now = store.get().setup;
      if (JSON.stringify(start) !== JSON.stringify(now)) void store.saveSetup(now);
    };
  }, [editing, store]);

  if (!editing || setup.pageless) return null;
  const { area, page } = editing;
  const slot = slotFor(setup, area, page);
  const doc = setup[slot] ?? EMPTY_DOC;
  const start = setup.pageNumberStart ?? 1;
  const ctx = { page, pages, start };
  const top = page * frame.pitch;
  const label =
    slot === "firstHeader"
      ? t("docsPage.firstPageHeader")
      : slot === "firstFooter"
        ? t("docsPage.firstPageFooter")
        : t(area === "header" ? "docsPage.header" : "docsPage.footer");

  const exit = () => store.set({ editing: null });
  const change = (next: RichNode) => store.set({ setup: { ...store.get().setup, [slot]: next } });
  // An Options item leaves the header or footer.
  const choose = (patch: Parameters<PageStore["set"]>[0]) => () => {
    setMenuOpen(false);
    store.set({ ...patch, editing: null });
  };
  const barHeight = 30;
  const textStyle: CSSProperties =
    area === "header"
      ? { top: top + frame.headerMargin, left: frame.left, right: frame.right }
      : { top: top + frame.height - frame.footerMargin, left: frame.left, right: frame.right, transform: "translateY(-100%)" };
  // The bar sits at the inner edge of the area: under the header, over the
  // footer, never over their text.
  const barTop =
    area === "header"
      ? top + Math.max(bodyArea(page).top - barHeight, frame.headerMargin + textHeight + 2)
      : top + Math.min(bodyArea(page).bottom, frame.height - frame.footerMargin - textHeight - barHeight - 2);

  return (
    <div className="docs-hf-layer" data-docs-hf data-edit-control>
      <div ref={editRef} className="docs-hf-edit" style={textStyle}>
        <HeaderEditor key={`${slot}-${page}`} doc={doc} ctx={ctx} onChange={change} onExit={exit} />
      </div>
      <div className="docs-hf-bar" style={{ top: barTop, height: barHeight }}>
        <span className="docs-hf-label">{label}</span>
        <label className="docs-hf-check">
          <input
            type="checkbox"
            checked={setup.differentFirst === true}
            onChange={(e) => store.set({ setup: { ...store.get().setup, differentFirst: e.target.checked } })}
          />
          {t("docsPage.differentFirstPage")}
        </label>
        <button
          ref={optionsRef}
          type="button"
          className="docs-hf-options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {t("docsPage.options")}
          <DropDownIcon size={18} />
        </button>
        <DropdownPanel open={menuOpen} anchorRef={optionsRef} onClose={() => setMenuOpen(false)} placement="below-right">
          <MenuItem onSelect={choose({ dialog: "headerFormat" })}>
            {t(area === "header" ? "docsPage.headerFormat" : "docsPage.footerFormat")}
          </MenuItem>
          <MenuItem onSelect={choose({ dialog: "pageNumbers" })}>{t("docsPage.pageNumbers")}</MenuItem>
          <MenuItem onSelect={choose({ setup: { ...setup, [slot]: null } })}>
            {t(area === "header" ? "docsPage.removeHeader" : "docsPage.removeFooter")}
          </MenuItem>
        </DropdownPanel>
      </div>
    </div>
  );
}

/** Put page numbers in the header or the footer, on the first page or not. */
export function addPageNumbers(setup: PageSetup, area: HeaderArea, onFirst: boolean): PageSetup {
  const next: PageSetup = { ...setup, [area]: withPageNumber(setup[area]) };
  if (!onFirst) next.differentFirst = true;
  else if (next.differentFirst) {
    const first = area === "header" ? "firstHeader" : "firstFooter";
    next[first] = withPageNumber(setup[first]);
  }
  return next;
}

/** Page numbers: in the header or the footer, on the first page or not, and
    the first page's number. */
export function PageNumbersDialog({ store, onClose }: { store: PageStore; onClose: () => void }) {
  const t = useT();
  const setup = usePageState(store, (s) => s.setup);
  const [area, setArea] = useState<HeaderArea>(hasText(setup.header) && !hasText(setup.footer) ? "header" : "footer");
  const [onFirst, setOnFirst] = useState(!setup.differentFirst);
  const [startAt, setStartAt] = useState(String(setup.pageNumberStart ?? 1));

  const apply = () => {
    const n = Math.round(Number(startAt));
    const next = addPageNumbers(setup, area, onFirst);
    next.pageNumberStart = Number.isFinite(n) ? Math.max(0, Math.min(999, n)) : 1;
    void store.saveSetup(next);
    onClose();
  };

  return (
    <SmallDialog title={t("docsPage.pageNumbers")} onClose={onClose} onApply={apply}>
      <fieldset className="docs-setup-group">
        <legend className="docs-setup-label">{t("docsPage.position")}</legend>
        <div className="docs-setup-radios">
          {(["header", "footer"] as const).map((a) => (
            <label key={a} className="docs-setup-radio">
              <input type="radio" name="docs-number-area" checked={area === a} onChange={() => setArea(a)} />
              {t(a === "header" ? "docsPage.header" : "docsPage.footer")}
            </label>
          ))}
        </div>
        <label className="docs-setup-radio">
          <input type="checkbox" checked={onFirst} onChange={(e) => setOnFirst(e.target.checked)} />
          {t("docsPage.showOnFirstPage")}
        </label>
      </fieldset>
      <fieldset className="docs-setup-group">
        <legend className="docs-setup-label">{t("docsPage.numbering")}</legend>
        <label className="docs-setup-margin">
          <span>{t("docsPage.startAt")}</span>
          <input
            className="docs-field docs-setup-short"
            type="number"
            min={0}
            max={999}
            value={startAt}
            onChange={(e) => setStartAt(e.target.value.slice(0, 3))}
          />
        </label>
      </fieldset>
    </SmallDialog>
  );
}

/** Headers & footers: their margins, and Different first page. */
export function HeaderFormatDialog({ store, onClose }: { store: PageStore; onClose: () => void }) {
  const t = useT();
  const unit = lengthUnitFor(useLang());
  const setup = usePageState(store, (s) => s.setup);
  const [header, setHeader] = useState(formatLength(setup.headerMargin ?? DEFAULT_HF_MARGIN_PT, unit));
  const [footer, setFooter] = useState(formatLength(setup.footerMargin ?? DEFAULT_HF_MARGIN_PT, unit));
  const [first, setFirst] = useState(setup.differentFirst === true);
  const apply = () => {
    const pt = (v: string) => Math.min(700, parseLength(v, unit) ?? DEFAULT_HF_MARGIN_PT);
    void store.saveSetup({ ...setup, headerMargin: pt(header), footerMargin: pt(footer), differentFirst: first });
    onClose();
  };
  return (
    <SmallDialog title={t("docsPage.headersFooters")} onClose={onClose} onApply={apply}>
      <fieldset className="docs-setup-group">
        <legend className="docs-setup-label">
          {t(unit === "in" ? "docsPage.marginsInches" : "docsPage.marginsCentimeters")}
        </legend>
        <div className="docs-setup-margins">
          <label className="docs-setup-margin">
            <span>{t("docsPage.header")}</span>
            <input className="docs-field" inputMode="decimal" value={header} onChange={(e) => setHeader(e.target.value.slice(0, 8))} />
          </label>
          <label className="docs-setup-margin">
            <span>{t("docsPage.footer")}</span>
            <input className="docs-field" inputMode="decimal" value={footer} onChange={(e) => setFooter(e.target.value.slice(0, 8))} />
          </label>
        </div>
      </fieldset>
      <fieldset className="docs-setup-group">
        <legend className="docs-setup-label">{t("docsPage.layout")}</legend>
        <label className="docs-setup-radio">
          <input type="checkbox" checked={first} onChange={(e) => setFirst(e.target.checked)} />
          {t("docsPage.differentFirstPage")}
        </label>
      </fieldset>
    </SmallDialog>
  );
}

/** A page area dialog: Enter in a field applies it. */
function SmallDialog({
  title,
  onClose,
  onApply,
  children,
}: {
  title: string;
  onClose: () => void;
  onApply: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <ToolbarDialog
      title={title}
      onClose={onClose}
      className="docs-small-dialog"
      closeButton={false}
      actions={
        <>
          <DialogButton onClick={onClose}>{t("docs.cancel")}</DialogButton>
          <DialogButton primary onClick={onApply}>
            {t("docs.apply")}
          </DialogButton>
        </>
      }
    >
      <div
        className="docs-setup-body"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            onApply();
          }
        }}
      >
        {children}
      </div>
    </ToolbarDialog>
  );
}
