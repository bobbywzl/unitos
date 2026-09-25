"use client";

import type { Editor } from "@tiptap/react";
import { useState } from "react";
import { useT } from "@/components/lang-provider";
import type { ParagraphFlag } from "@/components/docs/ext/toolbar";
import { LineSpacingIcon } from "@/components/docs/icons";
import { MenuItem, MenuSeparator } from "@/components/docs/menu";
import { DropBtn } from "@/components/docs/toolbar/controls";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";

// Line & paragraph spacing (SPEC.md §29): Single, 1.15, 1.5, Double, and
// Custom: N for any other value; add or remove the space before and after
// the paragraph (add is 10 pt, remove is 0); Custom spacing; and, on pages,
// Keep with next, Keep lines together, Prevent single lines, and Add page
// break before. A value equal to the named style's is stored as none, so
// the paragraph follows its style.

export type ParagraphState = {
  lineSpacing: number;
  spaceBefore: number;
  spaceAfter: number;
  /** The named style's values, for "same as the style". */
  styleLineSpacing: number;
  styleSpaceBefore: number;
  styleSpaceAfter: number;
  inList: boolean;
  flags: Record<ParagraphFlag, boolean>;
  styleFlags: Record<ParagraphFlag, boolean>;
};

const STANDARD = [
  { value: 1, key: "docs.spacingSingle" },
  { value: 1.15, key: "docs.spacing115" },
  { value: 1.5, key: "docs.spacing15" },
  { value: 2, key: "docs.spacingDouble" },
] as const;

const FLAGS: { flag: ParagraphFlag; key: "docs.keepWithNext" | "docs.keepLinesTogether" | "docs.preventSingleLines" | "docs.pageBreakBefore" }[] = [
  { flag: "keepWithNext", key: "docs.keepWithNext" },
  { flag: "keepLinesTogether", key: "docs.keepLinesTogether" },
  { flag: "preventSingleLines", key: "docs.preventSingleLines" },
  { flag: "pageBreakBefore", key: "docs.pageBreakBefore" },
];

const same = (a: number, b: number) => Math.abs(a - b) < 0.001;

