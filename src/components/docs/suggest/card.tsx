"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { memo, type ReactNode } from "react";
import { useAuthor } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { replyTime } from "@/components/collab/reply-thread";
import { focusSuggestion, readSuggestions, settleSuggestions, suggestionAt, type Suggestion } from "@/components/docs/ext/suggest";
import { CheckIcon, CloseIcon } from "@/components/docs/icons";
import { blockStyle } from "@/components/docs/toolbar/styles";
import { STYLE_LABEL } from "@/components/docs/toolbar/styles-menu";
import { useLang, useT } from "@/components/lang-provider";
import { suggestionAuthor, suggestionTime, type RichMark } from "@/lib/docs/schema";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { personColor } from "@/lib/person";

// A suggestion's card (SPEC.md §29): the comment card's look.

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
  strike: "docsTyping.scStrike",
  subscript: "docsTyping.scSubscript",
  superscript: "docsTyping.scSuperscript",
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
const LISTS: Record<string, TKey> = {
  bulletList: "docs.bulletedList",
  orderedList: "docs.numberedList",
  taskList: "docs.checklist",
};

type MarkJson = RichMark | null;

const off = (name: string, t: TFunc) => t("docsSuggest.formatOff", { name: name.toLocaleLowerCase() });

/** A mark put on or taken off words, by name; for text style, the
    attribute that changed. */
function markName(previous: MarkJson, next: MarkJson, t: TFunc): string {
  const type = (next ?? previous)?.type ?? "";
  const style =
    type === "textStyle"
      ? Object.keys(TEXT_STYLES).find((a) => (next?.attrs?.[a] ?? null) !== (previous?.attrs?.[a] ?? null))
      : undefined;
  const name = t((style ? TEXT_STYLES[style] : MARKS[type]) ?? "docsSuggest.otherFormat");
  return next ? name : off(name, t);
}

/** A block's change, by name: its list, paragraph style, alignment,
    spacing, indent, or tick. */
function blockName(node: PMNode, attrName: unknown, newValue: unknown, t: TFunc): string {
  if (attrName === null && LISTS[String(newValue)]) return t(LISTS[String(newValue)]);
  if (attrName === null || attrName === "level" || attrName === "docStyle") return t(STYLE_LABEL[blockStyle(node)]);
  if (attrName === "textAlign") return t(ALIGNS[String(newValue)] ?? "docs.alignLeft");
  if (attrName === "checked") return t(newValue ? "docsSuggest.checked" : "docsSuggest.unchecked");
  return t(BLOCK_ATTRS[String(attrName)] ?? "docsSuggest.otherFormat");
}

/** Blocks changed where their words stand: [the list before, the list
    after]; the same list is a change of level. */
function listName([before, after]: [string, string], t: TFunc): string {
  if (after && after !== before) return t(LISTS[after]);
  if (before && !after) return off(t(LISTS[before]), t);
  return t(before ? "docsSuggest.indent" : "docsSuggest.otherFormat");
}

/** A side's words, quoted: an object by name, a line break as ↵. */
function words(pieces: (string | PMNode)[], t: TFunc): string {
  const text = pieces
    .map((p) => (typeof p === "string" ? p : OBJECTS[p.type.name] ? t(OBJECTS[p.type.name]) : p.type.name === "hardBreak" ? "↵" : p.textContent))
    .join("");
  return `“${text.length > 120 ? `${text.slice(0, 120)}…` : text}”`;
}

/** What a suggestion does, a line each: Add, Delete, Replace, or Move with
    its words; Format with the names of its format changes. */
