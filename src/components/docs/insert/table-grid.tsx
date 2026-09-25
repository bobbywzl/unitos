"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";

// Google Docs' table grid (SPEC.md §29): at least 10 × 5 squares; the ones
// from the top left to the pointer turn blue, the label under it reads
// "columns x rows", and the grid grows one row and one column past the
// pointer up to 20 × 20. The arrows grow and shrink the choice; Enter
// inserts it.

const MAX = 20;

export function TableGridPicker({ onPick, keyboard = true }: { onPick: (rows: number, cols: number) => void; keyboard?: boolean }) {
  const t = useT();
  const [hover, setHover] = useState({ rows: 1, cols: 1 });
  const hoverRef = useRef(hover);
  useLayoutEffect(() => {
    hoverRef.current = hover;
  });
  const cols = Math.min(MAX, Math.max(10, hover.cols + 1));
  const rows = Math.min(MAX, Math.max(5, hover.rows + 1));

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      const step: Record<string, [number, number]> = {
        ArrowRight: [0, 1],
        ArrowLeft: [0, -1],
        ArrowDown: [1, 0],
        ArrowUp: [-1, 0],
      };
      if (e.key in step) {
        e.preventDefault();
        e.stopPropagation();
        const [dr, dc] = step[e.key];
        setHover((h) => ({ rows: Math.min(MAX, Math.max(1, h.rows + dr)), cols: Math.min(MAX, Math.max(1, h.cols + dc)) }));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onPick(hoverRef.current.rows, hoverRef.current.cols);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [keyboard, onPick]);

  return (
    <div className="docs-grid-picker">
      <div
        className="docs-grid"
        style={{ gridTemplateColumns: `repeat(${cols}, 18px)` }}
        role="grid"
        aria-label={t("docsInsert.itemTable")}
      >
        {Array.from({ length: rows * cols }, (_, i) => {
          const r = Math.floor(i / cols) + 1;
          const c = (i % cols) + 1;
          const on = r <= hover.rows && c <= hover.cols;
          return (
            <button
              key={i}
              type="button"
              className={`docs-grid-cell${on ? " is-on" : ""}`}
              aria-label={t("docsInsert.tableSize", { cols: c, rows: r })}
              onMouseEnter={() => setHover({ rows: r, cols: c })}
              onClick={() => onPick(r, c)}
            />
          );
        })}
      </div>
      <div className="docs-grid-label">{t("docsInsert.tableSize", { cols: hover.cols, rows: hover.rows })}</div>
    </div>
  );
}
