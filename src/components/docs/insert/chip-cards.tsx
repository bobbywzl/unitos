"use client";

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { useT } from "@/components/lang-provider";
import { DocIcon, LinkIcon } from "@/components/docs/icons";
import { MenuItem } from "@/components/docs/menu";
import { DropBtn } from "@/components/docs/toolbar/controls";
import { insertDropdownChip } from "@/components/docs/insert/actions";
import { documentDropdowns } from "@/components/docs/insert/chips";
import { emitInsert, onInsert, toast, type InsertContext } from "@/components/docs/insert/context";
import { DatePicker } from "@/components/docs/insert/date-picker";
import { DATE_FORMATS, dateLabel, longDayLabel, relativeLabel, today, isoOf, type DateFormat } from "@/components/docs/insert/dates";
import { DropdownChipMenu, DropdownDialog, saveDropdown } from "@/components/docs/insert/dropdown-ui";
import { readOptions, type Dropdown } from "@/components/docs/insert/dropdowns";
import { CalendarIcon, DeleteIcon, SettingsIcon } from "@/components/docs/insert/icons";
import { FloatingBox, useEditorTick, type Anchor } from "@/components/docs/insert/ui";

// The smart chips' cards (SPEC.md §29), as Google Docs shows them on hover
// or selection: a date's day and formats, a person's badge, a document's
// title, a bookmark's link. A press on a dropdown chip lists its options.

type Target = { pos: number; node: PMNode; anchor: Anchor; pinned: boolean };

const CARDS = new Set(["dateChip", "personChip", "fileChip", "bookmark"]);

function targetAt(editor: Editor, pos: number, pinned: boolean): Target | null {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || !CARDS.has(node.type.name)) return null;
  const dom = editor.view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  const r = dom.getBoundingClientRect();
  return { pos, node, anchor: { left: r.left, top: r.top, bottom: r.bottom }, pinned };
}

/** The position of the chip a DOM element draws, or null. */
function chipPos(editor: Editor, chip: HTMLElement): number | null {
  try {
    const pos = editor.view.posAtDOM(chip, 0);
    return editor.state.doc.nodeAt(pos) ? pos : pos - 1;
  } catch {
    return null;
  }
}

