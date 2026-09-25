import { INDEXED_NODE_TYPES, type RichNode } from "@/lib/docs/schema";

// Two copies of one blank document met (SPEC.md §29): the editor's save
// started from a revision someone else already moved past. The editor's own
// changes since its last save are laid over the stored copy, so both
// people's work stands. Nodes pair by the first blockId inside them, at every
// level: two list items or two table cells are two changes. Two changes to
// one paragraph both stand when they touch different words; else the editor's
// copy, the one on screen, wins that paragraph.

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
function mergeList(base: RichNode[], local: RichNode[], remote: RichNode[]): RichNode[] {
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
    result.push({ key: r.key, node: b ? mergeNode(b, l, r) : l.node });
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

/** One node both copies hold, merged against its base. */
function mergeNode(base: Entry, local: Entry, remote: Entry): RichNode {
  if (local.json === base.json || local.json === remote.json) return remote.node;
  if (remote.json === base.json) return local.node;
  const [b, l, r] = [base.node, local.node, remote.node];
  if (l.type !== r.type || l.type !== b.type) return l;
  const attrs = stable(l.attrs ?? null) !== stable(b.attrs ?? null) ? l.attrs : r.attrs;
  if (INDEXED_NODE_TYPES.has(l.type)) {
    const content = mergeWords(b.content ?? [], l.content ?? [], r.content ?? []);
    return content ? withContent(l, attrs, content) : l;
  }
  return withContent(l, attrs, mergeList(b.content ?? [], l.content ?? [], r.content ?? []));
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

/** The stored copy with the editor's changes since `base` laid over it. */
export function mergeRichText(base: RichNode, local: RichNode, remote: RichNode): RichNode {
  const content = mergeList(base.content ?? [], local.content ?? [], remote.content ?? []);
  // The doc node's attributes (the named styles): the editor's when it changed them.
  const attrs = stable(local.attrs ?? null) !== stable(base.attrs ?? null) ? local.attrs : remote.attrs;
  return { ...remote, attrs, content: content.length > 0 ? content : [{ type: "paragraph" }] };
}
