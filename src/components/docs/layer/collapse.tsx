"use client";

import "@/components/docs/css/collapse.css";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { repaginate } from "@/components/docs/ext/page";
import { pageStartLabel } from "@/components/docs/insert/page-start";
import type { Highlight } from "@/components/reader/block-view";
import { CoreBlock, CoreToggle } from "@/components/reader/core-block";
import { coreKey } from "@/lib/anchors/core-key";
import { collapseUnits } from "@/lib/collapse-units";
import { deriveBlocks } from "@/lib/docs/blocks";
import type { RichNode } from "@/lib/docs/schema";

// Collapse (SPEC.md §28) in the page editor: every unit of the paragraph
// index that has a core — a paragraph, a list's lines, a table's cells, code,
// an equation (lib/collapse-units.ts) — shows its core in place of its words;
// headings and figures stay as they are. The core is drawn in the page, never
// written into the rich text: the unit's nodes are not drawn (a node
// decoration) and the core stands before them (a widget), the block reader's
// own core (core-block.tsx), so its marks, its selection, and its anchors are
// the collapsed view's, as in the block reader. Each unit has the block
// reader's button at its right: it reads the unit whole, or folds it again.
// Viewing only: Editing and Suggesting need the words, so they turn Collapse
// off. The pages lay a core out as one piece (page/paginate.ts).

/** What the reader hands the page: the cores by unit id, whether the article
    is collapsed, the units shown the other way by their own button, and
    Collapse off. */
export type PageCollapse = {
  cores: Record<string, string>;
  on: boolean;
  flipped: ReadonlySet<string>;
  flip: (blockId: string) => void;
  off?: () => void;
};

/** A unit in the page: its nodes [from, to), and whether it shows its core. */
type Shown = {
  id: string;
  type: string;
  rows: string[];
  from: number;
  to: number;
  core: boolean;
  /** The PDF pages that begin in it: its core carries their numbers. */
  pages: number[];
};

type Drawn = { key: string; from: number; to: number; core: boolean; dom: HTMLElement };

/** The drawn units and their signature; null once a change of the text
    mapped them, until they are drawn again. */
type Layer = { set: DecorationSet; signature: string | null };
const collapseKey = new PluginKey<Layer>("docsCollapse");
/** A node of a unit that shows its core (css/collapse.css). */
const HIDDEN = "docs-core-hidden";
/** A node of a unit read whole: its button shows while the pointer is on it. */
const WHOLE = "docs-core-whole";
const LISTS = new Set(["bulletList", "orderedList", "taskList"]);
const TABLES = new Set(["table"]);

/** Where a unit's nodes start or end: the outermost list around a list's
    line, the outermost table around a cell's paragraph, else the row's node. */
function edge(doc: PMNode, pos: number, type: string, end: boolean): number {
  const kinds = type === "LIST" ? LISTS : type === "TABLE" ? TABLES : null;
  if (kinds) {
    const $pos = doc.resolve(pos);
    for (let depth = 1; depth <= $pos.depth; depth++) {
      if (kinds.has($pos.node(depth).type.name)) return end ? $pos.after(depth) : $pos.before(depth);
    }
  }
  return end ? pos + (doc.nodeAt(pos)?.nodeSize ?? 0) : pos;
}

/** The PDF pages that begin between two positions: page starts, and the code
    blocks and equations a page begins at. */
function pagesIn(doc: PMNode, from: number, to: number): number[] {
  const pages: number[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    const page: unknown = node.type.name === "pageStart" ? node.attrs.page : node.attrs.pageStart;
    if (pos >= from && typeof page === "number" && !pages.includes(page)) pages.push(page);
    return true;
  });
  return pages;
}

/** The units of the page's text that have a core, in reading order. */
function unitsInPage(doc: PMNode, cores: Record<string, string>, on: boolean, flipped: ReadonlySet<string>): Shown[] {
  const json = doc.toJSON() as RichNode;
  const units = collapseUnits(deriveBlocks(json), json).filter((u) => cores[u.id] !== undefined);
  if (units.length === 0) return [];
  const at = new Map<string, number>();
  doc.descendants((node, pos) => {
    const id: unknown = node.attrs.blockId;
    if (typeof id === "string" && (node.isTextblock || node.isAtom)) at.set(id, pos);
    return !node.isTextblock && !node.isAtom;
  });
  const shown: Shown[] = [];
  let reached = 0;
  for (const unit of units) {
    const first = at.get(unit.rows[0]);
    const last = at.get(unit.rows[unit.rows.length - 1]);
    if (first === undefined || last === undefined) continue;
    const from = edge(doc, first, unit.type, false);
    const to = edge(doc, last, unit.type, true);
    // A unit inside the nodes of the one before it (a table in a list's
    // line) goes with that one.
    if (from < reached || to <= from) continue;
    reached = to;
    shown.push({ ...unit, from, to, core: on !== flipped.has(unit.id), pages: pagesIn(doc, from, to) });
  }
  return shown;
}

function decorationsFor(doc: PMNode, drawn: Drawn[]): DecorationSet {
  const out: Decoration[] = [];
  for (const d of drawn) {
    doc.nodesBetween(d.from, d.to, (node, pos) => {
      if (pos < d.from || pos + node.nodeSize > d.to) return true;
      out.push(Decoration.node(pos, pos + node.nodeSize, { class: d.core ? HIDDEN : WHOLE }));
      return false;
    });
    // After every other widget at its place (a page's spacer, the words of
    // the paragraph before): the core is the last thing before its unit.
    out.push(Decoration.widget(d.from, () => d.dom, { key: d.key, side: 10, ignoreSelection: true, stopEvent: () => true }));
  }
  return DecorationSet.create(doc, out);
}

