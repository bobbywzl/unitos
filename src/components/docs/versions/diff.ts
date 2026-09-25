import { Fragment, type Mark, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { OBJECT_CHAR } from "@/components/docs/typing/chars";
import { diffSegments } from "@/lib/anchors/remap";

// Show changes in version history (SPEC.md §29): a version against the one
// before it, drawn with the document's own marks, so it keeps the page's look.

type Paint = (marks: readonly Mark[]) => readonly Mark[];

/** A letter or digit of a word the diff keeps whole: Chinese and Japanese
    characters stand alone. */
const WORD = /[^\s\p{P}\p{S}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

const inWord = (s: string, i: number) => i > 0 && i < s.length && WORD.test(s[i - 1]) && WORD.test(s[i]);

/** How much of a replaced stretch the old and new words share at the start
    and at the end, never cutting a word. */
function shared(a: string, b: string): [number, number] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  while (head > 0 && (inWord(a, head) || inWord(b, head))) head--;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  while (tail > 0 && (inWord(a, a.length - tail) || inWord(b, b.length - tail))) tail--;
  return [head, tail];
}

/** Every blockId in a node, its own first. */
function ids(node: PMNode): string[] {
  const out: string[] = node.attrs.blockId ? [node.attrs.blockId as string] : [];
  node.descendants((d) => {
    if (d.attrs.blockId) out.push(d.attrs.blockId as string);
  });
  return out;
}

/** The version `doc` with its changes since `before` drawn; with no version
    before it, every word is new. */
export function markChanges(schema: Schema, doc: PMNode, before: PMNode | null, color: string): PMNode {
  const tint =
    (extra: Mark): Paint =>
    (marks) => {
      const style = marks.find((m) => m.type.name === "textStyle");
      return extra.addToSet(schema.marks.textStyle.create({ ...style?.attrs, color }).addToSet(marks));
    };
  const added = tint(schema.marks.underline.create());
  const removed = tint(schema.marks.strike.create());

  const paint = (node: PMNode, marks: Paint): PMNode => {
    if (node.isText) return node.mark(marks(node.marks));
    if (node.isLeaf) return node;
    const out: PMNode[] = [];
    node.forEach((child) => out.push(paint(child, marks)));
    return node.copy(Fragment.fromArray(out));
  };

  const words = (node: PMNode) => node.textBetween(0, node.content.size, "", OBJECT_CHAR);

  const inline = (next: PMNode, prev: PMNode): PMNode => {
    const a = words(prev);
    const b = words(next);
    if (a === b) return next;
    const out: PMNode[] = [];
    const take = (node: PMNode, from: number, to: number, marks?: Paint) => {
      if (to > from) node.content.cut(from, to).forEach((child) => out.push(marks ? paint(child, marks) : child));
    };
    for (const seg of diffSegments(a, b)) {
      if (seg.matched) {
        take(next, seg.newStart, seg.newEnd);
        continue;
      }
      const [head, tail] = shared(a.slice(seg.oldStart, seg.oldEnd), b.slice(seg.newStart, seg.newEnd));
      take(next, seg.newStart, seg.newStart + head);
      take(prev, seg.oldStart + head, seg.oldEnd - tail, removed);
      take(next, seg.newStart + head, seg.newEnd - tail, added);
      take(next, seg.newEnd - tail, seg.newEnd);
    }
    return next.copy(Fragment.fromArray(out));
  };

  // A node's children against the old node's: each new child pairs with the
  // old child that holds one of its blockIds; an old child left without a
  // pair comes back struck where it stood (an image or a line cannot be
  // struck, so it stays out).
  const children = (next: PMNode, prev: PMNode): PMNode => {
    const owner = new Map<string, number>();
    prev.forEach((child, _, j) => {
      for (const id of ids(child)) owner.set(id, j);
    });
    const used = new Set<number>();
    const pairs: number[] = [];
    next.forEach((child) => {
      const j = ids(child)
        .map((id) => owner.get(id))
        .find((k): k is number => k !== undefined && !used.has(k));
      if (j !== undefined) used.add(j);
      pairs.push(j ?? -1);
    });
    const out: PMNode[] = [];
    let p = 0;
    const gone = (upTo: number) => {
      for (; p < upTo; p++) if (!used.has(p) && !prev.child(p).isLeaf) out.push(paint(prev.child(p), removed));
    };
    next.forEach((child, _, i) => {
      const j = pairs[i];
      if (j < 0) {
        out.push(paint(child, added));
        return;
      }
      gone(j);
      p = Math.max(p, j + 1);
      out.push(pair(child, prev.child(j)));
    });
    gone(prev.childCount);
    return next.copy(Fragment.fromArray(out));
  };

  const pair = (next: PMNode, prev: PMNode): PMNode => {
    if (next.eq(prev) || next.isLeaf) return next;
    if (next.isTextblock && prev.isTextblock) return inline(next, prev);
    // A paragraph that became a list, or the other way: its words are new.
    if (next.isTextblock || prev.isTextblock || prev.isLeaf) return paint(next, added);
    return children(next, prev);
  };

  return before ? children(doc, before) : paint(doc, added);
}
