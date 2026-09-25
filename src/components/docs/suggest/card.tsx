"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { replyTime } from "@/components/collab/reply-thread";
import { isSuggestionMark, settleSuggestions, suggestionAuthor, suggestionTime, ZWSP } from "@/components/docs/ext/suggest";
import { CheckIcon, CloseIcon } from "@/components/docs/icons";
import { belowSlot, pageGeometry, slotAt } from "@/components/docs/layer/margin";
import { blockStyle } from "@/components/docs/toolbar/styles";
import { STYLE_LABEL } from "@/components/docs/toolbar/styles-menu";
import { useLang, useT } from "@/components/lang-provider";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { personColor } from "@/lib/person";

// A suggestion's card (SPEC.md §29), Google Docs' own: the author's badge,
// name, and time; what the suggestion adds, deletes, replaces, or
// reformats; and, for an editor, Accept suggestion and Reject suggestion.
// It shows while the caret stands in the suggestion, with the comment
// card's look (css/layer.css) and place in the margin (layer/margin.ts).

const OBJECTS: Record<string, TKey> = {
  image: "docsInsert.itemImage",
  table: "docsInsert.itemTable",
  horizontalRule: "docsInsert.itemHorizontalLine",
  pageBreak: "docsInsert.itemPageBreak",
  blockMath: "docsInsert.itemEquation",
  tableOfContents: "docsInsert.itemTableOfContents",
};
const MARKS: Record<string, TKey> = {
  bold: "docs.bold",
  italic: "docs.italic",
  underline: "docs.underline",
  strike: "docsSuggest.strikethrough",
  subscript: "docsSuggest.subscript",
  superscript: "docsSuggest.superscript",
  link: "docsInsert.link",
};
const TEXT_STYLES: Record<string, TKey> = {
  color: "docs.textColor",
  backgroundColor: "docs.highlightColor",
  fontFamily: "docs.font",
  fontSize: "docs.fontSize",
};
const ALIGNS: Record<string, TKey> = {
  left: "docs.alignLeft",
  center: "docs.alignCenter",
  right: "docs.alignRight",
  justify: "docs.alignJustify",
};
const BLOCK_ATTRS: Record<string, TKey> = {
  lineSpacing: "docs.lineSpacing",
  spaceBefore: "docs.lineSpacing",
  spaceAfter: "docs.lineSpacing",
  indentLeft: "docsSuggest.indent",
  indentRight: "docsSuggest.indent",
  indentFirstLine: "docsSuggest.indent",
};

type MarkJson = { type?: string; attrs?: Record<string, unknown> } | null;

/** A mark put on or taken off words, by name; for text style, the
    attribute that changed. */
function markName(previous: MarkJson, next: MarkJson, t: TFunc): string {
  const type = (next ?? previous)?.type ?? "";
  const style =
    type === "textStyle"
      ? Object.keys(TEXT_STYLES).find((a) => (next?.attrs?.[a] ?? null) !== (previous?.attrs?.[a] ?? null))
      : undefined;
  const key = style ? TEXT_STYLES[style] : MARKS[type];
  const name = t(key ?? "docsSuggest.otherFormat");
  return next ? name : t("docsSuggest.formatOff", { name: name.toLocaleLowerCase() });
}

/** A block's change, by name: its paragraph style, alignment, spacing, or indent. */
function blockName(node: PMNode, attrName: unknown, newValue: unknown, t: TFunc): string {
  if (attrName === null || attrName === "level" || attrName === "docStyle") return t(STYLE_LABEL[blockStyle(node)]);
  if (attrName === "textAlign") return t(ALIGNS[String(newValue)] ?? "docs.alignLeft");
  return t(BLOCK_ATTRS[String(attrName)] ?? "docsSuggest.otherFormat");
}

/** A block's words, ¶ between its paragraphs. */
function blockWords(node: PMNode): string {
  if (node.isTextblock) return node.textContent;
  const lines: string[] = [];
  node.descendants((n) => {
    if (n.isTextblock) lines.push(n.textContent);
    return !n.isTextblock;
  });
  return lines.join("¶");
}

type Change = { from: number; added: string; removed: string; formats: string[] };

/** What a suggestion adds and removes — its words, ¶ where it breaks a
    paragraph, an object by name — and the format changes it makes. */
