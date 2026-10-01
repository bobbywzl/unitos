"use client";

import type { Editor } from "@tiptap/react";
import { useState, type CSSProperties } from "react";
import { useT } from "@/components/lang-provider";
import { BorderButtons, ColorButton } from "@/components/docs/insert/colors";
import { ColorResetIcon } from "@/components/docs/icons";
import { applyBox, MAX_PADDING, POSITIONS, selectionBox, type BorderLine, type BorderPosition } from "@/components/docs/toolbar/borders";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import type { TKey } from "@/lib/i18n/dictionaries";

// Format > Paragraph styles > Borders and shading (SPEC.md §29), Google
// Docs' dialog: which lines (Position: all, top, bottom, left, right, and
// between paragraphs), the line's width, dash, and color, the paragraph's
// padding, and its background color, on every paragraph the selection
// touches. The preview draws the paragraph as Apply will. Reset takes every
// line and the background off; Apply sets them.

type Toggle = BorderPosition | "all";

const LABELS: Record<Toggle, TKey> = {
  all: "docsInsert.borderAll",
  top: "docsInsert.borderTop",
  bottom: "docsInsert.borderBottom",
  left: "docsInsert.borderLeft",
  right: "docsInsert.borderRight",
  between: "docs.borderBetween",
};

// A square of two paragraphs' lines: the box's four sides and the line
// between; a toggle's own lines are solid.
const LINES: [BorderPosition, number, number, number, number][] = [
  ["top", 3, 3, 18, 0],
  ["bottom", 3, 21, 18, 0],
  ["left", 3, 3, 0, 18],
  ["right", 21, 3, 0, 18],
  ["between", 3, 12, 18, 0],
];

function Glyph({ lit }: { lit: ReadonlySet<BorderPosition> }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      {LINES.map(([position, x, y, w, h]) => (
        <line
          key={position}
          x1={x}
          y1={y}
          x2={x + w}
          y2={y + h}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          opacity={lit.has(position) ? 1 : 0.35}
          strokeDasharray={lit.has(position) ? undefined : "2 3"}
        />
      ))}
    </svg>
  );
}

const DEFAULT_LINE: BorderLine = { width: 1, dash: "solid", color: "#000000" };

export function BordersDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const [initial] = useState(() => selectionBox(editor));
  const [on, setOn] = useState<Set<BorderPosition>>(() => new Set(Object.keys(initial.lines) as BorderPosition[]));
  const [line, setLine] = useState<BorderLine>(() => Object.values(initial.lines)[0] ?? DEFAULT_LINE);
  const [padding, setPadding] = useState(String(initial.padding));
  const [shading, setShading] = useState<string | null>(initial.shading);
  // Between is for two or more paragraphs, as in Google Docs.
  const toggles: Toggle[] = ["all", ...POSITIONS.filter((p) => p !== "between" || initial.paragraphs > 1 || on.has("between"))];
  const sides = toggles.filter((p): p is BorderPosition => p !== "all");
  const allOn = sides.every((p) => on.has(p));
  const pad = Number(padding.replace(",", "."));
  const padOk = padding.trim() !== "" && Number.isFinite(pad) && pad >= 0 && pad <= MAX_PADDING;

  const toggle = (which: Toggle) => {
    const next = new Set(on);
    if (which === "all") {
      if (allOn) next.clear();
      else sides.forEach((p) => next.add(p));
    } else if (next.has(which)) next.delete(which);
    else next.add(which);
    setOn(next);
    // A line turned on with no width takes Google Docs' 1 pt.
    if (next.size > 0 && line.width === 0) setLine({ ...line, width: 1 });
  };

  const apply = () => {
    if (!padOk) return;
    applyBox(editor, { on, line, padding: pad, shading });
    onClose();
  };

  // The preview: the paragraph as Apply draws it.
  const side = (position: BorderPosition) => (on.has(position) && line.width > 0 ? `${line.width}pt ${line.dash} ${line.color}` : undefined);
  const preview: CSSProperties = {
    borderTop: side("top"),
    borderBottom: side("bottom"),
    borderLeft: side("left"),
    borderRight: side("right"),
    padding: padOk ? `${pad}pt` : undefined,
    background: shading ?? undefined,
  };

  return (
    <ToolbarDialog title={t("docs.bordersAndShading")} onClose={onClose} className="docs-fields-dialog docs-borders-dialog" submit={{ label: t("docs.apply"), disabled: !padOk, run: apply }}>
      <h3>{t("docs.bordersPosition")}</h3>
      <div className="docs-borders-positions" role="group" aria-label={t("docs.bordersPosition")}>
        {toggles.map((which) => {
          const pressed = which === "all" ? allOn : on.has(which);
          const lit = new Set<BorderPosition>(which === "all" ? sides : [which]);
          return (
            <button
              key={which}
              type="button"
              className="docs-borders-position"
              aria-pressed={pressed}
              aria-label={t(LABELS[which])}
              data-tip={t(LABELS[which])}
              data-track={`docs:borders:${which}`}
              onClick={() => toggle(which)}
            >
              <Glyph lit={lit} />
            </button>
          );
        })}
      </div>
      <h3>{t("docs.bordersLine")}</h3>
      <div className="docs-borders-row">
        <span className="docs-borders-lines">
          <BorderButtons
            track="borders"
            border={{ color: line.color, width: line.width, dash: line.dash }}
            onChange={(spec) => setLine({ ...line, ...spec })}
          />
        </span>
        <span className="docs-borders-swatch" style={{ background: line.color }} aria-hidden />
        <span>{`${line.width} pt · ${t(line.dash === "solid" ? "docsInsert.dashSolid" : line.dash === "dotted" ? "docsInsert.dashDotted" : "docsInsert.dashDashed")}`}</span>
      </div>
      <h3>{t("docs.paragraphPadding")}</h3>
      <div className="docs-borders-row">
        <input
          className="docs-tb-field"
          aria-label={t("docs.paragraphPadding")}
          inputMode="decimal"
          value={padding}
          onChange={(e) => setPadding(e.target.value)}
          data-track="docs:borders:padding"
        />
      </div>
      <h3>{t("docs.bordersBackground")}</h3>
      <div className="docs-borders-row">
        <ColorButton
          label={t("docs.bordersBackground")}
          track="borders-background"
          face={<span className="docs-borders-swatch" style={{ background: shading ?? "transparent" }} />}
          current={shading}
          onPick={setShading}
          onNone={() => setShading(null)}
        />
        <span>{shading ?? t("docs.bordersNone")}</span>
      </div>
      <div className="docs-borders-preview" aria-hidden>
        <p style={preview}>{t("docs.bordersSample")}</p>
      </div>
      <div className="docs-borders-row" style={{ marginTop: 12 }}>
        <DialogButton
          onClick={() => {
            setOn(new Set());
            setShading(null);
            setPadding("0");
          }}
        >
          <span className="docs-borders-lines">
            <ColorResetIcon size={18} />
            {t("docsInsert.reset")}
          </span>
        </DialogButton>
      </div>
    </ToolbarDialog>
  );
}
