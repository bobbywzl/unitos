"use client";

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { CheckIcon, DocIcon, LinkIcon } from "@/components/docs/icons";
import { Avatar } from "@/components/docs/insert/at-menu";
import { emitInsert, onInsert, toast, type InsertContext } from "@/components/docs/insert/context";
import { DatePicker } from "@/components/docs/insert/date-picker";
import { DATE_FORMATS, dateLabel, longDayLabel, relativeLabel, today, isoOf, type DateFormat } from "@/components/docs/insert/dates";
import { chooseOption, DropdownChipMenu, DropdownDialog, saveDropdown } from "@/components/docs/insert/dropdown-ui";
import { readOptions, type Dropdown } from "@/components/docs/insert/dropdowns";
import { insertDropdownChip } from "@/components/docs/insert/actions";
import { documentDropdowns } from "@/components/docs/insert/chips";
import { CalendarIcon, DeleteIcon, SettingsIcon } from "@/components/docs/insert/icons";
import { FloatingBox, useEditorTick, type Anchor } from "@/components/docs/insert/ui";

// The smart chips' cards (SPEC.md §29), as Google Docs shows them on hover
// or selection: a date's day and formats, a person's badge, a document's
// title, a dropdown's options, a bookmark's link.

type Target = { pos: number; node: PMNode; anchor: Anchor; pinned: boolean };

const CHIPS = new Set(["dateChip", "personChip", "fileChip", "dropdownChip", "bookmark"]);

function targetAt(editor: Editor, pos: number, pinned: boolean): Target | null {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || !CHIPS.has(node.type.name)) return null;
  const dom = editor.view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  const r = dom.getBoundingClientRect();
  return { pos, node, anchor: { left: r.left, top: r.top, bottom: r.bottom }, pinned };
}

export function ChipCardsHost({ editor, ctx }: { editor: Editor; ctx: InsertContext }) {
  useEditorTick(editor);
  const [hover, setHover] = useState<Target | null>(null);
  const hideTimer = useRef<number | null>(null);
  const showTimer = useRef<number | null>(null);

  // The chip the selection holds: its card stays while it is selected.
  const sel = editor.state.selection;
  const selected =
    sel instanceof NodeSelection && CHIPS.has(sel.node.type.name) ? targetAt(editor, sel.from, true) : null;

  useEffect(() => {
    const dom = editor.view.dom;
    const clear = () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (showTimer.current) window.clearTimeout(showTimer.current);
    };
    const onOver = (e: MouseEvent) => {
      const chip = (e.target as Element | null)?.closest<HTMLElement>(".docs-chip");
      if (!chip) return;
      clear();
      showTimer.current = window.setTimeout(() => {
        try {
          const pos = editor.view.posAtDOM(chip, 0);
          const exact = editor.state.doc.nodeAt(pos) ? pos : pos - 1;
          setHover(targetAt(editor, exact, false));
        } catch {
          setHover(null);
        }
      }, 450);
    };
    const onOut = (e: MouseEvent) => {
      const chip = (e.target as Element | null)?.closest(".docs-chip");
      if (!chip) return;
      if (showTimer.current) window.clearTimeout(showTimer.current);
      hideTimer.current = window.setTimeout(() => setHover(null), 300);
    };
    dom.addEventListener("mouseover", onOver);
    dom.addEventListener("mouseout", onOut);
    return () => {
      clear();
      dom.removeEventListener("mouseover", onOver);
      dom.removeEventListener("mouseout", onOut);
    };
  }, [editor]);

  const keep = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
  };
  const leave = () => {
    hideTimer.current = window.setTimeout(() => setHover(null), 300);
  };

  const target = selected ?? hover;
  return (
    <>
      {target && (
        <ChipCard
          key={`${target.pos}:${target.node.type.name}`}
          editor={editor}
          ctx={ctx}
          target={target}
          onEnter={keep}
          onLeave={target.pinned ? undefined : leave}
          onDone={() => setHover(null)}
        />
      )}
      <DropdownDialogHost editor={editor} />
    </>
  );
}