export function ChipCardsHost({ editor, ctx }: { editor: Editor; ctx: InsertContext }) {
  useEditorTick(editor);
  const [hover, setHover] = useState<Target | null>(null);
  const [menu, setMenu] = useState<{ pos: number; chip: HTMLElement } | null>(null);
  const hideTimer = useRef<number | null>(null);
  const showTimer = useRef<number | null>(null);
  const editing = useRef(ctx.editing);
  useEffect(() => {
    editing.current = ctx.editing;
  });

  // The chip the selection holds: its card stays while it is selected.
  const sel = editor.state.selection;
  const selected = sel instanceof NodeSelection ? targetAt(editor, sel.from, true) : null;

  useEffect(() => {
    const dom = editor.view.dom;
    const chipOf = (e: MouseEvent) => (e.target as Element | null)?.closest<HTMLElement>(".docs-chip") ?? null;
    const clear = () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (showTimer.current) window.clearTimeout(showTimer.current);
    };
    const onOver = (e: MouseEvent) => {
      const chip = chipOf(e);
      if (!chip) return;
      clear();
      showTimer.current = window.setTimeout(() => {
        const pos = chipPos(editor, chip);
        setHover(pos === null ? null : targetAt(editor, pos, false));
      }, 450);
    };
    const onOut = (e: MouseEvent) => {
      if (!chipOf(e)) return;
      if (showTimer.current) window.clearTimeout(showTimer.current);
      hideTimer.current = window.setTimeout(() => setHover(null), 300);
    };
    const onClick = (e: MouseEvent) => {
      const chip = (e.target as Element | null)?.closest<HTMLElement>(".docs-chip-dropdown");
      const pos = chip && editing.current ? chipPos(editor, chip) : null;
      if (chip && pos !== null) setMenu({ pos, chip });
    };
    dom.addEventListener("mouseover", onOver);
    dom.addEventListener("mouseout", onOut);
    dom.addEventListener("click", onClick);
    return () => {
      clear();
      dom.removeEventListener("mouseover", onOver);
      dom.removeEventListener("mouseout", onOut);
      dom.removeEventListener("click", onClick);
    };
  }, [editor]);

  const target = selected ?? hover;
  return (
    <>
      {target && (
        <ChipCard
          key={`${target.pos}:${target.node.type.name}`}
          editor={editor}
          ctx={ctx}
          target={target}
          onEnter={() => {
            if (hideTimer.current) window.clearTimeout(hideTimer.current);
          }}
          onLeave={
            target.pinned
              ? undefined
              : () => {
                  hideTimer.current = window.setTimeout(() => setHover(null), 300);
                }
          }
          onDone={() => setHover(null)}
        />
      )}
      {menu && <DropdownChipMenu editor={editor} pos={menu.pos} chip={menu.chip} onClose={() => setMenu(null)} />}
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
  const { node, pos } = target;
  const editing = ctx.editing;
  const name = node.type.name;

  const setAttrs = (attrs: Record<string, unknown>) => {
    const current = editor.state.doc.nodeAt(pos);
    if (current?.type.name !== name) return;
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs });
    // The chip stays selected, so its card stays open.
    if (target.pinned) tr.setSelection(NodeSelection.create(tr.doc, pos));
    editor.view.dispatch(tr);
  };
  const row = (icon: ReactNode, title: ReactNode, actions?: ReactNode) => (
    <div className="docs-chip-card-row">
      {icon}
      <span className="docs-chip-card-title">{title}</span>
      {actions}
    </div>
  );

  let body: ReactNode = null;
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
      <>
        <div className="docs-chip-card-row">
          <CalendarIcon />
          <button type="button" className="docs-chip-card-date" disabled={!editing} onClick={() => setPicking(true)} aria-label={t("docsInsert.changeDate")}>
            {longDayLabel(iso, ctx.lang)}
          </button>
          {editing && (
            <DropBtn label={t("docsInsert.dateFormats")} track="date-formats" arrow={false} face={<SettingsIcon />}>
              {(close) => (
                <>
                  {DATE_FORMATS.map((f) => (
                    <MenuItem
                      key={f}
                      checked={f === format}
                      onSelect={() => {
                        close();
                        setAttrs({ format: f, label: dateLabel(iso, f, time, ctx.lang) });
                      }}
                    >
                      {dateLabel("1970-01-01", f, null, ctx.lang)}
                    </MenuItem>
                  ))}
                  {time && (
                    <MenuItem
                      onSelect={() => {
                        close();
                        setAttrs({ time: null, label: dateLabel(iso, format, null, ctx.lang) });
                      }}
                    >
                      {t("docsInsert.noTime")}
                    </MenuItem>
                  )}
                </>
              )}
            </DropBtn>
          )}
        </div>
        <div className="docs-chip-card-sub">{relativeLabel(iso, ctx.lang)}</div>
      </>
    );
  } else if (name === "personChip") {
    const id = String(node.attrs.personId ?? "");
    const person = collab.people[id] ?? {
      id,
      name: String(node.attrs.label ?? ""),
      symbol: String(node.attrs.symbol ?? "?"),
      color: typeof node.attrs.color === "string" ? node.attrs.color : "#647589",
      picture: "",
    };
    body = row(<PersonBadge person={person} size={32} />, person.name);
  } else if (name === "fileChip") {
    const href = typeof node.attrs.href === "string" ? node.attrs.href : "";
    const doc = ctx.documents.find((d) => d.id === node.attrs.documentId);
    body = row(
      <DocIcon size={22} className="docs-at-doc-icon" />,
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) ctx.navigate(href);
        }}
      >
        {doc?.title ?? String(node.attrs.label ?? "")}
      </a>,
    );
  } else {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#bookmark=${String(node.attrs.bookmarkId ?? "")}`;
    body = row(
      null,
      t("docsInsert.bookmark"),
      <>
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
              editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
              onDone();
            }}
          >
            <DeleteIcon size={18} />
          </button>
        )}
      </>,
    );
  }
  return (
    <FloatingBox anchor={target.anchor} className="docs-chip-card" onMouseEnter={onEnter} onMouseLeave={onLeave}>
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
        if (!event.dropdownId) return setOpen({ id: null, name: "", options: [] });
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
