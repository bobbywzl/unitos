"use client";

import type { Editor } from "@tiptap/core";
import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { AddIcon, CheckIcon, EditIcon } from "@/components/docs/icons";
import { DeleteIcon, DragIcon } from "@/components/docs/insert/icons";
import { documentDropdowns, dropdownChips } from "@/components/docs/insert/chips";
import {
  DROPDOWN_COLORS,
  DROPDOWN_PRESETS,
  newDropdownId,
  optionColor,
  optionTextColor,
  readOptions,
  writeOptions,
  type DropdownOption,
} from "@/components/docs/insert/dropdowns";
import { Dialog } from "@/components/docs/insert/ui";
import type { TFunc } from "@/lib/i18n/dictionaries";

// Dropdown chips' windows (SPEC.md §29), as Google Docs draws them: the
// picker (New dropdown, the document's dropdowns, the presets, each
// showing its options on hover), the chip's own menu (its options as
// colored pills, a check on the current one, Add / Edit options), and the
// Dropdown options dialog (a template name, one row per option with its
// color, New option, Cancel and Save).

export type Dropdown = { id: string | null; name: string; options: DropdownOption[] };

export function presetDropdowns(t: TFunc): Dropdown[] {
  return DROPDOWN_PRESETS.map((p) => ({
    id: null,
    name: t(p.name),
    options: p.options.map((o) => ({ label: t(o.label), color: o.color })),
  }));
}

export function OptionPill({ option, selected }: { option: DropdownOption; selected?: boolean }) {
  const color = optionColor(option.color);
  return (
    <span className="docs-option-pill" style={{ backgroundColor: color, color: optionTextColor(color) }}>
      {selected && <CheckIcon size={14} />}
      {option.label}
    </span>
  );
}