/** A line spacing's "Custom: N": rounded to two decimals. */
function customLabel(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function setLineSpacing(editor: Editor, p: ParagraphState, value: number) {
  editor.chain().focus().setLineSpacing(same(value, p.styleLineSpacing) ? null : value).run();
}

export function setSpace(editor: Editor, p: ParagraphState, side: "before" | "after", pt: number) {
  const styleValue = side === "before" ? p.styleSpaceBefore : p.styleSpaceAfter;
  editor.chain().focus().setParagraphSpace(side, same(pt, styleValue) ? null : pt).run();
}

export function toggleFlag(editor: Editor, p: ParagraphState, flag: ParagraphFlag) {
  const next = !p.flags[flag];
  editor.chain().focus().setParagraphFlag(flag, next === p.styleFlags[flag] ? null : next).run();
}

export function SpacingMenu({
  editor,
  para,
  pageless,
}: {
  editor: Editor;
  para: ParagraphState;
  pageless: boolean;
}) {
  const t = useT();
  const [dialog, setDialog] = useState(false);
  const custom = !STANDARD.some((s) => same(s.value, para.lineSpacing));
  const before = para.spaceBefore > 0;
  const after = para.spaceAfter > 0;
  return (
    <>
      <DropBtn
        id="line-spacing"
        label={t("docs.lineSpacing")}
        track="line-spacing"
        arrow={false}
        className="docs-tb-menu-btn"
        face={<LineSpacingIcon />}
      >
        {(close) => (
          <>
            {STANDARD.map((s) => (
              <MenuItem
                key={s.value}
                checked={same(s.value, para.lineSpacing)}
                onSelect={() => {
                  close();
                  setLineSpacing(editor, para, s.value);
                }}
                track={`docs:line-spacing:${s.value}`}
              >
                {t(s.key)}
              </MenuItem>
            ))}
            {custom && (
              <MenuItem checked onSelect={close}>
                {t("docs.spacingCustomValue", { n: customLabel(para.lineSpacing) })}
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem
              onSelect={() => {
                close();
                setSpace(editor, para, "before", before ? 0 : 10);
              }}
              track="docs:space-before"
            >
              {t(
                para.inList
                  ? before
                    ? "docs.removeSpaceBeforeItem"
                    : "docs.addSpaceBeforeItem"
                  : before
                    ? "docs.removeSpaceBefore"
                    : "docs.addSpaceBefore",
              )}
            </MenuItem>
            <MenuItem
              onSelect={() => {
                close();
                setSpace(editor, para, "after", after ? 0 : 10);
              }}
              track="docs:space-after"
            >
              {t(
                para.inList
                  ? after
                    ? "docs.removeSpaceAfterItem"
                    : "docs.addSpaceAfterItem"
                  : after
                    ? "docs.removeSpaceAfter"
                    : "docs.addSpaceAfter",
              )}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              onSelect={() => {
                close();
                setDialog(true);
              }}
              track="docs:custom-spacing"
            >
              {t("docs.customSpacing")}
            </MenuItem>
            {!pageless && (
              <>
                <MenuSeparator />
                {FLAGS.map((f) => (
                  <MenuItem
                    key={f.flag}
                    role="menuitemcheckbox"
                    checked={para.flags[f.flag]}
                    onSelect={() => {
                      close();
                      toggleFlag(editor, para, f.flag);
                    }}
                    track={`docs:${f.flag}`}
                  >
                    {t(f.key)}
                  </MenuItem>
                ))}
              </>
            )}
          </>
        )}
      </DropBtn>
      {dialog && <CustomSpacingDialog editor={editor} para={para} onClose={() => setDialog(false)} />}
    </>
  );
}

/** Custom spacing: the line spacing and the space before and after, in points. */
function CustomSpacingDialog({ editor, para, onClose }: { editor: Editor; para: ParagraphState; onClose: () => void }) {
  const t = useT();
  const [line, setLine] = useState(customLabel(para.lineSpacing));
  const [before, setBefore] = useState(String(para.spaceBefore));
  const [after, setAfter] = useState(String(para.spaceAfter));
  const lineValue = parseFloat(line);
  const beforeValue = parseFloat(before);
  const afterValue = parseFloat(after);
  const valid = lineValue > 0 && lineValue <= 100 && beforeValue >= 0 && beforeValue <= 1584 && afterValue >= 0 && afterValue <= 1584;
  const apply = () => {
    if (!valid) return;
    const chain = editor.chain().focus();
    chain.setLineSpacing(same(lineValue, para.styleLineSpacing) ? null : lineValue);
    chain.setParagraphSpace("before", same(beforeValue, para.styleSpaceBefore) ? null : beforeValue);
    chain.setParagraphSpace("after", same(afterValue, para.styleSpaceAfter) ? null : afterValue);
    chain.run();
    onClose();
  };
  const close = () => {
    onClose();
    editor.commands.focus();
  };
  return (
    <ToolbarDialog
      title={t("docs.customSpacing")}
      onClose={close}
      className="docs-spacing-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t("docs.cancel")}</DialogButton>
          <DialogButton primary disabled={!valid} onClick={apply}>
            {t("docs.apply")}
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
          <span className="docs-tb-label">{t("docs.lineSpacingField")}</span>
          <input className="docs-tb-field" inputMode="decimal" value={line} onChange={(e) => setLine(e.target.value)} />
        </label>
        <h3>{t("docs.paragraphSpacingPts")}</h3>
        <div className="docs-spacing-row">
          <label>
            <span className="docs-tb-label">{t("docs.spaceBefore")}</span>
            <input className="docs-tb-field" inputMode="decimal" value={before} onChange={(e) => setBefore(e.target.value)} />
          </label>
          <label>
            <span className="docs-tb-label">{t("docs.spaceAfter")}</span>
            <input className="docs-tb-field" inputMode="decimal" value={after} onChange={(e) => setAfter(e.target.value)} />
          </label>
        </div>
        <button type="submit" hidden />
      </form>
    </ToolbarDialog>
  );
}
