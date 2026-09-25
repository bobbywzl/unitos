import { inlineText } from "@/lib/docs/blocks";
import { INDEXED_NODE_TYPES, newBlockId, ZWSP, type RichMark, type RichNode } from "@/lib/docs/schema";

// Server-side edits to a blank document's rich text (SPEC.md §29). The block
// routes — the assistant's approved plans, the history's restore, an image
// dropped on a paragraph — act on blocks; for a blank document each one is
// applied here to the rich text, and the save (lib/docs/sync.ts) brings the
// Block rows in line. Every function returns a new tree; none mutates.

type Path = number[];

/** The path to the indexed node with this blockId, and the node. */
export function findBlock(doc: RichNode, blockId: string): { path: Path; node: RichNode } | null {
  let hit: { path: Path; node: RichNode } | null = null;
  const walk = (node: RichNode, path: Path) => {
    if (hit) return;
    if (INDEXED_NODE_TYPES.has(node.type) && node.attrs?.blockId === blockId) {
      hit = { path, node };
      return;
    }
    (node.content ?? []).forEach((child, i) => walk(child, [...path, i]));
  };
  walk(doc, []);
  return hit;
}

function nodeAt(doc: RichNode, path: Path): RichNode {
  let node = doc;
  for (const i of path) node = node.content![i];
  return node;
}

/** The tree with the node at `path` replaced by what `fn` returns (zero,
    one, or several nodes). */
function spliceAt(doc: RichNode, path: Path, fn: (node: RichNode) => RichNode[]): RichNode {
  if (path.length === 0) return fn(doc)[0] ?? doc;
  const [head, ...rest] = path;
  const content = [...(doc.content ?? [])];
  if (rest.length === 0) {
    content.splice(head, 1, ...fn(content[head]));
  } else {
    content[head] = spliceAt(content[head], rest, fn);
  }
  return { ...doc, content };
}

/** Plain text as inline nodes: a newline is a line break. */
export function inlineNodes(text: string, marks?: RichMark[]): RichNode[] {
  const out: RichNode[] = [];
  text.split("\n").forEach((part, i) => {
    if (i > 0) out.push({ type: "hardBreak" });
    if (part) out.push(marks && marks.length > 0 ? { type: "text", text: part, marks } : { type: "text", text: part });
  });
  return out;
}

/** The node's words replaced by `text`. The marks of the first run carry
    over, so a bold paragraph rewritten stays bold. */
export function replaceBlockText(doc: RichNode, blockId: string, text: string): RichNode | null {
  const hit = findBlock(doc, blockId);
  if (!hit || hit.node.type === "image" || hit.node.type === "horizontalRule") return null;
  if (hit.node.type === "blockMath") return spliceAt(doc, hit.path, (n) => [{ ...n, attrs: { ...n.attrs, latex: text } }]);
  const firstMarks = hit.node.content?.find((c) => c.type === "text")?.marks;
  return spliceAt(doc, hit.path, (node) => [
    { ...node, content: node.type === "codeBlock" ? (text ? [{ type: "text", text }] : []) : inlineNodes(text, firstMarks) },
  ]);
}

/** Where a sibling of the node at `path` goes: a paragraph in a list item
    gets a new list item after its own, so the new line is a list line. */
function siblingPlace(doc: RichNode, path: Path): { path: Path; wrapItem: string | null } {
  const parentPath = path.slice(0, -1);
  const parent = nodeAt(doc, parentPath);
  if ((parent.type === "listItem" || parent.type === "taskItem") && parentPath.length > 0) {
    return { path: parentPath, wrapItem: parent.type };
  }
  return { path, wrapItem: null };
}

/** `node` inserted right after the indexed node `afterBlockId`. */
export function insertAfterBlock(doc: RichNode, afterBlockId: string, node: RichNode): RichNode | null {
  const hit = findBlock(doc, afterBlockId);
  if (!hit) return null;
  const place = siblingPlace(doc, hit.path);
  const inserted =
    place.wrapItem && node.type === "paragraph"
      ? { type: place.wrapItem, ...(place.wrapItem === "taskItem" ? { attrs: { checked: false } } : {}), content: [node] }
      : node;
  return spliceAt(doc, place.path, (at) => [at, inserted]);
}

/** A new paragraph holding `text`, with a fresh blockId. */
export function paragraphNode(text: string, blockId = newBlockId()): RichNode {
  return { type: "paragraph", attrs: { blockId }, content: inlineNodes(text) };
}

/** The indexed node removed. A list item left empty goes with it, a list
    left empty goes with it, and a table cell or the document left empty
    keeps one empty paragraph. */