export function DropdownPicker({
  editor,
  onPick,
  onNew,
  onEdit,
}: {
  editor: Editor;
  onPick: (dropdown: Dropdown) => void;
  onNew: () => void;
  onEdit: (dropdownId: string) => void;
}) {
  const t = useT();
  const mine: Dropdown[] = documentDropdowns(editor.state.doc).map((d) => ({ id: d.id, name: d.name, options: readOptions(d.options) }));
  const presets = presetDropdowns(t);
  const [hover, setHover] = useState<Dropdown | null>(null);
  const row = (d: Dropdown, key: string) => (
    <div key={key} className="docs-dd-row" onMouseEnter={() => setHover(d)}>
      <button type="button" className="docs-at-row docs-dd-pick" onClick={() => onPick(d)}>
        <span className="docs-at-label">{d.name || t("docsInsert.itemDropdown")}</span>
      </button>
      {d.id && (
        <button
          type="button"
          className="docs-icon-btn docs-dd-edit"
          aria-label={t("docsInsert.editDropdown")}
          data-tip={t("docsInsert.editDropdown")}
          onClick={() => onEdit(d.id as string)}
        >
          <EditIcon size={16} />
        </button>
      )}
    </div>
  );
  return (
    <div className="docs-dd-picker" onMouseLeave={() => setHover(null)}>
      <div className="docs-dd-list">
        <button type="button" className="docs-at-row docs-dd-new" onClick={onNew} onMouseEnter={() => setHover(null)}>
          <span className="docs-at-icon">
            <AddIcon size={20} />
          </span>
          <span className="docs-at-label">{t("docsInsert.newDropdown")}</span>
        </button>
        {mine.length > 0 && <div className="docs-at-section">{t("docsInsert.documentDropdowns")}</div>}
        {mine.map((d) => row(d, d.id ?? d.name))}
        <div className="docs-at-section">{t("docsInsert.presetDropdowns")}</div>
        {presets.map((d, i) => row(d, `preset-${i}`))}
      </div>
      {hover && (
        <div className="docs-dd-preview">
          <div className="docs-at-section">{t("docsInsert.dropdownOptions")}</div>
          <div className="docs-dd-pills">
            {hover.options.map((o, i) => (
              <OptionPill key={i} option={o} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The chip's menu: each option, the current one checked, then Add / Edit options. */
export function DropdownChipMenu({
  options,
  current,
  onChoose,
  onEdit,
}: {
  options: DropdownOption[];
  current: string;
  onChoose: (option: DropdownOption) => void;
  onEdit: () => void;
}) {
  const t = useT();
  return (
    <div className="docs-dd-menu" role="menu">
      {options.map((o, i) => (
        <button key={i} type="button" role="menuitemradio" aria-checked={o.label === current} className="docs-dd-option" onClick={() => onChoose(o)}>
          <span className="docs-dd-check">{o.label === current ? <CheckIcon size={18} /> : null}</span>
          <OptionPill option={o} />
        </button>
      ))}
      <div className="docs-menu-sep" />
      <button type="button" role="menuitem" className="docs-dd-option docs-dd-addedit" onClick={onEdit}>
        <span className="docs-dd-check">
          <AddIcon size={18} />
        </span>
        {t("docsInsert.addEditOptions")}
      </button>
    </div>
  );
}

/** Set the chip at `pos` to an option. */
export function chooseOption(editor: Editor, pos: number, option: DropdownOption) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "dropdownChip") return;
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: option.label, backgroundColor: optionColor(option.color) });
  editor.view.dispatch(tr);
  editor.view.focus();
}

/** Save a dropdown's options onto every chip that has it; a chip whose
    option is gone shows the first. */
export function saveDropdown(editor: Editor, dropdown: Dropdown & { id: string }) {
  const options = dropdown.options.filter((o) => o.label.trim());
  if (options.length === 0) return;
  const tr = editor.state.tr;
  for (const { node, pos } of dropdownChips(editor.state.doc, dropdown.id)) {
    const kept = options.find((o) => o.label === node.attrs.label) ?? options[0];
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      name: dropdown.name,
      dropdownOptions: writeOptions(options),
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
  const [colorFor, setColorFor] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const set = (i: number, patch: Partial<DropdownOption>) => setOptions((list) => list.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const canSave = options.some((o) => o.label.trim());
  return (
    <Dialog
      title={t("docsInsert.dropdownOptions")}
      onClose={onClose}
      className="docs-dd-dialog"
      actions={
        <>
          <button type="button" className="docs-button-outline" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="docs-button-outline docs-button-blue"
            disabled={!canSave}
            onClick={() => onSave({ id: initial.id ?? newDropdownId(), name: name.trim(), options: options.filter((o) => o.label.trim()) })}
          >
            {t("docsInsert.save")}
          </button>
        </>
      }
    >
      <label className="docs-outlined-field">
        <span>{t("docsInsert.templateName")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <ol className="docs-dd-options">
        {options.map((o, i) => (
          <li
            key={i}
            className={`docs-dd-option-row${dragging === i ? " is-dragging" : ""}`}
            onDragOver={(e) => {
              if (dragging === null) return;
              e.preventDefault();
              if (dragging !== i) {
                setOptions((list) => {
                  const next = [...list];
                  const [moved] = next.splice(dragging, 1);
                  next.splice(i, 0, moved);
                  return next;
                });
                setDragging(i);
              }
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
            <span className="docs-dd-color-wrap">
              <button
                type="button"
                className="docs-dd-color"
                aria-label={t("docsInsert.optionColor")}
                data-tip={t("docsInsert.optionColor")}
                style={{ backgroundColor: optionColor(o.color) }}
                onClick={() => setColorFor(colorFor === i ? null : i)}
              />
              {colorFor === i && (
                <div className="docs-dd-colors" role="menu">
                  <div className="docs-at-section">{t("docsInsert.colors")}</div>
                  <div className="docs-dd-color-grid">
                    {DROPDOWN_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`docs-dd-swatch${optionColor(o.color) === c ? " is-on" : ""}`}
                        style={{ backgroundColor: c }}
                        aria-label={c}
                        onClick={() => {
                          set(i, { color: c });
                          setColorFor(null);
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </span>
            <input
              className="docs-field docs-dd-label"
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
        className="docs-text-btn docs-dd-add"
        onClick={() =>
          setOptions((list) => [
            ...list,
            { label: t("docsInsert.optionN", { n: list.length + 1 }), color: DROPDOWN_COLORS[list.length % 8] },
          ])
        }
      >
        <AddIcon size={18} />
        {t("docsInsert.newOption")}
      </button>
    </Dialog>
  );
}
