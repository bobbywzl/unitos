import { isAssistantSuggestion } from "@/lib/docs/assistant-suggestions";
import { withoutSuggestions } from "@/lib/docs/blocks";
import { INDEXED_NODE_TYPES, SUGGESTION_MARK_TYPES, type RichNode } from "@/lib/docs/schema";

// Two copies of one document with rich text met (SPEC.md §29): the editor's
// save started from a revision someone else already moved past. The editor's
// own changes since its last save are laid over the stored copy, so both
// people's work stands. Nodes pair by the first blockId inside them, at every
// level: two list items, two table cells, or two figure objects are two
// changes. Two changes to one paragraph both stand when they touch different
// words — a page start between them is one unit, kept once, and a citation
// is a mark on its words; else the editor's copy, the one on screen, wins
// that paragraph — unless its only change is the assistant's suggestions: a
// person's words win over those, and each of them goes whole. A block both
// copies hold never goes, even when one copy put it in an image row or a
// list and the other changed it.

type Entry = { key: string; node: RichNode; json: string };

/** JSON with sorted keys: a stored copy lists attributes in another order.
    An attribute that is null or "" counts as absent: a pasted style fills an
    empty "" where the stored copy holds nothing. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== "").sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A node's key: the first blockId inside it, or its JSON for a node that
    holds none (a page break). */
