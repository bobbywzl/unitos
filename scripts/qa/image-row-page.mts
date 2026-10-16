// The image row in the page editor (components/docs/insert/image-row.ts),
// checked in a headless editor with the page editor's own extensions: Side
// by side with next image, a drop beside an item, Separate images, and an
// item taken out of a row each change the page in one undo step; every item
// keeps its block id through each of them and through undo and redo, and
// the paragraph index reads the same rows in the row's order. A row of one
// is that item again. A document without a row loads as it was. Markdown
// writes a row's images on one line, and a copy of a row pastes back as one.
// The page editor's code is ESM with CSS imports, so it runs bundled:
//   npx esbuild scripts/qa/image-row-page.mts --bundle --platform=node --format=esm \
//     --loader:.css=empty --external:jsdom --external:@prisma/client \
//     --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
//     --outfile=node_modules/.cache/image-row-page.mjs && node node_modules/.cache/image-row-page.mjs
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
  const { NodeSelection } = await import("@tiptap/pm/state");
  const { undo, redo } = await import("@tiptap/pm/history");
  const { docsExtensions } = await import("@/components/docs/extensions");
  const { joinBeside, nextToJoin, rowOf, separateImages, sideBySideWithNext } = await import("@/components/docs/insert/image-row");
  const { fragmentToMarkdown } = await import("@/components/docs/typing/markdown");
  const { caretUnderImage } = await import("@/components/docs/typing/paste");
  const { deriveBlocks } = await import("@/lib/docs/blocks");
  const { stableJson } = await import("@/lib/docs/schema");
  type RichNode = import("@/lib/docs/schema").RichNode;

  let failures = 0;
  const check = (ok: boolean, what: string, detail?: unknown) => {
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
    if (!ok && detail !== undefined) console.log(`     ${JSON.stringify(detail)}`);
  };

  const img = (id: string, src: string, width: number, height: number): RichNode => ({ type: "image", attrs: { blockId: id, src, alt: id, width, height } });
  const p = (id: string, text: string): RichNode => ({ type: "paragraph", attrs: { blockId: id }, content: [{ type: "text", text }] });
  const start: RichNode = {
    type: "doc",
    content: [
      p("dP1", "Two pictures of the same bridge."),
      img("dA", "/api/images/a", 300, 200),
      img("dB", "/api/images/b", 200, 200),
      img("dC", "/api/images/c", 100, 150),
      p("dP2", "The end."),
    ],
  };
  const make = (content: RichNode) => new Editor({ element: document.createElement("div"), extensions: docsExtensions(), content, injectCSS: false });
  const ids = (editor: InstanceType<typeof Editor>) => deriveBlocks(editor.getJSON() as RichNode).map((b) => b.id);
  const tops = (editor: InstanceType<typeof Editor>) => (editor.getJSON() as RichNode).content!.map((n) => (n.type === "imageRow" ? `row(${n.content!.map((c) => c.attrs?.blockId).join(",")})` : String(n.attrs?.blockId)));
  const posOf = (editor: InstanceType<typeof Editor>, id: string) => {
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs.blockId === id) found = pos;
      return found < 0;
    });
    return found;
  };
  const undoOnce = (editor: InstanceType<typeof Editor>) => undo(editor.state, editor.view.dispatch);
  const redoOnce = (editor: InstanceType<typeof Editor>) => redo(editor.state, editor.view.dispatch);
  const order = ["dP1", "dA", "dB", "dC", "dP2"];

  // A document without a row loads as it was.
  const editor = make(start);
  check(stableJson(ids(editor)) === stableJson(order), "a document without an image row loads with its rows as they were", ids(editor));
  check(!JSON.stringify(editor.getJSON()).includes("imageRow"), "nothing turns into an image row on its own");

  // Side by side with next image.
  check(nextToJoin(editor.state.doc, posOf(editor, "dA")) !== null, "the first image offers Side by side with next image");
  check(nextToJoin(editor.state.doc, posOf(editor, "dC")) === null, "the last image, with words after it, offers no Side by side");
  sideBySideWithNext(editor.view, posOf(editor, "dA"));
  check(stableJson(tops(editor)) === stableJson(["dP1", "row(dA,dB)", "dC", "dP2"]), "Side by side with next image makes an image row of the two", tops(editor));
  check(stableJson(ids(editor)) === stableJson(order), "the paragraph index reads the same rows in the same order", ids(editor));
  const sel = editor.state.selection;
  check(sel instanceof NodeSelection && sel.node.attrs.blockId === "dA", "the image stays selected");

  // The row's last item takes the next image too, up to four.
  sideBySideWithNext(editor.view, posOf(editor, "dB"));
  check(stableJson(tops(editor)) === stableJson(["dP1", "row(dA,dB,dC)", "dP2"]), "the row's last item takes the next image into the row", tops(editor));
  undoOnce(editor);
  check(stableJson(tops(editor)) === stableJson(["dP1", "row(dA,dB)", "dC", "dP2"]), "one undo takes the third image back out", tops(editor));
  undoOnce(editor);
  check(stableJson(tops(editor)) === stableJson(["dP1", "dA", "dB", "dC", "dP2"]), "a second undo gives the page back as it was", tops(editor));
  check(stableJson(ids(editor)) === stableJson(order), "every block id is the same after undo", ids(editor));
  redoOnce(editor);
  check(stableJson(tops(editor)) === stableJson(["dP1", "row(dA,dB)", "dC", "dP2"]), "redo makes the row again, with the same ids", tops(editor));

  // A drop beside an item: the third image dropped left of the first.
  joinBeside(editor.view, { node: editor.state.doc.nodeAt(posOf(editor, "dC"))!, pos: posOf(editor, "dC") }, { node: editor.state.doc.nodeAt(posOf(editor, "dA"))!, pos: posOf(editor, "dA") }, "left");
  check(stableJson(tops(editor)) === stableJson(["dP1", "row(dC,dA,dB)", "dP2"]), "an image dropped on the left third of an item joins the row there", tops(editor));
  check(stableJson(ids(editor)) === stableJson(["dP1", "dC", "dA", "dB", "dP2"]), "the dropped image keeps its block id, and the index reads the row left to right", ids(editor));
  undoOnce(editor);
  check(stableJson(tops(editor)) === stableJson(["dP1", "row(dA,dB)", "dC", "dP2"]), "one undo takes the drop back", tops(editor));

  // An item taken out of a row of two: the row is the other item again.
  const bPos = posOf(editor, "dB");
  editor.view.dispatch(editor.state.tr.delete(bPos, bPos + 1));
  check(stableJson(tops(editor)) === stableJson(["dP1", "dA", "dC", "dP2"]), "a row left with one item is that item again", tops(editor));
  undoOnce(editor);
  check(stableJson(tops(editor)) === stableJson(["dP1", "row(dA,dB)", "dC", "dP2"]), "one undo puts the item and the row back", tops(editor));

  // A new image in a row hands the caret to the line under the row.
  const caret = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, posOf(editor, "dB")));
  caretUnderImage(caret);
  editor.view.dispatch(caret);
  check(editor.state.selection.$from.parent.type.name === "paragraph" && rowOf(editor.state.doc, editor.state.selection.from) === null, "the caret under a new image in a row stands under the row");
  undoOnce(editor);

  // Markdown and the clipboard's html.
  const md = fragmentToMarkdown(editor.state.doc.content);
  check(md.includes("![dA](/api/images/a) ![dB](/api/images/b)"), "Markdown writes a row's images on one line", md);
  const html = editor.getHTML();
  check(/<div[^>]*data-image-row[^>]*style="[^"]*display: flex/.test(html), "the copy's html is a flex row", html);
  const pasted = make(start);
  pasted.commands.setContent(html);
  check(stableJson(tops(pasted).map((t) => t.replace(/d\w+/g, "x"))) === stableJson(["x", "row(x,x)", "x", "x"]), "the html reads back as an image row", tops(pasted));

  // Separate images.
  separateImages(editor.view, posOf(editor, "dB"));
  check(stableJson(tops(editor)) === stableJson(["dP1", "dA", "dB", "dC", "dP2"]), "Separate images gives each image its own line, in order", tops(editor));
  check(stableJson(ids(editor)) === stableJson(order), "every block id is the same after Separate images", ids(editor));
  const after = editor.state.selection;
  check(after instanceof NodeSelection && after.node.attrs.blockId === "dB", "the image stays selected");
  undoOnce(editor);
  check(stableJson(tops(editor)) === stableJson(["dP1", "row(dA,dB)", "dC", "dP2"]), "one undo puts the row back", tops(editor));

  // Suggesting mode: an item deleted in a row is a suggestion like any
  // image's; accepted, the row of one is the other item again; rejected,
  // the row stands as it was.
  const { setSuggesting, settleSuggestions, readSuggestions } = await import("@/components/docs/ext/suggest");
  const suggesting = make(editor.getJSON() as RichNode);
  setSuggesting(suggesting, "user1");
  const aPos = posOf(suggesting, "dA");
  suggesting.view.dispatch(suggesting.state.tr.setSelection(NodeSelection.create(suggesting.state.doc, aPos)).deleteSelection());
  const marks = suggesting.state.doc.nodeAt(posOf(suggesting, "dA"))?.marks.map((m) => m.type.name) ?? [];
  check(marks.includes("deletion") && stableJson(tops(suggesting)) === stableJson(["dP1", "row(dA,dB)", "dC", "dP2"]), "in Suggesting mode a deleted item stays in its row, struck as a suggestion", { marks, tops: tops(suggesting) });
  check(!ids(suggesting).includes("dA"), "the paragraph index reads the suggested deletion as made", ids(suggesting));
  const suggestions = readSuggestions(suggesting.state.doc);
  setSuggesting(suggesting, null);
  settleSuggestions(suggesting, false, suggestions.map((s) => s.id));
  check(stableJson(tops(suggesting)) === stableJson(["dP1", "row(dA,dB)", "dC", "dP2"]) && ids(suggesting).includes("dA"), "rejected, the row stands as it was", tops(suggesting));
  setSuggesting(suggesting, "user1");
  suggesting.view.dispatch(suggesting.state.tr.setSelection(NodeSelection.create(suggesting.state.doc, posOf(suggesting, "dA"))).deleteSelection());
  setSuggesting(suggesting, null);
  settleSuggestions(suggesting, true, readSuggestions(suggesting.state.doc).map((s) => s.id));
  check(stableJson(tops(suggesting)) === stableJson(["dP1", "dB", "dC", "dP2"]), "accepted, the row of one is the other image again, its id kept", tops(suggesting));

  // A row loaded with one item (a server edit left it) draws, and the next
  // change makes it the item again.
  const one = make({ type: "doc", content: [p("dP1", "Words."), { type: "imageRow", content: [img("dA", "/api/images/a", 300, 200)] }, p("dP2", "More.")] });
  one.view.dispatch(one.state.tr.insertText("!", 2));
  check(stableJson(tops(one)) === stableJson(["dP1", "dA", "dP2"]), "a stored row of one is the item again on the next change", tops(one));

  if (failures > 0) {
    console.log(`image-row-page: ${failures} failed`);
    process.exit(1);
  }
  console.log("image-row-page: all passed");
  process.exit(0);
}

void main();
