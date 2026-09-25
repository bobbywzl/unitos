"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { OutlineIcon } from "@/components/docs/icons";
import { insertInline } from "@/components/docs/insert/actions";
import { TocThumb } from "@/components/docs/insert/at-menu";
import { onInsert } from "@/components/docs/insert/context";
import { EmojiPicker } from "@/components/docs/insert/emoji-picker";
import { ImageSourcePicker } from "@/components/docs/insert/image-source";
import { insertImageFrom } from "@/components/docs/insert/image";
import { goToPlace, placeOf } from "@/components/docs/insert/links";
import { TOC_STYLES, type TocStyle } from "@/components/docs/insert/toc";
import { anchorAt, FloatingBox, PanelSection, SidePanel, useEditorTick } from "@/components/docs/insert/ui";
import type { TKey } from "@/lib/i18n/dictionaries";

// The insert area's smaller windows (SPEC.md §29): the emoji picker and the
// image sources at the caret (from the commands), the table of contents'
// options, and the page's address: a #heading= or #bookmark= in it scrolls
// to that place when the document opens.

export const TOC_STYLE_LABEL: Record<TocStyle, TKey> = {
  plain: "docsInsert.tocPlain",
  dotted: "docsInsert.tocDotted",
  links: "docsInsert.tocLinks",
};

export function EmojiPickerHost({ editor }: { editor: Editor }) {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => onInsert(editor, (e) => e.type === "emoji-picker" && setAt(editor.state.selection.from)), [editor]);
  if (at === null) return null;
  const anchor = anchorAt(editor, at);
  if (!anchor) return null;
  const close = () => {
    setAt(null);
    editor.view.focus();
  };
  return (
    <FloatingBox anchor={anchor} className="docs-picker docs-picker-emoji" onDismiss={close}>
      <EmojiPicker
        onPick={(char) => {
          close();
          insertInline(editor, { type: "text", text: char });
        }}
      />
    </FloatingBox>
  );
}

export function ImageInsertHost({ editor }: { editor: Editor }) {
  const [at, setAt] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(
    () =>
      onInsert(editor, (e) => {
        if (e.type !== "image-insert") return;
        if (e.source === "upload") fileRef.current?.click();
        else setAt(editor.state.selection.from);
      }),
    [editor],
  );
  const anchor = at !== null ? anchorAt(editor, at) : null;
  const close = () => {
    setAt(null);
    editor.view.focus();
  };
  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void insertImageFrom(editor, { file });
        }}
      />
      {anchor && (
        <FloatingBox anchor={anchor} className="docs-picker" onDismiss={close}>
          <ImageSourcePicker
            onFile={(file) => {
              close();
              void insertImageFrom(editor, { file });
            }}
            onUrl={(url) => {
              close();
              void insertImageFrom(editor, { url });
            }}
          />
        </FloatingBox>
      )}
    </>
  );
}

/** Table of contents options: its style, and which heading levels it lists. */
export function TocOptionsHost({ editor }: { editor: Editor }) {
  const t = useT();
  useEditorTick(editor);
  const [pos, setPos] = useState<number | null>(null);
  const [open, setOpen] = useState({ formatting: true, levels: true });
  useEffect(() => onInsert(editor, (e) => e.type === "toc-options" && setPos(e.pos)), [editor]);
  useEffect(() => {
    if (pos === null) return;
    const onTr = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map: (p: number) => number } } }) => {
      if (transaction.docChanged) setPos((p) => (p === null ? p : transaction.mapping.map(p)));
    };
    editor.on("transaction", onTr);
    return () => {
      editor.off("transaction", onTr);
    };
  }, [editor, pos]);
  if (pos === null) return null;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "tableOfContents") return null;
  const style = TOC_STYLES.includes(node.attrs.tocStyle as TocStyle) ? (node.attrs.tocStyle as TocStyle) : "links";
  const levels: number[] = Array.isArray(node.attrs.levels) && node.attrs.levels.length > 0 ? (node.attrs.levels as number[]) : [1, 2, 3];
  const set = (attrs: Record<string, unknown>) => {
    const current = editor.state.doc.nodeAt(pos);
    if (!current) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }));
  };
  return (
    <SidePanel title={t("docsInsert.tocOptions")} icon={<OutlineIcon size={20} />} onClose={() => setPos(null)}>
      <PanelSection title={t("docsInsert.formatting")} open={open.formatting} onToggle={() => setOpen((o) => ({ ...o, formatting: !o.formatting }))}>
        <div className="docs-toc-styles">
          {TOC_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              className="docs-toc-style"
              aria-pressed={style === s}
              aria-label={t(TOC_STYLE_LABEL[s])}
              data-tip={t(TOC_STYLE_LABEL[s])}
              onClick={() => set({ tocStyle: s })}
            >
              <TocThumb style={s} />
            </button>
          ))}
        </div>
      </PanelSection>
      <PanelSection title={t("docsInsert.headingLevels")} open={open.levels} onToggle={() => setOpen((o) => ({ ...o, levels: !o.levels }))}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <label key={n} className="docs-side-check">
            <input
              type="checkbox"
              checked={levels.includes(n)}
              onChange={(e) => {
                const next = e.target.checked ? [...levels, n].sort() : levels.filter((l) => l !== n);
                if (next.length > 0) set({ levels: next });
              }}
            />
            {t("docsInsert.headingN", { n })}
          </label>
        ))}
      </PanelSection>
    </SidePanel>
  );
}

/** #heading=<id> or #bookmark=<id> in the page's address: go there once the
    document is drawn, and again when the address changes. */
export function PlaceFromAddress({ editor }: { editor: Editor }) {
  useEffect(() => {
    const go = () => {
      const place = placeOf(window.location.hash);
      if (place) requestAnimationFrame(() => goToPlace(editor, place));
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [editor]);
  return null;
}
