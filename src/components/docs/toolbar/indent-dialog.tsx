"use client";

import type { Editor } from "@tiptap/react";
import { useState } from "react";
import { useLang, useT } from "@/components/lang-provider";
import { formatLength, lengthUnitFor, MIN_TEXT_PT, parseLength, PX_PER_PT } from "@/components/docs/page/geometry";
import { setIndents } from "@/components/docs/page/ruler";
import { ToolbarDialog } from "@/components/docs/toolbar/dialog";
import type { TKey } from "@/lib/i18n/dictionaries";

// Format > Align & indent > Indentation options (SPEC.md §29): Left, Right,
// and a first-line or hanging indent, typed in inches (centimeters in
// Chinese). Apply sets the attributes the ruler's markers drag on every
// selected paragraph. As in Docs, under a hanging indent Left is where the
// first line starts, and the other lines start By further in.

type Special = "none" | "firstLine" | "hanging";

const SPECIALS: [Special, TKey][] = [
  ["none", "docs.indentNone"],
  ["firstLine", "docs.indentFirstLine"],
  ["hanging", "docs.indentHanging"],
];

/** The indents of the paragraph where the selection starts, in points, and
    the width its lines share. */
function readIndents(editor: Editor) {
  const { $from } = editor.state.selection;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const left = num($from.parent.attrs.indentLeft);
  const right = num($from.parent.attrs.indentRight);
  const first = num($from.parent.attrs.indentFirstLine);
  const dom = $from.depth > 0 ? editor.view.nodeDOM($from.before()) : null;
  const px = dom instanceof HTMLElement ? dom.offsetWidth + (left + right) * PX_PER_PT : editor.view.dom.offsetWidth;
  const special: Special = first > 0 ? "firstLine" : first < 0 ? "hanging" : "none";
  return { left: Math.min(left, left + first), right, special, by: Math.abs(first), width: px / PX_PER_PT };
}

export function IndentDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const unit = lengthUnitFor(useLang());
  const [initial] = useState(() => readIndents(editor));
  const [left, setLeft] = useState(formatLength(initial.left, unit));
  const [right, setRight] = useState(formatLength(initial.right, unit));
  const [special, setSpecial] = useState(initial.special);
  const [by, setBy] = useState(initial.special === "none" ? "" : formatLength(initial.by, unit));
  const l = parseLength(left, unit);
  const r = parseLength(right, unit);
  const b = special === "none" ? 0 : parseLength(by, unit);
  // The lines keep half an inch of text, as the ruler leaves them.
  const pt = l !== null && r !== null && b !== null && l + r + b <= initial.width - MIN_TEXT_PT ? { l, r, b } : null;
  const apply = () => {
    if (!pt) return;
    const hanging = special === "hanging";
    setIndents(editor, { indentLeft: hanging ? pt.l + pt.b : pt.l, indentRight: pt.r, indentFirstLine: hanging ? -pt.b : pt.b });
    onClose();
  };
  const field = (label: string, value: string, set: (value: string) => void, disabled = false) => (
    <input
      className="docs-tb-field"
      aria-label={label}
      inputMode="decimal"
      value={value}
      disabled={disabled}
      onChange={(e) => set(e.target.value)}
    />
  );
  return (
    <ToolbarDialog
      title={t("docs.indentationOptions")}
      onClose={onClose}
      className="docs-fields-dialog"
      submit={{ label: t("docs.apply"), disabled: !pt, run: apply }}
    >
      <h3>{t(unit === "in" ? "docs.indentationInches" : "docs.indentationCentimeters")}</h3>
      <div className="docs-fields-row">
        <label>
          <span className="docs-tb-label">{t("docsPage.left")}</span>
          {field(t("docsPage.left"), left, setLeft)}
        </label>
        <label>
          <span className="docs-tb-label">{t("docsPage.right")}</span>
          {field(t("docsPage.right"), right, setRight)}
        </label>
      </div>
      <h3>{t("docs.specialIndent")}</h3>
      <div className="docs-fields-row">
        <select
          className="docs-tb-field"
          aria-label={t("docs.specialIndent")}
          value={special}
          onChange={(e) => {
            const next = e.target.value as Special;
            setSpecial(next);
            // Half an inch, Docs' first step, when there is no value yet.
            if (next === "none") setBy("");
            else if (!by) setBy(formatLength(36, unit));
          }}
        >
          {SPECIALS.map(([value, key]) => (
            <option key={value} value={value}>
              {t(key)}
            </option>
          ))}
        </select>
        {field(t("docs.indentBy"), by, setBy, special === "none")}
      </div>
    </ToolbarDialog>
  );
}
