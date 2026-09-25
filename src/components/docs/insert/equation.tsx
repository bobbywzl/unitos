"use client";

import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import katex from "katex";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { DropBtn } from "@/components/docs/toolbar/controls";
import { onInsert } from "@/components/docs/insert/context";
import { caretAfter } from "@/components/docs/insert/actions";
import { DeleteIcon } from "@/components/docs/insert/icons";
import { FloatingBox, focusSoon, useDocPos, useEditorTick, useViewportTick, type Anchor } from "@/components/docs/insert/ui";
import type { TKey } from "@/lib/i18n/dictionaries";

// The equation box (SPEC.md §29): Google Docs' equation toolbar (New
// equation and the five symbol menus) over the field where the TeX is
// typed. Enter or Escape goes back to the text; an empty equation goes.

/** TeX commands by name: "alpha beta" gives \alpha and \beta. */
const commands = (names: string) => names.split(" ").map((name) => `\\${name}`);

/** The symbol menus: a face, and the TeX each symbol inserts. */
const MENUS: { label: TKey; face: string; cols: number; symbols: string[] }[] = [
  {
    label: "docsInsert.greekLetters",
    face: "αβΔ",
    cols: 6,
    symbols: commands(
      "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega",
    ),
  },
  {
    label: "docsInsert.miscOperations",
    face: "×÷∃",
    cols: 6,
    symbols: commands(
      "times div cdot pm mp ast star circ bullet oplus ominus oslash otimes odot dagger ddagger vee wedge cap cup aleph Re Im top bot infty partial forall exists neg triangle diamond",
    ),
  },
  {
    label: "docsInsert.relations",
    face: "<≠⊃",
    cols: 6,
    symbols: commands("leq geq prec succ preceq succeq ll gg equiv sim simeq asymp approx ne subset supset subseteq supseteq in ni notin"),
  },
  {
    label: "docsInsert.mathOperations",
    face: "√x",
    cols: 4,
    symbols: [
      "\\frac{a}{b}",
      "\\sqrt{x}",
      "\\sqrt[n]{x}",
      "x^{2}",
      "x_{i}",
      "x_{i}^{2}",
      "\\overline{x}",
      "\\widehat{x}",
      ...commands("bigcap bigcup prod coprod"),
      "\\left( x \\right)",
      "\\left[ x \\right]",
      "\\left\\{ x \\right\\}",
      "\\left| x \\right|",
      ...commands("int oint sum"),
      "\\lim_{x \\to a}",
      "\\sum_{a}^{b}",
      "\\int_{a}^{b}",
      "\\prod_{a}^{b}",
    ],
  },
  {
    label: "docsInsert.arrows",
    face: "←↑⇔",
    cols: 6,
    symbols: commands("leftarrow rightarrow leftrightarrow Leftarrow Rightarrow Leftrightarrow uparrow downarrow updownarrow Uparrow Downarrow Updownarrow"),
  },
];

function renderTex(tex: string): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, strict: "ignore", trust: false, displayMode: false });
  } catch {
    return tex;
  }
}

export function EquationHost({ editor }: { editor: Editor }) {
  const [pos, setPos] = useDocPos(editor);
  useEditorTick(editor);
  useViewportTick(pos !== null);
  useEffect(() => onInsert(editor, (e) => e.type === "equation" && setPos(e.pos)), [editor, setPos]);

  if (pos === null) return null;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || (node.type.name !== "inlineMath" && node.type.name !== "blockMath")) return null;
  const dom = editor.view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  const r = dom.getBoundingClientRect();
  const anchor: Anchor = { left: r.left, top: r.top, bottom: r.bottom };
  return (
    <EquationBox
      key={pos}
      editor={editor}
      pos={pos}
      latex={String(node.attrs.latex ?? "")}
      anchor={anchor}
      onClose={() => setPos(null)}
      onOpen={setPos}
    />
  );
}

function EquationBox({
  editor,
  pos,
  latex,
  anchor,
  onClose,
  onOpen,
}: {
  editor: Editor;
  pos: number;
  latex: string;
  anchor: Anchor;
  onClose: () => void;
  /** Open the box on another equation (New equation). */
  onOpen: (pos: number) => void;
}) {
  const t = useT();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(latex);

  useEffect(() => {
    focusSoon(fieldRef.current);
  }, []);

  const write = (next: string) => {
    setValue(next);
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex: next }));
  };

  const finish = () => {
    onClose();
    const node = editor.state.doc.nodeAt(pos);
    if (node && !String(node.attrs.latex ?? "").trim()) {
      editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      return;
    }
    caretAfter(editor, pos);
  };

  const insertTex = (tex: string) => {
    const field = fieldRef.current;
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? value.length;
    const needsSpace = /\\[a-zA-Z]+$/.test(tex) ? " " : "";
    const next = value.slice(0, start) + tex + needsSpace + value.slice(end);
    write(next);
    requestAnimationFrame(() => {
      const at = start + tex.length + needsSpace.length;
      fieldRef.current?.focus();
      fieldRef.current?.setSelectionRange(at, at);
    });
  };

  return (
    <FloatingBox anchor={anchor} className="docs-equation-box" onDismiss={finish} label={t("docsInsert.itemEquation")}>
      <div className="docs-equation-bar" role="toolbar">
        <button
          type="button"
          className="docs-text-btn"
          onClick={() => {
            const node = editor.state.doc.nodeAt(pos);
            if (!node) return;
            const after = pos + node.nodeSize;
            const type = editor.state.schema.nodes.inlineMath;
            if (!type) return;
            const tr = editor.state.tr.insert(after, type.create({ latex: "" }));
            tr.setSelection(NodeSelection.create(tr.doc, after));
            editor.view.dispatch(tr);
            onOpen(after);
          }}
        >
          {t("docsInsert.newEquation")}
        </button>
        {MENUS.map((menu) => (
          <DropBtn
            key={menu.label}
            label={t(menu.label)}
            track="equation-symbols"
            className="docs-tb-select"
            face={<span className="docs-tb-caption docs-equation-face">{menu.face}</span>}
          >
            {(close) => (
              <div className="docs-symbol-grid" data-grid-cols={menu.cols}>
                {menu.symbols.map((tex) => (
                  <button
                    key={tex}
                    type="button"
                    data-menu-item
                    tabIndex={-1}
                    className="docs-symbol"
                    aria-label={tex}
                    data-tip={tex}
                    onClick={() => {
                      insertTex(tex);
                      close();
                    }}
                    dangerouslySetInnerHTML={{ __html: renderTex(tex) }}
                  />
                ))}
              </div>
            )}
          </DropBtn>
        ))}
        <button
          type="button"
          className="docs-icon-btn"
          aria-label={t("docsInsert.deleteEquation")}
          data-tip={t("docsInsert.deleteEquation")}
          onClick={() => {
            onClose();
            const node = editor.state.doc.nodeAt(pos);
            if (node) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
          }}
        >
          <DeleteIcon size={18} />
        </button>
      </div>
      <input
        ref={fieldRef}
        className="docs-field docs-equation-field"
        value={value}
        spellCheck={false}
        placeholder={t("docsInsert.equationPlaceholder")}
        aria-label={t("docsInsert.itemEquation")}
        onChange={(e) => write(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish();
          }
        }}
      />
    </FloatingBox>
  );
}
