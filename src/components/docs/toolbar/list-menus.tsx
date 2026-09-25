"use client";

import type { Editor } from "@tiptap/react";
import { useT } from "@/components/lang-provider";
import { BulletListIcon, ChecklistIcon, NumberedListIcon } from "@/components/docs/icons";
import { withKeys } from "@/components/docs/keys";
import { keepFocus, MenuItem, MenuSeparator } from "@/components/docs/menu";
import { SplitButton } from "@/components/docs/toolbar/controls";
import {
  applyListPreset,
  BULLET_PRESETS,
  CHECKLIST_PRESETS,
  NUMBER_PRESETS,
  tileRows,
  type ListKind,
  type ListPreset,
} from "@/components/docs/toolbar/lists";

// Checklist, Bulleted list, and Numbered list (SPEC.md §29): the left half
// turns the paragraphs into that list (Ctrl+Shift+9, 8, 7), or back; the
// right half opens Google Docs' presets — a 3 × 2 grid for bullets and for
// numbers, 2 × 1 for checklists — each tile drawing its glyphs level by
// level. The bulleted menu also holds the Checklist menu.

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

function ChecklistPalette({ editor, current, close }: { editor: Editor; current: string | null | undefined; close: () => void }) {
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

function PresetGrid({
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

export function ListButtons({ editor, lists, disabled }: { editor: Editor; lists: ListState; disabled: boolean }) {
  const t = useT();
  const run = (fn: () => boolean) => {
    fn();
    editor.commands.focus();
  };
  return (
    <>
      <SplitButton
        id="checklist"
        label={t("docs.checklist")}
        tip={withKeys(t("docs.checklist"), "Mod+Shift+9")}
        menuLabel={t("docs.checklistMenu")}
        pressed={lists.task}
        disabled={disabled}
        onToggle={() => run(() => editor.chain().focus().toggleTaskList().run())}
        icon={<ChecklistIcon />}
        track="checklist"
      >
        {(close) => <ChecklistPalette editor={editor} current={lists.styles.taskList} close={close} />}
      </SplitButton>
      <SplitButton
        id="bulleted-list"
        label={t("docs.bulletedList")}
        tip={withKeys(t("docs.bulletedList"), "Mod+Shift+8")}
        menuLabel={t("docs.bulletedListMenu")}
        pressed={lists.bullet}
        disabled={disabled}
        onToggle={() => run(() => editor.chain().focus().toggleBulletList().run())}
        icon={<BulletListIcon />}
        track="bulleted-list"
      >
        {(close) => (
          <>
            <PresetGrid editor={editor} presets={BULLET_PRESETS} current={lists.styles.bulletList} close={close} />
            <MenuSeparator />
            <MenuItem
              submenuClassName="docs-menu-lists"
              submenu={<ChecklistPalette editor={editor} current={lists.styles.taskList} close={close} />}
            >
              {t("docs.checklistMenu")}
            </MenuItem>
          </>
        )}
      </SplitButton>
      <SplitButton
        id="numbered-list"
        label={t("docs.numberedList")}
        tip={withKeys(t("docs.numberedList"), "Mod+Shift+7")}
        menuLabel={t("docs.numberedListMenu")}
        pressed={lists.ordered}
        disabled={disabled}
        onToggle={() => run(() => editor.chain().focus().toggleOrderedList().run())}
        icon={<NumberedListIcon />}
        track="numbered-list"
      >
        {(close) => <PresetGrid editor={editor} presets={NUMBER_PRESETS} current={lists.styles.orderedList} close={close} />}
      </SplitButton>
    </>
  );
}