function ChipCard({
  editor,
  ctx,
  target,
  onEnter,
  onLeave,
  onDone,
}: {
  editor: Editor;
  ctx: InsertContext;
  target: Target;
  onEnter: () => void;
  onLeave?: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const collab = useCollab();
  const [picking, setPicking] = useState(false);
  const [formats, setFormats] = useState(false);
  const { node, pos } = target;
  const editing = ctx.editing;
  const name = node.type.name;

  const setAttrs = useCallback(
    (attrs: Record<string, unknown>) => {
      const current = editor.state.doc.nodeAt(pos);
      if (!current || current.type.name !== name) return;
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs });
      editor.view.dispatch(tr);
    },
    [editor, pos, name],
  );

  let body: React.ReactNode = null;
  if (name === "dateChip") {
    const iso = typeof node.attrs.date === "string" ? node.attrs.date : isoOf(today());
    const format = (DATE_FORMATS.includes(node.attrs.format as DateFormat) ? node.attrs.format : "mdy") as DateFormat;
    const time = typeof node.attrs.time === "string" ? node.attrs.time : null;
    body = picking ? (
      <DatePicker
        initial={iso}
        initialTime={time}
        onPick={(nextIso, nextTime) => {
          setAttrs({ date: nextIso, time: nextTime, label: dateLabel(nextIso, format, nextTime, ctx.lang) });
          setPicking(false);
          editor.view.focus();
        }}
      />
    ) : (
      <div className="docs-chip-card-body">
        <div className="docs-chip-card-row">
          <CalendarIcon size={20} />
          <button type="button" className="docs-chip-card-date" disabled={!editing} onClick={() => setPicking(true)} aria-label={t("docsInsert.changeDate")}>
            {longDayLabel(iso, ctx.lang)}
          </button>
          {editing && (
            <button
              type="button"
              className="docs-icon-btn"
              aria-label={t("docsInsert.dateFormats")}
              data-tip={t("docsInsert.dateFormats")}
              aria-pressed={formats}
              onClick={() => setFormats((f) => !f)}
            >
              <SettingsIcon size={18} />
            </button>
          )}
        </div>
        <div className="docs-chip-card-sub">{relativeLabel(iso, ctx.lang)}</div>
        {formats && (
          <div className="docs-chip-formats" role="menu">
            {DATE_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                role="menuitemradio"
                aria-checked={f === format}
                className={`docs-dd-option${f === format ? " is-on" : ""}`}
                onClick={() => setAttrs({ format: f, label: dateLabel(iso, f, time, ctx.lang) })}
              >
                <span className="docs-dd-check">{f === format ? <CheckIcon size={18} /> : null}</span>
                {dateLabel("1970-01-01", f, null, ctx.lang)}
              </button>
            ))}
            {time && (
              <button type="button" className="docs-dd-option" onClick={() => setAttrs({ time: null, label: dateLabel(iso, format, null, ctx.lang) })}>
                <span className="docs-dd-check" />
                {t("docsInsert.noTime")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  } else if (name === "personChip") {
    const person = collab.people[String(node.attrs.personId)];
    const shown = person ?? {
      name: String(node.attrs.label ?? ""),
      symbol: String(node.attrs.symbol ?? "?"),
      color: typeof node.attrs.color === "string" ? node.attrs.color : "#647589",
      picture: "",
    };
    body = (
      <div className="docs-chip-card-row">
        <Avatar person={shown} size={32} />
        <span className="docs-chip-card-title">{shown.name}</span>
      </div>
    );
  } else if (name === "fileChip") {
    const href = typeof node.attrs.href === "string" ? node.attrs.href : "";
    const doc = ctx.documents.find((d) => d.id === node.attrs.documentId);
    body = (
      <div className="docs-chip-card-row">
        <DocIcon size={22} className="docs-at-doc-icon" />
        <a
          className="docs-chip-card-title"
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (href) ctx.navigate(href);
          }}
        >
          {doc?.title ?? String(node.attrs.label ?? "")}
        </a>
      </div>
    );
  } else if (name === "dropdownChip") {
    if (!target.pinned) return null;
    const options = readOptions(node.attrs.dropdownOptions);
    body = (
      <DropdownChipMenu
        options={options}
        current={String(node.attrs.label ?? "")}
        onChoose={(option) => {
          if (!editing) return;
          chooseOption(editor, pos, option);
          onDone();
        }}
        onEdit={() => {
          if (!editing) return;
          emitInsert(editor, { type: "dropdown-dialog", dropdownId: String(node.attrs.dropdownId ?? "") });
        }}
      />
    );
  } else if (name === "bookmark") {
    const id = String(node.attrs.bookmarkId ?? "");
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#bookmark=${id}`;
    body = (
      <div className="docs-chip-card-row">
        <span className="docs-chip-card-title">{t("docsInsert.bookmark")}</span>
        <button
          type="button"
          className="docs-icon-btn"
          aria-label={t("docs.copyLink")}
          data-tip={t("docs.copyLink")}
          onClick={() => void navigator.clipboard.writeText(url).then(() => toast(t("docs.linkCopied")), () => emitInsert(editor, { type: "clipboard-blocked" }))}
        >
          <LinkIcon size={18} />
        </button>
        {editing && (
          <button
            type="button"
            className="docs-icon-btn"
            aria-label={t("docsInsert.removeBookmark")}
            data-tip={t("docsInsert.removeBookmark")}
            onClick={() => {
              const current = editor.state.doc.nodeAt(pos);
              if (current?.type.name === "bookmark") editor.chain().focus().deleteRange({ from: pos, to: pos + current.nodeSize }).run();
              onDone();
            }}
          >
            <DeleteIcon size={18} />
          </button>
        )}
      </div>
    );
  }
  return (
    <FloatingBox
      anchor={target.anchor}
      className={`docs-chip-card docs-chip-card-${name}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {body}
    </FloatingBox>
  );
}

/** The Dropdown options dialog: a new dropdown (inserted at the caret) or
    one of the document's (saved onto every chip that has it). */
function DropdownDialogHost({ editor }: { editor: Editor }) {
  const t = useT();
  const [open, setOpen] = useState<Dropdown | null>(null);
  useEffect(
    () =>
      onInsert(editor, (event) => {
        if (event.type !== "dropdown-dialog") return;
        if (!event.dropdownId) {
          setOpen({ id: null, name: "", options: [] });
          return;
        }
        const found = documentDropdowns(editor.state.doc).find((d) => d.id === event.dropdownId);
        if (found) setOpen({ id: found.id, name: found.name, options: readOptions(found.options) });
      }),
    [editor],
  );
  if (!open) return null;
  return (
    <DropdownDialog
      initial={open}
      onClose={() => {
        setOpen(null);
        editor.view.focus();
      }}
      onSave={(dropdown) => {
        setOpen(null);
        if (open.id === null) insertDropdownChip(editor, { ...dropdown, name: dropdown.name || t("docsInsert.itemDropdown") });
        else saveDropdown(editor, dropdown);
        editor.view.focus();
      }}
    />
  );
}
