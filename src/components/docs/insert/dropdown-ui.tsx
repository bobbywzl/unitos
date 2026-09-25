"use client";

import type { Editor } from "@tiptap/core";
import { useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { AddIcon, EditIcon } from "@/components/docs/icons";
import { DropdownPanel, MenuHeader, MenuItem, MenuSeparator } from "@/components/docs/menu";
import { DropBtn } from "@/components/docs/toolbar/controls";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { documentDropdowns, dropdownChips } from "@/components/docs/insert/chips";
import { emitInsert } from "@/components/docs/insert/context";
import {
  DROPDOWN_COLORS,
  optionColor,
  optionTextColor,
  presetDropdowns,
  readOptions,
  writeOptions,
  type Dropdown,
  type DropdownOption,
} from "@/components/docs/insert/dropdowns";
import { DeleteIcon, DragIcon } from "@/components/docs/insert/icons";
import { newBlockId } from "@/lib/docs/schema";

// Dropdown chips' windows (SPEC.md §29), as Google Docs draws them: the
// picker, the chip's menu of options, and the Dropdown options dialog.

function OptionPill({ option }: { option: DropdownOption }) {
  const color = optionColor(option.color);
  return (
    <span className="docs-option-pill" style={{ backgroundColor: color, color: optionTextColor(color) }}>
      {option.label}
    </span>
  );
}

/** New dropdown, the document's dropdowns, and the presets; resting on one
    shows its options beside the list. `onEdit(null)` is New dropdown. */
export function DropdownPicker({
  editor,
  onPick,
  onEdit,
}: {
  editor: Editor;
  onPick: (dropdown: Dropdown) => void;
  onEdit: (dropdownId: string | null) => void;
}) {
  const t = useT();
  const mine: Dropdown[] = documentDropdowns(editor.state.doc).map((d) => ({ id: d.id, name: d.name, options: readOptions(d.options) }));
  const [hover, setHover] = useState<Dropdown | null>(null);
  const row = (d: Dropdown, key: string) => (
    <div key={key} className="docs-dd-row" onMouseEnter={() => setHover(d)}>
      <button type="button" className="docs-at-row" onClick={() => onPick(d)}>
        <span className="docs-at-label">{d.name || t("docsInsert.itemDropdown")}</span>
      </button>
      {d.id && (
        <button
          type="button"
          className="docs-icon-btn"
          aria-label={t("docsInsert.editDropdown")}
          data-tip={t("docsInsert.editDropdown")}
          onClick={() => onEdit(d.id)}
        >
          <EditIcon size={16} />
        </button>
      )}
    </div>
  );
  return (
    <div className="docs-dd-picker" onMouseLeave={() => setHover(null)}>
      <div className="docs-dd-list">
        <button type="button" className="docs-at-row docs-dd-new" onClick={() => onEdit(null)} onMouseEnter={() => setHover(null)}>
          <span className="docs-at-icon">
            <AddIcon />
          </span>
          <span className="docs-at-label">{t("docsInsert.newDropdown")}</span>
        </button>
        {mine.length > 0 && <div className="docs-at-section">{t("docsInsert.documentDropdowns")}</div>}
        {mine.map((d) => row(d, d.id ?? d.name))}
        <div className="docs-at-section">{t("docsInsert.presetDropdowns")}</div>
        {presetDropdowns(t).map((d, i) => row(d, `preset-${i}`))}
      </div>
      {hover && (
        <div className="docs-dd-preview">
          <div className="docs-at-section">{t("docsInsert.dropdownOptions")}</div>
          {hover.options.map((o, i) => (
            <OptionPill key={i} option={o} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A dropdown chip's menu under the chip: each option, the chip's checked,
    then Add / Edit options. */
export function DropdownChipMenu({ editor, pos, chip, onClose }: { editor: Editor; pos: number; chip: HTMLElement; onClose: () => void }) {
  const t = useT();
  const anchorRef = useRef(chip);
  const node = editor.state.doc.nodeAt(pos);
  if (node?.type.name !== "dropdownChip") return null;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <DropdownPanel open anchorRef={anchorRef} onClose={onClose} label={String(node.attrs.name ?? "")}>
      {readOptions(node.attrs.dropdownOptions).map((o, i) => (
        <MenuItem
          key={i}
          checked={o.label === node.attrs.label}
          onSelect={run(() => {
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: o.label, backgroundColor: o.color }));
            editor.view.focus();
          })}
        >
          <OptionPill option={o} />
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem
        icon={<AddIcon size={18} />}
        className="docs-dd-addedit"
        onSelect={run(() => emitInsert(editor, { type: "dropdown-dialog", dropdownId: String(node.attrs.dropdownId ?? "") }))}
      >
        {t("docsInsert.addEditOptions")}
      </MenuItem>
    </DropdownPanel>
  );
}

/** Save a dropdown's options onto every chip that has it; a chip whose
    option is gone shows the first. */
export function saveDropdown(editor: Editor, dropdown: Dropdown & { id: string }) {
  const tr = editor.state.tr;
  for (const { node, pos } of dropdownChips(editor.state.doc, dropdown.id)) {
    const kept = dropdown.options.find((o) => o.label === node.attrs.label) ?? dropdown.options[0];
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      name: dropdown.name,
      dropdownOptions: writeOptions(dropdown.options),
      label: kept.label,
      backgroundColor: optionColor(kept.color),
    });
  }
  editor.view.dispatch(tr);
}

export function DropdownDialog({
  initial,
  onSave,
  onClose,
}: {
  initial: Dropdown;
  onSave: (dropdown: Dropdown & { id: string }) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial.name);
  const [options, setOptions] = useState<DropdownOption[]>(
    initial.options.length > 0 ? initial.options : [{ label: t("docsInsert.optionN", { n: 1 }), color: DROPDOWN_COLORS[0] }],
  );
  const [dragging, setDragging] = useState<number | null>(null);
  const set = (i: number, patch: Partial<DropdownOption>) => setOptions((list) => list.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const kept = options.filter((o) => o.label.trim());
  return (
    <ToolbarDialog
      title={t("docsInsert.dropdownOptions")}
      onClose={onClose}
      className="docs-dd-dialog"
      actions={
        <>
          <DialogButton onClick={onClose}>{t("common.cancel")}</DialogButton>
          <DialogButton primary disabled={kept.length === 0} onClick={() => onSave({ id: initial.id ?? newBlockId(), name: name.trim(), options: kept })}>
            {t("common.save")}
          </DialogButton>
        </>
      }
    >
      <label className="docs-outlined-field">
        <span>{t("docsInsert.templateName")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <ol className="docs-dd-options">
        {options.map((o, i) => (
          <li
            key={i}
            className={dragging === i ? "is-dragging" : undefined}
            onDragOver={(e) => {
              if (dragging === null) return;
              e.preventDefault();
              if (dragging === i) return;
              setOptions((list) => {
                const next = [...list];
                const [moved] = next.splice(dragging, 1);
                next.splice(i, 0, moved);
                return next;
              });
              setDragging(i);
            }}
          >
            <span
              className="docs-dd-drag"
              draggable
              aria-label={t("docsInsert.dragOption")}
              data-tip={t("docsInsert.dragOption")}
              onDragStart={(e) => {
                setDragging(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragEnd={() => setDragging(null)}
            >
              <DragIcon size={18} />
            </span>
            <DropBtn
              label={t("docsInsert.optionColor")}
              track="dropdown-option-color"
              menuClassName="docs-dd-colors"
              face={<span className="docs-dd-swatch" style={{ backgroundColor: optionColor(o.color) }} />}
            >
              {(close) => (
                <>
                  <MenuHeader>{t("docsInsert.colors")}</MenuHeader>
                  <div className="docs-dd-swatches" data-grid-cols={8}>
                    {DROPDOWN_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="menuitemradio"
                        aria-checked={optionColor(o.color) === c}
                        aria-label={c}
                        data-menu-item
                        tabIndex={-1}
                        className="docs-dd-swatch"
                        style={{ backgroundColor: c }}
                        onClick={() => {
                          close();
                          set(i, { color: c });
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </DropBtn>
            <input
              className="docs-field"
              value={o.label}
              onChange={(e) => set(i, { label: e.target.value })}
              aria-label={t("docsInsert.optionN", { n: i + 1 })}
            />
            <button
              type="button"
              className="docs-icon-btn"
              aria-label={t("docsInsert.deleteOption")}
              data-tip={t("docsInsert.deleteOption")}
              disabled={options.length === 1}
              onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}
            >
              <DeleteIcon size={18} />
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="docs-text-btn"
        onClick={() =>
          setOptions((list) => [...list, { label: t("docsInsert.optionN", { n: list.length + 1 }), color: DROPDOWN_COLORS[list.length % 8] }])
        }
      >
        <AddIcon size={18} />
        {t("docsInsert.newOption")}
      </button>
    </ToolbarDialog>
  );
}