export function removeBlock(doc: RichNode, blockId: string): RichNode | null {
  const hit = findBlock(doc, blockId);
  if (!hit) return null;
  let path = hit.path;
  let next = spliceAt(doc, path, () => []);
  // Walk up while a container is left empty.
  while (path.length > 1) {
    const parentPath = path.slice(0, -1);
    const parent = nodeAt(next, parentPath);
    if ((parent.content ?? []).length > 0) break;
    if (parent.type === "tableCell" || parent.type === "tableHeader") {
      next = spliceAt(next, parentPath, (cell) => [{ ...cell, content: [paragraphNode("")] }]);
      break;
    }
    next = spliceAt(next, parentPath, () => []);
    path = parentPath;
  }
  if (!next.content || next.content.length === 0) next = { ...next, content: [paragraphNode("")] };
  return next;
}

export type BlockKind = "paragraph" | "h1" | "h2" | "h3" | "list" | "numbered";

/** The indexed node turned into a paragraph, a heading, or a list line.
    Leaving a list lifts the line out of it, splitting the list around it. */
export function setBlockKind(doc: RichNode, blockId: string, kind: BlockKind): RichNode | null {
  const hit = findBlock(doc, blockId);
  if (!hit || (hit.node.type !== "paragraph" && hit.node.type !== "heading")) return null;
  const parentPath = hit.path.slice(0, -1);
  const parent = nodeAt(doc, parentPath);
  const inItem = parent.type === "listItem" || parent.type === "taskItem";
  const { level: _level, docStyle: _docStyle, ...keep } = hit.node.attrs ?? {};
  void _level;
  void _docStyle;
  const asParagraph: RichNode = { ...hit.node, type: "paragraph", attrs: keep };

  if (kind === "list" || kind === "numbered") {
    const listType = kind === "list" ? "bulletList" : "orderedList";
    if (inItem) {
      // Already a list line: the whole list takes the new kind.
      const listPath = parentPath.slice(0, -1);
      const list = nodeAt(doc, listPath);
      if (list.type === listType) return doc;
      return spliceAt(doc, listPath, (l) => [{ ...l, type: listType, content: l.content }]);
    }
    return spliceAt(doc, hit.path, () => [{ type: listType, content: [{ type: "listItem", content: [asParagraph] }] }]);
  }

  const target: RichNode =
    kind === "paragraph"
      ? asParagraph
      : { ...hit.node, type: "heading", attrs: { ...keep, level: Number(kind.slice(1)) } };
  if (!inItem) return spliceAt(doc, hit.path, () => [target]);

  // Lift the line out of its list: the list splits before and after its item.
  const itemIndex = parentPath[parentPath.length - 1];
  const listPath = parentPath.slice(0, -1);
  return spliceAt(doc, listPath, (list) => {
    const items = list.content ?? [];
    const before = items.slice(0, itemIndex);
    const after = items.slice(itemIndex + 1);
    const item = items[itemIndex];
    const rest = (item.content ?? []).filter((c) => c !== hit.node);
    const out: RichNode[] = [];
    if (before.length > 0) out.push({ ...list, content: before });
    out.push(target, ...rest);
    if (after.length > 0) {
      const start = typeof list.attrs?.start === "number" ? list.attrs.start + before.length + 1 : undefined;
      out.push({ ...list, ...(start !== undefined ? { attrs: { ...list.attrs, start } } : {}), content: after });
    }
    return out;
  });
}

/** A named color of the old edit toolbar (lib/text-style.ts) as the hex the
    rich text stores; color-ink is the default ink, no color at all. */
const NAMED_HEX: Record<string, string | null> = {
  "color-ink": null,
  "color-clay": "#c2410c",
  "color-sage": "#4d7c5a",
  "color-gold": "#d9a54a",
  "color-plum": "#a78bfa",
};

function markKey(marks: RichMark[] | undefined): string {
  return JSON.stringify(
    [...(marks ?? [])].sort((a, b) => a.type.localeCompare(b.type)).map((m) => [m.type, m.attrs ?? null]),
  );
}

/** Adjacent text runs with the same marks joined into one. */
function mergeRuns(nodes: RichNode[]): RichNode[] {
  const out: RichNode[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (last && last.type === "text" && node.type === "text" && markKey(last.marks) === markKey(node.marks)) {
      out[out.length - 1] = { ...last, text: (last.text ?? "") + (node.text ?? "") };
    } else {
      out.push(node);
    }
  }
  return out;
}

function withStyle(marks: RichMark[] | undefined, style: string, on: boolean): RichMark[] {
  const list = [...(marks ?? [])];
  if (style === "bold" || style === "italic" || style === "underline") {
    const rest = list.filter((m) => m.type !== style);
    return on ? [...rest, { type: style }] : rest;
  }
  const key = style.startsWith("highlight:") ? "backgroundColor" : "color";
  const value = style.startsWith("highlight:")
    ? style.slice(10)
    : style.startsWith("color:")
      ? style.slice(6)
      : (NAMED_HEX[style] ?? null);
  const current = list.find((m) => m.type === "textStyle");
  const attrs: Record<string, unknown> = { ...(current?.attrs ?? {}) };
  attrs[key] = on ? value : null;
  const rest = list.filter((m) => m.type !== "textStyle");
  const kept = Object.values(attrs).some((v) => v !== null && v !== undefined);
  return kept ? [...rest, { type: "textStyle", attrs }] : rest;
}

