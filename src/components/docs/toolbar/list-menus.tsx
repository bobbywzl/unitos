"use client";

import type { Editor } from "@tiptap/react";
import { useT } from "@/components/lang-provider";
import { keepFocus } from "@/components/docs/menu";
import { applyListPreset, CHECKLIST_PRESETS, tileRows, type ListKind, type ListPreset } from "@/components/docs/toolbar/lists";

// The list buttons' palettes (SPEC.md §29): Google Docs' presets — a 3 × 2
// grid for bullets and for numbers, 2 × 1 for checklists — each tile
// drawing its glyphs level by level.

export type ListState = {
  bullet: boolean;
  ordered: boolean;
  task: boolean;
  /** Each kind's preset around the selection: undefined outside such a list. */
  styles: Record<ListKind, string | null | undefined>;
};

function Tile({ preset, on, onPick }: { preset: ListPreset; on: boolean; onPick: () => void }) {
  const rows = tileRows(preset);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      aria-label={rows
        .filter((r, i) => i < 4)
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
