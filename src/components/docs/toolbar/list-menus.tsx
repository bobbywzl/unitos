"use client";

import type { Editor } from "@tiptap/react";
import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { keepFocus } from "@/components/docs/menu";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { applyListPreset, CHECKLIST_PRESETS, restartNumbering, tileRows, type ListPreset } from "@/components/docs/toolbar/lists";

// The list buttons' palettes (SPEC.md §29): Google Docs' presets — a 3 × 2
// grid for bullets and for numbers, 2 × 1 for checklists — each tile
// drawing its glyphs level by level. And List options > Restart numbering,
// which asks for the number.

function Tile({ preset, on, onPick }: { preset: ListPreset; on: boolean; onPick: () => void }) {
  const rows = tileRows(preset);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      aria-label={rows
        .slice(0, 4)
        .map((r) => r.glyph)
        .join(" ")}
      data-menu-item
      tabIndex={-1}
      onMouseDown={keepFocus}
      onClick={onPick}
      className="docs-list-tile"
    >
      <span className="docs-list-tile-face">
        {rows.map((r, i) => (
          <span key={i} className="docs-list-tile-row" style={{ paddingLeft: r.level * 9 }}>
            <span>{r.glyph}</span>
            <span className="docs-list-tile-bar" />
          </span>
        ))}
      </span>
    </button>
  );
}

export function ChecklistPalette({ editor, current, close }: { editor: Editor; current: string | null | undefined; close: () => void }) {
  const t = useT();
  return (
    <div className="docs-list-grid" data-grid-cols={2} role="group">
      {CHECKLIST_PRESETS.map((p) => (
        <button
          key={p.label}
          type="button"
          role="menuitemradio"
          aria-checked={current !== undefined && current === p.style}
          aria-label={t(p.label)}
          data-tip={t(p.label)}
          data-menu-item
          tabIndex={-1}
          onMouseDown={keepFocus}
          onClick={() => {
            close();
            applyListPreset(editor, "taskList", p.style);
          }}
          className="docs-list-tile docs-list-tile-check"
        >
          <span className="docs-list-tile-face">
            <span className="docs-list-tile-row">
              <span className="docs-list-tile-box" />
              <span className="docs-list-tile-bar" />
            </span>
            <span className="docs-list-tile-row" data-strike={p.style === null ? "" : undefined}>
              <span className="docs-list-tile-box" data-checked="" />
              <span className="docs-list-tile-bar" />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function PresetGrid({
  editor,
  presets,
  current,
  close,
}: {
  editor: Editor;
  presets: ListPreset[];
  current: string | null | undefined;
  close: () => void;
}) {
  return (
    <div className="docs-list-grid" data-grid-cols={3} role="group">
      {presets.map((p) => (
        <Tile
          key={p.style ?? "default"}
          preset={p}
          on={current !== undefined && current === p.style}
          onPick={() => {
            close();
            applyListPreset(editor, p.kind, p.style);
          }}
        />
      ))}
    </div>
  );
}

/** List options > Restart numbering: the caret's line starts the list again
    at the typed number. */
export function RestartNumberingDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const [value, setValue] = useState("1");
  const n = /^\d{1,4}$/.test(value.trim()) ? Number(value) : 0;
  const apply = () => {
    if (n < 1) return;
    restartNumbering(n)(editor.state, editor.view.dispatch);
    onClose();
  };
  return (
    <ToolbarDialog
      title={t("docs.numbering")}
      onClose={onClose}
      className="docs-fields-dialog"
      actions={
        <>
          <DialogButton onClick={onClose}>{t("docs.cancel")}</DialogButton>
          <DialogButton primary disabled={n < 1} onClick={apply}>
            {t("docs.ok")}
          </DialogButton>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label>
          <span className="docs-tb-label">{t("docs.restartNumberingAt")}</span>
          <input
            className="docs-tb-field"
            inputMode="numeric"
            maxLength={4}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      </form>
    </ToolbarDialog>
  );
}