function keyOf(node: RichNode): string {
  const find = (n: RichNode): string | null => {
    if (INDEXED_NODE_TYPES.has(n.type) && typeof n.attrs?.blockId === "string") return n.attrs.blockId;
    for (const child of n.content ?? []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  return find(node) ?? `json:${stable(node)}`;
}

function keyed(list: RichNode[]): Entry[] {
  const counts = new Map<string, number>();
  return list.map((node) => {
    const base = keyOf(node);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return { key: n === 0 ? base : `${base}#${n}`, node, json: stable(node) };
  });
}

function withContent(node: RichNode, attrs: RichNode["attrs"], content: RichNode[]): RichNode {
  const next: RichNode = { ...node, attrs };
  if (content.length > 0) next.content = content;
  else delete next.content;
  return next;
}

/** The remote list with the editor's changes since `base` laid over it. */
function mergeList(base: RichNode[], local: RichNode[], remote: RichNode[], dropped: Set<string>): RichNode[] {
  const baseBy = new Map(keyed(base).map((e) => [e.key, e]));
  const localList = keyed(local);
  const localBy = new Map(localList.map((e) => [e.key, e]));
  const remoteList = keyed(remote);
  const result: { key: string; node: RichNode }[] = [];
  for (const r of remoteList) {
    const l = localBy.get(r.key);
    const b = baseBy.get(r.key);
    // The editor removed it: it goes. Never on screen: it is someone else's new node.
    if (!l) {
      if (!b) result.push(r);
      continue;
    }
    result.push({ key: r.key, node: b ? mergeNode(b, l, r, dropped) : l.node });
  }
  // The editor's new nodes go after the nearest node before them that the
  // result holds. A node the stored copy already holds (a save whose answer
  // was lost) is not added again.
  const held = new Set(result.map((r) => r.key));
  localList.forEach((e, i) => {
    if (baseBy.has(e.key) || held.has(e.key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const index = result.findIndex((r) => r.key === localList[j].key);
      if (index >= 0) {
        at = index + 1;
        break;
      }
    }
    result.splice(at, 0, { key: e.key, node: e.node });
  });
  return result.map((r) => r.node);
}

/** A node as people wrote and accepted it: the assistant's suggestions taken back. */
const approved = (node: RichNode) => stable(withoutSuggestions([node], isAssistantSuggestion));

/** The ids of the assistant's suggestions in a node. */
function assistantIds(node: RichNode, ids = new Set<string>()): Set<string> {
  for (const mark of node.marks ?? []) {
    if (SUGGESTION_MARK_TYPES.has(mark.type) && isAssistantSuggestion(mark.attrs?.id)) ids.add(String(mark.attrs?.id));
  }
  for (const child of node.content ?? []) assistantIds(child, ids);
  return ids;
}

/** An image row with `item` in the place of the item that shares its key. */
function withItem(row: RichNode, item: RichNode): RichNode {
  const key = keyOf(item);
  return withContent(row, row.attrs, (row.content ?? []).map((c) => (keyOf(c) === key ? item : c)));
}

/** One node both copies hold, merged against its base. The assistant's
    suggestions a paragraph gives up to the stored copy go in `dropped`. */
function mergeNode(base: Entry, local: Entry, remote: Entry, dropped: Set<string>): RichNode {
  if (local.json === base.json || local.json === remote.json) return remote.node;
  if (remote.json === base.json) return local.node;
  const [b, l, r] = [base.node, local.node, remote.node];
  if (INDEXED_NODE_TYPES.has(b.type) && approved(l) === approved(b)) {
    const kept = assistantIds(b, assistantIds(r));
    for (const id of assistantIds(l)) if (!kept.has(id)) dropped.add(id);
    return r;
  }
  // One copy put the node in an image row, the other changed it: the row
  // stands with the other copy's node in its place, so neither the row's
  // other items nor the change go.
  if (l.type === "imageRow" && r.type !== "imageRow") return withItem(l, r);
  if (r.type === "imageRow" && l.type !== "imageRow") return withItem(r, l);
  if (l.type !== r.type || l.type !== b.type) return l;
  const attrs = stable(l.attrs ?? null) !== stable(b.attrs ?? null) ? l.attrs : r.attrs;
  if (INDEXED_NODE_TYPES.has(l.type)) {
    const content = mergeWords(b.content ?? [], l.content ?? [], r.content ?? []);
    return content ? withContent(l, attrs, content) : l;
  }
  return withContent(l, attrs, mergeList(b.content ?? [], l.content ?? [], r.content ?? [], dropped));
}

// One character with its marks, or one inline node (a chip, a line break).
type Unit = { key: string; marks: string | null; node: RichNode };

function units(content: RichNode[]): Unit[] {
  const out: Unit[] = [];
  for (const n of content) {
    if (n.type !== "text" || typeof n.text !== "string") {
      out.push({ key: stable(n), marks: null, node: n });
      continue;
    }
    const marks = stable(n.marks ?? []);
    for (const ch of n.text) out.push({ key: `${marks}${ch}`, marks, node: { ...n, text: ch } });
  }
  return out;
}

/** What one copy changed in a paragraph: the base's [start, end) and the
    units that took its place. */
function change(base: Unit[], other: Unit[]) {
  let start = 0;
  while (start < base.length && start < other.length && base[start].key === other[start].key) start++;
  let tail = 0;
  while (
    tail < base.length - start &&
    tail < other.length - start &&
    base[base.length - 1 - tail].key === other[other.length - 1 - tail].key
  ) {
    tail++;
  }
  return { start, end: base.length - tail, insert: other.slice(start, other.length - tail) };
}

/** Both copies' changes to one paragraph's words, or null when they touch
    the same words. Two insertions at one point: the stored copy's words
    come first (typed earlier); when one begins with the other's words (a
    save whose answer was lost, a reload), the longer one stands once. */
function mergeWords(base: RichNode[], local: RichNode[], remote: RichNode[]): RichNode[] | null {
  const b = units(base);
  const lc = change(b, units(local));
  const rc = change(b, units(remote));
  if (lc.start < rc.end && rc.start < lc.end) return null;
  if (lc.start === rc.start && lc.end === lc.start && rc.end === rc.start) {
    const [long, short] = lc.insert.length >= rc.insert.length ? [lc, rc] : [rc, lc];
    const words = (u: Unit) => u.node.text ?? u.key;
    if (short.insert.every((u, i) => words(u) === words(long.insert[i]))) short.insert = [];
  }
  const [first, second] = rc.start < lc.start || (rc.start === lc.start && rc.end <= lc.end) ? [rc, lc] : [lc, rc];
  const merged = [
    ...b.slice(0, first.start),
    ...first.insert,
    ...b.slice(first.end, second.start),
    ...second.insert,
    ...b.slice(second.end),
  ];
  // Characters with the same marks join into one text node again.
  const out: RichNode[] = [];
  let lastMarks: string | null = null;
  for (const u of merged) {
    const last = out[out.length - 1];
    if (u.marks !== null && last?.type === "text" && lastMarks === u.marks) {
      last.text = `${last.text ?? ""}${u.node.text ?? ""}`;
    } else {
      out.push({ ...u.node });
    }
    lastMarks = u.marks;
  }
  return out;
}

/** The indexed nodes of `nodes`, in order, by blockId. */
function indexedNodes(nodes: RichNode[]): Map<string, RichNode> {
  const out = new Map<string, RichNode>();
  const walk = (node: RichNode) => {
    const id = node.attrs?.blockId;
    if (INDEXED_NODE_TYPES.has(node.type) && typeof id === "string") {
      if (!out.has(id)) out.set(id, node);
      return;
    }
    node.content?.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

/** Every block both copies hold stays, with both copies' changes. A block
    one copy moved into a container the other did not (an image into an
    image row, a line into a list) pairs with the container's first block
    only. When the merge keeps the editor's container, a block in it that
    only the stored copy changed takes that change; when it keeps the copy
    that does not hold a block, the block goes back on a line of its own
    after the block before it in the editor's copy. */
function keepHeldBlocks(merged: RichNode[], base: RichNode[], local: RichNode[], remote: RichNode[]): RichNode[] {
  const [baseBy, localBy, inRemote] = [indexedNodes(base), indexedNodes(local), indexedNodes(remote)];
  const changed = new Map<string, RichNode>();
  for (const [id, r] of inRemote) {
    const [b, l] = [baseBy.get(id), localBy.get(id)];
    if (b && l && stable(l) === stable(b) && stable(r) !== stable(b)) changed.set(id, r);
  }
  const takeChanges = (node: RichNode): RichNode => {
    const id = node.attrs?.blockId;
    if (INDEXED_NODE_TYPES.has(node.type) && typeof id === "string") {
      const r = changed.get(id);
      return r && stable(node) === stable(localBy.get(id)) ? r : node;
    }
    return node.content ? { ...node, content: node.content.map(takeChanges) } : node;
  };
  const withChanges = changed.size > 0 ? merged.map(takeChanges) : merged;
  const kept = indexedNodes(withChanges);
  const order = [...localBy];
  if (order.every(([id]) => kept.has(id) || !inRemote.has(id))) return withChanges;
  const out = [...withChanges];
  // The top-level node that holds each block of the result.
  const topOf = (id: string) => out.findIndex((node) => indexedNodes([node]).has(id));
  order.forEach(([id, node], i) => {
    if (kept.has(id) || !inRemote.has(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const top = topOf(order[j][0]);
      if (top >= 0) {
        at = top + 1;
        break;
      }
    }
    out.splice(at, 0, node);
    kept.set(id, node);
  });
  return out;
}

/** The stored copy with the editor's changes since `base` laid over it. */
export function mergeRichText(base: RichNode, local: RichNode, remote: RichNode): RichNode {
  const dropped = new Set<string>();
  const merged = keepHeldBlocks(
    mergeList(base.content ?? [], local.content ?? [], remote.content ?? [], dropped),
    base.content ?? [],
    local.content ?? [],
    remote.content ?? [],
  );
  // A suggestion that gave up one paragraph leaves the others too: none stays half made.
  const content = dropped.size > 0 ? withoutSuggestions(merged, (id) => dropped.has(String(id))) : merged;
  // The doc node's attributes (the named styles): the editor's when it changed them.
  const attrs = stable(local.attrs ?? null) !== stable(base.attrs ?? null) ? local.attrs : remote.attrs;
  return { ...remote, attrs, content: content.length > 0 ? content : [{ type: "paragraph" }] };
}
