"use client";

import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import katex from "katex";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { onInsert } from "@/components/docs/insert/context";
import { caretAfter } from "@/components/docs/insert/actions";
import { DeleteIcon } from "@/components/docs/insert/icons";
import { DropButton } from "@/components/docs/insert/image-controls";
import { FloatingBox, focusSoon, useEditorTick, useViewportTick, type Anchor } from "@/components/docs/insert/ui";
import type { TKey } from "@/lib/i18n/dictionaries";

// The equation box (SPEC.md §29): Google Docs' equation toolbar — New
// equation, then the Greek letters, Miscellaneous operations, Relations,
// Math operations, and Arrows menus — over the field where the equation's
// TeX is typed (\alpha, x^2, x_i work as in Google Docs). The equation
// redraws as it is typed; Enter or Escape goes back to the text, and an
// equation left empty goes.

type Symbol = { tex: string; show?: string };

const GREEK: Symbol[] = [
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa",
  "lambda", "mu", "nu", "xi", "pi", "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon", "phi", "varphi",
  "chi", "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
].map((name) => ({ tex: `\\${name}` }));

const MISC: Symbol[] = [
  "times", "div", "cdot", "pm", "mp", "ast", "star", "circ", "bullet", "oplus", "ominus", "oslash", "otimes", "odot",
  "dagger", "ddagger", "vee", "wedge", "cap", "cup", "aleph", "Re", "Im", "top", "bot", "infty", "partial", "forall",
  "exists", "neg", "triangle", "diamond",
].map((name) => ({ tex: `\\${name}` }));

const RELATIONS: Symbol[] = [
  "leq", "geq", "prec", "succ", "preceq", "succeq", "ll", "gg", "equiv", "sim", "simeq", "asymp", "approx", "ne",
  "subset", "supset", "subseteq", "supseteq", "in", "ni", "notin",
].map((name) => ({ tex: `\\${name}` }));

const MATH: Symbol[] = [
  { tex: "\\frac{a}{b}" },
  { tex: "\\sqrt{x}" },
  { tex: "\\sqrt[n]{x}" },
  { tex: "x^{2}" },
  { tex: "x_{i}" },
  { tex: "x_{i}^{2}" },
  { tex: "\\overline{x}" },
  { tex: "\\widehat{x}" },
  { tex: "\\bigcap" },
  { tex: "\\bigcup" },
  { tex: "\\prod" },
  { tex: "\\coprod" },
  { tex: "\\left( x \\right)" },
  { tex: "\\left[ x \\right]" },
  { tex: "\\left\\{ x \\right\\}" },
  { tex: "\\left| x \\right|" },
  { tex: "\\int" },
  { tex: "\\oint" },
  { tex: "\\sum" },
  { tex: "\\lim_{x \\to a}" },
  { tex: "\\sum_{a}^{b}" },
  { tex: "\\int_{a}^{b}" },
  { tex: "\\prod_{a}^{b}" },
];

const ARROWS: Symbol[] = [
  "leftarrow", "rightarrow", "leftrightarrow", "Leftarrow", "Rightarrow", "Leftrightarrow", "uparrow", "downarrow",
  "updownarrow", "Uparrow", "Downarrow", "Updownarrow",
].map((name) => ({ tex: `\\${name}` }));

const MENUS: { label: TKey; face: string; symbols: Symbol[] }[] = [
  { label: "docsInsert.greekLetters", face: "αβΔ", symbols: GREEK },
  { label: "docsInsert.miscOperations", face: "×÷∃", symbols: MISC },
  { label: "docsInsert.relations", face: "<≠⊃", symbols: RELATIONS },
  { label: "docsInsert.mathOperations", face: "√x", symbols: MATH },
  { label: "docsInsert.arrows", face: "←↑⇔", symbols: ARROWS },
];

function renderTex(tex: string): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, strict: "ignore", trust: false, displayMode: false });
  } catch {
    return tex;
  }
}

export function EquationHost({ editor }: { editor: Editor }) {
  const [pos, setPos] = useState<number | null>(null);
  useEditorTick(editor);
  useViewportTick(pos !== null);
  useEffect(() => onInsert(editor, (e) => e.type === "equation" && setPos(e.pos)), [editor]);

  // The box follows its equation through edits; it goes with the equation.
  useEffect(() => {
    if (pos === null) return;
    const onTr = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map: (p: number) => number } } }) => {
      if (transaction.docChanged) setPos((p) => (p === null ? p : transaction.mapping.map(p)));
    };
    editor.on("transaction", onTr);
    return () => {
      editor.off("transaction", onTr);
    };
  }, [editor, pos]);

  if (pos === null) return null;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || (node.type.name !== "inlineMath" && node.type.name !== "blockMath")) return null;
  const dom = editor.view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  const r = dom.getBoundingClientRect();
  const anchor: Anchor = { left: r.left, top: r.top, bottom: r.bottom, right: r.right };
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
          <DropButton key={menu.label} label={t(menu.label)} face={<span className="docs-tb-text docs-equation-face">{menu.face}</span>} wide>
            {(close) => (
              <div className={`docs-symbol-grid${menu.symbols === MATH ? " is-wide" : ""}`}>
                {menu.symbols.map((s) => (
                  <button
                    key={s.tex}
                    type="button"
                    className="docs-symbol"
                    aria-label={s.tex}
                    data-tip={s.tex}
                    onClick={() => {
                      insertTex(s.tex);
                      close();
                    }}
                    dangerouslySetInnerHTML={{ __html: renderTex(s.tex) }}
                  />
                ))}
              </div>
            )}
          </DropButton>
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