function readChange(doc: PMNode, id: string, t: TFunc): Change | null {
  const change: Change = { from: -1, added: "", removed: "", formats: [] };
  const last = { added: -1, removed: -1 };
  let block = -1;
  doc.descendants((node, pos) => {
    if (node.isTextblock) block = pos;
    const mark = node.marks.find((m) => isSuggestionMark(m) && String(m.attrs.id) === id);
    if (!mark) return true;
    if (change.from < 0) change.from = pos;
    if (mark.type.name === "modification") {
      for (const mod of node.marks) {
        if (mod.type !== mark.type || String(mod.attrs.id) !== id) continue;
        const { type, attrName, previousValue, newValue } = mod.attrs;
        const name =
          type === "mark"
            ? markName(previousValue as MarkJson, newValue as MarkJson, t)
            : blockName(node, attrName, newValue, t);
        if (!change.formats.includes(name)) change.formats.push(name);
      }
      return true;
    }
    const side = mark.type.name === "insertion" ? "added" : "removed";
    const at = node.isText ? block : pos;
    if (last[side] >= 0 && last[side] !== at) change[side] += "¶";
    last[side] = at;
    const object = OBJECTS[node.type.name];
    change[side] += object ? t(object) : (node.isInline ? node.textContent : blockWords(node)).replaceAll(ZWSP, "");
    return false;
  });
  return change.from < 0 ? null : change;
}

const quote = (words: string) => `“${words.length > 120 ? `${words.slice(0, 120)}…` : words}”`;

type Place = { left: number; top: number; width: number };

/** Beside the page where it stands, level with the suggestion's first
    line; with no room there, under its words. */
function placeIn(editor: Editor, pane: HTMLElement, from: number): Place | null {
  const geo = pageGeometry(pane, 0);
  if (!geo) return null;
  const top = editor.view.coordsAtPos(from).top - pane.getBoundingClientRect().top + pane.scrollTop;
  const slot = slotAt(geo, 0);
  return slot ? { ...slot, top } : { ...belowSlot(geo, 0), top: top + 34 };
}

function usePlace(editor: Editor, pane: HTMLElement, from: number): Place | null {
  const [place, setPlace] = useState<Place | null>(null);
  const [moves, setMoves] = useState(0);
  // The pane resizing and the page moving (--docs-shift) move the card.
  useEffect(() => {
    const moved = () => setMoves((n) => n + 1);
    const observer = new ResizeObserver(moved);
    observer.observe(pane);
    pane.addEventListener("transitionend", moved);
    return () => {
      observer.disconnect();
      pane.removeEventListener("transitionend", moved);
    };
  }, [pane]);
  useLayoutEffect(() => {
    const next = placeIn(editor, pane, from);
    setPlace((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next));
  }, [editor, pane, from, moves]);
  return place;
}

export function SuggestionCard({
  editor,
  pane,
  id,
  canSettle,
}: {
  editor: Editor;
  pane: HTMLElement;
  id: string;
  /** Accept and Reject show: an editor, out of Viewing mode. */
  canSettle: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const { people } = useCollab();
  const change = useEditorState({ editor, selector: ({ editor: e }) => readChange(e.state.doc, id, t) });
  const place = usePlace(editor, pane, change?.from ?? 0);
  if (!change || !place) return null;
  const author = suggestionAuthor(id);
  const person = people[author];
  const at = suggestionTime(id);
  const settle = (accept: boolean) => settleSuggestions(editor, accept, id);
  const { added, removed, formats } = change;
  return createPortal(
    <div
      data-selection-popover
      data-side-card="suggestion"
      role="group"
      aria-label={t("docsSuggest.suggestion")}
      // The caret stays in the suggestion, so the card stays.
      onMouseDown={(e) => e.preventDefault()}
      className="docs-comment docs-suggest-card bubble-in absolute z-40"
      style={{ ...place, borderColor: person?.color ?? personColor(author) }}
    >
      <div className="docs-comment-head">
        {person && <PersonBadge person={person} size={32} />}
        <div className="docs-comment-who">
          {person && <div className="docs-comment-name">{person.name}</div>}
          {at > 0 && <div className="docs-comment-time">{replyTime(new Date(at).toISOString(), lang)}</div>}
        </div>
        {canSettle && (
          <div className="docs-comment-buttons">
            <button
              type="button"
              onClick={() => settle(true)}
              data-track="suggestion-accept"
              aria-label={t("docsSuggest.acceptSuggestion")}
              data-tip={t("docsSuggest.acceptSuggestion")}
              className="docs-comment-button docs-comment-resolve"
            >
              <CheckIcon size={20} />
            </button>
            <button
              type="button"
              onClick={() => settle(false)}
              data-track="suggestion-reject"
              aria-label={t("docsSuggest.rejectSuggestion")}
              data-tip={t("docsSuggest.rejectSuggestion")}
              className="docs-comment-button docs-comment-resolve"
            >
              <CloseIcon size={20} />
            </button>
          </div>
        )}
      </div>
      {(added || removed) && (
        <p className="docs-suggest-what">
          <b>{t(added && removed ? "docsSuggest.replace" : added ? "docsSuggest.add" : "docsSuggest.delete")}</b>{" "}
          <i>{quote(removed || added)}</i>
          {added && removed && (
            <>
              {" "}
              {t("docsSuggest.replaceWith")} <i>{quote(added)}</i>
            </>
          )}
        </p>
      )}
      {formats.length > 0 && (
        <p className="docs-suggest-what">
          <b>{t("docsSuggest.format")}</b> {formats.join(", ")}
        </p>
      )}
    </div>,
    pane,
  );
}