function collapsePlugin(): Plugin<Layer> {
  return new Plugin<Layer>({
    key: collapseKey,
    state: {
      init: () => ({ set: DecorationSet.empty, signature: "" }),
      apply: (tr, layer) => {
        const meta = tr.getMeta(collapseKey) as { drawn: Drawn[]; signature: string } | undefined;
        if (meta) return { set: decorationsFor(tr.doc, meta.drawn), signature: meta.signature };
        return tr.docChanged ? { set: layer.set.map(tr.mapping, tr.doc), signature: null } : layer;
      },
    },
    props: { decorations: (state) => collapseKey.getState(state)?.set },
  });
}

const slotKey = (unit: Shown) => `${unit.id}:${unit.core ? "core" : "words"}`;

/** Each unit's place in a page, by editor and slot key: an element the core
    renders into before the page shows it, so the pages measure it whole. */
const slotsOf = new WeakMap<Editor, Map<string, HTMLElement>>();

function slotFor(editor: Editor, unit: Shown): HTMLElement {
  let slots = slotsOf.get(editor);
  if (!slots) slotsOf.set(editor, (slots = new Map()));
  const key = slotKey(unit);
  let el = slots.get(key);
  if (!el) {
    el = document.createElement("div");
    el.className = "docs-core-slot group/block";
    el.dataset.docsCore = unit.core ? "core" : "words";
    slots.set(key, el);
  }
  return el;
}

/** The collapsed view over the page editor's text. */
export function CollapsedView({
  editor,
  collapse,
  highlightsByBlock,
  editing,
}: {
  editor: Editor;
  collapse: PageCollapse | null;
  highlightsByBlock: Record<string, Highlight[]>;
  /** Editing or Suggesting: the words must be there to type. */
  editing: boolean;
}) {
  useLayoutEffect(() => {
    editor.registerPlugin(collapsePlugin());
    return () => {
      editor.unregisterPlugin(collapseKey);
    };
  }, [editor]);

  // Editing and Suggesting turn Collapse off.
  const on = collapse?.on ?? false;
  const actions = useRef({ off: collapse?.off, flip: collapse?.flip });
  useEffect(() => {
    actions.current = { off: collapse?.off, flip: collapse?.flip };
  });
  useEffect(() => {
    if (editing && on) actions.current.off?.();
  }, [editing, on]);

  // The units are read again when the text changes while the view shows (a
  // collaborator's words, a re-parse's).
  const active = collapse !== null && !editing;
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!active) return;
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) setVersion((v) => v + 1);
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor, active]);
  const cores = collapse?.cores ?? null;
  const flipped = collapse?.flipped ?? null;
  const { doc, shown } = useMemo(() => {
    const now = editor.state.doc;
    return { doc: now, shown: active && cores && flipped ? unitsInPage(now, cores, on, flipped) : [] };
    // `version` reads the text again after a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, active, cores, on, flipped, version]);

  const signature = shown.map((u) => `${slotKey(u)}@${u.from}-${u.to}`).join(" ");
  useLayoutEffect(() => {
    if (editor.isDestroyed || editor.state.doc !== doc) return;
    if (collapseKey.getState(editor.state)?.signature === signature) return;
    const drawn: Drawn[] = shown.map((u) => ({ key: slotKey(u), from: u.from, to: u.to, core: u.core, dom: slotFor(editor, u) }));
    editor.view.dispatch(editor.state.tr.setMeta(collapseKey, { drawn, signature }).setMeta("addToHistory", false));
    const slots = slotsOf.get(editor);
    for (const key of [...(slots?.keys() ?? [])]) if (!drawn.some((d) => d.key === key)) slots?.delete(key);
    repaginate(editor);
    // The signature holds the units' places and looks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, doc, signature]);

  if (!cores) return null;
  return (
    <>
      {shown.map((unit) =>
        createPortal(
          <UnitSlot
            unit={unit}
            core={cores[unit.id] ?? ""}
            highlightsByBlock={highlightsByBlock}
            pageLabel={unit.core ? unit.pages.map((page) => pageStartLabel(editor, page)).join(" · ") : ""}
            onToggle={() => actions.current.flip?.(unit.id)}
          />,
          slotFor(editor, unit),
          slotKey(unit),
        ),
      )}
    </>
  );
}

/** A unit's place: its core with the button that reads it whole, or, read
    whole, the button that folds it again. */
function UnitSlot({
  unit,
  core,
  highlightsByBlock,
  pageLabel,
  onToggle,
}: {
  unit: Shown;
  core: string;
  highlightsByBlock: Record<string, Highlight[]>;
  pageLabel: string;
  onToggle: () => void;
}) {
  if (!unit.core) return <CoreToggle showsCore={false} onToggle={onToggle} />;
  // The whole text's annotations paint on the words alone; the core says
  // they are there.
  const annotated = unit.rows.some((row) => (highlightsByBlock[row] ?? []).some((h) => h.kind === "anchor" && !h.leaving));
  return (
    <>
      {pageLabel && (
        <span className="docs-core-pages" data-page-start={unit.pages[0]} data-page-label={pageLabel} data-anchor-skip aria-hidden />
      )}
      <CoreBlock
        block={{ id: unit.id, type: unit.type }}
        core={core}
        highlights={highlightsByBlock[coreKey(unit.id)] ?? []}
        annotated={annotated}
      />
      <CoreToggle showsCore onToggle={onToggle} />
    </>
  );
}
