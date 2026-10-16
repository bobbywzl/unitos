// An image or a figure object dragged in Suggesting mode (components/docs/
// insert/image-row.ts moveByDrop), checked in a headless editor with the
// page editor's own extensions: the drop goes through the page's own drop
// handlers, the move is one suggestion (the item struck where it was, a copy
// added where it lands, carrying the item's id as movedFrom), and the
// paragraph index reads the copy under the item's id while the move is
// pending. Accepted, the copy holds the item's id; rejected, the document is
// as it was before the drag.
// The page editor's code is ESM with CSS imports, so it runs bundled:
//   npx esbuild scripts/qa/image-row-suggest-page.mts --bundle --platform=node --format=esm \
//     --loader:.css=empty --external:jsdom --external:@prisma/client \
//     --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
//     --outfile=node_modules/.cache/image-row-suggest-page.mjs && node node_modules/.cache/image-row-suggest-page.mjs
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const g = globalThis as unknown as Record<string, unknown>;
for (const key of ["window", "document", "navigator", "Node", "HTMLElement", "Element", "DocumentFragment", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "DOMParser", "Text", "Range", "Selection", "CustomEvent", "Event", "KeyboardEvent", "ClipboardEvent", "InputEvent", "DragEvent"]) {
  if (!(key in g) || key === "window" || key === "document") {
    try {
      g[key] = (dom.window as unknown as Record<string, unknown>)[key];
    } catch {
      /* read-only in this Node */
    }
  }
}
(dom.window.document as unknown as { getSelection: () => null }).getSelection ??= () => null;
g.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
g.IntersectionObserver ??= g.ResizeObserver;
Object.defineProperty(dom.window.document, "fonts", { value: { addEventListener() {}, removeEventListener() {}, ready: Promise.resolve() } });

