import { Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { suggest, suggestEach } from "@/components/docs/ext/suggest";
import { OBJECT_CHAR } from "@/components/docs/typing/chars";
import { diffSegments } from "@/lib/anchors/remap";
import { newBlockId, type RichNode } from "@/lib/docs/schema";

// Tools > Compare documents (SPEC.md §29): one document with another's
// differences as suggestions, the way Google Docs shows a comparison. The
// blocks of the two line up by their words (the longest run they share);
// between those, a block of the same kind with words alike pairs up and
// its changed words become the suggestion, a block only the other has is
// suggested in, and a block only this one has is suggested out. Lists,
// quotes, and tables line up the same way inside. Every difference is its
// own suggestion, so each is accepted or rejected alone.

type Edit = { from: number; to: number; content: Fragment };

/** A block's words, each object one character (as the page counts them). */
const words = (node: PMNode) => node.textBetween(0, node.content.size, "", OBJECT_CHAR);
/** What must be equal for two blocks to be the same block. */
const keyOf = (node: PMNode) => `${node.type.name}:${String(node.attrs.level ?? "")}:${words(node)}`;

/** A letter or digit of a word the suggestions keep whole: Chinese and
    Japanese characters stand alone. */
const WORD = /[^\s\p{P}\p{S}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const inWord = (s: string, i: number) => i > 0 && i < s.length && WORD.test(s[i - 1]) && WORD.test(s[i]);

/** How much of a replaced stretch the two texts share at its start and end,
    never cutting a word. */
function shared(a: string, b: string): [number, number] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  while (head > 0 && (inWord(a, head) || inWord(b, head))) head--;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  while (tail > 0 && (inWord(a, a.length - tail) || inWord(b, b.length - tail))) tail--;
  return [head, tail];
}

/** How alike two texts are: the share of their characters in matched words. */
function alike(a: string, b: string): number {
  if (!a && !b) return 1;
  let same = 0;
  for (const seg of diffSegments(a, b)) if (seg.matched) same += seg.oldEnd - seg.oldStart;
  return (2 * same) / (a.length + b.length);
}

/** The longest run of blocks both lists hold, as index pairs in order. */
function commonRun(a: string[], b: string[]): [number, number][] {
  // Past this many cells the lists line up by equal blocks at the same place only.
  if (a.length * b.length > 25_000_000) {
    const out: [number, number][] = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) out.push([i, i]);
    return out;
  }
  const cols = b.length + 1;
  const dp = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * cols + j] = a[i] === b[j] ? dp[(i + 1) * cols + j + 1] + 1 : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1]);
    }
  }
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) i++;
    else j++;
  }
  return out;
}

/** A copy of the other document's block with ids of its own. A figure
    object's media is the other document's: it has no place here. */
function fresh(node: PMNode): PMNode | null {
  if (node.type.name === "figure") return null;
  const attrs = "blockId" in node.attrs && node.attrs.blockId ? { ...node.attrs, blockId: newBlockId() } : node.attrs;
  if (node.isText) return node;
  const children: PMNode[] = [];
  node.forEach((child) => {
    const copy = fresh(child);
    if (copy) children.push(copy);
  });
  return node.type.create(attrs, Fragment.from(children), node.marks);
}

function freshAll(nodes: PMNode[]): Fragment {
  return Fragment.from(nodes.map(fresh).filter((n): n is PMNode => n !== null));
}

/** Containers whose children line up one by one. */
function sameShape(a: PMNode, b: PMNode): boolean {
  if (a.type !== b.type || a.isTextblock || a.isLeaf) return false;
  if (a.type.name !== "table") return true;
  // A table lines up cell by cell only with the same rows and columns.
  if (a.childCount !== b.childCount) return false;
  for (let r = 0; r < a.childCount; r++) if (a.child(r).childCount !== b.child(r).childCount) return false;
  return true;
}

function pairs(a: PMNode, b: PMNode): boolean {
  if (a.isTextblock && b.isTextblock) return a.type === b.type && (a.attrs.level ?? null) === (b.attrs.level ?? null) && alike(words(a), words(b)) >= 0.4;
  return sameShape(a, b);
}

/** The words that changed inside two paired blocks, `at` the base block's start. */
function changedWords(a: PMNode, b: PMNode, at: number, edits: Edit[]): void {
  const ta = words(a);
  const tb = words(b);
  if (ta === tb) return;
  for (const seg of diffSegments(ta, tb)) {
    if (seg.matched) continue;
    const [head, tail] = shared(ta.slice(seg.oldStart, seg.oldEnd), tb.slice(seg.newStart, seg.newEnd));
    const from = seg.oldStart + head;
    const to = seg.oldEnd - tail;
    const newFrom = seg.newStart + head;
    const newTo = seg.newEnd - tail;
    if (from === to && newFrom === newTo) continue;
    edits.push({ from: at + 1 + from, to: at + 1 + to, content: b.content.cut(newFrom, newTo) });
  }
}

/** The differences between two nodes' children, `start` the base node's content start. */
function childDifferences(a: PMNode, b: PMNode, start: number, edits: Edit[]): void {
  const A: PMNode[] = [];
  const B: PMNode[] = [];
  a.forEach((child) => A.push(child));
  b.forEach((child) => B.push(child));
  const at: number[] = [start];
  for (const node of A) at.push(at[at.length - 1] + node.nodeSize);
  const run = [...commonRun(A.map(keyOf), B.map(keyOf)), [A.length, B.length] as [number, number]];
  let i = 0;
  let j = 0;
  for (const [ai, bj] of run) {
    // The stretch between two shared blocks: pair what is alike, the rest in or out.
    let k = j;
    for (let x = i; x < ai; x++) {
      let partner = -1;
      for (let y = k; y < bj; y++) {
        if (pairs(A[x], B[y])) {
          partner = y;
          break;
        }
      }
      if (partner < 0) {
        edits.push({ from: at[x], to: at[x + 1], content: Fragment.empty });
        continue;
      }
      if (partner > k) edits.push({ from: at[x], to: at[x], content: freshAll(B.slice(k, partner)) });
      if (A[x].isTextblock) changedWords(A[x], B[partner], at[x], edits);
      else childDifferences(A[x], B[partner], at[x] + 1, edits);
      k = partner + 1;
    }
    if (k < bj) edits.push({ from: at[ai], to: at[ai], content: freshAll(B.slice(k, bj)) });
    i = ai + 1;
    j = bj + 1;
  }
}

export type Comparison = { doc: RichNode; differences: number };

/** `base` with `other`'s differences as suggestions by `author`, one per difference. */
export function compareDocuments(schema: Schema, base: RichNode, other: RichNode, author: string): Comparison {
  const a = schema.nodeFromJSON(base);
  const b = schema.nodeFromJSON(other);
  const edits: Edit[] = [];
  childDifferences(a, b, 0, edits);
  const real = edits.filter((e) => e.from !== e.to || e.content.size > 0);
  if (real.length === 0) return { doc: base, differences: 0 };
  const state = EditorState.create({ doc: a });
  const edit = state.tr;
  // From the end: every edit's place is still where the base had it. At one
  // place a removal goes before an insertion, so the insertion stays.
  for (const e of [...real].sort((x, y) => y.from - x.from || y.to - x.to)) {
    if (e.content.size === 0) edit.delete(e.from, e.to);
    else edit.replaceWith(e.from, e.to, e.content);
  }
  const tracked = suggest(suggestEach(edit), state, author);
  return { doc: tracked.doc.toJSON() as RichNode, differences: real.length };
}
