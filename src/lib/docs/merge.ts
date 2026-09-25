import { INDEXED_NODE_TYPES, type RichNode } from "@/lib/docs/schema";

// Two copies of one blank document met (SPEC.md §29): the editor's save
// started from a revision someone else already moved past. The editor's own
// changes — the top-level nodes it changed, added, or removed since its last
// save — are laid over the stored copy, so both people's work stands. Two
// changes to the same top-level node (one paragraph, one whole list, one
// table) keep the editor's, the copy on screen.

/** A top-level node's key: the first blockId inside it, or its JSON for a
    node that holds none (a page break). */
function keyOf(node: RichNode): string {
  const find = (n: RichNode): string | null => {
    if (INDEXED_NODE_TYPES.has(n.type) && typeof n.attrs?.blockId === "string") return n.attrs.blockId;
    for (const child of n.content ?? []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  return find(node) ?? `json:${JSON.stringify(node)}`;
}

function keyed(doc: RichNode): { key: string; node: RichNode; json: string }[] {
  const counts = new Map<string, number>();
  return (doc.content ?? []).map((node) => {
    const base = keyOf(node);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return { key: n === 0 ? base : `${base}#${n}`, node, json: JSON.stringify(node) };
  });
}

/** The stored copy with the editor's changes since `base` laid over it. */
export function mergeRichText(base: RichNode, local: RichNode, remote: RichNode): RichNode {
  const baseList = keyed(base);
  const localList = keyed(local);
  const remoteList = keyed(remote);
  const baseJson = new Map(baseList.map((e) => [e.key, e.json]));
  const localByKey = new Map(localList.map((e) => [e.key, e]));

  const removed = new Set(baseList.filter((e) => !localByKey.has(e.key)).map((e) => e.key));
  const changed = new Set(
    localList.filter((e) => baseJson.has(e.key) && baseJson.get(e.key) !== e.json).map((e) => e.key),
  );

  const result: { key: string; node: RichNode }[] = [];
  for (const e of remoteList) {
    if (removed.has(e.key)) continue;
    result.push({ key: e.key, node: changed.has(e.key) ? localByKey.get(e.key)!.node : e.node });
  }
  // The editor's new nodes go after the nearest node before them that the
  // result still holds.
  localList.forEach((e, i) => {
    if (baseJson.has(e.key)) return;
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
  const content = result.map((r) => r.node);
  // The doc node's attributes (the named styles): the editor's when it changed them.
  const attrs = JSON.stringify(local.attrs ?? null) !== JSON.stringify(base.attrs ?? null) ? local.attrs : remote.attrs;
  return { ...remote, attrs, content: content.length > 0 ? content : [{ type: "paragraph" }] };
}