async function main() {
  const { Editor } = await import("@tiptap/core");
  const { Fragment, Slice } = await import("@tiptap/pm/model");
  const { NodeSelection } = await import("@tiptap/pm/state");
  const { docsExtensions } = await import("@/components/docs/extensions");
  const { setSuggesting, settleSuggestions, readSuggestions } = await import("@/components/docs/ext/suggest");
  const { deriveBlocks } = await import("@/lib/docs/blocks");
  const { stableJson } = await import("@/lib/docs/schema");
  type RichNode = import("@/lib/docs/schema").RichNode;
  type DocsEditor = InstanceType<typeof Editor>;

  let failures = 0;
  const check = (ok: boolean, what: string, detail?: unknown) => {
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
    if (!ok && detail !== undefined) console.log(`     ${JSON.stringify(detail)}`);
  };

  const p = (id: string, text: string): RichNode => ({ type: "paragraph", attrs: { blockId: id }, content: [{ type: "text", text }] });
  const img = (id: string, src: string): RichNode => ({ type: "image", attrs: { blockId: id, src, alt: id, width: 300, height: 200 } });
  const start: RichNode = {
    type: "doc",
    content: [p("dP1", "A bridge at dawn."), img("dA", "/api/images/a"), p("dP2", "The same bridge at noon."), img("dB", "/api/images/b"), p("dP3", "The end.")],
  };
  const make = (content: RichNode) => new Editor({ element: document.createElement("div"), extensions: docsExtensions(), content, injectCSS: false });
  const ids = (editor: DocsEditor) => deriveBlocks(editor.getJSON() as RichNode).map((b) => b.id);
  const posOf = (editor: DocsEditor, id: string, attr = "blockId") => {
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs[attr] === id) found = pos;
      return found < 0;
    });
    return found;
  };
  /** Every indexed node, top level and in rows: its id, and "+" when a
      suggestion adds it, "-" when one removes it. */
  const tops = (editor: DocsEditor) => {
    const out: string[] = [];
    editor.state.doc.forEach((node) => {
      const sign = node.marks.some((m) => m.type.name === "insertion") ? "+" : node.marks.some((m) => m.type.name === "deletion") ? "-" : "";
      out.push(`${sign}${node.attrs.movedFrom ? `copy(${node.attrs.movedFrom})` : String(node.attrs.blockId)}`);
    });
    return out;
  };
  const movedFromLeft = (editor: DocsEditor) => JSON.stringify(editor.getJSON()).includes('"movedFrom":"');

  /** The page's own drag of the node at `from`, let go at `to`: the drag the
      view holds, and the drop handlers the page runs, with the drop point
      the pointer would give (jsdom lays nothing out). */
  const dragTo = (editor: DocsEditor, from: number, to: number) => {
    const { view } = editor;
    const sel = NodeSelection.create(view.state.doc, from);
    view.dispatch(view.state.tr.setSelection(sel));
    const slice = new Slice(Fragment.from(sel.node), 0, 0);
    view.dragging = { slice, move: true, node: sel } as unknown as typeof view.dragging;
    const coords = view.posAtCoords;
    view.posAtCoords = () => ({ pos: to, inside: -1 });
    const event = new dom.window.Event("drop") as unknown as DragEvent;
    Object.assign(event, { clientX: 0, clientY: 0, dataTransfer: null });
    const handled = view.someProp("handleDrop", (f) => f(view, event, slice, true)) ?? false;
    view.posAtCoords = coords;
    view.dragging = null;
    return handled;
  };
  const endOf = (editor: DocsEditor, id: string) => posOf(editor, id) + editor.state.doc.nodeAt(posOf(editor, id))!.nodeSize;

  // A move accepted: the copy holds the image's id.
  const editor = make(start);
  setSuggesting(editor, "user1");
  check(dragTo(editor, posOf(editor, "dA"), endOf(editor, "dP2")), "the page's drop handlers take the drag in Suggesting mode");
  check(stableJson(tops(editor)) === stableJson(["dP1", "-dA", "dP2", "+copy(dA)", "dB", "dP3"]), "the image is struck where it was, and a copy that names it is added where it lands", tops(editor));
  const copyPos = posOf(editor, "dA", "movedFrom");
  const copy = copyPos >= 0 ? editor.state.doc.nodeAt(copyPos) : null;
  check(typeof copy?.attrs.blockId === "string" && copy.attrs.blockId !== "dA", "the copy has a block id of its own while the move is pending", copy?.attrs.blockId);
  const pending = readSuggestions(editor.state.doc);
  check(pending.length === 1, "the move is one suggestion", pending.map((s) => s.id));
  check(stableJson(ids(editor)) === stableJson(["dP1", "dP2", "dA", "dB", "dP3"]), "the paragraph index reads the move as made, the copy under the image's id", ids(editor));
  setSuggesting(editor, null);
  settleSuggestions(editor, true, pending.map((s) => s.id));
  check(stableJson(tops(editor)) === stableJson(["dP1", "dP2", "dA", "dB", "dP3"]), "accepted, the image stands where it was let go, under its own id", tops(editor));
  check(stableJson(ids(editor)) === stableJson(["dP1", "dP2", "dA", "dB", "dP3"]), "the paragraph index keeps the image's id", ids(editor));
  check(!movedFromLeft(editor), "no copy names a moved block once the move is settled");

  // A second move rejected: the document is as it was.
  const before = stableJson(editor.getJSON());
  setSuggesting(editor, "user1");
  dragTo(editor, posOf(editor, "dA"), posOf(editor, "dP1"));
  check(stableJson(tops(editor)) === stableJson(["+copy(dA)", "dP1", "dP2", "-dA", "dB", "dP3"]), "a second move is suggested the same way", tops(editor));
  setSuggesting(editor, null);
  settleSuggestions(editor, false, readSuggestions(editor.state.doc).map((s) => s.id));
  check(stableJson(editor.getJSON()) === before, "rejected, the document is unchanged", editor.getJSON());

  // A move of a pending copy passes on the id the copy carries.
  setSuggesting(editor, "user1");
  dragTo(editor, posOf(editor, "dA"), endOf(editor, "dB"));
  dragTo(editor, posOf(editor, "dA", "movedFrom"), posOf(editor, "dP3"));
  check(tops(editor).filter((t) => t.includes("copy(dA)")).length === 1, "a pending copy moved again is one copy that names the image", tops(editor));
  setSuggesting(editor, null);
  settleSuggestions(editor, true, readSuggestions(editor.state.doc).map((s) => s.id));
  check(ids(editor).includes("dA") && !movedFromLeft(editor), "accepted, the image keeps its id", { ids: ids(editor) });

  // Undo of the drop gives the page back.
  const once = stableJson(editor.getJSON());
  setSuggesting(editor, "user1");
  dragTo(editor, posOf(editor, "dB"), posOf(editor, "dP1"));
  const { undo } = await import("@tiptap/pm/history");
  undo(editor.state, editor.view.dispatch);
  check(stableJson(editor.getJSON()) === once, "one undo takes the suggested move back", editor.getJSON());
  setSuggesting(editor, null);

  // An image in an image row dragged out: accepted, the row of one is the
  // other image again, and the moved image keeps its id.
  const row = make({ type: "doc", content: [p("dP1", "Two."), { type: "imageRow", content: [img("dA", "/api/images/a"), img("dB", "/api/images/b")] }, p("dP2", "Then."), p("dP3", "End.")] });
  setSuggesting(row, "user1");
  dragTo(row, posOf(row, "dA"), endOf(row, "dP2"));
  check(stableJson(ids(row)) === stableJson(["dP1", "dB", "dP2", "dA", "dP3"]), "an item dragged out of a row reads under its id while pending", ids(row));
  setSuggesting(row, null);
  settleSuggestions(row, true, readSuggestions(row.state.doc).map((s) => s.id));
  check(stableJson(tops(row)) === stableJson(["dP1", "dB", "dP2", "dA", "dP3"]), "accepted, the row of one is the other image, and the moved image keeps its id", tops(row));

  // A figure object drags in Suggesting mode the same way.
  const figure: RichNode = { type: "figure", attrs: { blockId: "dF", mediaId: "m1", caption: "A chart of the spans." } };
  const figures = make({ type: "doc", content: [p("dP1", "A chart."), figure, p("dP2", "Then."), p("dP3", "End.")] });
  const figuresBefore = stableJson(figures.getJSON());
  setSuggesting(figures, "user1");
  dragTo(figures, posOf(figures, "dF"), endOf(figures, "dP2"));
  check(stableJson(tops(figures)) === stableJson(["dP1", "-dF", "dP2", "+copy(dF)", "dP3"]), "a figure object's move is suggested as an image's is", tops(figures));
  check(stableJson(ids(figures)) === stableJson(["dP1", "dP2", "dF", "dP3"]), "the paragraph index reads the figure under its id while pending", ids(figures));
  const figureMove = readSuggestions(figures.state.doc).map((s) => s.id);
  setSuggesting(figures, null);
  settleSuggestions(figures, false, figureMove);
  check(stableJson(figures.getJSON()) === figuresBefore, "rejected, the figure stands as it was", figures.getJSON());
  setSuggesting(figures, "user1");
  dragTo(figures, posOf(figures, "dF"), endOf(figures, "dP2"));
  setSuggesting(figures, null);
  settleSuggestions(figures, true, readSuggestions(figures.state.doc).map((s) => s.id));
  check(stableJson(tops(figures)) === stableJson(["dP1", "dP2", "dF", "dP3"]), "accepted, the figure keeps its id where it was let go", tops(figures));

  if (failures > 0) {
    console.log(`image-row-suggest-page: ${failures} failed`);
    process.exit(1);
  }
  console.log("image-row-suggest-page: all passed");
  process.exit(0);
}

void main();