function hasStyle(marks: RichMark[] | undefined, style: string): boolean {
  if (style === "bold" || style === "italic" || style === "underline") return (marks ?? []).some((m) => m.type === style);
  const attrs = (marks ?? []).find((m) => m.type === "textStyle")?.attrs ?? {};
  if (style.startsWith("highlight:")) return attrs.backgroundColor === style.slice(10);
  const value = style.startsWith("color:") ? style.slice(6) : NAMED_HEX[style];
  return value === null ? !attrs.color : attrs.color === value;
}

/** A style toggled over [start, end) of the node's words: on when some of
    the range lacks it, off when all of it has it — the style route's rule. */
export function toggleBlockStyle(
  doc: RichNode,
  blockId: string,
  start: number,
  end: number,
  style: string,
): RichNode | null {
  const hit = findBlock(doc, blockId);
  if (!hit || end <= start) return null;
  const pieces: { node: RichNode; from: number; to: number }[] = [];
  let at = 0;
  for (const child of hit.node.content ?? []) {
    // Offsets count as the paragraph index counts: a chip as its label, a
    // suggested break's zero-width spaces not at all.
    const len = inlineText(child).length;
    if (child.type !== "text") {
      pieces.push({ node: child, from: at, to: at + len });
      at += len;
      continue;
    }
    const text = child.text ?? "";
    const raw = (k: number) => {
      if (k >= len) return text.length;
      let i = 0;
      for (let left = k; i < text.length && left > 0; i++) if (text[i] !== ZWSP) left--;
      return i;
    };
    const cuts = [0, len, Math.max(0, Math.min(len, start - at)), Math.max(0, Math.min(len, end - at))];
    const points = [...new Set(cuts)].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i] === points[i + 1]) continue;
      pieces.push({
        node: { ...child, text: text.slice(raw(points[i]), raw(points[i + 1])) },
        from: at + points[i],
        to: at + points[i + 1],
      });
    }
    at += len;
  }
  const inside = pieces.filter((p) => p.node.type === "text" && p.from >= start && p.to <= end);
  if (inside.length === 0) return null;
  const on = !inside.every((p) => hasStyle(p.node.marks, style));
  const content = mergeRuns(
    pieces.map((p) => {
      if (p.node.type !== "text" || p.from < start || p.to > end) return p.node;
      const marks = withStyle(p.node.marks, style, on);
      const { marks: _old, ...rest } = p.node;
      void _old;
      return marks.length > 0 ? { ...rest, marks } : rest;
    }),
  );
  return spliceAt(doc, hit.path, (node) => [{ ...node, content }]);
}

/** `node` put back at `order` among the indexed nodes (a restored
    paragraph): before the node that holds that place now, or at the end. */
export function insertAtOrder(doc: RichNode, order: number, node: RichNode): RichNode {
  let index = 0;
  let target: Path | null = null;
  const walk = (n: RichNode, path: Path) => {
    if (target) return;
    if (INDEXED_NODE_TYPES.has(n.type)) {
      if (index === order) target = path;
      index += 1;
      return;
    }
    (n.content ?? []).forEach((child, i) => walk(child, [...path, i]));
  };
  walk(doc, []);
  if (!target) return { ...doc, content: [...(doc.content ?? []), node] };
  const place = siblingPlace(doc, target);
  const inserted =
    place.wrapItem && node.type === "paragraph" ? { type: place.wrapItem, content: [node] } : node;
  return spliceAt(doc, place.path, (at) => [inserted, at]);
}

/** The node a stored block becomes when it is put back: a heading keeps its
    level; any other text block comes back as a paragraph. */
export function nodeForBlock(block: { id: string; type: string; text: string; html: string | null }): RichNode {
  if (block.type === "HEADING") {
    const level = Number(/^<h([1-6])/.exec(block.html ?? "")?.[1] ?? 2);
    return { type: "heading", attrs: { level, blockId: block.id }, content: inlineNodes(block.text) };
  }
  return paragraphNode(block.text, block.id);
}

/** An image node for a figure's html (`<figure><img src=…>`), or null. */
export function imageNode(html: string, alt: string, blockId = newBlockId()): RichNode | null {
  const src = /<img[^>]*\ssrc="([^"]+)"/.exec(html)?.[1];
  if (!src) return null;
  return { type: "image", attrs: { src, alt, blockId } };
}