function describe(s: Suggestion, t: TFunc): ReactNode[] {
  const lines: ReactNode[] = [];
  const formats = s.formats.map(({ mark, node }) => {
    const { type, attrName, previousValue, newValue } = mark.attrs;
    return type === "mark" ? markName(previousValue as MarkJson, newValue as MarkJson, t) : blockName(node, attrName, newValue, t);
  });
  if (s.same === "move") {
    lines.push(<><b>{t("docsSuggest.move")}</b> <i>{words(s.added, t)}</i></>);
  } else if (s.same) {
    formats.unshift(listName(s.same, t));
  } else if (s.added.length || s.removed.length) {
    const [added, removed] = [s.added.length > 0, s.removed.length > 0];
    lines.push(
      <>
        <b>{t(added && removed ? "docsSuggest.replace" : added ? "docsSuggest.add" : "docsSuggest.delete")}</b>{" "}
        <i>{words(removed ? s.removed : s.added, t)}</i>
        {added && removed && <> {t("docsSuggest.replaceWith")} <i>{words(s.added, t)}</i></>}
      </>,
    );
  }
  if (formats.length) lines.push(<><b>{t("docsSuggest.format")}</b> {[...new Set(formats)].join(", ")}</>);
  return lines;
}

const samePiece = (a: string | PMNode, b: string | PMNode) => a === b || (typeof a !== "string" && typeof b !== "string" && a.eq(b));
const samePieces = (a: (string | PMNode)[], b: (string | PMNode)[]) => a.length === b.length && a.every((p, i) => samePiece(p, b[i]));

/** Two readings of a suggestion draw the same card. */
function sameCard(a: Suggestion | null, b: Suggestion | null): boolean {
  if (!a || !b) return a === b;
  return (
    String(a.same) === String(b.same) &&
    samePieces(a.added, b.added) &&
    samePieces(a.removed, b.removed) &&
    a.formats.length === b.formats.length &&
    a.formats.every((f, i) => f.mark.eq(b.formats[i].mark) && f.node.sameMarkup(b.formats[i].node))
  );
}

/** One suggestion's card in the margin: the one the caret stands in shows
    whole, with Accept and Reject for an editor; the others show one line,
    and a press opens them. The layer places it. A card reads its own
    suggestion, and draws again only when what it shows changed. */
export const SuggestionCard = memo(function SuggestionCard({
  editor,
  id,
  canSettle,
}: {
  editor: Editor;
  id: string;
  /** Accept and Reject show: an editor, out of Viewing mode. */
  canSettle: boolean;
}) {
  const { suggestion, active } = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      suggestion: readSuggestions(e.state.doc).find((s) => s.id === id) ?? null,
      active: suggestionAt(e.state) === id,
    }),
    equalityFn: (a, b) => a.active === b?.active && sameCard(a.suggestion, b.suggestion),
  });
  const t = useT();
  const lang = useLang();
  const authorOf = useAuthor();
  if (!suggestion) return null;
  const author = suggestionAuthor(id);
  const person = authorOf(author);
  const lines = describe(suggestion, t);
  const settle = (accept: boolean) => settleSuggestions(editor, accept, id);
  const style = { borderColor: person?.color ?? personColor(author) };
  if (!active) {
    return (
      <div
        data-selection-popover
        data-suggestion-card={id}
        role="button"
        tabIndex={-1}
        aria-label={t("docsSuggest.suggestion")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => focusSuggestion(editor, id)}
        className="docs-comment docs-suggest-card docs-card-line absolute z-30"
        style={style}
      >
        {person && <PersonBadge person={person} size={20} />}
        <span className="docs-card-line-text">
          {person && <b className="docs-comment-name">{person.name}</b>} {lines.map((line, i) => <span key={i}>{line} </span>)}
        </span>
      </div>
    );
  }
  return (
    <div
      data-selection-popover
      data-suggestion-card={id}
      data-active
      role="group"
      aria-label={t("docsSuggest.suggestion")}
      // The caret stays in the suggestion, so the card stays.
      onMouseDown={(e) => e.preventDefault()}
      className="docs-comment docs-suggest-card bubble-in absolute z-40"
      style={style}
    >
      <div className="docs-comment-head">
        {person && <PersonBadge person={person} size={32} />}
        <div className="docs-comment-who">
          {person && <div className="docs-comment-name">{person.name}</div>}
          <div className="docs-comment-time">{replyTime(new Date(suggestionTime(id)).toISOString(), lang)}</div>
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
      {lines.map((line, i) => (
        <p key={i} className="docs-suggest-what">
          {line}
        </p>
      ))}
    </div>
  );
});
